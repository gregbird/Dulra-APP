import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import { getCachedTargetNote, cacheTargetNote } from "@/lib/database";
import { useNetworkStore } from "@/lib/network";
import { getLocation } from "@/lib/location";
import { categoryLabels } from "@/types/habitat";
import PhotoViewer from "@/components/photo-viewer";

interface NoteDetail {
  id: string;
  project_id: string;
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
  const router = useRouter();
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingLocation, setUpdatingLocation] = useState(false);
  const isOnline = useNetworkStore((s) => s.isOnline);

  const handleUpdateLocation = () => {
    if (!note) return;
    if (!isOnline) {
      Alert.alert(
        "Internet Required",
        "Connect to the internet to update this target note's location.",
      );
      return;
    }
    Alert.alert(
      "Update Location",
      "Replace this target note's location with your current GPS reading?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Update",
          onPress: async () => {
            setUpdatingLocation(true);
            try {
              const fresh = await getLocation({ maxAgeMs: 0 });
              if (!fresh) {
                Alert.alert(
                  "Location Unavailable",
                  "Could not capture GPS. Check that location is enabled in Settings and try again outdoors.",
                );
                return;
              }
              const wkt = `SRID=4326;POINT(${fresh.lng} ${fresh.lat})`;
              const { error } = await supabase
                .from("target_notes")
                .update({ location: wkt })
                .eq("id", note.id);
              if (error) throw error;

              const newLocationText = `POINT(${fresh.lng} ${fresh.lat})`;
              setNote((prev) => (prev ? { ...prev, location_text: newLocationText } : prev));

              // Refresh the cache row so an offline reopen still shows the
              // new location. Pull the existing cache (SELECT * — site_id is
              // returned at runtime even though the typed shape omits it) to
              // preserve fields the detail screen doesn't track.
              const cached = await getCachedTargetNote(note.id);
              const existingSiteId =
                cached && typeof (cached as Record<string, unknown>).site_id === "string"
                  ? ((cached as Record<string, unknown>).site_id as string)
                  : null;
              await cacheTargetNote({
                id: note.id,
                projectId: note.project_id,
                category: note.category,
                title: note.title,
                description: note.description,
                priority: note.priority,
                isVerified: note.is_verified,
                locationText: newLocationText,
                photos: note.photos ?? null,
                siteId: existingSiteId,
              });
            } catch {
              Alert.alert(
                "Update Failed",
                "Could not save the new location to the server. Please try again.",
              );
            } finally {
              setUpdatingLocation(false);
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    const fetchNote = async () => {
      if (!noteId) return;
      try {
        const { data, error } = await supabase
          .from("target_notes")
          .select("id, project_id, category, title, description, priority, is_verified, photos, location")
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
            id: cached.id, project_id: cached.project_id, category: cached.category, title: cached.title,
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
      <Stack.Screen
        options={{
          title: "Target Note",
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace(`/project/${note.project_id}/target-notes`);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={28} color={colors.primary.DEFAULT} />
            </TouchableOpacity>
          ),
        }}
      />
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

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Location</Text>
          {lat && lng ? (
            <View style={styles.coordRow}>
              <View style={styles.coordIcon}>
                <Ionicons name="location" size={20} color={colors.primary.DEFAULT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.coordLabel}>Coordinates</Text>
                <Text style={styles.coordText}>
                  {parseFloat(lat).toFixed(6)}, {parseFloat(lng).toFixed(6)}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.noLocationText}>No location recorded yet.</Text>
          )}
          <TouchableOpacity
            style={[
              styles.updateLocationBtn,
              (!isOnline || updatingLocation) && styles.updateLocationBtnDisabled,
            ]}
            activeOpacity={0.7}
            onPress={handleUpdateLocation}
            disabled={updatingLocation}
          >
            {updatingLocation ? (
              <ActivityIndicator size="small" color={colors.primary.DEFAULT} />
            ) : (
              <Ionicons name="refresh" size={18} color={colors.primary.DEFAULT} />
            )}
            <Text style={styles.updateLocationBtnText}>
              {updatingLocation
                ? "Updating..."
                : lat && lng
                ? "Update Location"
                : "Capture Location"}
            </Text>
          </TouchableOpacity>
          {!isOnline && (
            <Text style={styles.offlineHint}>Internet required to update location.</Text>
          )}
        </View>

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
  noLocationText: { fontSize: 15, color: colors.text.muted, fontStyle: "italic" },
  updateLocationBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 14, paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary.DEFAULT,
    backgroundColor: colors.primary.DEFAULT + "08",
    minHeight: 48,
  },
  updateLocationBtnDisabled: { opacity: 0.55 },
  updateLocationBtnText: { fontSize: 15, fontWeight: "600", color: colors.primary.DEFAULT },
  offlineHint: { fontSize: 13, color: colors.status.atRisk, marginTop: 8, textAlign: "center" },
});
