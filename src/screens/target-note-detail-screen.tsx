import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import { getCachedTargetNote } from "@/lib/database";
import { categoryLabels } from "@/types/habitat";
import PhotoViewer from "@/components/photo-viewer";

interface NoteDetail {
  id: string;
  category: string | null;
  title: string;
  description: string | null;
  priority: string | null;
  is_verified: boolean;
  photos: string[] | null;
  location_text: string | null;
}

const cardPadding = 20;
const screenPadding = 16;
const cardBorder = 2;
const imageWidth = Dimensions.get("window").width - (screenPadding * 2) - (cardPadding * 2) - cardBorder;

export default function TargetNoteDetailScreen() {
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNote = async () => {
      if (!noteId) return;
      try {
        const { data, error } = await supabase
          .from("target_notes")
          .select("id, category, title, description, priority, is_verified, photos, location")
          .eq("id", noteId)
          .single();
        if (error) throw error;
        if (!data) { setLoading(false); return; }

        let locationText: string | null = null;
        const loc = data.location as { type?: string; coordinates?: number[] } | null;
        if (loc?.coordinates) {
          locationText = `POINT(${loc.coordinates[0]} ${loc.coordinates[1]})`;
        }

        setNote({ ...data, location_text: locationText } as NoteDetail);
      } catch {
        const cached = await getCachedTargetNote(noteId);
        if (cached) {
          setNote({
            id: cached.id, category: cached.category, title: cached.title,
            description: cached.description, priority: cached.priority,
            is_verified: cached.is_verified === 1, location_text: cached.location_text,
            photos: cached.photos ? JSON.parse(cached.photos) : null,
          });
        }
      }
      setLoading(false);
    };
    fetchNote();
  }, [noteId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </View>
    );
  }

  if (!note) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Note not found</Text>
      </View>
    );
  }

  const cat = note.category ? categoryLabels[note.category] : null;
  const priorityStyle = note.priority === "high"
    ? { bg: "#DC26261A", color: "#DC2626", label: "High Priority" }
    : note.priority === "low"
    ? { bg: "#2563EB1A", color: "#2563EB", label: "Low Priority" }
    : { bg: "#6B72801A", color: "#6B7280", label: "Normal Priority" };
  const coords = note.location_text?.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
  const lng = coords?.[1];
  const lat = coords?.[2];

  return (
    <>
      <Stack.Screen options={{ title: "Target Note" }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>{note.title}</Text>

          <View style={styles.tags}>
            {cat && (
              <View style={[styles.tag, { backgroundColor: cat.color + "1A" }]}>
                <Text style={[styles.tagText, { color: cat.color }]}>{cat.label}</Text>
              </View>
            )}
            <View style={[styles.tag, { backgroundColor: priorityStyle.bg }]}>
              <Text style={[styles.tagText, { color: priorityStyle.color }]}>
                {priorityStyle.label}
              </Text>
            </View>
            {note.is_verified && (
              <View style={[styles.tag, { backgroundColor: colors.primary.DEFAULT + "1A" }]}>
                <Ionicons name="checkmark-circle" size={14} color={colors.primary.DEFAULT} />
                <Text style={[styles.tagText, { color: colors.primary.DEFAULT, marginLeft: 4 }]}>Verified</Text>
              </View>
            )}
          </View>
        </View>

        {note.description && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Description</Text>
            <Text style={styles.sectionText}>{note.description}</Text>
          </View>
        )}

        {lat && lng && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Location</Text>
            <View style={styles.coordRow}>
              <View style={styles.coordIcon}>
                <Ionicons name="location" size={20} color={colors.primary.DEFAULT} />
              </View>
              <View>
                <Text style={styles.coordLabel}>Coordinates</Text>
                <Text style={styles.coordText}>
                  {parseFloat(lat).toFixed(6)}, {parseFloat(lng).toFixed(6)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {note.photos && note.photos.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Photos ({note.photos.length})</Text>
            <PhotoViewer photos={note.photos} imageWidth={imageWidth} />
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  content: { padding: 16, paddingTop: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background.page },
  emptyText: { fontSize: 17, color: colors.text.body },
  card: {
    backgroundColor: colors.background.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.text.heading, marginBottom: 14, lineHeight: 28 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  tagText: { fontSize: 14, fontWeight: "600" },
  sectionLabel: {
    fontSize: 13, fontWeight: "700", color: colors.text.muted,
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10,
  },
  sectionText: { fontSize: 17, color: colors.text.heading, lineHeight: 26 },
  coordRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  coordIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: colors.primary.DEFAULT + "12",
    justifyContent: "center", alignItems: "center",
  },
  coordLabel: { fontSize: 13, color: colors.text.muted, marginBottom: 2 },
  coordText: { fontSize: 16, fontWeight: "600", color: colors.text.heading },
});
