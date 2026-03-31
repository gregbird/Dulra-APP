# Dulra App — Mevcut Sistem Dokumantasyonu

> Bu dosya, Supabase veritabani degisiklikleri oncesi mevcut sistemin nasil calistigini dokumante eder.
> Tarih: 2026-03-31

---

## 1. Supabase Tablolari ve Kolonlari

### profiles
| Kolon | Tip |
|-------|-----|
| id | UUID (PK, auth.users FK) |
| email | TEXT |
| full_name | TEXT |
| role | TEXT ("admin", "project_manager", "ecologist", "junior", "third_party", "client") |
| organization_id | TEXT |

### projects
| Kolon | Tip |
|-------|-----|
| id | UUID (PK) |
| name | TEXT |
| site_code | TEXT |
| status | TEXT ("active", "completed") |
| health_status | TEXT ("on_track", "at_risk", "overdue", null) |
| county | TEXT |
| updated_at | TIMESTAMPTZ |
| created_by | UUID (auth.users FK) |

### project_members
| Kolon | Tip |
|-------|-----|
| project_id | UUID (FK → projects) |
| user_id | UUID (FK → auth.users) |
| role | TEXT |
| assigned_at | TIMESTAMPTZ |

### surveys
| Kolon | Tip |
|-------|-----|
| id | UUID (PK) |
| project_id | UUID (FK → projects) |
| survey_type | TEXT |
| surveyor_id | UUID (FK → auth.users) |
| survey_date | DATE |
| start_time | TEXT |
| end_time | TEXT |
| status | TEXT ("planned", "in_progress", "completed", "approved") |
| sync_status | TEXT ("pending", "synced", "failed") |
| notes | TEXT |
| weather | JSONB ({ templateFields: { [key]: value } }) |
| form_data | JSONB ({ [sectionId]: { [fieldKey]: value } }) |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |
| local_id | TEXT (nullable, offline kayitlar icin) |

### survey_templates
| Kolon | Tip |
|-------|-----|
| id | UUID (PK) |
| name | TEXT |
| survey_type | TEXT |
| is_active | BOOLEAN |
| default_fields | JSONB (sections, methodologyGuidance, requiredEquipment) |

### habitat_polygons
| Kolon | Tip |
|-------|-----|
| id | UUID (PK) |
| project_id | UUID (FK → projects) |
| fossitt_code | TEXT |
| fossitt_name | TEXT |
| area_hectares | NUMERIC |
| condition | TEXT ("good", "moderate", "poor", "degraded") |
| notes | TEXT |
| eu_annex_code | TEXT |
| survey_method | TEXT |
| evaluation | TEXT |
| listed_species | JSONB (string array) |
| threats | JSONB (string array) |
| photos | JSONB (string array) |

### target_notes
| Kolon | Tip |
|-------|-----|
| id | UUID (PK) |
| project_id | UUID (FK → projects) |
| category | TEXT ("fauna", "flora", "habitat", "check_feature", "access_point") |
| title | TEXT |
| description | TEXT |
| priority | TEXT ("high", "normal") |
| is_verified | BOOLEAN |
| photos | JSONB (string array) |
| location | GEOMETRY (PostGIS POINT, {type:"Point", coordinates:[lng,lat]}) |

### photos
| Kolon | Tip |
|-------|-----|
| id | UUID (PK) |
| project_id | UUID (FK → projects) |
| survey_id | UUID (FK → surveys, nullable) |
| habitat_polygon_id | UUID (FK → habitat_polygons, nullable) |
| target_note_id | UUID (FK → target_notes, nullable) |
| storage_path | TEXT |
| watermarked_path | TEXT |
| location | GEOMETRY (PostGIS POINT) |
| taken_at | TIMESTAMPTZ |
| caption | TEXT |
| created_by | UUID (FK → auth.users) |

---

## 2. Lokal SQLite Tablolari

Veritabani: `dulra.db`, Version: 3

### pending_surveys (Offline yazma → Supabase'e sync)
```
id TEXT PK                -- local_[timestamp]_[random]
remote_id TEXT            -- Supabase ID (sync sonrasi dolar)
project_id TEXT NOT NULL
survey_type TEXT NOT NULL
surveyor_id TEXT NOT NULL
survey_date TEXT NOT NULL
status TEXT DEFAULT 'in_progress'
weather TEXT              -- JSON string
form_data TEXT            -- JSON string
sync_status TEXT DEFAULT 'pending'
created_at TEXT
updated_at TEXT
```

### pending_photos (Offline yazma → Supabase'e sync)
```
id TEXT PK
local_uri TEXT NOT NULL
project_id TEXT NOT NULL
project_name TEXT
survey_id TEXT            -- remote survey ID
survey_local_id TEXT      -- local survey ID
sync_status TEXT DEFAULT 'pending'
created_at TEXT
```

### cached_projects (Read-only cache ← Supabase)
```
id TEXT PK, name TEXT, site_code TEXT, status TEXT,
health_status TEXT, county TEXT, updated_at TEXT, cached_at TEXT
```

### cached_surveys (Read-only cache ← Supabase)
```
id TEXT PK, project_id TEXT, survey_type TEXT, survey_date TEXT,
status TEXT, weather TEXT, form_data TEXT, notes TEXT, cached_at TEXT
```

### cached_habitats (Read-only cache ← Supabase)
```
id TEXT PK, project_id TEXT, fossitt_code TEXT, fossitt_name TEXT,
area_hectares REAL, condition TEXT, notes TEXT, eu_annex_code TEXT,
survey_method TEXT, evaluation TEXT, listed_species TEXT, threats TEXT,
photos TEXT, cached_at TEXT
```

### cached_target_notes (Read-only cache ← Supabase)
```
id TEXT PK, project_id TEXT, category TEXT, title TEXT,
description TEXT, priority TEXT, is_verified INTEGER,
location_text TEXT, photos TEXT, cached_at TEXT
```

### cached_templates (Read-only cache ← Supabase)
```
survey_type TEXT PK, name TEXT, default_fields TEXT, cached_at TEXT
```

---

## 3. Veri Akisi (Data Flow)

### Uygulama Acilisi
```
_layout.tsx
  → auth.getSession()
  → auth.onAuthStateChange()
  → cacheAllData()
      → Supabase'den paralel cek:
         - survey_templates (aktif olanlar)
         - projects (role-based filtreleme)
         - surveys (proje bazli)
         - habitat_polygons (proje bazli)
         - target_notes (proje bazli)
      → clearCachedData()
      → Her kaydi SQLite cache'e yaz
```

### Ekran Veri Yukleme Patterni
```
Her ekran:
  1. Online mi? → Supabase'den cek + cache'e yaz + goster
  2. Hata/offline? → SQLite cache'den oku + goster
```

### Survey Olusturma
```
Online:
  saveSurvey() → supabase.from("surveys").insert() → photos upload → done

Offline:
  saveSurvey() → hata → saveOffline()
    → saveSurveyLocally() (pending_surveys)
    → savePhotoLocally() (pending_photos)
    → return { offline: true }
```

### Sync (Offline → Online)
```
syncPendingData() [network online olunca tetiklenir]
  → syncSurveys()
      → pending_surveys tablosundan pending kayitlari al
      → remote_id varsa UPDATE, yoksa INSERT (Supabase)
      → SQLite'da synced olarak isaretle
      → pending_photos'daki survey_local_id → remote_id guncelle
  → syncPhotos()
      → pending_photos'dan pending kayitlari al
      → uploadPhoto() → storage + photos tablosu
      → SQLite'da synced isaretle
```

---

## 4. Supabase Sorgu Yapan Dosyalar

### Veri Okuma (SELECT)

| Dosya | Tablo | Sorgu |
|-------|-------|-------|
| `src/app/_layout.tsx` | projects, surveys, habitat_polygons, target_notes, survey_templates | Toplu cache icin tum veriyi ceker |
| `src/screens/projects-screen.tsx` | profiles, project_members, projects | Role-based proje listesi |
| `src/screens/project-detail-screen.tsx` | projects, surveys(count), habitat_polygons(count), target_notes(count) | Proje detay + sayimlar |
| `src/screens/surveys-list-screen.tsx` | surveys | Proje bazli survey listesi |
| `src/screens/survey-form-screen.tsx` | survey_templates, surveys | Template + mevcut survey verisi |
| `src/screens/habitats-screen.tsx` | habitat_polygons | Proje bazli habitat listesi |
| `src/screens/habitat-detail-screen.tsx` | habitat_polygons | Tekil habitat detayi |
| `src/screens/target-notes-screen.tsx` | target_notes | Proje bazli target note listesi |
| `src/screens/target-note-detail-screen.tsx` | target_notes | Tekil target note detayi |
| `src/screens/settings-screen.tsx` | profiles | Kullanici profili |
| `src/components/survey-photos.tsx` | photos | Survey fotograf listesi |
| `src/components/survey-type-picker.tsx` | survey_templates | Template listesi |

### Veri Yazma (INSERT/UPDATE/DELETE)

| Dosya | Tablo | Islem |
|-------|-------|-------|
| `src/lib/survey-save.ts` | surveys | INSERT (yeni) / UPDATE (mevcut) |
| `src/lib/sync-service.ts` | surveys | INSERT/UPDATE (sync sirasinda) |
| `src/lib/photo-service.ts` | photos, project-photos (storage) | INSERT + storage upload |
| `src/components/survey-photos.tsx` | photos, project-photos (storage) | DELETE (foto silme) |

---

## 5. Detayli Sorgu Kaliplari

### Projects Screen — Proje Listesi
```typescript
// 1. Kullanici rolunu al
supabase.from("profiles").select("role").eq("id", user.id).single()

// 2. Admin/PM degilse erisim kontrolu
supabase.from("project_members").select("project_id").eq("user_id", user.id)
supabase.from("projects").select("id").eq("created_by", user.id)

// 3. Proje verisi
supabase.from("projects")
  .select("id, name, site_code, status, health_status, county, updated_at")
  .in("id", projectIds)
  .order("updated_at", { ascending: false })
```

### Project Detail — Sayimlar
```typescript
supabase.from("surveys").select("id", { count: "exact", head: true }).eq("project_id", id)
supabase.from("habitat_polygons").select("id", { count: "exact", head: true }).eq("project_id", id)
supabase.from("target_notes").select("id", { count: "exact", head: true }).eq("project_id", id)
```

### Survey Create
```typescript
supabase.from("surveys").insert({
  project_id, survey_type, surveyor_id, survey_date,
  status, sync_status: "synced",
  weather: { templateFields: allFields },
  form_data: formData,
}).select("id").single()
```

### Survey Update
```typescript
supabase.from("surveys").update({
  weather: { templateFields: allFields },
  form_data: formData,
  status,
  updated_at: new Date().toISOString(),
}).eq("id", currentId)
```

### Survey List
```typescript
supabase.from("surveys")
  .select("id, project_id, survey_type, surveyor_id, survey_date, start_time, end_time, status, sync_status, notes, weather, form_data, created_at, updated_at")
  .eq("project_id", id)
  .order("survey_date", { ascending: false })
```

### Habitat List
```typescript
supabase.from("habitat_polygons")
  .select("id, project_id, fossitt_code, fossitt_name, area_hectares, condition, notes, eu_annex_code, survey_method, evaluation")
  .eq("project_id", id)
  .order("fossitt_code")
```

### Habitat Detail
```typescript
supabase.from("habitat_polygons")
  .select("id, project_id, fossitt_code, fossitt_name, area_hectares, condition, notes, eu_annex_code, survey_method, evaluation, listed_species, threats, photos")
  .eq("id", habitatId)
  .single()
```

### Target Notes List
```typescript
supabase.from("target_notes")
  .select("id, project_id, category, title, description, priority, is_verified")
  .eq("project_id", id)
  .order("priority")
```

### Target Note Detail
```typescript
supabase.from("target_notes")
  .select("id, category, title, description, priority, is_verified, photos, location")
  .eq("id", noteId)
  .single()
```

### Photo Insert
```typescript
supabase.from("photos").insert({
  project_id, survey_id, habitat_polygon_id, target_note_id,
  storage_path, watermarked_path,
  location: "SRID=4326;POINT(lng lat)",
  taken_at, caption, created_by
}).select("id").single()
```

### Photo List (by survey)
```typescript
supabase.from("photos")
  .select("id, storage_path, watermarked_path")
  .eq("survey_id", surveyId)
```

### Photo Delete
```typescript
supabase.storage.from("project-photos").remove([photo.storage_path])
supabase.from("photos").delete().eq("id", photo.id)
```

### Bulk Cache (App Startup)
```typescript
// _layout.tsx → cacheAllData()
supabase.from("survey_templates").select("name, survey_type, default_fields").eq("is_active", true)
supabase.from("projects").select("id, name, site_code, status, health_status, county, updated_at")
supabase.from("surveys").select("id, project_id, survey_type, survey_date, status, weather, form_data, notes")
supabase.from("habitat_polygons").select("id, project_id, fossitt_code, fossitt_name, area_hectares, condition, notes, eu_annex_code, survey_method, evaluation, listed_species, threats, photos")
supabase.from("target_notes").select("id, project_id, category, title, description, priority, is_verified, photos, location")
```

---

## 6. Onemli Tasarim Kararlari

- **Offline-First**: Tum veri once SQLite'a, sonra Supabase'e
- **Role-Based Access**: Admin/PM tum projeleri gorur, digerleri sadece atandiklari + olusturduklar
- **Cache Fallback**: Her ekran Supabase'den okuyamazsa SQLite cache'den okur
- **Local ID → Remote ID**: Offline survey'ler `local_[ts]_[random]` ID alir, sync sonrasi Supabase UUID gelir
- **Weather JSONB**: `{ templateFields: { [fieldKey]: value } }` formatinda
- **Form Data JSONB**: `{ [sectionId]: { [fieldKey]: value } }` formatinda
- **PostGIS Location**: `{type: "Point", coordinates: [lng, lat]}` / `"SRID=4326;POINT(lng lat)"`
- **Storage Path**: `{projectId}/{context}/{subPath}/{timestamp}-photo.jpg`
