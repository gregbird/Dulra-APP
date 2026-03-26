import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import { getCachedSurveys, getCachedProjects } from "@/lib/database";
import SurveyTypePicker from "@/components/survey-type-picker";
import type { Project } from "@/types/project";
import type { SurveyTemplate } from "@/types/survey-template";

interface SectionCount {
  surveys: number;
  habitats: number;
  targetNotes: number;
}

const sections = [
  { key: "surveys", label: "Surveys", icon: "clipboard-outline" as const, desc: "Field surveys and data collection" },
  { key: "habitats", label: "Habitats", icon: "leaf-outline" as const, desc: "Habitat mapping and classification" },
  { key: "notes", label: "Target Notes", icon: "flag-outline" as const, desc: "Points of interest and observations" },
];

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [counts, setCounts] = useState<SectionCount>({ surveys: 0, habitats: 0, targetNotes: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [projectRes, surveysRes, habitatsRes, notesRes] = await Promise.all([
        supabase
          .from("projects")
          .select("id, name, site_code, status, health_status, county, updated_at")
          .eq("id", id)
          .single(),
        supabase
          .from("surveys")
          .select("id", { count: "exact", head: true })
          .eq("project_id", id),
        supabase
          .from("habitat_polygons")
          .select("id", { count: "exact", head: true })
          .eq("project_id", id),
        supabase
          .from("target_notes")
          .select("id", { count: "exact", head: true })
          .eq("project_id", id),
      ]);
      if (projectRes.error) throw projectRes.error;
      if (projectRes.data) setProject(projectRes.data);
      setCounts({
        surveys: surveysRes.count ?? 0,
        habitats: habitatsRes.count ?? 0,
        targetNotes: notesRes.count ?? 0,
      });
    } catch {
      if (!id) return;
      const cachedSurveys = await getCachedSurveys(id);
      setCounts({ surveys: cachedSurveys.length, habitats: 0, targetNotes: 0 });
      const allProjects = await getCachedProjects();
      const cached = allProjects.find((p) => p.id === id);
      if (cached) {
        setProject({
          id: cached.id, name: cached.name, site_code: cached.site_code,
          status: (cached.status ?? "active") as "active" | "completed",
          health_status: cached.health_status as "on_track" | "at_risk" | "overdue" | null,
          county: cached.county, updated_at: cached.updated_at ?? "",
        });
      }
    }
  }, [id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const handleCreateSurvey = (template: SurveyTemplate) => {
    setPickerVisible(false);
    router.push(`/survey/new?projectId=${id}&surveyType=${template.survey_type}`);
  };

  const getCount = (key: string) => {
    if (key === "surveys") return counts.surveys;
    if (key === "habitats") return counts.habitats;
    if (key === "notes") return counts.targetNotes;
    return 0;
  };

  const handleSectionPress = (key: string) => {
    if (key === "surveys") router.push(`/project/${id}/surveys`);
    if (key === "habitats") router.push(`/project/${id}/habitats`);
    if (key === "notes") router.push(`/project/${id}/target-notes`);
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
      <Stack.Screen
        options={{
          title: project?.name ?? "Project",
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={28} color={colors.primary.DEFAULT} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary.DEFAULT} />
        }
      >
        {project && (
          <View style={styles.header}>
            <View style={styles.headerMeta}>
              {project.county && (
                <View style={styles.metaItem}>
                  <Ionicons name="location-outline" size={16} color={colors.text.body} />
                  <Text style={styles.metaText}>{project.county}</Text>
                </View>
              )}
              {project.site_code && (
                <View style={styles.metaItem}>
                  <Ionicons name="code-outline" size={16} color={colors.text.body} />
                  <Text style={styles.metaText}>{project.site_code}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {sections.map((section) => {
          const count = getCount(section.key);
          return (
            <TouchableOpacity
              key={section.key}
              style={styles.sectionCard}
              activeOpacity={0.7}
              onPress={() => handleSectionPress(section.key)}
            >
              <View style={styles.sectionIcon}>
                <Ionicons name={section.icon} size={26} color={colors.primary.DEFAULT} />
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.sectionLabel}>{section.label}</Text>
                <Text style={styles.sectionDesc}>
                  {count > 0 ? `${count} records` : section.desc}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={colors.text.muted} />
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={styles.newSurveyButton}
          activeOpacity={0.8}
          onPress={() => setPickerVisible(true)}
        >
          <Ionicons name="add" size={24} color={colors.white} />
          <Text style={styles.newSurveyText}>Start New Survey</Text>
        </TouchableOpacity>
      </ScrollView>

      <SurveyTypePicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handleCreateSurvey}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  content: { padding: 16, paddingTop: 24, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background.page },
  header: { marginBottom: 20 },
  headerMeta: { flexDirection: "row", gap: 18 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 15, color: colors.text.body },
  sectionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.background.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  sectionIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary.DEFAULT + "12",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  sectionContent: { flex: 1 },
  sectionLabel: { fontSize: 18, fontWeight: "600", color: colors.text.heading, marginBottom: 3 },
  sectionDesc: { fontSize: 14, color: colors.text.body },
  newSurveyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 14,
    height: 56,
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  newSurveyText: { fontSize: 17, fontWeight: "600", color: colors.white },
});
