import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import SurveyTypePicker from "@/components/survey-type-picker";
import SitePicker from "@/components/site-picker";
import { cacheSurvey, getCachedSurveys, getCachedProjectSites } from "@/lib/database";
import { useNetworkStore } from "@/lib/network";
import type { Survey } from "@/types/survey";
import type { SurveyTemplate } from "@/types/survey-template";
import type { ProjectSite } from "@/types/project";
import { surveyTypeLabels, surveyStatusLabels } from "@/types/survey";

const statusColors: Record<string, string> = {
  in_progress: colors.status.atRisk,
  completed: colors.status.onTrack,
};

export default function SurveysListScreen() {
  const { id, siteId: urlSiteId } = useLocalSearchParams<{ id: string; siteId?: string }>();
  const router = useRouter();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [sites, setSites] = useState<ProjectSite[]>([]);
  const [sitesLoaded, setSitesLoaded] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(urlSiteId ?? null);
  const [filter, setFilter] = useState<"active" | "completed">("active");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

  // Mirrors web (field-survey-step): single-site projects auto-pick the only
  // site; multi-site projects must have an explicit selection before the FAB
  // becomes available, otherwise surveys would be created with site_id=null
  // and disappear from any site-filtered view.
  const effectiveSiteId = useMemo(() => {
    if (sites.length === 1) return sites[0].id;
    return selectedSiteId;
  }, [sites, selectedSiteId]);

  const isMultiSite = sites.length > 1;
  const requiresSiteSelection = !sitesLoaded || (isMultiSite && !selectedSiteId);

  const sitesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sites) map.set(s.id, s.site_code);
    return map;
  }, [sites]);

  // Per-row visit pill data: { position, total } within the row's
  // (visit_group_id, site_id) chain — computed straight from the loaded
  // surveys state instead of cache+pending.
  //
  // We deliberately don't pull from loadAllVisitSurveysForProject here:
  // that helper merges pending_surveys, which can contain stale rows
  // from earlier failed-sync attempts. Those orphan pending rows
  // inflate the count without ever appearing in the visible list — the
  // user sees "2 surveys but the pill says 1/3" because the 3rd is a
  // ghost in pending. Counting from `surveys` (the actual fetched list)
  // guarantees the pill matches what's on screen.
  //
  // The pill's numerator is the 1-based POSITION in the chain (sorted
  // by visit_number), not the raw column. Site 1 with two visits always
  // reads "1/2, 2/2" no matter what visit_number happens to be on disk.
  const visitPositions = useMemo(() => {
    const chains = new Map<string, Survey[]>();
    for (const s of surveys) {
      if (!s.visit_group_id) continue;
      const key = `${s.visit_group_id}::${s.site_id ?? "no-site"}`;
      const arr = chains.get(key) ?? [];
      arr.push(s);
      chains.set(key, arr);
    }
    const positions = new Map<string, { position: number; total: number }>();
    for (const members of chains.values()) {
      const sorted = [...members].sort(
        (a, b) => (a.visit_number ?? 0) - (b.visit_number ?? 0)
      );
      sorted.forEach((s, i) => {
        positions.set(s.id, { position: i + 1, total: sorted.length });
      });
    }
    return positions;
  }, [surveys]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const cached = await getCachedProjectSites(id);
      setSites(cached as ProjectSite[]);
      setSitesLoaded(true);
    })();
  }, [id]);

  const loadSurveysFromCache = useCallback(async () => {
    if (!id) return;
    let cached = await getCachedSurveys(id);
    if (effectiveSiteId) cached = cached.filter((c) => c.site_id === effectiveSiteId);
    if (cached.length > 0) {
      setSurveys(cached.map((c) => ({
        ...c, surveyor_id: null, start_time: null, end_time: null,
        sync_status: "synced" as const, created_at: "", updated_at: "",
        status: c.status as Survey["status"],
        visit_group_id: c.visit_group_id,
        visit_number: c.visit_number,
      })));
    } else {
      setSurveys([]);
    }
  }, [id, effectiveSiteId]);

  const fetchSurveys = useCallback(async () => {
    if (!id) return;
    if (!useNetworkStore.getState().isOnline) {
      await loadSurveysFromCache();
      return;
    }
    try {
      let query = supabase
        .from("surveys")
        .select("id, project_id, survey_type, surveyor_id, survey_date, start_time, end_time, status, sync_status, notes, weather, form_data, created_at, updated_at, site_id, visit_group_id, visit_number")
        .eq("project_id", id)
        .order("survey_date", { ascending: false });
      if (effectiveSiteId) query = query.eq("site_id", effectiveSiteId);
      const { data, error } = await query;
      if (error) throw error;
      if (data) {
        setSurveys(data);
        for (const s of data) {
          await cacheSurvey({
            id: s.id, projectId: s.project_id, surveyType: s.survey_type,
            surveyDate: s.survey_date, status: s.status,
            weather: s.weather as Record<string, unknown> | null,
            formData: s.form_data as Record<string, unknown> | null,
            notes: s.notes,
            siteId: s.site_id as string | null,
            visitGroupId: s.visit_group_id as string | null,
            visitNumber: s.visit_number as number | null,
          });
        }
      }
    } catch {
      await loadSurveysFromCache();
    }
  }, [id, effectiveSiteId, loadSurveysFromCache]);

  useEffect(() => {
    fetchSurveys().finally(() => setLoading(false));
  }, [fetchSurveys]);

  // Re-fetch every time the list is focused so newly-added visits (from
  // /survey/add-visit) appear without requiring a manual pull-to-refresh.
  // Without this the user returns from Add Visit save, sees stale list
  // missing their new Visit N+1 card, and has to drag down to refresh.
  useFocusEffect(
    useCallback(() => {
      fetchSurveys();
    }, [fetchSurveys])
  );


  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSurveys();
    setRefreshing(false);
  };

  const active = surveys.filter((s) => s.status === "in_progress");
  const completed = surveys.filter((s) => s.status === "completed");
  const list = filter === "active" ? active : completed;

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const renderSurvey = ({ item }: { item: Survey }) => {
    const sc = statusColors[item.status] ?? colors.text.muted;
    const siteLabel = !effectiveSiteId && item.site_id ? sitesMap.get(item.site_id) : null;
    // Visit indicator: position + total within the row's (group, site)
    // chain. Different sites of the same group_id render as separate
    // chains, so the user sees per-site sequential numbering (Site 1
    // 1/2, 2/2 / Site 2 1/3, 2/3, 3/3). Standalone surveys (no group)
    // intentionally show nothing — "Visit 1/1" everywhere is noise.
    const visitInfo = visitPositions.get(item.id);
    const showVisitBadge = !!item.visit_group_id && !!visitInfo;
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => {
        if (item.survey_type === "releve_survey") {
          router.push(`/releve-survey/${item.id}`);
        } else {
          router.push(`/survey/${item.id}`);
        }
      }}>
        <View style={styles.cardRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>{surveyTypeLabels[item.survey_type] ?? item.survey_type}</Text>
              {showVisitBadge && visitInfo && (
                <View style={styles.visitBadge}>
                  <Text style={styles.visitBadgeText}>
                    Visit {visitInfo.position}/{visitInfo.total}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.cardSub}>{formatDate(item.survey_date)}</Text>
            <View style={styles.cardTags}>
              <View style={[styles.tag, { backgroundColor: sc + "1A" }]}>
                <Text style={[styles.tagText, { color: sc }]}>{surveyStatusLabels[item.status] ?? item.status}</Text>
              </View>
              {siteLabel && (
                <View style={styles.siteBadge}>
                  <Ionicons name="location" size={12} color={colors.primary.DEFAULT} />
                  <Text style={styles.siteBadgeText}>{siteLabel}</Text>
                </View>
              )}
              {item.notes && <Ionicons name="document-text-outline" size={16} color={colors.text.muted} />}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.text.muted} />
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Surveys" }} />
      <View style={styles.container}>
        {isMultiSite && (
          <View style={styles.sitePickerWrap}>
            <SitePicker
              sites={sites}
              selectedSiteId={selectedSiteId}
              onSelect={setSelectedSiteId}
            />
          </View>
        )}
        {requiresSiteSelection && sitesLoaded && (
          <View style={styles.warningBanner}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.status.atRisk} />
            <Text style={styles.warningText}>Select a site first to schedule surveys.</Text>
          </View>
        )}
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, filter === "active" && styles.filterActive]}
            onPress={() => setFilter("active")}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterText, filter === "active" && styles.filterTextActive]}>
              Active ({active.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, filter === "completed" && styles.filterActive]}
            onPress={() => setFilter("completed")}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterText, filter === "completed" && styles.filterTextActive]}>
              Completed ({completed.length})
            </Text>
          </TouchableOpacity>
        </View>
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={renderSurvey}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary.DEFAULT} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="clipboard-outline" size={48} color={colors.text.muted} />
              <Text style={styles.emptyText}>{filter === "active" ? "No active surveys" : "No completed surveys"}</Text>
            </View>
          }
        />

        <SurveyTypePicker
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          onSelect={(template: SurveyTemplate) => {
            setPickerVisible(false);
            const siteParam = effectiveSiteId ? `&siteId=${effectiveSiteId}` : "";
            if (template.survey_type === "releve_survey") {
              router.push(`/releve-survey/new?projectId=${id}${siteParam}`);
            } else {
              router.push(`/survey/new?projectId=${id}&surveyType=${template.survey_type}${siteParam}`);
            }
          }}
        />

        <TouchableOpacity
          style={[styles.fab, requiresSiteSelection && styles.fabDisabled]}
          activeOpacity={0.8}
          disabled={requiresSiteSelection}
          onPress={() => setPickerVisible(true)}
        >
          <Ionicons name="add" size={28} color={colors.white} />
          <Text style={styles.fabText}>Start New Survey</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background.page },
  sitePickerWrap: { paddingHorizontal: 16, paddingTop: 12 },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.status.atRisk + "55",
    backgroundColor: colors.status.atRisk + "12",
  },
  warningText: { flex: 1, fontSize: 14, color: colors.status.atRisk, fontWeight: "500" },
  filterRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: colors.background.card, borderWidth: 1, borderColor: "#E5E7EB",
  },
  filterActive: { backgroundColor: colors.primary.DEFAULT + "15", borderColor: colors.primary.DEFAULT + "30" },
  filterText: { fontSize: 14, fontWeight: "600", color: colors.text.muted },
  filterTextActive: { color: colors.primary.dark },
  list: { padding: 16, paddingBottom: 100 },
  fab: {
    position: "absolute", bottom: 24, left: 20, right: 20, height: 56,
    backgroundColor: colors.primary.DEFAULT, borderRadius: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6,
  },
  fabDisabled: { backgroundColor: colors.text.muted, shadowOpacity: 0, elevation: 0 },
  fabText: { fontSize: 17, fontWeight: "600", color: colors.white },
  card: { backgroundColor: colors.background.card, borderRadius: 14, padding: 18, marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  cardRow: { flexDirection: "row", alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 17, fontWeight: "600", color: colors.text.heading, flexShrink: 1 },
  visitBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: colors.primary.DEFAULT + "1A",
  },
  visitBadgeText: {
    fontSize: 12, fontWeight: "700",
    color: colors.primary.DEFAULT,
    letterSpacing: 0.2,
  },
  cardSub: { fontSize: 15, color: colors.text.body, marginBottom: 10 },
  cardTags: { flexDirection: "row", alignItems: "center", gap: 10 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 13, fontWeight: "600" },
  siteBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.primary.DEFAULT + "12",
  },
  siteBadgeText: { fontSize: 12, fontWeight: "600", color: colors.primary.dark },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 17, color: colors.text.body },
});
