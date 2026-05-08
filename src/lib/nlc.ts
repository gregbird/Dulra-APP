/**
 * NLC (National Land Cover) reference layer client.
 *
 * Fetches NLC 2018 parcels from Tailte Éireann's ArcGIS FeatureServer for the
 * z >= 16 detail layer. Above z 16 the saved-habitat polygons (server-side
 * simplified at ~5 m) start showing TIN-style triangle artifacts, and the
 * surrounding NLC reference parcels (hedgerows, buildings, neighbouring
 * fields) become important context for surveyors.
 *
 * Mobile v1 uses `f=geojson` instead of the web's `f=pbf` — there is no
 * extra parser dependency and the per-call payload is bounded by a
 * combination of pagination + bin cache + the platform feature cap.
 * Architecture leaves room for a PBF swap (only the `parseResponse` helper
 * changes) — see `docs/nlc-detail-layer-plan.md` § 3 for the trade-off.
 *
 * Contract: callers MUST gate by zoom (>= MIN_NLC_RENDER_ZOOM) themselves.
 * This module is stateless apart from the in-memory bin cache and a
 * latestKeyRef-style guard for the screen to consult.
 */

import { Platform } from "react-native";

const SERVICE_URL =
  "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/MapGenieNationalLandCover2018ITM/FeatureServer/0/query";

/**
 * Camera zoom at which the NLC layer takes over from the saved-habitat
 * layer. Web reference uses 16; mobile may need to drop to 15 once
 * we've tested on a real device — see plan § 9 question 7. Default 16.
 */
export const MIN_NLC_RENDER_ZOOM = 16;

const FETCH_TIMEOUT_MS = 20_000;

/**
 * Single tolerance value, matched with web. The clamp formula in
 * `computeServerSimplify` does the actual zoom-aware tightening — at
 * z 16 the raw `extent * 0.001` lands around 5e-6, well above the
 * floor; at z 18 extent shrinks and we hit the floor. No tiered
 * z-17-special-case needed (plan v2 corrected this from the v1 draft).
 */
const MIN_TOLERANCE = 0.000003; // ~0.3 m at lat 53° N
const MAX_TOLERANCE = 0.00045;

/**
 * Bin cache size on disk (degrees). 0.005° ≈ 500 m. A pan smaller than
 * this hits the same bin key and returns cached features without a
 * round-trip. Web uses the same value for parity.
 */
const BIN_SIZE_DEG = 0.005;
const BIN_CACHE_LIMIT = 30;

/**
 * Per-page record count and total feature cap, platform-tuned. Web
 * runs at 4000 / 100 000 with PBF and a WebGL renderer; native
 * `<Polygon>` is dramatically more expensive (see commit 02859c2 for
 * the iOS post-mortem) so we cap aggressively.
 */
const PAGE_SIZE = Platform.OS === "ios" ? 1000 : 4000;
const FEATURE_CAP = Platform.OS === "ios" ? 5000 : 25000;

/**
 * Hard ceiling on pagination loops as a defence against an
 * unexpectedly verbose server response. With PAGE_SIZE = 1000 and
 * FEATURE_CAP = 5000 the loop should exit after 5 pages — the +5
 * cushion catches off-by-one bugs without letting a runaway loop
 * eat the JS thread.
 */
const MAX_PAGES = Math.ceil(FEATURE_CAP / PAGE_SIZE) + 5;

// ---------------- types ----------------

export interface NlcBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface NlcFeature {
  id: string;
  level1Value: string | null;
  level2Id: string | null; // e.g. "GA1" — drives colour + label
  level2Value: string | null;
  area: number | null; // m² as returned by the server
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

export interface NlcFetchResult {
  features: NlcFeature[];
  truncated: boolean;
}

interface ArcGisGeoJsonFeature {
  type: "Feature";
  id?: string | number;
  properties: {
    LEVEL_2_ID?: string | null;
    LEVEL_2_VALUE?: string | null;
    LEVEL_1_VALUE?: string | null;
    AREA?: number | null;
  } | null;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] }
    | null;
}

interface ArcGisGeoJsonResponse {
  type: "FeatureCollection";
  features: ArcGisGeoJsonFeature[];
  /**
   * ArcGIS surfaces "more pages available" via `exceededTransferLimit`.
   * Where exactly it lands in `f=geojson` mode is one of the Phase 1
   * smoke-test unknowns (plan § 2). We treat it as optional at any
   * level, and fall back to `features.length === pageSize` if absent.
   */
  exceededTransferLimit?: boolean;
  properties?: {
    exceededTransferLimit?: boolean;
  };
}

// ---------------- bin cache ----------------

const binCache = new Map<string, NlcFeature[]>();

/**
 * Cache key derived from the bbox snapped to BIN_SIZE_DEG. A pan
 * smaller than the bin size produces the same key — cache hit. Larger
 * pan = new key = miss. Coords formatted to 4 decimals (~10 m) so
 * floating-point drift doesn't make every pan a miss.
 */
export function bboxToBinKey(bbox: NlcBbox): string {
  const minLng = Math.floor(bbox.minLng / BIN_SIZE_DEG) * BIN_SIZE_DEG;
  const minLat = Math.floor(bbox.minLat / BIN_SIZE_DEG) * BIN_SIZE_DEG;
  const maxLng = Math.ceil(bbox.maxLng / BIN_SIZE_DEG) * BIN_SIZE_DEG;
  const maxLat = Math.ceil(bbox.maxLat / BIN_SIZE_DEG) * BIN_SIZE_DEG;
  return `${minLng.toFixed(4)}_${minLat.toFixed(4)}_${maxLng.toFixed(4)}_${maxLat.toFixed(4)}`;
}

export function getNlcBinCache(): Map<string, NlcFeature[]> {
  return binCache;
}

export function clearNlcBinCache(): void {
  binCache.clear();
}

function rememberInCache(key: string, features: NlcFeature[]): void {
  // FIFO eviction via insertion order. JS Map preserves insertion order;
  // re-set moves the key to the end so a hit also refreshes recency. We
  // don't need true LRU here — a recently fetched bin getting evicted
  // after 30 entries on a long pan session is fine.
  if (binCache.has(key)) binCache.delete(key);
  binCache.set(key, features);
  while (binCache.size > BIN_CACHE_LIMIT) {
    const oldest = binCache.keys().next().value;
    if (oldest === undefined) break;
    binCache.delete(oldest);
  }
}

// ---------------- tolerance / quantization ----------------

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Web parity: tolerance scales with the viewport's largest extent at a
 * 1:1000 ratio, clamped to [MIN_TOLERANCE, MAX_TOLERANCE]. At z 16 over
 * a typical Irish project this lands ~5e-6 (well above the floor); zoom
 * in further and it bottoms out at MIN_TOLERANCE.
 */
export function computeServerSimplify(bbox: NlcBbox): number {
  const extent = Math.max(bbox.maxLng - bbox.minLng, bbox.maxLat - bbox.minLat);
  return clamp(extent * 0.001, MIN_TOLERANCE, MAX_TOLERANCE);
}

interface QuantizationParams {
  mode: "view";
  originPosition: "upperLeft";
  tolerance: number;
  extent: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    spatialReference: { wkid: 4326 };
  };
}

function buildQuantization(bbox: NlcBbox, tolerance: number): QuantizationParams {
  return {
    mode: "view",
    originPosition: "upperLeft",
    tolerance,
    extent: {
      xmin: bbox.minLng,
      ymin: bbox.minLat,
      xmax: bbox.maxLng,
      ymax: bbox.maxLat,
      spatialReference: { wkid: 4326 },
    },
  };
}

// ---------------- fetch ----------------

/**
 * Fetch NLC features that intersect the bbox. Paged internally; returns
 * the full feature set up to the platform cap. Bin-cache awareness lives
 * here so callers don't have to thread it through.
 *
 * Caller passes its own AbortSignal (from a useEffect cleanup / pan
 * dedupe). On abort, the in-flight `fetch` rejects and we propagate the
 * AbortError up — caller should distinguish aborts from real errors and
 * swallow aborts silently.
 */
export async function fetchNlcInBbox(
  bbox: NlcBbox,
  options?: {
    signal?: AbortSignal;
    pageSize?: number;
    featureCap?: number;
    bypassBinCache?: boolean;
  },
): Promise<NlcFetchResult> {
  const pageSize = options?.pageSize ?? PAGE_SIZE;
  const featureCap = options?.featureCap ?? FEATURE_CAP;
  const cacheKey = bboxToBinKey(bbox);

  if (!options?.bypassBinCache) {
    const cached = binCache.get(cacheKey);
    if (cached) {
      // Refresh recency by re-inserting (Map insertion-order trick).
      binCache.delete(cacheKey);
      binCache.set(cacheKey, cached);
      return { features: cached, truncated: false };
    }
  }

  const tolerance = computeServerSimplify(bbox);
  const quantization = buildQuantization(bbox, tolerance);
  const geometry = {
    xmin: bbox.minLng,
    ymin: bbox.minLat,
    xmax: bbox.maxLng,
    ymax: bbox.maxLat,
    spatialReference: { wkid: 4326 },
  };

  const baseParams: Record<string, string> = {
    f: "geojson",
    where: "1=1",
    returnGeometry: "true",
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    inSR: "4326",
    outSR: "4326",
    outFields: "LEVEL_2_ID,LEVEL_2_VALUE,LEVEL_1_VALUE,AREA",
    orderByFields: "AREA DESC",
    resultType: "tile",
    cacheHint: "true",
    resultRecordCount: String(pageSize),
    geometry: JSON.stringify(geometry),
    maxAllowableOffset: String(tolerance),
    quantizationParameters: JSON.stringify(quantization),
  };

  const collected: NlcFeature[] = [];
  let truncated = false;

  // Page-driver loop. Stops when:
  //  - response signals no more pages (exceededTransferLimit false), OR
  //  - features.length < pageSize on a page (server gave us less than
  //    asked for, defensive parity with services that omit the flag), OR
  //  - we've hit the feature cap (mark truncated and bail), OR
  //  - MAX_PAGES safety break (defensive — should never be hit).
  for (let page = 0; page < MAX_PAGES; page++) {
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const offset = page * pageSize;
    const body = new URLSearchParams({
      ...baseParams,
      resultOffset: String(offset),
    }).toString();

    const timeoutCtl = new AbortController();
    const timeoutId = setTimeout(() => timeoutCtl.abort(), FETCH_TIMEOUT_MS);
    const composedSignal = anySignal([options?.signal, timeoutCtl.signal]);

    let response: Response;
    try {
      response = await fetch(SERVICE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: composedSignal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`NLC fetch failed: HTTP ${response.status}`);
    }

    const json = (await response.json()) as ArcGisGeoJsonResponse;
    if (!json || !Array.isArray(json.features)) {
      // Defensive — server returned something unexpected. Treat as
      // empty rather than throwing so the layer fails silently.
      break;
    }

    for (const f of json.features) {
      const mapped = rowToFeature(f);
      if (mapped) collected.push(mapped);
      if (collected.length >= featureCap) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;

    // Decide whether to page on. Prefer the explicit flag if present at
    // either common location; otherwise fall back to "did the server
    // give us a full page?" which is what most ArcGIS endpoints honour
    // implicitly.
    const flagRoot = json.exceededTransferLimit;
    const flagProps = json.properties?.exceededTransferLimit;
    const more =
      flagRoot === true ||
      flagProps === true ||
      (flagRoot === undefined && flagProps === undefined && json.features.length === pageSize);
    if (!more) break;
  }

  rememberInCache(cacheKey, collected);
  return { features: collected, truncated };
}

function rowToFeature(row: ArcGisGeoJsonFeature): NlcFeature | null {
  if (!row.geometry) return null;
  const props = row.properties ?? {};
  const id = row.id != null ? String(row.id) : `nlc-${props.LEVEL_2_ID ?? "?"}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    level1Value: props.LEVEL_1_VALUE ?? null,
    level2Id: props.LEVEL_2_ID ?? null,
    level2Value: props.LEVEL_2_VALUE ?? null,
    area: typeof props.AREA === "number" ? props.AREA : null,
    geometry: row.geometry,
  };
}

/**
 * Point-in-polygon test (ray-casting). Used by the JS-side hit test
 * on iOS where the NLC layer renders without `tappable` (native
 * hit-test region build is dropped to keep the bridge cost down — see
 * plan § 6 / commit 02859c2 post-mortem). Caller should bbox-cull
 * pieces first; PIP is O(N) on the ring length.
 *
 * Coordinate convention: ring vertices are `{ latitude, longitude }`
 * pairs as we already store them in the screen's piece cache, so this
 * helper accepts that shape directly.
 */
export function pointInRing(
  point: { latitude: number; longitude: number },
  ring: ReadonlyArray<{ latitude: number; longitude: number }>,
): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  const x = point.longitude;
  const y = point.latitude;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude;
    const yi = ring[i].latitude;
    const xj = ring[j].longitude;
    const yj = ring[j].latitude;
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Simple centroid of a closed ring — average of vertex coords. Good
 * enough for label anchoring at typical parcel scales; we don't need
 * the area-weighted centroid for visual placement.
 */
export function centroidOfRing(
  ring: ReadonlyArray<{ latitude: number; longitude: number }>,
): { latitude: number; longitude: number } | null {
  if (ring.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const p of ring) {
    lat += p.latitude;
    lng += p.longitude;
  }
  return { latitude: lat / ring.length, longitude: lng / ring.length };
}

/**
 * Compose multiple AbortSignals into one. The standard library only
 * shipped `AbortSignal.any` in 2024 and React Native's runtime hasn't
 * caught up uniformly — this hand-rolled version works on every JS
 * engine we ship to.
 */
function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) {
      controller.abort();
      break;
    }
    sig.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}
