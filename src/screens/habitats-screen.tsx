import { useEffect, useState, useCallback, useRef } from "react";
import { View, ActivityIndicator, StyleSheet, TouchableOpacity, Text } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import { cacheAllData } from "@/lib/cache-refresh";
import {
  bboxFromCoords,
  expandBboxByMeters,
  fetchHabitatsInBbox,
  fetchProjectHabitats,
  getHabitatsForProject,
  invalidateHabitatsMemoryCache,
} from "@/lib/habitats";
import {
  fetchProjectBoundary,
  flattenBoundaryCoordinates,
  polygonToCoordinates,
} from "@/lib/project-boundary";
import HabitatList from "@/components/habitat-list";
import type { HabitatPolygon } from "@/types/habitat";

const INITIAL_BBOX_BUFFER_METERS = 100;

/**
 * Habitats list. Default load is bbox-bound — the same site/project
 * boundary + 100 m buffer the map uses on first open — so a heavy
 * project doesn't pull thousands of rows into the list view by accident.
 *
 * "Show all" is the explicit escape hatch: tapping it fires the legacy
 * `get_project_habitats` RPC which returns every row (capped at 1000
 * server-side). Once invoked, the button hides for the rest of the
 * session — there's nothing left to "show".
 *
 * Module-level store seeding: if the user has already opened the
 * project map, `getHabitatsForProject` returns whatever rows panning
 * around populated. The list paints those instantly while the bbox
 * fetch tops up anything we don't yet have.
 */
export default function HabitatsScreen() {
  const { id, siteId } = useLocalSearchParams<{ id: string; siteId?: string }>();
  const [habitats, setHabitats] = useState<HabitatPolygon[]>(() =>
    id ? getHabitatsForProject(id, siteId ?? null) : [],
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllInFlight, setShowAllInFlight] = useState(false);
  // Hides the "Show all" button after the user has explicitly fetched
  // the full project. Reset by pull-to-refresh so the user can opt back
  // into the bbox-bound default if they want.
  const [showAllDone, setShowAllDone] = useState(false);

  // Compute the initial bbox from the project boundary (or selected
  // site's boundary). Wrapped in a ref-tracked effect that runs once per
  // (project, site) — viewport-loading happens on the map screen, not
  // here, so we don't refetch on every interaction.
  const bboxFetchedRef = useRef<{ projectId: string | null; siteId: string | null }>({
    projectId: null,
    siteId: null,
  });
  const fetchInitialBbox = useCallback(async () => {
    if (!id) return;
    const boundary = await fetchProjectBoundary(id);
    if (!boundary) return;
    const focusCoords = (() => {
      if (siteId) {
        const site = boundary.sites.find((s) => s.id === siteId);
        const sitePoly = polygonToCoordinates(site?.boundary ?? null);
        if (sitePoly.length > 0) return sitePoly;
      }
      return flattenBoundaryCoordinates(boundary);
    })();
    const baseBbox = bboxFromCoords(focusCoords);
    if (!baseBbox) return;
    const bbox = expandBboxByMeters(baseBbox, INITIAL_BBOX_BUFFER_METERS);
    const rows = await fetchHabitatsInBbox(id, siteId ?? null, bbox);
    setHabitats(rows);
  }, [id, siteId]);

  useEffect(() => {
    if (!id) return;
    const ref = bboxFetchedRef.current;
    if (ref.projectId === id && ref.siteId === (siteId ?? null)) return;
    bboxFetchedRef.current = { projectId: id, siteId: siteId ?? null };
    fetchInitialBbox().finally(() => setLoading(false));
  }, [id, siteId, fetchInitialBbox]);

  const handleShowAll = async () => {
    if (!id || showAllInFlight) return;
    setShowAllInFlight(true);
    try {
      const rows = await fetchProjectHabitats(id, siteId ?? null);
      setHabitats(rows);
      setShowAllDone(true);
    } finally {
      setShowAllInFlight(false);
    }
  };

  // Pull-to-refresh: full cache rebuild for the metadata side, plus a
  // fresh bbox fetch for the boundary side. Memory cache is invalidated
  // so the RPC actually fires. Resets the show-all guard so the user can
  // re-narrow to bbox if they want.
  const onRefresh = async () => {
    setRefreshing(true);
    if (id) invalidateHabitatsMemoryCache(id);
    bboxFetchedRef.current = { projectId: null, siteId: null };
    setShowAllDone(false);
    await cacheAllData();
    await fetchInitialBbox();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Habitats" }} />
      {!showAllDone && (
        <View style={styles.bannerWrap}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>
              {habitats.length} habitats near boundary
            </Text>
            <Text style={styles.bannerSub}>
              Showing within 100 m of the {siteId ? "site" : "project"} boundary.
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleShowAll}
            style={styles.showAllBtn}
            activeOpacity={0.7}
            disabled={showAllInFlight}
          >
            {showAllInFlight ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Ionicons name="layers-outline" size={16} color={colors.white} />
                <Text style={styles.showAllText}>Show all</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
      <HabitatList habitats={habitats} refreshing={refreshing} onRefresh={onRefresh} />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background.page },
  bannerWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.background.card,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  bannerTitle: { fontSize: 14, fontWeight: "600", color: colors.text.heading },
  bannerSub: { fontSize: 12, color: colors.text.muted, marginTop: 2 },
  showAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary.DEFAULT,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 36,
    minWidth: 100,
    justifyContent: "center",
  },
  showAllText: { color: colors.white, fontSize: 13, fontWeight: "600" },
});
