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
import { cacheTemplate, getCachedTemplates } from "@/lib/database";
import { useNetworkStore } from "@/lib/network";
import { FALLBACK_SURVEY_TYPES, type SurveyTemplate } from "@/types/survey-template";

const RELEVE_ENTRY: SurveyTemplate = {
  id: "releve_survey",
  name: "Relevé Survey",
  survey_type: "releve_survey",
  is_active: true,
  default_fields: { sections: [] },
};

/**
 * Merge DB templates with the fallback list so every known survey type
 * appears in the picker, even if the org's DB rows are missing.
 * DB rows win — fallback only fills gaps.
 */
function mergeWithFallback(dbList: SurveyTemplate[]): SurveyTemplate[] {
  const seen = new Set(dbList.map((t) => t.survey_type));
  const merged = [...dbList];
  for (const f of FALLBACK_SURVEY_TYPES) {
    if (!seen.has(f.survey_type)) merged.push(f);
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

interface SurveyTypePickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (template: SurveyTemplate) => void;
}

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

        const dbList = data ?? [];
        const withReleve = dbList.some((t) => t.survey_type === "releve_survey")
          ? dbList
          : [...dbList, RELEVE_ENTRY];
        setTemplates(mergeWithFallback(withReleve));
        for (const t of dbList) {
          await cacheTemplate({
            surveyType: t.survey_type,
            name: t.name,
            defaultFields: t.default_fields ?? {},
          });
        }
      } else {
        const cached = await getCachedTemplates();
        const list = cached.map((c) => ({
          id: c.survey_type,
          name: c.name,
          survey_type: c.survey_type,
          is_active: true,
          default_fields: JSON.parse(c.default_fields),
        }));
        const withReleve = list.some((t) => t.survey_type === "releve_survey")
          ? list
          : [...list, RELEVE_ENTRY];
        setTemplates(mergeWithFallback(withReleve));
      }

      setLoading(false);
    };

    fetchTemplates();
  }, [visible]);

  const hasForm = (t: SurveyTemplate) => {
    if (t.survey_type === "releve_survey") return true;
    const sections = t.default_fields?.sections;
    return Array.isArray(sections) && sections.length > 0;
  };

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
        ) : (
          <FlatList
            data={templates}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const available = hasForm(item);
              return (
                <TouchableOpacity
                  style={[styles.card, !available && styles.cardDisabled]}
                  activeOpacity={available ? 0.7 : 1}
                  onPress={() => {
                    if (available) onSelect(item);
                  }}
                >
                  <View style={styles.cardContent}>
                    <Text
                      style={[
                        styles.cardTitle,
                        !available && styles.cardTitleDisabled,
                      ]}
                    >
                      {item.name}
                    </Text>
                    {!available && (
                      <Text style={styles.cardSub}>Coming soon</Text>
                    )}
                  </View>
                  {available && (
                    <Ionicons
                      name="chevron-forward"
                      size={22}
                      color={colors.text.muted}
                    />
                  )}
                </TouchableOpacity>
              );
            }}
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
  cardDisabled: {
    opacity: 0.5,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text.heading,
  },
  cardTitleDisabled: {
    color: colors.text.muted,
  },
  cardSub: {
    fontSize: 14,
    color: colors.text.muted,
    marginTop: 2,
  },
});
