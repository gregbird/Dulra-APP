/**
 * Townlands overlay backed by the Tailte Éireann ArcGIS service. The service
 * is open and key-free; we hit it directly from the device because there
 * are ~51,000 townland polygons in Ireland and we never want to download
 * the lot at once. The map screen drives this with a bbox-and-zoom gate so
 * each query returns a few hundred polygons at most.
 *
 * Contract: callers MUST gate by zoom (>= MIN_TOWNLANDS_ZOOM) and dedupe
 * identical bboxes themselves — this module is stateless. resultRecordCount
 * is capped at 500 server-side; if a viewport happens to exceed that we
 * accept the truncation rather than paginate (extra polygons would be
 * off-screen anyway as the user zooms further).
 */

const SERVICE_URL =
  "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/ArcGIS/rest/services/Townlands_NationalStatutoryBoundaries_Ungeneralised_2024/FeatureServer/0/query";

export const MIN_TOWNLANDS_ZOOM = 12;

// 15s timeout — same shape as designated-sites RPC. ArcGIS can be slow at
// peak, but a stuck request must never strand the UI.
const FETCH_TIMEOUT_MS = 15_000;

export interface TownlandsBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface TownlandFeature {
  id: string;
  englishName: string | null;
  gaelicName: string | null;
  /** Area in hectares (server returns m², we divide). null if unavailable. */
  areaHa: number | null;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

interface ArcGisGeoJsonFeature {
  type: "Feature";
  id?: string | number;
  properties: {
    ENG_NAME_VALUE?: string | null;
    GLE_NAME_VALUE?: string | null;
    Shape__Area?: number | null;
    GUID?: string | null;
  } | null;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] }
    | null;
}

interface ArcGisGeoJsonResponse {
  type: "FeatureCollection";
  features: ArcGisGeoJsonFeature[];
}

/**
 * Approximate the standard Web Mercator zoom level the user is viewing,
 * given a `react-native-maps` Region and the screen width in CSS pixels.
 * react-native-maps doesn't expose zoom directly — only angular deltas —
 * so we derive it from the longitudeDelta the camera reports. The 256px
 * tile constant matches every web slippy-map convention; multiplying by
 * the pixel ratio to screen width corrects for the fact that one tile
 * occupies ~screenWidth/256 of the device width, not exactly one tile.
 *
 * This is good enough for "are we zoomed in past 12?" — sub-zoom-level
 * accuracy doesn't matter for our gate.
 */
export function approximateZoom(longitudeDelta: number, screenWidth: number): number {
  if (!Number.isFinite(longitudeDelta) || longitudeDelta <= 0) return 0;
  return Math.log2((360 * screenWidth) / 256 / longitudeDelta);
}

/** Tolerance for "same bbox": ~0.0005° (~50 m). Within this margin, refetching
 *  would return the same set, so we skip it. */
const BBOX_EPSILON = 0.0005;

export function bboxesRoughlyEqual(a: TownlandsBbox | null, b: TownlandsBbox): boolean {
  if (!a) return false;
  return (
    Math.abs(a.minLng - b.minLng) < BBOX_EPSILON &&
    Math.abs(a.minLat - b.minLat) < BBOX_EPSILON &&
    Math.abs(a.maxLng - b.maxLng) < BBOX_EPSILON &&
    Math.abs(a.maxLat - b.maxLat) < BBOX_EPSILON
  );
}

function buildQueryUrl(bbox: TownlandsBbox): string {
  const geometry = encodeURIComponent(
    JSON.stringify({
      xmin: bbox.minLng,
      ymin: bbox.minLat,
      xmax: bbox.maxLng,
      ymax: bbox.maxLat,
      spatialReference: { wkid: 4326 },
    }),
  );
  const params = [
    "where=1%3D1",
    `geometry=${geometry}`,
    "geometryType=esriGeometryEnvelope",
    "spatialRel=esriSpatialRelIntersects",
    "inSR=4326",
    "outSR=4326",
    "outFields=ENG_NAME_VALUE,GLE_NAME_VALUE,Shape__Area,GUID",
    "returnGeometry=true",
    "f=geojson",
    "resultRecordCount=500",
  ].join("&");
  return `${SERVICE_URL}?${params}`;
}

function normaliseFeature(feature: ArcGisGeoJsonFeature, fallbackIdx: number): TownlandFeature | null {
  if (!feature.geometry) return null;
  const geom = feature.geometry;
  if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") return null;
  const props = feature.properties ?? {};
  const guid = props.GUID ?? (typeof feature.id === "string" ? feature.id : null);
  const id = guid ?? `t-${fallbackIdx}`;
  const areaM2 = typeof props.Shape__Area === "number" ? props.Shape__Area : null;
  return {
    id,
    englishName: props.ENG_NAME_VALUE ?? null,
    gaelicName: props.GLE_NAME_VALUE ?? null,
    areaHa: areaM2 != null ? areaM2 / 10_000 : null,
    geometry: geom,
  };
}

export async function fetchTownlands(bbox: TownlandsBbox, signal?: AbortSignal): Promise<TownlandFeature[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  // Forward an external signal (e.g. component unmount) into our controller
  // so cancellation propagates without us having to await the network.
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }
  try {
    const response = await fetch(buildQueryUrl(bbox), { signal: controller.signal });
    if (!response.ok) return [];
    const json = (await response.json()) as ArcGisGeoJsonResponse;
    if (!json || json.type !== "FeatureCollection" || !Array.isArray(json.features)) return [];
    const out: TownlandFeature[] = [];
    json.features.forEach((feature, idx) => {
      const norm = normaliseFeature(feature, idx);
      if (norm) out.push(norm);
    });
    return out;
  } catch {
    // Aborted, offline, malformed JSON — all treated the same: empty result
    // means the previous overlay stays on screen until the next pan succeeds.
    return [];
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

/** Decompose a townland's geometry into the {outer, holes} pieces a
 *  react-native-maps <Polygon> can render. Same shape as designated-sites'
 *  RenderPiece — we duplicate the type instead of importing it so this
 *  module stays self-contained and the two layers can evolve independently. */
export interface TownlandRenderPiece {
  outer: Array<{ latitude: number; longitude: number }>;
  holes: Array<Array<{ latitude: number; longitude: number }>>;
}

function ringToCoords(ring: number[][]): Array<{ latitude: number; longitude: number }> {
  const out: Array<{ latitude: number; longitude: number }> = [];
  for (const c of ring) {
    if (Array.isArray(c) && c.length >= 2) out.push({ longitude: c[0], latitude: c[1] });
  }
  return out;
}

export function townlandPieces(feature: TownlandFeature): TownlandRenderPiece[] {
  const geom = feature.geometry;
  if (geom.type === "Polygon") {
    if (!Array.isArray(geom.coordinates) || geom.coordinates.length === 0) return [];
    const outer = ringToCoords(geom.coordinates[0]);
    if (outer.length === 0) return [];
    const holes = geom.coordinates.slice(1).map(ringToCoords).filter((h) => h.length > 0);
    return [{ outer, holes }];
  }
  if (!Array.isArray(geom.coordinates)) return [];
  const pieces: TownlandRenderPiece[] = [];
  for (const part of geom.coordinates) {
    if (!Array.isArray(part) || part.length === 0) continue;
    const outer = ringToCoords(part[0]);
    if (outer.length === 0) continue;
    const holes = part.slice(1).map(ringToCoords).filter((h) => h.length > 0);
    pieces.push({ outer, holes });
  }
  return pieces;
}
