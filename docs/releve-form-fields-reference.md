# Releve Survey — Form Alanlari ve Dropdown Verileri

> Bu dokuman mobil uygulama icin releve survey formundaki dropdown/select alanlarini ve
> veri kaynaklarini aciklar. Web uygulamasiyla ayni veriyi kullanmak icin bu referansi takip edin.
>
> Tarih: 1 Nisan 2026

---

## ONEMLI: Veri Kaynagi

Bu alanlar **Supabase'den gelmiyor**. Tamami web uygulamasinda **statik JSON/constant** olarak tanimli.
Mobil uygulamada da ayni sekilde **bundle edilmis statik veri** olarak kullanilmali.

Kaynak dosyalar (web repo):

- `lib/data/json/fossitt-codes.json` — Fossitt habitat kodlari (JSON, 118 level-3 kayit)
- `lib/data/common-irish-flora.ts` — Flora listesi, DOMIN scale, soil stability, aspect

---

## 1. `habitat_type` — Fossitt Habitat Siniflandirmasi

**Tip:** Searchable picker (118 secenek — duz liste olarak gostermek zor, arama destegi sart)

**Kaynak:** `lib/data/json/fossitt-codes.json` dosyasindan **sadece level === 3** kayitlar filtrelenir.

**JSON yapisi:**

```json
{
  "code": "GS4",
  "name": "Wet grassland",
  "level": 3,
  "parent": "GS",
  "color": "#90EE90",
  "annex1": "6410"
}
```

**Formda gosterim:** `{code} — {name}` (ornek: `GS4 — Wet grassland`)
**DB'ye kaydedilen deger:** sadece `code` (ornek: `"GS4"`)

**Hiyerarsi (gruplama icin kullanilabilir):**

- Level 1 (8 adet): Ana kategori → `F` (Freshwater), `G` (Grassland), `W` (Woodland)...
- Level 2 (~30 adet): Alt kategori → `GS` (Semi-natural grassland)
- Level 3 (118 adet): Spesifik habitat → `GS4` (Wet grassland) — **formda bunlar secilir**

Her level-3 kaydinin `parent` alani level-2'yi, level-2'nin `parent`'i level-1'i gosterir.
Mobilde gruplama yapilabilir: Level 1 > Level 2 > Level 3 seklinde.

**Ornek kayitlar (en sik kullanilanlar):**
| Kod | Isim | Annex I |
|-----|------|---------|
| GA1 | Improved agricultural grassland | — |
| GA2 | Amenity grassland (improved) | — |
| GS1 | Dry calcareous and neutral grassland | 6210 |
| GS2 | Dry meadows and grassy verges | — |
| GS3 | Dry-humid acid grassland | — |
| GS4 | Wet grassland | 6410 |
| WD1 | Mixed broadleaved woodland | — |
| WN2 | Oak-ash-hazel woodland | 91A0 |
| WS1 | Scrub | — |
| HH3 | Wet heath | 4010 |
| PB1 | Raised bog | 7110 |
| PB3 | Lowland blanket bog | 7130 |
| GM1 | Marsh | — |
| FL4 | Eutrophic lakes | 3150 |
| BL3 | Buildings and artificial surfaces | — |
| ED2 | Spoil and bare ground | — |
| ED3 | Recolonising bare ground | — |

**Mobil implementasyon onerisi:**

- JSON dosyasini uygulama bundle'ina ekleyin
- Searchable picker kullanin (kod veya isim ile arama)
- Opsiyonel: Level 1 > Level 2 > Level 3 gruplu gosterim

---

## 2. `soil_type` — Serbest Text Input

**Tip:** TextInput (dropdown DEGIL)

**Placeholder:** `"e.g. Peat, Clay, Loam"`

Kullanici istedigi degeri yazar. Yaygin degerler:

- Peat, Clay, Loam, Sandy, Alluvial, Rocky, Mineral, Organic, Peaty-mineral

---

## 3. `soil_stability` — 4 Secenek

**Tip:** Picker/Select (4 sabit secenek)

```
Firm
Soft
Waterlogged
Unstable
```

Mobilde basit bir picker yeterli.

---

## 4. `aspect` — 9 Secenek (Yon + Flat)

**Tip:** Picker/Select (9 sabit secenek)

```
N
NE
E
SE
S
SW
W
NW
Flat
```

Pusula yonleri + duz arazi icin "Flat". Mobilde basit picker yeterli.

---

## 5. `species_cover_domin` — DOMIN Olcegi (1-10)

**Tip:** Picker/Select (10 secenek, species satiri basina)
**Kullanim yeri:** Species Records section'daki her tur satiri icinde

```
1  — Single occurrence, < 4% cover
2  — Few occurrences, < 4% cover
3  — Many occurrences, < 4% cover
4  — 4–10% cover
5  — 11–25% cover
6  — 26–33% cover
7  — 34–50% cover
8  — 51–75% cover
9  — 76–90% cover
10 — 91–100% cover
```

**DB'ye kaydedilen deger:** sayi (1-10)
**Formda gosterim:** `{value} — {label}`

---

## 6. `species_name_latin` — Tur Adi Autocomplete

**Tip:** TextInput + autocomplete/suggestion listesi
**Kullanim yeri:** Species Records section'daki her tur satiri icinde

Kullanici serbest yazabilir AMA 23 yaygin Irlanda turunden oneri gosterilir:

```
Latin Adi                    | Ingilizce Adi
-----------------------------|---------------------------
Agrostis capillaris          | Common Bent
Anthoxanthum odoratum        | Sweet Vernal-grass
Calluna vulgaris             | Heather
Cynosurus cristatus          | Crested Dog's-tail
Dactylis glomerata           | Cock's-foot
Digitalis purpurea           | Foxglove
Erica tetralix               | Cross-leaved Heath
Festuca ovina                | Sheep's-fescue
Festuca rubra                | Red Fescue
Galium verum                 | Lady's Bedstraw
Holcus lanatus               | Yorkshire-fog
Juncus effusus               | Soft-rush
Lolium perenne               | Perennial Ryegrass
Lotus corniculatus           | Bird's-foot-trefoil
Molinia caerulea             | Purple Moor-grass
Nardus stricta               | Mat-grass
Plantago lanceolata          | Ribwort Plantain
Potentilla erecta            | Tormentil
Ranunculus acris             | Meadow Buttercup
Rumex acetosa                | Common Sorrel
Trifolium pratense           | Red Clover
Trifolium repens             | White Clover
Ulex europaeus               | Gorse
```

**DB'ye kaydedilen deger:** Latin adi (string) — listeden secilmek zorunda degil, serbest giris de gecerli.
**`species_name_english`:** Listeden secilirse otomatik doldurulan Ingilizce isim. Serbest giriste bos kalabilir.

---

## Ozet: Alan Tipleri

| Alan                  | Tip                 | Secenek Sayisi | Kaynak                                |
| --------------------- | ------------------- | -------------- | ------------------------------------- |
| `habitat_type`        | Searchable picker   | 118            | fossitt-codes.json (level 3)          |
| `soil_type`           | Serbest text input  | —              | Placeholder: "Peat, Clay, Loam"       |
| `soil_stability`      | Picker              | 4              | Sabit: Firm/Soft/Waterlogged/Unstable |
| `aspect`              | Picker              | 9              | Sabit: N/NE/E/SE/S/SW/W/NW/Flat       |
| `species_cover_domin` | Picker (tur basina) | 10             | DOMIN scale 1-10                      |
| `species_name_latin`  | Text + autocomplete | 23 oneri       | common-irish-flora listesi            |
| `slope_degrees`       | Number input        | —              | Sayi (derece)                         |

---

## Mobil Icin Veri Erisimi

Bu veriler **tamami statik** — Supabase'den cekilmez. Secenekler:

### Secenek A: JSON/TS dosyalarini bundle'a ekle (onerilen)

- `fossitt-codes.json` dosyasini mobil projeye kopyala
- Kucuk constant'lari (DOMIN, soil_stability, aspect, flora) Swift/TS constant olarak tanimla
- Avantaj: Offline calisir, hizli, web ile tutarli

### Secenek B: Supabase lookup tablosu olustur

- Bu verileri bir lookup tablosuna INSERT et
- Avantaj: Merkezi yonetim
- Dezavantaj: Gereksiz network bagimliligi, offline'da calismaz, web bunu yapmiyor

**Oneri: Secenek A.** Web de statik kullandigi icin mobil de ayni yapsin. Fossitt kodlari
nadiren degisir (son guncelleme 2000 yilinda yayinlanan kitaptan).
