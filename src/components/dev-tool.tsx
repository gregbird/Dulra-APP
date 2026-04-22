import { useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  PanResponder,
  Animated,
  Alert,
  Modal,
  ScrollView,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { Ionicons } from "@expo/vector-icons";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useDevEventStore } from "@/lib/dev-events";
import { useNetworkStore } from "@/lib/network";
import { clearCachedData, clearPendingData } from "@/lib/database";
import { syncPendingData, refreshPendingCount } from "@/lib/sync-service";
import { cacheAllData } from "@/lib/cache-refresh";
import {
  createOneSurvey, createTestHabitat, createTestTargetNote,
  inspectPending, dropAllConflicts,
} from "@/lib/dev-actions";
import { surveyTypeLabels } from "@/types/survey";
import { devToolStyles as s } from "@/components/dev-tool-styles";

const QUICK_CREATE_TYPES = [
  "releve_survey",
  "aquatic_survey",
  "bat_survey",
  "bird_survey",
  "botanical_survey",
  "habitat_mapping",
  "invertebrate_survey",
  "mammal_survey",
  "walkover",
  "other",
];

const BATCH_TYPES = ["bat_survey", "bird_survey", "botanical_survey", "walkover", "releve_survey"];

function useActiveProjectId(): string | null {
  const params = useGlobalSearchParams<{ id?: string; projectId?: string }>();
  const pathname = usePathname();
  if (pathname.startsWith("/project/") && params.id && params.id !== "[id]") return params.id;
  if (params.projectId) return params.projectId;
  return null;
}

function useIsOnFormScreen(): boolean {
  const pathname = usePathname();
  return pathname.startsWith("/survey/") || pathname.startsWith("/releve-survey/");
}

export default function DevTool() {
  const [menuVisible, setMenuVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const pan = useRef(new Animated.ValueXY({ x: 20, y: 100 })).current;
  const requestFill = useDevEventStore((s) => s.requestFill);
  const requestAddPhotos = useDevEventStore((s) => s.requestAddPhotos);
  const devForcedOffline = useNetworkStore((s) => s.devForcedOffline);
  const pendingCount = useNetworkStore((s) => s.pendingCount);
  const projectId = useActiveProjectId();
  const isOnForm = useIsOnFormScreen();

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: (pan.x as unknown as { _value: number })._value,
          y: (pan.y as unknown as { _value: number })._value,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    })
  ).current;

  const quickCreateLabels = useMemo(() => {
    return QUICK_CREATE_TYPES.map((t) => ({ type: t, label: surveyTypeLabels[t] ?? t }));
  }, []);

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
          setMenuVisible(false);
        },
      },
    ]);
  };

  const handleClearAndSignOut = () => {
    Alert.alert(
      "Clear Cache & Sign Out",
      "Wipes ALL local data (cache + pending + conflicts) and signs you out. Use this before switching to a different account so the next user starts clean.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear & Sign Out",
          style: "destructive",
          onPress: async () => {
            setMenuVisible(false);
            await clearCachedData();
            await clearPendingData();
            await refreshPendingCount();
            // signOut last: auth state change triggers the redirect; by then
            // the SQLite is already empty so the login screen won't briefly
            // flash with stale counts.
            await supabase.auth.signOut();
          },
        },
      ],
    );
  };

  const handleWipeAll = () => {
    Alert.alert(
      "Wipe All Local",
      "Deletes ALL cached data and ALL pending (unsynced) surveys and photos. Remote Supabase data is not touched. If online, cache will be re-populated afterwards.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Wipe",
          style: "destructive",
          onPress: async () => {
            setMenuVisible(false);
            await clearCachedData();
            await clearPendingData();
            await refreshPendingCount();
            const online = useNetworkStore.getState().isOnline;
            if (online) {
              const refilled = await cacheAllData();
              Alert.alert("Done", refilled ? "Local wiped, cache refilled from Supabase." : "Local wiped. Cache refill skipped (offline or auth).");
            } else {
              Alert.alert("Done", "Local wiped. Go online to repopulate cache.");
            }
          },
        },
      ],
    );
  };

  const handleFillForm = () => {
    requestFill();
    setMenuVisible(false);
  };

  const handleAddTestPhotos = () => {
    requestAddPhotos();
    setMenuVisible(false);
  };

  const handleInspectPending = async () => {
    setMenuVisible(false);
    const report = await inspectPending();
    Alert.alert("Pending Queue", report);
  };

  const handleDropConflicts = async () => {
    Alert.alert(
      "Drop Conflicts",
      "Remove all locally-queued items marked as conflict (e.g. RLS-rejected by Supabase). This does NOT affect remote data.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Drop",
          style: "destructive",
          onPress: async () => {
            setMenuVisible(false);
            const { surveys, photos } = await dropAllConflicts();
            await refreshPendingCount();
            Alert.alert("Done", `Removed ${surveys} surveys and ${photos} photos.`);
          },
        },
      ],
    );
  };

  const handleForceSync = async () => {
    if (busy) return;
    if (!useNetworkStore.getState().isOnline) {
      Alert.alert("Offline", "Cannot sync while offline. Toggle offline mode off or reconnect first.");
      return;
    }
    setBusy(true);
    setMenuVisible(false);
    try {
      const before = pendingCount;
      await syncPendingData();
      const after = useNetworkStore.getState().pendingCount;
      Alert.alert("Sync", `Before: ${before} pending\nAfter: ${after} pending`);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleOffline = async () => {
    const next = !devForcedOffline;
    useNetworkStore.getState().setDevForcedOffline(next);
    if (next) {
      useNetworkStore.getState().setOnline(false);
      setMenuVisible(false);
      return;
    }
    let online = true;
    try {
      const state = await NetInfo.fetch();
      online = state.isConnected === true;
    } catch { /* keep online=true default */ }
    useNetworkStore.getState().setOnline(online);
    setMenuVisible(false);
    // Mimic the real reconnect behaviour — kick off a sync if there's a queue.
    if (online) {
      try { await syncPendingData(); } catch { /* ignore */ }
    }
  };

  const quickCreate = async (surveyType: string) => {
    if (busy) return;
    if (!projectId) {
      Alert.alert("No project", "Open a project first, then try Quick Create.");
      return;
    }
    setBusy(true);
    try {
      const result = await createOneSurvey(surveyType, projectId);
      setMenuVisible(false);
      const label = surveyTypeLabels[surveyType] ?? surveyType;
      if (result === "offline") Alert.alert("Saved Offline", `${label} created locally. Will sync on reconnect.`);
      else if (result === "online") Alert.alert("Created", `${label} saved.`);
      else if (result === "failed") Alert.alert("Failed", `Template missing or save failed for "${label}".`);
    } finally {
      setBusy(false);
    }
  };

  const createHabitat = async () => {
    if (busy || !projectId) {
      if (!projectId) Alert.alert("No project", "Open a project first.");
      return;
    }
    setBusy(true);
    try {
      const r = await createTestHabitat(projectId);
      setMenuVisible(false);
      if (r.ok) Alert.alert("Created", "Test habitat polygon inserted. Pull to refresh the habitats list.");
      else Alert.alert("Failed", `Habitat insert failed — ${r.reason}.\n(No offline queue for habitats; must be online with insert permission.)`);
    } finally {
      setBusy(false);
    }
  };

  const createTargetNote = async () => {
    if (busy || !projectId) {
      if (!projectId) Alert.alert("No project", "Open a project first.");
      return;
    }
    setBusy(true);
    try {
      const r = await createTestTargetNote(projectId);
      setMenuVisible(false);
      if (r.ok) Alert.alert("Created", "Test target note inserted. Pull to refresh the target notes list.");
      else Alert.alert("Failed", `Target note insert failed — ${r.reason}.\n(No offline queue for target notes; must be online with insert permission.)`);
    } finally {
      setBusy(false);
    }
  };

  const handleBatchCreate = async () => {
    if (busy) return;
    if (!projectId) {
      Alert.alert("No project", "Open a project first, then try Batch Create.");
      return;
    }
    setBusy(true);
    setMenuVisible(false);
    const summary: Record<string, number> = { online: 0, offline: 0, failed: 0 };
    for (const t of BATCH_TYPES) {
      const r = await createOneSurvey(t, projectId);
      summary[r] = (summary[r] ?? 0) + 1;
    }
    setBusy(false);
    Alert.alert(
      "Batch Create",
      `Online: ${summary.online ?? 0}\nOffline: ${summary.offline ?? 0}\nFailed: ${summary.failed ?? 0}`,
    );
  };

  return (
    <>
      <Animated.View
        style={[s.fab, { transform: pan.getTranslateTransform() }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={s.fabButton}
          onPress={() => setMenuVisible(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="construct" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={s.overlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={s.menu}>
            <Text style={s.menuTitle}>Dev Tools</Text>

            <ScrollView style={s.menuScroll} contentContainerStyle={s.menuScrollContent} showsVerticalScrollIndicator={false}>
              <Text style={[s.sectionLabel, s.sectionLabelFirst]}>Form</Text>
              <TouchableOpacity
                style={[s.menuItem, !isOnForm && s.menuItemDisabled]}
                onPress={handleFillForm}
                activeOpacity={isOnForm ? 0.7 : 1}
                disabled={!isOnForm}
              >
                <Text style={[s.menuItemText, !isOnForm && s.menuItemTextDisabled]}>
                  {isOnForm ? "Fill Current Form" : "Fill Current Form (open a form first)"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.menuItem, !isOnForm && s.menuItemDisabled]}
                onPress={handleAddTestPhotos}
                activeOpacity={isOnForm ? 0.7 : 1}
                disabled={!isOnForm}
              >
                <Text style={[s.menuItemText, !isOnForm && s.menuItemTextDisabled]}>
                  {isOnForm ? "Add 2 Test Photos" : "Add Test Photos (open a form first)"}
                </Text>
              </TouchableOpacity>

              <Text style={s.sectionLabel}>Sync</Text>
              <TouchableOpacity
                style={[s.menuItem, s.menuItemSecondary, busy && s.menuItemDisabled]}
                onPress={handleForceSync}
                activeOpacity={busy ? 1 : 0.7}
                disabled={busy}
              >
                <Text style={[s.menuItemText, s.menuItemTextSecondary]}>
                  Force Sync Now ({pendingCount} pending)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.menuItem, s.menuItemSecondary]}
                onPress={handleInspectPending}
                activeOpacity={0.7}
              >
                <Text style={[s.menuItemText, s.menuItemTextSecondary]}>Inspect Pending Queue</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.menuItem, s.menuItemSecondary]}
                onPress={handleDropConflicts}
                activeOpacity={0.7}
              >
                <Text style={[s.menuItemText, s.menuItemTextSecondary]}>Drop Conflicted Items</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.menuItem, s.menuItemSecondary, devForcedOffline && s.menuItemWarn]}
                onPress={handleToggleOffline}
                activeOpacity={0.7}
              >
                <Text style={[s.menuItemText, s.menuItemTextSecondary, devForcedOffline && s.menuItemTextWarn]}>
                  {devForcedOffline ? "Offline Forced — Tap to Resume" : "Force Offline Mode"}
                </Text>
              </TouchableOpacity>

              <Text style={s.sectionLabel}>
                Quick Create {projectId ? "" : "(open a project first)"}
              </Text>
              <TouchableOpacity
                style={[s.menuItem, s.menuItemSecondary, (!projectId || busy) && s.menuItemDisabled]}
                onPress={handleBatchCreate}
                activeOpacity={projectId && !busy ? 0.7 : 1}
                disabled={!projectId || busy}
              >
                <Text style={[s.menuItemText, s.menuItemTextSecondary, (!projectId || busy) && s.menuItemTextDisabled]}>
                  Batch Create ({BATCH_TYPES.length} mixed)
                </Text>
              </TouchableOpacity>
              {quickCreateLabels.map(({ type, label }) => (
                <TouchableOpacity
                  key={type}
                  style={[s.menuItem, s.menuItemSecondary, (!projectId || busy) && s.menuItemDisabled]}
                  onPress={() => quickCreate(type)}
                  activeOpacity={projectId && !busy ? 0.7 : 1}
                  disabled={!projectId || busy}
                >
                  <Text style={[s.menuItemText, s.menuItemTextSecondary, (!projectId || busy) && s.menuItemTextDisabled]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}

              <Text style={s.sectionLabel}>
                Project Data {projectId ? "" : "(open a project first)"}
              </Text>
              <TouchableOpacity
                style={[s.menuItem, s.menuItemSecondary, (!projectId || busy) && s.menuItemDisabled]}
                onPress={createHabitat}
                activeOpacity={projectId && !busy ? 0.7 : 1}
                disabled={!projectId || busy}
              >
                <Text style={[s.menuItemText, s.menuItemTextSecondary, (!projectId || busy) && s.menuItemTextDisabled]}>
                  Create Test Habitat
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.menuItem, s.menuItemSecondary, (!projectId || busy) && s.menuItemDisabled]}
                onPress={createTargetNote}
                activeOpacity={projectId && !busy ? 0.7 : 1}
                disabled={!projectId || busy}
              >
                <Text style={[s.menuItemText, s.menuItemTextSecondary, (!projectId || busy) && s.menuItemTextDisabled]}>
                  Create Test Target Note
                </Text>
              </TouchableOpacity>

              <Text style={s.sectionLabel}>System</Text>
              <TouchableOpacity style={s.menuItem} onPress={handleClearAndSignOut} activeOpacity={0.7}>
                <Text style={s.menuItemText}>Clear Cache & Sign Out</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.menuItem} onPress={handleLogout} activeOpacity={0.7}>
                <Text style={s.menuItemText}>Sign Out (keep local)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.menuItem} onPress={handleWipeAll} activeOpacity={0.7}>
                <Text style={s.menuItemText}>Wipe All Local (stay in)</Text>
              </TouchableOpacity>
            </ScrollView>

            <TouchableOpacity
              style={[s.menuItem, s.menuItemClose]}
              onPress={() => setMenuVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={[s.menuItemText, s.menuItemTextClose]}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

