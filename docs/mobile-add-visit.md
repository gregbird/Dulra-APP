# Mobile — Add Visit (read-write)

> **Created:** 2026-05-04
> **Scope:** Saha ziyaretlerini gruplama. Bir survey altına yeni visit eklemek (Visit 1, 2, 3 …). Aynı `visit_group_id` taşıyan satırlar bir grup oluşturur, `visit_number` ile sıralanır.

---

## Tasarım kararları

| Konu | Karar | Gerekçe |
|---|---|---|
| Standalone → group dönüşümü | **Fresh UUID üret** (parent.id'yi group_id olarak kullanma) | Mobile parent henüz sync olmamışken local_id kullanırsa sync sonrası group_id stale kalır. Web'de `visit_group_id == survey.id` invariant değil — hiçbir kod yolu buna dayanmıyor (use-visit-management, survey-groups, getNextVisitNumber sadece eşitlik filtreliyor; FK constraint yok). |
| visit_number hesaplama | `Math.max(...all visits in group) + 1`, **cache + pending birlikte** | İki kullanıcı paralel Add Visit yaparsa aynı sayıyı üretebilir → DB unique index yakalar (aşağıda). |
| Form scope | Date + surveyor + notes (surveyType locked) | Web'in Zod schema'sı da minimal — start_time/end_time/weather form'da yok. Saha hızlı aksiyon olmalı. |
| UI yeri | Survey detay ekranında "Previous visits" accordion + Add Visit butonu | Flat list pattern korunur, grouplu collapse ileride eklenebilir. Web parite bozulmaz. |
| weather alanı | Add Visit form'unda **yok** | Web bile Add Visit'te toplamıyor. Mevcut `weather: { templateFields: {...} }` şeması korunur. |
| Add Visit gating | Multi-site'da site seçili değilse gizle; gruptaki tüm visit'ler `completed` ise gizle | Web ile birebir parite (`survey-list.tsx:108`). |

---

## Migration — Unique index (apply via Supabase dashboard)

`(visit_group_id, visit_number)` üzerinde unique index yok, race condition riski var (iki paralel Add Visit aynı sayıyı üretebilir). DB-side koruma:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS surveys_visit_group_visit_number_key
ON surveys (visit_group_id, visit_number)
WHERE visit_group_id IS NOT NULL;
```

**Etki:**
- Mevcut data temiz (verified: zero duplicates üzerinde `(visit_group_id, visit_number)`).
- Index aynı zamanda `visit_group_id` filter'lı sorguları hızlandırır (filtered-on-NOT-NULL).
- Web etkilenmez; mevcut yazımlar zaten unique. Mobile sync `23505` unique_violation alırsa visit_number'ı yeniden hesaplayıp retry edecek (aşağıda sync section'ı).

**Apply etmek:** Supabase dashboard → SQL Editor → bu satırı yapıştır → Run.

---

## DB / mobil yapı

### `surveys` (mevcut, dokunulmaz)

```
visit_group_id  uuid       NULL
visit_number    integer    NULL
```

Her ikisi de nullable — standalone survey iki kolonu da NULL bırakır.

### Mobil SQLite — v12 migration

```sql
-- pending_surveys: outbound queue. Visit fields persist across app restart
-- so an unsynced Add Visit insertion isn't lost.
ALTER TABLE pending_surveys ADD COLUMN visit_group_id TEXT;
ALTER TABLE pending_surveys ADD COLUMN visit_number INTEGER;

-- cached_surveys: offline read view. Lets the surveys list group rows by
-- visit_group_id and the form compute getNextVisitNumber without a network
-- round-trip.
ALTER TABLE cached_surveys ADD COLUMN visit_group_id TEXT;
ALTER TABLE cached_surveys ADD COLUMN visit_number INTEGER;
```

Var olan rows için NULL — backward compatible.

---

## Akış — Add Visit

### Senaryo A — Parent zaten gruba bağlı (`visit_group_id` set)

1. `getNextVisitNumber(parentGroupId)` → cache + pending birleşiminden `max + 1`.
2. Form aç, surveyType locked, group_id ve nextNumber state'te.
3. Submit → `saveSurvey` parent'a dokunmadan yeni satır insert eder.

### Senaryo B — Parent standalone (`visit_group_id IS NULL`)

İlk Add Visit'te otomatik gruba dönüşür:

1. **Fresh UUID üret** (`expo-crypto.randomUUID()`).
2. Parent'ı güncelle: `visit_group_id = newUUID, visit_number = 1`.
3. Yeni visit insert: `visit_group_id = newUUID, visit_number = 2`.

**Offline davranış:**
- Parent henüz pending'se: `pending_surveys` row'unu UPDATE et (visit_group_id + visit_number set). Sync'te parent INSERT olurken bu alanlar payload'a girer. Yeni visit ayrı pending row olarak insert edilir, **aynı UUID'yi** group_id olarak taşır. Sync sırasıyla:
  1. Parent INSERT → server'da row, `visit_group_id` ve `visit_number=1` ile.
  2. Yeni visit INSERT → server'da farklı row, **aynı** `visit_group_id` ile, `visit_number=2`.
  Hiçbir local_id → remote_id mapping gerekmiyor çünkü group_id zaten ortak fresh UUID.
- Parent synced'se: doğrudan Supabase UPDATE + INSERT.

### Sync conflict — `23505` unique_violation

Race olursa (iki kullanıcı aynı anda Visit 4 ekledi), mobile sync UPDATE/INSERT 23505 alır:
1. Sunucudan o gruptaki güncel `MAX(visit_number)` çekilir.
2. Pending row'un visit_number'ı `MAX + 1` ile güncellenir.
3. Bir kez retry. Hâlâ 23505 → `markSurveyConflict`.

---

## Form alanları (Add Visit)

| Alan | Davranış |
|---|---|
| `survey_type` | Locked — gruptan otomatik gelir, değiştirilemez |
| `survey_date` | Editable, default = bugün |
| `surveyor_id` | Editable, default = current user (admin/PM başkası adına ekleyebilir) |
| `notes` | Editable, opsiyonel |
| `status` | Hidden — backend'de default `in_progress` |
| `visit_group_id`, `visit_number` | Hidden — programatik set edilir |
| `site_id` | Otomatik = currentSelectedSiteId (multi-site projede) |

Form web'in Zod schema'sıyla birebir.

---

## UI — Survey detay ekranı

`/survey/[id]` ekranı bir survey yüklediğinde:

1. **"Previous visits" accordion** — aynı `visit_group_id`'yi paylaşan diğer rows, `visit_number` ile sıralı. Her satır tap → o visit'in detay ekranına gider.
2. **"Add Visit" butonu** — accordion altında. Gating:
   - Hidden: gruptaki tüm visit'ler `completed` ise (grup tamamlanmış).
   - Hidden: multi-site projede `selectedSiteId` yoksa.
   - Visible: aksi durumda (standalone'da bile — ilk tıklamada grup oluşturur).

Standalone survey'de "Previous visits" accordion görünmez (henüz grup yok); Add Visit butonu görünür.

---

## Test senaryoları

- [ ] **Online + standalone parent:** Survey A'ya Add Visit → grup oluşur, A=Visit 1, B=Visit 2.
- [ ] **Online + grouped parent:** Visit 2'ye Add Visit → Visit 3 olarak insert.
- [ ] **Offline + standalone unsynced parent:** Survey A henüz sync olmadan Add Visit → fresh UUID, A pending'i update, B yeni pending. Online dön → ikisi de grup üyesi olarak insert.
- [ ] **Offline + grouped synced parent:** Add Visit pending'e yazılır, online dön → INSERT.
- [ ] **All-completed gating:** Tüm visit'ler completed → buton görünmez.
- [ ] **Multi-site gating:** Site seçili değil → buton görünmez (banner: "Select a site").
- [ ] **Race / duplicate visit_number:** İki cihaz paralel Add Visit → biri 23505 alır, retry edip Visit N+1 olarak girer.
- [ ] **Surveyor reassignment:** Admin başka bir surveyor seçince surveyor_id doğru kişi olur.

---

## V1 sınırlamaları

- **Date picker yok** — `survey_date` Add Visit form'unda **bugün'e default'lanır** ve düzenlenemez. Kullanıcı farklı bir tarih için survey'i oluşturup detay ekranından `survey_date`'i (ileride) edit eder. `@react-native-community/datetimepicker` eklemekten kaçındık (yeni native dep). v2'de eklenebilir.
- **Pending parent kendisi açılamıyor** — Yeni offline-only survey detay ekranında render olmuyor (mevcut sınırlama: `survey-form-screen` `cached_surveys`'den okuyor, `pending_surveys`'i değil). Bu PR scope dışı; kullanıcı sync olduktan sonra Add Visit görebilir.

## Bağımlılıklar / kapsam dışı

- `start_time` / `end_time` alanları — DB kolonları var ama mobile form'unda gösterilmiyor (web de göstermiyor). Sonradan extend edilebilir.
- `weather` conditions explicit alanları — yok. Mevcut `templateFields` flatten dump pattern'i korunuyor.
- Survey'i grup'tan çıkarma / silme — bu PR dışı.
