# Mobile — Read-Only Project Boundary View

> **Created:** 2026-05-03
> **Scope:** Mobile yalnızca **görüntüler** — proje oluşturma, veri girişi, boundary çizim/edit YOK. Web'de proje oluşturulduğunda mobile haritada o projenin boundary'sini gösterir.
> **Status:** ⏸ Mobile takıma iletilmek üzere

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

## Sorular (mobile takıma)

1. Mobile şu an hangi map kütüphanesini kullanıyor? GeoJSON desteği nasıl? (Doğrulama için.)
2. Project list ekranı zaten var mı? Yoksa onu da bu PR'a dahil edelim mi?
3. Offline cache stratejisi var mı (releve gibi `cached_*` tabloları)? Boundary için de aynı pattern.
4. Map zoom/center default'u — projenin `center_point`'i mu yoksa boundary bbox'a fit mi?
