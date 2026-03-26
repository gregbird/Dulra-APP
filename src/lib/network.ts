import NetInfo from "@react-native-community/netinfo";
import { AppState, AppStateStatus } from "react-native";
import { create } from "zustand";

interface NetworkState {
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  setOnline: (online: boolean) => void;
  setPendingCount: (count: number) => void;
  setSyncing: (syncing: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOnline: true,
  pendingCount: 0,
  syncing: false,
  setOnline: (online) => set({ isOnline: online }),
  setPendingCount: (count) => set({ pendingCount: count }),
  setSyncing: (syncing) => set({ syncing }),
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
    const online = state.isConnected === true;
    const prev = useNetworkStore.getState().isOnline;
    useNetworkStore.getState().setOnline(online);
    if (online && !prev && syncCallback) syncCallback();
  });

  appStateSubscription = AppState.addEventListener("change", async (state: AppStateStatus) => {
    if (state === "active") {
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
