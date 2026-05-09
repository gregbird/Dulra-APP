/**
 * Aquatic features rendered on the project map. Source data lives in
 * Supabase `desk_research_findings` (filtered to is_saved = true and
 * data_type IN ('water_quality','catchment')); the canonical geometry
 * is GeoJSON nested at `raw_data.geometry`. Mobile is read-only — all
 * authoring happens on the web app.
 */
export type AquaticDataType = "water_quality" | "catchment";

export type AquaticSource = "epa" | "catchments";

/** Coarse render bucket — drives stroke / fill colour and whether the
 *  feature renders as a polyline (rivers) or polygon (lakes, catchments). */
export type AquaticFeatureType = "river" | "lake" | "catchment";

export type AquaticGeometry =
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface AquaticFinding {
  id: string;
  project_id: string;
  site_id: string | null;
  data_type: AquaticDataType;
  source: AquaticSource | null;
  title: string | null;
  geometry: AquaticGeometry | null;
}
