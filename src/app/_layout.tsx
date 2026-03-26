import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { Session } from "@supabase/supabase-js";
import { supabase, setupTokenRefresh } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import DevTool from "@/components/dev-tool";
import WatermarkEngine from "@/components/watermark-engine";
import SyncIndicator from "@/components/sync-indicator";
import { startNetworkListener, useNetworkStore } from "@/lib/network";
import { syncPendingData, refreshPendingCount } from "@/lib/sync-service";
import { cacheTemplate, cacheProject, cacheSurvey, clearCachedData } from "@/lib/database";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    startNetworkListener(syncPendingData);
    refreshPendingCount();
    setupTokenRefresh();

    const prev = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      if (!isFatal && String(error?.message).includes("Network request failed")) return;
      prev(error, isFatal);
    });
  }, []);

  const cacheAllData = async () => {
    const { isOnline } = useNetworkStore.getState();
    if (!isOnline) return;
    try {
      const results = await Promise.allSettled([
        supabase.from("survey_templates").select("name, survey_type, default_fields").eq("is_active", true),
        supabase.from("projects").select("id, name, site_code, status, health_status, county, updated_at").order("updated_at", { ascending: false }),
        supabase.from("surveys").select("id, project_id, survey_type, survey_date, status, weather, form_data, notes"),
      ]);

      const templates = results[0].status === "fulfilled" ? results[0].value.data : null;
      const projects = results[1].status === "fulfilled" ? results[1].value.data : null;
      const surveys = results[2].status === "fulfilled" ? results[2].value.data : null;

      if (templates || projects || surveys) await clearCachedData();

      if (templates && templates.length > 0) {
        for (const t of templates) {
          await cacheTemplate({ surveyType: t.survey_type, name: t.name, defaultFields: t.default_fields ?? {} });
        }
      }
      if (projects && projects.length > 0) {
        for (const p of projects) {
          await cacheProject({ id: p.id, name: p.name, siteCode: p.site_code, status: p.status, healthStatus: p.health_status, county: p.county, updatedAt: p.updated_at });
        }
      }
      if (surveys && surveys.length > 0) {
        for (const s of surveys) {
          await cacheSurvey({
            id: s.id, projectId: s.project_id, surveyType: s.survey_type,
            surveyDate: s.survey_date, status: s.status,
            weather: s.weather as Record<string, unknown> | null,
            formData: s.form_data as Record<string, unknown> | null,
            notes: s.notes,
          });
        }
      }
    } catch { /* offline */ }
  };

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "(auth)";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup) {
      router.replace("/(tabs)");
    }

    if (session) {
      cacheAllData();
    }
  }, [session, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.white }}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SyncIndicator />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
          gestureEnabled: true,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.white },
          headerTintColor: colors.primary.DEFAULT,
          headerTitleStyle: { color: colors.text.heading, fontWeight: "600" },
        }}
      >
        <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
        <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
        <Stack.Screen
          name="project/[id]"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="survey/[id]"
          options={{
            headerShown: true,
            title: "Survey",
            headerBackTitle: "Back",
          }}
        />
        <Stack.Screen
          name="habitat/[habitatId]"
          options={{
            headerShown: true,
            title: "Habitat",
            headerBackTitle: "Back",
          }}
        />
        <Stack.Screen
          name="target-note/[noteId]"
          options={{
            headerShown: true,
            title: "Target Note",
            headerBackTitle: "Back",
          }}
        />
      </Stack>
      <WatermarkEngine />
      {__DEV__ && <DevTool />}
    </View>
  );
}
