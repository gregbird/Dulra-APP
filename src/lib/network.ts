import NetInfo from "@react-native-community/netinfo";
import { AppState, AppStateStatus } from "react-native";
import { create } from "zustand";

interface NetworkState {
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  devForcedOffline: boolean;
  setOnline: (online: boolean) => void;
  setPendingCount: (count: number) => void;
  setSyncing: (syncing: boolean) => void;
  setDevForcedOffline: (v: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  // Pessimistic default. Real value is set by the NetInfo probe in
  // startNetworkListener a few hundred ms after launch. Starting at `false`
  // means the tiny window before that probe resolves is treated as offline
  // — screens use their cache immediately instead of burning a 30-60s
  // iOS fetch timeout while the app thinks it's online.
  isOnline: false,
  pendingCount: 0,
  syncing: false,
  devForcedOffline: false,
  setOnline: (online) => set({ isOnline: online }),
  setPendingCount: (count) => set({ pendingCount: count }),
  setSyncing: (syncing) => set({ syncing }),
  setDevForcedOffline: (v) => set({ devForcedOffline: v }),
}));

let netUnsubscribe: (() => void) | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let syncCallback: (() => void) | null = null;

export async function startNetworkListener(onOnline: () => void) {
  if (netUnsubscribe) return;
  syncCallback = onOnline;

  // `isConnected` only checks the interface (wifi/cellular up), not actual
  // internet. On a captive-portal or dead-router wifi it returns true even
  // though real fetches time out after 10-60s. `isInternetReachable` is
  // Apple's active probe (pings a test URL); when non-null it's the truth.
  // If null (briefly at startup), fall back to `isConnected`.
  const resolveOnline = (s: { isConnected: boolean | null; isInternetReachable: boolean | null }): boolean => {
    if (s.isInternetReachable === true) return true;
    if (s.isInternetReachable === false) return false;
    return s.isConnected === true;
  };

  const initial = await NetInfo.fetch();
  useNetworkStore.getState().setOnline(resolveOnline(initial));

  netUnsubscribe = NetInfo.addEventListener((state) => {
    if (useNetworkStore.getState().devForcedOffline) return;
    const online = resolveOnline(state);
    const prev = useNetworkStore.getState().isOnline;
    useNetworkStore.getState().setOnline(online);
    if (online && !prev && syncCallback) syncCallback();
  });

  appStateSubscription = AppState.addEventListener("change", async (state: AppStateStatus) => {
    if (state === "active") {
      if (useNetworkStore.getState().devForcedOffline) return;
      const netState = await NetInfo.fetch();
      const online = resolveOnline(netState);
      useNetworkStore.getState().setOnline(online);
      if (online && syncCallback) syncCallback();
    }
  });
}

export function stopNetworkListener() {
  if (netUnsubscribe) { netUnsubscribe(); netUnsubscribe = null; }
  if (appStateSubscription) { appStateSubscription.remove(); appStateSubscription = null; }
  syncCallback = null;
}
