import * as SQLite from "expo-sqlite";

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  // Cache the in-flight init so concurrent callers (e.g. _layout reading
  // app_state while another effect kicks off cacheAllData) all await the
  // same migration pass — otherwise the second caller could grab the
  // half-initialised handle before CREATE TABLE has finished and hit
  // "no such table" errors.
  if (!initPromise) {
    initPromise = (async () => {
      const opened = await SQLite.openDatabaseAsync("dulra.db");
      await initTables(opened);
      db = opened;
      return opened;
    })();
  }
  return initPromise;
}

async function tryAddColumn(database: SQLite.SQLiteDatabase, table: string, column: string, definition: string): Promise<void> {
  try {
    await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  } catch {
    // Column already exists or table missing — non-fatal; CREATE TABLE IF NOT EXISTS covers missing tables
  }
}

async function initTables(database: SQLite.SQLiteDatabase) {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS db_version (version INTEGER);
  `);
  const ver = await database.getFirstAsync<{ version: number }>(`SELECT version FROM db_version LIMIT 1`);
  const currentVer = ver?.version ?? 0;

  // ==== Version-gated data transformations ====
  // Only things that can't be idempotent live here: enum migrations and
  // DROPs of stale cache tables whose schemas changed. Column ADDs happen
  // in the safety pass below instead — otherwise a silent ALTER failure
  // would be papered over by a version bump and the missing column would
  // bite us at query time.
  if (currentVer < 5) {
    try {
      await database.execAsync(`
        UPDATE pending_surveys SET status = 'in_progress' WHERE status = 'planned';
        UPDATE pending_surveys SET status = 'completed' WHERE status = 'approved';
      `);
    } catch { /* pending_surveys may not exist on first run — CREATE below handles it */ }

    // Old cached_* schemas diverge from the current ones. Safe to drop:
    // next online session refills from Supabase. pending_* is preserved.
    await database.execAsync(`
      DROP TABLE IF EXISTS cached_templates;
      DROP TABLE IF EXISTS cached_surveys;
      DROP TABLE IF EXISTS cached_projects;
      DROP TABLE IF EXISTS cached_habitats;
      DROP TABLE IF EXISTS cached_target_notes;
    `);
  }

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS pending_surveys (
      id TEXT PRIMARY KEY,
      remote_id TEXT,
      project_id TEXT NOT NULL,
      survey_type TEXT NOT NULL,
      surveyor_id TEXT NOT NULL,
      survey_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      weather TEXT,
      form_data TEXT,
      site_id TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_photos (
      id TEXT PRIMARY KEY,
      local_uri TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_name TEXT,
      survey_id TEXT,
      survey_local_id TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_templates (
      survey_type TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      default_fields TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      site_code TEXT,
      status TEXT,
      health_status TEXT,
      county TEXT,
      updated_at TEXT,
      boundary_geojson TEXT,
      sites_geojson TEXT,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_surveys (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      survey_type TEXT NOT NULL,
      survey_date TEXT NOT NULL,
      status TEXT NOT NULL,
      weather TEXT,
      form_data TEXT,
      notes TEXT,
      site_id TEXT,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_habitats (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      fossitt_code TEXT,
      fossitt_name TEXT,
      area_hectares REAL,
      condition TEXT,
      notes TEXT,
      eu_annex_code TEXT,
      survey_method TEXT,
      evaluation TEXT,
      listed_species TEXT,
      threats TEXT,
      photos TEXT,
      site_id TEXT,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_target_notes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      category TEXT,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      is_verified INTEGER DEFAULT 0,
      location_text TEXT,
      photos TEXT,
      site_id TEXT,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_project_sites (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      site_code TEXT NOT NULL,
      site_name TEXT,
      sort_order INTEGER,
      county TEXT,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_profiles (
      id TEXT PRIMARY KEY,
      full_name TEXT,
      role TEXT,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // ==== Column safety pass — idempotent, runs every startup ====
  // CREATE TABLE IF NOT EXISTS above leaves existing tables untouched, so
  // columns added in later releases must be grafted on separately. Running
  // this every launch makes the schema self-healing: if an earlier migration
  // dropped mid-way, or an older build created a table without a column we
  // now rely on, we fix it here instead of limping on a stale version row.
  //
  // All ADD COLUMNs must be nullable (or have a simple literal DEFAULT) —
  // SQLite refuses ALTER TABLE ADD COLUMN NOT NULL unless the default is a
  // non-null constant, and historic edge cases make NOT NULL risky on
  // tables that already hold rows. The stricter constraint lives only in
  // the CREATE TABLE definitions for fresh installs.
  await tryAddColumn(database, "pending_surveys", "remote_id", "TEXT");
  await tryAddColumn(database, "pending_surveys", "site_id", "TEXT");
  await tryAddColumn(database, "pending_surveys", "retry_count", "INTEGER DEFAULT 0");
  await tryAddColumn(database, "pending_surveys", "last_error", "TEXT");
  await tryAddColumn(database, "cached_surveys", "site_id", "TEXT");
  await tryAddColumn(database, "cached_habitats", "site_id", "TEXT");
  await tryAddColumn(database, "cached_target_notes", "site_id", "TEXT");
  await tryAddColumn(database, "pending_photos", "retry_count", "INTEGER DEFAULT 0");
  await tryAddColumn(database, "pending_photos", "last_error", "TEXT");
  await tryAddColumn(database, "pending_photos", "site_id", "TEXT");
  // tags is JSON-encoded string[] (e.g. '["site"]'). NULL means no tags.
  await tryAddColumn(database, "pending_photos", "tags", "TEXT");
  await tryAddColumn(database, "pending_photos", "caption", "TEXT");
  // v9: project boundary cache. Both columns hold JSON-encoded GeoJSON
  // (Polygon Feature for boundary_geojson, array of site rows with embedded
  // Polygon geometries for sites_geojson). NULL when never fetched.
  await tryAddColumn(database, "cached_projects", "boundary_geojson", "TEXT");
  await tryAddColumn(database, "cached_projects", "sites_geojson", "TEXT");
  try {
    await database.runAsync(`UPDATE pending_surveys SET retry_count = 0 WHERE retry_count IS NULL`);
  } catch { /* column not yet added on very old schema */ }
  // Existing rows created before retry_count existed end up as NULL with a
  // bare ADD COLUMN ... DEFAULT 0; backfill them so `retry_count < ?` in
  // getPendingPhotos doesn't silently skip legitimate retries.
  try {
    await database.runAsync(`UPDATE pending_photos SET retry_count = 0 WHERE retry_count IS NULL`);
  } catch { /* column may not exist on a very old schema — tryAddColumn above handles that */ }

  if (currentVer < 9) {
    await database.runAsync(`DELETE FROM db_version`);
    await database.runAsync(`INSERT INTO db_version (version) VALUES (9)`);
  }
}

export async function getAppState(key: string): Promise<string | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ value: string | null }>(
    `SELECT value FROM app_state WHERE key = ?`,
    key
  );
  return row?.value ?? null;
}

export async function setAppState(key: string, value: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)`,
    key,
    value
  );
}

function generateId(): string {
  return "local_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

export async function saveSurveyLocally(params: {
  remoteId?: string;
  projectId: string;
  surveyType: string;
  surveyorId: string;
  surveyDate: string;
  status: string;
  weather: Record<string, unknown>;
  formData: Record<string, unknown>;
  siteId?: string | null;
}): Promise<string> {
  const database = await getDatabase();
  const now = new Date().toISOString();

  // Update existing pending entry for same remote survey instead of creating duplicate
  if (params.remoteId) {
    const existing = await database.getFirstAsync<{ id: string }>(
      `SELECT id FROM pending_surveys WHERE remote_id = ? AND sync_status = 'pending'`,
      params.remoteId
    );
    if (existing) {
      await database.runAsync(
        `UPDATE pending_surveys SET status = ?, weather = ?, form_data = ?, site_id = ?, updated_at = ? WHERE id = ?`,
        params.status, JSON.stringify(params.weather), JSON.stringify(params.formData), params.siteId ?? null, now, existing.id
      );
      return existing.id;
    }
  }

  const id = generateId();

  await database.runAsync(
    `INSERT INTO pending_surveys (id, remote_id, project_id, survey_type, surveyor_id, survey_date, status, weather, form_data, site_id, sync_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    id, params.remoteId ?? null, params.projectId, params.surveyType, params.surveyorId,
    params.surveyDate, params.status,
    JSON.stringify(params.weather), JSON.stringify(params.formData),
    params.siteId ?? null, now, now
  );

  return id;
}

export async function updateSurveyLocally(params: {
  id: string;
  status: string;
  weather: Record<string, unknown>;
  formData: Record<string, unknown>;
}): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE pending_surveys SET status = ?, weather = ?, form_data = ?, updated_at = ? WHERE id = ?`,
    params.status, JSON.stringify(params.weather),
    JSON.stringify(params.formData), new Date().toISOString(), params.id
  );
}

export async function getPendingSurveyByRemoteId(remoteId: string): Promise<{
  id: string;
  remote_id: string | null;
  project_id: string;
  survey_type: string;
  form_data: string | null;
} | null> {
  const database = await getDatabase();
  return database.getFirstAsync(
    `SELECT id, remote_id, project_id, survey_type, form_data FROM pending_surveys WHERE remote_id = ? AND sync_status = 'pending' ORDER BY updated_at DESC LIMIT 1`,
    remoteId
  );
}

export async function getPendingSurveys(): Promise<Array<{
  id: string;
  remote_id: string | null;
  project_id: string;
  survey_type: string;
  surveyor_id: string;
  survey_date: string;
  status: string;
  weather: string;
  form_data: string;
  sync_status: string;
  site_id: string | null;
}>> {
  const database = await getDatabase();
  return database.getAllAsync(
    `SELECT * FROM pending_surveys WHERE sync_status = 'pending'`
  );
}

export async function markSurveySynced(localId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE pending_surveys SET sync_status = 'synced' WHERE id = ?`, localId
  );
}

export async function markSurveyConflict(localId: string, errorMessage: string): Promise<void> {
  const database = await getDatabase();
  const msg = errorMessage.slice(0, 500);
  await database.runAsync(
    `UPDATE pending_surveys SET sync_status = 'conflict', last_error = ? WHERE id = ?`,
    msg, localId
  );
  // Cascade: photos attached to a conflicted survey will never get a remote
  // survey_id — mark them as conflict too so getPendingCount stops inflating.
  await database.runAsync(
    `UPDATE pending_photos SET sync_status = 'conflict', last_error = ? WHERE survey_local_id = ? AND sync_status = 'pending'`,
    `parent survey conflict: ${msg}`, localId
  );
}

export async function recordSurveyRetryFailure(localId: string, errorMessage: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE pending_surveys SET retry_count = COALESCE(retry_count, 0) + 1, last_error = ? WHERE id = ?`,
    errorMessage.slice(0, 500), localId
  );
}

export interface PendingInspectRow {
  id: string;
  remote_id: string | null;
  project_id: string;
  survey_type: string;
  sync_status: string;
  retry_count: number | null;
  last_error: string | null;
  created_at: string;
}

export async function getAllPendingSurveys(): Promise<PendingInspectRow[]> {
  const database = await getDatabase();
  return database.getAllAsync(
    `SELECT id, remote_id, project_id, survey_type, sync_status, retry_count, last_error, created_at
     FROM pending_surveys WHERE sync_status != 'synced' ORDER BY created_at DESC`
  );
}

export interface PendingPhotoInspectRow {
  id: string;
  survey_id: string | null;
  survey_local_id: string | null;
  sync_status: string;
  retry_count: number | null;
  last_error: string | null;
  created_at: string;
}

export async function getAllPendingPhotos(): Promise<PendingPhotoInspectRow[]> {
  const database = await getDatabase();
  return database.getAllAsync(
    `SELECT id, survey_id, survey_local_id, sync_status, retry_count, last_error, created_at
     FROM pending_photos WHERE sync_status != 'synced' ORDER BY created_at DESC`
  );
}

export async function dropConflictedSurveys(): Promise<number> {
  const database = await getDatabase();
  const before = await database.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pending_surveys WHERE sync_status = 'conflict'`
  );
  await database.runAsync(`DELETE FROM pending_surveys WHERE sync_status = 'conflict'`);
  return before?.n ?? 0;
}

export async function dropConflictedPhotos(): Promise<number> {
  const database = await getDatabase();
  const before = await database.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pending_photos WHERE sync_status = 'conflict' OR retry_count >= ${PHOTO_MAX_RETRIES}`
  );
  await database.runAsync(
    `DELETE FROM pending_photos WHERE sync_status = 'conflict' OR retry_count >= ?`,
    PHOTO_MAX_RETRIES
  );
  return before?.n ?? 0;
}

export async function savePhotoLocally(params: {
  localUri: string;
  projectId: string;
  projectName?: string;
  surveyId?: string;
  surveyLocalId?: string;
  siteId?: string | null;
  tags?: string[] | null;
  caption?: string | null;
}): Promise<string> {
  const database = await getDatabase();
  const id = generateId();
  const tagsJson = params.tags && params.tags.length > 0 ? JSON.stringify(params.tags) : null;
  await database.runAsync(
    `INSERT INTO pending_photos (id, local_uri, project_id, project_name, survey_id, survey_local_id, site_id, tags, caption, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    id, params.localUri, params.projectId, params.projectName ?? null,
    params.surveyId ?? null, params.surveyLocalId ?? null,
    params.siteId ?? null, tagsJson, params.caption ?? null,
    new Date().toISOString()
  );
  return id;
}

const PHOTO_MAX_RETRIES = 5;

export async function getPendingPhotos(): Promise<Array<{
  id: string;
  local_uri: string;
  project_id: string;
  project_name: string | null;
  survey_id: string | null;
  survey_local_id: string | null;
  site_id: string | null;
  tags: string | null;
  caption: string | null;
  retry_count: number;
}>> {
  const database = await getDatabase();
  return database.getAllAsync(
    `SELECT id, local_uri, project_id, project_name, survey_id, survey_local_id, site_id, tags, caption, retry_count
     FROM pending_photos WHERE sync_status = 'pending' AND retry_count < ?`,
    PHOTO_MAX_RETRIES
  );
}

export async function markPhotoSynced(localId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE pending_photos SET sync_status = 'synced' WHERE id = ?`, localId
  );
}

export async function recordPhotoRetryFailure(localId: string, errorMessage: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE pending_photos SET retry_count = retry_count + 1, last_error = ? WHERE id = ?`,
    errorMessage.slice(0, 500), localId
  );
}

export async function markPhotoConflict(localId: string, errorMessage: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE pending_photos SET sync_status = 'conflict', last_error = ? WHERE id = ?`,
    errorMessage.slice(0, 500), localId
  );
}

/**
 * Move photos that can never sync into 'conflict' state so they stop
 * inflating getPendingCount. Called at the top of each sync pass.
 * Criteria:
 *   - retry_count >= PHOTO_MAX_RETRIES (transient upload failures exhausted)
 *   - survey_id IS NULL AND the linked local survey is itself 'synced' or
 *     'conflict' — i.e. the parent will never produce a remote id, so the
 *     photo is orphaned forever.
 */
export async function sweepStuckPhotos(): Promise<number> {
  const database = await getDatabase();
  const result1 = await database.runAsync(
    `UPDATE pending_photos
       SET sync_status = 'conflict',
           last_error = COALESCE(last_error, 'retry limit reached')
     WHERE sync_status = 'pending' AND retry_count >= ?`,
    PHOTO_MAX_RETRIES
  );
  const result2 = await database.runAsync(
    `UPDATE pending_photos
       SET sync_status = 'conflict',
           last_error = COALESCE(last_error, 'parent survey no longer syncable')
     WHERE sync_status = 'pending'
       AND survey_id IS NULL
       AND survey_local_id IS NOT NULL
       AND survey_local_id NOT IN (
         SELECT id FROM pending_surveys WHERE sync_status = 'pending'
       )`
  );
  return (result1.changes ?? 0) + (result2.changes ?? 0);
}

export async function cacheTemplate(params: {
  surveyType: string;
  name: string;
  defaultFields: Record<string, unknown>;
}): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO cached_templates (survey_type, name, default_fields, cached_at)
     VALUES (?, ?, ?, ?)`,
    params.surveyType, params.name,
    JSON.stringify(params.defaultFields), new Date().toISOString()
  );
}

export async function getCachedTemplates(): Promise<Array<{
  survey_type: string;
  name: string;
  default_fields: string;
}>> {
  const database = await getDatabase();
  return database.getAllAsync(`SELECT * FROM cached_templates`);
}

export async function getCachedTemplate(surveyType: string): Promise<{
  survey_type: string;
  name: string;
  default_fields: string;
} | null> {
  const database = await getDatabase();
  return database.getFirstAsync(
    `SELECT * FROM cached_templates WHERE survey_type = ?`, surveyType
  );
}

export async function cacheSurvey(params: {
  id: string;
  projectId: string;
  surveyType: string;
  surveyDate: string;
  status: string;
  weather: Record<string, unknown> | null;
  formData: Record<string, unknown> | null;
  notes: string | null;
  siteId?: string | null;
}): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO cached_surveys (id, project_id, survey_type, survey_date, status, weather, form_data, notes, site_id, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params.id, params.projectId, params.surveyType, params.surveyDate,
    params.status, JSON.stringify(params.weather),
    JSON.stringify(params.formData), params.notes, params.siteId ?? null, new Date().toISOString()
  );
}

export async function getCachedSurveys(projectId: string): Promise<Array<{
  id: string; project_id: string; survey_type: string; survey_date: string;
  status: string; notes: string | null; site_id: string | null;
}>> {
  const database = await getDatabase();
  return database.getAllAsync(
    `SELECT id, project_id, survey_type, survey_date, status, notes, site_id FROM cached_surveys WHERE project_id = ? ORDER BY survey_date DESC`,
    projectId
  );
}

export async function getCachedSurvey(surveyId: string): Promise<{
  id: string; project_id: string; survey_type: string; survey_date: string;
  status: string; weather: string | null; form_data: string | null;
} | null> {
  const database = await getDatabase();
  return database.getFirstAsync(
    `SELECT * FROM cached_surveys WHERE id = ?`, surveyId
  );
}

export async function cacheProject(params: {
  id: string; name: string; siteCode: string | null; status: string | null;
  healthStatus: string | null; county: string | null; updatedAt: string | null;
}): Promise<void> {
  const database = await getDatabase();
  // Preserve any boundary cache that was written separately by setCachedProjectBoundary —
  // a metadata-only refresh shouldn't wipe the GeoJSON we already pulled.
  const existing = await database.getFirstAsync<{
    boundary_geojson: string | null;
    sites_geojson: string | null;
  }>(
    `SELECT boundary_geojson, sites_geojson FROM cached_projects WHERE id = ?`,
    params.id,
  );
  await database.runAsync(
    `INSERT OR REPLACE INTO cached_projects (id, name, site_code, status, health_status, county, updated_at, boundary_geojson, sites_geojson, cached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params.id, params.name, params.siteCode, params.status, params.healthStatus, params.county, params.updatedAt,
    existing?.boundary_geojson ?? null, existing?.sites_geojson ?? null,
    new Date().toISOString(),
  );
}

export async function getCachedProjects(): Promise<Array<{
  id: string; name: string; site_code: string | null; status: string | null;
  health_status: string | null; county: string | null; updated_at: string | null;
}>> {
  const database = await getDatabase();
  return database.getAllAsync(`SELECT id, name, site_code, status, health_status, county, updated_at FROM cached_projects ORDER BY updated_at DESC`);
}

export async function setCachedProjectBoundary(params: {
  projectId: string;
  boundaryGeojson: string | null;
  sitesGeojson: string | null;
}): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE cached_projects SET boundary_geojson = ?, sites_geojson = ? WHERE id = ?`,
    params.boundaryGeojson, params.sitesGeojson, params.projectId,
  );
}

export async function getCachedProjectBoundary(projectId: string): Promise<{
  boundary_geojson: string | null;
  sites_geojson: string | null;
} | null> {
  const database = await getDatabase();
  return database.getFirstAsync(
    `SELECT boundary_geojson, sites_geojson FROM cached_projects WHERE id = ?`,
    projectId,
  );
}

export async function cacheHabitat(params: {
  id: string; projectId: string; fossittCode: string | null; fossittName: string | null;
  areaHectares: number | null; condition: string | null; notes: string | null;
  euAnnexCode: string | null; surveyMethod: string | null; evaluation: string | null;
  listedSpecies: string[] | null; threats: string[] | null; photos: string[] | null;
  siteId?: string | null;
}): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO cached_habitats (id, project_id, fossitt_code, fossitt_name, area_hectares, condition, notes, eu_annex_code, survey_method, evaluation, listed_species, threats, photos, site_id, cached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params.id, params.projectId, params.fossittCode, params.fossittName, params.areaHectares, params.condition, params.notes, params.euAnnexCode, params.surveyMethod, params.evaluation, JSON.stringify(params.listedSpecies), JSON.stringify(params.threats), JSON.stringify(params.photos), params.siteId ?? null, new Date().toISOString()
  );
}

export async function getCachedHabitats(projectId: string): Promise<Array<{
  id: string; project_id: string; fossitt_code: string | null; fossitt_name: string | null;
  area_hectares: number | null; condition: string | null; notes: string | null;
  eu_annex_code: string | null; survey_method: string | null; evaluation: string | null;
  site_id: string | null;
}>> {
  const database = await getDatabase();
  return database.getAllAsync(`SELECT id, project_id, fossitt_code, fossitt_name, area_hectares, condition, notes, eu_annex_code, survey_method, evaluation, site_id FROM cached_habitats WHERE project_id = ? ORDER BY fossitt_code`, projectId);
}

export async function getCachedHabitat(habitatId: string): Promise<{
  id: string; project_id: string; fossitt_code: string | null; fossitt_name: string | null;
  area_hectares: number | null; condition: string | null; notes: string | null;
  eu_annex_code: string | null; survey_method: string | null; evaluation: string | null;
  listed_species: string | null; threats: string | null; photos: string | null;
} | null> {
  const database = await getDatabase();
  return database.getFirstAsync(`SELECT * FROM cached_habitats WHERE id = ?`, habitatId);
}

export async function cacheTargetNote(params: {
  id: string; projectId: string; category: string | null; title: string;
  description: string | null; priority: string | null; isVerified: boolean;
  locationText: string | null; photos: string[] | null;
  siteId?: string | null;
}): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO cached_target_notes (id, project_id, category, title, description, priority, is_verified, location_text, photos, site_id, cached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params.id, params.projectId, params.category, params.title, params.description, params.priority, params.isVerified ? 1 : 0, params.locationText, JSON.stringify(params.photos), params.siteId ?? null, new Date().toISOString()
  );
}

export async function getCachedTargetNotes(projectId: string): Promise<Array<{
  id: string; project_id: string; category: string | null; title: string;
  description: string | null; priority: string | null; is_verified: boolean;
  site_id: string | null;
}>> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ id: string; project_id: string; category: string | null; title: string; description: string | null; priority: string | null; is_verified: number; site_id: string | null }>(`SELECT id, project_id, category, title, description, priority, is_verified, site_id FROM cached_target_notes WHERE project_id = ? ORDER BY priority`, projectId);
  return rows.map((r) => ({ ...r, is_verified: r.is_verified === 1 }));
}

export async function getCachedTargetNote(noteId: string): Promise<{
  id: string; project_id: string; category: string | null; title: string; description: string | null;
  priority: string | null; is_verified: number; location_text: string | null; photos: string | null;
} | null> {
  const database = await getDatabase();
  return database.getFirstAsync(`SELECT * FROM cached_target_notes WHERE id = ?`, noteId);
}

export async function cacheProjectSite(params: {
  id: string; projectId: string; siteCode: string;
  siteName: string | null; sortOrder: number | null; county: string | null;
}): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO cached_project_sites (id, project_id, site_code, site_name, sort_order, county, cached_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params.id, params.projectId, params.siteCode, params.siteName, params.sortOrder, params.county, new Date().toISOString()
  );
}

export async function getCachedProjectSites(projectId: string): Promise<Array<{
  id: string; project_id: string; site_code: string;
  site_name: string | null; sort_order: number | null; county: string | null;
}>> {
  const database = await getDatabase();
  return database.getAllAsync(
    `SELECT id, project_id, site_code, site_name, sort_order, county FROM cached_project_sites WHERE project_id = ? ORDER BY sort_order`,
    projectId
  );
}

export async function cacheProfile(params: {
  id: string; fullName: string | null; role: string | null;
}): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO cached_profiles (id, full_name, role, cached_at) VALUES (?, ?, ?, ?)`,
    params.id, params.fullName, params.role, new Date().toISOString()
  );
}

export async function getCachedProfiles(): Promise<Array<{
  id: string; full_name: string | null; role: string | null;
}>> {
  const database = await getDatabase();
  return database.getAllAsync(
    `SELECT id, full_name, role FROM cached_profiles ORDER BY full_name`
  );
}

export async function clearCachedData(): Promise<void> {
  const database = await getDatabase();
  await database.execAsync(`DELETE FROM cached_projects; DELETE FROM cached_surveys; DELETE FROM cached_templates; DELETE FROM cached_habitats; DELETE FROM cached_target_notes; DELETE FROM cached_project_sites; DELETE FROM cached_profiles;`);
}

export async function clearPendingData(): Promise<void> {
  const database = await getDatabase();
  await database.execAsync(`DELETE FROM pending_surveys; DELETE FROM pending_photos;`);
}

export async function getPendingCount(): Promise<number> {
  const database = await getDatabase();
  const surveys = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM pending_surveys WHERE sync_status = 'pending'`
  );
  const photos = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM pending_photos WHERE sync_status = 'pending'`
  );
  return (surveys?.count ?? 0) + (photos?.count ?? 0);
}
