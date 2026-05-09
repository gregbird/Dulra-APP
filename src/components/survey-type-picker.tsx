import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import {
  getCachedTemplates,
  replaceCachedTemplates,
} from "@/lib/database";
import { useNetworkStore } from "@/lib/network";
import type { SurveyTemplate } from "@/types/survey-template";

interface SurveyTypePickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (template: SurveyTemplate) => void;
}

/**
 * Survey-type picker. Source of truth is `survey_templates.is_active`
 * toggled per-org from web Settings → Survey Templates: only rows with
 * `is_active = true` for the user's org appear here. Mobile is
 * read-only — there is no "Coming soon" placeholder, no hardcoded
 * fallback list, and no Relevé hardcoded inject. If a type isn't in
 * the active set, the org admin has disabled it and the surveyor
 * shouldn't see it at all.
 */
export default function SurveyTypePicker({
  visible,
  onClose,
  onSelect,
}: SurveyTypePickerProps) {
  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;

    const fetchTemplates = async () => {
      setLoading(true);
      const isOnline = useNetworkStore.getState().isOnline;

      if (isOnline) {
        const { data } = await supabase
          .from("survey_templates")
          .select("id, name, survey_type, is_active, default_fields")
          .eq("is_active", true)
          .order("name");

        const list = (data ?? []) as SurveyTemplate[];
        setTemplates(list);
        // Replace the local cache wholesale. Per-row INSERT OR REPLACE
        // would leave orphans for any type the admin just disabled —
        // those rows would persist in cached_templates and re-surface
        // the next time the picker opens offline. The replace helper
        // wraps DELETE + INSERT in one transaction so the offline
        // path always mirrors the latest active set.
        await replaceCachedTemplates(
          list.map((t) => ({
            surveyType: t.survey_type,
            name: t.name,
            defaultFields: t.default_fields ?? { sections: [] },
          })),
        );
      } else {
        const cached = await getCachedTemplates();
        const list: SurveyTemplate[] = cached.map((c) => ({
          id: c.survey_type,
          name: c.name,
          survey_type: c.survey_type,
          is_active: true,
          default_fields: JSON.parse(c.default_fields),
        }));
        setTemplates(list);
      }

      setLoading(false);
    };

    fetchTemplates();
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Select Survey Type</Text>
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={24} color={colors.text.heading} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
          </View>
        ) : templates.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="information-circle-outline" size={32} color={colors.text.muted} />
            <Text style={styles.emptyTitle}>No survey types available</Text>
            <Text style={styles.emptyBody}>Ask your admin to enable one in web Settings.</Text>
          </View>
        ) : (
          <FlatList
            data={templates}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => onSelect(item)}
              >
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={22}
                  color={colors.text.muted}
                />
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.page,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: colors.background.card,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text.heading,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text.body,
    marginTop: 8,
  },
  emptyBody: {
    fontSize: 14,
    color: colors.text.muted,
    textAlign: "center",
  },
  list: {
    padding: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.background.card,
    borderRadius: 14,
    padding: 18,
    marginBottom: 8,
    minHeight: 60,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text.heading,
  },
});
