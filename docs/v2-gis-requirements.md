# v2 — GIS Map Requirements

> Greg's v2 feedback. New scope on top of v1 (`requirements.md` / `ios-app-requirements.md`).
> Only items that are **genuinely new** in v2 are listed here.

---

## EN — What's new in v2

**Core feature: Integrated GIS Map** — a fully functional map becomes the primary visual interface for spatial data and field activities.

### Data layers on the map
1. **Habitat / land cover polygons** — habitat data is already accessible in v1, but v2 wants it rendered on a map with **toggle visibility** and **transparency** controls. Multiple classification schemes must be supported (Annex I Habitats, EUNIS, national).
2. **Designated site boundaries** — *new dataset.* Boundaries of SACs, SPAs, NHA / pNHAs, National Parks and other statutory designations. Labeled polygons.
3. **Target notes as map features** — currently list/form items; v2 wants them on the map as **points / lines / polygons**, symbolized by type, clickable to open associated metadata (description, date, observer, status).
4. **Real-time user location ("blue dot")** — live GPS dot with high-accuracy mode indicator. v1 only uses GPS to tag photos.

### Map functionality
5. **Basemap options** — switch between aerial imagery, topographic, and street basemaps.
6. **Zoom / pan** — standard smooth navigation controls.
7. **Spatial search & query** — locate features by attribute (habitat type, site name) or by coordinates.
8. **Offline map support** — pre-load and cache map tiles + essential datasets for full functionality without internet in remote field locations.

---

## TR — v2'de gerçekten yeni olanlar

**Ana özellik: Entegre GIS Harita** — uygulamanın yeni ana görsel arayüzü; konumsal veri ve saha aktiviteleri için birincil ekran.

### Harita üstündeki veri katmanları
1. **Habitat / arazi örtüsü polygon'ları** — habitat verisine v1'de erişim var, v2 bunların **harita üstünde polygon olarak** çizilmesini, **görünürlük ve transparency toggle**'larıyla istiyor. Birden fazla sınıflandırma şeması desteklenmeli (Annex I, EUNIS, ulusal).
2. **Korunan alan sınırları** — *yeni veri seti.* SAC, SPA, NHA / pNHA, Milli Park ve diğer yasal koruma alanı sınırları. Etiketli polygon olarak.
3. **Target notes harita üstünde** — şu an liste/form; v2 bunları haritada **nokta / çizgi / polygon** olarak, tipe göre sembolize edip, tıklanınca metadata (açıklama, tarih, gözlemci, durum) açılmasını istiyor.
4. **Canlı kullanıcı konumu ("mavi nokta")** — high-accuracy göstergesiyle anlık GPS noktası. v1'de GPS sadece fotoğraf etiketlemek için kullanılıyor.

### Harita işlevselliği
5. **Basemap seçenekleri** — uydu / topografik / sokak haritası arasında geçiş.
6. **Zoom / pan** — yumuşak, standart harita kontrolleri.
7. **Konumsal arama** — habitat tipi, site adı veya koordinatla feature bulma.
8. **Offline harita desteği** — tile'ları ve veri katmanlarını **önceden indirip cache'leme**, sahada internetsiz tam işlevsellik.

---

## Open questions (Greg'e sorulacaklar)

- **Designated sites verisi nereden gelecek?** Irish gov'un public dataset'leri mi (NPWS shapefile), manuel mi yüklenecek? Web tarafında upload akışı gerekecek mi?
- **Basemap provider seçimi?** Mapbox (ücretli, MAU bazlı) vs MapLibre + OSM/MapTiler (ücretsiz/açık kaynak). Offline tile caching ikisinde de var ama lisans/maliyet farklı.
- **Target notes mobilde oluşturulabilecek mi**, yoksa sadece görüntü mü? (v1'de mobilde oluşturma yok.)
- **Habitat polygon'ları mobilde düzenlenebilecek mi** yoksa read-only mi?
- **Offline tile alan seçimi** kullanıcıya nasıl sunulacak? (bbox seçimi, proje sınırına göre otomatik, vs.)
- **Tile storage limiti?** Yüksek çözünürlüklü uydu tile'ları 500MB+ olabilir — kullanıcıya yer uyarısı / temizleme UI'ı lazım.
