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
import { cacheAllData } from "@/lib/cache-refresh";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataCached, setDataCached] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    // Refresh token geçersizse Supabase session'ı sessizce temizliyor
    // ve onAuthStateChange ile SIGNED_OUT emit ediyor — burada session
    // null geliyor, login ekranına yönlendirme kendiliğinden oluyor.
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session ?? null))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));

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

  const isOnline = useNetworkStore((s) => s.isOnline);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "(auth)";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [session, loading, segments]);

  // Cache all data from Supabase — retries automatically when internet comes back
  useEffect(() => {
    if (!session || loading || dataCached || !isOnline) return;
    cacheAllData().then((ok) => {
      if (ok) setDataCached(true);
    });
  }, [session, loading, dataCached, isOnline]);

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
        <Stack.Screen
          name="releve-survey/[id]"
          options={{
            headerShown: true,
            title: "Relevé Survey",
            headerBackTitle: "Back",
          }}
        />
      </Stack>
      <WatermarkEngine />
      {__DEV__ && <DevTool />}
    </View>
  );
}
