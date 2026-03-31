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
> DB version 3 → 4. Eski pending survey'lerdeki `planned` → `in_progress`, `approved` → `completed` olarak migrate edildi. Cache tablolari yeniden olusturulacak. Pending survey/photo verileri korunuyor.

- [x] `src/lib/database.ts` — DB version 4'e yukseltildi, migration'da: pending_surveys'de `status = 'planned'` → `'in_progress'`, `status = 'approved'` → `'completed'` olarak guncellendi, cache tablolari temizlendi

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

## FAZ 3 — Multi-site altyapi (project_sites)

### 3.1 SQLite cache tablosu
- [ ] `src/lib/database.ts` — `cached_project_sites` tablosu olustur (id, project_id, site_code, site_name, sort_order, county, cached_at)
- [ ] `src/lib/database.ts` — `cacheProjectSite()`, `getCachedProjectSites(projectId)` fonksiyonlari ekle
- [ ] `src/lib/database.ts` — mevcut cache tablolarina `site_id` kolonu ekle: `cached_surveys`, `cached_habitats`, `cached_target_notes`
- [ ] `src/lib/database.ts` — DB version artir, migration ekle

### 3.2 Cache akisina project_sites ekle
- [ ] `src/app/_layout.tsx` — `cacheAllData()` icinde `project_sites` sorgusunu ekle
- [ ] `src/app/_layout.tsx` — survey/habitat/target_notes cache sorgularina `site_id` kolonu ekle

### 3.3 Survey olusturmada site_id destegi
- [ ] `src/lib/survey-save.ts` — `SaveParams`'a `siteId` ekle, INSERT'e `site_id` gonder
- [ ] `src/lib/sync-service.ts` — sync INSERT'e `site_id` ekle
- [ ] `src/lib/database.ts` — `pending_surveys` tablosuna `site_id` kolonu ekle, `saveSurveyLocally`'e `siteId` parametresi ekle

### 3.4 Proje detayinda site secim UI
- [ ] `src/screens/project-detail-screen.tsx` — projenin site'larini cek ve goster
- [ ] Birden fazla site varsa site secim komponenti goster
- [ ] Secili site'i survey/habitat/target-notes ekranlarina parametre olarak gec

### 3.5 Listeleri site bazli filtrele
- [ ] `src/screens/surveys-list-screen.tsx` — `site_id` filtresi ekle (secili site veya tumu)
- [ ] `src/screens/habitats-screen.tsx` — `site_id` filtresi ekle (`site_id = :siteId OR site_id IS NULL`)
- [ ] `src/screens/target-notes-screen.tsx` — `site_id` filtresi ekle (`site_id = :siteId OR site_id IS NULL`)

---

## FAZ 4 — Releve survey veri butunlugu

### 4.1 Releve survey kaydi
- [ ] `src/lib/survey-save.ts` — `survey_type === "releve_survey"` ise `releve_surveys` tablosuna da INSERT yap (survey_id ile baglantili)
- [ ] Form data'dan releve alanlarini cikart: releve_code, recorder, habitat_type, soil_type, cover yuzdeleri vb.
- [ ] Mevcut `surveys.form_data` yapisini da koru (geriye uyumluluk)

### 4.2 Releve species kaydi
- [ ] Tur verisi varsa `releve_species` tablosuna INSERT (releve_id ile baglantili)
- [ ] species_name_latin, species_cover_domin, species_cover_pct alanlari

### 4.3 Releve otomatik doldurma
- [ ] Survey olusturulurken otomatik doldur: survey_date, surveyor_id, site_id
- [ ] Releve icin ek: site_name (proje adi), releve_code (`REL ${101 + count}`), recorder (kullanicinin full_name'i)
- [ ] releve_code hesaplamak icin: `SELECT COUNT(*) FROM releve_surveys WHERE project_id = :projectId`

### 4.4 Offline sync
- [ ] `src/lib/sync-service.ts` — sync akisina releve_surveys + releve_species INSERT ekle
- [ ] `src/lib/database.ts` — pending_surveys tablosuna releve-specific alanlari ekle (veya form_data'dan parse et)

---

## FAZ 5 — Gelecek (opsiyonel)

### 5.1 Species observations
- [ ] `species_observations` tablosu destegi — survey sirasinda tur gozlemi kaydi
- [ ] Offline cache + sync

### 5.2 Survey assignments
- [ ] `survey_assignments` tablosu destegi — kullaniciya atanmis survey'leri filtrele

### 5.3 RLS uyumlulugu
- [ ] target_notes icin created_by fallback — proje olusturucu member degilse target note goremez sorunu
- [ ] photos INSERT icin ayni sorun — DB tarafinda RLS duzeltmesi gerekebilir
