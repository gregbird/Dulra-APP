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
import SurveyorPicker from "@/components/surveyor-picker";
import { getCachedTemplate, cacheTemplate, getCachedSurvey, getCachedProjects } from "@/lib/database";
import { saveSurvey } from "@/lib/survey-save";
import type { SurveyTemplate, TemplateSection, TemplateField, FormData } from "@/types/survey-template";
import { surveyTypeLabels } from "@/types/survey";
import { useDevEventStore } from "@/lib/dev-events";
import { generateTestFormData } from "@/lib/dev-fill-data";
import { useNetworkStore } from "@/lib/network";
import {
  loadAllVisitSurveysForProject,
  type VisitSurveyLike,
} from "@/lib/visit-groups";
import VisitsCard from "@/components/visits-card";

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
  const params = useLocalSearchParams<{ id: string; projectId?: string; surveyType?: string; siteId?: string }>();
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
  const [surveyorId, setSurveyorId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  // Visit grouping state. groupSurveys = all surveys in the project so the
  // gating logic and accordion can derive their views from a single source
  // — refreshed when the form first loads and after every save.
  const [groupSurveys, setGroupSurveys] = useState<VisitSurveyLike[]>([]);
  const [visitGroupId, setVisitGroupId] = useState<string | null>(null);
  const [visitNumber, setVisitNumber] = useState<number | null>(null);
  const photosRef = useRef<SurveyPhotosHandle>(null);

  const loadTemplate = useCallback(async (type: string) => {
    const readCache = async (): Promise<SurveyTemplate | null> => {
      const cached = await getCachedTemplate(type);
      if (!cached) return null;
      const parsed = JSON.parse(cached.default_fields);
      const tmpl = { id: cached.survey_type, name: cached.name, survey_type: cached.survey_type, is_active: true, default_fields: parsed } as SurveyTemplate;
      setTemplate(tmpl);
      const sections = parsed?.sections ?? [];
      setExpandedSections(new Set(sections.map((s: TemplateSection) => s.id)));
      return tmpl;
    };
    if (!useNetworkStore.getState().isOnline) return readCache();
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
      return readCache();
    }
  }, []);

  const restoreFromCached = useCallback(async (): Promise<boolean> => {
    if (!surveyId) return false;
    const cached = await getCachedSurvey(surveyId);
    if (!cached) return false;
    if (cached.survey_type === "releve_survey") {
      router.replace(`/releve-survey/${surveyId}?projectId=${cached.project_id}`);
      return true;
    }
    setSurveyType(cached.survey_type);
    setProjectId(cached.project_id);
    const cachedProjects = await getCachedProjects();
    const proj = cachedProjects.find((p) => p.id === cached.project_id);
    if (proj) setProjectName(proj.name);
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
    // Visit grouping fields live on the cached row from v12 onward; older
    // installs serve null which renders this survey as standalone.
    const c = cached as unknown as { visit_group_id?: string | null; visit_number?: number | null };
    setVisitGroupId(c.visit_group_id ?? null);
    setVisitNumber(c.visit_number ?? null);
    return true;
  }, [surveyId, loadTemplate, router]);

  const fetchExistingSurvey = useCallback(async () => {
    if (!surveyId) return;
    if (!useNetworkStore.getState().isOnline) {
      await restoreFromCached();
      return;
    }
    try {
      const { data: survey, error: surveyError } = await supabase
        .from("surveys")
        .select("survey_type, weather, form_data, project_id, visit_group_id, visit_number")
        .eq("id", surveyId)
        .single();
      if (surveyError) throw surveyError;
      if (!survey) return;

      if (survey.survey_type === "releve_survey") {
        router.replace(`/releve-survey/${surveyId}?projectId=${survey.project_id}`);
        return;
      }

      setSurveyType(survey.survey_type);
      setProjectId(survey.project_id);
      setVisitGroupId((survey.visit_group_id as string | null) ?? null);
      setVisitNumber((survey.visit_number as number | null) ?? null);

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
      await restoreFromCached();
    }
  }, [surveyId, loadTemplate, restoreFromCached, router]);

  // Refresh the cached + pending visit graph for the project. Runs after
  // initial load and whenever we navigate back to this screen so a recent
  // Add Visit / save reflects in the accordion without a full reload.
  const refreshGroupSurveys = useCallback(async (pid: string) => {
    if (!pid) return;
    try {
      const all = await loadAllVisitSurveysForProject(pid);
      setGroupSurveys(all);
    } catch { /* swallow — accordion just shows empty */ }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const online = useNetworkStore.getState().isOnline;
        // Session from SecureStore — never hits the network.
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          setCurrentUserId(session.user.id);
          if (online) {
            try {
              const { data: profile } = await supabase
                .from("profiles")
                .select("full_name")
                .eq("id", session.user.id)
                .single();
              if (profile?.full_name) setCurrentUserName(profile.full_name);
            } catch { /* fall through — picker shows "Me" */ }
          }
        }

        if (isNew && surveyType) {
          await loadTemplate(surveyType);
          if (params.projectId) {
            if (online) {
              try {
                const { data: proj } = await supabase
                  .from("projects")
                  .select("name")
                  .eq("id", params.projectId)
                  .single();
                if (proj) setProjectName(proj.name);
              } catch { /* fall through to cache */ }
            }
            if (!projectName) {
              const cachedProjects = await getCachedProjects();
              const proj = cachedProjects.find((p) => p.id === params.projectId);
              if (proj) setProjectName(proj.name);
            }
          }
        } else if (surveyId) {
          await fetchExistingSurvey();
        }
      } catch { /* offline */ }
      setLoading(false);
    };
    init();
  }, []);

  // Visit graph load. Runs after projectId is resolved (via init or
  // restoreFromCached). Independent from the form-data load so a slow
  // accordion fetch never blocks the form from rendering.
  useEffect(() => {
    if (projectId) {
      refreshGroupSurveys(projectId);
    }
  }, [projectId, refreshGroupSurveys]);

  const fillToken = useDevEventStore((s) => s.fillToken);
  const clearFillToken = useDevEventStore((s) => s.clearFillToken);
  useEffect(() => {
    if (!__DEV__ || fillToken == null || !template) return;
    setFormData((prev) => ({ ...prev, ...generateTestFormData(template) }));
    clearFillToken();
  }, [fillToken, template, clearFillToken]);

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
      siteId: params.siteId ?? null,
      surveyorId,
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

    // Refresh the accordion: completing this visit may flip the all-completed
    // gate that hides the Add Visit button.
    if (projectId) refreshGroupSurveys(projectId);

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
        <Stack.Screen
          options={{
            title,
            headerLeft: () => (
              <TouchableOpacity
                onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="chevron-back" size={28} color={colors.primary.DEFAULT} />
              </TouchableOpacity>
            ),
          }}
        />
        <View style={styles.center}>
          <Ionicons name="construct-outline" size={48} color={colors.text.muted} />
          <Text style={styles.emptyTitle}>Coming Soon</Text>
          <Text style={styles.emptyText}>This survey type is not yet available on mobile.</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")}>
            <Text style={styles.backButtonText}>Go Back</Text></TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={28} color={colors.primary.DEFAULT} />
            </TouchableOpacity>
          ),
        }}
      />
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

          <SurveyorPicker
            value={surveyorId}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onChange={(userId) => setSurveyorId(userId)}
          />

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

          {/* Visit grouping: only meaningful for an existing survey (the
              parent of any future Add Visit). New-survey path skips this
              entirely — the row needs to be saved first. */}
          {!isNew && surveyId && (
            <VisitsCard
              surveyId={surveyId}
              projectId={projectId}
              groupId={visitGroupId}
              currentVisitNumber={visitNumber}
              groupSurveys={groupSurveys}
              siteId={params.siteId ?? null}
            />
          )}
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
