import { supabase } from "@/lib/supabase";
import {
  setCachedDesignatedSites,
  getCachedDesignatedSites,
} from "@/lib/database";
import { useNetworkStore } from "@/lib/network";

/**
 * NPWS designated site rendered on the project map. Geometry comes
 * pre-simplified from get_designated_sites_geojson (~11 m tolerance, well
 * under field GPS error) so a project that would otherwise ship 8 MB of
 * raw polygon vertices fits in ~350 KB.
 */
export interface DesignatedSite {
  id: string;
  title: string | null;
  content: string | null;
  site_code: string | null;
  site_type: DesignatedSiteType | null;
  distance_from_boundary_km: number | null;
  ai_summary: string | null;
  site_id: string | null;
  geometry: DesignatedGeometry | null;
}

export type DesignatedSiteType = "SAC" | "SPA" | "NHA" | "pNHA";

export type DesignatedGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

interface RpcDesignatedSiteRow {
  id: string;
  title: string | null;
  content: string | null;
  site_code: string | null;
  site_type: string | null;
  distance_from_boundary_km: number | string | null;
  ai_summary: string | null;
  site_id: string | null;
  geometry: DesignatedGeometry | null;
}

const VALID_TYPES: ReadonlySet<string> = new Set(["SAC", "SPA", "NHA", "pNHA"]);

export const DESIGNATED_SITE_COLORS: Record<DesignatedSiteType, string> = {
  SAC: "#22c55e",
  SPA: "#3b82f6",
  NHA: "#8b5cf6",
  pNHA: "#a855f7",
};

const DISPLAY_NAMES: Record<DesignatedSiteType, string> = {
  SAC: "Special Area of Conservation",
  SPA: "Special Protection Area",
  NHA: "Natural Heritage Area",
  pNHA: "Proposed Natural Heritage Area",
};

export function getDesignatedSiteDisplayName(type: DesignatedSiteType | null): string {
  return type ? DISPLAY_NAMES[type] : "Designated Site";
}

export function getDesignatedSiteColor(type: DesignatedSiteType | null): string {
  return type ? DESIGNATED_SITE_COLORS[type] : "#6b7280";
}

function normaliseRow(raw: RpcDesignatedSiteRow): DesignatedSite {
  const distance =
    raw.distance_from_boundary_km == null
      ? null
      : typeof raw.distance_from_boundary_km === "string"
        ? Number(raw.distance_from_boundary_km)
        : raw.distance_from_boundary_km;
  const siteType = raw.site_type && VALID_TYPES.has(raw.site_type)
    ? (raw.site_type as DesignatedSiteType)
    : null;
  return {
    id: raw.id,
    title: raw.title,
    content: raw.content,
    site_code: raw.site_code,
    site_type: siteType,
    distance_from_boundary_km: Number.isFinite(distance) ? (distance as number) : null,
    ai_summary: raw.ai_summary,
    site_id: raw.site_id,
    geometry: raw.geometry,
  };
}

/**
 * Cache key that survives same-NPWS-code-different-type collisions: a single
 * NPWS site_code (e.g. 001656) can appear as both an SAC and a pNHA. Using
 * site_code alone would deduplicate one of them out of the render, hiding a
 * polygon. site_type alone collides between two different SAC sites. The
 * code-type pair is what web's isSameDesignatedSite helper compares too.
 */
export function designatedCacheKey(site: DesignatedSite): string {
  return `${site.site_code ?? site.id}-${site.site_type ?? "?"}`;
}

// Hard upper bound on a single designated-sites RPC. The function runs
// ST_SimplifyPreserveTopology on geometries up to ~313k vertices server-
// side, so a heavy project plus pool contention from the post-login warm
// pass can stack up. Without this timeout, supabase-js leaves the request
// open indefinitely and the caller's `await` never resolves — manifests
// as "stuck on loading" on the preview/fullscreen map.
const RPC_TIMEOUT_MS = 15_000;

/**
 * Fetch designated sites for a project from the simplified-geom RPC. Falls
 * back to the SQLite cache when offline or when the call fails. Successful
 * online fetches refresh the cache. Same NetInfo race guard as
 * fetchProjectBoundary — the network store starts pessimistic until the
 * first NetInfo.fetch resolves, so a cold-start call would otherwise read
 * an empty cache.
 */
export async function fetchDesignatedSites(projectId: string): Promise<DesignatedSite[]> {
  let isOnline = useNetworkStore.getState().isOnline;
  if (!isOnline) {
    try {
      const NetInfo = (await import("@react-native-community/netinfo")).default;
      const state = await NetInfo.fetch();
      const probedOnline =
        state.isInternetReachable === true ||
        (state.isInternetReachable === null && state.isConnected === true);
      if (probedOnline) {
        isOnline = true;
        useNetworkStore.getState().setOnline(true);
      }
    } catch { /* probe failed — keep pessimistic value */ }
  }
  if (!isOnline) {
    return readFromCache(projectId);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .rpc("get_designated_sites_geojson", { p_project_id: projectId })
      .abortSignal(controller.signal);
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as RpcDesignatedSiteRow[]) : [];
    const sites = rows.map(normaliseRow);
    // Skip cache write only when the RPC genuinely returned nothing — never
    // overwrite an existing cache with an empty array because of a
    // transient error (errors fall through to the catch block below).
    await setCachedDesignatedSites({
      projectId,
      sitesGeojson: sites.length > 0 ? JSON.stringify(rows) : null,
    });
    return sites;
  } catch {
    return readFromCache(projectId);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readFromCache(projectId: string): Promise<DesignatedSite[]> {
  const cached = await getCachedDesignatedSites(projectId);
  if (!cached?.sites_geojson) return [];
  try {
    const rows = JSON.parse(cached.sites_geojson) as RpcDesignatedSiteRow[];
    return Array.isArray(rows) ? rows.map(normaliseRow) : [];
  } catch {
    return [];
  }
}

/**
 * One renderable polygon piece — what react-native-maps' <Polygon> takes:
 * a single outer ring as `coordinates` and an array of inner rings as
 * `holes`. A GeoJSON Polygon flattens to 1 piece, MultiPolygon to N.
 */
export interface RenderPiece {
  outer: Array<{ latitude: number; longitude: number }>;
  holes: Array<Array<{ latitude: number; longitude: number }>>;
}

function ringToCoords(ring: number[][]): Array<{ latitude: number; longitude: number }> {
  const out: Array<{ latitude: number; longitude: number }> = [];
  for (const c of ring) {
    if (Array.isArray(c) && c.length >= 2) {
      out.push({ longitude: c[0], latitude: c[1] });
    }
  }
  return out;
}

/**
 * Decompose a Polygon or MultiPolygon into the {outer, holes} pieces a
 * react-native-maps <Polygon> can render. We flatten MultiPolygons on the
 * client (instead of ST_Dump on the server) so each finding row carries
 * its metadata once — server-side dump would balloon row count from ~120
 * to ~250 with redundant titles and codes for the same NPWS site.
 *
 * Inner rings (holes) survive: 22% of saved polygons have holes, and
 * dropping them would falsely paint lakes/inlets as protected ground.
 */
export function polygonsForRender(geometry: DesignatedGeometry | null): RenderPiece[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return [];
    const outer = ringToCoords(geometry.coordinates[0]);
    if (outer.length === 0) return [];
    const holes = geometry.coordinates.slice(1).map(ringToCoords).filter((h) => h.length > 0);
    return [{ outer, holes }];
  }
  // MultiPolygon — each part is its own [outer, ...inner] ring set
  if (!Array.isArray(geometry.coordinates)) return [];
  const pieces: RenderPiece[] = [];
  for (const part of geometry.coordinates) {
    if (!Array.isArray(part) || part.length === 0) continue;
    const outer = ringToCoords(part[0]);
    if (outer.length === 0) continue;
    const holes = part.slice(1).map(ringToCoords).filter((h) => h.length > 0);
    pieces.push({ outer, holes });
  }
  return pieces;
}

/**
 * Flat list of all coordinates across every site for fitToCoordinates use.
 * Holes are excluded (they're inside the outer ring anyway and only drag
 * the bbox inward incorrectly when they happen to touch the boundary).
 */
export function flattenDesignatedCoordinates(
  sites: DesignatedSite[],
): Array<{ latitude: number; longitude: number }> {
  const out: Array<{ latitude: number; longitude: number }> = [];
  for (const site of sites) {
    for (const piece of polygonsForRender(site.geometry)) {
      out.push(...piece.outer);
    }
  }
  return out;
}
