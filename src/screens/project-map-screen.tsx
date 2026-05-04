import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Polygon, PROVIDER_DEFAULT, UrlTile } from "react-native-maps";
import { Paths } from "expo-file-system";
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
import {
  fetchDesignatedSites,
  polygonsForRender,
  getDesignatedSiteColor,
  getDesignatedSiteDisplayName,
  designatedCacheKey,
  type DesignatedSite,
} from "@/lib/designated-sites";
import SitePicker from "@/components/site-picker";
import type { ProjectSite } from "@/types/project";

const FIT_PADDING = { top: 80, right: 60, bottom: 120, left: 60 };

// ESRI World Imagery — free, key-free, matches web's satellite style.
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Same path the preview uses — both screens share the same on-disk cache,
// so a tile fetched from the preview is reused fullscreen and vice versa.
const TILE_CACHE_PATH = `${Paths.cache.uri}map-tiles`;
const TILE_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export default function ProjectMapScreen() {
  const { id, siteId: initialSiteId } = useLocalSearchParams<{ id: string; siteId?: string }>();
  const router = useRouter();
  const [data, setData] = useState<ProjectBoundary | null>(null);
  const [designated, setDesignated] = useState<DesignatedSite[]>([]);
  const [selectedDesignated, setSelectedDesignated] = useState<DesignatedSite | null>(null);
  const [sites, setSites] = useState<ProjectSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(initialSiteId ?? null);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<MapView>(null);
  // Re-fetch on offline→online so a placeholder lands on a real boundary
  // when connectivity returns. Same pattern as ProjectBoundaryPreview.
  const isOnline = useNetworkStore((s) => s.isOnline);

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

      // Boundary controls the loading spinner; designated paints in
      // independently when it arrives. A stuck designated RPC must not be
      // able to block the boundary from rendering — same rationale as the
      // preview.
      fetchDesignatedSites(id)
        .then((result) => { if (!cancelled) setDesignated(result); })
        .catch(() => { /* swallow — designated layer is non-critical */ });
      const boundary = await fetchProjectBoundary(id);
      if (!cancelled) {
        setData(boundary);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isOnline]);

  // Coordinates the camera should focus on — narrows to the selected site
  // when one is picked, falls back to the project-wide bbox otherwise.
  // Designated sites are deliberately NOT included: their bboxes can be
  // much larger than the project boundary (NPWS sites span counties), and
  // including them would zoom the user out of the actual project area.
  const getFocusCoords = (): Array<{ latitude: number; longitude: number }> => {
    if (!data) return [];
    if (selectedSiteId) {
      const site = data.sites.find((s) => s.id === selectedSiteId);
      const sitePoly = polygonToCoordinates(site?.boundary ?? null);
      if (sitePoly.length > 0) return sitePoly;
    }
    return flattenBoundaryCoordinates(data);
  };

  // Re-fit when the map first becomes ready (initial frame). Layout-driven —
  // fitToCoordinates before layout is a no-op, so onMapReady is the trigger.
  const handleMapReady = () => {
    const focus = getFocusCoords();
    if (mapRef.current && focus.length > 0) {
      mapRef.current.fitToCoordinates(focus, { edgePadding: FIT_PADDING, animated: false });
    }
  };

  // Re-fit on data load and on every site selection change so the camera
  // tracks the user's intent: "All Sites" zooms out to the bbox, picking a
  // specific site frames just that polygon.
  useEffect(() => {
    const focus = getFocusCoords();
    if (mapRef.current && focus.length > 0) {
      mapRef.current.fitToCoordinates(focus, { edgePadding: FIT_PADDING, animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedSiteId]);

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
          <View style={styles.mapWrap}>
            <MapView
              ref={mapRef}
              style={styles.map}
              provider={PROVIDER_DEFAULT}
              // Same tile matrix as ProjectBoundaryPreview. shouldReplaceMapContent
              // on iOS prevents the underlying Apple satellite base from being
              // drawn under our ESRI tiles (perf win during pan). The base
              // still kicks in transparently when ESRI hasn't loaded a region.
              mapType={Platform.OS === "android" ? "none" : "satellite"}
              showsUserLocation
              showsMyLocationButton
              toolbarEnabled={false}
              onMapReady={handleMapReady}
            >
              <UrlTile
                urlTemplate={SATELLITE_TILE_URL}
                maximumZ={19}
                flipY={false}
                shouldReplaceMapContent
                tileCachePath={TILE_CACHE_PATH}
                tileCacheMaxAge={TILE_CACHE_MAX_AGE_SECONDS}
              />
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

              {/* Designated sites layer. Drawn after the boundary so they
                  sit on top of it, with site_type colours at ~25% fill so
                  the boundary still reads through. tappable=true is what
                  routes onPress on iOS — without it, taps fall through to
                  the map. */}
              {designated.map((site) => {
                const pieces = polygonsForRender(site.geometry);
                if (pieces.length === 0) return null;
                const colour = getDesignatedSiteColor(site.site_type);
                return pieces.map((piece, idx) => (
                  <Polygon
                    key={`${designatedCacheKey(site)}-${idx}`}
                    coordinates={piece.outer}
                    holes={piece.holes.length > 0 ? piece.holes : undefined}
                    strokeColor={colour}
                    strokeWidth={2}
                    fillColor={`${colour}40`}
                    tappable
                    onPress={() => setSelectedDesignated(site)}
                  />
                ));
              })}
            </MapView>

            {designated.length > 0 && (
              <View style={styles.legendWrap} pointerEvents="none">
                {(["SAC", "SPA", "NHA", "pNHA"] as const).map((type) => {
                  const count = designated.filter((d) => d.site_type === type).length;
                  if (count === 0) return null;
                  return (
                    <View key={type} style={styles.legendItem}>
                      <View
                        style={[styles.legendSwatch, { backgroundColor: getDesignatedSiteColor(type) }]}
                      />
                      <Text style={styles.legendLabel}>{type}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        <DesignatedDetailModal
          site={selectedDesignated}
          onClose={() => setSelectedDesignated(null)}
        />
      </View>
    </>
  );
}

interface ModalProps {
  site: DesignatedSite | null;
  onClose: () => void;
}

function DesignatedDetailModal({ site, onClose }: ModalProps) {
  // Modal is always mounted but only animates in when `site` is set. Body
  // text falls back from ai_summary → content → "" so a sparse row still
  // shows the title and badge without an empty card.
  const colour = getDesignatedSiteColor(site?.site_type ?? null);
  const distance = site?.distance_from_boundary_km;
  const body = site?.ai_summary ?? site?.content ?? "";
  return (
    <Modal
      visible={!!site}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        {/* Stop the inner sheet from forwarding taps to the backdrop, which
            would dismiss the modal on every body interaction. */}
        <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalBody}>
            <View style={styles.modalHeader}>
              <View style={[styles.typeBadge, { backgroundColor: `${colour}22`, borderColor: colour }]}>
                <View style={[styles.typeDot, { backgroundColor: colour }]} />
                <Text style={[styles.typeBadgeText, { color: colour }]}>
                  {site?.site_type ?? "—"}
                </Text>
              </View>
              {site?.site_code && (
                <Text style={styles.siteCode}>NPWS {site.site_code}</Text>
              )}
            </View>

            <Text style={styles.modalTitle}>{site?.title ?? "Designated Site"}</Text>
            <Text style={styles.modalTypeName}>
              {getDesignatedSiteDisplayName(site?.site_type ?? null)}
            </Text>

            {distance != null && (
              <View style={styles.distanceRow}>
                <Ionicons name="navigate-outline" size={16} color={colors.text.muted} />
                <Text style={styles.distanceText}>
                  {distance === 0
                    ? "Within / adjoining project boundary"
                    : `${distance.toFixed(1)} km from project boundary`}
                </Text>
              </View>
            )}

            {body.length > 0 && (
              <Text style={styles.modalContent}>{body}</Text>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.modalClose} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.modalCloseText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  mapWrap: { flex: 1 },
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
  legendWrap: {
    position: "absolute",
    left: 12, bottom: 12,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSwatch: { width: 12, height: 12, borderRadius: 2 },
  legendLabel: { color: colors.white, fontSize: 12, fontWeight: "600" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.background.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingBottom: 24,
    maxHeight: "70%",
  },
  modalHandle: {
    alignSelf: "center",
    width: 36, height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
    marginBottom: 8,
  },
  modalBody: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  typeBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1,
  },
  typeDot: { width: 8, height: 8, borderRadius: 4 },
  typeBadgeText: { fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },
  siteCode: { fontSize: 13, color: colors.text.muted, fontWeight: "500" },
  modalTitle: { fontSize: 20, fontWeight: "700", color: colors.text.heading, marginTop: 4 },
  modalTypeName: { fontSize: 14, color: colors.text.muted },
  distanceRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  distanceText: { fontSize: 14, color: colors.text.body },
  modalContent: { fontSize: 14, color: colors.text.body, lineHeight: 21, marginTop: 12 },
  modalClose: {
    marginTop: 12, marginHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 12,
    alignItems: "center",
  },
  modalCloseText: { color: colors.white, fontSize: 16, fontWeight: "600" },
});
