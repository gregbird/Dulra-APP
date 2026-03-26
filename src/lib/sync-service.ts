import { supabase } from "@/lib/supabase";
import { uploadPhoto } from "@/lib/photo-service";
import {
  getPendingSurveys,
  getPendingPhotos,
  markSurveySynced,
  markPhotoSynced,
  getPendingCount,
} from "@/lib/database";
import { useNetworkStore } from "@/lib/network";

let syncing = false;

export async function syncPendingData(): Promise<void> {
  if (syncing) return;
  const { isOnline } = useNetworkStore.getState();
  if (!isOnline) return;

  syncing = true;
  useNetworkStore.getState().setSyncing(true);

  try {
    await syncSurveys();
    await syncPhotos();
  } finally {
    syncing = false;
    useNetworkStore.getState().setSyncing(false);
    const count = await getPendingCount();
    useNetworkStore.getState().setPendingCount(count);
  }
}

async function syncSurveys(): Promise<void> {
  const pending = await getPendingSurveys();

  for (const survey of pending) {
    let weather: Record<string, unknown> = {};
    let formData: Record<string, unknown> = {};
    try { weather = JSON.parse(survey.weather || "{}"); } catch { /* corrupted */ }
    try { formData = JSON.parse(survey.form_data || "{}"); } catch { /* corrupted */ }

    const allFields: Record<string, unknown> = {};
    for (const [, sectionValues] of Object.entries(formData)) {
      Object.assign(allFields, sectionValues as Record<string, unknown>);
    }

    if (survey.remote_id) {
      const { error } = await supabase
        .from("surveys")
        .update({
          weather: { templateFields: allFields },
          form_data: formData,
          status: survey.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", survey.remote_id);

      if (!error) {
        await markSurveySynced(survey.id);
        await updatePhotoSurveyIds(survey.id, survey.remote_id);
      }
    } else {
      let surveyorId = survey.surveyor_id;
      if (!surveyorId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          surveyorId = user?.id ?? "";
        } catch { /* ignore */ }
      }

      const { data, error } = await supabase
        .from("surveys")
        .insert({
          project_id: survey.project_id,
          survey_type: survey.survey_type,
          surveyor_id: surveyorId || null,
          survey_date: survey.survey_date,
          status: survey.status,
          sync_status: "synced",
          local_id: survey.id,
          weather: { templateFields: allFields },
          form_data: formData,
        })
        .select("id")
        .single();

      if (!error && data) {
        await markSurveySynced(survey.id);
        await updatePhotoSurveyIds(survey.id, data.id);
      }
    }
  }
}

async function updatePhotoSurveyIds(localId: string, remoteId: string): Promise<void> {
  const { getDatabase } = await import("@/lib/database");
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE pending_photos SET survey_id = ? WHERE survey_local_id = ? AND sync_status = 'pending'`,
    remoteId, localId
  );
}

async function syncPhotos(): Promise<void> {
  const pending = await getPendingPhotos();

  for (const photo of pending) {
    if (!photo.survey_id) continue;

    const result = await uploadPhoto({
      localUri: photo.local_uri,
      projectId: photo.project_id,
      projectName: photo.project_name ?? undefined,
      surveyId: photo.survey_id,
    });

    if (result) {
      await markPhotoSynced(photo.id);
    }
  }
}

export async function refreshPendingCount(): Promise<void> {
  const count = await getPendingCount();
  useNetworkStore.getState().setPendingCount(count);
}
