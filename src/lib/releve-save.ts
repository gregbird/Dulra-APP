import { supabase } from "@/lib/supabase";
import { extractReleveFields } from "@/types/releve";
import type { ReleveData, ReleveSpeciesEntry } from "@/types/releve";
import { RELEVE_SECTIONS } from "@/constants/releve-data";

/**
 * Build a FormData-shaped object from a releve_surveys row.
 * Groups flat columns back into sections using RELEVE_SECTIONS.
 * Used to keep cache in sync when web updates releve_surveys
 * without touching surveys.form_data.
 */
export function buildFormDataFromReleve(
  releve: Record<string, unknown>,
  existingFormData?: Record<string, unknown> | null,
): Record<string, unknown> {
  const result: Record<string, Record<string, string | number | null>> = {};
  for (const section of RELEVE_SECTIONS) {
    const sectionData: Record<string, string | number | null> = {};
    for (const field of section.fields) {
      const val = releve[field.key];
      if (val != null) sectionData[field.key] = val as string | number;
    }
    if (Object.keys(sectionData).length > 0) result[section.id] = sectionData;
  }
  // Preserve species from existing form_data (releve_species is a separate table)
  if (existingFormData?.species) {
    (result as Record<string, unknown>).species = existingFormData.species;
  }
  return result;
}

/**
 * Build a PostGIS POINT WKT in `SRID=4326;POINT(lng lat)` form when both
 * coords are present. Mirrors web's queries/releve-surveys.ts:131-132 — the
 * geometry column is the source of truth for spatial queries (Step 5 maps
 * tab) and a populated `location` is also the marker that tells migration
 * tooling "this row was written with the correct convention".
 */
function buildLocationWkt(fields: Partial<ReleveData>): string | null {
  const lng = fields.survey_x_coord;
  const lat = fields.survey_y_coord;
  if (lng == null || lat == null) return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/**
 * Insert a record into the releve_surveys table.
 * Called after the parent survey row is created in the surveys table.
 *
 * Returns the new releve_surveys.id, or null when there's no meaningful data
 * to persist (missing releve_code/recorder — legitimate early-exit case).
 * Throws on actual Supabase errors so callers can roll back the parent survey.
 */
export async function insertReleveSurvey(params: {
  projectId: string;
  surveyId: string | null;
  surveyDate: string;
  releveFields: Partial<ReleveData>;
  userId?: string | null;
  siteId?: string | null;
}): Promise<string | null> {
  const { projectId, surveyId, surveyDate, releveFields, userId, siteId } = params;

  if (!releveFields.releve_code || !releveFields.recorder) {
    return null;
  }

  const row: Record<string, unknown> = {
    project_id: projectId,
    survey_id: surveyId,
    survey_date: surveyDate,
    site_id: siteId ?? null,
    created_by: userId ?? null,
    ...releveFields,
  };

  const locationWkt = buildLocationWkt(releveFields);
  if (locationWkt) row.location = locationWkt;

  const { data, error } = await supabase
    .from("releve_surveys")
    .insert(row)
    .select("id")
    .single();

  if (error) throw new Error(`releve_surveys insert failed: ${error.message}`);
  if (!data) throw new Error("releve_surveys insert returned no row");
  return data.id;
}

/**
 * Atomic upsert of the releve_surveys row for an existing survey.
 *
 * Native PostgREST upsert with onConflict requires a UNIQUE constraint on
 * the target column. `releve_surveys.survey_id` is currently a plain FK
 * (no unique index), so `.upsert(..., { onConflict: "survey_id" })` fails
 * with "no unique or exclusion constraint matching the ON CONFLICT
 * specification" the moment a row for that survey already exists.
 *
 * Workaround: manual SELECT → UPDATE if exists, INSERT otherwise. Not
 * race-safe across simultaneous writers, but the mobile sync queue runs
 * one survey at a time so that's acceptable.
 *
 * TODO(web): once releve_surveys.survey_id gets a UNIQUE constraint,
 * collapse this back into a single .upsert() call.
 */
export async function upsertReleveSurvey(params: {
  projectId: string;
  surveyId: string;
  surveyDate: string;
  releveFields: Partial<ReleveData>;
  userId?: string | null;
  siteId?: string | null;
}): Promise<string | null> {
  const { projectId, surveyId, surveyDate, releveFields, userId, siteId } = params;

  if (!releveFields.releve_code || !releveFields.recorder) {
    return null;
  }

  const row: Record<string, unknown> = {
    project_id: projectId,
    survey_id: surveyId,
    survey_date: surveyDate,
    site_id: siteId ?? null,
    created_by: userId ?? null,
    ...releveFields,
  };

  const locationWkt = buildLocationWkt(releveFields);
  if (locationWkt) row.location = locationWkt;

  const { data: existing, error: selectError } = await supabase
    .from("releve_surveys")
    .select("id")
    .eq("survey_id", surveyId)
    .maybeSingle();

  if (selectError) {
    throw new Error(`releve_surveys lookup failed: ${selectError.message}`);
  }

  let releveId: string;
  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("releve_surveys")
      .update(row)
      .eq("id", existing.id);
    if (updateError) {
      throw new Error(`releve_surveys update failed: ${updateError.message}`);
    }
    releveId = existing.id;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("releve_surveys")
      .insert(row)
      .select("id")
      .single();
    if (insertError) {
      throw new Error(`releve_surveys insert failed: ${insertError.message}`);
    }
    if (!inserted) throw new Error("releve_surveys insert returned no row");
    releveId = inserted.id;
  }

  // Clear species for this releve so the subsequent insertReleveSpecies call
  // can re-populate without leaving stale rows from a previous edit.
  await supabase.from("releve_species").delete().eq("releve_id", releveId);

  return releveId;
}

/**
 * Generate default values for a new releve survey form.
 * - releve_code: REL {101 + existing count}
 * - recorder: current user's full_name from profiles
 * - survey_date: today (ISO date string)
 * - site_name: project name (until multi-site is implemented)
 */
export async function getReleveDefaults(params: {
  projectId: string;
  projectName: string;
  siteName?: string | null;
}): Promise<{
  releve_code: string;
  recorder: string;
  survey_date: string;
  site_name: string;
}> {
  const surveyDate = new Date().toISOString().split("T")[0];
  let recorder = "";
  let existingCount = 0;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();
      recorder = profile?.full_name ?? "";
    }
  } catch { /* offline — recorder stays empty, user fills manually */ }

  try {
    const { count, error } = await supabase
      .from("releve_surveys")
      .select("id", { count: "exact", head: true })
      .eq("project_id", params.projectId);
    if (!error && count != null) existingCount = count;
  } catch { /* offline — start from 101 */ }

  // Also count local pending releve surveys not yet synced
  try {
    const { getDatabase } = await import("@/lib/database");
    const database = await getDatabase();
    const row = await database.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM pending_surveys WHERE project_id = ? AND survey_type = 'releve_survey' AND sync_status = 'pending'`,
      params.projectId,
    );
    existingCount += row?.cnt ?? 0;
  } catch { /* ignore */ }

  return {
    releve_code: `REL ${101 + existingCount}`,
    recorder,
    survey_date: surveyDate,
    site_name: params.siteName ?? params.projectName,
  };
}

/**
 * Insert species rows into releve_species for a given releve.
 * Skips entries without species_name_latin.
 */
export async function insertReleveSpecies(
  releveId: string,
  species: ReleveSpeciesEntry[],
): Promise<void> {
  const rows = species
    .filter((s) => s.species_name_latin?.trim())
    .map((s) => ({
      releve_id: releveId,
      species_name_latin: s.species_name_latin.trim(),
      species_name_english: s.species_name_english?.trim() || null,
      species_cover_domin: s.species_cover_domin ?? null,
      species_cover_pct: s.species_cover_pct ?? null,
      notes: s.notes?.trim() || null,
    }));

  if (rows.length === 0) return;

  const { error } = await supabase.from("releve_species").insert(rows);
  if (error) throw new Error(`releve_species insert failed: ${error.message}`);
}

/**
 * Flatten formData sections into a single key-value map,
 * then extract only the keys that belong to releve_surveys.
 */
export function extractReleveFromFormData(
  formData: Record<string, unknown>,
): Partial<ReleveData> {
  const flat: Record<string, string | number | null> = {};

  for (const [key, section] of Object.entries(formData)) {
    if (key === "species") continue;
    if (section && typeof section === "object" && !Array.isArray(section)) {
      for (const [fieldKey, val] of Object.entries(section as Record<string, unknown>)) {
        flat[fieldKey] = val as string | number | null;
      }
    }
  }

  return extractReleveFields(flat);
}

/**
 * Extract species entries from formData.
 * Expects formData.species to be an array of ReleveSpeciesEntry.
 */
export function extractSpeciesFromFormData(
  formData: Record<string, unknown>,
): ReleveSpeciesEntry[] {
  const raw = formData.species;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ReleveSpeciesEntry =>
      item != null && typeof item === "object" && typeof (item as Record<string, unknown>).species_name_latin === "string",
  );
}
