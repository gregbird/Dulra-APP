import { supabase } from "@/lib/supabase";
import { uploadPhoto } from "@/lib/photo-service";
import {
  saveSurveyLocally,
  savePhotoLocally,
  cacheSurvey,
  getCachedSurvey,
  getPendingSurveyByAnyId,
  setPendingSurveyVisitGroup,
} from "@/lib/database";
import { refreshPendingCount } from "@/lib/sync-service";
import { useNetworkStore } from "@/lib/network";
import { insertReleveSurvey, upsertReleveSurvey, insertReleveSpecies, extractReleveFromFormData, extractSpeciesFromFormData } from "@/lib/releve-save";
import {
  generateGroupId,
  getNextVisitNumber,
  loadAllVisitSurveysForProject,
} from "@/lib/visit-groups";
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

  // Cache write covers two cases:
  //   - Existing survey edited offline (params.surveyId is the remote uuid):
  //     update the cached row so the surveys list reflects the edit.
  //   - Brand-new survey created offline (no surveyId): cache it under the
  //     local id so the surveys list can show it AND so re-opening it
  //     before sync hydrates the form from cache instead of an empty
  //     loading state. The local-id row is deleted by sync once the
  //     remote uuid is assigned.
  const cacheId = params.surveyId ?? localId;
  await cacheSurvey({
    id: cacheId, projectId: params.projectId, surveyType: params.surveyType,
    surveyDate: new Date().toISOString().split("T")[0],
    status, weather: { templateFields: allFields }, formData: params.formData, notes: null,
    siteId: params.siteId,
  });

  for (const uri of params.pendingPhotoUris) {
    await savePhotoLocally({ localUri: uri, projectId: params.projectId, projectName: params.projectName, surveyLocalId: localId });
  }

  await refreshPendingCount();
  return { success: true, surveyId: params.surveyId ?? null, offline: true };
}

interface AddVisitParams {
  projectId: string;
  parentSurveyId: string;
  surveyType: string;
  surveyDate: string;
  notes: string | null;
  /** Defaults to logged-in user; set when admin/PM is recording on someone's behalf. */
  surveyorId?: string | null;
  /** Inherited from the parent survey's site. NULL for non-multi-site projects. */
  siteId?: string | null;
}

interface AddVisitResult {
  success: boolean;
  /** New visit's id — remote uuid online, local id offline. */
  newSurveyId: string | null;
  visitNumber: number | null;
  offline: boolean;
  error?: string;
}

/**
 * Resolve a parent survey across cache and pending tables. The surveys
 * list passes the `surveys.id` (remote) for synced rows or the local id
 * for unsynced ones; we accept either so the caller doesn't have to know.
 *
 * Returns `null` when the parent can't be found at all — caller surfaces
 * a "parent missing" error instead of pretending the conversion worked.
 */
async function resolveParentForAddVisit(parentSurveyId: string): Promise<{
  isPending: boolean;
  pendingId: string | null;
  remoteId: string | null;
  visitGroupId: string | null;
  visitNumber: number | null;
} | null> {
  const pending = await getPendingSurveyByAnyId(parentSurveyId);
  if (pending) {
    return {
      isPending: pending.remote_id == null,
      pendingId: pending.id,
      remoteId: pending.remote_id,
      visitGroupId: pending.visit_group_id,
      visitNumber: pending.visit_number,
    };
  }
  const cached = await getCachedSurvey(parentSurveyId);
  if (cached) {
    // Cached rows are synced by definition (they came from Supabase).
    // Their visit_group_id / visit_number live on the row itself.
    const c = cached as unknown as { visit_group_id: string | null; visit_number: number | null };
    return {
      isPending: false,
      pendingId: null,
      remoteId: parentSurveyId,
      visitGroupId: c.visit_group_id ?? null,
      visitNumber: c.visit_number ?? null,
    };
  }
  return null;
}

/**
 * Add a new visit to a survey group. Handles four shape combinations:
 *   - parent has group / parent is standalone
 *   - parent is synced / parent is still pending
 *
 * Standalone → group conversion generates a fresh UUID for visit_group_id
 * (NOT parent.id) so it survives sync — see docs/mobile-add-visit.md.
 *
 * Online path attempts direct writes; on any failure, falls through to
 * an offline path that mirrors the saveSurvey() rollback contract.
 *
 * The new visit always starts with an empty form_data. Releve-specific
 * basic defaults (releve_code, recorder, site_name) are generated when
 * the form opens — see releve-survey-form-screen's "isNew or empty
 * basic" branch. Don't copy from parent: visits to the same plot share
 * recorder/site context but the user expects a fresh survey feel.
 */
export async function saveAddVisit(params: AddVisitParams): Promise<AddVisitResult> {
  const parent = await resolveParentForAddVisit(params.parentSurveyId);
  if (!parent) {
    return { success: false, newSurveyId: null, visitNumber: null, offline: false, error: "Parent survey not found" };
  }

  const initialFormData: Record<string, unknown> = {};

  // Active offline probe: when the user is genuinely offline (airplane
  // mode), the network store may still report isOnline=true for a moment
  // before NetInfo flips it. Without this short-circuit, every supabase
  // call below waits up to 10s on the global.fetch timeout — three of
  // them stacked = a 30s+ frozen Save button. Skip straight to the
  // offline path when NetInfo confirms no connectivity.
  let isOnline = useNetworkStore.getState().isOnline;
  if (isOnline) {
    try {
      const NetInfo = (await import("@react-native-community/netinfo")).default;
      const state = await NetInfo.fetch();
      const probedOnline =
        state.isInternetReachable === true ||
        (state.isInternetReachable === null && state.isConnected === true);
      if (!probedOnline) {
        isOnline = false;
        useNetworkStore.getState().setOnline(false);
      }
    } catch { /* probe failed — keep optimistic value, online path will time out gracefully */ }
  }
  const trySupabase = isOnline;

  // Resolve current user once — used for both surveyor_id default and the
  // pending row's stored surveyor_id (mandatory NOT NULL on remote).
  let userId = params.surveyorId ?? "";
  if (!userId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      userId = session?.user?.id ?? "";
    } catch { /* offline — try again from getUser fallback below */ }
  }

  // visit_group_id strategy: reuse parent's if it has one, else mint fresh.
  // Fresh UUID lets the offline-pending parent share the same group_id with
  // the new visit without depending on parent's remote uuid existing yet.
  const isConverting = parent.visitGroupId == null;
  const groupId = parent.visitGroupId ?? generateGroupId();

  // visit_number computation reads cache + pending so two unsynced Add
  // Visit clicks on the same group don't both pick the same N.
  let nextNumber: number;
  if (isConverting) {
    nextNumber = 2; // parent becomes Visit 1, new is Visit 2
  } else {
    const allSurveys = await loadAllVisitSurveysForProject(params.projectId);
    nextNumber = getNextVisitNumber(allSurveys, groupId);
  }

  // ---- Online path ----
  // Skip entirely when the offline probe above confirmed no connectivity.
  // Throwing here lets the existing catch handler take over and run the
  // offline path without duplicating the local-write logic in two places.
  try {
    if (!trySupabase) throw new Error("offline");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("not authenticated");
    const surveyorIdToUse = params.surveyorId ?? user.id;

    // Step 1 — convert standalone parent if needed. We touch the parent
    // ONLY when isConverting; idempotent because once it has a group_id
    // we skip this branch.
    if (isConverting) {
      if (parent.remoteId) {
        const { error } = await supabase
          .from("surveys")
          .update({ visit_group_id: groupId, visit_number: 1, updated_at: new Date().toISOString() })
          .eq("id", parent.remoteId);
        if (error) throw error;
      } else if (parent.pendingId) {
        // Parent is pending only — flip its local row, the eventual
        // INSERT during sync will carry the group fields to the server.
        await setPendingSurveyVisitGroup({
          pendingId: parent.pendingId,
          visitGroupId: groupId,
          visitNumber: 1,
        });
      }
    }

    // Step 2 — insert the new visit. form_data carries over the plot
    // identity for relevé visits (basic section); empty for everything
    // else — the user fills the rest by tapping into the new survey.
    const { data, error } = await supabase
      .from("surveys")
      .insert({
        project_id: params.projectId,
        survey_type: params.surveyType,
        surveyor_id: surveyorIdToUse,
        survey_date: params.surveyDate,
        status: "in_progress",
        sync_status: "synced",
        weather: { templateFields: {} },
        form_data: initialFormData,
        notes: params.notes,
        site_id: params.siteId ?? null,
        visit_group_id: groupId,
        visit_number: nextNumber,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("insert returned no data");
    const newId = data.id as string;

    // Cache both rows so the surveys list reflects the change immediately
    // without waiting for a refetch round-trip.
    await cacheSurvey({
      id: newId,
      projectId: params.projectId,
      surveyType: params.surveyType,
      surveyDate: params.surveyDate,
      status: "in_progress",
      weather: { templateFields: {} },
      formData: initialFormData,
      notes: params.notes,
      siteId: params.siteId,
      visitGroupId: groupId,
      visitNumber: nextNumber,
    });
    if (isConverting && parent.remoteId) {
      const cachedParent = await getCachedSurvey(parent.remoteId);
      if (cachedParent) {
        const c = cachedParent as unknown as {
          survey_type: string; survey_date: string; status: string;
          weather: string | null; form_data: string | null; site_id: string | null;
        };
        let weather: Record<string, unknown> = {};
        let formData: Record<string, unknown> = {};
        try { weather = c.weather ? JSON.parse(c.weather) : {}; } catch { /* corrupt */ }
        try { formData = c.form_data ? JSON.parse(c.form_data) : {}; } catch { /* corrupt */ }
        await cacheSurvey({
          id: parent.remoteId,
          projectId: params.projectId,
          surveyType: c.survey_type,
          surveyDate: c.survey_date,
          status: c.status,
          weather, formData, notes: null, siteId: c.site_id,
          visitGroupId: groupId,
          visitNumber: 1,
        });
      }
    }

    return { success: true, newSurveyId: newId, visitNumber: nextNumber, offline: false };
  } catch {
    // ---- Offline path ----
    // 1. If converting, flip parent's pending row (or create a synced→pending
    //    update record for an already-synced parent).
    if (isConverting) {
      if (parent.pendingId) {
        await setPendingSurveyVisitGroup({
          pendingId: parent.pendingId,
          visitGroupId: groupId,
          visitNumber: 1,
        });
      } else if (parent.remoteId) {
        // Parent is synced but we're offline — write a pending update row
        // keyed by remote_id so syncSurveys' UPDATE branch picks it up.
        await saveSurveyLocally({
          remoteId: parent.remoteId,
          projectId: params.projectId,
          surveyType: params.surveyType,
          surveyorId: userId,
          surveyDate: params.surveyDate,
          status: "in_progress",
          weather: { templateFields: {} },
          formData: {},
          siteId: params.siteId,
          visitGroupId: groupId,
          visitNumber: 1,
        });
      }
    }

    // 2. Insert the new visit as its own pending row. The local id IS the
    //    surveyor's visible id until sync; surveys-list resolves via
    //    pending too so it shows up immediately.
    const localId = await saveSurveyLocally({
      projectId: params.projectId,
      surveyType: params.surveyType,
      surveyorId: userId,
      surveyDate: params.surveyDate,
      status: "in_progress",
      weather: { templateFields: {} },
      formData: initialFormData,
      siteId: params.siteId,
      visitGroupId: groupId,
      visitNumber: nextNumber,
    });

    // Cache the new visit under its local id so:
    //   (a) it appears in the surveys list immediately, and
    //   (b) when add-visit-screen replaces() to /survey/[localId] the
    //       form can hydrate from cache instead of staying on a blank
    //       loading state. The local-id row is dropped by sync once the
    //       remote uuid is assigned (see sync-service deleteCachedSurvey).
    await cacheSurvey({
      id: localId,
      projectId: params.projectId,
      surveyType: params.surveyType,
      surveyDate: params.surveyDate,
      status: "in_progress",
      weather: { templateFields: {} },
      formData: initialFormData,
      notes: params.notes,
      siteId: params.siteId,
      visitGroupId: groupId,
      visitNumber: nextNumber,
    });

    await refreshPendingCount();
    return { success: true, newSurveyId: localId, visitNumber: nextNumber, offline: true };
  }
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
