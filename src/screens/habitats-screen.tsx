import { useEffect, useState, useCallback } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { colors } from "@/constants/colors";
import { cacheAllData } from "@/lib/cache-refresh";
import { fetchProjectHabitats } from "@/lib/habitats";
import HabitatList from "@/components/habitat-list";
import type { HabitatPolygon } from "@/types/habitat";

export default function HabitatsScreen() {
  const { id, siteId } = useLocalSearchParams<{ id: string; siteId?: string }>();
  const [habitats, setHabitats] = useState<HabitatPolygon[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Single source of truth for the list: the RPC wrapper handles the
  // online → cache fallback internally, so we don't need parallel cache /
  // network branches here. Site filtering is pushed to the RPC parameter
  // when present; site_id IS NULL rows still come through (the RPC's WHERE
  // accepts them), so habitats imported before sites existed still render.
  const fetchHabitats = useCallback(async () => {
    if (!id) return;
    const rows = await fetchProjectHabitats(id, siteId ?? null);
    setHabitats(rows);
  }, [id, siteId]);

  useEffect(() => {
    fetchHabitats().finally(() => setLoading(false));
  }, [fetchHabitats]);

  // Pull-to-refresh: full cache rebuild for the metadata side, then a
  // fresh RPC for the boundary cache. cacheAllData failure (e.g. offline)
  // still falls through to a plain RPC retry — which itself falls through
  // to the cache if the network's gone.
  const onRefresh = async () => {
    setRefreshing(true);
    await cacheAllData();
    await fetchHabitats();
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
      <HabitatList habitats={habitats} refreshing={refreshing} onRefresh={onRefresh} />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background.page },
});
