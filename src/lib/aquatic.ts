import { supabase } from "@/lib/supabase";
import { useNetworkStore } from "@/lib/network";
import {
  setCachedAquaticFindings,
  getCachedAquaticFindings,
} from "@/lib/database";
import type {
  AquaticDataType,
  AquaticFeatureType,
  AquaticFinding,
  AquaticGeometry,
  AquaticSource,
} from "@/types/aquatic";

interface RowFromSupabase {
  id: string;
  project_id: string;
  site_id: string | null;
  data_type: AquaticDataType;
  source: string | null;
  title: string | null;
  raw_data: { geometry?: AquaticGeometry } | null;
}

// Same upper bound as the designated-sites RPC. desk_research_findings is
// a plain table read so it should return faster than the geometry RPC, but
// we still want a finite ceiling so a flaky network doesn't leave the
// caller awaiting forever.
const QUERY_TIMEOUT_MS = 15_000;

/** Stroke + fill colour and per-feature fill alpha. Each bucket carries
 *  its own alpha because the visual weight of a catchment polygon
 *  (drainage basin spanning km²) is very different from a lake (a small
 *  contained water body): catchments need a near-transparent tint so the
 *  satellite imagery underneath stays readable, lakes can take a heavier
 *  fill since they don't dominate the viewport. Rivers are polylines —
 *  the alpha field is unused for them.
 *
 *  Hex values are de-collided with the NPWS designated palette so the
 *  catchment indigo stays distinguishable from NHA (#8b5cf6 violet-500)
 *  and pNHA (#a855f7 purple-500) when both layers paint the same area.
 *  Lake hex matches web's `WATER_BODY_TYPE.fg` for desk-research card
 *  parity. Two-character hex strings are concatenated onto the fill at
 *  render time — `${fill}${fillAlpha}`. */
export const AQUATIC_COLORS: Record<
  AquaticFeatureType,
  { stroke: string; fill: string; fillAlpha: string }
> = {
  river:     { stroke: "#14B8A6", fill: "#14B8A6", fillAlpha: "00" }, // polyline — alpha unused
  lake:      { stroke: "#0E7490", fill: "#0E7490", fillAlpha: "66" }, // ~40% — contained water body
  catchment: { stroke: "#818CF8", fill: "#6366F1", fillAlpha: "26" }, // softer indigo-400 border + indigo-500 ~15% tint
};

/**
 * Coarse-grained classification driving the render bucket. Catchment
 * findings are always polygons; water_quality rows split by geometry —
 * river segments arrive as LineString / MultiLineString, lakes as
 * Polygon / MultiPolygon. Defaults to "river" for the rare row that
 * carries an unexpected combination so something still draws.
 */
export function classifyAquatic(
  dataType: AquaticDataType,
  geometry: AquaticGeometry,
): AquaticFeatureType {
  if (dataType === "catchment") return "catchment";
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    return "lake";
  }
  return "river";
}

function normaliseRow(raw: RowFromSupabase): AquaticFinding {
  // raw_data may be null for rows imported before geometry was captured
  // — we still keep the row (the layer just won't render anything for it).
  const geometry = (raw.raw_data?.geometry ?? null) as AquaticGeometry | null;
  return {
    id: raw.id,
    project_id: raw.project_id,
    site_id: raw.site_id,
    data_type: raw.data_type,
    source: raw.source as AquaticSource | null,
    title: raw.title,
    geometry,
  };
}

/**
 * Fetch saved aquatic findings for a project. Falls back to the SQLite
 * cache when offline or when the call fails. Successful online fetches
 * refresh the cache so the next offline open shows the same set.
 *
 * NetInfo race guard mirrors fetchDesignatedSites — the network store
 * starts pessimistic until the first NetInfo.fetch resolves, so a
 * cold-start call would otherwise return an empty cache instead of
 * trying the network.
 */
export async function fetchAquaticFindings(projectId: string): Promise<AquaticFinding[]> {
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
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .from("desk_research_findings")
      .select("id, project_id, site_id, data_type, source, title, raw_data")
      .eq("project_id", projectId)
      .eq("is_saved", true)
      .in("data_type", ["water_quality", "catchment"])
      .abortSignal(controller.signal);
    if (error) throw error;
    const rows = Array.isArray(data) ? (data as RowFromSupabase[]) : [];
    const findings = rows.map(normaliseRow);
    // Skip cache write only when the query genuinely returned nothing —
    // never overwrite an existing cache with [] from a transient failure
    // (errors fall through to the catch block below).
    await setCachedAquaticFindings({
      projectId,
      findingsJson: findings.length > 0 ? JSON.stringify(rows) : null,
    });
    return findings;
  } catch {
    return readFromCache(projectId);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readFromCache(projectId: string): Promise<AquaticFinding[]> {
  const cached = await getCachedAquaticFindings(projectId);
  if (!cached?.findings_json) return [];
  try {
    const rows = JSON.parse(cached.findings_json) as RowFromSupabase[];
    return Array.isArray(rows) ? rows.map(normaliseRow) : [];
  } catch {
    return [];
  }
}

/** One renderable polygon piece — same shape designated-sites uses for
 *  react-native-maps' <Polygon>: a single outer ring plus inner-ring
 *  holes. */
export interface AquaticPolygonPiece {
  outer: Array<{ latitude: number; longitude: number }>;
  holes: Array<Array<{ latitude: number; longitude: number }>>;
}

function ringToCoords(
  ring: number[][],
): Array<{ latitude: number; longitude: number }> {
  const out: Array<{ latitude: number; longitude: number }> = [];
  for (const c of ring) {
    if (Array.isArray(c) && c.length >= 2) {
      out.push({ longitude: c[0], latitude: c[1] });
    }
  }
  return out;
}

/**
 * Decompose a Polygon / MultiPolygon geometry into the {outer, holes}
 * pieces a react-native-maps <Polygon> can render. Returns [] for
 * line geometries — see aquaticLinePieces for those.
 */
export function aquaticPolygonPieces(
  geometry: AquaticGeometry | null,
): AquaticPolygonPiece[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return [];
    const outer = ringToCoords(geometry.coordinates[0]);
    if (outer.length === 0) return [];
    const holes = geometry.coordinates
      .slice(1)
      .map(ringToCoords)
      .filter((h) => h.length > 0);
    return [{ outer, holes }];
  }
  if (geometry.type === "MultiPolygon") {
    if (!Array.isArray(geometry.coordinates)) return [];
    const pieces: AquaticPolygonPiece[] = [];
    for (const part of geometry.coordinates) {
      if (!Array.isArray(part) || part.length === 0) continue;
      const outer = ringToCoords(part[0]);
      if (outer.length === 0) continue;
      const holes = part
        .slice(1)
        .map(ringToCoords)
        .filter((h) => h.length > 0);
      pieces.push({ outer, holes });
    }
    return pieces;
  }
  return [];
}

/**
 * Decompose a LineString / MultiLineString into renderable Polyline
 * coordinate arrays. Returns [] for polygon geometries — use
 * aquaticPolygonPieces for those. Single-vertex degenerate lines drop.
 */
export function aquaticLinePieces(
  geometry: AquaticGeometry | null,
): Array<Array<{ latitude: number; longitude: number }>> {
  if (!geometry) return [];
  if (geometry.type === "LineString") {
    const line = ringToCoords(geometry.coordinates);
    return line.length > 1 ? [line] : [];
  }
  if (geometry.type === "MultiLineString") {
    const out: Array<Array<{ latitude: number; longitude: number }>> = [];
    for (const part of geometry.coordinates) {
      const line = ringToCoords(part);
      if (line.length > 1) out.push(line);
    }
    return out;
  }
  return [];
}
