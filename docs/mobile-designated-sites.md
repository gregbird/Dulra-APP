# Mobile — Designated Sites Read-Only Overlay

> **Created:** 2026-05-04
> **Scope:** Mobil yalnızca **görüntüler**. Web Step 2 → Data Gathering → Designated Sites substep'inde "Save" denilen NPWS site'ları (SAC/SPA/NHA/pNHA) proje haritasında polygon olarak render edilir. NPWS'den anlık fetch yok.
> **Status:** Implementation tamamlandı (mobil); migration apply edilmeli (aşağıda).

---

## Veri kaynağı

`desk_research_findings` tablosu (boundary ile aynı Supabase). Filtre:

```
project_id = :projectId
AND data_type = 'designated_site'
AND is_saved = true
AND location IS NOT NULL
```

Tipli kolonlar zaten çıkarılmış (`raw_data` parse'a gerek yok): `id`, `title`, `content`, `site_code`, `site_type`, `location` (PostGIS geometry), `distance_from_boundary_km`, `ai_summary`, `site_id`.

### Veri büyüklüğü

| Geom tipi    | Adet | Avg vertex | Max vertex | Avg GeoJSON |
|--------------|------|------------|------------|-------------|
| Polygon      | 65   | 9,692      | 105,372    | 263 KB      |
| MultiPolygon | 54   | 38,878     | 313,511    | 1,061 KB    |

Worst proje: 8.8 MB raw GeoJSON. `ST_SimplifyPreserveTopology(location, 0.0001)` (~11 m, GPS hata payı altında) → **350 KB** (25× azalma). Bu nedenle mobil ham geometri çekmez, server-side simplification yapan bir RPC üzerinden okur.

---

## RPC — `get_designated_sites_geojson(p_project_id, p_tolerance)`

`get_project_with_geojson` ile aynı pattern: SECURITY DEFINER, org-gated, `ST_AsGeoJSON(...)::jsonb` payload. MultiPolygon olduğu gibi döner (mobil tarafında client-side flatten); hole'lar inner ring olarak korunur (mobil `<Polygon holes={...}>` ile çizer).

```sql
CREATE OR REPLACE FUNCTION public.get_designated_sites_geojson(
  p_project_id uuid,
  p_tolerance double precision DEFAULT 0.0001
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM projects
    WHERE id = p_project_id
      AND organization_id = get_user_organization_id(auth.uid())
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(payload ORDER BY area DESC), '[]'::jsonb)
  INTO result
  FROM (
    SELECT
      ST_Area(drf.location) AS area,
      jsonb_build_object(
        'id', drf.id,
        'title', drf.title,
        'content', drf.content,
        'site_code', drf.site_code,
        'site_type', drf.site_type,
        'distance_from_boundary_km', drf.distance_from_boundary_km,
        'ai_summary', drf.ai_summary,
        'site_id', drf.site_id,
        'geometry', ST_AsGeoJSON(
          ST_SimplifyPreserveTopology(drf.location, p_tolerance)
        )::jsonb
      ) AS payload
    FROM desk_research_findings drf
    WHERE drf.project_id = p_project_id
      AND drf.data_type = 'designated_site'
      AND drf.is_saved = true
      AND drf.location IS NOT NULL
  ) sub;

  RETURN result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_designated_sites_geojson(uuid, double precision) TO authenticated;
```

**Dönüş şekli:**

```jsonc
[
  {
    "id": "uuid",
    "title": "Lower River Shannon SAC",
    "content": "...",
    "site_code": "002165",
    "site_type": "SAC",
    "distance_from_boundary_km": 0,
    "ai_summary": "...",
    "site_id": null,
    "geometry": { "type": "Polygon" | "MultiPolygon", "coordinates": [...] }
  }
]
```

**Apply etmek:** Web migration repo'sundan ayrı bir migration dosyasına yaz (örn. `supabase/migrations/20260504_add_get_designated_sites_geojson.sql`) veya Supabase dashboard SQL editor'dan apply et. RLS değişikliği yok — sadece yeni RPC.

**Dry-run doğrulaması:** 10 site'lık bir projede payload 96 KB (raw'a göre ~25×), sıralama büyükten küçüğe (küçük poligonlar tap target için üstte), Polygon/MultiPolygon karışık olduğu gibi geliyor.

---

## Renkler

| Tip  | Açılım                         | Renk      |
|------|--------------------------------|-----------|
| SAC  | Special Area of Conservation   | `#22c55e` |
| SPA  | Special Protection Area        | `#3b82f6` |
| NHA  | Natural Heritage Area          | `#8b5cf6` |
| pNHA | Proposed Natural Heritage Area | `#a855f7` |

Fill: `${color}40` (~25% opacity). Stroke: solid color, 2px width.

---

## Mobile mimarisi

### Yeni dosyalar

#### `src/lib/designated-sites.ts`

- `fetchDesignatedSites(projectId)` — RPC çağırır, NetInfo race guard (boundary ile aynı pattern), online'da `cached_designated_sites`'e yazar, offline'da/hata durumunda cache fallback.
- `polygonsForRender(geometry)` — `Polygon` veya `MultiPolygon`'u `<Polygon>` çizimleri için `{ outer, holes }` array'ine düzleştirir. Outer = tek ring, holes = inner ring array (Polygon hole'ları korunur).
- `flattenDesignatedCoordinates(sites)` — Tüm noktaları viewport bbox için tek `{lat, lng}[]` array'ine yığar (ilk yük sırasında designated layer'ı görünür alanda kapsamak için, opsiyonel).
- `DESIGNATED_SITE_COLORS` ve `getDesignatedSiteDisplayName(site_type)` helper'ları.
- `${site_code}-${site_type}` cache key (aynı kod farklı tipte tekrar edebilir).

#### `cached_designated_sites` (SQLite v11)

```sql
CREATE TABLE IF NOT EXISTS cached_designated_sites (
  project_id TEXT PRIMARY KEY,
  sites_geojson TEXT,
  cached_at TEXT NOT NULL
);
```

`clearCachedData()` bu tabloya **dokunmaz** (boundary'deki bug'ı tekrarlamamak için). Helper'lar: `setCachedDesignatedSites`, `getCachedDesignatedSites`.

#### `cache-refresh.ts` — `warmDesignatedSites(projectIds, concurrency=8)`

`warmProjectBoundaries`'ın yanında çalışır; ana transaction bittikten sonra paralel batch'lerde tüm projelerin designated payload'larını cache'ler.

### Render

- `project-boundary-preview.tsx` ve `project-map-screen.tsx` — boundary çizilen `<MapView>`'a designated overlay eklenir.
- Designated polygon'lar boundary'nin **üstünde** çizilir (zIndex / array order — boundary önce, designated sonra).
- `<Polygon>` her finding için `polygonsForRender` çıktısı kadar render edilir (Polygon = 1 component, MultiPolygon = N component, hepsinde `holes` prop set edilir).
- `key`: `${site_code}-${site_type}-${partIndex}` (aynı code+type aynı finding'in farklı parçaları olarak görünmesin diye partIndex eklenir).

### Site picker davranışı

Designated layer **site picker'dan etkilenmez**. Boundary tarafı "All Sites" / "Site X" seçimine göre renk değişiyor; designated her zaman tüm proje için renkli render edilir.

**Gerekçe:** veride `site_id` yalnızca %8 dolu (136'da 11 satır, 4 proje). Filtre uygularsak spesifik site seçince hemen tüm designated polygon'lar kaybolur — bug görünümü yapar. İleride veri zenginleşirse opt-in toggle eklenir.

### Tap → Modal

`<Polygon onPress>` ile bir designated site'a dokunma → RN built-in `<Modal animationType="slide" transparent presentationStyle="overFullScreen">` açılır. İçerik:

- Title (NPWS site adı)
- Site type display name + colored badge
- Distance from project boundary (varsa)
- AI summary varsa onu, yoksa `content`'i göster

@gorhom/bottom-sheet eklenmedi — tek özet kart için orantısız; ileride 3+ ekranda paylaşılırsa o zaman.

### Önemli edge case'ler

- **`location IS NULL`**: RPC zaten filtreliyor; client'ta tekrar guard yok.
- **MultiPolygon**: `coordinates.flatMap(part => ...)` ile her parça ayrı `<Polygon>`. Web'in Leaflet `L.geoJSON`'u da aynı şeyi yapıyor (path başına bir SVG path).
- **Hole'lar**: `polygon.coordinates.slice(1)` inner ring'leri verir → `holes` prop'una geçer. 26/119 (%22) Polygon'da hole var.
- **Aynı site_code farklı tipte**: cache key `${site_code}-${site_type}` ile çakışmıyor.
- **Empty state**: kayıtlı designated yoksa overlay yok, boundary tek başına render. Placeholder yok (boundary placeholder'ı zaten "Boundary not set" mesajı verir).

---

## Bağımlılıklar / kapsam dışı

- `desk_research_findings.notes`, `relevance_level`, `is_invasive`, `red_list_status` gibi alanlar bu PR'da kullanılmıyor (designated_site row'larında genelde dolu değil zaten).
- Species findings (`data_type = 'species'`) bu PR'ın dışında — ileride ayrı layer.
- Web'in NPWS bbox-fetch'i (`npws-layer-overlay.tsx`) dolaylı olarak alakasız: o ham NPWS API'sinden anlık çekiyor; mobil sadece "saved" findings'i gösteriyor.

---

## Test senaryoları

- [ ] Saved designated_site içeren proje → polygon'lar site_type rengiyle çizili, boundary üstünde.
- [ ] Hiç saved designated yok → overlay görünmüyor, boundary tek başına.
- [ ] MultiPolygon site → tüm parçalar render.
- [ ] Hole'lu Polygon → iç delik görünüyor.
- [ ] Aynı `site_code` farklı tipte iki kayıt → ikisi de görünüyor (key collision yok).
- [ ] Tap → Modal açılıyor, title + type + distance + content/ai_summary doğru.
- [ ] Site picker "Site X" seçildiğinde designated layer aynı kalıyor.
- [ ] Online → offline geçiş → cache'den render ediliyor.
- [ ] Login sonrası `warmDesignatedSites` 92 projeyi 8'er batch'lerde indiriyor, cache doluyor.
