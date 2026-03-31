import { supabase } from "@/lib/supabase";
import { extractReleveFields } from "@/types/releve";
import type { ReleveData, ReleveSpeciesEntry } from "@/types/releve";

/**
 * Insert a record into the releve_surveys table.
 * Called after the parent survey row is created in the surveys table.
 * Returns the new releve_surveys.id or null on failure.
 */
export async function insertReleveSurvey(params: {
  projectId: string;
  surveyId: string | null;
  surveyDate: string;
  releveFields: Partial<ReleveData>;
  userId?: string | null;
}): Promise<string | null> {
  const { projectId, surveyId, surveyDate, releveFields, userId } = params;

  if (!releveFields.releve_code || !releveFields.recorder) {
    return null;
  }

  const row: Record<string, unknown> = {
    project_id: projectId,
    survey_id: surveyId,
    survey_date: surveyDate,
    created_by: userId ?? null,
    ...releveFields,
  };

  const { data, error } = await supabase
    .from("releve_surveys")
    .insert(row)
    .select("id")
    .single();

  if (error || !data) return null;
  return data.id;
}

/**
 * Delete + re-insert the releve_surveys row for an existing survey.
 * Used when editing a previously saved releve survey (web uses the same pattern).
 */
export async function upsertReleveSurvey(params: {
  projectId: string;
  surveyId: string;
  surveyDate: string;
  releveFields: Partial<ReleveData>;
  userId?: string | null;
}): Promise<string | null> {
  await supabase
    .from("releve_surveys")
    .delete()
    .eq("survey_id", params.surveyId);

  return insertReleveSurvey(params);
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
    site_name: params.projectName,
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

  await supabase.from("releve_species").insert(rows);
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
