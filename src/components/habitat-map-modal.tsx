import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import { conditionColors, UNCLASSIFIED_HABITAT_COLOR, type HabitatPolygon } from "@/types/habitat";
import { getFossittColor } from "@/lib/fossitt-utils";

interface Props {
  habitat: HabitatPolygon | null;
  onClose: () => void;
}

/**
 * Bottom sheet shown when the user taps a habitat polygon on the map.
 * Compact summary + a "View Details" button that hops to the existing
 * habitat detail screen — keeps the map flow fast while preserving the
 * rich detail screen for deeper inspection. Same modal pattern as
 * DesignatedDetailModal so the two layers feel familiar.
 */
export default function HabitatMapModal({ habitat, onClose }: Props) {
  const router = useRouter();
  const code = habitat?.fossitt_code ?? null;
  const colour = code ? getFossittColor(code) : UNCLASSIFIED_HABITAT_COLOR;
  const cond = habitat?.condition ? conditionColors[habitat.condition] : null;
  const evaluation = habitat?.evaluation;

  const goDetail = () => {
    if (!habitat) return;
    onClose();
    router.push(`/habitat/${habitat.id}`);
  };

  return (
    <Modal
      visible={!!habitat}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
          >
            <View style={styles.header}>
              <View
                style={[
                  styles.codeBadge,
                  { backgroundColor: `${colour}22`, borderColor: `${colour}55` },
                ]}
              >
                <View style={[styles.codeDot, { backgroundColor: colour }]} />
                <Text style={[styles.codeText, { color: colour }]}>
                  {code ?? "Unclassified"}
                </Text>
              </View>
              {habitat?.area_hectares != null && (
                <Text style={styles.area}>{habitat.area_hectares} ha</Text>
              )}
            </View>

            <Text style={styles.title}>{habitat?.fossitt_name ?? "Habitat"}</Text>

            <View style={styles.tagRow}>
              {cond && (
                <View style={[styles.tag, { backgroundColor: `${cond.color}1A` }]}>
                  <Text style={[styles.tagText, { color: cond.color }]}>{cond.label}</Text>
                </View>
              )}
              {evaluation && (
                <View style={[styles.tag, { backgroundColor: "#6B72801A" }]}>
                  <Text style={[styles.tagText, { color: "#6B7280" }]}>{evaluation}</Text>
                </View>
              )}
              {habitat?.eu_annex_code && (
                <View style={[styles.tag, { backgroundColor: "#2563EB1A" }]}>
                  <Text style={[styles.tagText, { color: "#2563EB" }]}>
                    EU {habitat.eu_annex_code}
                  </Text>
                </View>
              )}
            </View>

            {habitat?.notes && (
              <Text style={styles.notes} numberOfLines={4}>
                {habitat.notes}
              </Text>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.buttonSecondary]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.buttonSecondaryText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary]}
              onPress={goDetail}
              activeOpacity={0.7}
            >
              <Ionicons name="open-outline" size={18} color={colors.white} />
              <Text style={styles.buttonPrimaryText}>View Details</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.background.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingBottom: 20,
    maxHeight: "65%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
    marginBottom: 8,
  },
  body: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  codeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  codeDot: { width: 10, height: 10, borderRadius: 5 },
  codeText: { fontSize: 14, fontWeight: "700", letterSpacing: 0.3 },
  area: { fontSize: 15, color: colors.text.muted, fontWeight: "600" },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text.heading,
    marginTop: 4,
  },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 13, fontWeight: "600" },
  notes: {
    fontSize: 15,
    color: colors.text.body,
    lineHeight: 22,
    marginTop: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
  },
  buttonSecondary: {
    backgroundColor: colors.background.page,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  buttonSecondaryText: { color: colors.text.heading, fontSize: 16, fontWeight: "600" },
  buttonPrimary: { backgroundColor: colors.primary.DEFAULT },
  buttonPrimaryText: { color: colors.white, fontSize: 16, fontWeight: "600" },
});
