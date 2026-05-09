import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import { BASE_MAPS, type BaseMapId } from "@/lib/map-layers";

interface Props {
  baseMap: BaseMapId;
  onSelectBaseMap: (id: BaseMapId) => void;
  townlandsEnabled: boolean;
  onToggleTownlands: (enabled: boolean) => void;
  /** Habitats toggle. Optional so callers that don't render survey-data
   *  layers (e.g. the preview map on the project detail card) can omit
   *  the prop entirely — the Survey Layers section is hidden when no
   *  toggle handler is supplied. */
  habitatsEnabled?: boolean;
  onToggleHabitats?: (enabled: boolean) => void;
  /** NLC reference layer toggle (z >= 16). Independent of habitats —
   *  parity with web's separate NLC button. Optional like the habitats
   *  pair so the preview map can omit it. */
  nlcEnabled?: boolean;
  onToggleNlc?: (enabled: boolean) => void;
  /** Aquatic features overlay toggle (EPA water bodies + catchments).
   *  Mutually exclusive with habitats and NLC — the parent screen's
   *  handler enforces the mutex. Optional so preview maps can omit. */
  aquaticEnabled?: boolean;
  onToggleAquatic?: (enabled: boolean) => void;
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
  habitatsEnabled,
  onToggleHabitats,
  nlcEnabled,
  onToggleNlc,
  aquaticEnabled,
  onToggleAquatic,
  visible,
  onOpen,
  onClose,
}: Props) {
  // Active dot lights up if any non-default overlay is on. Townlands,
  // Habitats and Aquatic default off; NLC defaults on so we don't dot
  // for it until the user explicitly turns it off and back on (showing
  // it's user-controlled state).
  const hasActiveOverlay = townlandsEnabled || !!habitatsEnabled || !!aquaticEnabled;
  const showSurveyLayers = !!onToggleHabitats;
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
        {hasActiveOverlay && <View style={styles.activeDot} />}
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

            {/* Survey-derived overlays. "Boundaries" above is administrative
                geography; this group is data your team has captured —
                habitats now, additional layers (target notes, releve plots)
                later. Keeping the two groups separate matches the web's
                pill grouping and makes the toggle easy to find. Hidden
                entirely on screens that don't surface survey data
                (e.g. the project-detail preview map). */}
            {showSurveyLayers && (
              <>
                <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Survey Layers</Text>
                <View style={styles.optionGroup}>
                  <TouchableOpacity
                    style={styles.option}
                    onPress={() => onToggleHabitats?.(!habitatsEnabled)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, habitatsEnabled && styles.checkboxChecked]}>
                      {habitatsEnabled && (
                        <Ionicons name="checkmark" size={16} color={colors.white} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.optionLabel,
                          habitatsEnabled && styles.optionLabelActive,
                        ]}
                      >
                        Habitats
                      </Text>
                      <Text style={styles.optionHint}>FOSSITT-coloured polygons from field surveys</Text>
                    </View>
                  </TouchableOpacity>
                  {onToggleNlc && (
                    <TouchableOpacity
                      style={styles.option}
                      onPress={() => onToggleNlc(!nlcEnabled)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.checkbox, nlcEnabled && styles.checkboxChecked]}>
                        {nlcEnabled && (
                          <Ionicons name="checkmark" size={16} color={colors.white} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.optionLabel,
                            nlcEnabled && styles.optionLabelActive,
                          ]}
                        >
                          NLC reference
                        </Text>
                        <Text style={styles.optionHint}>National Land Cover 2018 parcels (zoom 16+)</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                  {onToggleAquatic && (
                    <TouchableOpacity
                      style={styles.option}
                      onPress={() => onToggleAquatic(!aquaticEnabled)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.checkbox, aquaticEnabled && styles.checkboxChecked]}>
                        {aquaticEnabled && (
                          <Ionicons name="checkmark" size={16} color={colors.white} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.optionLabel,
                            aquaticEnabled && styles.optionLabelActive,
                          ]}
                        >
                          Aquatic features
                        </Text>
                        <Text style={styles.optionHint}>EPA water bodies and catchments — hides Habitats and NLC</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

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
