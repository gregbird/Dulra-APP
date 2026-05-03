# Feedback 27/4 — Mobile Scope

> **Kaynak:** `docs/feedback/feedback-27-4-apr.md` — Greg Birdthistle (27 Nisan 2026)
> **Bu dosya:** 27/4 feedback'inden mobile app'i ilgilendiren maddelerin (#3, #4, #5) izole edilmiş hâli. Mobile takımıyla paylaşmak / üzerinden gitmek için.
> **Status:** ✅ Mobile tarafı tamamlandı (2026-05-03). Web bağlantılı işler ayrıca aşağıda listelenmiş.

---

## Özet

| #   | Başlık                                               | Scope        | Schema değişikliği                              | Durum                              |
| --- | ---------------------------------------------------- | ------------ | ----------------------------------------------- | ---------------------------------- |
| 3   | GPS auto-detect / permission prompt                  | Mobile only  | ❌                                               | ✅ Done                            |
| 4   | Survey GPS auto-populate + Web Data Analysis plot    | Mobile + Web | ✅ `releve_surveys.survey_id` UNIQUE eklendi    | ✅ Releve done · ⏳ Diğer survey'ler |
| 5   | Foto çekme — proje seviyesi + survey seviyesi ayrımı | Mobile + Web | ✅ `photos.site_id` eklendi (yeni tablo değil)  | ✅ Done (Phase 1 + 2)              |

---

## #3 — Mobile App: GPS detect / prompt — ✅ Done

**Greg'in orijinali:**

> "The app should either automatically detect the user's location or prompt the user to enable their phone's geolocation services."

**Türkçe:** Mobile app açılırken kullanıcının lokasyonunu otomatik tespit etmeli ya da telefonun GPS / lokasyon servislerini açması için uyarı göstermeli.

### ✅ Yapılan iş

**Yeni dosyalar:**
- `src/lib/location.ts` — `getLocation`, `getLastKnownLocation`, `getPermissionStatus`, `requestPermission`, `openLocationSettings`, `clearLocationCache`. Module-level cache, default TTL 5 dk. `accuracy` field'ı döner.
- `src/hooks/use-location.ts` — `useLocation()` hook, `AppState` listener Settings'ten dönüşte status'ü yeniler.
- `src/components/location-permission-modal.tsx` — 3-state full-screen modal (undetermined/denied/granted), camera permission paterniyle uyumlu.

**Değişen dosyalar:**
- `src/app/_layout.tsx` — first-launch modal tetikleme, `app_state.location_prompt_shown` flag'iyle "Maybe later" persistence.
- `src/screens/settings-screen.tsx` — Permissions section + Location row (badge: Granted / Denied / Not asked).
- `src/lib/photo-service.ts` — eski inline GPS kodu kaldırıldı, yeni lib import edildi (60s TTL korundu).
- `src/lib/database.ts` — v7 migration: `app_state(key, value)` tablosu + `getAppState`/`setAppState` helpers.
- `src/lib/dev-actions.ts` — `resetLocationPrompt()` testing helper (flag'i SQLite'tan siler + in-memory cache'i temizler).
- `src/components/dev-tool.tsx` — DevTool menüsüne "Reset Location Prompt" butonu (QA için modal'ı yeniden tetiklemek).
- `app.json` — Android permissions duplicate cleanup (8 → 4).

### Açık soruların cevapları

- [x] **Background location gerekli mi?** Hayır — sadece foreground (`requestForegroundPermissionsAsync`).
- [x] **iOS "Always" vs "While Using"?** "While Using" — surveyor app'i sürekli açık tutmuyorsa yeterli.
- [x] **Permission denied senaryosunda manuel girişi?** Evet, kalıcı — releve form'unda alanlar her zaman editable.

---

## #4 — Mobile App: Survey GPS auto-populate + Web Data Analysis plot — ✅ Releve done · ⏳ Diğer survey'ler

**Greg'in orijinali:**

> "For surveys requiring a geolocation, the user's phone should automatically populate this information. Furthermore, the location data from these field surveys, along with the collected survey data, needs to be plotted onto a GIS map within the data analysis tab."

**Türkçe:** GPS gerektiren survey'lerde (releve, target notes vb.) telefon mobile app içinde GPS koordinatlarını otomatik doldurmalı. Sonra bu konumlar + survey verisi web tarafında **Step 5 Data Analysis → Maps tab**'inde GIS haritası üzerinde noktalanmalı.

### Schema kontrolü sonucu

DB sorgulandı:
- ✅ `releve_surveys` — `survey_x_coord` (lng), `survey_y_coord` (lat), `accuracy_m`, `location` (PostGIS POINT) zaten vardı.
- ✅ `target_notes` — `location` (PostGIS POINT) zaten vardı.
- ❌ `surveys` (bird/mammal/bat/walkover/aquatic/botanical/habitat_mapping/invertebrate/biodiversity_net_gain/other) — **lokasyon kolonu yok**.

Greg'in *"GPS gerektiren survey"* tanımı schema ile örtüşüyor: gerektiren = DB'de location alanı olan. Diğer survey type'ları "opsiyonel" — şimdilik scope dışı.

### ✅ Yapılan iş — Releve

**Değişen dosyalar:**
- `src/constants/releve-data.ts` — coord etiket fix: "X (Lat)/Y (Lng)" → "Longitude (X)/Latitude (Y)" (web standardına uyum).
- `src/lib/dev-fill-data.ts` — test data swap (`survey_x_coord = lng`, `survey_y_coord = lat`).
- `src/lib/releve-save.ts` — `buildLocationWkt` helper + `insertReleveSurvey`/`upsertReleveSurvey` artık `location` PostGIS kolonunu da yazıyor (`SRID=4326;POINT(lng lat)`). Web parite. Migration filter'ı (`location IS NULL`) kalıcı güvenli.
- `src/screens/releve-survey-form-screen.tsx` —
  - Auto-capture on mount (sadece yeni survey'de): `getLastKnownLocation()` → anında, `getLocation({maxAgeMs: 0})` → fresh fix; manuel girilen değerleri korur.
  - Edit modunda hiç auto-capture yok (mevcut değerler korunur).
  - "Refresh GPS" butonu — manuel override için, alanları zorla yeniler.
  - Accuracy badge: ≤10m yeşil "Excellent", ≤50m sarı "OK", >50m kırmızı "Poor".
  - NetInfo race fix: `init()` başında aktif `NetInfo.fetch()` sondajı (web'in update'leri görünebilsin diye).
- `src/screens/target-note-detail-screen.tsx` — read-only ekrana **"Update Location"** butonu eklendi (online-only flow): confirm → GPS yakala → `target_notes.location` UPDATE → cache yenile.
- `src/lib/sync-service.ts` — releve sub-write try-catch error logging (önce sessizce yutuyordu, retry_count artmıyordu).

**Web tarafı (uygulandı):**
- ✅ `releve_surveys.survey_id` UNIQUE constraint eklendi (sync ON CONFLICT bug'ı için).
- ⏳ 4 swap'lı eski releve kaydı için data migration beklemede (mobile fix release sonrası).

### Açık soruların cevapları

- [x] **Multi-point survey (transect, walkover) tek nokta mı, polyline mı?** Schema'da `surveys` tablosunda lokasyon kolonu yok → bu PR'a dahil değil. Ayrı bir feature olarak planlanmalı (web ile schema koordinasyonu).
- [x] **Photo'ların GPS metadata'sı (EXIF) haritada noktalanabilir mi?** `photos.location` PostGIS POINT olarak zaten dolduruluyor (mobile photo upload'unda current GPS yazılıyor). Web Step 5 Maps tab'i bu kolonu kullanabilir.
- [x] **GPS accuracy threshold — save engellensin mi?** Hayır, MVP için sadece **görsel uyarı** (renkli badge). Save engellenmiyor. CIEEM releve plot'ları için ≤10m yeşil eşiği uygun (web ekibi onay).

### ⏳ Sonraki sprint'e bırakılan

- Bird/mammal/bat/walkover surveys için `surveys` tablosuna location kolonu eklenmesi (web koordineli schema migration).
- Walkover multi-point (polyline) yapısı.
- Web Step 5 Maps tab'ında survey location marker'ları (web ekibinin işi, mobile parite var).

---

## #5 — Foto çekme: project vs survey seviyesi — ✅ Done (Phase 1 + 2)

**Greg'in orijinali:**

> "Photographs should be captured at two levels: project and survey. When conducting surveys in the field, users will take photographs that must be linked to the specific survey they are completing. Additionally, the user should have an option to take a photograph of the site itself."

**Türkçe:** İki ayrı foto kategorisi olmalı:

1. **Survey-level:** Spesifik bir survey'e bağlı (mevcut yapı bu).
2. **Project / Site-level:** Survey'e bağlı olmayan, sadece site'ı gösteren genel fotoğraflar.

### Schema kontrolü sonucu — feedback varsayımı yanlıştı

Feedback dökümanı *"`survey_photos.survey_id` muhtemelen NOT NULL → yeni `project_photos` tablosu gerek"* öneriyordu. Schema kontrolünde durum farklı çıktı:

- `photos` tablosu **tek tablo** ve **tüm FK'ler nullable**: `survey_id`, `observation_id`, `project_id`, `habitat_polygon_id`, `target_note_id`.
- Yeni tablo gerekmedi → mevcut `photos` tablosuna `site_id` kolonu eklendi.

Tag-driven gallery: Web `photos.tags` array'ini kullanıyor (`COMMON_TAGS` içinde "general", "habitat", "species", "damage", "access", "boundary", "watercourse", "invasive", "site"). Mobile project-level foto'ları `tags: ['site']` ile yazıyor.

### ✅ Yapılan iş

**Yeni dosyalar:**
- `src/app/project/[id]/photos.tsx` — yeni route (project detay'da Photos card'ından açılır).
- `src/screens/project-photos-screen.tsx` — grid + Add Photo FAB + caption modal entegrasyonu + fullscreen Modal-based gallery (zoom + library picker + camera).
- `src/components/caption-prompt.tsx` — capture/library sonrası opsiyonel caption modal'ı (Skip / Save).

**Değişen dosyalar:**
- `src/screens/project-detail-screen.tsx` — "Photos" card'ı eklendi (sections array).
- `src/lib/photo-service.ts` — `uploadPhoto` artık `tags`, `siteId`, `caption` parametrelerini alır; `photos` insert'inde tags/site_id (sadece set edilirse) yazılır.
- `src/lib/database.ts` — v8 migration: `pending_photos.site_id`, `tags` (JSON), `caption` kolonları + `savePhotoLocally`/`getPendingPhotos` extension.
- `src/lib/sync-service.ts` — `if (!photo.survey_id) continue;` filter kaldırıldı — project/site-level foto'lar artık sync edilebiliyor; tags/caption/site_id pending'den okunup `uploadPhoto`'ya geçiyor.
- `src/lib/watermark.ts` — format web parite ("at HH:mm" separator).

**Akış (mobile):**
1. Project detay → "Photos" card.
2. Multi-site projede SitePicker görünür (single-site'da otomatik tek site atanır).
3. FAB → ActionSheet: "Take Photo" / "Choose from Library" / "Cancel". Library `expo-image-picker.launchImageLibraryAsync` kullanıyor.
4. Foto çek/seç → caption modal: "Add caption (optional)" + Skip / Save.
5. Online → `uploadPhoto` (tags=['site'], site_id, caption).
6. Offline → `pending_photos` queue'ya yazılır → online gelince sync.
7. Galeri foto'ya tıkla → fullscreen `Modal`-based viewer + pinch-to-zoom (ScrollView `maximumZoomScale={5}`) + sayfalar arası geçiş. *(İlk implementation'da conditional render kullanmıştık, ikinci açılışta black screen bug'ı çıktı — Modal paterniyle çözüldü.)*

**Web tarafı (uygulandı):**
- ✅ `photos.site_id uuid REFERENCES project_sites(id) ON DELETE SET NULL` migration'ı uygulandı.
- ✅ `lib/supabase/queries/photos.ts:getProjectPhotos` 3 yoldan eşleştiriyor (direct site_id, ya da survey/target_note/habitat_polygon FK).
- ✅ `components/field-surveys/photo-gallery.tsx` `COMMON_TAGS` listesinin başına `"site"` tag'i eklendi.
- ✅ `types/database.ts` regenerate edildi.

### Açık soruların cevapları

- [x] **Multi-site'de site_id ne zaman zorunlu?** Multi-site'de SitePicker zorunlu (FAB'a basınca "Select a Site" alert). Single-site'da otomatik tek site'a bağlanır. Nearest-site auto-detect MVP'de yok (web ekibi onay).
- [x] **Storage bucket aynı mı?** Evet — tek bucket: `project-photos` (public, 10MB limit). Path convention `{projectId}/{context}/{subPath}/{timestamp}-photo.jpg`. context = "general" (project-level), "survey", "habitat", "target-note".
- [x] **Max file size / compression?** Mobile camera quality 0.8 (~80%), library import quality 0.8 (`expo-image-picker`). 10MB bucket limit'e uyum.
- [x] **Caption zorunlu mu?** Hayır, opsiyonel (web'de de). Skip butonu her zaman mevcut. Boş caption → DB'de `null` (web fallback'leri "Site photo" / "Field photo" gösterir).

### ✅ Çözülen web bug — gallery `watermarked_path` tüketmiyordu

Mobile foto'larında Step 5 Photographs galerisinde watermark metadata overlay'i (date | lat,lng) ve "site" tag chip'i görünmüyordu. Sebep: web tüm consumer'ları `storage_path` (raw image) gösteriyordu, `watermarked_path`'i hiç okumuyordu.

**Web fix (uygulandı, 2026-05-03):**
- Tüm photo URL üretimi `getPhotoDisplayUrl(photo)` resolver'ından geçiyor — `watermarked_path ?? storage_path` fallback.
- AI Draft "Insert Photos" rapora watermarked URL koyuyor → PDF çıktısında metadata bake-in olur.
- Refresh sonrası mobile foto'lar (örn. `dd4bf8fe...`, `afbf8b4c...`) watermark imajıyla görünüyor.

**Web tarafında watermark üretimi yok** — şu an web upload'ları raw kalıyor (mobile'ın canvas-based watermark engine'i yalnızca mobile akışında çalışıyor). İleri bir PR'da web tarafına da watermark eklenebilir, ama mobile parite gerekmedikçe öncelikli değil. Mobile değişikliği gerekmez.

---

## Bağımlılıklar — ✅ Çözüldü

- **#3 → #4:** ✅ `useLocation` hook + permission modal #3'te çözüldü → #4 releve form auto-fill'i bunu kullanıyor.
- **#4 → #5:** ✅ Foto'ların GPS metadata'sı `getLocation()` tek lib'den geliyor → #5 project photo upload'ı aynı yolu kullanıyor.
- **#5 schema değişikliği:** ✅ `photos.site_id` migration'ı uygulandı (yeni tablo değil, mevcut `photos`'a kolon). Mobile + web paralel deploy edildi.

## Yapılan sıra

1. ✅ #3 — GPS permission flow (standalone).
2. ✅ #4 — Releve survey GPS auto-capture + accuracy badge + refresh button + label fix + PostGIS location yazımı + target notes update location butonu.
3. ✅ #5 — Project photos tab (grid + camera + library + caption + zoom + multi-site picker, offline-first).
4. ✅ Web gallery `watermarked_path` resolver fix — mobile foto'ların metadata overlay'i artık görünüyor.
5. ⏳ Sonraki sprint — Diğer survey type'larına (bird/mammal/bat/walkover) lokasyon eklenmesi (web ile schema koordinasyonu).

---

## Test sonuçları (cihazda doğrulandı)

| Senaryo | Durum |
| --- | --- |
| #3 Permission modal — first launch | ✅ Allow → granted; Maybe later → flag persists |
| #3 Settings → Permissions → Location row | ✅ Status doğru; tap modal'ı açıyor |
| #4 Releve form auto-capture (yeni survey) | ✅ Koordinatlar dolar, accuracy badge görünür |
| #4 Releve form edit mode | ✅ Mevcut değerler korunur, auto-capture tetiklenmez |
| #4 Refresh GPS butonu | ✅ Manuel girilen değerleri override ediyor |
| #4 PostGIS location DB'ye yazıldı | ✅ `ST_AsText(location) = POINT(lng lat)` |
| #4 NetInfo race fix | ✅ Web'in koord update'leri mobile'da fresh görünüyor |
| #4 Sync ON CONFLICT bug | ✅ Çözüldü (mobile workaround + web UNIQUE constraint) |
| #5 Project photos tab | ✅ Liste, FAB, ActionSheet, caption modal çalışıyor |
| #5 Camera capture + watermark | ✅ Foto çekildi, watermark uygulandı, DB'ye yazıldı |
| #5 Library picker | ✅ Galeriden foto seçimi → caption → upload |
| #5 Multi-site SitePicker | ✅ Multi-site'de görünür, "All Sites" iken FAB Alert veriyor |
| #5 Offline upload + sync | ✅ Offline'da pending'e düşer, online sync OK, doğru site'a yazılır |
| #5 Gallery zoom | ✅ Pinch-to-zoom çalışıyor, sayfalar arası geçişte resetleniyor |
| #5 Web gallery overlay (watermark görünümü) | ✅ Web fix sonrası mobile foto'lar metadata'lı görünüyor |

---

## Cleanup / Bilinen TODO'lar

- **`releve-save.ts:upsertReleveSurvey`** — manuel SELECT-then-INSERT/UPDATE workaround. Web `releve_surveys.survey_id` UNIQUE constraint'i artık mevcut, native `.upsert({ onConflict: "survey_id" })`'e dönülebilir. Kodda `TODO(web)` notu var. Stabil çalıştığı için cleanup ileri bir commit'e bırakıldı (acil değil).
- **DevTool helpers** — `resetLocationPrompt()` ve "Reset Location Prompt" butonu QA için. `__DEV__` guard altında, prod build'e gitmiyor.
- **Web swap migration** — 4 swap'lı eski releve kaydı için web ekibi mobile fix release sonrası uygulayacak (data migration, mobile değişikliği gerekmez).
- **Diğer survey'ler için lokasyon** — bird/mammal/bat/walkover/aquatic/botanical/habitat_mapping/invertebrate/biodiversity_net_gain/other → schema'da location kolonu yok. Web ile schema koordinasyonu gerekiyor; ayrı bir feature ticket.
- **Walkover multi-point** — polyline mı, çoklu nokta mı kararı bekliyor.
- **Web upload watermark** — web tarafı şu an raw image upload ediyor (canvas-based watermark yok). Mobile parite gerekirse ileri PR'da eklenebilir, öncelikli değil.

---

## İlgili mevcut doc'lar

- `docs/feedback/feedback-27-4-apr.md` — Tüm 27/4 feedback'i (kaynak).
- `docs/feedback/mobile-and-followup-todos.md` — 2026-04-19 Field Research UX pass'ten mobile review TODO'ları (`expectedSurveyCount`, survey CTA hiyerarşisi, completed survey delete vb.). Bu dosyayla birleştirme önerisi: bağımsız tut — bu 27/4 feedback'ine özel, diğeri 19/4 web pass'inden çıkmış.

---

## DB Müdahaleleri (implementation sırasında uygulanan)

Bu feedback'in #3-#5 maddeleri uygulanırken Supabase ve mobile SQLite tarafında aşağıdaki değişiklikler yapıldı. Tarih sırasına göre.

### Supabase (web ekibi tarafından uygulanmış / uygulanacak)

#### 1. ✅ `releve_surveys.survey_id` UNIQUE constraint *(uygulandı, 2026-05-03)*

```sql
ALTER TABLE releve_surveys
ADD CONSTRAINT releve_surveys_survey_id_unique UNIQUE (survey_id);
```

**Sebep:** Mobile sync'inde `releve_surveys upsert failed: there is no unique or exclusion constraint matching the ON CONFLICT specification` hatası çıkıyordu. `supabase.upsert(..., { onConflict: "survey_id" })` çağrısı PostgREST level'da unique constraint zorunlu kılıyor; o kolon plain FK idi, unique değildi. İlk insert başarılı ama edit/retry senaryosunda ON CONFLICT yolu açılınca fail.

**Veri integrity check (web ekibi):** Migration öncesi `SELECT survey_id, COUNT(*) FROM releve_surveys GROUP BY survey_id HAVING COUNT(*) > 1` sıfır satır döndü — 1:1 ilişki design intent'i tüm mevcut kayıtlarda korunuyordu. Backfill gerekmedi.

**Mobile etkisi:** Geçici workaround eklendi (`releve-save.ts:upsertReleveSurvey` — manuel SELECT → UPDATE/INSERT). Migration sonrası native `.upsert({ onConflict: 'survey_id' })`'e dönülebilir, ama kod stabil çalıştığı için cleanup commit'i ileri bir tarihe bırakıldı (kodda `TODO(web)` notu var).

#### 2. ✅ `photos.site_id` kolonu *(uygulandı, 2026-05-03)*

```sql
ALTER TABLE photos
ADD COLUMN site_id uuid REFERENCES project_sites(id) ON DELETE SET NULL;
```

**Sebep:** Madde #5 — multi-site projelerde fotoğrafları site bazında ayırabilmek için. Feedback dökümanı *"yeni `project_photos` tablosu"* öneriyordu, ama schema kontrolünde `photos` tablosunun zaten esnek olduğu (tüm FK'ler nullable) görüldü. Yeni tablo açmak yerine mevcut `photos`'a `site_id` eklemek daha temiz çözüm.

**Web ek değişiklikleri (uygulandı):**
- `lib/supabase/queries/photos.ts:getProjectPhotos` artık 3 yoldan eşleştiriyor: doğrudan `site_id`, ya da survey/target_note/habitat_polygon FK'leri üzerinden join. *"no related entities → return []"* erken çıkışı kaldırıldı (site_id-only kayıtlar yakalanır).
- `components/field-surveys/photo-gallery.tsx` `COMMON_TAGS` listesinin başına `"site"` tag'i eklendi.
- `types/database.ts` regenerate edildi: `photos.Row/Insert/Update`'a `site_id: string | null` eklendi, `photos_site_id_fkey` relationship tanımlandı.

**Nullable kararı:** Single-site projelerde site_id'siz çalışılabilsin diye nullable. Eski kayıtlarda site_id yok, geriye dönük uyumluluk için.

#### 3. ⏳ Veri migration: 4 swap'lı releve kaydı düzeltme *(beklemede, mobile fix release sonrası)*

```sql
UPDATE releve_surveys rs
SET 
  survey_x_coord = sub.new_x,
  survey_y_coord = sub.new_y,
  location = ST_SetSRID(ST_MakePoint(sub.new_x, sub.new_y), 4326)
FROM (
  SELECT id, 
         survey_y_coord AS new_x,
         survey_x_coord AS new_y
  FROM releve_surveys
  WHERE location IS NULL 
    AND survey_x_coord IS NOT NULL 
    AND survey_y_coord IS NOT NULL
) sub
WHERE rs.id = sub.id;
```

**Sebep:** Mobile pre-fix `releve-data.ts`'de label'lar yanlıştı (`survey_x_coord` "X (Lat)", `survey_y_coord` "Y (Lng)" — standart konvansiyona ters). Kullanıcılar form'a manuel girerken yanlış label gördüğü için 4 kayıt swap'lı yazılmış (X=lat, Y=lng). Web'in standart konvansiyonuyla (X=lng, Y=lat) tutarsız.

**Filter güvenliği:** `location IS NULL` mobile-kaynaklı kayıtları yakalar (mobile pre-fix `location` PostGIS kolonunu hiç yazmıyordu). Web ise her zaman `location` doldurduğu için web kayıtları bu filter'a takılmaz.

**Sıralama kritik:** Önce mobile fix release → eski mobile build'lerin yeni veri yazma riski sıfırlanmalı → sonra migration. Tersi yapılırsa swapped yazma devam eder, migration sonrası DB tekrar bozulur.

**Anomali kayıt:** 1 kayıt `survey_x_coord=null, survey_y_coord=8` — anlamsız değer, migration'a dahil edilmiyor.

### Mobile SQLite (`database.ts`)

#### v6 → v7 *(uygulandı)*

Yeni tablo:
```sql
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

**Sebep:** Madde #3 — first-launch location permission modal'ının "Maybe later" davranışı için kalıcı flag (`location_prompt_shown`) gerekiyordu. AsyncStorage dependency'si eklemek yerine zaten mevcut SQLite'a basit key-value tablosu eklendi.

**Helpers:** `getAppState(key)`, `setAppState(key, value)`.

#### v7 → v8 *(uygulandı)*

`pending_photos`'a 3 yeni kolon (idempotent `ALTER TABLE ... ADD COLUMN`):
- `site_id TEXT`
- `tags TEXT` (JSON-encoded `string[]`, örn. `'["site"]'`)
- `caption TEXT`

**Sebep:** Madde #5 — project-level fotoğrafların offline queue'ya eklenebilmesi için. Ayrıca `sync-service.ts`'deki *"survey_id'siz foto'ları skip et"* filter'ı (`if (!photo.survey_id) continue;`) kaldırıldı — artık project/site-level foto'lar da sync edilebiliyor.

### Mobile-side ek değişiklikler (schema dışı, ama DB davranışını etkileyen)

- **Race condition fix** (`database.ts:getDatabase`) — paralel çağrılarda `db` variable'ı `initTables()` bitmeden set ediliyordu, "no such table" hatasına yol açıyordu. `initPromise` cache'i ile fix.
- **Sync error logging** (`sync-service.ts`) — releve sub-write try-catch'leri sessizce yutuyordu, retry_count artmıyor / last_error kaydolmuyordu. `recordSurveyRetryFailure` çağrısı eklendi → DevTool Inspect Pending Queue'da gerçek hatalar görünüyor.
- **NetInfo race fix** (`releve-survey-form-screen.tsx:init`) — `useNetworkStore.isOnline` pessimistic default `false`, NetInfo.fetch async resolve oluyor. Form mount race'inde init() cache'e düşüyordu (web'in releve_surveys.location update'leri görünmüyordu). Init başında aktif `NetInfo.fetch()` sondajı eklendi.

---

## Müdahale Özeti Tablosu

| # | Tip | Tablo / Yer | Durum | Sebep |
|---|-----|-------------|-------|-------|
| 1 | Supabase schema | `releve_surveys.survey_id` UNIQUE | ✅ Uygulandı | ON CONFLICT bug |
| 2 | Supabase schema | `photos.site_id` kolonu | ✅ Uygulandı | Multi-site foto ayrımı |
| 3 | Supabase data | `releve_surveys` 4 swap kaydı | ⏳ Beklemede | Mobile pre-fix label hatası |
| 4 | SQLite v7 | `app_state` tablosu | ✅ Uygulandı | Permission prompt flag |
| 5 | SQLite v8 | `pending_photos` 3 kolon | ✅ Uygulandı | Project photo offline queue |
