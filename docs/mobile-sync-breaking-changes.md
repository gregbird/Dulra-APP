# Mobile Sync — Breaking Changes (31 Mart 2026)

> Web (Dulra) tarafinda yapilan DB degisiklikleri. Ayni Supabase backend'i paylasildigi icin mobile tarafinda guncelleme gerekiyor.
>
> Supabase DB'den 31 Mart 2026'da cekilmis gercek sema ile mevcut mobile app kodu satir satir karsilastirilarak olusturuldu.

---

## KIRILMA HARITASI

```
KIRMIZI  = App patlar / hata verir / veri kaybi riski
TURUNCU  = Calisiyor ama yanlis/eksik veri gosterir
YESIL    = Calisiyor, sadece yeni ozellik eksik
```

| # | Alan | Seviye | Kisa Aciklama |
|---|------|--------|---------------|
| 1 | Survey status enum | KIRMIZI | "planned"/"approved" DB'den silindi, filtre patlar |
| 2 | Survey sync_status enum | TURUNCU | "failed" → "conflict" oldu |
| 3 | Project status enum | TURUNCU | "draft"/"archived" yeni, UI tanimiyor |
| 4 | Profile role enum | TURUNCU | "assessor" deprecated ama DB default, ecologist gibi davranmali |
| 5 | ProjectMember role enum | TURUNCU | Roller tamamen degisti (lead/surveyor/analyst/reviewer/viewer/member) |
| 6 | Habitat condition enum | TURUNCU | "degraded" → "bad", "excellent" eklendi |
| 7 | Target note priority | TURUNCU | "low" eklendi, UI sadece high/normal biliyor |
| 8 | Releve survey veri bolunmesi | TURUNCU | Web releve_surveys tablosuna yaziyor, mobile bilmiyor |
| 9 | RLS: target_notes erisim | TURUNCU | created_by fallback yok, sadece project_members |
| 10 | project_sites tablosu | YESIL | Yeni tablo, mobilde yok |
| 11 | surveys/habitats/target_notes site_id | YESIL | Yeni kolon, mobilde yok |
| 12 | photos yeni kolonlar | YESIL | observation_id, tags, notes eklendi |
| 13 | survey_templates yeni kolonlar | YESIL | organization_id, description, created_by eklendi |
| 14 | Yeni tablolar | YESIL | releve_surveys, releve_species, species_observations, survey_assignments |

---

## 1. KIRMIZI — Survey Status Enum

```
ONCE:    planned | in_progress | completed | approved
SIMDI:   in_progress | completed
```

`planned` → `in_progress`, `approved` → `completed` olarak migrate edildi.

| Dosya | Satir | Sorun | Cozum |
|-------|-------|-------|-------|
| `src/types/survey.ts` | 9 | `"planned" \| "approved"` DB'de yok | Sadece `"in_progress" \| "completed"` |
| `src/types/survey.ts` | 33,35 | surveyStatusLabels'da planned/approved var | Kaldir |
| `src/screens/surveys-list-screen.tsx` | 22-26 | statusColors'da planned/approved renk tanimli | Kaldir |
| `src/screens/surveys-list-screen.tsx` | 80 | `s.status === "planned" \|\| s.status === "in_progress"` | Sadece `"in_progress"` |
| `src/screens/surveys-list-screen.tsx` | 81 | `s.status === "completed" \|\| s.status === "approved"` | Sadece `"completed"` |
| `src/lib/sync-service.ts` | 78 | SQLite'da eski status varsa sync'te enum violation | Sync oncesi pending kayitlari migrate et |

`src/lib/survey-save.ts` satir 48: Zaten sadece `"completed"` / `"in_progress"` gonderiyor — **SORUN YOK**.

---

## 2. TURUNCU — Survey sync_status Enum

```
ONCE:    pending | synced | failed
SIMDI:   pending | synced | conflict
```

| Dosya | Satir | Sorun | Cozum |
|-------|-------|-------|-------|
| `src/types/survey.ts` | 10 | `"failed"` DB'de yok | `"conflict"` ile degistir |

App "failed" gondermez (sadece "pending"/"synced" kullanir), ama DB'den "conflict" gelirse tip uyusmazligi olur.

---

## 3. TURUNCU — Project Status Enum

```
ONCE:    active | completed
SIMDI:   draft | active | completed | archived   (default: 'draft')
```

| Dosya | Satir | Sorun | Cozum |
|-------|-------|-------|-------|
| `src/types/project.ts` | 5 | `"draft" \| "archived"` eksik | Ekle |
| `src/screens/projects-screen.tsx` | 100 | Cast sadece `"active" \| "completed"` | 4 duruma guncelle |
| `src/screens/projects-screen.tsx` | 167-179 | Tag sadece "Active"/"Completed" gosteriyor | "Draft"/"Archived" ekle |
| `src/screens/project-detail-screen.tsx` | 82 | Cast sadece `"active" \| "completed"` | 4 duruma guncelle |

Ek: `health_status` artik NOT NULL (default `'on_track'`). App'teki `| null` tipi artik gereksiz ama crash yapmaz.

---

## 4. TURUNCU — Profile Role Enum

```
ONCE (TEXT):  admin | project_manager | ecologist | junior | third_party | client
SIMDI (ENUM): admin | assessor | project_manager | ecologist | junior | third_party | client
```

> `assessor` web'de **deprecated** — ecologist ile ayni yetki. DB enum'unda geriye uyumluluk icin duruyor. Mobile'da ecologist gibi davranmali.

| Dosya | Satir | Sorun | Cozum |
|-------|-------|-------|-------|
| `src/types/project.ts` | 23 | Profile tip taniminda "assessor" yok | Tip'e ekle (crash onleme) |
| `src/screens/settings-screen.tsx` | 16-23 | roleLabels'da "assessor" yok | `assessor: { label: "Ecologist", color: colors.role.ecologist }` |

Erisim kontrolu (`isAdminOrPM` kontrolu) sorun yok — assessor zaten ecologist gibi restricted erisimine duser.

---

## 5. TURUNCU — ProjectMember Role Enum

```
ONCE (TEXT):  admin | project_manager | ecologist | junior | third_party | client
SIMDI (ENUM): lead | surveyor | analyst | reviewer | viewer | member   (default: 'viewer')
```

| Dosya | Satir | Sorun | Cozum |
|-------|-------|-------|-------|
| `src/types/project.ts` | 14 | ProjectMember role esleri tamamen yanlis | Yeni enum degerleriyle guncelle |

App `project_members.role` degerini **okumuyor** (sadece `project_id` cekmek icin sorgu yapiyor). Islevsel olarak patlamaz ama tip tanimi yanlis.

---

## 6. TURUNCU — Habitat Condition Enum

```
ONCE:    good | moderate | poor | degraded
SIMDI:   excellent | good | moderate | poor | bad
```

| Dosya | Satir | Sorun | Cozum |
|-------|-------|-------|-------|
| `src/types/habitat.ts` | 29-34 | conditionColors: "degraded" var, "bad"/"excellent" yok | `degraded` → `bad`, `excellent` ekle |
| `src/screens/habitat-detail-screen.tsx` | 72 | "bad"/"excellent" icin badge null | conditionColors guncellenince duzulur |
| `src/components/habitat-list.tsx` | 17 | Ayni sorun | conditionColors guncellenince duzulur |

---

## 7. TURUNCU — Target Note Priority

```
ONCE:    high | normal
SIMDI:   high | normal | low
```

| Dosya | Satir | Sorun | Cozum |
|-------|-------|-------|-------|
| `src/screens/target-note-detail-screen.tsx` | 91, 109-112 | "low" → "Normal Priority" olarak gosteriliyor | "Low Priority" ekle |
| `src/components/target-notes-list.tsx` | 18, 35-39 | "low" → "Normal" olarak gosteriliyor | "Low" ekle |

---

## 8. TURUNCU — Releve Survey Veri Bolunmesi

Web artik releve verilerini 2 yere yaziyor:
1. `surveys.form_data` (JSONB — eskiden oldugu gibi)
2. `releve_surveys` tablosu (YENI — yapilandirilmis kolonlar) + `releve_species` (tur listesi)

Mobile SADECE `surveys.form_data`'ya yaziyor.

DB'den dogrulama: 10+ releve survey'den sadece 2'sinin `releve_surveys` karsiligi var (web'den olusturulanlar).

#### `releve_surveys` tablosu (surveys.id ile baglantiili):
```
id, project_id, survey_id, site_name, survey_date, releve_code,
releve_area_sqm, recorder, accuracy_m, survey_x_coord, survey_y_coord,
location, habitat_type, soil_type, soil_stability, aspect, slope_degrees,
[height/cover alanlari...], fauna_observations, releve_comment,
custom_fields (JSONB), created_by, created_at, updated_at
```

#### `releve_species` tablosu (releve_surveys.id ile baglantili):
```
id, releve_id, species_name_latin, species_name_english,
species_cover_domin, species_cover_pct, notes, created_at, updated_at
```

| Dosya | Sorun | Cozum |
|-------|-------|-------|
| `src/lib/survey-save.ts` | Releve survey icin releve_surveys INSERT yok | survey_type === "releve_survey" ise ek INSERT |
| `src/lib/sync-service.ts` | Sync'te releve_surveys INSERT yok | Sync akisina releve_surveys ekle |

**Risk:** Mobile'dan olusturulan releve survey web'de yapilandirilmis veri olarak gorunmez.

---

## 9. TURUNCU — RLS Politika Degisiklikleri

### projects SELECT:
```sql
qual: organization_id = get_user_organization_id(auth.uid())
```
Artik org bazli. App'in client-side role-based filtrelemesi (project_members + created_by) hala calisiyor ama gereksiz — RLS zaten tum org projelerini donduruyor. **SORUN YOK.**

### survey_templates SELECT:
```sql
qual: organization_id = get_user_organization_id(auth.uid())
```
RLS otomatik org filtresi ekliyor. **SORUN YOK.**

### target_notes (TUM islemler):
```sql
qual: project_id IN (SELECT project_members.project_id
                     FROM project_members WHERE user_id = auth.uid())
```
**POTANSIYEL SORUN:** `created_by` fallback YOK (surveys ve habitats RLS'de var, target_notes'da yok). Proje olusturucu ama member olmayan kullanici target note'lari goremez.

### photos INSERT:
```sql
with_check: project_id IS NULL OR EXISTS(project_members match)
```
**POTANSIYEL SORUN:** Proje olusturucu ama member olmayan kullanici foto yukleyemez.

---

## 10-14. YESIL — Yeni Kolonlar ve Tablolar

### Yeni tablo: `project_sites` (multi-site destek)
```
id, project_id, site_code (NOT NULL), site_name, sort_order,
boundary (GEOMETRY), center_point (GEOMETRY), grid_reference,
county, townland, province, buffer_distances (NUMERIC[]),
visible_layers (TEXT[]), attributes (JSONB), created_at, updated_at
```

### Mevcut tablolara eklenen yeni kolonlar:

| Tablo | Yeni Kolonlar |
|-------|---------------|
| `surveys` | site_id, visit_group_id, visit_number |
| `habitat_polygons` | site_id, survey_id, boundary, include_in_report. Ek: fossitt_code/fossitt_name artik NOT NULL |
| `target_notes` | site_id, survey_id, finding_id, created_by (NOT NULL), verified_by, verified_at, include_in_report, created_at, updated_at. Ek: category artik NOT NULL |
| `photos` | observation_id, tags (TEXT[]), notes. Ek: project_id artik nullable |
| `survey_templates` | organization_id (NOT NULL), description, created_by, created_at, updated_at |
| `projects` | organization_id (NOT NULL), client_id, survey_type, current_phase (ENUM), expected/actual dates, budget_days, boundary, center_point, grid_reference, buffer_distances, visible_layers, townland, province, created_at |
| `project_members` | id (UUID PK eklendi) |
| `profiles` | avatar_url, settings (JSONB), created_at, updated_at |

### Yeni tablolar (mobile henuz kullanmiyor):

| Tablo | Amac |
|-------|------|
| `releve_surveys` | Releve survey yapilandirilmis verileri |
| `releve_species` | Releve'ye ait tur kayitlari |
| `releve_survey_templates` | Releve'ye ozel template |
| `species_observations` | Survey'lere bagli tur gozlemleri (konum, foto, abundance) |
| `survey_assignments` | Survey-kullanici atama takibi |

### Mobile'da ne yapilmali (YESIL):

| Dosya | Degisiklik |
|-------|------------|
| `src/lib/database.ts` | `cached_project_sites` tablosu ekle, mevcut cache tablolarina `site_id` ekle, DB version artir |
| `src/app/_layout.tsx` | `cacheAllData()`'a `project_sites` sorgusu ekle |
| `src/lib/survey-save.ts` | Survey INSERT'e `site_id` parametresi ekle |
| `src/lib/sync-service.ts` | Sync INSERT'e `site_id` ekle |
| `src/screens/project-detail-screen.tsx` | Site listesi ve secimi goster |
| `src/screens/surveys-list-screen.tsx` | Site bazli filtreleme ekle |
| `src/screens/habitats-screen.tsx` | Site bazli filtreleme ekle |
| `src/screens/target-notes-screen.tsx` | Site bazli filtreleme ekle |

---

## TUM ENUM DEGERLERI (DB'den dogrulanmis)

```typescript
// user_role (profiles.role)
type UserRole = 'admin' | 'assessor' | 'project_manager' | 'ecologist' | 'junior' | 'third_party' | 'client'
// Default: 'assessor'. DEPRECATED: ecologist ile ayni. UI'da "Ecologist" goster.

// project_status (projects.status)
type ProjectStatus = 'draft' | 'active' | 'completed' | 'archived'
// Default: 'draft'. YENI: 'draft', 'archived'

// health_status (projects.health_status)
type HealthStatus = 'on_track' | 'at_risk' | 'overdue'
// Default: 'on_track'. Artik NOT NULL.

// project_phase (projects.current_phase) — TAMAMEN YENI
type ProjectPhase = 'desk_research' | 'field_research' | 'reporting'

// project_member_role (project_members.role) — TAMAMEN DEGISTI
type ProjectMemberRole = 'lead' | 'surveyor' | 'analyst' | 'reviewer' | 'viewer' | 'member'

// survey_status (surveys.status)
type SurveyStatus = 'in_progress' | 'completed'
// SILINEN: 'planned', 'approved'

// sync_status (surveys.sync_status)
type SyncStatus = 'synced' | 'pending' | 'conflict'
// DEGISEN: 'failed' → 'conflict'
```

---

## ONCELIK SIRASI

### Faz 1 — Acil (app patliyor):
1. `src/types/survey.ts` — status ve sync_status enum guncelle
2. `src/screens/surveys-list-screen.tsx` — filtre ve renk guncelle

### Faz 2 — Onemli (yanlis/eksik gosterim):
3. `src/types/project.ts` — project status, profile role, project_member role
4. `src/screens/projects-screen.tsx` — status tag 4 duruma guncelle
5. `src/screens/project-detail-screen.tsx` — status cast guncelle
6. `src/screens/settings-screen.tsx` — assessor → ecologist olarak goster
7. `src/types/habitat.ts` — conditionColors (bad/excellent)
8. Target note priority — "low" destefi
9. Survey otomatik doldurma (survey_date, surveyor_id, site_id)

### Faz 3 — Releve veri butunlugu:
10. Releve survey kayit: `releve_surveys` + `releve_species` INSERT
11. Mevcut `form_data` yapisini koru (geriye uyumluluk)

### Faz 4 — Multi-site destek:
12. `project_sites` cache + CRUD
13. `site_id` destegi (surveys, habitats, target notes)
14. Site secim UI + site bazli filtreleme

### Faz 5 — Gelecek (opsiyonel):
15. `species_observations` tablosu destegi
16. `survey_assignments` ile atama kontrolu
17. RLS: target_notes icin created_by fallback

---

## EK: Survey Otomatik Doldurma

Survey olusturulurken otomatik doldurulmali:

| Alan | Kaynak | Ornek |
|------|--------|-------|
| `status` | Sabit | `'in_progress'` |
| `site_id` | Secili site | UUID |
| `survey_date` | Bugunku tarih | `'2026-03-31'` |
| `surveyor_id` | Aktif kullanici | UUID |

Releve survey icin ek:

| Alan | Kaynak | Ornek |
|------|--------|-------|
| `site_name` | Proje adi | `'Tralee Bay WF'` |
| `releve_code` | `REL ${101 + count}` | `'REL 103'` |
| `recorder` | Kullanicinin `full_name`'i | `'John Smith'` |
