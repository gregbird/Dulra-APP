# Offline Sync Mimarisi

## Genel Yapi

```
React State (UI)  <-->  SQLite (Lokal)  <-->  Supabase (Remote)
```

- **React State**: Formun anlik hali. Sayfa kapatilinca kaybolur.
- **SQLite**: Cihazdaki kalici depolama. `cached_*` tablolari (okuma) + `pending_*` tablolari (yazma kuyrugu).
- **Supabase**: Uzak PostgreSQL. Tum cihazlar ve web arasinda paylasilan tek dogru kaynak.

### Kaynak Dosyalar

| Dosya | Rol |
|-------|-----|
| `src/lib/database.ts` | SQLite sema, cache/pending CRUD |
| `src/lib/sync-service.ts` | Sync dongusu (pending → Supabase) |
| `src/lib/network.ts` | Zustand store + NetInfo listener |
| `src/lib/supabase.ts` | Custom fetch wrapper (503 donusumu) |
| `src/lib/survey-save.ts` | Online/offline save dispatcher |
| `src/lib/releve-save.ts` | Releve-specific islemler + buildFormDataFromReleve |
| `src/app/_layout.tsx` | cacheAllData, network listener, retry |
| `src/screens/releve-survey-form-screen.tsx` | Releve form yukleme (pending > supabase > cache) |
| `src/screens/survey-form-screen.tsx` | Standart form yukleme (supabase > cache) |
| `src/components/sync-indicator.tsx` | Offline/sync UI badge |

---

## SQLite Tablolari

Veritabani: `dulra.db` — Versiyon: **4**

### Pending Tablolari (sync kuyrugu)

**pending_surveys** — Offline kaydedilen survey'ler

| Sutun | Aciklama |
|-------|----------|
| `id` | Lokal ID (`local_TIMESTAMP_RANDOM`) |
| `remote_id` | Supabase surveys.id (yeni ise null) |
| `project_id`, `survey_type`, `surveyor_id`, `survey_date` | Metadata |
| `status` | `in_progress` / `completed` |
| `weather`, `form_data` | JSON — form verisi |
| `sync_status` | `pending` / `synced` |

Dedup: Ayni `remote_id` + `sync_status='pending'` varsa UPDATE yapilir, yeni satir eklenmez.

**pending_photos** — Yuklenmeyi bekleyen fotograflar

| Sutun | Aciklama |
|-------|----------|
| `local_uri` | Cihazdaki dosya yolu |
| `survey_id` | Supabase ID (sync sonrasi atanir) |
| `survey_local_id` | Lokal survey ID (sync oncesi referans) |

### Cache Tablolari (okuma deposu)

| Tablo | Icerik | PK |
|-------|--------|----|
| `cached_surveys` | Survey verileri (form_data JSON dahil) | survey ID |
| `cached_projects` | Proje listesi ve detaylari | proje ID |
| `cached_templates` | Form field tanimlari | survey_type |
| `cached_habitats` | Habitat polygon verileri | habitat ID |
| `cached_target_notes` | Koruma oncelik notlari | note ID |

---

## Cache Mekanizmasi (cacheAllData)

Uygulama acildiginda `_layout.tsx`'deki `cacheAllData()` calisir.

**Kosullar:** Giris yapilmis + online + henuz cache'lenmemis.

**Retry:** Basarisiz olursa `dataCached=false` kalir. Internet geldiginde `isOnline` degisir → effect tekrar calisir → otomatik retry.

### Paralel Fetch (6 query)

```
Promise.allSettled([
  survey_templates,
  projects,          ← rol bazli filtreleme
  surveys,           ← rol bazli filtreleme
  habitat_polygons,
  target_notes,
  releve_surveys     ← form_data rebuild icin
])
```

### Releve Form Data Rebuild

Web uygulamasi `releve_surveys` tablosundaki sutunlari guncelliyor ama `surveys.form_data` JSON'ina dokunmuyor. Bu yuzden cache dogrudan `form_data` alirsa eski veri kalir.

Cozum: `cacheAllData()` releve survey'ler icin `releve_surveys` sutunlarindan form_data'yi yeniden olusturur:

```typescript
if (s.survey_type === "releve_survey") {
  const releve = releveMap.get(s.id);
  if (releve) formData = buildFormDataFromReleve(releve, formData);
}
```

`buildFormDataFromReleve()` flat sutunlari `RELEVE_SECTIONS` yapisina gore section'lara gruplar. Species bilgisini mevcut form_data'dan korur (ayri tabloda oldugu icin).

---

## Form Yukleme Onceligi

### Releve Form (releve-survey-form-screen.tsx)

```
1. pending_surveys kontrol et (sync olmamis edit var mi?)
   └─ Varsa → onu kullan, return

2. Supabase'den releve_surveys oku (web'in guncelledigf kaynak)
   └─ Hata/503 → loadFromCache()'e dus
   └─ Basarili → formu doldur + cache'i guncelle

3. loadFromCache() fallback
   └─ Once pending_surveys kontrol et
   └─ Yoksa cached_surveys'den oku
```

### Standart Survey Form (survey-form-screen.tsx)

```
1. Supabase'den surveys oku
   └─ Hata varsa throw → catch blogu
   └─ Basarili → formu doldur

2. Catch: getCachedSurvey() ile cache'den oku
```

**Onemli fark:** Standart form `if (surveyError) throw surveyError` ile catch'e dusurur. Releve form ise `if (error || !survey) { loadFromCache(); return; }` ile explicit fallback yapar. Sebebi: `supabase.ts`'deki custom fetch wrapper network hatalarini 503 Response olarak donduruyor, exception firlatmiyor. Bu yuzden catch blogu calismaz — explicit kontrol gerekir.

---

## Offline Kaydetme (survey-save.ts)

```
saveSurvey() cagirilir
  |
  Try: Supabase'e yaz
  |  Basarili → cache guncelle → foto yukle → { offline: false }
  |
  Catch (503/hata):
     saveOffline()
       → saveSurveyLocally() (dedup ile pending_surveys'e yaz)
       → cacheSurvey() (mevcut survey ise cache'i de guncelle)
       → savePhotoLocally() (her foto icin)
       → refreshPendingCount()
       → { offline: true }
```

### Foto Yonetimi (2 asamali)

1. Offline save: `pending_photos`'a yaz (`survey_local_id` ile)
2. Survey sync olunca: `updatePhotoSurveyIds()` → `survey_id` atanir
3. Photo sync: Sadece `survey_id` olan fotolar upload edilir

---

## Sync Servisi (sync-service.ts)

### Tetikleyiciler

| Olay | Kaynak |
|------|--------|
| Internet geldi (offline → online) | `NetInfo` listener |
| Uygulama one geldi (online ise) | `AppState` listener |
| Online + pending > 0 | `SyncIndicator` (1sn debounce) |
| Kullanici tap | "tap to sync" butonu |

### syncPendingData() Akisi

```
syncing flag kontrol (esanli calismaz)
  → syncSurveys(): Her pending survey icin
      Mevcut (remote_id var) → UPDATE surveys + releve upsert + cache guncelle
      Yeni (remote_id yok)   → INSERT surveys + releve insert + cache'e ekle
  → syncPhotos(): survey_id olan fotograflari yukle
  → Pending sayisini guncelle
```

### Releve Sync Detayi

Mevcut survey sync'inde `releve_surveys` da guncellenir:
```
upsertReleveSurvey() → eski releve sil + yenisini yaz
insertReleveSpecies() → species'leri yeniden yaz
cacheSurvey() → lokal cache'i guncelle
```

---

## Hata Yonetimi

### 503 Fake Response (supabase.ts)

Custom fetch wrapper network hatalarini yakalayip fake 503 Response dondurur:

```typescript
catch (e) {
  if ("Network request failed")
    → return new Response({ status: 503, body: NETWORK_ERROR })
}
```

Bu sayede Supabase client exception firlatmaz, `{ data: null, error: {...} }` dondurur. Form ekranlarinda explicit `if (error || !data)` kontrolu gerektirir.

### Fallback Zinciri

| Senaryo | Ne Olur |
|---------|---------|
| Online, Supabase basarili | Veriyi goster + cache'i guncelle |
| Online, Supabase 503 | `loadFromCache()` ile cache'den oku |
| Offline | `init()` catch blogu → `loadFromCache()` |
| Cache bos, pending var | `getPendingSurveyByRemoteId()` ile pending'den oku |
| Cache bos, pending yok | Bos form gosterilir |

### Bilinen Kisitlamalar

- `clearCachedData()` tum cache tablolarini siler. Kismi fetch basarisi durumunda bazi tablolar bos kalabilir (ornegin surveys basarili ama habitats basarisiz ise habitat cache'i silinir ama yenisi yazilmaz).
- Web'de yapilan species degisiklikleri `releve_species` tablosunda olur. `buildFormDataFromReleve()` species'i mevcut `form_data`'dan korur ama web'deki species degisikliklerini almaz (form online acildiginda Supabase'den cekilir).

---

## Veri Akis Ozeti

```
              ONLINE SAVE                    OFFLINE SAVE
              ----------                     ------------
User → saveSurvey()                  User → saveSurvey() catch
         |                                      |
   surveys INSERT/UPDATE              saveSurveyLocally()
   releve_surveys upsert                  pending_surveys
   cacheSurvey()                         cacheSurvey()
   uploadPhoto()                        savePhotoLocally()

              SYNC (internet gelince)
              -------------------------
   pending_surveys → surveys INSERT/UPDATE
                   → releve_surveys upsert
                   → cacheSurvey()
   pending_photos  → uploadPhoto()

              FORM YUKLEME
              ------------
   1. getPendingSurveyByRemoteId()   ← sync olmamis edit
   2. supabase.from("releve_surveys")  ← online (web'in kaynagi)
   3. getCachedSurvey()              ← offline fallback
```
