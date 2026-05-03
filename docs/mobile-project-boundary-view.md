# Mobile — Read-Only Project Boundary View

> **Created:** 2026-05-03
> **Scope:** Mobile yalnızca **görüntüler** — proje oluşturma, veri girişi, boundary çizim/edit YOK. Web'de proje oluşturulduğunda mobile haritada o projenin boundary'sini gösterir.
> **Status:** ✅ Implementation tamamlandı (2026-05-03). Aşağıdaki "Implementation" bölümünde yapılanlar listeli.

---

## Hedef

Web tarafında bir proje oluşturulduğunda (boundary çizimi dahil), mobile uygulamada o projenin haritasında boundary polygon'u render edilsin. Kullanıcı mobile'da sadece okuma yapar — saha çıkışı için lokasyonu görmek, yön bulmak.

**Mobile'da YAPILMAYACAKLAR:**

- Proje oluşturma
- Boundary çizme / düzenleme
- Project metadata düzenleme (name, dates, members vb.)
- Site ekleme / silme

---

## Schema — Boundary nerede

İki olası kaynak var, web ikisini birden senkronize ediyor (DB trigger `sync_project_boundary_from_sites`):

| Tablo           | Kolon          | Tip                       | Açıklama                                            |
| --------------- | -------------- | ------------------------- | --------------------------------------------------- |
| `projects`      | `boundary`     | `geometry(Polygon, 4326)` | Legacy / single-site projeler için ana boundary     |
| `projects`      | `center_point` | `geometry(Point, 4326)`   | Map fly-to / initial center                         |
| `project_sites` | `boundary`     | `geometry(Polygon, 4326)` | Multi-site projelerde her site'ın kendi boundary'si |
| `project_sites` | `center_point` | `geometry(Point, 4326)`   | Site center                                         |

**SRID = 4326 (WGS84)** — Leaflet/MapLibre/Mapbox için doğrudan kullanılabilir. Ekstra reprojection gerekmez.

**Kapsam (2026-05-03):**

- 92 toplam proje
- 76 projenin `project_sites` row'u var
- 69 projenin `projects.boundary` set
- 68 proje her ikisinde de var (trigger sync sayesinde)

**Önerilen okuma stratejisi:**

1. Önce `get_project_sites_with_geojson(project_id)` — multi-site varsa polygon array döner.
2. Boş array dönerse `get_project_with_geojson(project_id).boundary` — legacy single-site fallback.
3. İkisi de null → harita placeholder ("Boundary not set").

---

## Hazır RPC'ler — Doğrudan kullanılabilir

Web bu iki RPC'yi kullanıyor; mobile da aynısını çağırsın. İkisi de **SECURITY DEFINER** — RLS bypass eder ama içeride org/auth kontrolü var.

### 1) `get_project_with_geojson(p_project_id uuid)`

Tek proje + boundary (Feature) döner. Org-membership ile gate'li (`organization_id = get_user_organization_id(auth.uid())`).

**Dönüş şekli (jsonb):**

```jsonc
{
  "id": "0de36f8f-b11c-415d-9ed4-787da0117f60",
  "organization_id": "...",
  "name": "Apro",
  "site_code": "...",
  "boundary": {
    "type": "Feature",
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[-7.959595, 52.200453], [-7.998047, 52.127587], ...]]
    },
    "properties": {}
  },
  "center_point": { "type": "Point", "coordinates": [-7.908783, 52.157702] },
  "buffer_distances": [...],
  "visible_layers": [...]
}
```

**Mobile çağrısı:**

```ts
const { data, error } = await supabase.rpc('get_project_with_geojson', {
  p_project_id: projectId,
})
// data.boundary geçerli GeoJSON Feature → doğrudan map'e ekle
```

### 2) `get_project_sites_with_geojson(p_project_id uuid)`

O proje için tüm site'ların boundary array'i döner (sort_order'a göre).

**Dönüş şekli (jsonb array):**

```jsonc
[
  {
    "id": "...",
    "project_id": "...",
    "site_code": "S1",
    "site_name": "Main Site",
    "sort_order": 0,
    "boundary": { "type": "Polygon", "coordinates": [[...]] },
    "center_point": { "type": "Point", "coordinates": [lng, lat] },
    "grid_reference": "...",
    "county": "...",
    "townland": "...",
    "buffer_distances": [...],
    "visible_layers": [...],
    "attributes": {}
  },
  ...
]
```

> **Not:** Site boundary'leri Feature wrapper'sız, doğrudan `Polygon` geometry. Map'e eklerken `{ type: 'Feature', geometry: site.boundary, properties: {...} }` ile sarmalayabilirsin.

**Mobile çağrısı:**

```ts
const { data: sites } = await supabase.rpc('get_project_sites_with_geojson', {
  p_project_id: projectId,
})
// sites = [] ise legacy fallback'e düş
```

---

## Authentication / RLS

- Mobile zaten Supabase Auth kullanıyor (releve_surveys yazımı için kanıtlı).
- `get_project_with_geojson` SECURITY DEFINER ama içeride `organization_id = get_user_organization_id(auth.uid())` kontrol eder — kullanıcı projenin org'unda değilse `null` döner.
- `get_project_sites_with_geojson` direkt erişim verir (project_id biliyorsan); ama project_id'yi zaten projects RPC'sinden aldığın için indirect olarak gate'li.
- Mobile için listeleme: `supabase.from('projects').select('id, name, status, current_phase, expected_start_date').eq('organization_id', orgId)` — boundary olmadan, hızlı.

---

## Mobile UI Önerisi (read-only)

1. **Project list ekranı** (zaten varsa atla) — kullanıcının org'undaki projeler.
2. **Project detail ekranı:**
   - Üstte proje adı + status badge.
   - Map kart: full-width, proje bounds'una zoom'lu.
     - Tüm site polygon'ları doldurulmuş + outline.
     - Center marker veya site code label opsiyonel.
   - Aşağıda küçük bir info satırı (county, townland, expected dates) — read-only.
3. **Edit / form yok.** Map'e dokun → no-op (max site detail tooltip).

**Map kütüphanesi:** Mobile şu an ne kullanıyorsa devam etsin (MapLibre Native, Mapbox, react-native-maps). Hepsi GeoJSON Polygon'u destekler. Stil için web `lib/config/map-constants.ts`'e bakabilirsin (kalın yeşil outline + yarı şeffaf dolgu standart).

---

## Test Senaryoları

- [ ] Web'de yeni proje oluştur (boundary çiz) → mobile'a geç → harita refresh → boundary görünüyor.
- [ ] Multi-site proje (web'de 2+ site eklenmiş) → mobile'da hepsi farklı polygon olarak render.
- [ ] Legacy proje (sadece `projects.boundary`, hiç site yok) → fallback çalışıyor.
- [ ] Boundary'siz proje (her ikisi de null) → placeholder gösteriliyor, crash yok.
- [ ] Org dışı bir projeye erişim denemesi → null döner, error toast.
- [ ] Offline cache: SQLite'a son fetch edilen GeoJSON yazılmalı; offline açılışta cached boundary gösterilsin (releve cache pattern'i gibi).

---

## Web Tarafından Beklenen

Hiçbir web değişikliği gerekmiyor — RPC'ler mevcut, RLS/auth kurulu. Web tarafı zaten aynı RPC'leri kullanıyor (`lib/supabase/queries/projects.ts:20`, `lib/supabase/queries/project-sites.ts`).

---

## Bağımlılıklar / Sıralama

- **Bağımsız feature** — daha önce yapılan #3/#4/#5 (mobile foto + GPS) ile etkileşmiyor.
- Mobile'da yeni screen + map layer eklemekten ibaret. Sync gerekmiyor (read-only).
- Önerilen sıra: mobile photo PR (#5) bittikten sonra bu feature.

---

## Sorular (mobile takıma) — yanıtlar

1. **Map kütüphanesi:** Mobile'da hiç map kütüphanesi yoktu. `react-native-maps@1.20.1` (Expo SDK 54 uyumlu) eklendi. iOS Apple Maps + Android Google Maps base, GeoJSON Polygon overlay desteği var (`react-native-maps`'in `<Polygon>` component'i `{latitude, longitude}[]` array'i alıyor — `polygonToCoordinates` helper'ı GeoJSON'dan dönüştürüyor).
2. **Project list ekranı:** `src/screens/projects-screen.tsx` zaten vardı. Bu PR'a dahil edilmedi.
3. **Offline cache stratejisi:** SQLite `cached_*` paterni mevcut. Boundary için ayrı tablo açıldı (aşağıda detay).
4. **Map zoom/center:** Bbox-fit. `mapRef.fitToCoordinates(allCoords, { edgePadding })`. `center_point` kullanılmadı — bbox tüm geometriyi sığdırdığı için site farklı boyutlarda olsa bile doğru framing veriyor.

---

## Implementation

> Implementation date: 2026-05-03
> tsc clean. Multi-site (Test apro, 2 sites + boundary) ve single-site (Apro) cihazda doğrulandı.

### Yeni dosyalar

#### `src/lib/project-boundary.ts`

Boundary fetch + parse + GeoJSON helpers'ı içeren tek servis.

- `fetchProjectBoundary(projectId)` — `get_project_with_geojson` ve `get_project_sites_with_geojson` RPC'lerini paralel çağırır. Sonucu `cached_project_boundaries` tablosuna yazar (online'da). Offline'da veya RPC fail olunca cache fallback.
- `flattenBoundaryCoordinates(data)` — Tüm polygon ring'lerini düz `{latitude, longitude}` array'ine çevirir → `fitToCoordinates` için.
- `polygonToCoordinates(polygon)` — Tek polygon'un outer ring'ini `react-native-maps` formatına çevirir → `<Polygon coordinates={...} />` için.
- **NetInfo race guard** — `useNetworkStore.isOnline` pessimistic default `false` olduğu için, store offline diyorsa aktif `NetInfo.fetch()` ile gerçek durum sondajlanıyor.

#### `src/components/project-boundary-preview.tsx`

Project detail ekranındaki ~200px tappable preview kart.
- `MapView` + `UrlTile` (ESRI World Imagery) + `Polygon` overlay'leri.
- Pan/zoom gestures aktif (read-only kart, sadece tek-tap fullscreen'e geçer).
- "Open map" pill'i sağ alt köşede tap target — map gestures'ı boğmuyor.
- `selectedSiteId` değişince `fitToCoordinates` ile o site'a animated zoom.
- `isOnline` değişince re-fetch.
- Empty state: "Boundary not set" — proje hâlâ haritalanmamışsa.

#### `src/screens/project-map-screen.tsx` + `src/app/project/[id]/map.tsx`

Fullscreen map route. Preview ile aynı tile/polygon stack'i + gestures, my-location button, SitePicker overlay (multi-site).

URL `?siteId=...` parametresiyle preview state'i taşınıyor → fullscreen aynı site seçili açılır.

### Değişen dosyalar

#### `src/lib/database.ts` — v10 migration

Mevcut migration zinciri:
- v9: `cached_projects`'e `boundary_geojson` + `sites_geojson` eklendi (orphan kaldı, harmsiz).
- **v10: ayrı tablo:**

```sql
CREATE TABLE IF NOT EXISTS cached_project_boundaries (
  project_id TEXT PRIMARY KEY,
  boundary_geojson TEXT,
  sites_geojson TEXT,
  cached_at TEXT NOT NULL
);
```

Yeni helper'lar: `setCachedProjectBoundary`, `getCachedProjectBoundary`.

**Neden ayrı tablo:** v9'da `cached_projects`'e kolon eklemiştik ama `clearCachedData()` her cacheAllData'da `cached_projects`'i siliyordu → boundary cache'i her seferinde uçuyordu, sonraki offline açılış boş kalıyordu. Ayrı tablo `clearCachedData`'nın dokunmadığı yerde durur, kalıcı.

#### `src/lib/cache-refresh.ts`

Login/refresh sonrası eklenen `warmProjectBoundaries(projectIds, concurrency=8)`:
- Tüm proje boundary'lerini paralel batch'lerde (8'er) çeker.
- Her başarılı çağrı kendi cache'ini yazar (yeni `cached_project_boundaries`).
- Hatalar swallow — bir bozuk proje diğerlerini durdurmuyor.
- `cacheAllData()` ana transaction'ı bittikten sonra çalışıyor; metadata zaten cache'de, boundary fetch UI'ı bloklamadan disk'e iniyor.

Sonuç: kullanıcı login olur olmaz tüm projelerin boundary'leri arka planda warm — sonradan offline'a geçince hepsi çalışır.

#### `src/screens/project-detail-screen.tsx`

- Header altına `<ProjectBoundaryPreview>` eklendi.
- Tap → `router.push(/project/[id]/map?siteId=...)` (effectiveSiteId state'i URL'e geçer).

#### `package.json`

- `react-native-maps@1.20.1` eklendi (Expo SDK 54 uyumlu).

### Tile rendering matrix

ESRI World Imagery (`https://server.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}`, key-free). Tile cache disk'te (`Paths.cache.uri/map-tiles`, 30 gün TTL).

| Durum | iOS | Android |
| --- | --- | --- |
| Online + ESRI cache hit | ESRI satellite | ESRI satellite |
| Online + ESRI loading | Apple satellite (fallback) → ESRI (geldikçe) | Boş → ESRI (geldikçe) |
| Offline + cache hit | ESRI satellite (cache) | ESRI satellite (cache) |
| Offline + cache miss | Apple satellite fallback (mapType="satellite") | Boş gri (no Google Maps key) |

`<UrlTile shouldReplaceMapContent>` iOS'ta UrlTile'ın altındaki Apple Maps base'in render edilmemesini sağlıyor → çift render olmuyor, pan smooth (pan'da "yükleme hissiyatı" şikayetinin çözümü). Apple satellite hâlâ fallback için tetiklenebiliyor (mapType="satellite"). Android'de mapType="none" ile Google Maps base tamamen kapalı.

### SitePicker davranışı (web parite)

- "All Sites" → tüm site'lar yeşil (`colors.primary.DEFAULT` 33% fill, 3px stroke).
- Spesifik site seçili → o yeşil + 3px stroke + dolu fill; diğer site'lar `#94a3b8` 2px stroke + transparent fill ("orada başka site'lar var" hint'i).
- Seçim değişince hem preview hem fullscreen kamera o site'ın polygon'una `fitToCoordinates(animated: true)` ile zoom.

### Bağımlılıklar / kapsam dışı

- `buffer_distances` ve `visible_layers` (RPC payload'ında var ama analiz feature'ları) **kullanılmıyor** — sadece boundary polygon + center marker yok + bbox fit.
- WMS overlay'leri (NPWS, EPA, NLC vb.) bu PR'ın dışında.
- Walkover / multi-point survey location: `surveys` tablosunda location kolonu olmadığı için bu PR'a dahil değil.

### Test sonuçları

Cihazda doğrulananlar:
- ✅ Single-site proje (Apro, Lismore Co. Waterford) — preview + fullscreen + bbox-fit.
- ✅ Multi-site proje (Test apro, 2 site Sligo bölgesi) — "All Sites" hepsi colored, spesifik site seç → primary + faded others, kamera zoom.
- ✅ Online → offline geçişi: cache hit'te tutarlı satellite görünüm.
- ✅ Offline cold start (cache empty) — Apple satellite fallback (iOS), placeholder mesaj (cache hiç warm olmadıysa).
- ✅ Pan/zoom smooth (shouldReplaceMapContent sayesinde tek render katmanı).
- ✅ NetInfo race fix — reload sonrası store offline derken bile RPC çağrılabiliyor.
- ✅ Web'in `getPhotoDisplayUrl` benzeri fix'i değil ama web'in `getProjectWithGeoJson` RPC'leri direkt tüketiliyor.

### Bilinen kısıtlamalar

- Tile cache **bölge bazlı**: kullanıcı ilk kez online açtığı bölgenin tile'ları indirilir. Hiç görmediği projenin bölgesini offline'da açarsa Apple satellite (iOS) veya boş gri (Android) görünür.
- Android için Google Maps API key set edilmedi (`app.json` → `android.config.googleMaps.apiKey`). Android base layer'ı şu an `mapType="none"` olduğu için sorun yaratmıyor; ama eğer ileri bir özellikte Google Maps base'i lazım olursa key eklenmesi gerekir.
- Web'in 4 stil (`streets/satellite/hybrid/topo`) switcher'ı mobile'da yok — sadece satellite (saha kullanımına en uygunu).
