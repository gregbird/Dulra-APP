# Faz 3 — Multi-Site Altyapi (project_sites) Uygulama Plani

## Context

Dulra-APP su anda tek site yapisiyla calisiyor — bir projenin sadece bir `site_code` alani var. Ancak Supabase'de `project_sites` tablosu mevcut ve surveys/habitats/target_notes tablolarina `site_id` kolonu eklenmi durumda. Faz 3, mobil uygulamaya multi-site destegi getirerek kullanicilarin bir proje icindeki birden fazla sahaya erisip, filtreleyip, veri girebilmesini sagliyor.

Faz 1 (acil DB fix), Faz 2 (enum guncellemeleri), Faz 4 (releve survey) tamamlandi. Faz 3 kalan tek is.

---

## Adim 1: Type Definitions

**Dosya:** `src/types/project.ts`

- `ProjectSite` interface ekle:
  ```typescript
  export interface ProjectSite {
    id: string;
    project_id: string;
    site_code: string;
    site_name: string | null;
    sort_order: number | null;
    county: string | null;
  }
  ```

**Dosya:** `src/types/survey.ts`

- `Survey` interface'e ekle:
  ```typescript
  site_id?: string | null;
  ```

**Dosya:** `src/types/habitat.ts`

- `HabitatPolygon` ve `TargetNote` interface'lere ekle:
  ```typescript
  site_id?: string | null;
  ```

---

## Adim 2: SQLite Schema + Migration (DB v4 → v5)

**Dosya:** `src/lib/database.ts`

### 2a. Migration Logic (initTables icinde)

Mevcut `if (!ver || ver.version < 4)` blogundan sonra yeni v5 migration ekle:

```
if ver.version === 4:
  - ALTER TABLE cached_surveys ADD COLUMN site_id TEXT
  - ALTER TABLE cached_habitats ADD COLUMN site_id TEXT
  - ALTER TABLE cached_target_notes ADD COLUMN site_id TEXT
  - ALTER TABLE pending_surveys ADD COLUMN site_id TEXT
  - CREATE TABLE IF NOT EXISTS cached_project_sites (...)
  - UPDATE db_version SET version = 5
```

> Not: ALTER TABLE SQLite'da guvenli — nullable kolon eklemek veri kaybina yol acmaz, mevcut satirlarda NULL olur.

### 2b. Yeni Tablo: `cached_project_sites`

```sql
CREATE TABLE IF NOT EXISTS cached_project_sites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  site_code TEXT NOT NULL,
  site_name TEXT,
  sort_order INTEGER,
  county TEXT,
  cached_at TEXT NOT NULL
);
```

### 2c. `pending_surveys` tablosuna `site_id TEXT` kolonu ekle

CREATE TABLE IF NOT EXISTS blogu icinde de `site_id TEXT` kolonu eklenmeli (yeni kurulumlar icin).

### 2d. Yeni Fonksiyonlar

```typescript
// Cache site
export async function cacheProjectSite(params: {
  id: string; projectId: string; siteCode: string;
  siteName: string | null; sortOrder: number | null; county: string | null;
}): Promise<void>

// Get cached sites
export async function getCachedProjectSites(projectId: string): Promise<Array<{
  id: string; project_id: string; site_code: string;
  site_name: string | null; sort_order: number | null; county: string | null;
}>>
```

### 2e. Mevcut Fonksiyonlari Guncelle

- `saveSurveyLocally()` params'a `siteId?: string` ekle, INSERT'e `site_id` dahil et
- `cacheSurvey()` params'a `siteId?: string | null` ekle, INSERT'e `site_id` dahil et
- `cacheHabitat()` params'a `siteId?: string | null` ekle
- `cacheTargetNote()` params'a `siteId?: string | null` ekle
- `getCachedSurveys()` return type'a `site_id` ekle
- `getCachedHabitats()` return type'a `site_id` ekle
- `getCachedTargetNotes()` return type'a `site_id` ekle
- `clearCachedData()` icine `DELETE FROM cached_project_sites` ekle

---

## Adim 3: Cache Flow — cacheAllData() Guncelle

**Dosya:** `src/app/_layout.tsx`

### 3a. Supabase Fetch'e project_sites ekle

Mevcut `Promise.allSettled` array'ine yeni sorgu ekle:
```typescript
supabase.from("project_sites")
  .select("id, project_id, site_code, site_name, sort_order, county")
  .in("project_id", projectIds)
  .order("sort_order")
```

### 3b. Surveys/Habitats/Target Notes sorgularina `site_id` ekle

Mevcut SELECT string'lerine `, site_id` ekle:
- surveys: `"id, project_id, survey_type, ... , site_id"`
- habitat_polygons: `"id, project_id, ... , site_id"`
- target_notes: `"id, project_id, ... , site_id"`

### 3c. Cache yaziminda site_id'yi ilet

- `cacheProjectSite()` her site icin cagir
- `cacheSurvey()` cagirisina `siteId: s.site_id` ekle
- `cacheHabitat()` cagirisina `siteId: h.site_id` ekle
- `cacheTargetNote()` cagirisina `siteId: n.site_id` ekle

---

## Adim 4: Survey Save + Sync'e site_id Destegi

### 4a. `src/lib/survey-save.ts`

- `SaveParams` interface'e `siteId?: string | null` ekle
- `saveSurvey()` online INSERT'e `site_id: params.siteId ?? null` ekle
- `saveOffline()` → `saveSurveyLocally()` cagirisina `siteId` parametresini ilet

### 4b. `src/lib/sync-service.ts`

- `syncSurveys()` icindeki INSERT objesine `site_id: survey.site_id ?? null` ekle
  (pending_surveys'den gelen site_id'yi Supabase'e gonder)
- `getPendingSurveys()` return type'ina `site_id` ekle

### 4c. `src/lib/releve-save.ts`

- `getReleveDefaults()` icindeki `site_name` alanini: siteId parametresi varsa ilgili sitenin ismini kullan (simdilik projectName fallback olarak kalir, Adim 6'da UI'dan gelecek)

---

## Adim 5: Site Picker Component

**Yeni dosya:** `src/components/site-picker.tsx`

Mevcut `SelectModal` pattern'ini baz alan basit bir horizontal chip/selector:

```
Props:
  sites: ProjectSite[]
  selectedSiteId: string | null  (null = "All Sites")
  onSelect: (siteId: string | null) => void
```

Tasarim:
- Yatay ScrollView (horizontal chip strip)
- Ilk chip: "All Sites" (selectedSiteId === null)
- Diger chipler: site_name || site_code
- Aktif chip: primary renk vurgusu
- Sadece 1+ site varsa gosterilir (tek site veya 0 site = gizle)
- Min 48x48 dokunma alani (UX kurali)

---

## Adim 6: Project Detail Screen — Site Secimi

**Dosya:** `src/screens/project-detail-screen.tsx`

### 6a. State

```typescript
const [sites, setSites] = useState<ProjectSite[]>([]);
const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
```

### 6b. Fetch Sites

`fetchData()` icinde mevcut `Promise.all`'a ekle:
```typescript
supabase.from("project_sites")
  .select("id, project_id, site_code, site_name, sort_order, county")
  .eq("project_id", id)
  .order("sort_order")
```

Offline fallback: `getCachedProjectSites(id)` kullan.

### 6c. Count Sorgularini Site'a Gore Filtrele

`selectedSiteId` varsa count sorgularina filtre ekle:
- **Surveys:** `.eq("site_id", selectedSiteId)` (survey her zaman bir site'a ait)
- **Habitats:** `.or(`site_id.eq.${selectedSiteId},site_id.is.null`)` (site'siz habitat'lar da sayilir)
- **Target Notes:** `.or(`site_id.eq.${selectedSiteId},site_id.is.null`)` (site'siz notlar da sayilir)

Yoksa (All Sites / selectedSiteId === null) mevcut project_id filtresi kalir.

> **Onemli:** Count mantigi Adim 7b/7c'deki liste filtreleme mantigi ile ayni olmali. Aksi halde listede gorunen ama count'ta sayilmayan kayitlar olur.

### 6d. UI'ya SitePicker Ekle

Header meta'dan sonra, section card'lardan once:
```tsx
{sites.length > 1 && (
  <SitePicker
    sites={sites}
    selectedSiteId={selectedSiteId}
    onSelect={setSelectedSiteId}
  />
)}
```

### 6e. Effective siteId Hesaplama (Tek Site Otomatik Atama)

Survey olusturma ve navigation'da kullanilacak `effectiveSiteId` hesapla:

```typescript
const effectiveSiteId = useMemo(() => {
  if (sites.length === 0) return null;        // Eski proje, site yok → null
  if (sites.length === 1) return sites[0].id;  // Tek site → otomatik ata
  return selectedSiteId;                        // Multi-site → kullanici secimi
}, [sites, selectedSiteId]);
```

> **Neden:** Tek site'li projelerde picker gizleniyor, ama siteId UI'dan gelmezse null kalir ve orphan survey olusur. Bu mantik ile tek site otomatik atanir.

### 6f. Survey Olusturma Engeli (Multi-site + "Tum Siteler")

Multi-site projede `effectiveSiteId === null` ise (yani "Tum Siteler" secili) survey olusturma engellenmeli:

```typescript
const handleNewSurvey = () => {
  // Multi-site projede site secilmeden survey olusturulamaz
  if (sites.length > 1 && effectiveSiteId === null) {
    Alert.alert(
      "Select a Site",
      "Please select a site before starting a new survey.",
      [{ text: "OK" }]
    );
    return;
  }
  setPickerVisible(true);
};
```

> **Neden:** `site_id = null` olan survey orphan olur. Kullanicinin once site secmesi gerekir. Alert ile net mesaj verilir.

### 6g. Navigation'a siteId Parametresi Ekle

```typescript
const handleSectionPress = (key: string) => {
  const siteParam = effectiveSiteId ? `?siteId=${effectiveSiteId}` : "";
  if (key === "surveys") router.push(`/project/${id}/surveys${siteParam}`);
  if (key === "habitats") router.push(`/project/${id}/habitats${siteParam}`);
  if (key === "notes") router.push(`/project/${id}/target-notes${siteParam}`);
};
```

Survey olusturmada da effectiveSiteId ilet:
```typescript
router.push(`/releve-survey/new?projectId=${id}&siteId=${effectiveSiteId}`);
router.push(`/survey/new?projectId=${id}&surveyType=...&siteId=${effectiveSiteId}`);
```

---

## Adim 7: List Ekranlarinda Site Filtreleme

### 7a. `src/screens/surveys-list-screen.tsx`

- URL params'tan `siteId` al: `const { id, siteId } = useLocalSearchParams<{ id: string; siteId?: string }>()`
- Supabase sorgusu: `siteId` varsa `.eq("site_id", siteId)` ekle
  > Surveys icin sadece `.eq` — eski (site_id=null) survey'ler sadece "Tum Siteler" gorunumunde listelenir. Site filtresi aktifken gosterilmez.
- Cache fallback: `getCachedSurveys(id)` sonuclarina JS tarafinda `site_id` filtresi uygula
- Header'a site bilgisi goster (opsiyonel, site_name chip)

### 7b. `src/screens/habitats-screen.tsx`

- URL params'tan `siteId` al
- Supabase sorgusu: `siteId` varsa `.eq("site_id", siteId)` ekle
  (site_id'si NULL olan habitat'lar da gosterilmeli: iki ayri sorgu veya OR filtresi)
  > Strateji: Supabase'de `.or(`site_id.eq.${siteId},site_id.is.null`)` kullan
- Cache fallback: JS filtresi

### 7c. `src/screens/target-notes-screen.tsx`

- Ayni pattern: siteId param al, filtre uygula
- `.or(`site_id.eq.${siteId},site_id.is.null`)` kullan

---

## Adim 8: Survey Form Ekranlarinda siteId Akisi

### 8a. `src/screens/survey-form-screen.tsx`

- URL params'tan `siteId` al
- `saveSurvey()` cagirisina `siteId` ekle

### 8b. `src/screens/releve-survey-form-screen.tsx`

- URL params'tan `siteId` al
- `getReleveDefaults()` cagirisinda `site_name` icin: siteId varsa cached sites'tan ismi cek, yoksa projectName kullan
- `saveSurvey()` cagirisina `siteId` ekle

---

## Adim 9: docs/mobile-sync-todo.md Guncelle

Tamamlanan Faz 3 maddelerini [x] olarak isaretle.

---

## Uygulama Sirasi (Bagimliliklara Gore)

```
1. Type definitions          (bagimsiz, her sey buna bagimli)
2. database.ts migration     (schema altyapisi)
3. database.ts fonksiyonlar  (cache + pending CRUD)
4. _layout.tsx cache flow    (site'lar cache'lenir)
5. survey-save.ts + sync     (site_id save/sync zinciri)
6. site-picker component     (UI component)
7. project-detail-screen     (site secim UI + navigation)
8. list ekranlari filtreleme (surveys, habitats, target-notes)
9. survey form ekranlari     (siteId param akisi)
10. docs guncelleme          (todo checklist)
```

---

## Degisecek Dosyalar

| # | Dosya | Degisiklik |
|---|-------|-----------|
| 1 | `src/types/project.ts` | `ProjectSite` interface ekle |
| 2 | `src/types/survey.ts` | `site_id` field ekle |
| 3 | `src/types/habitat.ts` | `site_id` field ekle |
| 4 | `src/lib/database.ts` | v5 migration, yeni tablo, site_id kolonlari, yeni fonksiyonlar |
| 5 | `src/app/_layout.tsx` | project_sites fetch + cache, site_id'yi mevcut cache'e ilet |
| 6 | `src/lib/survey-save.ts` | SaveParams + INSERT/offline'a site_id |
| 7 | `src/lib/sync-service.ts` | sync INSERT'e site_id |
| 8 | `src/lib/releve-save.ts` | getReleveDefaults site_name iyilestirmesi |
| 9 | `src/components/site-picker.tsx` | **YENI** — horizontal chip selector |
| 10 | `src/screens/project-detail-screen.tsx` | site fetch + picker UI + navigation params |
| 11 | `src/screens/surveys-list-screen.tsx` | siteId param + filtre |
| 12 | `src/screens/habitats-screen.tsx` | siteId param + filtre |
| 13 | `src/screens/target-notes-screen.tsx` | siteId param + filtre |
| 14 | `src/screens/survey-form-screen.tsx` | siteId param akisi |
| 15 | `src/screens/releve-survey-form-screen.tsx` | siteId param + site_name |
| 16 | `docs/mobile-sync-todo.md` | Faz 3 checkboxlari tamamla |

---

## Geriye Donuk Uyumluluk

- `site_id` her yerde **nullable** — mevcut veriler etkilenmez
- Site'i olmayan projeler (sites.length === 0): SitePicker gizlenir, siteId = null, her sey eskisi gibi calisir
- Tek site'li projeler (sites.length === 1): SitePicker gizlenir, siteId otomatik atanir (effectiveSiteId)
- Multi-site projeler (sites.length > 1): SitePicker gorunur, kullanici secimi zorunlu (survey icin)
- Cache fonksiyonlari: `siteId` parametresi optional, undefined/null gecilebilir

### Eski Survey'ler (site_id = null — migration oncesi)

Migration oncesi olusturulan survey/habitat/target_notes kayitlarinin `site_id`'si null'dir.

- **Surveys:** Site filtresi aktifken `.eq("site_id", siteId)` kullanildigi icin eski survey'ler **sadece "Tum Siteler" gorunumunde** listelenir. Bu yeterlidir — eski survey'ler belirli bir site'a ait degildir.
- **Habitats / Target Notes:** `.or("site_id.eq.X,site_id.is.null")` kullanildigi icin eski kayitlar **her site altinda da** gorunur. Bu dogrudur — habitat ve target note'lar genellikle proje genelinde gecerlidir.

---

## Dogrulama / Test

1. **Migration testi:** Uygulamayi ac → console'da v5 migration log'u gorunmeli
2. **Cache testi:** Online modda proje ac → SQLite'da `cached_project_sites` tablosu dolu olmali
3. **Site picker:** Birden fazla site'i olan projeye git → chip strip gorunmeli
4. **Tek site:** Tek site'li proje → picker gizli olmali, ama survey olusturulurken `site_id` otomatik atanmali
5. **Sifir site:** Site'i olmayan eski proje → picker gizli, siteId null, eskisi gibi calismali
6. **Filtreleme:** Site sec → survey/habitat/target-notes listeleri filtrelenmeli
7. **Count tutarliligi:** Site sec → count badge'leri ile listelerdeki gercek kayit sayisi uyusmali
8. **Survey olusturma engeli:** Multi-site projede "Tum Siteler" secili iken "Start New Survey" → Alert gostermeli
9. **Survey olusturma:** Site secili iken yeni survey olustur → `site_id` Supabase'e yazilmali
10. **Offline test:** Offline modda survey olustur → `pending_surveys.site_id` dolu olmali → online olunca sync edilmeli
11. **Releve defaults:** Site secili iken yeni releve → `site_name` alaninda site ismi gelmeli
12. **Eski survey'ler:** site_id=null survey'ler → "Tum Siteler"de gorunmeli, belirli site filtresinde gorunmemeli
