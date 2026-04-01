import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import type { ProjectSite } from "@/types/project";

interface SitePickerProps {
  sites: ProjectSite[];
  selectedSiteId: string | null;
  onSelect: (siteId: string | null) => void;
}

export default function SitePicker({ sites, selectedSiteId, onSelect }: SitePickerProps) {
  const [visible, setVisible] = useState(false);

  if (sites.length <= 1) return null;

  const selected = sites.find((s) => s.id === selectedSiteId);
  const label = selected ? (selected.site_name || selected.site_code) : "All Sites";

  const options: Array<{ id: string | null; label: string }> = [
    { id: null, label: "All Sites" },
    ...sites.map((s) => ({ id: s.id, label: s.site_name || s.site_code })),
  ];

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>Site</Text>
      <TouchableOpacity
        style={styles.selector}
        activeOpacity={0.7}
        onPress={() => setVisible(true)}
      >
        <Ionicons name="location" size={18} color={colors.primary.DEFAULT} />
        <Text style={styles.selectorText} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-down" size={20} color={colors.text.muted} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Site</Text>
            <TouchableOpacity
              onPress={() => setVisible(false)}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color={colors.text.heading} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={options}
            keyExtractor={(item) => item.id ?? "all"}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const isSelected = item.id === selectedSiteId;
              return (
                <TouchableOpacity
                  style={[styles.option, isSelected && styles.optionSelected]}
                  activeOpacity={0.7}
                  onPress={() => {
                    onSelect(item.id);
                    setVisible(false);
                  }}
                >
                  <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                    {item.label}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark" size={22} color={colors.primary.DEFAULT} />
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.text.body,
    marginBottom: 6,
  },
  selector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.background.card,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    minHeight: 52,
  },
  selectorText: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: colors.text.heading,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background.page,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: colors.background.card,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text.heading,
  },
  list: {
    padding: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.background.card,
    borderRadius: 12,
    padding: 18,
    marginBottom: 8,
    minHeight: 56,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  optionSelected: {
    borderColor: colors.primary.DEFAULT,
    backgroundColor: colors.primary.DEFAULT + "08",
  },
  optionText: {
    fontSize: 17,
    color: colors.text.heading,
  },
  optionTextSelected: {
    fontWeight: "600",
    color: colors.primary.DEFAULT,
  },
});
