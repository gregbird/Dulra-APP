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

  const initial = await NetInfo.fetch();
  useNetworkStore.getState().setOnline(initial.isConnected === true);

  netUnsubscribe = NetInfo.addEventListener((state) => {
    if (useNetworkStore.getState().devForcedOffline) return;
    const online = state.isConnected === true;
    const prev = useNetworkStore.getState().isOnline;
    useNetworkStore.getState().setOnline(online);
    if (online && !prev && syncCallback) syncCallback();
  });

  appStateSubscription = AppState.addEventListener("change", async (state: AppStateStatus) => {
    if (state === "active") {
      if (useNetworkStore.getState().devForcedOffline) return;
      const netState = await NetInfo.fetch();
      const online = netState.isConnected === true;
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
