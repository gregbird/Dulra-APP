import { supabase } from "@/lib/supabase";
import { uploadPhoto } from "@/lib/photo-service";
import {
  getPendingSurveys,
  getPendingPhotos,
  markSurveySynced,
  markPhotoSynced,
  recordPhotoRetryFailure,
  getPendingCount,
  cacheSurvey,
} from "@/lib/database";
import { useNetworkStore } from "@/lib/network";
import { insertReleveSurvey, upsertReleveSurvey, insertReleveSpecies, extractReleveFromFormData, extractSpeciesFromFormData } from "@/lib/releve-save";

// Promise-based lock: multiple triggers (SyncIndicator, network listener, AppState)
// can race before `syncing = true` is committed. Holding the in-flight promise
// and returning it guarantees a single concurrent sync pass.
let syncPromise: Promise<void> | null = null;

export async function syncPendingData(): Promise<void> {
  if (syncPromise) return syncPromise;
  const { isOnline } = useNetworkStore.getState();
  if (!isOnline) return;

  syncPromise = (async () => {
    useNetworkStore.getState().setSyncing(true);
    try {
      await syncSurveys();
      await syncPhotos();
    } finally {
      useNetworkStore.getState().setSyncing(false);
      const count = await getPendingCount();
      useNetworkStore.getState().setPendingCount(count);
    }
  })().finally(() => {
    syncPromise = null;
  });

  return syncPromise;
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

      if (error) continue;

      if (survey.survey_type === "releve_survey") {
        try {
          const releveFields = extractReleveFromFormData(formData as Record<string, unknown>);
          const releveId = await upsertReleveSurvey({
            projectId: survey.project_id,
            surveyId: survey.remote_id,
            surveyDate: survey.survey_date,
            releveFields,
            userId: survey.surveyor_id || null,
            siteId: survey.site_id,
          });
          if (releveId) {
            const species = extractSpeciesFromFormData(formData as Record<string, unknown>);
            await insertReleveSpecies(releveId, species);
          }
        } catch {
          // Leave pending for next sync retry
          continue;
        }
      }

      await cacheSurvey({
        id: survey.remote_id,
        projectId: survey.project_id,
        surveyType: survey.survey_type,
        surveyDate: survey.survey_date,
        status: survey.status,
        weather: { templateFields: allFields },
        formData,
        notes: null,
        siteId: survey.site_id,
      });

      await markSurveySynced(survey.id);
      await updatePhotoSurveyIds(survey.id, survey.remote_id);
    } else {
      let surveyorId = survey.surveyor_id;
      if (!surveyorId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          surveyorId = user?.id ?? "";
        } catch { /* ignore */ }
      }

      // Idempotent sync: if a previous sync pass was interrupted after the
      // surveys INSERT but before markSurveySynced, the remote row already
      // exists with this local_id. Reuse it instead of creating a duplicate.
      let remoteId: string | null = null;
      try {
        const { data: existing } = await supabase
          .from("surveys")
          .select("id")
          .eq("local_id", survey.id)
          .maybeSingle();
        if (existing?.id) remoteId = existing.id;
      } catch { /* fall through to INSERT */ }

      if (!remoteId) {
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
            site_id: survey.site_id ?? null,
          })
          .select("id")
          .single();

        if (error || !data) continue;
        remoteId = data.id as string;
      } else {
        // Existing remote row from a prior partial sync — refresh its contents
        // so the latest local edits win.
        await supabase
          .from("surveys")
          .update({
            status: survey.status,
            weather: { templateFields: allFields },
            form_data: formData,
            site_id: survey.site_id ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", remoteId);
      }

      // Narrow for TS — both branches above either set remoteId or continue,
      // so it is guaranteed non-null at this point.
      if (!remoteId) continue;
      const syncedId: string = remoteId;

      if (survey.survey_type === "releve_survey") {
        try {
          const releveFields = extractReleveFromFormData(formData as Record<string, unknown>);
          const releveId = await upsertReleveSurvey({
            projectId: survey.project_id,
            surveyId: syncedId,
            surveyDate: survey.survey_date,
            releveFields,
            userId: surveyorId || null,
            siteId: survey.site_id,
          });
          if (releveId) {
            const species = extractSpeciesFromFormData(formData as Record<string, unknown>);
            await insertReleveSpecies(releveId, species);
          }
        } catch {
          // Releve write failed — parent survey is fine; leave pending so next
          // sync retries. markSurveySynced is skipped below.
          continue;
        }
      }

      await cacheSurvey({
        id: syncedId,
        projectId: survey.project_id,
        surveyType: survey.survey_type,
        surveyDate: survey.survey_date,
        status: survey.status,
        weather: { templateFields: allFields },
        formData,
        notes: null,
        siteId: survey.site_id,
      });

      await markSurveySynced(survey.id);
      await updatePhotoSurveyIds(survey.id, syncedId);
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
    // Photos without a remote survey_id yet — surveys sync has not completed
    // mapping local→remote. Next sync pass will pick them up.
    if (!photo.survey_id) continue;

    try {
      const result = await uploadPhoto({
        localUri: photo.local_uri,
        projectId: photo.project_id,
        projectName: photo.project_name ?? undefined,
        surveyId: photo.survey_id,
      });

      if (result) {
        await markPhotoSynced(photo.id);
      } else {
        await recordPhotoRetryFailure(photo.id, "upload returned null");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await recordPhotoRetryFailure(photo.id, msg);
    }
  }
}

export async function refreshPendingCount(): Promise<void> {
  const count = await getPendingCount();
  useNetworkStore.getState().setPendingCount(count);
}
