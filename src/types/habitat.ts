import type { GeoJsonPolygon } from "@/lib/project-boundary";

/**
 * Habitat polygon as returned by the `get_project_habitats` RPC. Boundary
 * comes pre-simplified server-side (ST_MakeValid + ST_SimplifyPreserveTopology
 * ~5m + ST_AsGeoJSON precision 5) so the client renders directly without
 * extra geometry work.
 */
export interface HabitatPolygon {
  id: string;
  project_id: string;
  fossitt_code: string | null;
  fossitt_name: string | null;
  area_hectares: number | null;
  condition: string | null;
  notes: string | null;
  eu_annex_code: string | null;
  survey_method: string | null;
  /** Heritage Council evaluation tier; free text in the DB but typically one
   *  of these values. */
  evaluation: string | null;
  /** Legacy text[] of storage paths kept on the row for backwards
   *  compatibility — DO NOT use for display. The canonical photo source is
   *  the `photos` table joined via `habitat_polygon_id`. */
  listed_species: string[] | null;
  threats: string[] | null;
  photos: string[] | null;
  site_id?: string | null;
  survey_id?: string | null;
  /** Web-side report inclusion flag. Mobile shows everything regardless;
   *  carried through so future UI can filter. */
  include_in_report?: boolean | null;
  /** Polygon or MultiPolygon geometry from the RPC. null for legacy rows or
   *  rows whose geometry failed validity checks. */
  boundary?: HabitatGeometry | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type HabitatGeometry =
  | GeoJsonPolygon
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface TargetNote {
  id: string;
  project_id: string;
  category: string | null;
  title: string;
  description: string | null;
  priority: string | null;
  is_verified: boolean;
  location_text?: string | null;
  photos: string[] | null;
  site_id?: string | null;
}

export const conditionColors: Record<string, { label: string; color: string }> = {
  excellent: { label: "Excellent", color: "#059669" },
  good: { label: "Good", color: "#16A34A" },
  moderate: { label: "Moderate", color: "#D97706" },
  poor: { label: "Poor", color: "#DC2626" },
  bad: { label: "Bad", color: "#7C2D12" },
};

export const categoryLabels: Record<string, { label: string; color: string }> = {
  fauna: { label: "Fauna", color: "#2563EB" },
  flora: { label: "Flora", color: "#16A34A" },
  habitat: { label: "Habitat", color: "#059669" },
  check_feature: { label: "Check Feature", color: "#9333EA" },
  access_point: { label: "Access Point", color: "#D97706" },
};

/**
 * Web inserts "—" as the fossitt_code placeholder for NLC polygons that
 * have no Fossitt mapping. Treat that as null so colour/label fallbacks
 * (Unclassified rendering, gray fill) all converge through one branch.
 */
export function normaliseFossittCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (trimmed === "" || trimmed === "—" || trimmed === "-") return null;
  return trimmed;
}

export const UNCLASSIFIED_HABITAT_COLOR = "#9CA3AF";
