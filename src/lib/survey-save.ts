import { supabase } from "@/lib/supabase";
import { uploadPhoto } from "@/lib/photo-service";
import { saveSurveyLocally, savePhotoLocally, cacheSurvey } from "@/lib/database";
import { refreshPendingCount } from "@/lib/sync-service";
import { insertReleveSurvey, upsertReleveSurvey, insertReleveSpecies, extractReleveFromFormData, extractSpeciesFromFormData } from "@/lib/releve-save";
import type { FormData } from "@/types/survey-template";

interface SaveParams {
  surveyId: string | null;
  projectId: string;
  projectName: string;
  surveyType: string;
  formData: FormData;
  markComplete: boolean;
  pendingPhotoUris: string[];
  siteId?: string | null;
  // Defaults to the logged-in user when null/undefined. Set explicitly when an
  // admin/PM is recording a survey on behalf of a team member (attribution fix).
  surveyorId?: string | null;
}

interface SaveResult {
  success: boolean;
  surveyId: string | null;
  offline: boolean;
  error?: string;
}

async function saveOffline(params: SaveParams, status: string, allFields: Record<string, string | number | null>): Promise<SaveResult> {
  let userId = params.surveyorId ?? "";
  if (!userId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      userId = session?.user?.id ?? "";
    } catch { /* offline — surveyor_id stays empty, sync fills it later */ }
  }

  const localId = await saveSurveyLocally({
    remoteId: params.surveyId ?? undefined,
    projectId: params.projectId, surveyType: params.surveyType, surveyorId: userId,
    surveyDate: new Date().toISOString().split("T")[0],
    status, weather: { templateFields: allFields }, formData: params.formData,
    siteId: params.siteId,
  });

  // Mevcut survey düzenleniyorsa cache'i de güncelle
  if (params.surveyId) {
    await cacheSurvey({
      id: params.surveyId, projectId: params.projectId, surveyType: params.surveyType,
      surveyDate: new Date().toISOString().split("T")[0],
      status, weather: { templateFields: allFields }, formData: params.formData, notes: null,
      siteId: params.siteId,
    });
  }

  for (const uri of params.pendingPhotoUris) {
    await savePhotoLocally({ localUri: uri, projectId: params.projectId, projectName: params.projectName, surveyLocalId: localId });
  }

  await refreshPendingCount();
  return { success: true, surveyId: params.surveyId ?? null, offline: true };
}

async function rollbackSurveyInsert(surveyId: string): Promise<void> {
  try {
    await supabase.from("surveys").delete().eq("id", surveyId);
  } catch {
    // Best-effort rollback — if delete fails the orphan stays, but sync idempotency (local_id)
    // prevents duplicates from the subsequent offline retry.
  }
}

export async function saveSurvey(params: SaveParams): Promise<SaveResult> {
  const { surveyId, projectId, projectName, surveyType, formData, markComplete, pendingPhotoUris } = params;
  const status = markComplete ? "completed" : "in_progress";

  const allFields: Record<string, string | number | null> = {};
  for (const [, sectionValues] of Object.entries(formData)) {
    Object.assign(allFields, sectionValues);
  }

  let createdSurveyIdForRollback: string | null = null;

  try {
    let currentId = surveyId;

    if (!currentId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !projectId) throw new Error("No user");

      const surveyorIdToUse = params.surveyorId ?? user.id;

      const { data, error } = await supabase
        .from("surveys")
        .insert({
          project_id: projectId, survey_type: surveyType, surveyor_id: surveyorIdToUse,
          survey_date: new Date().toISOString().split("T")[0], status,
          sync_status: "synced", weather: { templateFields: allFields }, form_data: formData,
          site_id: params.siteId ?? null,
        })
        .select("id")
        .single();

      if (error || !data) throw new Error("Failed to create");
      currentId = data.id;
      createdSurveyIdForRollback = currentId;

      if (surveyType === "releve_survey") {
        const releveFields = extractReleveFromFormData(formData);
        const releveId = await insertReleveSurvey({
          projectId,
          surveyId: currentId,
          surveyDate: new Date().toISOString().split("T")[0],
          releveFields,
          userId: surveyorIdToUse,
          siteId: params.siteId ?? null,
        });
        if (releveId) {
          const species = extractSpeciesFromFormData(formData);
          await insertReleveSpecies(releveId, species);
        }
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();

      // Include surveyor_id in UPDATE when the form explicitly set it,
      // so admin/PM reassignment via SurveyorPicker actually persists.
      const updatePayload: Record<string, unknown> = {
        weather: { templateFields: allFields },
        form_data: formData,
        status,
        updated_at: new Date().toISOString(),
      };
      if (params.surveyorId) {
        updatePayload.surveyor_id = params.surveyorId;
      }

      const { error } = await supabase
        .from("surveys")
        .update(updatePayload)
        .eq("id", currentId);
      if (error) throw new Error("Failed to update");

      if (surveyType === "releve_survey" && currentId) {
        const releveFields = extractReleveFromFormData(formData);
        const releveId = await upsertReleveSurvey({
          projectId,
          surveyId: currentId,
          surveyDate: new Date().toISOString().split("T")[0],
          releveFields,
          userId: params.surveyorId ?? user?.id,
          siteId: params.siteId ?? null,
        });
        if (releveId) {
          const species = extractSpeciesFromFormData(formData);
          await insertReleveSpecies(releveId, species);
        }
      }
    }

    // Attempt direct upload for each photo. If any fails (network flake mid-save,
    // storage permission, watermark error), enqueue it to pending_photos with the
    // remote surveyId so the sync service retries it later.
    const uploadResults = await Promise.allSettled(
      pendingPhotoUris.map(async (uri) => {
        const result = await uploadPhoto({ localUri: uri, projectId, projectName, surveyId: currentId ?? undefined });
        if (!result) throw new Error("upload returned null");
        return { uri, result };
      })
    );
    for (let i = 0; i < uploadResults.length; i++) {
      const r = uploadResults[i];
      if (r.status === "rejected") {
        await savePhotoLocally({
          localUri: pendingPhotoUris[i],
          projectId,
          projectName,
          surveyId: currentId ?? undefined,
        });
      }
    }

    if (currentId) {
      await cacheSurvey({
        id: currentId, projectId, surveyType, surveyDate: new Date().toISOString().split("T")[0],
        status, weather: { templateFields: allFields }, formData, notes: null,
        siteId: params.siteId,
      });
    }

    return { success: true, surveyId: currentId, offline: false };
  } catch {
    // If we created a parent surveys row and a downstream step failed, roll it back
    // so the subsequent offline save doesn't produce an orphan + duplicate on next sync.
    if (createdSurveyIdForRollback) {
      await rollbackSurveyInsert(createdSurveyIdForRollback);
    }
    return saveOffline(params, status, allFields);
  }
}
