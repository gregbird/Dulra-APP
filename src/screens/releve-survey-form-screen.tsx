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
import { colors } from "@/constants/colors";
import { RELEVE_SECTIONS } from "@/constants/releve-data";
import type { FieldDef } from "@/constants/releve-data";
import SurveyPhotos from "@/components/survey-photos";
import type { SurveyPhotosHandle } from "@/components/survey-photos";
import SelectModal from "@/components/select-modal";
import HabitatPicker, { FOSSITT_LEVEL3 } from "@/components/habitat-picker";
import SpeciesRow from "@/components/species-row";
import { saveSurvey } from "@/lib/survey-save";
import { getReleveDefaults } from "@/lib/releve-save";
import { getCachedSurvey, getCachedProjects, getPendingSurveyByRemoteId, cacheSurvey, getCachedProjectSites } from "@/lib/database";
import type { FormData } from "@/types/survey-template";
import type { ReleveSpeciesEntry } from "@/types/releve";

/* ── Main screen ────────────────────────────────────────────── */

export default function ReleveSurveyFormScreen() {
  const params = useLocalSearchParams<{ id: string; projectId?: string; siteId?: string }>();
  const router = useRouter();
  const isNew = params.id === "new";
  const [surveyId, setSurveyId] = useState<string | null>(isNew ? null : params.id);
  const [projectId, setProjectId] = useState(params.projectId ?? "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [formData, setFormData] = useState<FormData>({});
  const [species, setSpecies] = useState<ReleveSpeciesEntry[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["basic"]));
  const [activeSelect, setActiveSelect] = useState<{ sectionId: string; field: FieldDef } | null>(null);
  const [showHabitatPicker, setShowHabitatPicker] = useState(false);
  const photosRef = useRef<SurveyPhotosHandle>(null);
  const fieldRefs = useRef<Record<string, TextInput>>({});

  const restoreFromJson = (json: string | Record<string, unknown>) => {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    const restored: FormData = {};
    for (const [key, section] of Object.entries(parsed as Record<string, unknown>)) {
      if (key === "species") {
        if (Array.isArray(section)) setSpecies(section as ReleveSpeciesEntry[]);
      } else if (section && typeof section === "object" && !Array.isArray(section)) {
        restored[key] = section as Record<string, string | number | null>;
      }
    }
    setFormData(restored);
  };

  const getSiteName = useCallback(async (): Promise<string | null> => {
    if (!params.siteId) return null;
    try {
      const sites = await getCachedProjectSites(projectId);
      const site = sites.find((s) => s.id === params.siteId);
      return site?.site_name || site?.site_code || null;
    } catch { return null; }
  }, [params.siteId, projectId]);

  const loadFromCache = useCallback(async () => {
    if (isNew) {
      const cachedProjects = await getCachedProjects();
      const cachedProj = cachedProjects.find((p) => p.id === projectId);
      const pName = cachedProj?.name ?? "";
      setProjectName(pName);
      const siteName = await getSiteName();
      const defaults = await getReleveDefaults({ projectId, projectName: pName, siteName });
      setFormData({
        basic: {
          releve_code: defaults.releve_code,
          recorder: defaults.recorder,
          site_name: defaults.site_name,
        },
      });
    } else if (surveyId) {
      // Pending (unsynced) edits take priority over cache
      const pending = await getPendingSurveyByRemoteId(surveyId);
      if (pending?.form_data) {
        setProjectId(pending.project_id);
        restoreFromJson(pending.form_data);
        return;
      }
      const cached = await getCachedSurvey(surveyId);
      if (cached) {
        setProjectId(cached.project_id);
        if (cached.form_data) {
          restoreFromJson(cached.form_data);
        }
      }
    }
  }, [isNew, surveyId, projectId]);

  const init = useCallback(async () => {
    try {
      // For existing surveys, check pending (unsynced) edits first — no network needed
      if (!isNew && surveyId) {
        const pending = await getPendingSurveyByRemoteId(surveyId);
        if (pending?.form_data) {
          setProjectId(pending.project_id);
          const cachedProjects = await getCachedProjects();
          const cp = cachedProjects.find((p) => p.id === pending.project_id);
          if (cp) setProjectName(cp.name);
          restoreFromJson(pending.form_data);
          return;
        }
      }

      const { supabase } = await import("@/lib/supabase");

      if (isNew) {
        if (!projectId) return;
        const { data: proj } = await supabase.from("projects").select("name").eq("id", projectId).single();
        let pName = proj?.name ?? "";
        if (!pName) {
          const cachedProjects = await getCachedProjects();
          pName = cachedProjects.find((p) => p.id === projectId)?.name ?? "";
        }
        setProjectName(pName);
        const siteName = await getSiteName();
        const defaults = await getReleveDefaults({ projectId, projectName: pName, siteName });
        setFormData({
          basic: {
            releve_code: defaults.releve_code,
            recorder: defaults.recorder,
            site_name: defaults.site_name,
          },
        });
      } else if (surveyId) {
        // Fetch survey metadata first
        const { data: survey, error: surveyError } = await supabase
          .from("surveys")
          .select("project_id, status")
          .eq("id", surveyId)
          .single();
        // Custom fetch wrapper returns 503 instead of throwing on network error,
        // so catch block won't fire — fall back to cache explicitly
        if (surveyError || !survey) {
          await loadFromCache();
          return;
        }
        setProjectId(survey.project_id);
        const { data: proj } = await supabase.from("projects").select("name").eq("id", survey.project_id).single();
        if (proj) setProjectName(proj.name);

        // Read from releve_surveys — web may update these columns directly
        // without touching surveys.form_data
        const { data: releve } = await supabase
          .from("releve_surveys")
          .select("*")
          .eq("survey_id", surveyId)
          .single();

        if (releve) {
          const restored: FormData = {};
          for (const section of RELEVE_SECTIONS) {
            const sectionData: Record<string, string | number | null> = {};
            for (const field of section.fields) {
              const val = releve[field.key as keyof typeof releve];
              if (val != null) sectionData[field.key] = val as string | number;
            }
            if (Object.keys(sectionData).length > 0) restored[section.id] = sectionData;
          }

          const { data: speciesData } = await supabase
            .from("releve_species")
            .select("species_name_latin, species_name_english, species_cover_domin, species_cover_pct, notes")
            .eq("releve_id", releve.id);
          if (speciesData && speciesData.length > 0) {
            setSpecies(speciesData);
            (restored as Record<string, unknown>).species = speciesData;
          }

          setFormData(restored);

          // Update cache with latest releve_surveys data for offline access
          await cacheSurvey({
            id: surveyId, projectId: survey.project_id, surveyType: "releve_survey",
            surveyDate: releve.survey_date ?? new Date().toISOString().split("T")[0],
            status: survey.status ?? "in_progress", weather: null, formData: restored, notes: null,
          });
        }
      }
    } catch {
      await loadFromCache();
    }
  }, [isNew, surveyId, projectId, loadFromCache]);

  useEffect(() => {
    init().finally(() => setLoading(false));
  }, [init]);

  const updateField = (sectionId: string, key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [sectionId]: { ...(prev[sectionId] ?? {}), [key]: value },
    }));
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ── Species handlers ── */

  const addSpecies = () => {
    setSpecies((prev) => [
      ...prev,
      { species_name_latin: "", species_name_english: null, species_cover_domin: null, species_cover_pct: null, notes: null },
    ]);
  };

  const updateSpecies = (index: number, field: keyof ReleveSpeciesEntry, value: string) => {
    setSpecies((prev) => {
      const next = [...prev];
      const entry = { ...next[index] };
      if (field === "species_cover_domin" || field === "species_cover_pct") {
        entry[field] = value === "" ? null : Number(value);
      } else {
        entry[field] = value || null;
      }
      next[index] = entry as ReleveSpeciesEntry;
      return next;
    });
  };

  const removeSpecies = (index: number) => {
    setSpecies((prev) => prev.filter((_, i) => i !== index));
  };

  /* ── Save ── */

  const handleSave = async (markComplete: boolean) => {
    const code = formData.basic?.releve_code;
    const recorder = formData.basic?.recorder;
    if (!code || !recorder) {
      Alert.alert("Required", "Relevé Code and Recorder are required.");
      return;
    }

    setSaving(true);
    const pendingUris = photosRef.current?.getPendingUris() ?? [];

    const fullFormData: FormData = { ...formData };
    (fullFormData as Record<string, unknown>).species = species;

    const result = await saveSurvey({
      surveyId,
      projectId,
      projectName,
      surveyType: "releve_survey",
      formData: fullFormData,
      markComplete,
      pendingPhotoUris: pendingUris,
      siteId: params.siteId ?? null,
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
    Alert.alert("Saved", markComplete ? "Survey completed successfully." : "Progress saved.", [
      { text: "OK", onPress: markComplete ? () => router.back() : undefined },
    ]);
  };

  /* ── Render ── */

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Relev\u00E9 Survey",
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(tabs)");
                }
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={28} color={colors.primary.DEFAULT} />
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView style={s.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

          <SurveyPhotos ref={photosRef} surveyId={surveyId} projectId={projectId} projectName={projectName} />

          {RELEVE_SECTIONS.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            return (
              <View key={section.id} style={s.section}>
                <TouchableOpacity style={s.sectionHeader} activeOpacity={0.7} onPress={() => toggleSection(section.id)}>
                  <Text style={s.sectionTitle}>{section.title}</Text>
                  <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={22} color={colors.text.muted} />
                </TouchableOpacity>
                {isExpanded && (
                  <View style={s.sectionBody}>
                    {section.fields.map((field) => {
                      const currentVal = formData[section.id]?.[field.key];
                      return (
                        <View key={field.key} style={s.fieldWrap}>
                          <Text style={s.fieldLabel}>
                            {field.label}{field.unit ? ` (${field.unit})` : ""}{field.required ? " *" : ""}
                          </Text>
                          {field.type === "habitat" ? (
                            <>
                              <TouchableOpacity style={s.selectBtn} onPress={() => setShowHabitatPicker(true)}>
                                <Text style={[s.selectBtnText, !currentVal && { color: colors.text.muted }]}>
                                  {currentVal
                                    ? `${currentVal} \u2014 ${FOSSITT_LEVEL3.find((f) => f.code === String(currentVal))?.name ?? ""}`
                                    : "Search habitat..."}
                                </Text>
                                <Ionicons name="search" size={18} color={colors.text.muted} />
                              </TouchableOpacity>
                              <HabitatPicker
                                visible={showHabitatPicker}
                                selectedCode={currentVal ? String(currentVal) : null}
                                onSelect={(code) => updateField(section.id, field.key, code)}
                                onClose={() => setShowHabitatPicker(false)}
                              />
                            </>
                          ) : field.type === "select" ? (
                            <TouchableOpacity
                              style={s.selectBtn}
                              onPress={() => setActiveSelect({ sectionId: section.id, field })}
                            >
                              <Text style={[s.selectBtnText, !currentVal && { color: colors.text.muted }]}>
                                {currentVal
                                  ? field.options?.find((o) => o.value === String(currentVal))?.label ?? String(currentVal)
                                  : "Select..."}
                              </Text>
                              <Ionicons name="chevron-down" size={18} color={colors.text.muted} />
                            </TouchableOpacity>
                          ) : (
                            <TextInput
                              ref={(el) => { if (el) fieldRefs.current[`${section.id}.${field.key}`] = el; }}
                              style={[s.input, field.type === "text" && { minHeight: 48, textAlignVertical: "top" }]}
                              value={String(currentVal ?? "")}
                              onChangeText={(v) => updateField(section.id, field.key, v)}
                              keyboardType={field.type === "number" ? "decimal-pad" : "default"}
                              returnKeyType={field.type === "text" ? "default" : "next"}
                              multiline={field.type === "text"}
                              blurOnSubmit={false}
                              onSubmitEditing={() => {
                                const allFields = section.fields.filter((f) => f.type !== "select" && f.type !== "habitat");
                                const idx = allFields.findIndex((f) => f.key === field.key);
                                const next = allFields[idx + 1];
                                if (next) fieldRefs.current[`${section.id}.${next.key}`]?.focus();
                              }}
                              placeholder={field.placeholder}
                              placeholderTextColor={colors.text.muted}
                            />
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}

          {/* ── Species section ── */}
          <View style={s.section}>
            <TouchableOpacity style={s.sectionHeader} activeOpacity={0.7} onPress={() => toggleSection("species")}>
              <Text style={s.sectionTitle}>Species ({species.length})</Text>
              <Ionicons name={expandedSections.has("species") ? "chevron-up" : "chevron-down"} size={22} color={colors.text.muted} />
            </TouchableOpacity>
            {expandedSections.has("species") && (
              <View style={s.sectionBody}>
                {species.map((entry, i) => (
                  <SpeciesRow key={i} entry={entry} index={i} onChange={updateSpecies} onRemove={removeSpecies} />
                ))}
                <TouchableOpacity style={s.addBtn} activeOpacity={0.7} onPress={addSpecies}>
                  <Ionicons name="add-circle-outline" size={22} color={colors.primary.DEFAULT} />
                  <Text style={s.addBtnText}>Add Species</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

        </ScrollView>

        {activeSelect && (
          <SelectModal
            visible
            title={activeSelect.field.label}
            options={activeSelect.field.options ?? []}
            selectedValue={String(formData[activeSelect.sectionId]?.[activeSelect.field.key] ?? "")}
            onSelect={(v) => {
              updateField(activeSelect.sectionId, activeSelect.field.key, v);
              setActiveSelect(null);
            }}
            onClose={() => setActiveSelect(null)}
          />
        )}

        <View style={s.footer}>
          <TouchableOpacity style={s.saveBtn} activeOpacity={0.8} disabled={saving} onPress={() => handleSave(false)}>
            {saving ? <ActivityIndicator color={colors.primary.DEFAULT} /> : <Text style={s.saveBtnText}>Save Progress</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.completeBtn} activeOpacity={0.8} disabled={saving} onPress={() => handleSave(true)}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={s.completeBtnText}>Complete Survey</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background.page },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 140 },
  section: { backgroundColor: colors.background.card, borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18, minHeight: 60 },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: colors.text.heading },
  sectionBody: { paddingHorizontal: 18, paddingBottom: 18, borderTopWidth: 1, borderTopColor: "#E5E7EB", paddingTop: 14 },
  fieldWrap: { marginBottom: 14 },
  fieldLabel: { fontSize: 14, fontWeight: "500", color: colors.text.body, marginBottom: 6 },
  input: { backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text.heading, borderWidth: 1, borderColor: "#E5E7EB" },
  selectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  selectBtnText: { fontSize: 16, color: colors.text.heading, flex: 1 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, justifyContent: "center" },
  addBtnText: { fontSize: 16, fontWeight: "600", color: colors.primary.DEFAULT },
  footer: { flexDirection: "row", gap: 10, padding: 16, paddingBottom: 32, backgroundColor: colors.background.card, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  saveBtn: { flex: 1, height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", borderWidth: 2, borderColor: colors.primary.DEFAULT },
  saveBtnText: { fontSize: 16, fontWeight: "600", color: colors.primary.DEFAULT },
  completeBtn: { flex: 1, height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", backgroundColor: colors.primary.DEFAULT },
  completeBtnText: { fontSize: 16, fontWeight: "600", color: colors.white },
});
