import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "@/constants/colors";
import { nlcColorFor, NLC_FALLBACK_COLOR } from "@/lib/nlc-colors";
import type { NlcFeature } from "@/lib/nlc";

interface Props {
  feature: NlcFeature | null;
  onClose: () => void;
}

/**
 * Bottom sheet shown when the user taps an NLC reference parcel on the
 * map (z >= 16). Read-only — these are Esri reference data, not the
 * user's saved habitats. Same visual shape as HabitatMapModal /
 * DesignatedDetailModal so the three layer detail sheets feel
 * consistent. Web team confirmed during Phase 1 pre-flight that
 * level2Value / level2Id / area in ha are sufficient — no extra
 * fields surface in their popup either.
 */
export default function NlcDetailModal({ feature, onClose }: Props) {
  const colour = feature ? nlcColorFor(feature.level2Value) : NLC_FALLBACK_COLOR;
  const areaHa =
    feature?.area != null && Number.isFinite(feature.area)
      ? (feature.area / 10000).toFixed(2)
      : null;

  return (
    <Modal
      visible={!!feature}
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
                  {feature?.level2Id ?? "—"}
                </Text>
              </View>
              {areaHa != null && (
                <Text style={styles.area}>{areaHa} ha</Text>
              )}
            </View>

            <Text style={styles.title}>
              {feature?.level2Value ?? "Reference parcel"}
            </Text>

            {feature?.level1Value && (
              <Text style={styles.subtitle}>{feature.level1Value}</Text>
            )}

            <View style={styles.sourceRow}>
              <Text style={styles.sourceLabel}>NLC 2018</Text>
              <Text style={styles.sourceMuted}>· Tailte Éireann reference data</Text>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.buttonSecondary]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.buttonSecondaryText}>Close</Text>
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
    maxHeight: "55%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
    marginBottom: 8,
  },
  body: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
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
  subtitle: { fontSize: 14, color: colors.text.muted },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    gap: 4,
  },
  sourceLabel: { fontSize: 12, fontWeight: "700", color: colors.text.body, letterSpacing: 0.5 },
  sourceMuted: { fontSize: 12, color: colors.text.muted },
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
});
