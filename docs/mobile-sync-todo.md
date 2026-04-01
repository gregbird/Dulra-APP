# Mobile Sync — Yapilacaklar Listesi

> Breaking changes dokumani: `docs/mobile-sync-breaking-changes.md`
> Tarih: 31 Mart 2026

---

## FAZ 1 — Acil (app patliyor)

### 1.1 Survey status enum guncelle ✓
> DB'den silinen `planned`/`approved` enum degerleri app kodundan temizlendi. Survey listesindeki filtreler ve renk tanimlari sadece `in_progress`/`completed` ile calisiyor.

- [x] `src/types/survey.ts` — `status` tipinden `"planned"` ve `"approved"` kaldirildi → sadece `"in_progress" | "completed"`
- [x] `src/types/survey.ts` — `surveyStatusLabels` objesinden `planned` ve `approved` satirlari kaldirildi
- [x] `src/screens/surveys-list-screen.tsx` — `statusColors` objesinden `planned` ve `approved` kaldirildi
- [x] `src/screens/surveys-list-screen.tsx` — aktif filtre → sadece `s.status === "in_progress"`
- [x] `src/screens/surveys-list-screen.tsx` — tamamlanan filtre → sadece `s.status === "completed"`

### 1.2 Survey sync_status enum guncelle ✓
> DB'deki `failed` → `conflict` degisikligi tip tanimina yansitildi. 1.1 ile birlikte yapildi.

- [x] `src/types/survey.ts` — `sync_status` tipinden `"failed"` kaldirildi → `"conflict"` eklendi

### 1.3 SQLite pending veri migrasyonu ✓
> Eski pending survey'lerdeki `planned` → `in_progress`, `approved` → `completed` olarak migrate edildi. Cache tablolari yeniden olusturulacak. Pending survey/photo verileri korunuyor. (Guncel DB version: 5 — Faz 3 migration'i ile yukseltildi.)

- [x] `src/lib/database.ts` — migration'da: pending_surveys'de `status = 'planned'` → `'in_progress'`, `status = 'approved'` → `'completed'` olarak guncellendi, cache tablolari temizlendi

---

## FAZ 2 — Tip tanimlari ve enum guncelleme

### 2.1 Project status guncelle ✓
> Project status tipi 4 duruma genisletildi (draft/active/completed/archived). Proje listesinde draft icin mavi, archived icin gri tag gosteriliyor. health_status artik NOT NULL oldugu icin null fallback kaldirild.

- [x] `src/types/project.ts` — `Project.status` tipine `"draft"` ve `"archived"` eklendi, `health_status`'tan `| null` kaldirildi
- [x] `src/screens/projects-screen.tsx` — cache fallback cast'i `Project["status"]` / `Project["health_status"]` olarak guncellendi
- [x] `src/screens/projects-screen.tsx` — status tag: statusLabels objesi + draft icin mavi stil eklendi, archived "Completed" stili kullanir
- [x] `src/screens/project-detail-screen.tsx` — cache fallback cast'i guncellendi

### 2.2 Profile role guncelle ✓
> Deprecated `assessor` rolu tip tanimina eklendi ve Settings ekraninda "Ecologist" olarak gosteriliyor (ecologist ile ayni label/renk).

- [x] `src/types/project.ts` — `Profile.role` tipine `"assessor"` eklendi
- [x] `src/screens/settings-screen.tsx` — `roleLabels`'a `assessor: { label: "Ecologist", color: colors.role.ecologist }` eklendi

### 2.3 ProjectMember role guncelle ✓
> ProjectMember role tipi DB'deki yeni `project_member_role` enum'una uyduruldu. App bu degeri okumuyor (sadece project_id cekmek icin sorgu yapiyor), ama tip tanimi artik dogru.

- [x] `src/types/project.ts` — `ProjectMember.role` tipi `"lead" | "surveyor" | "analyst" | "reviewer" | "viewer" | "member"` olarak guncellendi

### 2.4 Habitat condition enum guncelle ✓
> `degraded` → `bad` olarak degistirildi, `excellent` eklendi. Artik DB'deki 2 adet `bad` habitat ve gelecekte eklenecek `excellent` habitatlar dogru badge gosterecek.

- [x] `src/types/habitat.ts` — `conditionColors`: `degraded` → `bad`, `excellent` eklendi (excellent: yesil #059669, bad: koyu kahve #7C2D12)

### 2.5 Target note priority guncelle ✓
> Priority gosterimi 3 duruma genisletildi: high (kirmizi), normal (gri), low (mavi). Hem liste hem detay ekraninda uygulanadi.

- [x] `src/components/target-notes-list.tsx` — priority badge 3 duruma guncellendi (high/normal/low)
- [x] `src/screens/target-note-detail-screen.tsx` — priority badge 3 duruma guncellendi (High Priority/Normal Priority/Low Priority)

---

## FAZ 3 — Multi-site altyapi (project_sites) ✓

### 3.1 SQLite cache tablosu ✓
> DB version 4 → 5. Mevcut tablolara ALTER TABLE ile site_id eklendi, yeni cached_project_sites tablosu olusturuldu. Yeni kurulumlar icin CREATE TABLE'lar da guncellendi.

- [x] `src/lib/database.ts` — `cached_project_sites` tablosu olusturuldu (id, project_id, site_code, site_name, sort_order, county, cached_at)
- [x] `src/lib/database.ts` — `cacheProjectSite()`, `getCachedProjectSites(projectId)` fonksiyonlari eklendi
- [x] `src/lib/database.ts` — mevcut cache tablolarina `site_id` kolonu eklendi: `cached_surveys`, `cached_habitats`, `cached_target_notes`
- [x] `src/lib/database.ts` — DB version 5'e yukseltildi, v4→v5 migration eklendi

### 3.2 Cache akisina project_sites ekle ✓
> cacheAllData() icinde project_sites sorgusu eklendi, tum cache yazimlarinda site_id iletiliyor.

- [x] `src/app/_layout.tsx` — `cacheAllData()` icinde `project_sites` sorgusu eklendi
- [x] `src/app/_layout.tsx` — survey/habitat/target_notes cache sorgularina `site_id` kolonu eklendi

### 3.3 Survey olusturmada site_id destegi ✓
> SaveParams'a siteId eklendi. Online INSERT, offline save ve sync akisinda site_id Supabase'e gonderiliyor.

- [x] `src/lib/survey-save.ts` — `SaveParams`'a `siteId` eklendi, INSERT'e `site_id` gonderiliyor
- [x] `src/lib/sync-service.ts` — sync INSERT'e `site_id` eklendi
- [x] `src/lib/database.ts` — `pending_surveys` tablosuna `site_id` kolonu eklendi, `saveSurveyLocally`'e `siteId` parametresi eklendi

### 3.4 Proje detayinda site secim UI ✓
> SitePicker dropdown/modal component olusturuldu. effectiveSiteId mantigi: 0 site → null, 1 site → otomatik, 1+ site → kullanici secimi. Multi-site projede "All Sites" seciliyken survey olusturma engelleniyor.

- [x] `src/components/site-picker.tsx` — dropdown selector olusturuldu (basinca fullscreen modal ile site listesi acilir)
- [x] `src/screens/project-detail-screen.tsx` — projenin site'lari cekilip gosteriliyor
- [x] Birden fazla site varsa site secim komponenti gorunuyor
- [x] Secili site'i survey/habitat/target-notes ekranlarina parametre olarak geciliyor
- [x] Multi-site projede site secilmeden survey olusturma engelleniyor (Alert)
- [x] Tek site projede otomatik site_id atamasi yapiliyor

### 3.5 Listeleri site bazli filtrele ✓
> Tum list ekranlarinda siteId URL parametresi alinip Supabase sorgularina ve cache fallback filtresine uygulanıyor.

- [x] `src/screens/surveys-list-screen.tsx` — `site_id` filtresi eklendi (`.eq` — eski survey'ler sadece "All Sites"de gorunur)
- [x] `src/screens/habitats-screen.tsx` — `site_id` filtresi eklendi (`.or("site_id.eq.X,site_id.is.null")`)
- [x] `src/screens/target-notes-screen.tsx` — `site_id` filtresi eklendi (`.or("site_id.eq.X,site_id.is.null")`)

---

## FAZ 4 — Releve survey veri butunlugu

### 4.1 Releve survey kaydi ✓
> Yeni dosyalar: `src/types/releve.ts` (tip tanimlari + extractReleveFields), `src/lib/releve-save.ts` (insert/upsert/species fonksiyonlari). Online ve offline akislarin ikisinde de releve_surveys INSERT eklendi.

- [x] `src/types/releve.ts` — `ReleveData` interface (30+ kolon), `ReleveSpeciesEntry` interface, `extractReleveFields()` helper (numeric/string ayirimi ile form → DB kolon eslestirmesi)
- [x] `src/lib/releve-save.ts` — `insertReleveSurvey()` (surveys INSERT sonrasi cagirilir), `upsertReleveSurvey()` (delete+insert, guncelleme icin), `extractReleveFromFormData()` (section bazli formData'yi duzlestirir)
- [x] `src/lib/survey-save.ts` — Online yeni kayit: `surveyType === "releve_survey"` kontrolu ile surveys INSERT → releve_surveys INSERT. Online guncelleme: surveys UPDATE → releve_surveys upsert (delete+insert)
- [x] Mevcut `surveys.form_data` yapisi korunuyor (geriye uyumluluk) — releve alanlari form_data'dan extract edilip ayrica releve_surveys'e yaziliyor

### 4.2 Releve species kaydi ✓
> Species INSERT fonksiyonu `releve-save.ts`'e eklendi. formData.species dizisinden parse edilip releve_species tablosuna yaziliyor. Upsert durumunda cascade delete ile eski species silinip yeniden ekleniyor.

- [x] `src/lib/releve-save.ts` — `insertReleveSpecies(releveId, species[])` fonksiyonu eklendi, species_name_latin bos olanlari filtreler
- [x] `src/lib/releve-save.ts` — `extractSpeciesFromFormData()` fonksiyonu eklendi, formData.species dizisini validate eder
- [x] `src/lib/survey-save.ts` — Online yeni kayit ve guncelleme: releve INSERT/upsert sonrasi releveId ile species INSERT
- [x] `src/lib/sync-service.ts` — Offline sync: releve INSERT sonrasi species INSERT

### 4.3 Releve otomatik doldurma ✓
> `getReleveDefaults()` fonksiyonu `releve-save.ts`'e eklendi. Releve form acildiginda cagrilacak. Online: Supabase'den count + profil cekilir. Offline: count 101'den baslar, recorder bos kalir (kullanici doldurur). Pending survey'ler de count'a dahil edilir (duplike releve_code onlenir).

- [x] `src/lib/releve-save.ts` — `getReleveDefaults({ projectId, projectName })` fonksiyonu: survey_date (bugun), recorder (profiles.full_name), releve_code (`REL ${101 + count}`), site_name (proje adi)
- [x] releve_code hesabi: Supabase'den `SELECT COUNT(*) FROM releve_surveys WHERE project_id` + SQLite'dan pending releve survey sayisi
- [x] site_id destegi Faz 3 ile eklendi, siteId varsa site_name olarak site ismi kullaniliyor (yoksa proje adi fallback)

### 4.4 Offline sync ✓
> 4.1 ve 4.2 ile birlikte yapildi. Sync akisinda `survey_type === "releve_survey"` kontrolu ile chain INSERT eklendi. Ayri migration gerekmedi — releve verileri mevcut pending_surveys.form_data JSON'unda saklanip sync sirasinda parse ediliyor.

- [x] `src/lib/sync-service.ts` — sync akisina releve_surveys + releve_species INSERT eklendi (surveys INSERT → releve INSERT → species INSERT chain)
- [x] `src/lib/database.ts` — pending_surveys tablosuna ek kolon gerekmedi, form_data JSON'undan parse ediliyor (`extractReleveFromFormData` + `extractSpeciesFromFormData`)

---

> **FAZ 5 kaldirildi** — Orijinal iOS requirements'ta istenmedigf icin (species_observations, survey_assignments, RLS) scope disindan cikarildi.
