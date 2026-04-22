import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform, LogBox, AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";

// Dev-only log noise suppression. Does not affect production behavior.
LogBox.ignoreLogs([
  "Network request failed",
  "Invalid Refresh Token",
  "Refresh Token Not Found",
  "AuthApiError",
]);

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS !== "web" ? ExpoSecureStoreAdapter : undefined,
    // Let Supabase handle token refresh automatically. Without this, long
    // overnight field sessions expire and the first save after resuming fails
    // with 401. setupTokenRefresh below still stops the auto-refresh loop
    // when offline or backgrounded to save battery.
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: async (url, options) => {
      const urlStr = typeof url === "string" ? url : "";
      const offlineResponse = (reason: string) => {
        const body = urlStr.includes("/auth/")
          ? JSON.stringify({ error: "network_error", error_description: reason })
          : JSON.stringify({ message: reason, code: "NETWORK_ERROR" });
        return new Response(body, { status: 503, headers: { "Content-Type": "application/json" } });
      };

      // Short-circuit when we already know the network is down. Without this
      // every screen's "try Supabase → fall back to cache" pattern would sit
      // on the OS fetch timeout (30-60s on iOS) before bailing — the reason
      // offline screens felt frozen on first load.
      try {
        const { useNetworkStore } = await import("@/lib/network");
        const state = useNetworkStore.getState();
        if (__DEV__ && state.devForcedOffline) return offlineResponse("Dev forced offline");
        if (!state.isOnline) return offlineResponse("Network request failed");
      } catch { /* network module not yet initialized — fall through to real fetch */ }

      // Online (per NetInfo) but real connectivity may still be flaky: cap
      // any single request at 10s so stuck sockets don't block the UI.
      // Longer than this the user will have bailed out anyway.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isNetwork = e instanceof TypeError && msg.includes("Network request failed");
        const isAbort = (e as { name?: string })?.name === "AbortError";
        if (isNetwork || isAbort) return offlineResponse(isAbort ? "Request timed out" : "Network request failed");
        throw e;
      } finally {
        clearTimeout(timeoutId);
      }
    },
  },
});

export function setupTokenRefresh() {
  AppState.addEventListener("change", async (state) => {
    if (state === "active") {
      const net = await NetInfo.fetch();
      if (net.isConnected) {
        try { supabase.auth.startAutoRefresh(); } catch { /* invalid token — onAuthStateChange handles sign-out */ }
      } else {
        supabase.auth.stopAutoRefresh();
      }
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
