import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import { cacheProject, getCachedProjects } from "@/lib/database";
import { cacheAllData } from "@/lib/cache-refresh";
import { useNetworkStore } from "@/lib/network";
import type { Project } from "@/types/project";

function mapCachedProjects(
  cached: Awaited<ReturnType<typeof getCachedProjects>>,
): Project[] {
  return cached.map((c) => ({
    id: c.id,
    name: c.name,
    site_code: c.site_code,
    status: (c.status ?? "active") as Project["status"],
    health_status: (c.health_status ?? "on_track") as Project["health_status"],
    county: c.county,
    updated_at: c.updated_at ?? "",
  }));
}

const statusLabels: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

const healthLabels: Record<string, { label: string; color: string }> = {
  on_track: { label: "On Track", color: colors.status.onTrack },
  at_risk: { label: "At Risk", color: colors.status.atRisk },
  overdue: { label: "Overdue", color: colors.status.overdue },
};

export default function ProjectsScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const filteredProjects = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.county?.toLowerCase().includes(q) ||
        p.site_code?.toLowerCase().includes(q)
    );
  }, [projects, search]);

  const fetchProjects = useCallback(async () => {
    // Offline fast-path: skip Supabase entirely. supabase.auth.getUser() makes
    // a network call to validate the token — if we're offline, that returns
    // a synthetic 503 and the function below used to bail before reaching the
    // cache fallback, leaving the screen blank.
    if (!useNetworkStore.getState().isOnline) {
      const cached = await getCachedProjects();
      setProjects(mapCachedProjects(cached));
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Token validation came back empty even though we thought we were
        // online (stale NetInfo, captive portal). Fall back to cache so the
        // screen renders instead of staying empty.
        const cached = await getCachedProjects();
        setProjects(mapCachedProjects(cached));
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      const isAdminOrPM =
        profile?.role === "admin" || profile?.role === "project_manager";

      let query = supabase
        .from("projects")
        .select("id, name, site_code, status, health_status, county, updated_at")
        .order("updated_at", { ascending: false });

      if (!isAdminOrPM) {
        const [{ data: memberships }, { data: createdProjects }] = await Promise.all([
          supabase
            .from("project_members")
            .select("project_id")
            .eq("user_id", user.id),
          supabase
            .from("projects")
            .select("id")
            .eq("created_by", user.id),
        ]);

        const memberIds = memberships?.map((m) => m.project_id) ?? [];
        const createdIds = createdProjects?.map((p) => p.id) ?? [];
        const projectIds = [...new Set([...memberIds, ...createdIds])];

        if (projectIds.length === 0) {
          setProjects([]);
          return;
        }

        query = query.in("id", projectIds);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (data) {
        setProjects(data);
        for (const p of data) {
          await cacheProject({ id: p.id, name: p.name, siteCode: p.site_code, status: p.status, healthStatus: p.health_status, county: p.county, updatedAt: p.updated_at });
        }
      }
    } catch {
      const cached = await getCachedProjects();
      if (cached.length > 0) setProjects(mapCachedProjects(cached));
    }
  }, []);

  const isOnline = useNetworkStore((s) => s.isOnline);

  useEffect(() => {
    fetchProjects().finally(() => setLoading(false));
    // Re-running on isOnline flips handles two cases:
    //  1) Cold start with empty cache + online: the first render sees the
    //     pessimistic default (false) and pulls an empty cache; as soon as
    //     NetInfo resolves we re-fetch from Supabase.
    //  2) Offline → online transition mid-session: refresh instead of
    //     sitting on stale cached data.
  }, [fetchProjects, isOnline]);
  const loadFromCache = useCallback(async () => {
    const cached = await getCachedProjects();
    setProjects(cached.map((c) => ({
      id: c.id, name: c.name, site_code: c.site_code, status: (c.status ?? "active") as Project["status"],
      health_status: (c.health_status ?? "on_track") as Project["health_status"], county: c.county, updated_at: c.updated_at ?? "",
    })));
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    const ok = await cacheAllData();
    if (ok) {
      await loadFromCache();
    } else {
      await fetchProjects();
    }
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

  const renderProject = ({ item }: { item: Project }) => {
    const health = item.health_status
      ? healthLabels[item.health_status]
      : null;

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => router.navigate(`/project/${item.id}`)}
      >
        <View style={styles.cardRow}>
          <View style={styles.cardContent}>
            <Text style={styles.projectName} numberOfLines={2}>
              {item.name}
            </Text>

            <View style={styles.detailRow}>
              {item.county && (
                <View style={styles.detailItem}>
                  <Ionicons
                    name="location-outline"
                    size={16}
                    color={colors.text.body}
                  />
                  <Text style={styles.detailText}>{item.county}</Text>
                </View>
              )}
              {item.site_code && (
                <View style={styles.detailItem}>
                  <Ionicons
                    name="code-outline"
                    size={16}
                    color={colors.text.body}
                  />
                  <Text style={styles.detailText}>{item.site_code}</Text>
                </View>
              )}
            </View>

            <View style={styles.tagRow}>
              <View
                style={[
                  styles.tag,
                  item.status === "active"
                    ? styles.tagActive
                    : item.status === "draft"
                    ? styles.tagDraft
                    : styles.tagCompleted,
                ]}
              >
                <Text
                  style={[
                    styles.tagText,
                    item.status === "active"
                      ? styles.tagActiveText
                      : item.status === "draft"
                      ? styles.tagDraftText
                      : styles.tagCompletedText,
                  ]}
                >
                  {statusLabels[item.status] ?? item.status}
                </Text>
              </View>

              {health && (
                <View
                  style={[
                    styles.tag,
                    { backgroundColor: health.color + "1A" },
                  ]}
                >
                  <View
                    style={[
                      styles.tagDot,
                      { backgroundColor: health.color },
                    ]}
                  />
                  <Text style={[styles.tagText, { color: health.color }]}>
                    {health.label}
                  </Text>
                </View>
              )}

              <Text style={styles.dateText}>
                {formatDate(item.updated_at)}
              </Text>
            </View>
          </View>

          <Ionicons
            name="chevron-forward"
            size={22}
            color={colors.text.muted}
          />
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
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container}>
        <View style={styles.searchContainer}>
          <Ionicons
            name="search-outline"
            size={20}
            color={colors.text.muted}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search projects..."
            placeholderTextColor={colors.text.muted}
            value={search}
            onChangeText={(text) => setSearch(text)}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
            clearButtonMode="while-editing"
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setSearch("");
                Keyboard.dismiss();
              }}
              activeOpacity={0.6}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name="close-circle"
                size={20}
                color={colors.text.muted}
              />
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          data={filteredProjects}
          keyExtractor={(item) => item.id}
          renderItem={renderProject}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
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
              <Ionicons
                name={search ? "search-outline" : "folder-open-outline"}
                size={48}
                color={colors.text.muted}
              />
              <Text style={styles.emptyText}>
                {search ? "No matching projects" : "No projects yet"}
              </Text>
            </View>
          }
        />
      </View>
    </TouchableWithoutFeedback>
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
  searchContainer: { flexDirection: "row", alignItems: "center", backgroundColor: colors.background.card, marginHorizontal: 16, marginTop: 12, marginBottom: 4, borderRadius: 12, paddingHorizontal: 14, height: 50, borderWidth: 1, borderColor: colors.border },
  searchIcon: { marginRight: 10 },
  searchInput: { flex: 1, fontSize: 17, color: colors.text.heading },
  list: { padding: 16, paddingBottom: 32 },
  card: { backgroundColor: colors.background.card, borderRadius: 14, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  cardRow: { flexDirection: "row", alignItems: "center" },
  cardContent: { flex: 1 },
  projectName: { fontSize: 18, fontWeight: "600", color: colors.text.heading, marginBottom: 8, lineHeight: 24,
  },
  detailRow: {
    flexDirection: "row",
    gap: 18,
    marginBottom: 12,
  },
  detailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  detailText: {
    fontSize: 15,
    color: colors.text.body,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  tagActive: {
    backgroundColor: colors.primary.DEFAULT + "15",
  },
  tagDraft: {
    backgroundColor: "#DBEAFE",
  },
  tagCompleted: {
    backgroundColor: "#E5E7EB",
  },
  tagText: {
    fontSize: 13,
    fontWeight: "600",
  },
  tagActiveText: {
    color: colors.primary.dark,
  },
  tagDraftText: {
    color: "#2563EB",
  },
  tagCompletedText: {
    color: colors.text.body,
  },
  tagDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  dateText: {
    fontSize: 14,
    color: colors.text.body,
    marginLeft: "auto",
  },
  empty: {
    alignItems: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: 17,
    color: colors.text.body,
  },
});
