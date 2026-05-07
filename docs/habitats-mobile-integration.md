# Habitats — Mobil Read-Only Entegrasyon Kapsamı

Mobil Claude Code'a aynen verilebilecek brief. Web tarafı habitat verisini yazıyor; mobil sadece okuyup haritada/listede gösterecek.

---

## 1. Amaç

Mevcut mobil projede **designated sites + layers + boundary** zaten haritada okunabiliyor. Aynı pattern ile **Habitat Polygons** katmanı + **Habitats sekmesi/tab'ı** ekleyeceğiz. Yazma yok, sadece görüntüleme.

## 2. Veri Kaynağı

Ortak Supabase, tablo: `public.habitat_polygons` (RLS açık).

| Kolon                                 | Tip                                       | Açıklama                                                               |
| ------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `id`                                  | uuid                                      | PK                                                                     |
| `project_id`                          | uuid                                      | FK → `projects.id` — **filtreleme anahtarı**                           |
| `site_id`                             | uuid?                                     | FK → `project_sites.id` — multi-site projelerde alt saha               |
| `survey_id`                           | uuid?                                     | FK → `surveys.id` — hangi field saha gezisinden                        |
| `fossitt_code`                        | text                                      | Örn. `GA1`, `WL1` — **harita label'ı**                                 |
| `fossitt_name`                        | text                                      | Tam isim (Improved agricultural grassland vb.)                         |
| `area_hectares`                       | float8?                                   |                                                                        |
| `condition`                           | text?                                     |                                                                        |
| `evaluation`                          | text?                                     | enum: `international` / `national` / `county` / `high_local` / `local` |
| `eu_annex_code`                       | text?                                     | Annex I habitat kodu                                                   |
| `survey_method`, `notes`              | text?                                     |                                                                        |
| `listed_species`, `threats`, `photos` | text[]                                    | `photos` sadece path string'leri                                       |
| `include_in_report`                   | bool                                      | Mobil'de filtre olarak kullanılabilir                                  |
| `boundary`                            | **PostGIS geometry** (Polygon, EPSG:4326) | DİKKAT — aşağı bak                                                     |
| `created_at` / `updated_at`           | timestamptz                               |                                                                        |

İlgili: `public.photos` tablosunda `habitat_polygon_id` FK var → habitat fotoğraflarını oradan çek.

## 3. Geometry Sorunu — **RPC Şart**

`boundary` kolonu PostGIS `geometry`. supabase-js ile `select('boundary')` yaparsa WKB hex döner, mobile parse edemez. **Çözüm:** server-side `ST_AsGeoJSON` ile RPC kur.

Migration (web tarafından eklenecek, mobil sadece çağıracak):

```sql
create or replace function public.get_project_habitats(p_project_id uuid, p_site_id uuid default null)
returns table (
  id uuid,
  project_id uuid,
  site_id uuid,
  survey_id uuid,
  fossitt_code text,
  fossitt_name text,
  area_hectares double precision,
  condition text,
  evaluation text,
  eu_annex_code text,
  survey_method text,
  notes text,
  listed_species text[],
  threats text[],
  photos text[],
  include_in_report boolean,
  boundary jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker  -- RLS uygulansın
as $$
  select
    h.id, h.project_id, h.site_id, h.survey_id,
    h.fossitt_code, h.fossitt_name, h.area_hectares, h.condition,
    h.evaluation, h.eu_annex_code, h.survey_method, h.notes,
    h.listed_species, h.threats, h.photos, h.include_in_report,
    st_asgeojson(h.boundary)::jsonb as boundary,
    h.created_at, h.updated_at
  from public.habitat_polygons h
  where h.project_id = p_project_id
    and (p_site_id is null or h.site_id = p_site_id)
  order by h.created_at desc;
$$;

grant execute on function public.get_project_habitats(uuid, uuid) to authenticated;
```

`security invoker` sayesinde mevcut RLS politikaları aynen uygulanır — kullanıcı `project_members` üzerinden erişimi varsa görür.

## 4. Mobil Tarafı — Veri Katmanı

```ts
// services/habitats.ts (örnek)
import { supabase } from '@/lib/supabase'

export type Habitat = {
  id: string
  project_id: string
  site_id: string | null
  survey_id: string | null
  fossitt_code: string
  fossitt_name: string
  area_hectares: number | null
  condition: string | null
  evaluation: 'international' | 'national' | 'county' | 'high_local' | 'local' | null
  eu_annex_code: string | null
  survey_method: string | null
  notes: string | null
  listed_species: string[] | null
  threats: string[] | null
  photos: string[] | null
  include_in_report: boolean
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon
  created_at: string
  updated_at: string
}

export async function fetchProjectHabitats(projectId: string, siteId?: string) {
  const { data, error } = await supabase.rpc('get_project_habitats', {
    p_project_id: projectId,
    p_site_id: siteId ?? null,
  })
  if (error) throw error
  return (data ?? []) as Habitat[]
}
```

RLS koşulu: kullanıcı login olmuş ve `project_members` tablosunda projeye ekli olmalı (her rol okuyabilir, viewer dahil).

## 5. Harita Katmanı — Mevcut Layer Sistemine Bağlama

Mobilde halihazırda Designated Sites + Boundary katmanları toggle ile açılıp kapanıyorsa, **Habitats** üçüncü bir toggle olarak eklensin.

Render kuralları (web ile uyumlu olsun diye):

- **Polygon fill:** FOSSITT koduna göre renk. İki palette seçeneği var:
  1. **Heritage Council palette** (default) — rapor renklerine uyar.
  2. **NLC native palette** — daha doğal renkler.

  Web'de `lib/external-apis/osi.ts` içinde `NLC_LEVEL1_COLORS` + `NLC_NATIVE_LEVEL2_COLORS` map'leri var; mobile'a kopyalanabilir. Ya da en sade hali: tek bir `fossittColorByPrefix` map'i kur (`G` = grassland yeşili, `W` = woodland koyu yeşil, `F` = freshwater mavi, vs.) — read-only viewer için yeterli.

- **Stroke:** fill renginin %35 koyusu (web'de `darkenHex(color, 0.65)` yapıyor).
- **Fill opacity:** 0.35 default, seçili ise 0.6.
- **Label:** polygon merkezine `fossitt_code` (sadece kod, full name değil). Web'de `is_label_anchor` flag'i ile en büyük parsel etiketleniyor — mobile için her polygon'a koyabilirsin (satır sayısı az), gerekirse ileride zoom-based filtre eklersin.
- **Tap/popup:** `fossitt_name`, `fossitt_code`, `area_hectares`, `condition`, `evaluation`.

## 6. UI — Habitats Tab

Mevcut Designated Sites tab pattern'ini taklit et:

**Liste görünümü:**

- Üst: site filter chip'leri (proje multi-site ise) + arama (`fossitt_code` veya `fossitt_name`).
- Liste item: renk dot (FOSSITT rengi) · `fossitt_code` · `fossitt_name` · sağda `area_hectares ha`.
- Tap → harita o polygon'a fly-to + popup açılır.

**Detay sheet (tap'ta):**

- Başlık: `fossitt_name`
- Sub: `fossitt_code` · `area_hectares ha`
- Field'lar: condition, evaluation badge, eu_annex_code, survey_method, threats list, listed_species list, notes.
- Foto galerisi: `photos` array'inde Supabase Storage path'leri varsa `supabase.storage.from('photos').getPublicUrl(...)` ile.

**Boş durum:** "Bu proje için henüz habitat polygonu kaydedilmemiş." Field saha gezisi tamamlanmadan habitat olmayabilir.

## 7. Filter & State

- Mobil zaten "current project" context'i tutuyor olmalı — onu kullan.
- Site seçimi varsa `siteId` parametresi gönder, yoksa tüm proje (RPC `null` kabul ediyor).
- Cache: TanStack Query / SWR — `['habitats', projectId, siteId]` key'i. **Stale time 5 dk yeter**, yazma yok.

## 8. Yapılacaklar Listesi (mobil Claude için)

1. RPC'nin Supabase'e deploy edildiğini doğrula (`select get_project_habitats(...)` ile test et).
2. `services/habitats.ts` ekle — yukarıdaki örnek.
3. Map screen'e habitat layer toggle ekle, mevcut Designated Sites toggle yanına.
4. `<HabitatLayer habitats={...} />` component — react-native-maps `Polygon` ile (her polygon ayrı `<Polygon coordinates fillColor strokeColor />`).
5. Habitats tab + liste + detay sheet.
6. FOSSITT renk map'ini `lib/habitat-colors.ts` olarak ekle (web'den port).
7. Empty state + loading skeleton.

## 9. Notlar / Tuzaklar

- **`fossitt_code === '—'`** olabilir (mapping bulunamayan NLC için web'in koyduğu placeholder). Mobile'da bu satırları renderdan **dışla** ya da "Unclassified" göster — `—` etiketi UI'da kötü görünür.
- **`include_in_report = false`** olan habitat polygon'ları rapor dışı bırakılmış demek. Mobile'da default olarak göster ama "Sadece raporlananlar" toggle'ı eklemek isteyebilirsin.
- **Multipolygon ihtimali:** boundary `Polygon` veya `MultiPolygon` olabilir, ikisini de handle et.
- **Tip senkronu:** `npx supabase gen types typescript --project-id <id>` ile mobil repoda `Database` tipini güncel tut, RPC dönüş tipi otomatik gelir.
