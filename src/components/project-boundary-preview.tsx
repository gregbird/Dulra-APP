import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MapView, { Polygon, PROVIDER_DEFAULT, UrlTile } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { Paths } from "expo-file-system";
import { colors } from "@/constants/colors";
import { useNetworkStore } from "@/lib/network";
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
  designatedCacheKey,
  type DesignatedSite,
} from "@/lib/designated-sites";

interface Props {
  projectId: string;
  /** Currently selected site ID (from project detail SitePicker). null = "All Sites". */
  selectedSiteId: string | null;
  /** Tap callback — opens the fullscreen map screen. */
  onPress: () => void;
}

const PREVIEW_HEIGHT = 200;
const FIT_PADDING = { top: 30, right: 30, bottom: 30, left: 30 };

// ESRI World Imagery — free, no API key, matches the web's satellite style
// (lib/config/map-constants.ts:36 in web). Native Apple/Google Maps base
// shows through while tiles load, then UrlTile takes over.
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Persisting tiles to disk so the satellite imagery stays visible offline.
// Without this, shouldReplaceMapContent on iOS wipes Apple Maps' default
// base, leaving only the polygon over a blank gray canvas when no network
// is available. 30-day TTL is enough for field reuse without bloating
// storage indefinitely.
// Paths.cache is an expo-file-system v19 Directory; .uri gives us the
// file:// path string react-native-maps' UrlTile expects.
const TILE_CACHE_PATH = `${Paths.cache.uri}map-tiles`;
const TILE_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Read-only map card shown on the project detail screen. Renders the
 * project boundary plus all site polygons, fitted to bounds. The card is
 * tappable; the parent navigates to the fullscreen route. Internal map
 * gestures stay disabled — this is a preview, not an interactive widget.
 */
export default function ProjectBoundaryPreview({ projectId, selectedSiteId, onPress }: Props) {
  const [data, setData] = useState<ProjectBoundary | null>(null);
  const [designated, setDesignated] = useState<DesignatedSite[]>([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<MapView>(null);
  // Re-fetch when connectivity returns: an offline-first open with no warm
  // cache yet leaves data empty; once we go online the placeholder should
  // resolve to a real boundary without forcing the user to navigate away.
  const isOnline = useNetworkStore((s) => s.isOnline);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Boundary is critical — it controls the loading spinner. Designated
    // sites are decorative; firing them in parallel but NOT awaiting them
    // here means a slow/stuck designated RPC can never block the boundary
    // from rendering. They paint in once they arrive.
    fetchProjectBoundary(projectId)
      .then((result) => { if (!cancelled) setData(result); })
      .finally(() => { if (!cancelled) setLoading(false); });
    fetchDesignatedSites(projectId)
      .then((result) => { if (!cancelled) setDesignated(result); })
      .catch(() => { /* swallow — designated layer is non-critical */ });
    return () => { cancelled = true; };
  }, [projectId, isOnline]);

  const allCoords = data ? flattenBoundaryCoordinates(data) : [];
  const hasGeometry = allCoords.length > 0;

  // Coordinates the camera should focus on. When a specific site is picked
  // we narrow to that polygon; "All Sites" (or a missing site lookup) falls
  // back to the project-wide bbox so the user always sees something framed.
  const getFocusCoords = (): Array<{ latitude: number; longitude: number }> => {
    if (!data) return [];
    if (selectedSiteId) {
      const site = data.sites.find((s) => s.id === selectedSiteId);
      const sitePoly = polygonToCoordinates(site?.boundary ?? null);
      if (sitePoly.length > 0) return sitePoly;
    }
    return flattenBoundaryCoordinates(data);
  };

  // Fit the camera to whichever coords match the current site selection.
  // Layout-driven: fitToCoordinates before the map is ready is a no-op, so
  // both onMapReady and the selectedSiteId effect below need to run.
  const handleMapReady = () => {
    const focus = getFocusCoords();
    if (mapRef.current && focus.length > 0) {
      mapRef.current.fitToCoordinates(focus, { edgePadding: FIT_PADDING, animated: false });
    }
  };

  useEffect(() => {
    const focus = getFocusCoords();
    if (mapRef.current && focus.length > 0) {
      mapRef.current.fitToCoordinates(focus, { edgePadding: FIT_PADDING, animated: true });
    }
    // getFocusCoords closes over data + selectedSiteId, so re-running on
    // those two is enough — no need to put the helper itself in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedSiteId]);

  if (loading) {
    return (
      <View style={styles.card}>
        <View style={[styles.placeholder, styles.center]}>
          <ActivityIndicator size="small" color={colors.primary.DEFAULT} />
        </View>
      </View>
    );
  }

  if (!data || !hasGeometry) {
    return (
      <View style={styles.card}>
        <View style={[styles.placeholder, styles.center]}>
          <Ionicons name="map-outline" size={32} color={colors.text.muted} />
          <Text style={styles.placeholderText}>Boundary not set</Text>
          <Text style={styles.placeholderSub}>The project hasn't been mapped yet.</Text>
        </View>
      </View>
    );
  }

  // No outer TouchableOpacity wrapper — that would swallow the MapView's
  // pan/zoom gestures. The "Open map" pill in the corner is the explicit
  // tap target; the rest of the card is a regular interactive preview.
  return (
    <View style={styles.card}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        // Tile-source matrix:
        //   iOS:     mapType="satellite" gives us Apple Maps' native satellite
        //            tiles as the underlying base — they're system-cached
        //            and free, so unvisited regions still look like satellite
        //            offline. shouldReplaceMapContent on the ESRI overlay
        //            tells iOS not to *render* the base where our tile
        //            covers it (perf gain during pan: only one tile source
        //            is drawn at a time). The base only kicks in for areas
        //            where ESRI tiles haven't loaded yet.
        //   Android: "none" hides Google Maps' default raster (no API key
        //            shipped), leaving ESRI as the sole base.
        mapType={Platform.OS === "android" ? "none" : "satellite"}
        scrollEnabled
        zoomEnabled
        rotateEnabled={false}
        pitchEnabled={false}
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
        {data.sites.map((site) => {
          const coords = polygonToCoordinates(site.boundary);
          if (coords.length === 0) return null;
          const isPrimary = selectedSiteId === null || site.id === selectedSiteId;
          return (
            <Polygon
              key={site.id}
              coordinates={coords}
              strokeColor={isPrimary ? colors.primary.DEFAULT : "#94a3b8"}
              strokeWidth={isPrimary ? 3 : 2}
              fillColor={isPrimary ? colors.primary.DEFAULT + "33" : "transparent"}
            />
          );
        })}
        {/* Project-level boundary fallback when no site polygons exist. */}
        {data.sites.length === 0 && data.projectBoundary?.geometry && (
          <Polygon
            coordinates={polygonToCoordinates(data.projectBoundary.geometry)}
            strokeColor={colors.primary.DEFAULT}
            strokeWidth={3}
            fillColor={colors.primary.DEFAULT + "33"}
          />
        )}

        {/* Designated sites layer: read-only, no taps in the preview — the
            entire card is a tap target that takes the user to the
            fullscreen map where polygon taps open the detail modal. */}
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
              strokeWidth={1.5}
              fillColor={`${colour}40`}
            />
          ));
        })}
      </MapView>

      <TouchableOpacity
        style={styles.tapHint}
        onPress={onPress}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="expand-outline" size={16} color={colors.white} />
        <Text style={styles.tapHintText}>Open map</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: PREVIEW_HEIGHT,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.background.card,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  map: { flex: 1 },
  placeholder: {
    flex: 1,
    backgroundColor: colors.background.page,
    paddingHorizontal: 16,
    gap: 6,
  },
  center: { justifyContent: "center", alignItems: "center" },
  placeholderText: { fontSize: 15, fontWeight: "600", color: colors.text.body, marginTop: 8 },
  placeholderSub: { fontSize: 13, color: colors.text.muted, textAlign: "center" },
  tapHint: {
    position: "absolute",
    right: 12, bottom: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
  },
  tapHintText: { fontSize: 13, fontWeight: "600", color: colors.white },
});
