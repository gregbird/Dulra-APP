import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Polygon, PROVIDER_DEFAULT, UrlTile, type Region } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { Paths } from "expo-file-system";
import { colors } from "@/constants/colors";
import { useNetworkStore } from "@/lib/network";
import {
  fetchProjectBoundary,
  flattenBoundaryCoordinates,
  polygonToCoordinates,
  type GeoJsonPolygon,
  type ProjectBoundary,
} from "@/lib/project-boundary";
import {
  getBufferColor,
  resolveBufferDistances,
  ringPolygons,
  sortBufferDistances,
} from "@/lib/buffer-zones";
import {
  fetchDesignatedSites,
  polygonsForRender,
  getDesignatedSiteColor,
  designatedCacheKey,
  type DesignatedSite,
} from "@/lib/designated-sites";
import {
  BASE_MAPS,
  DEFAULT_BASE_MAP,
  loadMapLayerPrefs,
  resolveTileCachePath,
  resolveTileUrl,
  saveBaseMapPref,
  saveTownlandsPref,
  type BaseMapId,
} from "@/lib/map-layers";
import {
  approximateZoom,
  bboxesRoughlyEqual,
  fetchTownlands,
  MIN_TOWNLANDS_ZOOM,
  townlandPieces,
  type TownlandFeature,
  type TownlandsBbox,
} from "@/lib/townlands";
import MapLayersControl from "@/components/map-layers-control";
import TownlandDetailModal from "@/components/townland-detail-modal";

interface Props {
  projectId: string;
  /** Currently selected site ID (from project detail SitePicker). null = "All Sites". */
  selectedSiteId: string | null;
  /** Tap callback — opens the fullscreen map screen. */
  onPress: () => void;
}

const PREVIEW_HEIGHT = 200;
const FIT_PADDING = { top: 30, right: 30, bottom: 30, left: 30 };

const TOWNLANDS_STROKE = "#a855f7";

// Tile cache root. Per-source slot is appended via resolveTileCachePath so
// each base map keeps its own folder — UrlTile keys cache by {z}/{x}/{y}
// alone, so colocating sources collides on disk.
const TILE_CACHE_PATH = `${Paths.cache.uri}map-tiles`;
const TILE_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function iosMapTypeFor(id: BaseMapId): "satellite" | "standard" {
  return id === "satellite" || id === "hybrid" ? "satellite" : "standard";
}

/**
 * Read-only map card shown on the project detail screen. Renders the
 * project boundary plus all site polygons, fitted to bounds. The card is
 * tappable; the parent navigates to the fullscreen route.
 *
 * Layer prefs (base map + townlands toggle) are shared with the fullscreen
 * map via the SQLite app_state store, so picking Hybrid here flows through
 * to the fullscreen view and vice versa. Picking layers in either screen
 * persists immediately.
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

  // Layer state mirrors the fullscreen screen. Defaults match the historical
  // look (satellite, no overlay) so an empty pref store doesn't change
  // behaviour for existing users; loadMapLayerPrefs hydrates async and may
  // flip the values once it resolves.
  const [baseMap, setBaseMap] = useState<BaseMapId>(DEFAULT_BASE_MAP);
  const [townlandsEnabled, setTownlandsEnabled] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [townlands, setTownlands] = useState<TownlandFeature[]>([]);
  const [selectedTownland, setSelectedTownland] = useState<TownlandFeature | null>(null);
  const lastTownlandBbox = useRef<TownlandsBbox | null>(null);
  const lastRegion = useRef<Region | null>(null);
  const townlandFetchSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadMapLayerPrefs().then((prefs) => {
      if (cancelled) return;
      setBaseMap(prefs.baseMap);
      setTownlandsEnabled(prefs.townlandsEnabled);
    });
    return () => { cancelled = true; };
  }, []);

  const baseMapConfig = BASE_MAPS[baseMap];

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

  // Buffer rings, parity with the fullscreen map. Memoised on (data,
  // selectedSiteId) so panning never re-buffers — turf.buffer is
  // pure-JS but heavy enough that we don't want it on the hot path.
  // Each ring carries its distance so the camera-fit pass below can
  // pick the smallest one to widen the viewport without zooming the
  // user clean out of the polygon.
  const bufferRings = useMemo(() => {
    if (!data) return [];
    const rings: Array<{
      key: string;
      coords: Array<{ latitude: number; longitude: number }>;
      color: string;
      distance: number;
    }> = [];

    const addRingsFor = (
      boundary: GeoJsonPolygon | null,
      distances: number[] | null,
      idPrefix: string,
    ) => {
      if (!boundary) return;
      const ordered = sortBufferDistances(resolveBufferDistances(distances));
      for (const km of ordered) {
        const polys = ringPolygons(boundary, km);
        polys.forEach((poly, idx) => {
          const coords = polygonToCoordinates(poly);
          if (coords.length === 0) return;
          rings.push({
            key: `${idPrefix}-${km}-${idx}`,
            coords,
            color: getBufferColor(km),
            distance: km,
          });
        });
      }
    };

    if (data.sites.length > 0) {
      for (const site of data.sites) {
        if (selectedSiteId && site.id !== selectedSiteId) continue;
        addRingsFor(site.boundary, site.buffer_distances, `buf-${site.id}`);
      }
    } else if (data.projectBoundary?.geometry) {
      addRingsFor(data.projectBoundary.geometry, null, "buf-project");
    }
    return rings;
  }, [data, selectedSiteId]);

  // Coordinates the camera should focus on. When a specific site is picked
  // we narrow to that polygon; "All Sites" (or a missing site lookup) falls
  // back to the project-wide bbox so the user always sees something framed.
  // The smallest buffer ring is included so the user gets a hint of the
  // halo in the 200px preview — bigger rings are accepted to spill off-frame
  // since fitting them would shrink the polygon to a dot.
  const getFocusCoords = (): Array<{ latitude: number; longitude: number }> => {
    if (!data) return [];
    const base: Array<{ latitude: number; longitude: number }> = [];
    if (selectedSiteId) {
      const site = data.sites.find((s) => s.id === selectedSiteId);
      const sitePoly = polygonToCoordinates(site?.boundary ?? null);
      if (sitePoly.length > 0) base.push(...sitePoly);
    }
    if (base.length === 0) base.push(...flattenBoundaryCoordinates(data));

    if (bufferRings.length > 0) {
      // bufferRings is large→small; take the last (smallest) and append
      // its coords. fitToCoordinates uses the bounding box of the union,
      // so a single ring is enough to widen by ~its diameter.
      const smallest = bufferRings[bufferRings.length - 1];
      base.push(...smallest.coords);
    }
    return base;
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

  // Townlands fetch driver. Same shape as the fullscreen map but on the
  // 200px card the user usually sits below MIN_TOWNLANDS_ZOOM=12 unless
  // they zoom in — when they do, the overlay paints in.
  const refreshTownlands = (region: Region | null) => {
    if (!townlandsEnabled || !region) return;
    const screenWidth = Dimensions.get("window").width;
    const zoom = approximateZoom(region.longitudeDelta, screenWidth);
    if (zoom < MIN_TOWNLANDS_ZOOM) {
      if (townlands.length > 0) setTownlands([]);
      lastTownlandBbox.current = null;
      return;
    }
    const bbox: TownlandsBbox = {
      minLng: region.longitude - region.longitudeDelta / 2,
      minLat: region.latitude - region.latitudeDelta / 2,
      maxLng: region.longitude + region.longitudeDelta / 2,
      maxLat: region.latitude + region.latitudeDelta / 2,
    };
    if (bboxesRoughlyEqual(lastTownlandBbox.current, bbox)) return;
    lastTownlandBbox.current = bbox;
    const seq = ++townlandFetchSeq.current;
    fetchTownlands(bbox).then((features) => {
      if (seq !== townlandFetchSeq.current) return;
      setTownlands(features);
    });
  };

  const handleRegionChangeComplete = (region: Region) => {
    lastRegion.current = region;
    refreshTownlands(region);
  };

  useEffect(() => {
    if (!townlandsEnabled) {
      setTownlands([]);
      setSelectedTownland(null);
      lastTownlandBbox.current = null;
      townlandFetchSeq.current++;
      return;
    }
    refreshTownlands(lastRegion.current);
    // refreshTownlands closes over townlandsEnabled and townlands — only
    // re-run when the toggle flips. Region-change driven fetches handle the
    // pan/zoom case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [townlandsEnabled]);

  const handleSelectBaseMap = (id: BaseMapId) => {
    setBaseMap(id);
    setLayersOpen(false);
    saveBaseMapPref(id);
  };

  const handleToggleTownlands = (enabled: boolean) => {
    setTownlandsEnabled(enabled);
    saveTownlandsPref(enabled);
  };

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
        // mapType picks the Apple Maps base behind our UrlTile (iOS only —
        // Android passes "none" because we ship without a Google Maps key).
        mapType={Platform.OS === "android" ? "none" : iosMapTypeFor(baseMap)}
        scrollEnabled
        zoomEnabled
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        onMapReady={handleMapReady}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {/* Tile + every polygon below carries baseMap in its key. Switching
            base maps remounts all of them together so MKMapView's overlay
            add-order rebuilds with tile first, polygons after — keeping the
            polygons visually on top. Same A-solution the fullscreen map
            uses; matches Leaflet pane behaviour on web. */}
        <UrlTile
          key={`base-${baseMap}`}
          urlTemplate={resolveTileUrl(baseMapConfig.base)}
          maximumZ={baseMapConfig.base.maxZoom}
          flipY={false}
          shouldReplaceMapContent
          tileCachePath={resolveTileCachePath(TILE_CACHE_PATH, baseMapConfig.base)}
          tileCacheMaxAge={TILE_CACHE_MAX_AGE_SECONDS}
        />
        {baseMapConfig.overlay && (
          <UrlTile
            key={`overlay-${baseMap}`}
            urlTemplate={resolveTileUrl(baseMapConfig.overlay)}
            maximumZ={baseMapConfig.overlay.maxZoom}
            flipY={false}
            tileCachePath={resolveTileCachePath(TILE_CACHE_PATH, baseMapConfig.overlay)}
            tileCacheMaxAge={TILE_CACHE_MAX_AGE_SECONDS}
          />
        )}

        {data.sites.map((site) => {
          const coords = polygonToCoordinates(site.boundary);
          if (coords.length === 0) return null;
          const isPrimary = selectedSiteId === null || site.id === selectedSiteId;
          return (
            <Polygon
              key={`${baseMap}-${site.id}`}
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
            key={`${baseMap}-boundary`}
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
              key={`${baseMap}-${designatedCacheKey(site)}-${idx}`}
              coordinates={piece.outer}
              holes={piece.holes.length > 0 ? piece.holes : undefined}
              strokeColor={colour}
              strokeWidth={1.5}
              fillColor={`${colour}40`}
            />
          ));
        })}

        {/* Buffer rings, mirroring the fullscreen map. Painted after
            designated sites so the dashed outline reads cleanly over NPWS
            fills, matching the parity rule the brief calls out. */}
        {bufferRings.map((ring) => (
          <Polygon
            key={`${baseMap}-${ring.key}`}
            coordinates={ring.coords}
            strokeColor={ring.color}
            strokeWidth={1.5}
            fillColor={`${ring.color}0D`}
            lineDashPattern={[4, 4]}
          />
        ))}

        {/* Townlands overlay. Tappable in the preview too — surveyors
            asked to see the bilingual name when they zoom in here, even
            though the rest of the preview is non-interactive. */}
        {townlandsEnabled && townlands.map((feature) => {
          const pieces = townlandPieces(feature);
          if (pieces.length === 0) return null;
          return pieces.map((piece, idx) => (
            <Polygon
              key={`${baseMap}-townland-${feature.id}-${idx}`}
              coordinates={piece.outer}
              holes={piece.holes.length > 0 ? piece.holes : undefined}
              strokeColor={TOWNLANDS_STROKE}
              strokeWidth={1.5}
              fillColor="transparent"
              tappable
              onPress={() => setSelectedTownland(feature)}
            />
          ));
        })}
      </MapView>

      <MapLayersControl
        baseMap={baseMap}
        onSelectBaseMap={handleSelectBaseMap}
        townlandsEnabled={townlandsEnabled}
        onToggleTownlands={handleToggleTownlands}
        visible={layersOpen}
        onOpen={() => setLayersOpen(true)}
        onClose={() => setLayersOpen(false)}
      />

      <TouchableOpacity
        style={styles.tapHint}
        onPress={onPress}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="expand-outline" size={16} color={colors.white} />
        <Text style={styles.tapHintText}>Open map</Text>
      </TouchableOpacity>

      <TownlandDetailModal
        feature={selectedTownland}
        onClose={() => setSelectedTownland(null)}
      />
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
