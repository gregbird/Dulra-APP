import buffer from "@turf/buffer";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { GeoJsonPolygon } from "@/lib/project-boundary";

/**
 * Mirrors web's lib/gis/buffer.ts. When a site has no buffer_distances
 * configured (null/empty), web shows these two rings; the mobile map
 * follows the same default so an unconfigured project still gives the
 * surveyor proximity context.
 */
export const DEFAULT_BUFFER_DISTANCES = [2, 5] as const;

/**
 * Distance (km) → stroke colour, kept in lockstep with web's
 * components/maps/map-types.ts BUFFER_COLORS so legends read the same
 * across platforms. Distances outside this map fall back to BUFFER_FALLBACK_COLOR.
 */
export const BUFFER_COLORS: Record<number, string> = {
  0.5: "#ef4444", // red
  1: "#f97316",   // orange
  2: "#eab308",   // yellow
  5: "#22c55e",   // green
  10: "#3b82f6",  // blue
  15: "#8b5cf6",  // purple
};

export const BUFFER_FALLBACK_COLOR = "#64748b"; // slate-500

export function getBufferColor(distanceKm: number): string {
  return BUFFER_COLORS[distanceKm] ?? BUFFER_FALLBACK_COLOR;
}

/**
 * Compute one buffered ring as a list of bare Polygon geometries.
 *
 * turf.buffer can return a MultiPolygon when the input is large enough
 * to wrap an antimeridian / pole — for Ireland-scale boundaries this is
 * effectively never, but the type is wide so we normalise to an array
 * and let the caller render each piece as its own <Polygon>. Returns []
 * when turf can't produce a result (degenerate input).
 */
export function ringPolygons(
  boundary: GeoJsonPolygon,
  distanceKm: number,
): GeoJsonPolygon[] {
  if (!boundary || !Array.isArray(boundary.coordinates) || distanceKm <= 0) {
    return [];
  }
  let result: Feature<Polygon | MultiPolygon> | undefined;
  try {
    // turf.buffer mutates / asserts on its input feature object — wrap
    // in a Feature so the caller's geometry stays untouched.
    result = buffer(
      { type: "Feature", geometry: boundary, properties: {} },
      distanceKm,
      { units: "kilometers" },
    ) as Feature<Polygon | MultiPolygon> | undefined;
  } catch {
    return [];
  }
  if (!result?.geometry) return [];
  const geom = result.geometry;
  if (geom.type === "Polygon") {
    return [{ type: "Polygon", coordinates: geom.coordinates }];
  }
  // MultiPolygon: split into bare Polygons for the renderer.
  return geom.coordinates.map((rings) => ({ type: "Polygon", coordinates: rings }));
}

/**
 * Sort distances largest → smallest so the painter draws bigger rings
 * underneath smaller ones. Matches web's components/maps/buffer-zone-layer.tsx.
 * Defensive copy — does not mutate the caller's array.
 */
export function sortBufferDistances(distances: readonly number[]): number[] {
  return [...distances].filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => b - a);
}

/**
 * Resolve effective buffer distances for a site: explicit list when
 * configured, the shared default otherwise. Empty array means "buffers
 * intentionally disabled" — distinct from null which means "unconfigured."
 */
export function resolveBufferDistances(distances: number[] | null | undefined): number[] {
  if (distances === null || distances === undefined) return [...DEFAULT_BUFFER_DISTANCES];
  return distances;
}
