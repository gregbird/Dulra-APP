import { supabase } from "@/lib/supabase";
import { useNetworkStore } from "@/lib/network";
import { getCachedHabitats, setCachedHabitatBoundaries } from "@/lib/database";
import { normaliseFossittCode, type HabitatGeometry, type HabitatPolygon } from "@/types/habitat";

/**
 * Wire shape returned by `get_project_habitats`. The RPC keeps the field
 * names in sync with the `habitat_polygons` table so we can reuse the same
 * row mapping the direct-from-table read used to do, with `boundary` swapped
 * from PostGIS WKB to a parsed GeoJSON object.
 *
 * Server-side the RPC runs ST_MakeValid + ST_SimplifyPreserveTopology(~5m) +
 * ST_AsGeoJSON(precision 5), so we don't simplify on the client. Typical
 * payload is 200 KB - 2 MB; one outlier project (cadastral auto-import) hit
 * 11 MB. Single fetch per session, cached to SQLite, no real-time refresh —
 * habitats change on the order of hours/days.
 */
interface RpcHabitatRow {
  id: string;
  project_id: string;
  site_id: string | null;
  survey_id: string | null;
  fossitt_code: string | null;
  fossitt_name: string | null;
  area_hectares: number | null;
  condition: string | null;
  evaluation: string | null;
  eu_annex_code: string | null;
  survey_method: string | null;
  notes: string | null;
  listed_species: string[] | null;
  threats: string[] | null;
  photos: string[] | null;
  include_in_report: boolean | null;
  boundary: HabitatGeometry | null;
  created_at: string | null;
  updated_at: string | null;
}

const RPC_TIMEOUT_MS = 30_000;

function rowToHabitat(row: RpcHabitatRow): HabitatPolygon {
  return {
    id: row.id,
    project_id: row.project_id,
    site_id: row.site_id,
    survey_id: row.survey_id,
    fossitt_code: normaliseFossittCode(row.fossitt_code),
    fossitt_name: row.fossitt_name,
    area_hectares: row.area_hectares,
    condition: row.condition,
    evaluation: row.evaluation,
    eu_annex_code: row.eu_annex_code,
    survey_method: row.survey_method,
    notes: row.notes,
    listed_species: row.listed_species,
    threats: row.threats,
    photos: row.photos,
    include_in_report: row.include_in_report,
    boundary: row.boundary,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Read habitats for a project (optionally narrowed to one site) via the
 * RPC. Mirrors the designated-sites pattern: probe NetInfo if the network
 * store still says offline (cold-start race), then RPC with timeout, then
 * fall back to SQLite cache on any failure.
 *
 * The cache table is cached_habitats (hydrated by cacheAllData on every
 * session/online transition). When this function fetches successfully it
 * also writes geometry back into cached_habitat_boundaries — split off the
 * primary cache so the per-row metadata can survive a clearCachedData()
 * pass without losing the heavy geometry payload.
 */
export async function fetchProjectHabitats(
  projectId: string,
  siteId?: string | null,
): Promise<HabitatPolygon[]> {
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
    return readFromCache(projectId, siteId ?? null);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .rpc("get_project_habitats", {
        p_project_id: projectId,
        p_site_id: siteId ?? null,
      })
      .abortSignal(controller.signal);
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as RpcHabitatRow[]) : [];
    const habitats = rows.map(rowToHabitat);
    // Persist geometry alongside the row id so the map can re-render
    // offline. The metadata side of the cache is filled by cacheAllData;
    // only boundaries live here so a metadata refresh doesn't clobber the
    // potentially-large geometry payload.
    if (!siteId) {
      // Site-scoped queries are a subset — never overwrite the project-wide
      // cache with them. Only project-wide fetches refresh the boundary cache.
      await setCachedHabitatBoundaries(
        projectId,
        habitats.map((h) => ({ id: h.id, boundary: h.boundary ?? null })),
      );
    }
    return habitats;
  } catch {
    return readFromCache(projectId, siteId ?? null);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readFromCache(
  projectId: string,
  siteId: string | null,
): Promise<HabitatPolygon[]> {
  const rows = await getCachedHabitats(projectId);
  const filtered = siteId
    ? rows.filter((r) => r.site_id === siteId || r.site_id === null)
    : rows;
  return filtered.map((r) => ({
    id: r.id,
    project_id: r.project_id,
    site_id: r.site_id,
    survey_id: r.survey_id ?? null,
    fossitt_code: normaliseFossittCode(r.fossitt_code),
    fossitt_name: r.fossitt_name,
    area_hectares: r.area_hectares,
    condition: r.condition,
    evaluation: r.evaluation,
    eu_annex_code: r.eu_annex_code,
    survey_method: r.survey_method,
    notes: r.notes,
    listed_species: r.listed_species ? safeJsonArray(r.listed_species) : null,
    threats: r.threats ? safeJsonArray(r.threats) : null,
    photos: r.photos ? safeJsonArray(r.photos) : null,
    include_in_report: r.include_in_report == null ? null : r.include_in_report === 1,
    boundary: r.boundary_geojson ? safeJsonGeometry(r.boundary_geojson) : null,
  }));
}

function safeJsonArray(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

function safeJsonGeometry(raw: string): HabitatGeometry | null {
  try {
    const parsed = JSON.parse(raw) as HabitatGeometry;
    if (parsed?.type === "Polygon" || parsed?.type === "MultiPolygon") return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Decompose Polygon/MultiPolygon into the {outer, holes} pieces a
 * react-native-maps <Polygon> can render. Same shape as
 * designated-sites.polygonsForRender; kept as a sibling helper here so the
 * habitat layer doesn't import designated-sites internals.
 */
export interface HabitatRenderPiece {
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

export function habitatPolygonPieces(geometry: HabitatGeometry | null | undefined): HabitatRenderPiece[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return [];
    const outer = ringToCoords(geometry.coordinates[0]);
    if (outer.length === 0) return [];
    const holes = geometry.coordinates.slice(1).map(ringToCoords).filter((h) => h.length > 0);
    return [{ outer, holes }];
  }
  if (!Array.isArray(geometry.coordinates)) return [];
  const pieces: HabitatRenderPiece[] = [];
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
 * Polygon centroid in lat/lng space — fine for label placement at typical
 * Irish-survey scales (sub-100m polygons). Uses the simple average of the
 * outer-ring vertices, which is good enough for read-only labelling and
 * avoids pulling in a turf dependency for a one-off helper.
 */
export function habitatLabelAnchor(
  pieces: HabitatRenderPiece[],
): { latitude: number; longitude: number } | null {
  if (pieces.length === 0) return null;
  // Pick the largest piece by vertex count — proxy for area at this scale.
  let largest = pieces[0];
  for (const p of pieces) if (p.outer.length > largest.outer.length) largest = p;
  if (largest.outer.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const pt of largest.outer) {
    lat += pt.latitude;
    lng += pt.longitude;
  }
  return {
    latitude: lat / largest.outer.length,
    longitude: lng / largest.outer.length,
  };
}

/**
 * Darken a #rrggbb hex by `factor` (0..1). 0.65 → strong stroke that reads
 * well against the 35% fill the layer paints. Output keeps the # prefix.
 */
export function darkenHex(hex: string, factor: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, Math.floor(((num >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.floor(((num >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.floor((num & 0xff) * factor)));
  const out = (r << 16) | (g << 8) | b;
  return `#${out.toString(16).padStart(6, "0")}`;
}
