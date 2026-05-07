# Habitats — Mobil Read-Only Entegrasyon (Implementasyon Notları)

**Tarih:** 2026-05-08
**Durum:** İlk implementasyon tamam, performans fix uygulandı, **henüz commit edilmedi**.
**Yarın devam:** kalan QA + performans doğrulaması + (gerekirse) viewport-based polygon filtering.

Brief / kararlar için → `docs/habitats-mobile-integration.md` (web ekibinden gelen).

---

## 1. Yapılanlar (dosya bazında)

### Veri katmanı
- **`src/types/habitat.ts`**
  - `HabitatPolygon` tipine eklenen alanlar: `boundary` (Polygon | MultiPolygon), `survey_id`, `include_in_report`, `created_at`, `updated_at`.
  - `HabitatGeometry` union (Polygon | MultiPolygon).
  - `normaliseFossittCode()` — `"—" / "" / "-"` → `null` (web placeholder davranışı).
  - `UNCLASSIFIED_HABITAT_COLOR = "#9CA3AF"` (gri).

- **`src/lib/habitats.ts` (yeni)**
  - `fetchProjectHabitats(projectId, siteId?)` — RPC `get_project_habitats` çağırır.
  - NetInfo race guard (designated-sites pattern), 30s `AbortController` timeout, cache fallback.
  - Online site-wide fetch boundary cache'i de yazar (`siteId` verilmişse yazmaz — subset olduğu için).
  - `habitatPolygonPieces(geometry)` — Polygon/MultiPolygon → `{outer, holes}[]` (designated-sites helper'ının ikizi).
  - `habitatLabelAnchor(pieces)` — basit centroid (label rendering için, şu an kullanılmıyor).
  - `darkenHex(hex, factor)` — stroke için web parity (`darkenHex(color, 0.65)`).

- **`src/lib/database.ts`** (v12 → **v13**)
  - Yeni tablo: `cached_habitat_boundaries (id, project_id, boundary_geojson, cached_at)` + `idx_cached_habitat_boundaries_project`.
  - **Önemli:** `cached_habitat_boundaries`, `clearCachedData()` tarafından silinmez (designated/project-boundary pattern). Metadata refresh geometry'yi yok etmesin diye.
  - `cached_habitats`'a iki yeni nullable kolon: `survey_id`, `include_in_report INTEGER` (`tryAddColumn` ile idempotent).
  - `cacheHabitat()` parametre listesi genişletildi → `surveyId`, `includeInReport`.
  - `getCachedHabitats()` ve `getCachedHabitat()` artık `LEFT JOIN cached_habitat_boundaries` ile boundary döner.
  - Yeni helper: `setCachedHabitatBoundaries(projectId, rows)` — atomic project-wide replace (transaction içinde DELETE + bulk INSERT).
  - `currentVer < 12` bloğu `< 13`'e güncellendi.

- **`src/lib/cache-refresh.ts`**
  - Habitat metadata select'ine `survey_id, include_in_report` eklendi.
  - `cacheHabitat` çağrısına yeni alanlar geçildi.
  - Yorum bloğu eklendi: habitat geometry **lazy-load** (designated-sites ile aynı strateji — `cacheAllData` metadata, `fetchProjectHabitats` map açılınca geometry).

### Harita
- **`src/lib/map-layers.ts`** — `habitatsEnabled` pref + `saveHabitatsPref()` + `loadMapLayerPrefs` döndürdüğü tipi genişletildi.

- **`src/components/map-layers-control.tsx`**
  - Yeni "Survey Layers" başlığı + Habitats toggle.
  - Habitats props **opsiyonel** (`habitatsEnabled?`, `onToggleHabitats?`) — `project-boundary-preview.tsx` bu props'u geçmiyor, dolayısıyla preview'da Survey Layers bölümü hiç render olmuyor.
  - Active dot artık townlands VEYA habitats açıksa yanıyor.

- **`src/components/habitat-map-modal.tsx` (yeni)**
  - Map polygon tap'ında açılan bottom sheet. DesignatedDetailModal pattern'i.
  - İçerik: kod badge (FOSSITT renk), area, isim, condition/evaluation/EU annex tag'leri, notes (truncate 4 satır).
  - "Close" + "View Details" butonu. View Details → `router.push('/habitat/${id}')`.

- **`src/screens/project-map-screen.tsx`**
  - `Z_HABITAT = 25` z-index (designated 20 < habitat 25 < buffer 30).
  - State: `habitats`, `habitatsEnabled`, `selectedHabitat`.
  - `useEffect` habitat fetch (project bazlı, lazy, isOnline değişiminde re-fetch).
  - `visibleHabitats` (useMemo) — site filter.
  - **`habitatPolygonElements` ve `designatedPolygonElements` — useMemo'lu JSX array** (perf fix, aşağı bak).
  - Yeni query param desteği: `focusHabitatId` → habitats toggle force-on + fly-to + bottom sheet auto-open.
  - `MapLayersControl`'a `habitatsEnabled` + `onToggleHabitats` prop geçişi.
  - `<HabitatMapModal>` mount.
  - `useRouter`, `useLocalSearchParams` `focusHabitatId` okuyor.

### Liste / Detay
- **`src/components/habitat-list.tsx`**
  - `null` fossitt_code → "Unclassified" gri rozet.
  - İsim fallback: kod varsa "Unknown Habitat", yoksa "Unmapped polygon".
  - `getFossittColor` çağrısı `hasCode` branch'ı ile guard.

- **`src/screens/habitats-screen.tsx`**
  - Doğrudan `from('habitat_polygons').select(...)` kaldırıldı.
  - Tek kaynak: `fetchProjectHabitats(id, siteId ?? null)`.
  - Pull-to-refresh: `cacheAllData()` + `fetchHabitats()`.

- **`src/screens/habitat-detail-screen.tsx`**
  - **Foto kaynağı değişti** — artık `photos` tablosundan `habitat_polygon_id` FK ile sorgu.
  - URL: `watermarked_path ?? storage_path` → `getPublicUrl('project-photos')` (survey-photos pattern parity).
  - "Show on Map" butonu — `router.push('/project/${projectId}/map?focusHabitatId=...&siteId=...')`.
  - Cache fallback `include_in_report` (INTEGER) → boolean coercion.
  - Unclassified rendering: hasCode false ise gri badge + "Unmapped polygon" başlık.

### Memory
- **`memory/project_habitat_polygons_writepath.md`** — yazma path'i ileride açılırsa idempotency-key + photos tablosu FK notu.
- `MEMORY.md`'ye pointer eklendi.

---

## 2. Performans Fix (geç açılma sorunu)

**Sorun:** Toggle açıp polygon'a tıklayınca bottom sheet ~30s sonra açılıyordu.

**Sebep:** `selectedHabitat` setState → `ProjectMapScreen` re-render → inline `visibleHabitats.map(h => <Polygon ... />)` her renderda **yeni JSX array + yeni onPress closure** üretiyordu. Cadastral-import outlier projelerde MultiPolygon decompose sonrası 600+ `<Polygon>` element olabiliyor — reconciliation maliyeti JS thread'i kilitliyordu.

**Çözüm:** Polygon JSX'leri `useMemo` ile cache'lendi:

```ts
const habitatPolygonElements = useMemo(() => {
  // visibleHabitats × habitatPolygonPieces × <Polygon> map
  return out;
}, [visibleHabitats, baseMap]);

const designatedPolygonElements = useMemo(() => { /* ... */ }, [designated, baseMap]);
```

JSX'te artık `{habitatPolygonElements}` ve `{designatedPolygonElements}` direkt yerleştiriliyor. Tap → setState → memo deps değişmediği için aynı array reference döner → polygon layer'ı reconcile edilmez, sadece modal render olur.

`setSelectedHabitat` / `setSelectedDesignated` setter'ları stable olduğu için memo içinde closure'a kapatılmaları güvenli.

**Beklenen davranış:**
- İlk toggle ON: polygon'lar bir kez mount edilir (yine yavaş olabilir, native overlay sayısına bağlı — bu fix kapsamında değil).
- Polygon tap: bottom sheet anında (~<500ms).
- Map pan/zoom: hâlâ native overlay sayısına bağlı yavaş olabilir.

---

## 3. Test Adımları

### Önkoşullar
```bash
npx expo start --clear
```
Cache temizleme şart — DB v13 migration'ı tetiklensin (`cached_habitat_boundaries` tablosu + `survey_id` / `include_in_report` ALTER).

### Senaryo 1 — Online map layer
1. Bir projeye gir → "Project Map" aç
2. Sol-üst Layers FAB → panel → **Survey Layers → Habitats** toggle ON
3. FOSSITT renkli polygon'lar render olmalı (%35 fill + koyu stroke)
4. Polygon'a tap → bottom sheet anında açılmalı (perf fix sonrası)
5. Sheet → "View Details" → habitat detail screen

### Senaryo 2 — Liste & detail
1. Project detail → "Habitats" sekmesi → liste
2. Item tap → detail screen
3. Fotoğraflar `photos` tablosundan (varsa watermark'lı versiyon)
4. Detail altındaki "Show on Map" → map ekranı, habitats layer otomatik on, polygon'a fly-to + sheet açık

### Senaryo 3 — Unclassified
- DB'de `fossitt_code='—'` varsa: liste + harita gri "Unclassified" badge.

### Senaryo 4 — Multi-site
- Multi-site projede üst SitePicker'dan site seç → polygon'lar filtrelenir.
- `site_id IS NULL` olanlar her durumda görünür.

### Senaryo 5 — Offline
1. Önce online'da uygulamayı bir kere aç (cacheAllData metadata yazar) + map'i bir kez aç (boundary cache yazar)
2. Uçak modu → app yeniden aç
3. Project map → habitats SQLite cache'inden render olmalı
4. Habitats sekmesi de offline çalışmalı

### Senaryo 6 — Pull-to-refresh
- Habitats sekmesi → aşağı çek → `cacheAllData` + RPC re-fetch → güncel veri.

### TypeScript doğrulama
```bash
npx tsc --noEmit
```
Şu an exit 0, temiz.

---

## 4. Bilinen / İzlenmesi Gereken Konular

1. **600+ polygon outlier projeler** — initial toggle-on mount yine yavaş olabilir. Tap fix'lendi, mount değil. Gerekirse:
   - Viewport-based filtering (sadece görünen bbox'taki polygon'lar)
   - Zoom-based hiding (zoom < N → polygon'ları gizle)
   - **Yarın test sonucuna göre karar verilecek.**

2. **Viewer rolü RLS** — web smoke-test edemedi (auth-context yok MCP'de). Mobil viewer login'le habitats görünür mü, ilk testte doğrula.

3. **`habitat_polygons.photos text[]`** — legacy, artık display'de kullanmıyoruz. Type'tan silmedik (geriye uyumluluk için kalsın, photos tablosu kanonik).

4. **`include_in_report`** — okuyoruz ama UI'da hiç filtrelemiyoruz (web brief'i: hepsini göster). İleride toggle eklenebilir.

5. **Boundary payload boyutu** — typical 200KB-2MB, outlier 11MB. İlk fetch'te skeleton yok şu an, RPC normal loader içinde. 4G'de 5-10s normal. Spec'te kabul edildi.

6. **`focusFiredRef`** — sadece bir kere fly-to atar. Aynı id ile tekrar geldiğinde re-fire etmez. Bu kasıtlı; pan'den sonra kullanıcıyı geri zorlamak istemiyoruz.

---

## 5. Yarın Yapılacaklar (Önerilen Sıra)

1. **Performans testini doğrula** — gerçek cihazda (özellikle Android low-end) tap response'u <500ms mı? Map pan/zoom kabul edilebilir mi?
2. **Polygon sayısı log'u** — geçici olarak `fetchProjectHabitats` dönüşünde `console.log(rows.length)` ekleyip outlier projeyi tespit et.
3. **Eğer mount yavaş kalırsa** — viewport-based filtering ekle (`onRegionChangeComplete` ile bbox filter).
4. **Viewer rolü smoke test** — viewer hesapla bir projeye habitats görünüyor mu?
5. **Edge case'ler:**
   - Boundary `null` olan habitat (RPC'den gelirse) → liste'de görünür, haritada görünmez (beklenen).
   - Çok sıkı zoom-out'ta polygon görünürlüğü.
   - Pull-to-refresh sırasında race condition (aktif fetch varken refresh).
6. **Commit** — temiz çalıştığını doğruladıktan sonra:
   ```
   feat(habitats): read-only habitat polygon layer + tab integration
   ```

---

## 6. Değişen Dosya Listesi (commit hazırlığı için)

```
src/types/habitat.ts                        (genişletildi)
src/lib/habitats.ts                         (yeni)
src/lib/database.ts                         (v13 migration + boundary table + helpers)
src/lib/cache-refresh.ts                    (select + cacheHabitat çağrısı genişledi + yorum)
src/lib/map-layers.ts                       (habitatsEnabled pref)
src/components/map-layers-control.tsx       (Survey Layers section)
src/components/habitat-map-modal.tsx        (yeni)
src/screens/project-map-screen.tsx          (habitat layer + perf fix + focus param)
src/components/habitat-list.tsx             (Unclassified rendering)
src/screens/habitats-screen.tsx             (RPC switch)
src/screens/habitat-detail-screen.tsx      (photos table + Show on Map)
docs/habitats-mobile-implementation.md      (bu dosya)
memory/project_habitat_polygons_writepath.md (yeni)
memory/MEMORY.md                            (pointer eklendi)
```
