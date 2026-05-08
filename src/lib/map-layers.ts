import { getAppState, setAppState } from "@/lib/database";

/**
 * Base map options exposed to the user. Satellite (ESRI) is the historical
 * default — every screen rendered ESRI tiles before the layer switcher
 * existed, so persisted prefs and unset prefs alike must keep landing on
 * satellite to avoid surprising existing users with a different look.
 */
export type BaseMapId = "streets" | "satellite" | "hybrid" | "topographic";

export const DEFAULT_BASE_MAP: BaseMapId = "satellite";

interface BaseMapTileLayer {
  /** Tile URL template — react-native-maps' UrlTile substitutes {z}/{x}/{y}. */
  url: string;
  /** OSM-style {s} subdomain rotation. UrlTile doesn't support this natively, so we
   *  swap a deterministic pick at config time (see resolveTileUrl). */
  subdomains?: string[];
  /** Tightest zoom the source supports. OpenTopoMap caps at 17; the others go to 19. */
  maxZoom: number;
  /** Attribution string — surfaced in the layer panel footer. */
  attribution: string;
  /** Per-source cache slot. react-native-maps' tileCachePath is keyed by
   *  `{z}/{x}/{y}` only (see AIRMapUrlTileCachedOverlay.m), so two sources
   *  sharing one directory collide on disk: switching from Satellite to
   *  Streets would serve the previously-cached satellite tile at the same
   *  coords. Each source therefore needs its own subfolder. */
  cacheSlot: string;
}

export interface BaseMapConfig {
  id: BaseMapId;
  label: string;
  /** Bottom layer: covers the canvas. Always present. */
  base: BaseMapTileLayer;
  /** Optional overlay (Hybrid uses it for the labels layer over imagery). */
  overlay?: BaseMapTileLayer;
}

const ESRI_WORLD_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const ESRI_LABELS_OVERLAY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

const ESRI_SATELLITE_ATTRIBUTION =
  "Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, GIS User Community";

export const BASE_MAPS: Record<BaseMapId, BaseMapConfig> = {
  streets: {
    id: "streets",
    label: "Streets",
    base: {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      subdomains: ["a", "b", "c"],
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
      cacheSlot: "osm-streets",
    },
  },
  satellite: {
    id: "satellite",
    label: "Satellite",
    base: {
      url: ESRI_WORLD_IMAGERY,
      maxZoom: 19,
      attribution: ESRI_SATELLITE_ATTRIBUTION,
      // Keep the legacy folder name — ProjectBoundaryPreview wrote satellite
      // tiles here before per-source slots existed, and reusing the slot
      // means an offline-warmed cache survives the upgrade.
      cacheSlot: "esri-satellite",
    },
  },
  hybrid: {
    id: "hybrid",
    label: "Hybrid",
    base: {
      url: ESRI_WORLD_IMAGERY,
      maxZoom: 19,
      attribution: ESRI_SATELLITE_ATTRIBUTION,
      // Same source as the Satellite base — share the folder so warming one
      // warms the other (same URL → same bytes per tile coord).
      cacheSlot: "esri-satellite",
    },
    overlay: {
      url: ESRI_LABELS_OVERLAY,
      maxZoom: 19,
      attribution: "Labels © OpenStreetMap contributors",
      cacheSlot: "esri-labels",
    },
  },
  topographic: {
    id: "topographic",
    label: "Topographic",
    base: {
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      subdomains: ["a", "b", "c"],
      maxZoom: 17,
      attribution:
        "Map data © OpenStreetMap contributors, SRTM | Style © OpenTopoMap (CC-BY-SA)",
      cacheSlot: "opentopomap",
    },
  },
};

/**
 * UrlTile takes a single template — no `{s}` rotation. Picking one
 * subdomain at config time is good enough: tile load is split across
 * subdomain DNS only when concurrent requests differ, and a single mobile
 * device viewing one map fires nowhere near the per-host concurrency limit
 * that subdomain rotation was designed to dodge. We still pick "a" so the
 * placeholder substitution doesn't leave a literal `{s}` in the URL.
 */
export function resolveTileUrl(layer: BaseMapTileLayer): string {
  if (!layer.subdomains || layer.subdomains.length === 0) return layer.url;
  return layer.url.replace("{s}", layer.subdomains[0]);
}

/** Build the per-source cache path. `cacheRoot` is the screen's tile-cache
 *  base directory (`${Paths.cache.uri}map-tiles`). Joining the source's
 *  cacheSlot keeps each source isolated on disk, so switching layers shows
 *  the right tiles instead of whatever happened to be cached at that coord
 *  for a different source. */
export function resolveTileCachePath(cacheRoot: string, layer: BaseMapTileLayer): string {
  const trimmed = cacheRoot.endsWith("/") ? cacheRoot.slice(0, -1) : cacheRoot;
  return `${trimmed}/${layer.cacheSlot}`;
}

const PREF_BASE_MAP_KEY = "map.base_map";
const PREF_TOWNLANDS_KEY = "map.townlands_enabled";
const PREF_HABITATS_KEY = "map.habitats_enabled";
const PREF_NLC_KEY = "map.nlc_enabled";

function isBaseMapId(value: string | null | undefined): value is BaseMapId {
  return value === "streets" || value === "satellite" || value === "hybrid" || value === "topographic";
}

export interface MapLayerPrefs {
  baseMap: BaseMapId;
  townlandsEnabled: boolean;
  /** Habitat polygons overlay (FOSSITT-coloured polygons from
   *  habitat_polygons). Default off — heavy payload on cadastral-import
   *  outlier projects (one known 11 MB project), so the user opts in once
   *  they need it. Pref persists per device. */
  habitatsEnabled: boolean;
  /** NLC 2018 reference parcels (z >= 16). Independent of habitatsEnabled
   *  for parity with the web UI which has separate buttons. Default ON
   *  — surveyors expect the reference layer to come up automatically
   *  when they zoom in past z 16; turning it off is the explicit choice. */
  nlcEnabled: boolean;
}

export async function loadMapLayerPrefs(): Promise<MapLayerPrefs> {
  try {
    const [baseRaw, townRaw, habRaw, nlcRaw] = await Promise.all([
      getAppState(PREF_BASE_MAP_KEY),
      getAppState(PREF_TOWNLANDS_KEY),
      getAppState(PREF_HABITATS_KEY),
      getAppState(PREF_NLC_KEY),
    ]);
    return {
      baseMap: isBaseMapId(baseRaw) ? baseRaw : DEFAULT_BASE_MAP,
      townlandsEnabled: townRaw === "1",
      habitatsEnabled: habRaw === "1",
      // Default ON — see field comment. Stored "0" disables; everything
      // else (including unset / null) treats as on.
      nlcEnabled: nlcRaw !== "0",
    };
  } catch {
    return {
      baseMap: DEFAULT_BASE_MAP,
      townlandsEnabled: false,
      habitatsEnabled: false,
      nlcEnabled: true,
    };
  }
}

export async function saveBaseMapPref(id: BaseMapId): Promise<void> {
  try {
    await setAppState(PREF_BASE_MAP_KEY, id);
  } catch { /* persistence is best-effort — losing a pref isn't fatal */ }
}

export async function saveTownlandsPref(enabled: boolean): Promise<void> {
  try {
    await setAppState(PREF_TOWNLANDS_KEY, enabled ? "1" : "0");
  } catch { /* persistence is best-effort — losing a pref isn't fatal */ }
}

export async function saveHabitatsPref(enabled: boolean): Promise<void> {
  try {
    await setAppState(PREF_HABITATS_KEY, enabled ? "1" : "0");
  } catch { /* persistence is best-effort — losing a pref isn't fatal */ }
}

export async function saveNlcPref(enabled: boolean): Promise<void> {
  try {
    await setAppState(PREF_NLC_KEY, enabled ? "1" : "0");
  } catch { /* persistence is best-effort — losing a pref isn't fatal */ }
}
