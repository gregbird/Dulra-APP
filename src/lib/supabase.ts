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
      if (__DEV__) {
        try {
          const { useNetworkStore } = await import("@/lib/network");
          if (useNetworkStore.getState().devForcedOffline) {
            const urlStr = typeof url === "string" ? url : "";
            const body = urlStr.includes("/auth/")
              ? JSON.stringify({ error: "network_error", error_description: "Dev forced offline" })
              : JSON.stringify({ message: "Dev forced offline", code: "NETWORK_ERROR" });
            return new Response(body, { status: 503, headers: { "Content-Type": "application/json" } });
          }
        } catch { /* network module not ready */ }
      }
      try {
        return await fetch(url, options);
      } catch (e) {
        if (e instanceof TypeError && String(e.message).includes("Network request failed")) {
          const urlStr = typeof url === "string" ? url : "";
          const body = urlStr.includes("/auth/")
            ? JSON.stringify({ error: "network_error", error_description: "Network request failed" })
            : JSON.stringify({ message: "Network request failed", code: "NETWORK_ERROR" });
          return new Response(body, { status: 503, headers: { "Content-Type": "application/json" } });
        }
        throw e;
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
