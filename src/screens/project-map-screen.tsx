import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Polygon, PROVIDER_DEFAULT } from "react-native-maps";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useNetworkStore } from "@/lib/network";
import { getCachedProjects, getCachedProjectSites } from "@/lib/database";
import {
  fetchProjectBoundary,
  flattenBoundaryCoordinates,
  polygonToCoordinates,
  type ProjectBoundary,
} from "@/lib/project-boundary";
import SitePicker from "@/components/site-picker";
import type { ProjectSite } from "@/types/project";

const FIT_PADDING = { top: 80, right: 60, bottom: 120, left: 60 };

export default function ProjectMapScreen() {
  const { id, siteId: initialSiteId } = useLocalSearchParams<{ id: string; siteId?: string }>();
  const router = useRouter();
  const [data, setData] = useState<ProjectBoundary | null>(null);
  const [sites, setSites] = useState<ProjectSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(initialSiteId ?? null);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<MapView>(null);

  // Pull boundary geometry + project metadata + site list. Sites come from
  // a separate cached table (used by SitePicker in project-detail too) so we
  // can render the picker even before the RPCs resolve.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const isOnline = useNetworkStore.getState().isOnline;
      // Project name (optional cosmetic header)
      try {
        if (isOnline) {
          const { data: proj } = await supabase
            .from("projects")
            .select("name")
            .eq("id", id)
            .single();
          if (!cancelled && proj?.name) setProjectName(proj.name);
        } else {
          const cached = await getCachedProjects();
          const cachedProj = cached.find((p) => p.id === id);
          if (!cancelled && cachedProj?.name) setProjectName(cachedProj.name);
        }
      } catch { /* swallow — name is cosmetic */ }

      // Sites for the picker. Cache fallback on failure / offline.
      try {
        if (isOnline) {
          const { data: siteRows } = await supabase
            .from("project_sites")
            .select("id, project_id, site_code, site_name, sort_order, county")
            .eq("project_id", id)
            .order("sort_order");
          if (!cancelled && siteRows) setSites(siteRows as ProjectSite[]);
        } else {
          const cached = await getCachedProjectSites(id);
          if (!cancelled) setSites(cached as ProjectSite[]);
        }
      } catch {
        const cached = await getCachedProjectSites(id);
        if (!cancelled) setSites(cached as ProjectSite[]);
      }

      // Boundary — fetchProjectBoundary handles its own cache fallback.
      const result = await fetchProjectBoundary(id);
      if (!cancelled) setData(result);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Re-fit when data lands or the map first becomes ready. Layout-driven so
  // initial render with empty data still works once the user navigates back.
  const handleMapReady = () => {
    if (!data || !mapRef.current) return;
    const coords = flattenBoundaryCoordinates(data);
    if (coords.length > 0) {
      mapRef.current.fitToCoordinates(coords, { edgePadding: FIT_PADDING, animated: false });
    }
  };

  // After data arrives, fit again — onMapReady may have fired before data loaded.
  useEffect(() => {
    if (!data || !mapRef.current) return;
    const coords = flattenBoundaryCoordinates(data);
    if (coords.length > 0) {
      mapRef.current.fitToCoordinates(coords, { edgePadding: FIT_PADDING, animated: true });
    }
  }, [data]);

  const hasGeometry = data ? flattenBoundaryCoordinates(data).length > 0 : false;

  return (
    <>
      <Stack.Screen
        options={{
          title: projectName || "Project Map",
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace(`/project/${id}`);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={28} color={colors.primary.DEFAULT} />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.container}>
        {sites.length > 1 && (
          <View style={styles.sitePickerWrap}>
            <SitePicker
              sites={sites}
              selectedSiteId={selectedSiteId}
              onSelect={setSelectedSiteId}
            />
          </View>
        )}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
          </View>
        ) : !hasGeometry ? (
          <View style={styles.center}>
            <Ionicons name="map-outline" size={48} color={colors.text.muted} />
            <Text style={styles.placeholderText}>Boundary not set</Text>
            <Text style={styles.placeholderSub}>
              The project hasn't been mapped yet on the web app.
            </Text>
          </View>
        ) : (
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={PROVIDER_DEFAULT}
            showsUserLocation
            showsMyLocationButton
            toolbarEnabled={false}
            onMapReady={handleMapReady}
          >
            {data?.sites.map((site) => {
              const coords = polygonToCoordinates(site.boundary);
              if (coords.length === 0) return null;
              const isPrimary = selectedSiteId === null || site.id === selectedSiteId;
              return (
                <Polygon
                  key={site.id}
                  coordinates={coords}
                  strokeColor={isPrimary ? colors.primary.DEFAULT : "#94a3b8"}
                  strokeWidth={isPrimary ? 3 : 1.5}
                  fillColor={isPrimary ? colors.primary.DEFAULT + "33" : "transparent"}
                />
              );
            })}
            {/* Project-level boundary fallback when no site polygons exist. */}
            {data && data.sites.length === 0 && data.projectBoundary?.geometry && (
              <Polygon
                coordinates={polygonToCoordinates(data.projectBoundary.geometry)}
                strokeColor={colors.primary.DEFAULT}
                strokeWidth={3}
                fillColor={colors.primary.DEFAULT + "33"}
              />
            )}
          </MapView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  map: { flex: 1 },
  center: {
    flex: 1, justifyContent: "center", alignItems: "center",
    paddingHorizontal: 24, gap: 8,
    backgroundColor: colors.background.page,
  },
  placeholderText: { fontSize: 17, fontWeight: "600", color: colors.text.body, marginTop: 8 },
  placeholderSub: { fontSize: 14, color: colors.text.muted, textAlign: "center" },
  sitePickerWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
    backgroundColor: colors.background.page,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
});
