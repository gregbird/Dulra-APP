import type { Survey } from "@/types/survey";
import { getCachedSurveys, getPendingSurveysForProject } from "@/lib/database";

/**
 * Minimal UUID v4 generator. We only need a stable, well-formatted UUID
 * for visit_group_id; cryptographic strength isn't required (group ids
 * are non-secret, collisions across the planet's ecologists are
 * vanishingly unlikely with 122 random bits even from Math.random).
 *
 * Bringing in expo-crypto just for this would be overkill — the dep
 * pulls native modules that need a rebuild, and `crypto.randomUUID()` is
 * not exposed on Hermes' global by default.
 */
export function generateGroupId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * The shape this module needs from a survey row. Matches the cached and
 * pending tables once both have visit_group_id / visit_number columns
 * (v12 migration). Keeping the type minimal avoids importing the full
 * Survey interface where pending rows have fewer fields.
 */
export interface VisitSurveyLike {
  id: string;
  remote_id?: string | null;
  project_id: string;
  survey_type: string;
  status: string;
  site_id?: string | null;
  visit_group_id: string | null;
  visit_number: number | null;
}

/**
 * Highest visit_number in the group + 1. Reads cache + pending so the
 * count stays correct offline — without merging both, two unsynced Add
 * Visit attempts on the same group would both compute Visit N+1 and
 * collide on sync. Returns 1 when the group is empty (caller hasn't
 * converted standalone yet, or fresh group).
 */
export function getNextVisitNumber(
  surveys: ReadonlyArray<VisitSurveyLike>,
  groupId: string,
): number {
  let max = 0;
  for (const s of surveys) {
    if (s.visit_group_id !== groupId) continue;
    const n = s.visit_number ?? 0;
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * Merge cache and pending rows into a single dedup'd list per project.
 * Pending rows take precedence when the same survey exists in both
 * (cached row was the *last synced* state; pending has the unsaved edit
 * of visit_group_id / visit_number from a recent Add Visit call).
 */
export async function loadAllVisitSurveysForProject(
  projectId: string,
): Promise<VisitSurveyLike[]> {
  const [cached, pending] = await Promise.all([
    getCachedSurveys(projectId),
    getPendingSurveysForProject(projectId),
  ]);

  const out = new Map<string, VisitSurveyLike>();
  for (const c of cached) {
    out.set(c.id, {
      id: c.id,
      project_id: c.project_id,
      survey_type: c.survey_type,
      status: c.status,
      site_id: c.site_id,
      visit_group_id: c.visit_group_id,
      visit_number: c.visit_number,
    });
  }
  // Pending wins on conflict — `remote_id` matches the cached id when the
  // pending row is an edit of an already-synced survey (e.g. standalone
  // → group conversion of a survey that's been on the server for weeks).
  for (const p of pending) {
    const key = p.remote_id ?? p.id;
    out.set(key, {
      id: p.remote_id ?? p.id,
      remote_id: p.remote_id,
      project_id: p.project_id,
      survey_type: p.survey_type,
      status: p.status,
      site_id: p.site_id,
      visit_group_id: p.visit_group_id,
      visit_number: p.visit_number,
    });
  }
  return Array.from(out.values());
}

/**
 * All surveys in the same group as `groupId`, sorted by visit_number.
 * Used by the survey-detail accordion to render "Previous visits".
 * Excludes the current survey id so the accordion doesn't list itself.
 */
export function siblingsInGroup(
  surveys: ReadonlyArray<VisitSurveyLike>,
  groupId: string,
  currentSurveyId: string,
): VisitSurveyLike[] {
  return surveys
    .filter((s) => s.visit_group_id === groupId && s.id !== currentSurveyId)
    .sort((a, b) => (a.visit_number ?? 0) - (b.visit_number ?? 0));
}

/**
 * Add Visit gating: hide the button when every visit in the group is
 * already 'completed'. Standalone surveys (no group yet) always pass —
 * tapping triggers the standalone → group conversion. The current survey
 * is included so a single in-progress visit keeps the button visible.
 */
export function canAddVisit(
  surveys: ReadonlyArray<VisitSurveyLike>,
  groupId: string | null,
): boolean {
  if (!groupId) return true; // standalone — first Add Visit converts to group
  const groupVisits = surveys.filter((s) => s.visit_group_id === groupId);
  if (groupVisits.length === 0) return true;
  return !groupVisits.every((s) => s.status === "completed");
}

/**
 * Helper for the survey-form-screen accordion title.
 */
export function visitLabel(visitNumber: number | null | undefined): string {
  return visitNumber == null ? "Standalone" : `Visit ${visitNumber}`;
}

// Re-export Survey for callers that already type their state with the
// upstream interface — keeps imports compact.
export type { Survey };
