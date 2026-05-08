import { supabase } from "@/lib/supabase";
import { useNetworkStore } from "@/lib/network";
import {
  appendCachedHabitatBoundaries,
  getCachedHabitats,
  setCachedHabitatBoundaries,
} from "@/lib/database";
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

/**
 * Accumulating module-level cache. Keyed by projectId, then by habitat id.
 *
 * Why a Map<id, polygon> instead of a flat array: the project map fetches
 * habitats incrementally — initial open uses the site-or-project boundary
 * + 100 m bbox, and every pan/zoom pulls more rows for the new viewport.
 * Per the spec we *never* drop rows the user has already seen; the store
 * grows monotonically over a session as they pan around. Id-based dedup
 * means re-fetching an overlapping bbox refreshes existing rows without
 * duplicating them.
 *
 * Memory: typical habitat row with 5 m-simplified geometry is ~5-20 KB.
 * Even a worst-case session that pans across an entire 1000-row project
 * tops out at ~20 MB per project, and `cacheAllData` invalidates between
 * sessions. Acceptable.
 *
 * Cleared by invalidateHabitatsMemoryCache() — pull-to-refresh and
 * cacheAllData both call it.
 */
const habitatStore = new Map<string, Map<string, HabitatPolygon>>();

/**
 * Dedup for the explicit "Show all" path (legacy `get_project_habitats`).
 * Bbox calls are *not* deduped here — concurrent bbox fetches are
 * idempotent through the store merge, and the screen's debounce already
 * keeps overlap rare.
 */
const showAllInFlight = new Map<string, Promise<HabitatPolygon[]>>();

export function invalidateHabitatsMemoryCache(projectId?: string): void {
  if (projectId) {
    habitatStore.delete(projectId);
    showAllInFlight.delete(projectId);
    return;
  }
  habitatStore.clear();
  showAllInFlight.clear();
}

/**
 * Synchronous read of the accumulated rows for a project. Used by screens
 * that want to render whatever the user has already loaded (e.g. the
 * Habitats list view shows what map pans have populated).
 */
export function getHabitatsForProject(
  projectId: string,
  siteId?: string | null,
): HabitatPolygon[] {
  const projectMap = habitatStore.get(projectId);
  if (!projectMap) return [];
  const rows = Array.from(projectMap.values());
  return siteId
    ? rows.filter((h) => h.site_id === siteId || h.site_id === null)
    : rows;
}

function mergeIntoStore(projectId: string, rows: HabitatPolygon[]): void {
  let projectMap = habitatStore.get(projectId);
  if (!projectMap) {
    projectMap = new Map<string, HabitatPolygon>();
    habitatStore.set(projectId, projectMap);
  }
  for (const row of rows) {
    projectMap.set(row.id, row);
  }
}

// ---------- Bbox helpers ----------

export interface HabitatBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/**
 * Compute the bbox of an array of lat/lng points. Returns null for empty
 * input — callers should treat that as "no geometry to anchor on" and
 * skip the fetch instead of sending a degenerate envelope.
 */
export function bboxFromCoords(
  coords: ReadonlyArray<{ latitude: number; longitude: number }>,
): HabitatBbox | null {
  if (coords.length === 0) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const c of coords) {
    if (c.longitude < minLng) minLng = c.longitude;
    if (c.longitude > maxLng) maxLng = c.longitude;
    if (c.latitude < minLat) minLat = c.latitude;
    if (c.latitude > maxLat) maxLat = c.latitude;
  }
  if (!isFinite(minLng) || !isFinite(maxLng)) return null;
  return { minLng, minLat, maxLng, maxLat };
}

/**
 * Expand a bbox by `meters` on every side, using a flat-Earth conversion
 * keyed off the bbox centre's latitude. Good enough at Irish-survey
 * scales (sub-county) — for a 100 m default buffer the worst-case skew
 * is well under a metre. Used to widen the initial site/project boundary
 * before the first bbox fetch so the user lands with a small skirt of
 * habitats around the boundary, matching the spec's "100 m default".
 */
export function expandBboxByMeters(bbox: HabitatBbox, meters: number): HabitatBbox {
  const latMid = (bbox.minLat + bbox.maxLat) / 2;
  const dLat = meters / 111_000;
  const dLng = meters / (111_000 * Math.cos((latMid * Math.PI) / 180));
  return {
    minLng: bbox.minLng - dLng,
    minLat: bbox.minLat - dLat,
    maxLng: bbox.maxLng + dLng,
    maxLat: bbox.maxLat + dLat,
  };
}

/**
 * Approximate area of the bbox in km². Same flat-Earth approximation as
 * expandBboxByMeters — accurate enough for the 50 km² zoom-guard in the
 * spec, which is itself a soft threshold (the goal is "is this viewport
 * unreasonably large", not exact area).
 */
export function bboxAreaKm2(bbox: HabitatBbox): number {
  const latMid = (bbox.minLat + bbox.maxLat) / 2;
  const latKm = (bbox.maxLat - bbox.minLat) * 111;
  const lngKm = (bbox.maxLng - bbox.minLng) * 111 * Math.cos((latMid * Math.PI) / 180);
  return Math.max(0, latKm * lngKm);
}

/**
 * Loose equality — two bboxes are "the same query" if every corner is
 * within ~10 m. Used by the screen's debounced fetcher to skip RPC calls
 * when a tiny pan jiggle would otherwise trigger a redundant round-trip.
 */
export function bboxesEqualish(
  a: HabitatBbox,
  b: HabitatBbox,
  tolDeg: number = 0.0001,
): boolean {
  return (
    Math.abs(a.minLng - b.minLng) < tolDeg &&
    Math.abs(a.minLat - b.minLat) < tolDeg &&
    Math.abs(a.maxLng - b.maxLng) < tolDeg &&
    Math.abs(a.maxLat - b.maxLat) < tolDeg
  );
}

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
 * Probe NetInfo if the network store says offline (cold-start race) and
 * flip it back to online if reachable. Shared between bbox and "show
 * all" fetchers — both want to attempt the RPC if connectivity is
 * actually present, even when the store hasn't updated yet.
 */
async function probeOnlineState(): Promise<boolean> {
  let isOnline = useNetworkStore.getState().isOnline;
  if (isOnline) return true;
  try {
    const NetInfo = (await import("@react-native-community/netinfo")).default;
    const state = await NetInfo.fetch();
    const probedOnline =
      state.isInternetReachable === true ||
      (state.isInternetReachable === null && state.isConnected === true);
    if (probedOnline) {
      useNetworkStore.getState().setOnline(true);
      return true;
    }
  } catch { /* probe failed — keep pessimistic value */ }
  return false;
}

/**
 * Viewport-bound habitat fetch via `get_habitats_in_bbox`. This is the
 * default path for the project map and the Habitats list — the screen
 * decides what bbox to send (initial: site/project boundary + 100 m
 * buffer, subsequent: the camera's visible region) and we push a small
 * spatial filter into PostGIS rather than streaming every polygon to
 * the device.
 *
 * Rows merge into the project's accumulating store via id-based dedupe.
 * Returns the *full accumulated array* for the project (filtered by
 * site if requested), not just the new rows — that lets the caller
 * `setHabitats(returnedArray)` and let React's reconciler diff against
 * the previous snapshot. New polygons appear, existing ones stay
 * mounted, nothing flickers.
 *
 * Offline behaviour: bbox is ignored (we don't run PostGIS client-side);
 * we read whatever's in `cached_habitats` for the project and merge it
 * in. Acceptable trade-off — offline open shows everything that was
 * previously cached, then the next online bbox call refines.
 *
 * Errors swallow into a cache fallback so the layer is non-critical.
 */
export async function fetchHabitatsInBbox(
  projectId: string,
  siteId: string | null,
  bbox: HabitatBbox,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<HabitatPolygon[]> {
  const limit = options?.limit ?? 500;
  const isOnline = await probeOnlineState();
  if (!isOnline) {
    const cached = await readFromCache(projectId, siteId ?? null);
    mergeIntoStore(projectId, cached);
    return getHabitatsForProject(projectId, siteId ?? null);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  // Forward the caller's abort signal — the screen cancels in-flight
  // fetches when its component unmounts mid-pan, so we don't waste a
  // whole RPC round-trip on stale state.
  if (options?.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  try {
    const { data, error } = await supabase
      .rpc("get_habitats_in_bbox", {
        p_project_id: projectId,
        p_site_id: siteId,
        p_min_lng: bbox.minLng,
        p_min_lat: bbox.minLat,
        p_max_lng: bbox.maxLng,
        p_max_lat: bbox.maxLat,
        p_limit: limit,
      })
      .abortSignal(controller.signal);
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as RpcHabitatRow[]) : [];
    const habitats = rows.map(rowToHabitat);
    if (__DEV__) {
      let totalVertices = 0;
      for (const h of habitats) totalVertices += countGeometryVertices(h.boundary);
      // eslint-disable-next-line no-console
      console.log(
        `[habitats] bbox fetch → ${habitats.length} rows, ${totalVertices} vertices`,
      );
    }
    mergeIntoStore(projectId, habitats);
    // Fire-and-forget cache write. Append-mode (not replace) so earlier
    // bbox fetches' boundaries survive — the user might pan back to that
    // area offline, and we want their previous data still rendering.
    void appendCachedHabitatBoundaries(
      projectId,
      habitats.map((h) => ({ id: h.id, boundary: h.boundary ?? null })),
    ).catch(() => { /* non-fatal */ });
    return getHabitatsForProject(projectId, siteId ?? null);
  } catch {
    const cached = await readFromCache(projectId, siteId ?? null);
    mergeIntoStore(projectId, cached);
    return getHabitatsForProject(projectId, siteId ?? null);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Explicit "Show all" path — fetches every habitat for a project via the
 * legacy `get_project_habitats` RPC. Only the Habitats list's "Show all"
 * button calls this; the map and the list's default state both go
 * through `fetchHabitatsInBbox`.
 *
 * Behaves like the bbox fetcher in terms of caching: rows merge into
 * the same store (id-based dedupe), so calling this after a bunch of
 * bbox pans simply tops up the missing rows. The boundary cache write
 * is replace-mode (project-wide) since a "Show all" call is by
 * definition the authoritative project snapshot.
 */
export async function fetchProjectHabitats(
  projectId: string,
  siteId?: string | null,
  options?: { forceRefresh?: boolean },
): Promise<HabitatPolygon[]> {
  if (!options?.forceRefresh) {
    const inflight = showAllInFlight.get(projectId);
    if (inflight) {
      const rows = await inflight;
      return siteId
        ? rows.filter((h) => h.site_id === siteId || h.site_id === null)
        : rows;
    }
  }
  const promise = doFetchAllProjectHabitats(projectId)
    .then((rows) => {
      mergeIntoStore(projectId, rows);
      showAllInFlight.delete(projectId);
      return rows;
    })
    .catch((err) => {
      showAllInFlight.delete(projectId);
      throw err;
    });
  showAllInFlight.set(projectId, promise);
  await promise;
  return getHabitatsForProject(projectId, siteId ?? null);
}

async function doFetchAllProjectHabitats(projectId: string): Promise<HabitatPolygon[]> {
  const isOnline = await probeOnlineState();
  if (!isOnline) {
    return readFromCache(projectId, null);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .rpc("get_project_habitats", {
        p_project_id: projectId,
        p_site_id: null,
      })
      .abortSignal(controller.signal);
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as RpcHabitatRow[]) : [];
    const habitats = rows.map(rowToHabitat);
    // Replace-mode write — "Show all" is the project-wide snapshot, so
    // it's authoritative and supersedes any partial bbox data on disk.
    void setCachedHabitatBoundaries(
      projectId,
      habitats.map((h) => ({ id: h.id, boundary: h.boundary ?? null })),
    ).catch(() => { /* non-fatal */ });
    return habitats;
  } catch {
    return readFromCache(projectId, null);
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

function ringToCoords(
  ring: number[][],
  maxVertices?: number,
): Array<{ latitude: number; longitude: number }> {
  // Optional uniform-stride decimation. Habitat polygons coming back
  // from PostGIS are simplified at ~5 m server-side, but heavy cadastral
  // imports still produce rings with hundreds of vertices each — and the
  // dominant cost on iOS is bridge serialization of those vertices, not
  // the polygon count. Capping at ~64 vertices/ring drops bridge payload
  // by 10-30× on these projects with no visible quality loss at typical
  // surveyor zoom levels (a 64-gon is indistinguishable from a 1000-gon
  // when the polygon is < 200 px wide).
  //
  // Uniform stride is crude vs. Douglas-Peucker but is O(N) and good
  // enough for a read-only display layer.
  const out: Array<{ latitude: number; longitude: number }> = [];
  if (
    typeof maxVertices === "number" &&
    maxVertices > 0 &&
    ring.length > maxVertices
  ) {
    const step = ring.length / maxVertices;
    for (let i = 0; i < maxVertices; i++) {
      const c = ring[Math.floor(i * step)];
      if (Array.isArray(c) && c.length >= 2) {
        out.push({ longitude: c[0], latitude: c[1] });
      }
    }
    // Close the ring — skipped if the source ring's first/last coincide,
    // which they always do for valid GeoJSON polygons but check anyway.
    const last = ring[ring.length - 1];
    if (Array.isArray(last) && last.length >= 2) {
      const first = out[0];
      const lastPoint = out[out.length - 1];
      if (
        first &&
        lastPoint &&
        (first.latitude !== lastPoint.latitude || first.longitude !== lastPoint.longitude)
      ) {
        out.push({ longitude: last[0], latitude: last[1] });
      }
    }
    return out;
  }
  for (const c of ring) {
    if (Array.isArray(c) && c.length >= 2) {
      out.push({ longitude: c[0], latitude: c[1] });
    }
  }
  return out;
}

export function habitatPolygonPieces(
  geometry: HabitatGeometry | null | undefined,
  options?: { maxVerticesPerRing?: number },
): HabitatRenderPiece[] {
  const max = options?.maxVerticesPerRing;
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return [];
    const outer = ringToCoords(geometry.coordinates[0], max);
    if (outer.length === 0) return [];
    const holes = geometry.coordinates
      .slice(1)
      .map((r) => ringToCoords(r, max))
      .filter((h) => h.length > 0);
    return [{ outer, holes }];
  }
  if (!Array.isArray(geometry.coordinates)) return [];
  const pieces: HabitatRenderPiece[] = [];
  for (const part of geometry.coordinates) {
    if (!Array.isArray(part) || part.length === 0) continue;
    const outer = ringToCoords(part[0], max);
    if (outer.length === 0) continue;
    const holes = part
      .slice(1)
      .map((r) => ringToCoords(r, max))
      .filter((h) => h.length > 0);
    pieces.push({ outer, holes });
  }
  return pieces;
}

/**
 * Bounding-box span (degrees) of a habitat geometry — the larger of its
 * width and height. Powers the zoom-aware "skip when tiny" cull on the
 * project map: a polygon whose bbox is smaller than ~6 screen pixels at
 * the current zoom is invisible noise to the user, and mounting it
 * through the native bridge is the dominant cost on heavy projects (the
 * cadastral-import outlier with 600+ polygons stalled the JS thread for
 * 15+ seconds without this filter). Returns null for empty / missing /
 * unsupported geometry — caller should treat null as "render anyway"
 * (better to draw a polygon we can't size than drop it silently).
 */
/**
 * Full bbox (min/max lng/lat) of a habitat geometry. Pre-computed once
 * per polygon at habitat-fetch time and reused on every viewport change
 * for the AABB intersect test that gates rendering — without this, the
 * accumulating module store would render every polygon the user has
 * ever panned past, defeating viewport-bound loading.
 *
 * Returns null for empty / unsupported geometry — caller treats null as
 * "render anyway" (no bbox → can't safely cull).
 */
export function habitatGeometryBbox(
  geometry: HabitatGeometry | null | undefined,
): HabitatBbox | null {
  if (!geometry) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visit = (rings: number[][][] | undefined): void => {
    if (!Array.isArray(rings)) return;
    for (const ring of rings) {
      if (!Array.isArray(ring)) continue;
      for (const c of ring) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const lng = c[0];
        const lat = c[1];
        if (typeof lng !== "number" || typeof lat !== "number") continue;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  };
  if (geometry.type === "Polygon") {
    visit(geometry.coordinates);
  } else if (geometry.type === "MultiPolygon") {
    for (const part of geometry.coordinates) {
      if (Array.isArray(part)) visit(part);
    }
  } else {
    return null;
  }
  if (!isFinite(minLng) || !isFinite(maxLng)) return null;
  return { minLng, minLat, maxLng, maxLat };
}

/**
 * Total vertex count across a polygon / multipolygon, used for the
 * dev-only measurement log on bbox fetches. Heavy projects with sub-5m
 * cadastral lines hit huge vertex counts even after server-side
 * simplification — knowing the actual number is what tells us whether
 * coordinate decimation or stricter caps are worth chasing.
 */
function countGeometryVertices(geometry: HabitatGeometry | null | undefined): number {
  if (!geometry) return 0;
  let total = 0;
  const visit = (rings: number[][][] | undefined): void => {
    if (!Array.isArray(rings)) return;
    for (const ring of rings) {
      if (Array.isArray(ring)) total += ring.length;
    }
  };
  if (geometry.type === "Polygon") {
    visit(geometry.coordinates);
  } else if (geometry.type === "MultiPolygon") {
    for (const part of geometry.coordinates) {
      if (Array.isArray(part)) visit(part);
    }
  }
  return total;
}

/**
 * Axis-aligned bbox intersect test — true if `a` and `b` share any
 * area. The cheap (no PostGIS) viewport filter on the project map
 * uses this to drop polygons that aren't on screen.
 */
export function bboxesIntersect(a: HabitatBbox, b: HabitatBbox): boolean {
  return !(
    a.maxLng < b.minLng ||
    a.minLng > b.maxLng ||
    a.maxLat < b.minLat ||
    a.minLat > b.maxLat
  );
}

export function habitatBboxSpanDegrees(
  geometry: HabitatGeometry | null | undefined,
): number | null {
  if (!geometry) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visit = (rings: number[][][] | undefined): void => {
    if (!Array.isArray(rings)) return;
    for (const ring of rings) {
      if (!Array.isArray(ring)) continue;
      for (const c of ring) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const lng = c[0];
        const lat = c[1];
        if (typeof lng !== "number" || typeof lat !== "number") continue;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  };
  if (geometry.type === "Polygon") {
    visit(geometry.coordinates);
  } else if (geometry.type === "MultiPolygon") {
    for (const part of geometry.coordinates) {
      if (Array.isArray(part)) visit(part);
    }
  } else {
    return null;
  }
  if (!isFinite(minLng) || !isFinite(maxLng)) return null;
  return Math.max(maxLng - minLng, maxLat - minLat);
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
