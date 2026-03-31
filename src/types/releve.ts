export interface ReleveData {
  releve_code: string;
  recorder: string;
  survey_date?: string;
  site_name?: string | null;
  releve_area_sqm?: number | null;
  accuracy_m?: number | null;
  survey_x_coord?: number | null;
  survey_y_coord?: number | null;
  habitat_type?: string | null;
  soil_type?: string | null;
  soil_stability?: string | null;
  aspect?: string | null;
  slope_degrees?: number | null;
  max_height_trees_m?: number | null;
  max_height_shrubs_cm?: number | null;
  max_height_bryophytes_cm?: number | null;
  max_height_graminea_cm?: number | null;
  max_height_forbs_cm?: number | null;
  median_height_graminea_cm?: number | null;
  median_height_forbs_cm?: number | null;
  total_vegetation_cover_pct?: number | null;
  cover_graminea_pct?: number | null;
  cover_forbs_pct?: number | null;
  cover_mosses_liverworts_pct?: number | null;
  cover_trees_pct?: number | null;
  cover_shrubs_pct?: number | null;
  cover_litter_pct?: number | null;
  cover_bare_soil_pct?: number | null;
  cover_bare_rock_pct?: number | null;
  cover_open_water_pct?: number | null;
  other_species_proximity?: string | null;
  fauna_observations?: string | null;
  releve_comment?: string | null;
  custom_fields?: Record<string, unknown>;
}

export interface ReleveSpeciesEntry {
  species_name_latin: string;
  species_name_english?: string | null;
  species_cover_domin?: number | null;
  species_cover_pct?: number | null;
  notes?: string | null;
}

/** Keys in releve_surveys that accept numeric values */
const NUMERIC_KEYS: ReadonlySet<string> = new Set([
  "releve_area_sqm", "accuracy_m", "survey_x_coord", "survey_y_coord",
  "slope_degrees", "max_height_trees_m", "max_height_shrubs_cm",
  "max_height_bryophytes_cm", "max_height_graminea_cm", "max_height_forbs_cm",
  "median_height_graminea_cm", "median_height_forbs_cm",
  "total_vegetation_cover_pct", "cover_graminea_pct", "cover_forbs_pct",
  "cover_mosses_liverworts_pct", "cover_trees_pct", "cover_shrubs_pct",
  "cover_litter_pct", "cover_bare_soil_pct", "cover_bare_rock_pct",
  "cover_open_water_pct",
]);

/** All valid releve_surveys column keys (excludes id, created_at, updated_at, location) */
const RELEVE_KEYS: ReadonlySet<string> = new Set([
  "releve_code", "recorder", "site_name", "releve_area_sqm", "accuracy_m",
  "survey_x_coord", "survey_y_coord", "habitat_type", "soil_type",
  "soil_stability", "aspect", "slope_degrees", "max_height_trees_m",
  "max_height_shrubs_cm", "max_height_bryophytes_cm", "max_height_graminea_cm",
  "max_height_forbs_cm", "median_height_graminea_cm", "median_height_forbs_cm",
  "total_vegetation_cover_pct", "cover_graminea_pct", "cover_forbs_pct",
  "cover_mosses_liverworts_pct", "cover_trees_pct", "cover_shrubs_pct",
  "cover_litter_pct", "cover_bare_soil_pct", "cover_bare_rock_pct",
  "cover_open_water_pct", "other_species_proximity", "fauna_observations",
  "releve_comment",
]);

/**
 * Extract releve fields from a flat key-value map (flattened form sections).
 * Converts numeric strings to numbers where appropriate.
 */
export function extractReleveFields(
  allFields: Record<string, string | number | null | undefined>,
): Partial<ReleveData> {
  const result: Record<string, string | number | null> = {};

  for (const [key, raw] of Object.entries(allFields)) {
    if (!RELEVE_KEYS.has(key)) continue;
    if (raw === undefined || raw === "") {
      result[key] = null;
      continue;
    }
    if (NUMERIC_KEYS.has(key)) {
      const num = typeof raw === "number" ? raw : Number(raw);
      result[key] = Number.isFinite(num) ? num : null;
    } else {
      result[key] = raw === null ? null : String(raw);
    }
  }

  return result as Partial<ReleveData>;
}
