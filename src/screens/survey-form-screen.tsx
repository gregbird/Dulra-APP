import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import DynamicField from "@/components/dynamic-field";
import type { SurveyTemplate, TemplateSection, TemplateField, FormData } from "@/types/survey-template";
import { surveyTypeLabels } from "@/types/survey";

function SectionFields({
  fields,
  sectionId,
  formData,
  onFieldChange,
}: {
  fields: TemplateField[];
  sectionId: string;
  formData: FormData;
  onFieldChange: (sectionId: string, fieldKey: string, value: string | number | null) => void;
}) {
  const refs = useRef<Record<string, TextInput | null>>({});
  const focusable = fields.filter((f) => f.type === "text" || f.type === "number");

  const registerRef = (fieldId: string, el: TextInput | null) => {
    refs.current[fieldId] = el;
  };

  return (
    <View style={{ paddingHorizontal: 18, paddingBottom: 18, borderTopWidth: 1, borderTopColor: "#E5E7EB", paddingTop: 18 }}>
      {fields.map((field) => {
        const focusIdx = focusable.findIndex((f) => f.id === field.id);
        const nextFocus = focusIdx >= 0 ? focusable[focusIdx + 1] : undefined;

        return (
          <DynamicField
            key={field.id}
            field={field}
            value={formData[sectionId]?.[field.key] ?? null}
            onChange={(val) => onFieldChange(sectionId, field.key, val)}
            isLast={!nextFocus}
            onNext={nextFocus ? () => refs.current[nextFocus.id]?.focus() : undefined}
            registerRef={(el) => registerRef(field.id, el)}
          />
        );
      })}
    </View>
  );
}

export default function SurveyFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [template, setTemplate] = useState<SurveyTemplate | null>(null);
  const [surveyType, setSurveyType] = useState<string>("");
  const [formData, setFormData] = useState<FormData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const fetchSurveyAndTemplate = useCallback(async () => {
    if (!id) return;

    const { data: survey } = await supabase
      .from("surveys")
      .select("survey_type, weather, form_data")
      .eq("id", id)
      .single();

    if (!survey) return;
    setSurveyType(survey.survey_type);

    const { data: tmpl } = await supabase
      .from("survey_templates")
      .select("id, name, survey_type, is_active, default_fields")
      .eq("survey_type", survey.survey_type)
      .single();

    if (tmpl) {
      setTemplate(tmpl);
      const sections = tmpl.default_fields?.sections ?? [];
      setExpandedSections(new Set(sections.map((s: TemplateSection) => s.id)));

      const existing: FormData = {};
      if (survey.weather && typeof survey.weather === "object") {
        const w = survey.weather as Record<string, unknown>;
        const weatherFields = (w.templateFields ?? w) as Record<string, string | number | null>;
        existing["weather"] = weatherFields;
      }
      if (survey.form_data && typeof survey.form_data === "object") {
        Object.assign(existing, survey.form_data);
      }
      setFormData(existing);
    }
  }, [id]);

  useEffect(() => {
    fetchSurveyAndTemplate().finally(() => setLoading(false));
  }, [fetchSurveyAndTemplate]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const updateField = (sectionId: string, fieldKey: string, value: string | number | null) => {
    setFormData((prev) => ({
      ...prev,
      [sectionId]: {
        ...(prev[sectionId] ?? {}),
        [fieldKey]: value,
      },
    }));
  };

  const handleSave = async (markComplete: boolean) => {
    if (!id) return;
    setSaving(true);

    const allFields: Record<string, string | number | null> = {};
    for (const [, sectionValues] of Object.entries(formData)) {
      Object.assign(allFields, sectionValues);
    }

    const { error } = await supabase
      .from("surveys")
      .update({
        weather: { templateFields: allFields },
        form_data: formData,
        status: markComplete ? "completed" : "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    setSaving(false);

    if (error) {
      Alert.alert("Error", "Failed to save survey data.");
      return;
    }

    if (markComplete) {
      Alert.alert("Saved", "Survey completed successfully.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } else {
      Alert.alert("Saved", "Progress saved.");
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </View>
    );
  }

  const sections = template?.default_fields?.sections?.filter((s) => s.enabled) ?? [];
  const title = surveyTypeLabels[surveyType] ?? template?.name ?? "Survey";

  if (!template || sections.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <View style={styles.center}>
          <Ionicons name="construct-outline" size={48} color={colors.text.muted} />
          <Text style={styles.emptyTitle}>Coming Soon</Text>
          <Text style={styles.emptyText}>
            This survey type is not yet available on mobile.
          </Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {template.default_fields?.methodologyGuidance && (
            <View style={styles.guidanceCard}>
              <Ionicons name="information-circle-outline" size={20} color={colors.primary.DEFAULT} />
              <Text style={styles.guidanceText}>
                {template.default_fields.methodologyGuidance}
              </Text>
            </View>
          )}

          {sections.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            return (
              <View key={section.id} style={styles.section}>
                <TouchableOpacity
                  style={styles.sectionHeader}
                  activeOpacity={0.7}
                  onPress={() => toggleSection(section.id)}
                >
                  <View style={styles.sectionTitleRow}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    {section.description && (
                      <Text style={styles.sectionDesc} numberOfLines={1}>
                        {section.description}
                      </Text>
                    )}
                  </View>
                  <Ionicons
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={22}
                    color={colors.text.muted}
                  />
                </TouchableOpacity>

                {isExpanded && (
                  <SectionFields
                    fields={section.fields}
                    sectionId={section.id}
                    formData={formData}
                    onFieldChange={updateField}
                  />
                )}
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.saveButton}
            activeOpacity={0.8}
            disabled={saving}
            onPress={() => handleSave(false)}
          >
            {saving ? (
              <ActivityIndicator color={colors.primary.DEFAULT} />
            ) : (
              <Text style={styles.saveButtonText}>Save Progress</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.completeButton}
            activeOpacity={0.8}
            disabled={saving}
            onPress={() => handleSave(true)}
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.completeButtonText}>Complete Survey</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  center: {
    flex: 1, justifyContent: "center", alignItems: "center",
    backgroundColor: colors.background.page, gap: 12, padding: 32,
  },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: colors.text.heading },
  emptyText: { fontSize: 17, color: colors.text.body, textAlign: "center" },
  backButton: {
    marginTop: 8, paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 10, backgroundColor: colors.primary.DEFAULT + "15",
  },
  backButtonText: { fontSize: 16, fontWeight: "600", color: colors.primary.DEFAULT },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 140 },
  guidanceCard: {
    flexDirection: "row", gap: 10, backgroundColor: colors.primary.DEFAULT + "0D",
    borderRadius: 12, padding: 14, marginBottom: 16, alignItems: "flex-start",
  },
  guidanceText: { flex: 1, fontSize: 14, color: colors.text.body, lineHeight: 20 },
  section: {
    backgroundColor: colors.background.card, borderRadius: 14,
    marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 18, minHeight: 60,
  },
  sectionTitleRow: { flex: 1, marginRight: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: colors.text.heading },
  sectionDesc: { fontSize: 14, color: colors.text.muted, marginTop: 2 },
  footer: {
    flexDirection: "row", gap: 10, padding: 16,
    paddingBottom: 32, backgroundColor: colors.background.card,
    borderTopWidth: 1, borderTopColor: "#E5E7EB",
  },
  saveButton: {
    flex: 1, height: 52, borderRadius: 12, justifyContent: "center",
    alignItems: "center", borderWidth: 2, borderColor: colors.primary.DEFAULT,
  },
  saveButtonText: { fontSize: 16, fontWeight: "600", color: colors.primary.DEFAULT },
  completeButton: {
    flex: 1, height: 52, borderRadius: 12, justifyContent: "center",
    alignItems: "center", backgroundColor: colors.primary.DEFAULT,
  },
  completeButtonText: { fontSize: 16, fontWeight: "600", color: colors.white },
});
