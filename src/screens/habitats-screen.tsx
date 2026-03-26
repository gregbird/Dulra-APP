import { useEffect, useState, useCallback } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import { getCachedHabitats } from "@/lib/database";
import HabitatList from "@/components/habitat-list";
import type { HabitatPolygon } from "@/types/habitat";

export default function HabitatsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [habitats, setHabitats] = useState<HabitatPolygon[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHabitats = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from("habitat_polygons")
        .select("id, project_id, fossitt_code, fossitt_name, area_hectares, condition, notes, eu_annex_code, survey_method, evaluation")
        .eq("project_id", id)
        .order("fossitt_code");
      if (error) throw error;
      if (data) setHabitats(data);
    } catch {
      const cached = await getCachedHabitats(id);
      if (cached.length > 0) setHabitats(cached as HabitatPolygon[]);
    }
  }, [id]);

  useEffect(() => {
    fetchHabitats().finally(() => setLoading(false));
  }, [fetchHabitats]);

  const onRefresh = async () => {
    setRefreshing(true);
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
