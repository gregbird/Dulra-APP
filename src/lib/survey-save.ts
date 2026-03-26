import { supabase } from "@/lib/supabase";
import { uploadPhoto } from "@/lib/photo-service";
import { saveSurveyLocally, savePhotoLocally } from "@/lib/database";
import { refreshPendingCount } from "@/lib/sync-service";
import type { FormData } from "@/types/survey-template";

interface SaveParams {
  surveyId: string | null;
  projectId: string;
  projectName: string;
  surveyType: string;
  formData: FormData;
  markComplete: boolean;
  pendingPhotoUris: string[];
}

interface SaveResult {
  success: boolean;
  surveyId: string | null;
  offline: boolean;
  error?: string;
}

async function saveOffline(params: SaveParams, status: string, allFields: Record<string, string | number | null>): Promise<SaveResult> {
  let userId = "";
  try {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? "";
  } catch { /* offline */ }

  const localId = await saveSurveyLocally({
    remoteId: params.surveyId ?? undefined,
    projectId: params.projectId, surveyType: params.surveyType, surveyorId: userId,
    surveyDate: new Date().toISOString().split("T")[0],
    status, weather: { templateFields: allFields }, formData: params.formData,
  });

  for (const uri of params.pendingPhotoUris) {
    await savePhotoLocally({ localUri: uri, projectId: params.projectId, projectName: params.projectName, surveyLocalId: localId });
  }

  await refreshPendingCount();
  return { success: true, surveyId: null, offline: true };
}

export async function saveSurvey(params: SaveParams): Promise<SaveResult> {
  const { surveyId, projectId, projectName, surveyType, formData, markComplete, pendingPhotoUris } = params;
  const status = markComplete ? "completed" : "in_progress";

  const allFields: Record<string, string | number | null> = {};
  for (const [, sectionValues] of Object.entries(formData)) {
    Object.assign(allFields, sectionValues);
  }

  try {
    let currentId = surveyId;

    if (!currentId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !projectId) throw new Error("No user");

      const { data, error } = await supabase
        .from("surveys")
        .insert({
          project_id: projectId, survey_type: surveyType, surveyor_id: user.id,
          survey_date: new Date().toISOString().split("T")[0], status,
          sync_status: "synced", weather: { templateFields: allFields }, form_data: formData,
        })
        .select("id")
        .single();

      if (error || !data) throw new Error("Failed to create");
      currentId = data.id;
    } else {
      const { error } = await supabase
        .from("surveys")
        .update({ weather: { templateFields: allFields }, form_data: formData, status, updated_at: new Date().toISOString() })
        .eq("id", currentId);
      if (error) throw new Error("Failed to update");
    }

    await Promise.allSettled(
      pendingPhotoUris.map((uri) => uploadPhoto({ localUri: uri, projectId, projectName, surveyId: currentId ?? undefined }))
    );

    return { success: true, surveyId: currentId, offline: false };
  } catch {
    return saveOffline(params, status, allFields);
  }
}
