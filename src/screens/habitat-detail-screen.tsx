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
import { conditionColors } from "@/types/habitat";
import type { HabitatPolygon } from "@/types/habitat";
import PhotoViewer from "@/components/photo-viewer";

const cardPadding = 20;
const screenPadding = 16;
const cardBorder = 2;
const imageWidth = Dimensions.get("window").width - (screenPadding * 2) - (cardPadding * 2) - cardBorder;

export default function HabitatDetailScreen() {
  const { habitatId } = useLocalSearchParams<{ habitatId: string }>();
  const [habitat, setHabitat] = useState<HabitatPolygon | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      if (!habitatId) return;
      try {
        const { data } = await supabase
          .from("habitat_polygons")
          .select("id, project_id, fossitt_code, fossitt_name, area_hectares, condition, notes, eu_annex_code, survey_method, evaluation, listed_species, threats, photos")
          .eq("id", habitatId)
          .single();
        if (data) setHabitat(data);
      } catch {
        /* offline */
      }
      setLoading(false);
    };
    fetch();
  }, [habitatId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </View>
    );
  }

  if (!habitat) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Habitat not found</Text>
      </View>
    );
  }

  const cond = habitat.condition ? conditionColors[habitat.condition] : null;

  return (
    <>
      <Stack.Screen options={{ title: habitat.fossitt_name ?? "Habitat" }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            {habitat.fossitt_code && (
              <View style={styles.codeBadge}>
                <Text style={styles.codeText}>{habitat.fossitt_code}</Text>
              </View>
            )}
            <Text style={styles.title}>{habitat.fossitt_name ?? "Unknown"}</Text>
          </View>

          <View style={styles.tags}>
            {cond && (
              <View style={[styles.tag, { backgroundColor: cond.color + "1A" }]}>
                <Text style={[styles.tagText, { color: cond.color }]}>{cond.label}</Text>
              </View>
            )}
            {habitat.eu_annex_code && (
              <View style={[styles.tag, { backgroundColor: "#2563EB1A" }]}>
                <Text style={[styles.tagText, { color: "#2563EB" }]}>EU {habitat.eu_annex_code}</Text>
              </View>
            )}
            {habitat.evaluation && (
              <View style={[styles.tag, { backgroundColor: "#6B72801A" }]}>
                <Text style={[styles.tagText, { color: "#6B7280" }]}>{habitat.evaluation}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.infoGrid}>
            {habitat.area_hectares != null && (
              <InfoItem icon="resize-outline" label="Area" value={`${habitat.area_hectares} ha`} />
            )}
            {habitat.survey_method && (
              <InfoItem icon="compass-outline" label="Method" value={habitat.survey_method} />
            )}
          </View>
        </View>

        {habitat.notes && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.sectionText}>{habitat.notes}</Text>
          </View>
        )}

        {habitat.listed_species && habitat.listed_species.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Listed Species</Text>
            {habitat.listed_species.map((s, i) => (
              <View key={i} style={styles.listItem}>
                <View style={styles.bullet} />
                <Text style={styles.listText}>{s}</Text>
              </View>
            ))}
          </View>
        )}

        {habitat.threats && habitat.threats.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Threats</Text>
            {habitat.threats.map((t, i) => (
              <View key={i} style={styles.listItem}>
                <Ionicons name="warning-outline" size={16} color={colors.status.atRisk} />
                <Text style={styles.listText}>{t}</Text>
              </View>
            ))}
          </View>
        )}

        {habitat.photos && habitat.photos.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Photos ({habitat.photos.length})</Text>
            <PhotoViewer photos={habitat.photos} imageWidth={imageWidth} />
          </View>
        )}
      </ScrollView>
    </>
  );
}

function InfoItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={colors.primary.DEFAULT} />
      </View>
      <View>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  content: { padding: 16, paddingTop: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background.page },
  emptyText: { fontSize: 17, color: colors.text.body },
  card: {
    backgroundColor: colors.background.card,
    borderRadius: 16, padding: 20, marginBottom: 12,
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  codeBadge: {
    backgroundColor: colors.primary.DEFAULT + "15",
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
  },
  codeText: { fontSize: 18, fontWeight: "700", color: colors.primary.dark },
  title: { fontSize: 22, fontWeight: "700", color: colors.text.heading, flex: 1, lineHeight: 28 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  tagText: { fontSize: 14, fontWeight: "600" },
  infoGrid: { flexDirection: "row", gap: 24 },
  infoItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: colors.primary.DEFAULT + "12",
    justifyContent: "center", alignItems: "center",
  },
  infoLabel: { fontSize: 13, color: colors.text.muted, marginBottom: 2 },
  infoValue: { fontSize: 16, fontWeight: "600", color: colors.text.heading },
  sectionLabel: {
    fontSize: 13, fontWeight: "700", color: colors.text.muted,
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10,
  },
  sectionText: { fontSize: 17, color: colors.text.heading, lineHeight: 26 },
  listItem: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text.body },
  listText: { fontSize: 16, color: colors.text.heading },
});
