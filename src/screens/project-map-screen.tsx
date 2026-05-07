import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Polygon, PROVIDER_DEFAULT, UrlTile, type Region } from "react-native-maps";
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
  getDesignatedSiteDisplayName,
  designatedCacheKey,
  type DesignatedSite,
} from "@/lib/designated-sites";
import {
  fetchProjectHabitats,
  habitatPolygonPieces,
  darkenHex,
} from "@/lib/habitats";
import { getFossittColor } from "@/lib/fossitt-utils";
import { UNCLASSIFIED_HABITAT_COLOR, type HabitatPolygon } from "@/types/habitat";
import {
  BASE_MAPS,
  DEFAULT_BASE_MAP,
  loadMapLayerPrefs,
  resolveTileCachePath,
  resolveTileUrl,
  saveBaseMapPref,
  saveHabitatsPref,
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
import HabitatMapModal from "@/components/habitat-map-modal";
import SitePicker from "@/components/site-picker";
import type { ProjectSite } from "@/types/project";

const FIT_PADDING = { top: 80, right: 60, bottom: 120, left: 60 };

// Same path the preview uses — both screens share the same on-disk cache,
// so a tile fetched from the preview is reused fullscreen and vice versa.
const TILE_CACHE_PATH = `${Paths.cache.uri}map-tiles`;
const TILE_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const TOWNLANDS_STROKE = "#a855f7";

// Stacking order for overlays. Android Google Maps draws by zIndex (default
// 0 = undefined order between overlays at same level), so without explicit
// values a UrlTile prop change would let the tile render above polygons —
// causing the symptom where designated sites disappear and only flicker
// during zoom (when tiles are mid-refresh). iOS ignores Polygon/UrlTile
// zIndex; there it relies on add-order (MKOverlayLevelAboveLabels).
const Z_BASE_TILE = 0;
const Z_OVERLAY_TILE = 5;
const Z_SITE_POLYGON = 10;
const Z_DESIGNATED = 20;
// Habitats sit between designated sites and buffer rings: surveyor data is
// the user's primary focus on this map, so they should read above NPWS
// context but below the dashed proximity rings (which are thin lines and
// don't fight the fill visually).
const Z_HABITAT = 25;
const Z_BUFFER_RING = 30;
const Z_TOWNLAND = 40;

// `mapType` stays constant regardless of the chosen base map — same value
// the preview screen uses (`satellite` on iOS, `none` on Android). Earlier
// we toggled it per source for iOS so non-satellite bases got Apple's
// standard map underneath, but swapping MKMapView's mapType at runtime
// reseats the base renderer and the surrounding overlays' z-order goes
// with it: designated polygons end up under the new tile and only flicker
// back when a pan/zoom forces a full redraw. Keeping mapType frozen means
// the only thing that changes on a base-map switch is the UrlTile's
// `urlTemplate`/`tileCachePath`, which is enough to repaint the tile
// without disturbing the polygon stack above it. `shouldReplaceMapContent`
// hides the iOS satellite base where our tile has loaded.

export default function ProjectMapScreen() {
  const { id, siteId: initialSiteId, focusHabitatId } = useLocalSearchParams<{
    id: string;
    siteId?: string;
    focusHabitatId?: string;
  }>();
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

  // Layer state — base map + Townlands overlay. Defaults match the
  // historical look (satellite, no overlay) so an empty pref store doesn't
  // change behaviour for existing users; loadMapLayerPrefs hydrates from
  // SQLite asynchronously and may flip the values once it resolves.
  const [baseMap, setBaseMap] = useState<BaseMapId>(DEFAULT_BASE_MAP);
  const [townlandsEnabled, setTownlandsEnabled] = useState(false);
  const [habitatsEnabled, setHabitatsEnabled] = useState(false);
  const [habitats, setHabitats] = useState<HabitatPolygon[]>([]);
  const [selectedHabitat, setSelectedHabitat] = useState<HabitatPolygon | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [townlands, setTownlands] = useState<TownlandFeature[]>([]);
  const [selectedTownland, setSelectedTownland] = useState<TownlandFeature | null>(null);
  const lastTownlandBbox = useRef<TownlandsBbox | null>(null);
  // Latest region cached so the toggle effect can fire an immediate fetch
  // without waiting for the user to pan again.
  const lastRegion = useRef<Region | null>(null);
  const townlandFetchSeq = useRef(0);

  // Hydrate persisted layer prefs once on mount. Failure is non-fatal;
  // loadMapLayerPrefs swallows errors and returns sane defaults.
  useEffect(() => {
    let cancelled = false;
    loadMapLayerPrefs().then((prefs) => {
      if (cancelled) return;
      setBaseMap(prefs.baseMap);
      setTownlandsEnabled(prefs.townlandsEnabled);
      setHabitatsEnabled(prefs.habitatsEnabled);
    });
    return () => { cancelled = true; };
  }, []);

  // Habitat polygons. Lazy-fetched once per project per session — same
  // rationale as fetchDesignatedSites (geometry payload too heavy for the
  // post-login warm pass on multi-project accounts). Fires regardless of
  // the toggle so flipping it on doesn't introduce a fetch delay; render
  // is gated on habitatsEnabled below. isOnline drives a refetch when
  // connectivity returns so a placeholder cache lands on real data.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchProjectHabitats(id)
      .then((rows) => { if (!cancelled) setHabitats(rows); })
      .catch(() => { /* swallow — habitats layer is non-critical */ });
    return () => { cancelled = true; };
  }, [id, isOnline]);

  // Focus-from-detail flow: when the detail screen sends focusHabitatId,
  // force the layer on for this open (the user explicitly asked to see
  // the polygon — overriding a persisted "off" pref is the right move).
  // We don't write the pref back so navigating elsewhere preserves the
  // user's actual preference. Fly-to + sheet open happens once habitats
  // arrive; see the sibling effect below.
  useEffect(() => {
    if (focusHabitatId) setHabitatsEnabled(true);
  }, [focusHabitatId]);

  // Once the habitat list loads (and a focus id was requested), fit the
  // camera to that polygon and pop the bottom sheet. We only run this
  // once per focus-id change so panning the map after arriving doesn't
  // keep snapping back. mapRef may not be ready yet on the first tick if
  // the map is still mounting; the dependency on mapRef.current covers
  // that race because handleMapReady triggers a re-render via state.
  const focusFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusHabitatId || focusFiredRef.current === focusHabitatId) return;
    if (habitats.length === 0) return;
    const target = habitats.find((h) => h.id === focusHabitatId);
    if (!target) return;
    const pieces = habitatPolygonPieces(target.boundary);
    const coords: Array<{ latitude: number; longitude: number }> = [];
    for (const piece of pieces) coords.push(...piece.outer);
    if (coords.length > 0 && mapRef.current) {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 120, right: 60, bottom: 200, left: 60 },
        animated: true,
      });
    }
    setSelectedHabitat(target);
    focusFiredRef.current = focusHabitatId;
  }, [focusHabitatId, habitats]);

  const baseMapConfig = BASE_MAPS[baseMap];

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

  // Townlands fetch driver. Triggered by region changes (onRegionChangeComplete)
  // and by the toggle going on. The toggle path reuses the last region so the
  // overlay paints in immediately if the user is already zoomed in.
  const refreshTownlands = (region: Region | null) => {
    if (!townlandsEnabled || !region) return;
    const screenWidth = Dimensions.get("window").width;
    const zoom = approximateZoom(region.longitudeDelta, screenWidth);
    if (zoom < MIN_TOWNLANDS_ZOOM) {
      // Too zoomed out — Ireland has ~51k townlands, never fetch the lot.
      // Drop any previous render too so the user doesn't see a stale overlay
      // floating over a continental view after panning out.
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
      // Drop stale responses — a faster pan after this fetch started would
      // otherwise let an out-of-date result clobber the current view.
      if (seq !== townlandFetchSeq.current) return;
      setTownlands(features);
    });
  };

  const handleRegionChangeComplete = (region: Region) => {
    lastRegion.current = region;
    refreshTownlands(region);
  };

  // Toggle effect: fire a fetch immediately when townlands turn on (so the
  // user doesn't have to nudge the map), and clear state when they turn off.
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

  const handleToggleHabitats = (enabled: boolean) => {
    setHabitatsEnabled(enabled);
    saveHabitatsPref(enabled);
  };

  // Site-aware habitat list. When the surveyor narrows to one site we hide
  // the rest of the project's habitats — same rationale as buffer rings:
  // unrelated polygons add visual noise once the focus has moved. Habitats
  // with site_id === null (project-wide rows, e.g. legacy imports) stay
  // visible across both modes so they're never accidentally hidden.
  const visibleHabitats = useMemo(() => {
    if (!habitatsEnabled) return [];
    if (!selectedSiteId) return habitats;
    return habitats.filter((h) => h.site_id === selectedSiteId || h.site_id === null);
  }, [habitats, habitatsEnabled, selectedSiteId]);

  // Pre-compute the habitat <Polygon> elements once per data/basemap change.
  // Without this, every selectedHabitat update (i.e. every polygon tap) had
  // the parent re-render the entire .map() over visibleHabitats, recreating
  // hundreds of Polygon JSX objects + closures. On heavy projects (the
  // cadastral-import outliers carry 600+ polygons after MultiPolygon
  // decomposition) the reconciliation cost stalled the JS thread for tens
  // of seconds before the modal could open.
  //
  // Memoising the JSX array breaks that link: tap → state change →
  // reconciler hits the same array reference → no work for the polygon
  // layer, just the modal renders. setSelectedHabitat is a stable setState
  // setter so closing over it inside the memo is safe.
  const habitatPolygonElements = useMemo(() => {
    const out: ReactElement[] = [];
    for (const habitat of visibleHabitats) {
      const pieces = habitatPolygonPieces(habitat.boundary);
      if (pieces.length === 0) continue;
      const fill = habitat.fossitt_code
        ? getFossittColor(habitat.fossitt_code)
        : UNCLASSIFIED_HABITAT_COLOR;
      const stroke = darkenHex(fill, 0.65);
      pieces.forEach((piece, idx) => {
        out.push(
          <Polygon
            key={`${baseMap}-habitat-${habitat.id}-${idx}`}
            coordinates={piece.outer}
            holes={piece.holes.length > 0 ? piece.holes : undefined}
            strokeColor={stroke}
            strokeWidth={2}
            fillColor={`${fill}59`}
            tappable
            onPress={() => setSelectedHabitat(habitat)}
            zIndex={Z_HABITAT}
          />,
        );
      });
    }
    return out;
  }, [visibleHabitats, baseMap]);

  // Same memoisation for designated polygons. They're fewer in count
  // (typically <50 per project), but the same pattern keeps the layers
  // consistent and makes future additions cheaper.
  const designatedPolygonElements = useMemo(() => {
    const out: ReactElement[] = [];
    for (const site of designated) {
      const pieces = polygonsForRender(site.geometry);
      if (pieces.length === 0) continue;
      const colour = getDesignatedSiteColor(site.site_type);
      pieces.forEach((piece, idx) => {
        out.push(
          <Polygon
            key={`${baseMap}-${designatedCacheKey(site)}-${idx}`}
            coordinates={piece.outer}
            holes={piece.holes.length > 0 ? piece.holes : undefined}
            strokeColor={colour}
            strokeWidth={2}
            fillColor={`${colour}40`}
            tappable
            onPress={() => setSelectedDesignated(site)}
            zIndex={Z_DESIGNATED}
          />,
        );
      });
    }
    return out;
  }, [designated, baseMap]);

  // Buffer rings around each site, matching the web map. Each site carries
  // its own buffer_distances (km); when null we fall back to the shared
  // [2, 5] default so an unconfigured project still gives the surveyor
  // proximity context. Rings sort large→small so the painter draws the
  // bigger halo underneath, and we re-buffer only when the boundary or
  // selection changes — turf.buffer is pure-JS but heavy enough that we
  // don't want it firing on every pan.
  const bufferRings = useMemo(() => {
    if (!data) return [];
    const rings: Array<{
      key: string;
      coords: Array<{ latitude: number; longitude: number }>;
      color: string;
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
          });
        });
      }
    };

    if (data.sites.length > 0) {
      // "All Sites" mode rings every site; selecting a single site narrows
      // to its rings only — the surveyor's focus is on that polygon, and
      // unrelated halos around the others would be visual noise.
      for (const site of data.sites) {
        if (selectedSiteId && site.id !== selectedSiteId) continue;
        addRingsFor(site.boundary, site.buffer_distances, `buf-${site.id}`);
      }
    } else if (data.projectBoundary?.geometry) {
      // Site-less project: ring the project boundary with the default
      // distances. We don't carry projects.buffer_distances through the
      // RPC yet, so the default is the only signal here.
      addRingsFor(data.projectBoundary.geometry, null, "buf-project");
    }
    return rings;
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
              // Frozen across base-map switches — see the comment near the
              // top of this file for why toggling mapType broke the polygon
              // z-order.
              mapType={Platform.OS === "android" ? "none" : "satellite"}
              showsUserLocation
              showsMyLocationButton
              toolbarEnabled={false}
              onMapReady={handleMapReady}
              onRegionChangeComplete={handleRegionChangeComplete}
            >
              {/* Base + overlay tiles AND every polygon below carry baseMap
                  in their key. Without this, remounting only the UrlTile on
                  switch makes MKMapView append the new tile to the END of
                  its overlays array, hiding polygons that were added
                  earlier. Remounting both together restores add-order:
                  tile re-enters first, polygons re-enter after, polygons
                  end up on top — same outcome web gets for free via
                  Leaflet's overlayPane. Cost is a single-frame flicker on
                  switch, which is the trade-off the web team's brief
                  explicitly accepts. zIndex props stay for Android Google
                  Maps where they're respected; iOS ignores them, so the
                  add-order pattern is what carries the day there. */}
              <UrlTile
                key={`base-${baseMap}`}
                urlTemplate={resolveTileUrl(baseMapConfig.base)}
                maximumZ={baseMapConfig.base.maxZoom}
                flipY={false}
                shouldReplaceMapContent
                tileCachePath={resolveTileCachePath(TILE_CACHE_PATH, baseMapConfig.base)}
                tileCacheMaxAge={TILE_CACHE_MAX_AGE_SECONDS}
                zIndex={Z_BASE_TILE}
              />
              {/* Optional overlay (Hybrid uses ESRI's labels layer over its
                  imagery). shouldReplaceMapContent stays false — we *want*
                  the satellite below to keep painting. */}
              {baseMapConfig.overlay && (
                <UrlTile
                  key={`overlay-${baseMap}`}
                  urlTemplate={resolveTileUrl(baseMapConfig.overlay)}
                  maximumZ={baseMapConfig.overlay.maxZoom}
                  flipY={false}
                  tileCachePath={resolveTileCachePath(TILE_CACHE_PATH, baseMapConfig.overlay)}
                  tileCacheMaxAge={TILE_CACHE_MAX_AGE_SECONDS}
                  zIndex={Z_OVERLAY_TILE}
                />
              )}
              {data?.sites.map((site) => {
                const coords = polygonToCoordinates(site.boundary);
                if (coords.length === 0) return null;
                const isPrimary = selectedSiteId === null || site.id === selectedSiteId;
                return (
                  <Polygon
                    key={`${baseMap}-${site.id}`}
                    coordinates={coords}
                    strokeColor={isPrimary ? colors.primary.DEFAULT : "#94a3b8"}
                    strokeWidth={isPrimary ? 3 : 1.5}
                    fillColor={isPrimary ? colors.primary.DEFAULT + "33" : "transparent"}
                    zIndex={Z_SITE_POLYGON}
                  />
                );
              })}
              {/* Project-level boundary fallback when no site polygons exist. */}
              {data && data.sites.length === 0 && data.projectBoundary?.geometry && (
                <Polygon
                  key={`${baseMap}-boundary`}
                  coordinates={polygonToCoordinates(data.projectBoundary.geometry)}
                  strokeColor={colors.primary.DEFAULT}
                  strokeWidth={3}
                  fillColor={colors.primary.DEFAULT + "33"}
                  zIndex={Z_SITE_POLYGON}
                />
              )}

              {/* Designated sites + habitat polygons are rendered from
                  pre-memoised JSX arrays so polygon-tap state changes
                  don't trigger O(N) reconciliation against the layer.
                  See the useMemo definitions above for why. */}
              {designatedPolygonElements}
              {habitatPolygonElements}

              {/* Buffer rings. Painted after designated sites (per parity
                  with web) so the dashed outline reads cleanly over NPWS
                  fills. Fill is at ~5% alpha (0x0D) and the stroke uses
                  lineDashPattern so concentric rings stay distinguishable
                  even when they overlap. */}
              {bufferRings.map((ring) => (
                <Polygon
                  key={`${baseMap}-${ring.key}`}
                  coordinates={ring.coords}
                  strokeColor={ring.color}
                  strokeWidth={2}
                  fillColor={`${ring.color}0D`}
                  lineDashPattern={[5, 5]}
                  zIndex={Z_BUFFER_RING}
                />
              ))}

              {/* Townlands overlay. Drawn after designated sites so the
                  thin purple outlines remain visible across both light
                  imagery and dark vector bases. Fill stays transparent —
                  ~51k polygons of any solid colour would obliterate the
                  underlying map at typical zooms. */}
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
                    zIndex={Z_TOWNLAND}
                  />
                ));
              })}
            </MapView>

            <MapLayersControl
              baseMap={baseMap}
              onSelectBaseMap={handleSelectBaseMap}
              townlandsEnabled={townlandsEnabled}
              onToggleTownlands={handleToggleTownlands}
              habitatsEnabled={habitatsEnabled}
              onToggleHabitats={handleToggleHabitats}
              visible={layersOpen}
              onOpen={() => setLayersOpen(true)}
              onClose={() => setLayersOpen(false)}
            />

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
        <TownlandDetailModal
          feature={selectedTownland}
          onClose={() => setSelectedTownland(null)}
        />
        <HabitatMapModal
          habitat={selectedHabitat}
          onClose={() => setSelectedHabitat(null)}
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
