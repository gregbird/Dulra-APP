# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proje
Dulra Mobile — Ekolojik saha çalışmaları için mobil uygulama. Offline veri girişi, fotoğraf, GPS ve Supabase senkronizasyon.

## Tech Stack
- Expo SDK 54 + Expo Router 6, React Native 0.81, React 19, TypeScript (strict)
- expo-sqlite (offline DB; Drizzle dev dep mevcut ama runtime'da raw SQL kullanılıyor)
- NativeWind (Tailwind CSS)
- Zustand (client state)
- @supabase/supabase-js (backend) + expo-secure-store (session storage)
- expo-camera, expo-location, expo-file-system, expo-image-picker
- Moti + react-native-reanimated 4 (animations)
- react-native-webview (watermark canvas)

## Komutlar
```
npx expo start              # Dev server
npx expo start --clear      # Metro cache temizle + dev server
npx expo run:ios            # iOS simulator (native build)
npx expo run:android        # Android emulator (native build)
npm run ios / android / web # package.json shortcut'ları
```
Test / lint script'i yok — TS strict mode ve `tsc --noEmit` tek statik kontrol.

## Gerekli Env
`.env` (EXPO_PUBLIC_ prefix, client'a bundle edilir):
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Klasör Yapısı
- `src/app/` → Sadece route dosyaları (ince, screen import eder). `(auth)/`, `(tabs)/` route group; `project/[id]/*`, `survey/[id]`, `habitat/[habitatId]`, `target-note/[noteId]`, `releve-survey/[id]` dinamik route'lar
- `src/screens/` → Ekran component'leri (iş mantığı burada)
- `src/components/` → Paylaşılan UI (camera-capture, dynamic-field, photo-viewer, site-picker, survey-photos, sync-indicator, watermark-engine, ...)
- `src/lib/` → Supabase client, SQLite (`database.ts`), sync (`sync-service.ts`), network (`network.ts`), survey/releve save, photo/watermark servisleri, `fossitt-codes.json`
- `src/constants/` → `colors.ts`, `releve-data.ts` (RELEVE_SECTIONS)
- `src/types/` → Project, survey, habitat, releve, survey-template tipleri
- `src/hooks/` → (Şu an boş — custom hook'lar buraya)
- `docs/` → Planlama/plan dokümanları, `SYSTEM-DOCS.md` → mevcut Supabase şeması + sorgu paternleri referansı (faz değişikliklerinde güncel tutulmalı)

## Mimari — Kritik Akışlar
Aşağıdaki akışlar tek dosyaya bakarak anlaşılmaz, iş yapmadan önce oku:

**Root layout = data-loading hub.** `src/app/_layout.tsx` her oturum + her `isOnline` geçişinde `cacheAllData()`'yı çalıştırır: role kontrolü yapar (admin/PM tümünü, diğerleri `project_members` + `created_by` birleşimini), `clearCachedData()` sonra projects/surveys/habitats/target_notes/releve_surveys/project_sites/survey_templates'i SQLite'a yazar. Ekranlar kendi başına cache doldurmaz; yazmadan önce mevcut cache ile çakışmadığından emin ol.

**Offline-first yazma.** `saveSurvey()` (`src/lib/survey-save.ts`) önce Supabase'e yazmayı dener; herhangi bir hata → `saveOffline()` → `pending_surveys` + `pending_photos` tablolarına yazar ve `{ offline: true }` döner. UI her zaman "başarılı" state göstermeli (bağlantı varsa remote, yoksa local). Cache (`cached_surveys`) da aynı anda güncellenir — listeler pending'i göremese bile detay ekranı düzgün açılsın.

**Sync tetiklenmesi.** `src/lib/network.ts` NetInfo + AppState dinler; offline→online veya background→active geçişinde kayıtlı `syncCallback` (= `syncPendingData`) çağrılır. `sync-service.ts` tek seferde bir sync çalışır (`syncing` flag), önce `syncSurveys` sonra `syncPhotos`. Sync bayrağı Zustand `useNetworkStore.syncing`'e yansır, `sync-indicator.tsx` bunu gösterir.

**Local ID → Remote ID bridging.** Offline survey'ler `local_${timestamp}_${random}` alır; sync'te Supabase `insert()` → UUID döner, `updatePhotoSurveyIds()` ile `pending_photos.survey_local_id` eşleşen foto'lar `survey_id`'e kopyalanır. Dolayısıyla fotoğraflar survey sync'lenmeden yüklenmez.

**Releve survey özel.** `survey_type === "releve_survey"` hem `surveys` hem `releve_surveys` (+ `releve_species`) tablolarına yazar. Update yolu: `releve_surveys` delete → re-insert (web de aynı). Cache'e alırken `buildFormDataFromReleve()` düz kolonları `RELEVE_SECTIONS` kullanarak form section'larına geri gruplar — web sadece `releve_surveys`'i değiştirdiğinde bile mobil form açılabilsin diye. Yeni releve_surveys kolonu eklersen hem `extractReleveFields` (types/releve) hem `RELEVE_SECTIONS` (constants/releve-data) güncellenmeli.

**SQLite migrations.** `database.ts` versiyonlu (`db_version` tablosu, şu an v5). Şema değişikliği: version'u bir arttır, yeni `if (ver && ver.version === N)` bloğu ekle, `ALTER TABLE` veya eski veriyi koruyarak migrate et. v4 öncesi kodlar tabloları drop ediyor — yeni migration'da veri kaybetmemeye dikkat.

**JSONB formatları (Supabase'de aynen).**
- `surveys.weather = { templateFields: { [fieldKey]: value } }` — **weather değil**, form'un düz flatten edilmiş halidir (legacy isim).
- `surveys.form_data = { [sectionId]: { [fieldKey]: value } }` — `FormData` tipi (`src/types/survey-template.ts`).
- `target_notes.location` / `photos.location` = PostGIS POINT — yazarken `SRID=4326;POINT(lng lat)` string, okurken `{type:"Point",coordinates:[lng,lat]}`.
- Storage path: `{projectId}/{context}/{subPath}/{timestamp}-photo.jpg` (context ∈ `survey|habitat|target-note|general`; survey için subPath = surveyId).

**Watermark boru hattı.** `watermark-engine.tsx` root layout'a mount edilen gizli bir WebView; `src/lib/watermark.ts` canvas'a `postMessage` atar, 15s timeout ile base64 bekler. `photo-service.ts` orijinali + watermark'lı ayrı path'e upload eder; watermark başarısız olursa orijinalle devam eder (fatal değil).

**Supabase client kuralları.** `supabase.ts`: `autoRefreshToken: false` (manuel), `setupTokenRefresh()` AppState+NetInfo'ya göre `startAutoRefresh/stop`. `global.fetch` offline'da gerçek hata yerine 503 Response döndürür ki Supabase SDK auth akışını bozmasın. `LogBox.ignoreLogs` + `console.error` override → bilinen network/refresh token gürültüsü susturulmuş (davranış değiştirirken sadece mesaj eklemeye dikkat).

## Supabase Şema Referansı
`SYSTEM-DOCS.md` tablo listesi, sorgu paternleri ve veri akışları için birincil referans (2026-03-31 snapshot + sonraki `site_id`/`releve_surveys`/`project_sites` değişiklikleri). Yeni sorgu yazmadan önce oraya bak — ekranlarda hangi select fieldlarının kullanıldığı listeli.

Supabase MCP (`.mcp.json`) read-only bağlı; şema sorgulamak için `mcp__supabase__list_tables`, `execute_sql`, `list_migrations` kullanılabilir.

## Kurallar
- `app/` içine iş mantığı koyma, sadece route
- Kebab-case dosya isimleri (`my-screen.tsx`)
- `@/` path alias → `src/` dizinine işaret eder
- `any` type kullanma, `unknown` veya proper interface yaz
- `EXPO_PUBLIC_` prefix → client'ta görünür, hassas key koyma
- `.ios.tsx` / `.android.tsx` → platform-specific dosyalar
- `_layout.tsx` = layout wrapper; `(group)/` = URL'de görünmeyen route group
- Production'da `console.log` kalmasın
- Dosyalar 400 satırı geçmesin, parçala

## Offline-First Prensibi
- Tüm veri önce SQLite'a yazılır (`sync_status: pending`)
- Internet gelince Supabase'e sync edilir (`sync_status: synced`)
- Uygulama internetsiz tam çalışmalı — her ekranda Supabase okuma hatası varsa cache fallback

## UX Kuralları
- Hedef kullanıcı: 40-50 yaş üstü saha ekolojistleri
- Büyük dokunma alanları (minimum 48x48px)
- Okunabilir font boyutu (minimum 16px)
- Sayfa geçişlerinde yumuşak animasyon (Reanimated veya Moti ile)
- Ani geçiş yok, her ekran geçişi fade veya slide ile olmalı
- Sade, temiz UI — karmaşık gesture yok
- Buton ve aksiyonlar açık, anlaşılır olmalı
- Loading state'lerde skeleton veya spinner göster
- Uygulama dili tamamen İngilizce olmalı (UI metinleri, tarihler, saat formatları, içerikler)
