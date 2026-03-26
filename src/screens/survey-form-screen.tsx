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
import SurveyPhotos from "@/components/survey-photos";
import type { SurveyPhotosHandle } from "@/components/survey-photos";
import { getCachedTemplate, cacheTemplate, getCachedSurvey } from "@/lib/database";
import { saveSurvey } from "@/lib/survey-save";
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
  const params = useLocalSearchParams<{ id: string; projectId?: string; surveyType?: string }>();
  const router = useRouter();
  const isNew = params.id === "new";
  const [surveyId, setSurveyId] = useState<string | null>(isNew ? null : params.id);
  const [template, setTemplate] = useState<SurveyTemplate | null>(null);
  const [surveyType, setSurveyType] = useState<string>(params.surveyType ?? "");
  const [projectId, setProjectId] = useState<string>(params.projectId ?? "");
  const [projectName, setProjectName] = useState<string>("");
  const [formData, setFormData] = useState<FormData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const photosRef = useRef<SurveyPhotosHandle>(null);

  const loadTemplate = useCallback(async (type: string) => {
    try {
      const { data: tmpl, error: tmplError } = await supabase
        .from("survey_templates")
        .select("id, name, survey_type, is_active, default_fields")
        .eq("survey_type", type)
        .single();
      if (tmplError) throw tmplError;
      if (tmpl) {
        setTemplate(tmpl);
        const sections = tmpl.default_fields?.sections ?? [];
        setExpandedSections(new Set(sections.map((s: TemplateSection) => s.id)));
        await cacheTemplate({ surveyType: tmpl.survey_type, name: tmpl.name, defaultFields: tmpl.default_fields ?? {} });
      }
      return tmpl;
    } catch {
      const cached = await getCachedTemplate(type);
      if (cached) {
        const parsed = JSON.parse(cached.default_fields);
        const tmpl = { id: cached.survey_type, name: cached.name, survey_type: cached.survey_type, is_active: true, default_fields: parsed } as SurveyTemplate;
        setTemplate(tmpl);
        const sections = parsed?.sections ?? [];
        setExpandedSections(new Set(sections.map((s: TemplateSection) => s.id)));
        return tmpl;
      }
      return null;
    }
  }, []);

  const fetchExistingSurvey = useCallback(async () => {
    if (!surveyId) return;
    try {
      const { data: survey, error: surveyError } = await supabase
        .from("surveys")
        .select("survey_type, weather, form_data, project_id")
        .eq("id", surveyId)
        .single();
      if (surveyError) throw surveyError;
      if (!survey) return;
      setSurveyType(survey.survey_type);
      setProjectId(survey.project_id);

      const { data: proj } = await supabase
        .from("projects")
        .select("name")
        .eq("id", survey.project_id)
        .single();
      if (proj) setProjectName(proj.name);

      await loadTemplate(survey.survey_type);

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
    } catch {
      if (!surveyId) return;
      const cached = await getCachedSurvey(surveyId);
      if (cached) {
        setSurveyType(cached.survey_type);
        setProjectId(cached.project_id);
        await loadTemplate(cached.survey_type);
        const existing: FormData = {};
        if (cached.weather) {
          const w = JSON.parse(cached.weather);
          const weatherFields = (w.templateFields ?? w) as Record<string, string | number | null>;
          existing["weather"] = weatherFields;
        }
        if (cached.form_data) {
          Object.assign(existing, JSON.parse(cached.form_data));
        }
        setFormData(existing);
      }
    }
  }, [surveyId, loadTemplate]);

  useEffect(() => {
    const init = async () => {
      try {
        if (isNew && surveyType) {
          await loadTemplate(surveyType);
          if (params.projectId) {
            const { data: proj } = await supabase
              .from("projects")
              .select("name")
              .eq("id", params.projectId)
              .single();
            if (proj) setProjectName(proj.name);
          }
        } else if (surveyId) {
          await fetchExistingSurvey();
        }
      } catch { /* offline */ }
      setLoading(false);
    };
    init();
  }, []);
  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };
  const updateField = (sectionId: string, fieldKey: string, value: string | number | null) => {
    setFormData((prev) => ({ ...prev, [sectionId]: { ...(prev[sectionId] ?? {}), [fieldKey]: value } }));
  };

  const handleSave = async (markComplete: boolean) => {
    setSaving(true);
    const pendingUris = photosRef.current?.getPendingUris() ?? [];

    const result = await saveSurvey({
      surveyId, projectId, projectName, surveyType,
      formData, markComplete, pendingPhotoUris: pendingUris,
    });

    if (result.offline) {
      photosRef.current?.clearPending();
      setSaving(false);
      Alert.alert("Saved Offline", "Data saved locally. It will sync when you're back online.", [
        { text: "OK", onPress: () => router.back() },
      ]);
      return;
    }

    if (!result.success) {
      setSaving(false);
      Alert.alert("Error", result.error ?? "Failed to save survey.");
      return;
    }

    if (result.surveyId) setSurveyId(result.surveyId);
    photosRef.current?.clearPending(result.surveyId ?? undefined);
    setSaving(false);

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
          <Text style={styles.emptyText}>This survey type is not yet available on mobile.</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text></TouchableOpacity>
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

          <SurveyPhotos ref={photosRef} surveyId={surveyId} projectId={projectId} projectName={projectName} />

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
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background.page, gap: 12, padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: colors.text.heading },
  emptyText: { fontSize: 17, color: colors.text.body, textAlign: "center" },
  backButton: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primary.DEFAULT + "15" },
  backButtonText: { fontSize: 16, fontWeight: "600", color: colors.primary.DEFAULT },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 140 },
  guidanceCard: { flexDirection: "row", gap: 10, backgroundColor: colors.primary.DEFAULT + "0D", borderRadius: 12, padding: 14, marginBottom: 16, alignItems: "flex-start" },
  guidanceText: { flex: 1, fontSize: 14, color: colors.text.body, lineHeight: 20 },
  section: { backgroundColor: colors.background.card, borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18, minHeight: 60 },
  sectionTitleRow: { flex: 1, marginRight: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: colors.text.heading },
  sectionDesc: { fontSize: 14, color: colors.text.muted, marginTop: 2 },
  footer: { flexDirection: "row", gap: 10, padding: 16, paddingBottom: 32, backgroundColor: colors.background.card, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  saveButton: { flex: 1, height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", borderWidth: 2, borderColor: colors.primary.DEFAULT },
  saveButtonText: { fontSize: 16, fontWeight: "600", color: colors.primary.DEFAULT },
  completeButton: { flex: 1, height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", backgroundColor: colors.primary.DEFAULT },
  completeButtonText: { fontSize: 16, fontWeight: "600", color: colors.white },
});
