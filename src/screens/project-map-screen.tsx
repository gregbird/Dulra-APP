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
import MapView, { Marker, Polygon, PROVIDER_DEFAULT, UrlTile, type MapPressEvent, type Region } from "react-native-maps";
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
  getMemoryProjectBoundary,
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
  type RenderPiece as DesignatedRenderPiece,
} from "@/lib/designated-sites";
import {
  fetchHabitatsInBbox,
  fetchProjectHabitats,
  getHabitatsForProject,
  habitatPolygonPieces,
  habitatBboxSpanDegrees,
  habitatGeometryBbox,
  bboxFromCoords,
  bboxesIntersect,
  expandBboxByMeters,
  bboxAreaKm2,
  bboxesEqualish,
  darkenHex,
  invalidateHabitatsMemoryCache,
  type HabitatBbox,
  type HabitatRenderPiece,
} from "@/lib/habitats";
import {
  fetchNlcInBbox,
  bboxToBinKey as bboxToNlcBinKey,
  centroidOfRing,
  pointInRing,
  MIN_NLC_RENDER_ZOOM,
  type NlcBbox,
  type NlcFeature,
} from "@/lib/nlc";
import { nlcColorFor } from "@/lib/nlc-colors";
import NlcDetailModal from "@/components/nlc-detail-modal";
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
  saveNlcPref,
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

// Habitat polygons smaller than this many screen pixels at the current
// zoom are skipped — they're invisible noise but each one still costs a
// native overlay add through the react-native-maps bridge. 6 px is the
// smallest a stroke + fill remain readable on a typical handset; below
// it the user can't distinguish individual polygons anyway.
const MIN_HABITAT_PIXELS = 6;
const SCREEN_WIDTH = Dimensions.get("window").width;

// Aggressive iOS diagnostic mode — earlier rounds with cap=100 + 64-vertex
// decimation still froze. We're now deliberately well below any plausible
// MKMapView ceiling so a continued freeze proves the bottleneck is *not*
// polygon mount (and we can stop chasing that lead). Android stays loose
// because Google Maps batches overlay adds natively.
const MAX_HABITAT_POLYGONS = Platform.OS === "ios" ? 20 : 500;
// No client-side decimation. Server already returns saved habitats
// simplified at ~5 m (`ST_SimplifyPreservetopology(0.00005)`); throwing
// further vertices away at the client made the high-zoom angular
// segments worse — a 60-vertex source polygon was being stride-cut to
// 32, producing visible triangles where there were none in the source.
// The 20-polygon render cap keeps total bridge load bounded
// (20 polygons × ~60 verts ≈ 1.2k verts — trivial on iOS) so removing
// decimation is free in perf terms.
//
// Real fix for the residual triangle artifact at z >= 17 needs a
// backend tolerance parameter on get_habitats_in_bbox so mobile can
// request finer simplification at parcel zoom — queued for web team.
const MAX_VERTICES_PER_RING: number | undefined = undefined;
// On iOS we also drop holes (donut shapes become solid fills) and
// tappable hit-tests for habitats. Hit-test region construction scales
// with vertex count and overlay count — disabling it cuts a chunk of
// MKMapView's per-overlay setup. The detail sheet is still reachable
// from the Habitats list tab, so this is a measured trade, not a feature
// loss.
const HABITAT_TAPPABLE = Platform.OS !== "ios";
const HABITAT_RENDER_HOLES = Platform.OS !== "ios";

// Spec § 4: when the visible viewport bbox covers more than 50 km² we
// skip the fetch and surface a "zoom in" hint. PostGIS would still cope
// at the server but the result set would re-introduce the very problem
// viewport loading exists to prevent — too many native overlays at once.
const VIEWPORT_AREA_LIMIT_KM2 = 50;

// 100 m skirt around the focus geometry on first open. Spec default —
// gives the surveyor a small bleed of habitats just outside the site
// boundary so they can spot edge-of-site features without panning.
const INITIAL_BBOX_BUFFER_METERS = 100;

// Pan/zoom debounce. Long enough that an inertial swipe settles into a
// single fetch, short enough that the user perceives the result as
// "live" with their interaction.
const VIEWPORT_FETCH_DEBOUNCE_MS = 400;

// Vertex cap for designated (NPWS) site polygons. Geometry comes
// pre-simplified at ~11 m server-side per the lib/designated-sites
// note, but a single SAC can still ship ~5000 vertices when its
// geometry is genuinely complex (e.g. estuarine sites). Same iOS
// bridge cost equation as habitats: vertex count dominates.
const DESIGNATED_MAX_VERTICES_PER_RING = Platform.OS === "ios" ? 96 : undefined;

// Final overlay cap for designated polygons (post-MultiPolygon split).
// Outlier projects sit near 50+ NPWS sites with several pieces each;
// without a cap that's hundreds of MKPolygons mounting alongside the
// habitat layer at fitToCoordinates time, which is the bulk of the
// "open project, frozen for 15 s" report.
const MAX_DESIGNATED_POLYGONS = Platform.OS === "ios" ? 25 : 200;

// Minimum camera zoom level before any habitat polygon is rendered.
// Roughly: zoom 14 ≈ city block, 15 ≈ small parcels, 16 ≈ individual
// buildings. Surveyors care about polygon detail at parcel scale, not
// at "I can see the whole town" scale, and rendering even a few stray
// polygons at low zoom feels like noise. Below this threshold the
// layer paints nothing — the size-cull below would still drop most of
// them but a hard floor is clearer to the user. Tunable.
const MIN_HABITAT_RENDER_ZOOM = 14;

// Zoom-aware Douglas-Peucker tolerance for the saved-habitat
// `get_habitats_in_bbox` RPC. Tighter tolerance at high zoom kills the
// "triangle artifact" on parcel edges — the visible angular segments
// surveyors reported come straight from the server's default 5 m
// simplification, which is fine at overview zoom but coarse at parcel
// scale. The web team added the optional `p_tolerance` param for this;
// we send progressively tighter values as the camera zooms in.
//
// Returning `undefined` makes lib/habitats.ts omit the param entirely
// so the RPC uses its default (0.00005 = ~5 m) and the server returns
// byte-identical bytes to the pre-tolerance-param era.
function toleranceForZoom(zoom: number | null): number | undefined {
  if (zoom == null) return undefined;
  if (zoom < 16) return undefined; // ~5 m default — fine at overview
  if (zoom < 18) return 0.000005;  // ~50 cm at parcel zoom
  return 0.000003;                  // ~30 cm at building zoom (matches NLC)
}

// NLC reference layer overlay caps. iOS keeps the same vertex
// decimation as habitats (32) for bridge parity; render cap is
// slightly higher because NLC parcels are typically smaller and the
// user expects denser coverage at z >= 16. See plan § 4.
const MAX_NLC_POLYGONS = Platform.OS === "ios" ? 200 : 1000;
// No decimation for NLC. Web team's Maynooth pre-flight measured
// ~30.7 vertices per ring on average post-quantization, so a 32-vertex
// stride cap was clipping the small minority of complex rings (long
// hedgerows, building cluster outlines) and producing the "triangle
// artifact" the layer was supposed to eliminate. With cap=200 polygons
// and ~30 avg vertices, total bridge payload is ~100 KB even
// uncapped — well inside iOS's bandwidth. If we ever see freezes
// here again, set this to ~128 (covers >99% of rings cleanly) or
// switch to Douglas-Peucker simplification instead of stride.
const MAX_NLC_VERTICES_PER_RING: number | undefined = undefined;

// Labels for NLC parcels show only at z >= 17 — at z 16 viewports are
// wide enough that the LEVEL_2_ID density would re-introduce Marker
// bridge cost issues. At z 17 we typically see ~5 distinct codes at a
// time, so the cost is bounded. Anti-duplicate rule from web spec:
// only the largest polygon per LEVEL_2_ID gets a label.
const MIN_NLC_LABEL_ZOOM = 17;
const MAX_NLC_LABELS = 15;

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
  // Hydrate from the module-level boundary cache if the preview map (or
  // a previous mount of this screen) already fetched the project's
  // boundary. With a hot cache the spinner never shows — the MapView
  // renders during the navigation transition and the camera is fitted
  // immediately. Cold cache falls back to the loading flow.
  const cachedBoundary = id ? getMemoryProjectBoundary(id) : null;
  const [data, setData] = useState<ProjectBoundary | null>(cachedBoundary);
  const [designated, setDesignated] = useState<DesignatedSite[]>([]);
  const [selectedDesignated, setSelectedDesignated] = useState<DesignatedSite | null>(null);
  const [sites, setSites] = useState<ProjectSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(initialSiteId ?? null);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(cachedBoundary == null);
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
  // NLC reference layer toggle. Default ON to match expected
  // surveyor behaviour — they zoom in past 16 and expect the
  // reference parcels to appear automatically. Pref is loaded
  // async so the initial state may flip once `loadMapLayerPrefs`
  // resolves.
  const [nlcEnabled, setNlcEnabled] = useState(true);
  const [habitats, setHabitats] = useState<HabitatPolygon[]>([]);
  const [selectedHabitat, setSelectedHabitat] = useState<HabitatPolygon | null>(null);
  // NLC reference parcels (z >= 16). Fetched per-viewport from the
  // Esri FeatureServer; bin cache lives in lib/nlc.ts. State only
  // holds the *current* response — pan to a new bin replaces it
  // (cache hit makes that instant). Render gated on layerMode below.
  const [nlcFeatures, setNlcFeatures] = useState<NlcFeature[]>([]);
  const lastNlcBinKeyRef = useRef<string | null>(null);
  const nlcAbortRef = useRef<AbortController | null>(null);
  const [selectedNlc, setSelectedNlc] = useState<NlcFeature | null>(null);
  // Live zoom span in degrees (the camera's longitudeDelta), updated only
  // on significant zoom changes — see handleRegionChangeComplete. Drives
  // the skip-when-tiny cull below. Null until the first regionChange
  // fires; the effective threshold falls back to a project-bbox-derived
  // initial estimate so the cull applies on first mount.
  const [zoomLngDelta, setZoomLngDelta] = useState<number | null>(null);
  // IDs of habitat polygons currently mounted on the map. Grown over
  // multiple animation frames — see the progressive-mount effect — so
  // adding hundreds of native overlays through the react-native-maps
  // bridge doesn't block the JS thread for tens of seconds at once. The
  // map appears almost immediately and polygons paint in over ~1-2 s
  // while the user can already pan, tap the layers FAB, or pick sites.
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
      setNlcEnabled(prefs.nlcEnabled);
    });
    return () => { cancelled = true; };
  }, []);

  // setTimeout-driven mount budget. The earlier requestAnimationFrame
  // version scheduled each tick before the next paint — but on iOS the
  // bridge commit for a single MKPolygon can take 100-300 ms, which
  // collides with the next rAF firing immediately. The result was a
  // tight loop where the JS thread was always either committing or
  // about to commit, with no real idle window for gesture events to
  // process. setTimeout(POLYGON_MOUNT_INTERVAL_MS) interleaves a hard
  // pause every tick — gestures get a guaranteed slot.
  //
  // Pacing: 50 ms × ~140 polygons = ~7 s total mount time worst-case.
  // The map is interactive from the first frame; polygons stream in
  // at a visibly progressive but not-jarring rate.
  const POLYGON_MOUNT_INTERVAL_MS = 50;
  const [polygonMountBudget, setPolygonMountBudget] = useState(0);
  const polygonMountTarget = MAX_HABITAT_POLYGONS + MAX_DESIGNATED_POLYGONS;
  useEffect(() => {
    if (polygonMountBudget >= polygonMountTarget) return;
    const handle = setTimeout(() => {
      setPolygonMountBudget((b) => Math.min(b + 1, polygonMountTarget));
    }, POLYGON_MOUNT_INTERVAL_MS);
    return () => clearTimeout(handle);
  }, [polygonMountBudget, polygonMountTarget]);

  // Reset the project's accumulating habitat store on every fresh map
  // mount. Across-session accumulation was producing the "open project,
  // freezes for 2 minutes" symptom — earlier sessions panned across the
  // project and merged dozens-to-hundreds of rows into the module
  // store; the next session's first render had to push all of those
  // through every memo (sortedHabitats, habitatBboxSizes,
  // habitatFullBboxes) before any polygon could paint.
  //
  // Within a session the store still accumulates as the user pans, so
  // returning to a previously-loaded area paints instantly. Across
  // sessions / mounts we start fresh, which matches the spec's intent
  // (default open = site/project + 100 m, not "everything ever loaded").
  useEffect(() => {
    if (!id) return;
    invalidateHabitatsMemoryCache(id);
    // Clear local mirror too — otherwise the previous mount's array
    // would render briefly before the fresh fetch lands.
    setHabitats([]);
    // Run only on project change / fresh mount; don't re-clear on
    // unrelated state changes within the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Habitat polygons follow a viewport-loading model — see the spec at
  // `docs/habitats-bbox-rpc-migration.sql.md`. There is no "fetch the
  // whole project" path on this screen anymore; instead:
  //
  //   1. INITIAL FETCH (initialBboxFetchedRef effect below) — once the
  //      project boundary loads, request habitats inside the focus
  //      geometry + 100 m buffer. The user sees a small skirt of
  //      polygons around the site they're starting on.
  //
  //   2. PAN/ZOOM (handleRegionChangeComplete debounced effect) — every
  //      ~400 ms after the camera settles, request habitats inside the
  //      visible viewport. Results merge into the module-level store
  //      (id-based dedupe), so polygons the user has already seen stay
  //      mounted as they pan onward.
  //
  //   3. ZOOM GUARD — viewport > VIEWPORT_AREA_LIMIT_KM2 → skip the
  //      fetch and surface a banner. Prevents country-scale viewports
  //      from re-introducing the "1000 polygons at once" failure mode.
  //
  // The local `habitats` state mirrors the module store after each
  // fetch; we don't subscribe directly to the store because React
  // doesn't observe Map mutations.
  const [viewportTooLarge, setViewportTooLarge] = useState(false);

  // (Initial site+100m fetch removed. The map opens at project fit-zoom
  // which sits below MIN_HABITAT_RENDER_ZOOM, so any prefetch was
  // wasted work — habitats wouldn't render at that zoom anyway, but
  // the fetch + JSON parse + state cascade froze the JS thread for
  // tens of seconds on cadastral-import projects. Habitats now load
  // strictly on demand: when the user zooms in past the threshold,
  // the viewport-driven fetch effect below picks up the next region
  // change and pulls just what's on screen.)

  // Viewport-driven fetch — fired by handleRegionChangeComplete via the
  // pendingViewportBbox state. Debounced through a useEffect timer so
  // fast pans coalesce into a single RPC. Zoom guard ducks the call
  // when the viewport is too wide; the banner is wired off the same
  // `viewportTooLarge` flag.
  const [pendingViewportBbox, setPendingViewportBbox] = useState<HabitatBbox | null>(null);
  const lastFetchedBboxRef = useRef<HabitatBbox | null>(null);

  // Camera focus + zoom + layer-mode chain. Declared up here (instead
  // of next to the other geometry memos) because the viewport-fetch
  // effects below need to gate on `layerMode`. With these defined
  // late we hit a TDZ from the effect's reference. They depend only
  // on already-declared state (`data`, `selectedSiteId`,
  // `pendingViewportBbox`, `zoomLngDelta`, `habitatsEnabled`).
  const focusCoords = useMemo(() => {
    if (!data) return [];
    if (selectedSiteId) {
      const site = data.sites.find((s) => s.id === selectedSiteId);
      const sitePoly = polygonToCoordinates(site?.boundary ?? null);
      if (sitePoly.length > 0) return sitePoly;
    }
    return flattenBoundaryCoordinates(data);
  }, [data, selectedSiteId]);

  const initialZoomLngDelta = useMemo(() => {
    if (focusCoords.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const c of focusCoords) {
      if (c.longitude < min) min = c.longitude;
      if (c.longitude > max) max = c.longitude;
    }
    if (!isFinite(min) || max === min) return null;
    return (max - min) * 1.4;
  }, [focusCoords]);

  const effectiveZoomDelta = zoomLngDelta ?? initialZoomLngDelta;

  const initialViewportBbox = useMemo(() => {
    return bboxFromCoords(focusCoords);
  }, [focusCoords]);

  const effectiveViewport = pendingViewportBbox ?? initialViewportBbox;

  const currentZoom = useMemo(() => {
    if (effectiveViewport) {
      const lngDelta = effectiveViewport.maxLng - effectiveViewport.minLng;
      if (lngDelta > 0) return approximateZoom(lngDelta, SCREEN_WIDTH);
    }
    if (effectiveZoomDelta != null) {
      return approximateZoom(effectiveZoomDelta, SCREEN_WIDTH);
    }
    return null;
  }, [effectiveViewport, effectiveZoomDelta]);

  type LayerMode = "none" | "habitats" | "nlc";
  const layerMode: LayerMode = useMemo(() => {
    if (!habitatsEnabled) return "none";
    if (currentZoom == null) return "none";
    if (currentZoom < MIN_HABITAT_RENDER_ZOOM) return "none";
    if (currentZoom < MIN_NLC_RENDER_ZOOM) return "habitats";
    // z >= 16: NLC takes over when its toggle is on; otherwise we
    // continue showing the saved-habitat layer so the user's own
    // data stays visible at high zoom. Saved habitats at this zoom
    // surface their 5 m server-side simplification as visible
    // angular segments — that's the "triangle artifact" surveyors
    // report. The proper fix requires a backend tolerance
    // parameter on get_habitats_in_bbox (web team to action), not
    // hiding the layer here.
    return nlcEnabled ? "nlc" : "habitats";
  }, [habitatsEnabled, nlcEnabled, currentZoom]);

  // Skip viewport-driven fetches during the initial fitToCoordinates
  // animation (~1.5 s). iOS fires regionChangeComplete multiple times
  // during the camera fit and each fire kicked off a fresh bbox RPC,
  // producing the "6+ parallel fetches stacking on the JS thread" we
  // saw in logs (42, 23, 22, 7, 17, 4, 39, 6 rows). Once the gate
  // flips on, normal pan/zoom behaviour resumes.
  const [viewportFetchUnlocked, setViewportFetchUnlocked] = useState(false);
  useEffect(() => {
    const handle = setTimeout(() => setViewportFetchUnlocked(true), 1500);
    return () => clearTimeout(handle);
  }, []);
  useEffect(() => {
    if (!id || !habitatsEnabled || !pendingViewportBbox || !viewportFetchUnlocked) return;
    // Mode guard: this effect only runs when the saved-habitat layer is
    // the active visible layer. At zoom >= 16 the NLC layer takes over
    // (separate effect below); zoom < 14 the screen renders nothing and
    // we surface the "Zoom in" banner. Without this guard we'd keep
    // hammering the Supabase RPC while the user pans around the NLC
    // detail layer.
    if (layerMode !== "habitats") {
      // Below MIN_HABITAT_RENDER_ZOOM: surface the zoom hint. Above
      // MIN_NLC_RENDER_ZOOM we don't want the banner — NLC is loading.
      if (layerMode === "none") setViewportTooLarge(true);
      return;
    }
    const bbox = pendingViewportBbox;
    // Guard 1: viewport too large → skip fetch, surface banner.
    if (bboxAreaKm2(bbox) > VIEWPORT_AREA_LIMIT_KM2) {
      setViewportTooLarge(true);
      return;
    }
    setViewportTooLarge(false);
    // Guard 2: same bbox we just fetched → no-op.
    if (lastFetchedBboxRef.current && bboxesEqualish(lastFetchedBboxRef.current, bbox)) {
      return;
    }
    const tolerance = toleranceForZoom(currentZoom);
    const timer = setTimeout(() => {
      lastFetchedBboxRef.current = bbox;
      fetchHabitatsInBbox(id, selectedSiteId ?? null, bbox, { tolerance })
        .then((rows) => setHabitats(rows))
        .catch(() => { /* swallow */ });
    }, VIEWPORT_FETCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [id, habitatsEnabled, selectedSiteId, pendingViewportBbox, viewportFetchUnlocked, layerMode, currentZoom]);

  // NLC viewport fetch — fires when the user crosses into the z >= 16
  // detail layer. Mirrors the saved-habitat fetch flow but goes against
  // the Esri FeatureServer (paged GeoJSON, bin-cached inside lib/nlc.ts)
  // and stores results in a separate state slot. Bin cache means a small
  // pan inside the same 0.005° bin replays without a network round-trip.
  useEffect(() => {
    if (!habitatsEnabled || layerMode !== "nlc" || !pendingViewportBbox || !viewportFetchUnlocked) {
      return;
    }
    setViewportTooLarge(false);
    const bbox: NlcBbox = {
      minLng: pendingViewportBbox.minLng,
      minLat: pendingViewportBbox.minLat,
      maxLng: pendingViewportBbox.maxLng,
      maxLat: pendingViewportBbox.maxLat,
    };
    // Bin-key dedupe: a tiny pan within the same 0.005° bin is a no-op.
    // The library's bin cache will also short-circuit if the request
    // does fire — this guard just avoids the debounce timer churn.
    const key = bboxToNlcBinKey(bbox);
    if (lastNlcBinKeyRef.current === key) return;

    const timer = setTimeout(() => {
      // Cancel any previous in-flight NLC fetch so a fast pan doesn't
      // pile multiple requests on the JS thread.
      nlcAbortRef.current?.abort();
      const controller = new AbortController();
      nlcAbortRef.current = controller;
      lastNlcBinKeyRef.current = key;
      fetchNlcInBbox(bbox, { signal: controller.signal })
        .then((result) => {
          // latestKey guard — if the user has panned to a different bin
          // since this fetch started, the response is stale; drop it.
          if (lastNlcBinKeyRef.current !== key) return;
          setNlcFeatures(result.features);
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log(
              `[nlc] fetch → ${result.features.length} features${result.truncated ? " (truncated)" : ""}`,
            );
          }
        })
        .catch((err: unknown) => {
          // Aborts are expected; everything else is a non-critical
          // layer failure — silent.
          const name = (err as { name?: string } | null)?.name;
          if (name !== "AbortError" && __DEV__) {
            // eslint-disable-next-line no-console
            console.warn(`[nlc] fetch error:`, err);
          }
        });
    }, VIEWPORT_FETCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [habitatsEnabled, layerMode, pendingViewportBbox, viewportFetchUnlocked]);

  // When we leave NLC mode (zoom out, toggle off, project change), drop
  // the NLC features from state and abort any in-flight fetch. Without
  // this, the leftover features would still feed the render memo at the
  // moment of mode flip and the user would see a single-frame flash of
  // NLC polygons over the saved-habitat layer.
  useEffect(() => {
    if (layerMode !== "nlc") {
      nlcAbortRef.current?.abort();
      nlcAbortRef.current = null;
      lastNlcBinKeyRef.current = null;
      if (nlcFeatures.length > 0) setNlcFeatures([]);
    }
    // We deliberately do not include nlcFeatures in deps — that would
    // re-fire the cleanup on every fetch resolution. We just want the
    // mode-transition trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerMode]);

  // When the toggle flips off, clear any pending state but DO NOT clear
  // the module store — the user may flip it back on and we want their
  // accumulated polygons still there. The `habitats` state empties via
  // habitatsEnabled in the visibleHabitats memo below.
  useEffect(() => {
    if (!habitatsEnabled) {
      setViewportTooLarge(false);
      setPendingViewportBbox(null);
      lastFetchedBboxRef.current = null;
    } else if (id) {
      // When re-enabled, hydrate state from whatever the store already
      // has for this project (e.g. from a prior session that called
      // fetchHabitatsInBbox before the user toggled it off).
      setHabitats(getHabitatsForProject(id, selectedSiteId ?? null));
    }
  }, [habitatsEnabled, id, selectedSiteId]);

  // Focus-from-detail flow: when the detail screen sends focusHabitatId,
  // force the layer on for this open (the user explicitly asked to see
  // the polygon — overriding a persisted "off" pref is the right move).
  // We don't write the pref back so navigating elsewhere preserves the
  // user's actual preference. Fly-to + sheet open happens once habitats
  // arrive; see the sibling effect below.
  useEffect(() => {
    if (focusHabitatId) setHabitatsEnabled(true);
  }, [focusHabitatId]);

  // Focus fallback: if the requested polygon isn't inside the initial
  // bbox (cadastral imports occasionally have rows that sit outside the
  // project skirt), the focus effect below would never fire because
  // `habitats` wouldn't contain the target. Detect that and run the
  // explicit "Show all" fetch — this is a user-initiated jump from the
  // detail screen, so paying for the legacy RPC once is the right call.
  // Guarded so we only fall back once per focus id.
  const focusFallbackFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !focusHabitatId) return;
    if (habitats.some((h) => h.id === focusHabitatId)) return;
    if (focusFallbackFiredRef.current === focusHabitatId) return;
    // We only enter this branch after the initial bbox fetch has had a
    // chance to populate `habitats`. Empty array is fine — could mean
    // the bbox call hasn't returned yet; we'd retry on the next render.
    // To avoid a tight loop, we mark fired immediately and rely on the
    // promise's setHabitats to re-render with the target.
    focusFallbackFiredRef.current = focusHabitatId;
    fetchProjectHabitats(id, selectedSiteId ?? null)
      .then((rows) => setHabitats(rows))
      .catch(() => { /* swallow — focus polygon might just not exist */ });
  }, [id, focusHabitatId, habitats, selectedSiteId]);

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
    const prev = lastRegion.current;
    lastRegion.current = region;
    refreshTownlands(region);
    // Push zoom into state only on a *significant* zoom change. Pure
    // pans don't change which polygons are too small to render, and
    // re-running the habitat filter for them would mean repeated
    // bridge traffic on every drag. Threshold: roughly ±20% on the
    // longitude delta (log-distance ≥ 0.2), matched empirically to
    // human-perceptible zoom steps.
    if (!prev || Math.abs(Math.log(region.longitudeDelta / prev.longitudeDelta)) > 0.2) {
      setZoomLngDelta(region.longitudeDelta);
    }
    // Push the viewport bbox into state so the debounced fetch effect
    // above picks it up. We don't fetch directly here so a fast inertial
    // pan / pinch (which fires multiple regionChangeComplete events
    // within tens of ms on iOS) collapses into a single RPC.
    //
    // Equality guard is critical: iOS fires regionChangeComplete several
    // times during the initial fitToCoordinates animation, each with a
    // bbox that's effectively the same. Without bboxesEqualish dedupe,
    // every fire created a fresh object → re-render → visibleHabitats
    // memo invalidated → progressive-mount effect cancelled mid-rAF →
    // tick never fired → mountedHabitatIds stayed empty → render kept
    // showing 0 polygons forever. That was the actual cause of the
    // "render → 0 polygons" log loop with no progress.
    if (habitatsEnabled) {
      const bbox: HabitatBbox = {
        minLng: region.longitude - region.longitudeDelta / 2,
        minLat: region.latitude - region.latitudeDelta / 2,
        maxLng: region.longitude + region.longitudeDelta / 2,
        maxLat: region.latitude + region.latitudeDelta / 2,
      };
      setPendingViewportBbox((prev) =>
        prev && bboxesEqualish(prev, bbox) ? prev : bbox,
      );
    }
  };

  // Tap → JS-side hit test against the visible NLC piece cache. We use
  // MapView.onPress (instead of per-polygon `tappable` on iOS) because
  // the native hit-test region build for hundreds of polygons was the
  // hidden half of the iOS freeze pre-commit-02859c2 — see plan § 6.
  // On Android the per-polygon onPress fires too (HABITAT_TAPPABLE
  // is true), so we early-return here to avoid double-fire on a single
  // tap.
  const handleMapPress = (e: MapPressEvent) => {
    if (Platform.OS !== "ios") return;
    if (layerMode !== "nlc" || nlcFeatures.length === 0) return;
    const coord = e.nativeEvent.coordinate;
    if (!coord) return;
    // Walk the visible features; pick the smallest matching polygon
    // (by area) so a tap on overlapping parcel edges resolves to the
    // most specific (innermost) parcel. bbox-cull first, PIP only when
    // bbox contains the point.
    let best: NlcFeature | null = null;
    let bestArea = Infinity;
    for (const feature of nlcFeatures) {
      const cached = nlcPiecesCacheRef.current.get(feature.id);
      if (!cached) continue;
      for (const { piece, bbox } of cached) {
        if (!bbox) continue;
        if (
          coord.longitude < bbox.minLng ||
          coord.longitude > bbox.maxLng ||
          coord.latitude < bbox.minLat ||
          coord.latitude > bbox.maxLat
        ) continue;
        if (pointInRing(coord, piece.outer)) {
          const area = feature.area ?? Infinity;
          if (area < bestArea) {
            best = feature;
            bestArea = area;
          }
        }
      }
    }
    if (best) setSelectedNlc(best);
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

  const handleToggleNlc = (enabled: boolean) => {
    setNlcEnabled(enabled);
    saveNlcPref(enabled);
  };

  // Per-habitat bbox span in degrees, computed once per habitats array.
  // Cheap (single sweep over each polygon's coordinates) and reused by
  // the skip-when-tiny filter on every zoom step, so paying for it once
  // beats recomputing inside the filter.
  const habitatBboxSizes = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of habitats) {
      const span = habitatBboxSpanDegrees(h.boundary);
      if (span != null) map.set(h.id, span);
    }
    return map;
  }, [habitats]);

  // Per-habitat full bbox (min/max lng/lat). Powers the row-level
  // viewport AABB filter in visibleHabitats. Same single-sweep cost as
  // habitatBboxSizes.
  const habitatFullBboxes = useMemo(() => {
    const map = new Map<string, HabitatBbox>();
    for (const h of habitats) {
      const bb = habitatGeometryBbox(h.boundary);
      if (bb) map.set(h.id, bb);
    }
    return map;
  }, [habitats]);

  // Stable area-descending order. Computed once per habitats array (not
  // per filter step) so the hard cap below picks a consistent top-N
  // regardless of which other polygons get culled by site / zoom — a
  // polygon that's in the top-N at one zoom stays in it at the next,
  // which keeps the visual layer stable as the user zooms in/out.
  const sortedHabitats = useMemo(() => {
    return [...habitats].sort((a, b) => (b.area_hectares ?? 0) - (a.area_hectares ?? 0));
  }, [habitats]);

  // Coords the camera will fit on first paint — selected site if there
  // is one, else the project-wide bbox. Used to seed both the initial
  // viewport bbox and the initial zoom estimate so they match what
  // fitToCoordinates will actually produce. Without this, the first
  // render briefly used project-wide coords even when the user had a
  // small site selected, leaving the viewport AABB filter too loose
  // and rendering polygons that aren't on screen.
  // Site-aware habitat list. When the surveyor narrows to one site we hide
  // the rest of the project's habitats — same rationale as buffer rings:
  // unrelated polygons add visual noise once the focus has moved. Habitats
  // with site_id === null (project-wide rows, e.g. legacy imports) stay
  // visible across both modes so they're never accidentally hidden.
  //
  // After the site filter, an additional zoom-aware size cull drops any
  // polygon whose bbox is smaller than ~MIN_HABITAT_PIXELS at the current
  // zoom. At fit-zoom on a county-scale project that filters out most
  // sub-100m polygons (invisible anyway); zooming in naturally lifts the
  // threshold and brings them back.
  const visibleHabitats = useMemo(() => {
    // layerMode handles both the toggle-off and zoom-floor cases plus
    // the z >= 16 handoff to the NLC layer (saved habitats hide so
    // coarse + detail aren't visible together).
    if (layerMode !== "habitats") return [];
    let rows = sortedHabitats;
    if (selectedSiteId) {
      rows = rows.filter((h) => h.site_id === selectedSiteId || h.site_id === null);
    }
    // Viewport AABB filter — the central guard that makes accumulating
    // store + bounded rendering coexist. Even if the user has panned
    // across the whole project and the store holds 1000 polygons, only
    // those whose bbox actually intersects the camera region get
    // mounted. Pan back to a previously-visited area → those polygons
    // re-mount from the store with no RPC. Zoom out beyond the project
    // → the 50 km² zoom guard above stops fetches; existing polygons
    // still render but at low zoom they get dropped by the size cull
    // below anyway.
    if (effectiveViewport && habitatFullBboxes.size > 0) {
      rows = rows.filter((h) => {
        const bb = habitatFullBboxes.get(h.id);
        return bb == null || bboxesIntersect(bb, effectiveViewport);
      });
    }
    if (effectiveZoomDelta != null && habitatBboxSizes.size > 0) {
      const minDegSize = (MIN_HABITAT_PIXELS / SCREEN_WIDTH) * effectiveZoomDelta;
      rows = rows.filter((h) => {
        const span = habitatBboxSizes.get(h.id);
        // Unknown size → keep (better to render an unsized polygon than
        // silently drop it). Known but tiny → skip.
        return span == null || span >= minDegSize;
      });
    }
    // Hard cap, last line of defence. With viewport + size filters in
    // place this normally never bites; kept as a safety net for
    // pathological inputs (e.g. a single polygon covering the whole
    // viewport at zoom-out).
    if (rows.length > MAX_HABITAT_POLYGONS) {
      rows = rows.slice(0, MAX_HABITAT_POLYGONS);
    }
    return rows;
  }, [
    sortedHabitats,
    layerMode,
    selectedSiteId,
    effectiveZoomDelta,
    habitatBboxSizes,
    effectiveViewport,
    habitatFullBboxes,
  ]);

  // Persistent ref-based piece cache. Grows monotonically — each
  // habitat is decomposed + decimated + bbox-computed ONCE per session
  // (per project). Every subsequent render that touches the same
  // habitat just does an O(1) Map lookup. Earlier `useMemo` versions
  // either rebuilt for ALL habitats (8019 pieces, 3+ s freeze) or
  // rebuilt for `visibleHabitats` (which changes on every pan/zoom,
  // so the build cost compounded across renders).
  //
  // The cache is read-only-from-render — the actual writes happen
  // inside `habitatPolygonElements` below, lazily as habitats become
  // visible. Project change resets the ref via the effect.
  // Cache value stores the boundary reference alongside its decomposed
  // pieces — when a refetch lands at a tighter tolerance, the new
  // habitat object carries a *different* boundary reference and we
  // rebuild instead of returning stale coarse geometry. Identity check
  // is enough because mergeIntoStore replaces the row wholesale.
  const piecesCacheRef = useRef<
    Map<
      string,
      {
        boundary: HabitatPolygon["boundary"];
        pieces: Array<{ piece: HabitatRenderPiece; bbox: HabitatBbox | null }>;
      }
    >
  >(new Map());
  useEffect(() => {
    piecesCacheRef.current = new Map();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // (Old per-layer rAF chain removed — replaced by the single
  // polygonMountBudget counter above. Keeping a single source of
  // truth avoids the previous race where multiple effects fought over
  // visibleHabitats reference changes.)

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
    // Habitats consume whatever budget is left after designated. With
    // designated mounting first, the user gets NPWS context up front
    // and saved habitats stream in once that's done.
    const budgetForHabitats = Math.max(
      0,
      polygonMountBudget - MAX_DESIGNATED_POLYGONS,
    );
    if (budgetForHabitats === 0) return [];
    const out: ReactElement[] = [];
    for (const habitat of visibleHabitats) {
      if (out.length >= Math.min(budgetForHabitats, MAX_HABITAT_POLYGONS)) {
        continue;
      }
      // Lazy lookup-or-build against the persistent ref cache. First
      // time we see a habitat we pay the decomposition cost; every
      // subsequent render is a Map.get. Boundary-reference identity
      // check forces a rebuild after a tolerance-driven refetch
      // (mergeIntoStore replaces the row, the new boundary !== old).
      let cached = piecesCacheRef.current.get(habitat.id);
      if (!cached || cached.boundary !== habitat.boundary) {
        const pieces = habitatPolygonPieces(habitat.boundary, {
          maxVerticesPerRing: MAX_VERTICES_PER_RING,
        });
        const piecesWithBbox = pieces.map((piece) => ({
          piece,
          bbox: bboxFromCoords(piece.outer),
        }));
        cached = { boundary: habitat.boundary, pieces: piecesWithBbox };
        piecesCacheRef.current.set(habitat.id, cached);
      }
      const piecesWithBbox = cached.pieces;
      if (piecesWithBbox.length === 0) continue;
      const fill = habitat.fossitt_code
        ? getFossittColor(habitat.fossitt_code)
        : UNCLASSIFIED_HABITAT_COLOR;
      const stroke = darkenHex(fill, 0.65);
      for (let idx = 0; idx < piecesWithBbox.length; idx++) {
        if (out.length >= MAX_HABITAT_POLYGONS) break;
        const { piece, bbox: pieceBbox } = piecesWithBbox[idx];
        if (effectiveViewport && pieceBbox && !bboxesIntersect(pieceBbox, effectiveViewport)) {
          continue;
        }
        out.push(
          <Polygon
            key={`${baseMap}-habitat-${habitat.id}-${idx}`}
            coordinates={piece.outer}
            holes={
              HABITAT_RENDER_HOLES && piece.holes.length > 0 ? piece.holes : undefined
            }
            strokeColor={stroke}
            strokeWidth={2}
            fillColor={`${fill}59`}
            tappable={HABITAT_TAPPABLE}
            onPress={HABITAT_TAPPABLE ? () => setSelectedHabitat(habitat) : undefined}
            zIndex={Z_HABITAT}
          />,
        );
      }
    }
    return out;
  }, [visibleHabitats, polygonMountBudget, baseMap, effectiveViewport]);

  // NLC piece cache — same persistent ref-based pattern as the saved
  // habitat cache above. NLC features are smaller per-row (a single
  // parcel, not a multi-island MultiPolygon) so build cost is light,
  // but the decimation + bbox compute would still re-fire on every
  // render's memo recompute without the cache. Reset on project change.
  const nlcPiecesCacheRef = useRef<
    Map<string, Array<{ piece: HabitatRenderPiece; bbox: HabitatBbox | null }>>
  >(new Map());
  useEffect(() => {
    nlcPiecesCacheRef.current = new Map();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // NLC polygon JSX. Same shape as habitatPolygonElements: budget-gated
  // mount, viewport AABB filter, output cap, vertex decimation. Differs
  // in the source (Esri NLC features vs Supabase saved habitats), the
  // cap value, and that no detail-sheet onPress is wired in v1 (Phase 3
  // adds JS-side hit-testing through MapView.onPress).
  const nlcPolygonElements = useMemo(() => {
    if (layerMode !== "nlc") return [];
    // NLC takes the same render budget slot the saved-habitat layer
    // would have used. They never both render thanks to layerMode, so
    // the polygonMountBudget pacing applies to whichever layer is
    // active.
    const budgetForNlc = Math.max(0, polygonMountBudget - MAX_DESIGNATED_POLYGONS);
    if (budgetForNlc === 0) return [];

    const out: ReactElement[] = [];
    let totalVerticesAfterDecimation = 0;
    let droppedOutOfView = 0;
    let droppedByCap = 0;

    for (const feature of nlcFeatures) {
      if (out.length >= Math.min(budgetForNlc, MAX_NLC_POLYGONS)) {
        droppedByCap++;
        continue;
      }
      let piecesWithBbox = nlcPiecesCacheRef.current.get(feature.id);
      if (!piecesWithBbox) {
        const pieces = habitatPolygonPieces(feature.geometry, {
          maxVerticesPerRing: MAX_NLC_VERTICES_PER_RING,
        });
        piecesWithBbox = pieces.map((piece) => ({
          piece,
          bbox: bboxFromCoords(piece.outer),
        }));
        nlcPiecesCacheRef.current.set(feature.id, piecesWithBbox);
      }
      if (piecesWithBbox.length === 0) continue;
      // Color map is keyed by LEVEL_2_VALUE (server's human-readable
      // name), not LEVEL_2_ID. Web team flagged this during Phase 1
      // pre-flight — pass through verbatim, no normalisation, since
      // the FeatureServer returns inconsistent case across some values.
      const fill = nlcColorFor(feature.level2Value);
      const stroke = darkenHex(fill, 0.65);
      for (let idx = 0; idx < piecesWithBbox.length; idx++) {
        if (out.length >= MAX_NLC_POLYGONS) {
          droppedByCap++;
          break;
        }
        const { piece, bbox: pieceBbox } = piecesWithBbox[idx];
        if (effectiveViewport && pieceBbox && !bboxesIntersect(pieceBbox, effectiveViewport)) {
          droppedOutOfView++;
          continue;
        }
        if (__DEV__) {
          totalVerticesAfterDecimation += piece.outer.length;
          if (HABITAT_RENDER_HOLES) {
            for (const hole of piece.holes) totalVerticesAfterDecimation += hole.length;
          }
        }
        out.push(
          <Polygon
            key={`${baseMap}-nlc-${feature.id}-${idx}`}
            coordinates={piece.outer}
            holes={
              HABITAT_RENDER_HOLES && piece.holes.length > 0 ? piece.holes : undefined
            }
            strokeColor={stroke}
            strokeWidth={1.5}
            fillColor={`${fill}59`}
            tappable={HABITAT_TAPPABLE}
            // Android uses native tappable (cheap on Google Maps).
            // iOS handles taps via MapView.onPress + JS hit-test —
            // see handleMapPress.
            onPress={HABITAT_TAPPABLE ? () => setSelectedNlc(feature) : undefined}
            zIndex={Z_HABITAT}
          />,
        );
      }
    }
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(
        `[nlc] render → ${out.length} polygons, ${totalVerticesAfterDecimation} vertices (cap=${MAX_NLC_POLYGONS}, vMax=${MAX_NLC_VERTICES_PER_RING ?? "∞"}, dropped: ${droppedOutOfView} off-view, ${droppedByCap} over-cap)`,
      );
    }
    return out;
  }, [layerMode, nlcFeatures, polygonMountBudget, baseMap, effectiveViewport]);

  // NLC labels — anti-duplicate (max 1 per LEVEL_2_ID, the largest
  // polygon for that code) and capped at MAX_NLC_LABELS visible at
  // once. Only rendered at z >= MIN_NLC_LABEL_ZOOM (17) to keep the
  // Marker bridge cost bounded; at z 16 the LEVEL_2_ID density would
  // be too high for native Markers to handle without re-introducing
  // the freezes from the iOS perf marathon.
  const nlcLabelMarkers = useMemo(() => {
    if (layerMode !== "nlc") return [];
    if (currentZoom == null || currentZoom < MIN_NLC_LABEL_ZOOM) return [];
    if (nlcFeatures.length === 0) return [];

    // 1) Per LEVEL_2_ID, keep the feature with the largest area.
    const largestPerCode = new Map<string, NlcFeature>();
    for (const feature of nlcFeatures) {
      if (!feature.level2Id) continue;
      const existing = largestPerCode.get(feature.level2Id);
      if (!existing || (feature.area ?? 0) > (existing.area ?? 0)) {
        largestPerCode.set(feature.level2Id, feature);
      }
    }

    // 2) Filter to those that intersect the viewport and have a
    //    drawable centroid; sort by area desc; take top MAX_NLC_LABELS.
    const candidates: Array<{
      feature: NlcFeature;
      anchor: { latitude: number; longitude: number };
    }> = [];
    for (const feature of largestPerCode.values()) {
      const cached = nlcPiecesCacheRef.current.get(feature.id);
      if (!cached || cached.length === 0) continue;
      // Pick the largest piece (longest outer ring as a cheap proxy)
      // for centroid placement so the label sits in the visually
      // dominant part of a multi-piece feature.
      let largest = cached[0];
      for (const c of cached) {
        if (c.piece.outer.length > largest.piece.outer.length) largest = c;
      }
      if (
        effectiveViewport &&
        largest.bbox &&
        !bboxesIntersect(largest.bbox, effectiveViewport)
      ) {
        continue;
      }
      const anchor = centroidOfRing(largest.piece.outer);
      if (!anchor) continue;
      candidates.push({ feature, anchor });
    }
    candidates.sort((a, b) => (b.feature.area ?? 0) - (a.feature.area ?? 0));
    return candidates.slice(0, MAX_NLC_LABELS);
  }, [layerMode, currentZoom, nlcFeatures, effectiveViewport]);

  // Same memoisation for designated polygons. NPWS sites can be huge
  // estuarine geometries with thousands of vertices and dozens of
  // multipolygon parts; without decimation + a piece cap they were the
  // hidden half of the "15 s frozen iOS" report (the other half was
  // habitats). Both gates also wait for InteractionManager so the
  // navigation+fit animation runs before any heavy bridge work.
  // Pre-decomposed designated pieces. Same pattern + same reason as
  // habitatPiecesCache — without this, the `designatedPolygonElements`
  // memo (whose deps include polygonMountBudget) re-ran polygonsForRender
  // for every NPWS site on every 50 ms tick, decomposing complex
  // estuarine geometries from scratch each time. With ~50 sites × ~20 ms
  // per decompose, each tick spent ~1 s in the memo and the budget
  // advanced 5× too slow. Logs showed `mount budget=40 t=2704ms` →
  // `mount budget=45 t=8022ms`, exactly the symptom this cache fixes.
  const designatedPiecesCache = useMemo(() => {
    const cache = new Map<string, DesignatedRenderPiece[]>();
    for (const site of designated) {
      const pieces = polygonsForRender(site.geometry, {
        maxVerticesPerRing: DESIGNATED_MAX_VERTICES_PER_RING,
      });
      cache.set(designatedCacheKey(site), pieces);
    }
    return cache;
  }, [designated]);

  const designatedPolygonElements = useMemo(() => {
    // Designated mounts FIRST — gets the lower portion of the global
    // budget. Habitats then take whatever budget remains.
    const budgetForDesignated = Math.min(
      polygonMountBudget,
      MAX_DESIGNATED_POLYGONS,
    );
    if (budgetForDesignated === 0) return [];
    const out: ReactElement[] = [];
    for (const site of designated) {
      if (out.length >= budgetForDesignated) break;
      const pieces = designatedPiecesCache.get(designatedCacheKey(site));
      if (!pieces || pieces.length === 0) continue;
      const colour = getDesignatedSiteColor(site.site_type);
      for (let idx = 0; idx < pieces.length; idx++) {
        if (out.length >= budgetForDesignated) break;
        const piece = pieces[idx];
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
      }
    }
    return out;
  }, [designated, baseMap, polygonMountBudget, designatedPiecesCache]);

  // Site polygons (and the project-boundary fallback when there are no
  // sites). Memoised for the same reason as habitats/designated: any
  // unrelated state change (e.g. opening the layers panel, picking a
  // different site) used to rebuild this JSX inline, sending fresh
  // <Polygon> elements through the native bridge while the map is still
  // holding hundreds of habitat overlays.
  const sitePolygonElements = useMemo(() => {
    if (!data) return [] as ReactElement[];
    const out: ReactElement[] = [];
    for (const site of data.sites) {
      const coords = polygonToCoordinates(site.boundary);
      if (coords.length === 0) continue;
      const isPrimary = selectedSiteId === null || site.id === selectedSiteId;
      out.push(
        <Polygon
          key={`${baseMap}-${site.id}`}
          coordinates={coords}
          strokeColor={isPrimary ? colors.primary.DEFAULT : "#94a3b8"}
          strokeWidth={isPrimary ? 3 : 1.5}
          fillColor={isPrimary ? colors.primary.DEFAULT + "33" : "transparent"}
          zIndex={Z_SITE_POLYGON}
        />,
      );
    }
    if (data.sites.length === 0 && data.projectBoundary?.geometry) {
      const coords = polygonToCoordinates(data.projectBoundary.geometry);
      if (coords.length > 0) {
        out.push(
          <Polygon
            key={`${baseMap}-boundary`}
            coordinates={coords}
            strokeColor={colors.primary.DEFAULT}
            strokeWidth={3}
            fillColor={colors.primary.DEFAULT + "33"}
            zIndex={Z_SITE_POLYGON}
          />,
        );
      }
    }
    return out;
  }, [data, selectedSiteId, baseMap]);

  // Buffer rings around each site, matching the web map. Each site carries
  // its own buffer_distances (km); when null we fall back to the shared
  // [2, 5] default so an unconfigured project still gives the surveyor
  // proximity context. Rings sort large→small so the painter draws the
  // bigger halo underneath, and we re-buffer only when the boundary or
  // selection changes — turf.buffer is pure-JS but heavy enough that we
  // don't want it firing on every pan.
  // turf.buffer is pure-JS and heavy (200-500 ms per ring on real
  // site geometries). Earlier we used `polygonMountBudget < 5` inside
  // the memo, but the budget was *also* in the memo's deps — so every
  // 50 ms tick re-ran the entire buffer computation. With ~45 ticks
  // that compounded into seconds of redundant JS work, freezing the
  // map after habitats fetched. Now we flip a one-shot ready flag once
  // the mount has progressed enough; the memo only recomputes when
  // the flag flips (or the underlying boundary changes).
  const [bufferRingsReady, setBufferRingsReady] = useState(false);
  useEffect(() => {
    if (!bufferRingsReady && polygonMountBudget >= 5) {
      setBufferRingsReady(true);
    }
  }, [bufferRingsReady, polygonMountBudget]);

  const bufferRings = useMemo(() => {
    if (!data || !bufferRingsReady) return [];
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
  }, [data, selectedSiteId, bufferRingsReady]);

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
              onPress={handleMapPress}
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
              {/* Site polygons + project-boundary fallback are rendered
                  from a memoised JSX array — see sitePolygonElements
                  above. Same reasoning as designated/habitats: keeps
                  unrelated re-renders (layers panel open, polygon tap)
                  from rebuilding this layer through the native bridge. */}
              {sitePolygonElements}

              {/* Designated sites + habitat polygons are rendered from
                  pre-memoised JSX arrays so polygon-tap state changes
                  don't trigger O(N) reconciliation against the layer.
                  See the useMemo definitions above for why.
                  habitatPolygonElements and nlcPolygonElements are
                  mutually exclusive via layerMode — the active one
                  returns its array, the other returns []. */}
              {designatedPolygonElements}
              {habitatPolygonElements}
              {nlcPolygonElements}
              {/* NLC LEVEL_2_ID labels — only at z >= 17, max 15
                  visible, deduped to one per code (largest polygon).
                  Markers are heavier than Polygons on the bridge so
                  we keep this list tight. */}
              {nlcLabelMarkers.map(({ feature, anchor }) => (
                <Marker
                  key={`${baseMap}-nlc-label-${feature.id}`}
                  coordinate={anchor}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
                >
                  <View style={styles.nlcLabel} pointerEvents="none">
                    <Text style={styles.nlcLabelText}>{feature.level2Id}</Text>
                  </View>
                </Marker>
              ))}

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
              nlcEnabled={nlcEnabled}
              onToggleNlc={handleToggleNlc}
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

            {/* Zoom-guard hint — visible when the user has habitats on
                but the viewport is too wide for the RPC to safely return.
                Polygons already loaded stay drawn (the module store
                doesn't shrink); we just stop fetching new ones until
                the user zooms in. */}
            {habitatsEnabled && viewportTooLarge && (
              <View style={styles.zoomHintWrap} pointerEvents="none">
                <Ionicons name="search-outline" size={16} color={colors.white} />
                <Text style={styles.zoomHintText}>Zoom in to load habitats</Text>
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
        <NlcDetailModal
          feature={selectedNlc}
          onClose={() => setSelectedNlc(null)}
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

  zoomHintWrap: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  zoomHintText: { color: colors.white, fontSize: 13, fontWeight: "600" },

  nlcLabel: {
    backgroundColor: "rgba(255,255,255,0.85)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.2)",
  },
  nlcLabelText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1f2937",
  },

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
