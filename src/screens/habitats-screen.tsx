import { useEffect, useState, useCallback } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import { getCachedHabitats } from "@/lib/database";
import { cacheAllData } from "@/lib/cache-refresh";
import HabitatList from "@/components/habitat-list";
import type { HabitatPolygon } from "@/types/habitat";

export default function HabitatsScreen() {
  const { id, siteId } = useLocalSearchParams<{ id: string; siteId?: string }>();
  const [habitats, setHabitats] = useState<HabitatPolygon[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHabitats = useCallback(async () => {
    if (!id) return;
    try {
      let query = supabase
        .from("habitat_polygons")
        .select("id, project_id, fossitt_code, fossitt_name, area_hectares, condition, notes, eu_annex_code, survey_method, evaluation, site_id")
        .eq("project_id", id)
        .order("fossitt_code");
      if (siteId) query = query.or(`site_id.eq.${siteId},site_id.is.null`);
      const { data, error } = await query;
      if (error) throw error;
      if (data) setHabitats(data as HabitatPolygon[]);
    } catch {
      let cached = await getCachedHabitats(id);
      if (siteId) cached = cached.filter((h) => h.site_id === siteId || h.site_id === null);
      if (cached.length > 0) setHabitats(cached as HabitatPolygon[]);
    }
  }, [id, siteId]);

  useEffect(() => {
    fetchHabitats().finally(() => setLoading(false));
  }, [fetchHabitats]);

  const loadFromCache = useCallback(async () => {
    if (!id) return;
    let cached = await getCachedHabitats(id);
    if (siteId) cached = cached.filter((h) => h.site_id === siteId || h.site_id === null);
    setHabitats(cached as HabitatPolygon[]);
  }, [id, siteId]);

  const onRefresh = async () => {
    setRefreshing(true);
    const ok = await cacheAllData();
    if (ok) {
      await loadFromCache();
    } else {
      await fetchHabitats();
    }
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
