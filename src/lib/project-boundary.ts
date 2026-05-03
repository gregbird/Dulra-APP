import { supabase } from "@/lib/supabase";
import { setCachedProjectBoundary, getCachedProjectBoundary } from "@/lib/database";
import { useNetworkStore } from "@/lib/network";

/**
 * Mobile shape produced from web's RPC payloads. We deliberately drop
 * buffer_distances and visible_layers (analysis features web Step 5
 * uses; out of scope for the read-only orientation view).
 */
export interface ProjectBoundary {
  /** Polygon Feature from get_project_with_geojson — Feature wrapper. */
  projectBoundary: GeoJsonFeature | null;
  projectCenter: GeoJsonPoint | null;
  /** Per-site polygons from get_project_sites_with_geojson — bare Polygon geometries. */
  sites: ProjectBoundarySite[];
}

export interface ProjectBoundarySite {
  id: string;
  site_code: string;
  site_name: string | null;
  sort_order: number | null;
  boundary: GeoJsonPolygon | null;
  center_point: GeoJsonPoint | null;
}

export interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonPolygon | null;
  properties: Record<string, unknown>;
}

interface RpcProjectResponse {
  id: string;
  boundary: GeoJsonFeature | null;
  center_point: GeoJsonPoint | null;
}

interface RpcSiteResponse {
  id: string;
  site_code: string;
  site_name: string | null;
  sort_order: number | null;
  boundary: GeoJsonPolygon | null;
  center_point: GeoJsonPoint | null;
}

function emptyBoundary(): ProjectBoundary {
  return { projectBoundary: null, projectCenter: null, sites: [] };
}

function parseCachedBoundary(row: {
  boundary_geojson: string | null;
  sites_geojson: string | null;
}): ProjectBoundary {
  let projectBoundary: GeoJsonFeature | null = null;
  let projectCenter: GeoJsonPoint | null = null;
  let sites: ProjectBoundarySite[] = [];
  try {
    if (row.boundary_geojson) {
      const parsed = JSON.parse(row.boundary_geojson) as Partial<RpcProjectResponse>;
      projectBoundary = parsed?.boundary ?? null;
      projectCenter = parsed?.center_point ?? null;
    }
  } catch { /* corrupt cache — drop project boundary, sites still try */ }
  try {
    if (row.sites_geojson) {
      const parsedSites = JSON.parse(row.sites_geojson) as RpcSiteResponse[];
      if (Array.isArray(parsedSites)) {
        sites = parsedSites.map(siteFromRpc);
      }
    }
  } catch { /* corrupt cache — fall back to empty sites array */ }
  return { projectBoundary, projectCenter, sites };
}

function siteFromRpc(s: RpcSiteResponse): ProjectBoundarySite {
  return {
    id: s.id,
    site_code: s.site_code,
    site_name: s.site_name,
    sort_order: s.sort_order,
    boundary: s.boundary ?? null,
    center_point: s.center_point ?? null,
  };
}

/**
 * Fetch a project's boundary + sites in parallel from the two SECURITY
 * DEFINER RPCs web also uses. Falls back to the SQLite cache if offline
 * or the request fails. Successful online fetches refresh the cache.
 */
export async function fetchProjectBoundary(projectId: string): Promise<ProjectBoundary> {
  const isOnline = useNetworkStore.getState().isOnline;
  if (!isOnline) {
    const cached = await getCachedProjectBoundary(projectId);
    return cached ? parseCachedBoundary(cached) : emptyBoundary();
  }

  try {
    const [projectRes, sitesRes] = await Promise.all([
      supabase.rpc("get_project_with_geojson", { p_project_id: projectId }),
      supabase.rpc("get_project_sites_with_geojson", { p_project_id: projectId }),
    ]);

    const projectData = (projectRes.data ?? null) as RpcProjectResponse | null;
    const sitesData = (sitesRes.data ?? []) as RpcSiteResponse[];

    const result: ProjectBoundary = {
      projectBoundary: projectData?.boundary ?? null,
      projectCenter: projectData?.center_point ?? null,
      sites: Array.isArray(sitesData) ? sitesData.map(siteFromRpc) : [],
    };

    // Persist trimmed payloads — only the fields we actually re-hydrate
    // from cache. Skip caching when both RPCs returned null/empty so we
    // don't overwrite a previous valid cache with garbage.
    const hasContent = result.projectBoundary || result.sites.length > 0;
    if (hasContent) {
      const boundaryJson = projectData
        ? JSON.stringify({ boundary: projectData.boundary, center_point: projectData.center_point })
        : null;
      const sitesJson = result.sites.length > 0
        ? JSON.stringify(sitesData)
        : null;
      await setCachedProjectBoundary({
        projectId,
        boundaryGeojson: boundaryJson,
        sitesGeojson: sitesJson,
      });
    }

    return result;
  } catch {
    const cached = await getCachedProjectBoundary(projectId);
    return cached ? parseCachedBoundary(cached) : emptyBoundary();
  }
}

/**
 * Compute a list of [lng, lat] points covering all polygons + the project
 * boundary so callers can fit a map's viewport (fitToCoordinates).
 * Returns [] when the project has no geometry — callers render a placeholder.
 */
export function flattenBoundaryCoordinates(
  data: ProjectBoundary,
): Array<{ latitude: number; longitude: number }> {
  const points: Array<{ latitude: number; longitude: number }> = [];

  const ingestPolygon = (polygon: GeoJsonPolygon | null) => {
    if (!polygon || !Array.isArray(polygon.coordinates)) return;
    for (const ring of polygon.coordinates) {
      for (const coord of ring) {
        if (Array.isArray(coord) && coord.length >= 2) {
          points.push({ longitude: coord[0], latitude: coord[1] });
        }
      }
    }
  };

  if (data.projectBoundary?.geometry) ingestPolygon(data.projectBoundary.geometry);
  for (const site of data.sites) ingestPolygon(site.boundary);
  return points;
}

/**
 * Convert a GeoJSON Polygon into the {latitude, longitude}[] react-native-maps
 * needs for its <Polygon coordinates={...} /> overlay. Returns the outer ring
 * only — multipolygon and holes are not used in this read-only view.
 */
export function polygonToCoordinates(
  polygon: GeoJsonPolygon | null,
): Array<{ latitude: number; longitude: number }> {
  if (!polygon || !Array.isArray(polygon.coordinates) || polygon.coordinates.length === 0) {
    return [];
  }
  const outerRing = polygon.coordinates[0];
  const out: Array<{ latitude: number; longitude: number }> = [];
  for (const coord of outerRing) {
    if (Array.isArray(coord) && coord.length >= 2) {
      out.push({ longitude: coord[0], latitude: coord[1] });
    }
  }
  return out;
}
