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
import SurveyorPicker from "@/components/surveyor-picker";
import SelectModal from "@/components/select-modal";
import HabitatPicker, { FOSSITT_LEVEL3 } from "@/components/habitat-picker";
import SpeciesRow from "@/components/species-row";
import { saveSurvey } from "@/lib/survey-save";
import { getReleveDefaults } from "@/lib/releve-save";
import { getLocation, getLastKnownLocation } from "@/lib/location";
import { getCachedSurvey, getCachedProjects, getPendingSurveyByRemoteId, cacheSurvey, getCachedProjectSites } from "@/lib/database";
import type { FormData } from "@/types/survey-template";
import type { ReleveSpeciesEntry } from "@/types/releve";
import { useDevEventStore } from "@/lib/dev-events";
import { generateTestReleveFormData } from "@/lib/dev-fill-data";
import { useNetworkStore } from "@/lib/network";
import VisitsCard from "@/components/visits-card";
import {
  loadAllVisitSurveysForProject,
  type VisitSurveyLike,
} from "@/lib/visit-groups";

/* ── GPS accuracy badge thresholds ──────────────────────────── */
// CIEEM relevé plot guidance: ≤10m is acceptable for 2x2m or 4m² plots.
// 10-50m is usable but worth flagging; >50m means the user is likely
// indoors / under tree cover and should retry outside.
function getAccuracyMeta(accuracy: number): {
  label: string;
  color: string;
  icon: "checkmark-circle" | "alert-circle" | "warning";
} {
  const rounded = Math.round(accuracy);
  if (accuracy <= 10) {
    return { label: `±${rounded}m · Excellent`, color: colors.status.onTrack, icon: "checkmark-circle" };
  }
  if (accuracy <= 50) {
    return { label: `±${rounded}m · OK`, color: colors.status.atRisk, icon: "alert-circle" };
  }
  return { label: `±${rounded}m · Poor`, color: colors.status.overdue, icon: "warning" };
}

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
  const [surveyorId, setSurveyorId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const speciesKeysRef = useRef<string[]>([]);
  const nextSpeciesKeyRef = useRef(0);
  const ensureSpeciesKeys = (count: number) => {
    while (speciesKeysRef.current.length < count) {
      speciesKeysRef.current.push(`sp_${nextSpeciesKeyRef.current++}`);
    }
    if (speciesKeysRef.current.length > count) {
      speciesKeysRef.current = speciesKeysRef.current.slice(0, count);
    }
  };
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["basic"]));
  const [gpsCapturing, setGpsCapturing] = useState(false);
  const [activeSelect, setActiveSelect] = useState<{ sectionId: string; field: FieldDef } | null>(null);
  const [showHabitatPicker, setShowHabitatPicker] = useState(false);
  const photosRef = useRef<SurveyPhotosHandle>(null);
  const fieldRefs = useRef<Record<string, TextInput>>({});
  // Visit grouping state — same shape and lifecycle as survey-form-screen
  // so the VisitsCard component can be reused unchanged. visit_group_id /
  // visit_number live on the row itself; groupSurveys is the merged
  // cache+pending list refreshed on load and after each save.
  const [groupSurveys, setGroupSurveys] = useState<VisitSurveyLike[]>([]);
  const [visitGroupId, setVisitGroupId] = useState<string | null>(null);
  const [visitNumber, setVisitNumber] = useState<number | null>(null);

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
        // Visit grouping fields — present on cached_surveys from v12 onward.
        const c = cached as unknown as {
          visit_group_id?: string | null; visit_number?: number | null;
        };
        setVisitGroupId(c.visit_group_id ?? null);
        setVisitNumber(c.visit_number ?? null);
      }
    }
  }, [isNew, surveyId, projectId]);

  const init = useCallback(async () => {
    try {
      // Active NetInfo probe instead of trusting the Zustand store: the store
      // initialises pessimistic (`false`) and only flips after `startNetworkListener`'s
      // async NetInfo.fetch resolves. On a reload while we're already on this
      // screen, init() can race that probe and end up reading `isOnline = false`,
      // dropping into the cache fallback. The cache holds surveys.form_data
      // (jsonb) which web doesn't update when it edits releve_surveys columns
      // directly — so freshly-set web coordinates would never appear here.
      let online = useNetworkStore.getState().isOnline;
      if (!online) {
        try {
          const NetInfo = (await import("@react-native-community/netinfo")).default;
          const state = await NetInfo.fetch();
          const probedOnline =
            state.isInternetReachable === true ||
            (state.isInternetReachable === null && state.isConnected === true);
          if (probedOnline) {
            online = true;
            useNetworkStore.getState().setOnline(true);
          }
        } catch { /* probe failed — keep pessimistic value */ }
      }
      // Session from SecureStore — safe offline.
      try {
        const { supabase } = await import("@/lib/supabase");
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
            } catch { /* fall through */ }
          }
        }
      } catch { /* session read failure — keep going */ }

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

      // Offline: skip the 3-4 Supabase round-trips that each block on the
      // 10s fetch timeout, go straight to the cache fallback.
      if (!online) {
        await loadFromCache();
        return;
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
          .select("project_id, status, visit_group_id, visit_number")
          .eq("id", surveyId)
          .single();
        // Custom fetch wrapper returns 503 instead of throwing on network error,
        // so catch block won't fire — fall back to cache explicitly
        if (surveyError || !survey) {
          await loadFromCache();
          return;
        }
        setProjectId(survey.project_id);
        setVisitGroupId((survey.visit_group_id as string | null) ?? null);
        setVisitNumber((survey.visit_number as number | null) ?? null);
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

  // Visit graph load — runs after projectId resolves so the VisitsCard
  // can render siblings and the Add Visit gating reflects current state.
  // Independent from the form-data load to avoid blocking it on a network
  // round-trip; the card just shows fewer items if the merge fails.
  const refreshGroupSurveys = useCallback(async (pid: string) => {
    if (!pid) return;
    try {
      const all = await loadAllVisitSurveysForProject(pid);
      setGroupSurveys(all);
    } catch { /* swallow — accordion just shows empty */ }
  }, []);

  useEffect(() => {
    if (projectId) {
      refreshGroupSurveys(projectId);
    }
  }, [projectId, refreshGroupSurveys]);

  // Add Visit visits land here with form_data: {} (saveAddVisit creates
  // the surveys row but leaves the relevé fields blank — the user expects
  // a fresh-survey feel). Apply the same defaults the brand-new relevé
  // path uses: project-derived releve_code, current user as recorder,
  // current site as site_name. We trigger it post-load when basic is
  // missing, so existing surveys aren't disturbed and isNew/standalone
  // creation still gets its defaults via the original load branch.
  useEffect(() => {
    if (loading || isNew || !surveyId || !projectId) return;
    const hasBasic = !!(formData.basic && Object.keys(formData.basic).length > 0);
    if (hasBasic) return;
    let cancelled = false;
    (async () => {
      try {
        const siteName = await getSiteName();
        const defaults = await getReleveDefaults({
          projectId,
          projectName,
          siteName,
        });
        if (cancelled) return;
        setFormData((prev) => ({
          ...prev,
          basic: {
            releve_code: defaults.releve_code,
            recorder: defaults.recorder,
            site_name: defaults.site_name,
          },
        }));
      } catch { /* defaults are best-effort — leave basic empty if the lookup fails */ }
    })();
    return () => { cancelled = true; };
  }, [loading, isNew, surveyId, projectId, projectName, formData.basic, getSiteName]);

  const writeLocationToForm = useCallback((loc: { lat: number; lng: number; accuracy: number | null }) => {
    setFormData((prev) => ({
      ...prev,
      location: {
        survey_x_coord: loc.lng,
        survey_y_coord: loc.lat,
        accuracy_m: loc.accuracy,
      },
    }));
  }, []);

  // Manual refresh: explicit user action, always overrides whatever's currently
  // in the form (including values the user just typed). Re-uses the same
  // capturing indicator as the auto-fill on mount.
  const refreshGps = useCallback(async () => {
    setGpsCapturing(true);
    try {
      const fresh = await getLocation({ maxAgeMs: 0 });
      if (fresh) {
        writeLocationToForm(fresh);
      } else {
        Alert.alert(
          "Location Unavailable",
          "Could not capture GPS. Check that location is enabled in Settings and try again outdoors.",
        );
      }
    } finally {
      setGpsCapturing(false);
    }
  }, [writeLocationToForm]);

  // Auto-capture GPS for new relevés only — edit mode preserves whatever the
  // user (or web) typed previously. Two-stage so the user sees something fast:
  //   (1) getLastKnownLocation: instant from OS cache, no GPS fix taken.
  //   (2) getLocation: real GPS fix (1-3s) for better accuracy.
  // Either stage backs off if the user has already typed coordinates.
  useEffect(() => {
    if (!isNew || loading) return;
    let cancelled = false;

    const fillIfEmpty = (loc: { lat: number; lng: number; accuracy: number | null }) => {
      setFormData((prev) => {
        const cur = (prev.location ?? {}) as Record<string, string | number | null>;
        if (cur.survey_x_coord != null || cur.survey_y_coord != null) return prev;
        return {
          ...prev,
          location: {
            survey_x_coord: loc.lng,
            survey_y_coord: loc.lat,
            accuracy_m: loc.accuracy,
          },
        };
      });
    };

    setGpsCapturing(true);
    (async () => {
      const lastKnown = await getLastKnownLocation();
      if (cancelled) return;
      if (lastKnown) fillIfEmpty(lastKnown);

      const fresh = await getLocation({ maxAgeMs: 0 });
      if (cancelled) return;
      if (fresh) {
        // Override the lastKnown value with the higher-accuracy fix, but
        // still respect a user who's already typed something between calls.
        setFormData((prev) => {
          const cur = (prev.location ?? {}) as Record<string, string | number | null>;
          const fromLastKnown =
            lastKnown != null &&
            cur.survey_x_coord === lastKnown.lng &&
            cur.survey_y_coord === lastKnown.lat;
          const isEmpty = cur.survey_x_coord == null && cur.survey_y_coord == null;
          if (!isEmpty && !fromLastKnown) return prev;
          return {
            ...prev,
            location: {
              survey_x_coord: fresh.lng,
              survey_y_coord: fresh.lat,
              accuracy_m: fresh.accuracy,
            },
          };
        });
      }
      if (!cancelled) setGpsCapturing(false);
    })();

    return () => {
      cancelled = true;
      setGpsCapturing(false);
    };
  }, [isNew, loading]);

  const fillToken = useDevEventStore((s) => s.fillToken);
  const clearFillToken = useDevEventStore((s) => s.clearFillToken);
  useEffect(() => {
    if (!__DEV__ || fillToken == null || loading) return;
    const { formData: gen, species: genSpecies } = generateTestReleveFormData();
    setFormData((prev) => ({ ...prev, ...gen }));
    ensureSpeciesKeys(genSpecies.length);
    setSpecies(genSpecies);
    clearFillToken();
  }, [fillToken, loading, clearFillToken]);

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
    speciesKeysRef.current.push(`sp_${nextSpeciesKeyRef.current++}`);
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
      } else if (field === "species_name_latin") {
        entry[field] = value;
      } else {
        entry[field] = value || null;
      }
      next[index] = entry as ReleveSpeciesEntry;
      return next;
    });
  };

  const removeSpecies = (index: number) => {
    speciesKeysRef.current.splice(index, 1);
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
    // Refresh the visit graph: completing this visit may flip the
    // all-completed gate, hiding the Add Visit button.
    if (projectId) refreshGroupSurveys(projectId);
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

          <SurveyorPicker
            value={surveyorId}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onChange={(userId) => setSurveyorId(userId)}
          />

          <SurveyPhotos ref={photosRef} surveyId={surveyId} projectId={projectId} projectName={projectName} />

          {RELEVE_SECTIONS.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            const isLocationSection = section.id === "location";
            const accuracyVal = isLocationSection
              ? (formData.location?.accuracy_m as number | null | undefined)
              : null;
            const accuracyMeta = accuracyVal != null && Number.isFinite(accuracyVal)
              ? getAccuracyMeta(accuracyVal)
              : null;
            return (
              <View key={section.id} style={s.section}>
                <TouchableOpacity style={s.sectionHeader} activeOpacity={0.7} onPress={() => toggleSection(section.id)}>
                  <View style={s.sectionTitleRow}>
                    <Text style={s.sectionTitle}>{section.title}</Text>
                    {isLocationSection && gpsCapturing && (
                      <View style={s.gpsStatus}>
                        <ActivityIndicator size="small" color={colors.primary.DEFAULT} />
                        <Text style={s.gpsStatusText}>Capturing GPS...</Text>
                      </View>
                    )}
                    {isLocationSection && !gpsCapturing && accuracyMeta && (
                      <View style={[s.accuracyBadge, { backgroundColor: accuracyMeta.color + "1A" }]}>
                        <Ionicons name={accuracyMeta.icon} size={14} color={accuracyMeta.color} />
                        <Text style={[s.accuracyBadgeText, { color: accuracyMeta.color }]}>
                          {accuracyMeta.label}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={22} color={colors.text.muted} />
                </TouchableOpacity>
                {isExpanded && (
                  <View style={s.sectionBody}>
                    {isLocationSection && (
                      <TouchableOpacity
                        style={[s.gpsRefreshBtn, gpsCapturing && s.gpsRefreshBtnDisabled]}
                        activeOpacity={0.7}
                        onPress={refreshGps}
                        disabled={gpsCapturing}
                      >
                        {gpsCapturing ? (
                          <ActivityIndicator size="small" color={colors.primary.DEFAULT} />
                        ) : (
                          <Ionicons name="refresh" size={18} color={colors.primary.DEFAULT} />
                        )}
                        <Text style={s.gpsRefreshBtnText}>
                          {gpsCapturing ? "Capturing..." : "Refresh GPS"}
                        </Text>
                      </TouchableOpacity>
                    )}
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
                {(() => {
                  ensureSpeciesKeys(species.length);
                  return species.map((entry, i) => (
                    <SpeciesRow
                      key={speciesKeysRef.current[i]}
                      entry={entry}
                      index={i}
                      onChange={updateSpecies}
                      onRemove={removeSpecies}
                    />
                  ));
                })()}
                <TouchableOpacity style={s.addBtn} activeOpacity={0.7} onPress={addSpecies}>
                  <Ionicons name="add-circle-outline" size={22} color={colors.primary.DEFAULT} />
                  <Text style={s.addBtnText}>Add Species</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Visit grouping: only meaningful for an existing survey. New
              releve creation skips this entirely — the row needs to be
              saved first before it can serve as a parent for Add Visit. */}
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
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, flexWrap: "wrap" },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: colors.text.heading },
  gpsStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  gpsStatusText: { fontSize: 13, color: colors.text.muted, fontWeight: "500" },
  accuracyBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  accuracyBadgeText: { fontSize: 12, fontWeight: "600" },
  gpsRefreshBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary.DEFAULT,
    backgroundColor: colors.primary.DEFAULT + "08",
    marginBottom: 14, minHeight: 48,
  },
  gpsRefreshBtnDisabled: { opacity: 0.6 },
  gpsRefreshBtnText: { fontSize: 15, fontWeight: "600", color: colors.primary.DEFAULT },
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
