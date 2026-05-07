import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import { BASE_MAPS, type BaseMapId } from "@/lib/map-layers";

interface Props {
  baseMap: BaseMapId;
  onSelectBaseMap: (id: BaseMapId) => void;
  townlandsEnabled: boolean;
  onToggleTownlands: (enabled: boolean) => void;
  /** Visibility is owned by the parent screen so the same button can also
   *  show an "active" indicator when overlays are on. */
  visible: boolean;
  onOpen: () => void;
  onClose: () => void;
}

const BASE_MAP_ORDER: BaseMapId[] = ["streets", "satellite", "hybrid", "topographic"];

/**
 * Top-left "Layers" button + the slide-up panel it triggers. The panel
 * is two sections — a single-select base map list and an independent
 * boundaries (Townlands) toggle — because Townlands isn't a base map and
 * needs to compose with whichever base the user has chosen.
 */
export default function MapLayersControl({
  baseMap,
  onSelectBaseMap,
  townlandsEnabled,
  onToggleTownlands,
  visible,
  onOpen,
  onClose,
}: Props) {
  return (
    <>
      <TouchableOpacity
        style={styles.fab}
        onPress={onOpen}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Map layers"
      >
        <Ionicons name="layers-outline" size={22} color={colors.text.heading} />
        {townlandsEnabled && <View style={styles.activeDot} />}
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        onRequestClose={onClose}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.sectionTitle}>Base Map</Text>
            <View style={styles.optionGroup}>
              {BASE_MAP_ORDER.map((id) => {
                const config = BASE_MAPS[id];
                const selected = baseMap === id;
                return (
                  <TouchableOpacity
                    key={id}
                    style={styles.option}
                    onPress={() => onSelectBaseMap(id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.radio, selected && styles.radioSelected]}>
                      {selected && <View style={styles.radioInner} />}
                    </View>
                    <Text style={[styles.optionLabel, selected && styles.optionLabelActive]}>
                      {config.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Boundaries</Text>
            <View style={styles.optionGroup}>
              <TouchableOpacity
                style={styles.option}
                onPress={() => onToggleTownlands(!townlandsEnabled)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, townlandsEnabled && styles.checkboxChecked]}>
                  {townlandsEnabled && (
                    <Ionicons name="checkmark" size={16} color={colors.white} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.optionLabel,
                      townlandsEnabled && styles.optionLabelActive,
                    ]}
                  >
                    Townlands
                  </Text>
                  <Text style={styles.optionHint}>Visible at zoom 12+</Text>
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.close} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.closeText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    top: 12,
    left: 12,
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.background.card,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 4,
  },
  activeDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#a855f7",
    borderWidth: 1,
    borderColor: colors.white,
  },
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
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text.muted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  sectionTitleSpaced: { marginTop: 16 },
  optionGroup: {
    backgroundColor: colors.background.page,
    borderRadius: 12,
    overflow: "hidden",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  optionLabel: { fontSize: 16, color: colors.text.body, fontWeight: "500" },
  optionLabelActive: { color: colors.text.heading, fontWeight: "600" },
  optionHint: { fontSize: 12, color: colors.text.muted, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  radioSelected: { borderColor: colors.primary.DEFAULT },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary.DEFAULT,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: colors.primary.DEFAULT,
    borderColor: colors.primary.DEFAULT,
  },
  close: {
    marginTop: 20,
    paddingVertical: 14,
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 12,
    alignItems: "center",
  },
  closeText: { color: colors.white, fontSize: 16, fontWeight: "600" },
});
