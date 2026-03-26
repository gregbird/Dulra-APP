import { useEffect, useState, useCallback } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import { getCachedTargetNotes } from "@/lib/database";
import TargetNotesList from "@/components/target-notes-list";
import type { TargetNote } from "@/types/habitat";

export default function TargetNotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [notes, setNotes] = useState<TargetNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotes = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from("target_notes")
        .select("id, project_id, category, title, description, priority, is_verified")
        .eq("project_id", id)
        .order("priority");
      if (error) throw error;
      if (data) setNotes(data);
    } catch {
      const cached = await getCachedTargetNotes(id);
      if (cached.length > 0) setNotes(cached as TargetNote[]);
    }
  }, [id]);

  useEffect(() => {
    fetchNotes().finally(() => setLoading(false));
  }, [fetchNotes]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchNotes();
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
      <Stack.Screen options={{ title: "Target Notes" }} />
      <TargetNotesList notes={notes} refreshing={refreshing} onRefresh={onRefresh} />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background.page },
});
