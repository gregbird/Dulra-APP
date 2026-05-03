import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { Session } from "@supabase/supabase-js";
import { supabase, setupTokenRefresh } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import DevTool from "@/components/dev-tool";
import WatermarkEngine from "@/components/watermark-engine";
import SyncIndicator from "@/components/sync-indicator";
import LocationPermissionModal from "@/components/location-permission-modal";
import { startNetworkListener, useNetworkStore } from "@/lib/network";
import { syncPendingData, refreshPendingCount } from "@/lib/sync-service";
import { cacheAllData } from "@/lib/cache-refresh";
import { getAppState, setAppState } from "@/lib/database";

const LOCATION_PROMPT_FLAG = "location_prompt_shown";

// Don't hammer the network every time the user briefly leaves the app —
// only auto-refresh if they've been away this long. Short app switches
// (1-2 minutes) reuse the existing cache.
const AUTO_REFRESH_MIN_BACKGROUND_MS = 30_000;

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataCached, setDataCached] = useState(false);
  const [locationPromptVisible, setLocationPromptVisible] = useState(false);
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

    let lastUserId: string | null = null;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        // Reset the cache-populated flag only when the user id actually
        // changes (sign-in, account switch, sign-out). Token refreshes
        // fire the same event but keep the same user — we don't want to
        // re-run the full cacheAllData every refresh cycle.
        const nextUserId = nextSession?.user?.id ?? null;
        if (nextUserId !== lastUserId) {
          lastUserId = nextUserId;
          setDataCached(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    startNetworkListener(syncPendingData);
    refreshPendingCount();
    setupTokenRefresh();

    const prev = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      if (!isFatal && String(error?.message).includes("Network request failed")) return;
      prev(error, isFatal);
    });

    // Foreground auto-refresh: when the user reopens the app after being
    // away for a while (AUTO_REFRESH_MIN_BACKGROUND_MS), if they're online,
    // re-pull the cache from Supabase. Ecologists reopening at the office
    // before field work get the latest projects/habitats/target notes without
    // having to sign out or pull-to-refresh every screen.
    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        backgroundedAtRef.current = Date.now();
        return;
      }
      if (next !== "active") return;
      const awayMs = backgroundedAtRef.current
        ? Date.now() - backgroundedAtRef.current
        : Infinity;
      backgroundedAtRef.current = null;
      if (awayMs < AUTO_REFRESH_MIN_BACKGROUND_MS) return;
      if (!useNetworkStore.getState().isOnline) return;
      if (!supabase.auth.getSession) return;
      cacheAllData().catch(() => { /* swallow — next manual refresh will retry */ });
    });

    return () => {
      appStateSub.remove();
    };
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

  // First-launch location prompt: shown once per device after the user is
  // signed in and inside the app shell. We persist a flag in app_state so
  // dismissal ("Maybe later" or any explicit close) sticks across restarts —
  // the user can always re-trigger from the Settings screen.
  useEffect(() => {
    if (!session || loading) return;
    const inAuthGroup = segments[0] === "(auth)";
    if (inAuthGroup) return;
    let cancelled = false;
    getAppState(LOCATION_PROMPT_FLAG).then((shown) => {
      if (!cancelled && !shown) setLocationPromptVisible(true);
    });
    return () => { cancelled = true; };
  }, [session, loading, segments]);

  const handleLocationPromptClose = () => {
    setLocationPromptVisible(false);
    setAppState(LOCATION_PROMPT_FLAG, "1").catch(() => { /* non-fatal */ });
  };

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
      <LocationPermissionModal
        visible={locationPromptVisible}
        onClose={handleLocationPromptClose}
      />
      {__DEV__ && <DevTool />}
    </View>
  );
}
