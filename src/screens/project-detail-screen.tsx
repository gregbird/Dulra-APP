import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
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
import SurveyTypePicker from "@/components/survey-type-picker";
import type { Project } from "@/types/project";
import type { Survey } from "@/types/survey";
import type { SurveyTemplate } from "@/types/survey-template";
import { surveyTypeLabels, surveyStatusLabels } from "@/types/survey";

type Tab = "active" | "completed";

const statusColors: Record<string, string> = {
  planned: "#2563EB",
  in_progress: colors.status.atRisk,
  completed: colors.status.onTrack,
  approved: colors.primary.DEFAULT,
};

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [tab, setTab] = useState<Tab>("active");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

  const activeSurveys = surveys.filter(
    (s) => s.status === "planned" || s.status === "in_progress"
  );
  const completedSurveys = surveys.filter(
    (s) => s.status === "completed" || s.status === "approved"
  );
  const currentList = tab === "active" ? activeSurveys : completedSurveys;

  const fetchData = useCallback(async () => {
    if (!id) return;

    const [projectRes, surveysRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, site_code, status, health_status, county, updated_at")
        .eq("id", id)
        .single(),
      supabase
        .from("surveys")
        .select("id, project_id, survey_type, surveyor_id, survey_date, start_time, end_time, status, sync_status, notes, created_at, updated_at")
        .eq("project_id", id)
        .order("survey_date", { ascending: false }),
    ]);

    if (projectRes.data) setProject(projectRes.data);
    if (surveysRes.data) setSurveys(surveysRes.data);
  }, [id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const handleCreateSurvey = async (template: SurveyTemplate) => {
    setPickerVisible(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !id) return;

    const { data, error } = await supabase
      .from("surveys")
      .insert({
        project_id: id,
        survey_type: template.survey_type,
        surveyor_id: user.id,
        survey_date: new Date().toISOString().split("T")[0],
        status: "in_progress",
        sync_status: "synced",
      })
      .select("id")
      .single();

    if (error || !data) {
      Alert.alert("Error", "Failed to create survey.");
      return;
    }

    router.push(`/survey/${data.id}`);
  };

  const renderSurvey = ({ item }: { item: Survey }) => {
    const statusColor = statusColors[item.status] ?? colors.text.muted;

    return (
      <TouchableOpacity
        style={styles.surveyCard}
        activeOpacity={0.7}
        onPress={() => router.push(`/survey/${item.id}`)}
      >
        <View style={styles.surveyRow}>
          <View style={styles.surveyContent}>
            <Text style={styles.surveyType}>
              {surveyTypeLabels[item.survey_type] ?? item.survey_type}
            </Text>
            <Text style={styles.surveyDate}>
              {formatDate(item.survey_date)}
            </Text>
            <View style={styles.surveyMeta}>
              <View
                style={[styles.statusTag, { backgroundColor: statusColor + "1A" }]}
              >
                <Text style={[styles.statusTagText, { color: statusColor }]}>
                  {surveyStatusLabels[item.status] ?? item.status}
                </Text>
              </View>
              {item.notes && (
                <Ionicons
                  name="document-text-outline"
                  size={16}
                  color={colors.text.muted}
                />
              )}
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
      <Stack.Screen options={{ title: project?.name ?? "Project" }} />
      <View style={styles.container}>
        {project && (
          <View style={styles.header}>
            <Text style={styles.projectName}>{project.name}</Text>
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

        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabItem, tab === "active" && styles.tabActive]}
            onPress={() => setTab("active")}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, tab === "active" && styles.tabTextActive]}>
              Active ({activeSurveys.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabItem, tab === "completed" && styles.tabActive]}
            onPress={() => setTab("completed")}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, tab === "completed" && styles.tabTextActive]}>
              Completed ({completedSurveys.length})
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={currentList}
          keyExtractor={(item) => item.id}
          renderItem={renderSurvey}
          contentContainerStyle={styles.list}
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary.DEFAULT}
              title="Updating..."
              titleColor={colors.text.muted}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="clipboard-outline" size={48} color={colors.text.muted} />
              <Text style={styles.emptyText}>
                {tab === "active" ? "No active surveys" : "No completed surveys"}
              </Text>
            </View>
          }
        />

        <SurveyTypePicker
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          onSelect={handleCreateSurvey}
        />

        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.8}
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
  container: {
    flex: 1,
    backgroundColor: colors.background.page,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background.page,
  },
  header: {
    backgroundColor: colors.background.card,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  projectName: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text.heading,
    marginBottom: 8,
  },
  headerMeta: {
    flexDirection: "row",
    gap: 18,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaText: {
    fontSize: 15,
    color: colors.text.body,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.background.card,
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: colors.background.page,
  },
  tabActive: {
    backgroundColor: colors.primary.DEFAULT + "15",
  },
  tabText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text.muted,
  },
  tabTextActive: {
    color: colors.primary.dark,
  },
  list: {
    padding: 16,
    paddingBottom: 100,
  },
  surveyCard: {
    backgroundColor: colors.background.card,
    borderRadius: 14,
    padding: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  surveyRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  surveyContent: {
    flex: 1,
  },
  surveyType: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text.heading,
    marginBottom: 4,
  },
  surveyDate: {
    fontSize: 15,
    color: colors.text.body,
    marginBottom: 10,
  },
  surveyMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusTagText: {
    fontSize: 13,
    fontWeight: "600",
  },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 17,
    color: colors.text.body,
  },
  fab: {
    position: "absolute",
    bottom: 24,
    left: 20,
    right: 20,
    height: 56,
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.white,
  },
});
