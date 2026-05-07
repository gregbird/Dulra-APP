import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import type { TownlandFeature } from "@/lib/townlands";

const TOWNLANDS_STROKE = "#a855f7";

interface Props {
  feature: TownlandFeature | null;
  onClose: () => void;
}

/**
 * Bottom-sheet info card for a tapped townland polygon. Townlands are
 * reference data — there's no rich content to surface, so we keep this
 * terser than the designated-site modal: bilingual name, area in hectares,
 * and Tailte Éireann attribution. Fast to dismiss while the user is
 * panning around inspecting boundaries.
 */
export default function TownlandDetailModal({ feature, onClose }: Props) {
  const englishName = feature?.englishName ?? "Townland";
  const gaelicName = feature?.gaelicName ?? null;
  const areaHa = feature?.areaHa ?? null;
  return (
    <Modal
      visible={!!feature}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop the sheet from forwarding taps to the backdrop, which would
            dismiss the modal on every body interaction. */}
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.body}>
            <View style={styles.badge}>
              <View style={styles.badgeDot} />
              <Text style={styles.badgeText}>TOWNLAND</Text>
            </View>
            <Text style={styles.title}>{englishName}</Text>
            {gaelicName && <Text style={styles.subtitle}>{gaelicName}</Text>}
            {areaHa != null && (
              <View style={styles.areaRow}>
                <Ionicons name="resize-outline" size={16} color={colors.text.muted} />
                <Text style={styles.areaText}>{areaHa.toFixed(1)} ha</Text>
              </View>
            )}
            <Text style={styles.attribution}>© Tailte Éireann (CC-BY 4.0)</Text>
          </View>
          <TouchableOpacity style={styles.close} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.background.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingBottom: 24,
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
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: `${TOWNLANDS_STROKE}22`,
    borderColor: TOWNLANDS_STROKE,
    alignSelf: "flex-start",
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: TOWNLANDS_STROKE },
  badgeText: { fontSize: 13, fontWeight: "700", letterSpacing: 0.3, color: TOWNLANDS_STROKE },
  title: { fontSize: 20, fontWeight: "700", color: colors.text.heading, marginTop: 4 },
  subtitle: { fontSize: 14, color: colors.text.muted },
  areaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  areaText: { fontSize: 14, color: colors.text.body },
  attribution: { fontSize: 11, color: colors.text.muted, marginTop: 16, fontStyle: "italic" },
  close: {
    marginTop: 12,
    marginHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 12,
    alignItems: "center",
  },
  closeText: { color: colors.white, fontSize: 16, fontWeight: "600" },
});
