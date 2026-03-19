# iOS App Gereksinimleri

Tasarım temiz ve sade olmalı.

> Durum: ✅ Yapıldı | ❌ Yapılmadı | 🌐 Web tarafının sorumluluğu

---

## Kullanıcı Akışı ve İşlevler

1. ✅ Kullanıcılar uygulamaya giriş yapabilmeli
2. ❌ Giriş yapıldıktan sonra erişim yetkisi olan tüm projeler listelenmeli
3. ❌ Kullanıcı çalışmak istediği projeyi seçebilmeli
4. ❌ Masaüstü uygulamasında başlatılan anketler (örneğin Relevé Anketi) kullanıcı mobil uygulamaya giriş yaptığında hemen erişilebilir olmalı
5. ❌ Kullanıcılar tek bir saha ziyaretinde birden fazla anket yapabilmeli, bunun için net bir "Başka anket ekle" seçeneği olmalı
6. ❌ Tamamlanan anketler özel bir "Tamamlanan Anketler" sekmesine taşınmalı
7. ❌ Kullanıcılar anket verilerini doğrudan uygulama içerisinde düzenleyebilmeli veya güncelleyebilmeli

## Veri Erişimi ve Giriş

8. ❌ Kullanıcılar mevcut habitat haritalama ve hedef notlar verilerine tam erişime sahip olmalı; bu veriler ister masaüstü uygulamasından ister başka bir yerden girilmiş olsun fark etmemeli

## Fotoğraf

9. ❌ Uygulama kullanıcıların sahada fotoğraf çekmesine izin vermeli
10. ❌ Her fotoğraf otomatik olarak filigranlanmalı (watermark) ve coğrafi koordinat etiketlenmeli (geo-coordinate tag)

## Veri Senkronizasyonu ve Kalıcılık

11. ❌ Tüm anket verileri ve fotoğraflar hücresel ağ veya Wi-Fi bağlantısı olmasa bile uygulama içerisinde otomatik olarak yerel kayıt edilmeli ve veri kalıcılığı sağlanmalı
12. ❌ Hücresel ağ ve/veya Wi-Fi erişimi yeniden sağlandığında yerel olarak kaydedilmiş tüm veriler otomatik olarak senkronize edilmeli; hem mobil uygulamadaki ilgili projeye hem de masaüstü uygulamasındaki ilgili projeye kaydedilmeli

## NOTLARIM

Dinamik Anket Uygulaması

1.) Form Şablonu: Web'de Surveys & Reports sayfası için formlar var. JSON Scheme ile oluşturulmuş. Her survey tipinin bir şablonu var. Gerekirse yenisi eklenebilir. Kaydedildiğinde veritabanına yazılıyor (JSON Scheme)

2.) Survey: Ekolojist survey başlatınca uygulama Supabase'den o survey tipinin JSON şablonunu çekiyor.

3.) Dinamik Form Renderer: Uygulamadaki en önemli alan, Gelen JSON'daki her alan için doğru input'u ekranda gösteriyor. Number ise sayı klavyesi, select ise dropdown, photo ise kamera butonu, gps ise otomatik konum. Kod sabit, form değişken — JSON ne diyorsa onu çiziyor.

4.) Repeat: Bir survey içinde birden fazla gözlem kaydı girilebilecek. Mesela Bat Survey'de 15 farklı yarasa kaydı. Her kayıtta ayrı tür, ayrı sayı, ayrı fotoğraf, ayrı GPS. "Yeni gözlem ekle" butonu ile aynı alan grubunun yeni bir kopyası açılacak.

5.) Koşullu sorular: Bir soruya verilen cevap sonraki sorunun görünmesini veya gizlenmesini sağlayabilecek. JSON'da her alanda "visible_when" kuralı tanımlı. Renderer formu çizerken bu kurala bakıyor, koşul sağlanmıyorsa o alanı göstermiyor.

6.) Veriyi yazma (offline): Ekolojist sahada ormanda, dağda, kırsal alanda. İnternet yok. Formu dolduruyor ama Supabase'e yazamıyor çünkü bağlantı yok. Veri kaybolmamalı. Veri telefonun hafızasına yazılmalı ama AsyncStorage değil, AsyncStorage varsayılan olarak 6MB veri tutabilir. Tek resimle bunu geçebiliriz. Bu sebeple React Native/Expo ile uyumlu başka bir paket eklemeliyiz:

SQLite (expo-sqlite): Hızlı, sorgu yapılabilir, limit yok, GB'larca veri sorunsuz taşıyabilir.
Dosya sistemi (expo-file-system): Fotoğraf dosya olarak kalır, SQLite'ta sadece dosya yolu tutulur. Fotoğrafları SQLite'da tutmak zorunda değiliz telefonda durabilir internet gelene kadar.

SQLite en doğru yol, her telefonda var ve WhatsApp mesajlarını telefonda saklıyor — SQLite ile. Chrome tarayıcı geçmişini saklıyor — SQLite ile. Hemen hemen her mobil uygulama yerel veri saklamak için SQLite kullanıyor.

Entegre etmek kolay, expo paketi var ikisinin de konfigürasyonları da basit. Kesinlikle SQLite kullanalım

## EKSİKLER

1.) 🌐 Alan tipleri eksik: Survey&Reports kısmından formları mobil uygulamaya çekeceğiz (projeye atayıp) ancak bu alanlarda eksik tipler var: photo, gps, signature, barcode, geoshape, repeat. Bu eksik alanlar Survey123'te vardı. Dökümanda da Survey&Reports'taki anketlerin çekilmesi isteniyor zaten. O halde bu alanlardan en az gps ve photo'yu eklememiz gerekiyor.

2.) 🌐 Koşullu alan desteği yok şuan. Bu bizde gerekli mi bilmiyorum. Survey123 kullanıyordu: Şu an bir alanın başka bir alanın cevabına göre görünüp gizlenmesi desteklenmiyor. Eklenmeli ki "yarasa gördün mü → evet → hangi tür?" gibi akışlar çalışsın.

3.) 🌐 Repeat eksik: SurveySection interface'inde repeatable özelliği yok. Şu an bir bölüm sadece bir kere doldurulabiliyor. Ekolojistin aynı bölümü birden fazla kere doldurabilmesi lazım (her gözlem için ayrı kayıt).

4.) 🌐 Web'deki form renderer yeni tipleri çizemiyor: eğer gps photo gibi alanlar eklersek, web için bunları render edecek componentler lazım. Mesela photo tipi web'de dosya yükleme butonu olarak, gps tipi harita üzerinde nokta seçme olarak gösterilebilir.

5.) 🌐 Template editor yeni tipleri desteklemiyor: Web'deki şablon editörü (field-editor.tsx) sadece mevcut 8 tipi (text, number, textarea, select, multi-select, boolean, date, time) seçtiriyor. Photo, gps gibi yeni tipler eklenince editörün de güncellenmesi lazım ki admin bu tipleri şablonlara ekleyebilsin.

6.) 🌐 Rol bazlı erişim kontrolü uygulanmamış: Web'de permission matrix (role-context.tsx) tanımlı ama proje sayfasında kullanılmıyor. Assessor ve admin aynı 10 step'i görüyor. Assessor'ın Step 9 (Quality Review) ve Step 10 (Final Submission) gibi onay adımlarını görmemesi gerekiyor. Proje oluşturma/silme, takım yönetimi ve ayarlar da assessor'dan gizlenmeli. Bu hem web hem mobil için geçerli.

---

## iOS Uygulaması — Başlama Adımları

İki tarafta iş var: önce **Web (Dulra)** tarafında eksikler tamamlanacak, sonra **Mobil (Dulra Mobile)** tarafı kurulacak. Mobil uygulama ayrı bir projede olacak ama aynı Supabase backend'ini kullanacak.

### Faz 1 — Web Tarafı Hazırlıkları (Dulra Web)

Bu adımlar mevcut Next.js projesinde yapılacak. Mobil uygulama web'deki şablonları çekeceği için önce web tarafının hazır olması gerekiyor.

1.) 🌐 **Yeni alan tiplerini ekle** — `survey-field-definitions.ts` dosyasındaki `FieldType` union'ına `photo`, `gps` tiplerini ekle. `SurveyFieldDefinition` interface'ine bu tiplerin ihtiyaç duyduğu ek alanları ekle (örn: photo için `maxPhotos`, gps için `accuracy`).

2.) 🌐 **Koşullu alan desteği ekle** — `SurveyFieldDefinition` interface'ine `visible_when` özelliği ekle. Format: `{ field: string, operator: 'eq' | 'neq' | 'gt' | 'lt', value: string | number | boolean }`.

3.) 🌐 **Tekrarlanabilir bölüm desteği ekle** — `SurveySection` interface'ine `repeatable: boolean` ve `maxRepeat?: number` özelliklerini ekle.

4.) 🌐 **Template editor'ü güncelle** — `field-editor.tsx`'deki alan tipi dropdown'ına yeni tipleri (photo, gps) ekle. Her tip için gerekli konfigürasyon alanlarını göster.

5.) 🌐 **Web form renderer'ı güncelle** — `dynamic-field-renderer.tsx`'deki switch'e yeni tipler için case'ler ekle: photo → dosya yükleme bileşeni, gps → koordinat girişi veya haritadan nokta seçme. Ayrıca `visible_when` kontrolünü ve `repeatable` bölüm desteğini ekle.

6.) 🌐 **Test et** — Web'de yeni tiplerle bir şablon oluştur, bir survey başlat, doğru çalıştığını doğrula. Build hatasız geçmeli.

### Faz 2 — Mobil Proje Kurulumu

7.) ✅ **Expo projesi oluştur** — Ayrı bir klasörde `npx create-expo-app dulra-mobile` ile yeni proje oluştur. TypeScript şablonu kullan.

8.) ✅ **Temel paketleri kur** — `expo-sqlite`, `expo-file-system`, `expo-camera`, `expo-location`, `@supabase/supabase-js`, `@react-native-community/netinfo`, `expo-secure-store`.

9.) ✅ **Supabase bağlantısını kur** — Aynı `SUPABASE_URL` ve `SUPABASE_ANON_KEY` değerlerini kullan. `@supabase/supabase-js` ile doğrudan `createClient` oluştur, storage parametresine `expo-secure-store` ver.

10.) ✅ **Navigasyon yapısını kur** — Ekran akışı: Login → Proje Listesi → Proje Detay → Anketler (Aktif / Tamamlanan sekmeleri) → Anket Formu.

### Faz 3 — Temel Ekranlar

11.) ✅ **Login ekranı** — Supabase Auth ile email/şifre girişi. Token'ı `expo-secure-store`'da sakla. Oturum kontrolü ile otomatik yönlendirme.

12.) ❌ **Proje listesi ekranı** — Supabase'den kullanıcının erişim yetkisi olan projeleri çek ve listele. Proje adı, durumu, son güncelleme tarihi gösterilecek.

13.) ❌ **Proje detay / anket listesi ekranı** — Seçilen projeye ait anketleri listele. İki sekme: "Aktif Anketler" ve "Tamamlanan Anketler". "Yeni Anket Başlat" butonu: survey tipi seçtirip Supabase'den o tipin JSON şablonunu çeker.

### Faz 4 — Dinamik Form Sistemi (Mobil)

14.) ❌ **Mobil dinamik form renderer yaz** — Web'deki `dynamic-field-renderer.tsx` mantığının React Native versiyonu. JSON şablonundaki her alan tipine göre doğru native bileşeni çiz: text → TextInput, number → sayı klavyeli TextInput, select → Picker veya BottomSheet, boolean → Switch, date → DateTimePicker, photo → kamera butonu, gps → otomatik konum alma.

15.) ❌ **Tekrarlanabilir bölüm desteği** — `repeatable: true` olan bölümler için "Yeni gözlem ekle" butonu. Her kopya ayrı veri tutar.

16.) ❌ **Koşullu alan desteği** — `visible_when` kuralına göre alanları göster/gizle.

### Faz 5 — Kamera ve GPS

17.) ❌ **Fotoğraf çekme** — `expo-camera` ile kamera açılır, çekilen fotoğraf `expo-file-system`'deki uygulama dizinine kaydedilir. Dosya yolu SQLite'a yazılır.

18.) ❌ **GPS konum alma** — `expo-location` ile mevcut koordinatları al. GPS tipindeki alanlara otomatik yaz. Fotoğraflara da koordinat ekle.

19.) ❌ **Watermark ekleme** — `@shopify/react-native-skia` ile her fotoğrafa tarih, koordinat ve proje adı içeren filigran bas. Not: `expo-image-manipulator` metin yazma desteklemiyor, Skia fotoğraf üzerine metin çizebiliyor.

### Faz 6 — Offline ve Senkronizasyon

20.) ❌ **SQLite veritabanı şemasını tasarla** — Tablolar: `surveys` (anket verileri), `photos` (fotoğraf meta + dosya yolu), `sync_queue` (senkronize bekleyenler). Her kayıtta `sync_status`: pending / synced / failed.

21.) ❌ **Offline kaydetme** — Form doldurulduğunda veri SQLite'a yazılır. İnternet yoksa `sync_status = pending` olarak kalır.

22.) ❌ **Otomatik senkronizasyon** — `NetInfo` ile bağlantı durumunu dinle. İnternet geldiğinde `sync_queue`'daki bekleyen kayıtları Supabase'e yaz. Fotoğrafları Supabase Storage'a yükle, dönen URL'yi veritabanına kaydet.

### Faz 7 — Veri Erişimi ve Düzenleme

23.) ❌ **Habitat haritalama verilerine erişim** — Supabase'den projenin habitat poligonlarını ve hedef notlarını çek. Harita üzerinde veya liste olarak göster (salt okunur).

24.) ❌ **Anket düzenleme** — Tamamlanmış veya devam eden anketlerin verileri düzenlenebilecek. Değişiklikler SQLite'a yazılır, senkronizasyon ile Supabase'e aktarılır.

### Faz 8 — Test ve Yayın

25.) ❌ **Uçtan uca test** — Tam akışı test et: login → proje seç → anket başlat → form doldur (photo + gps) → offline kaydet → internet gelince senkronize et → web'de veriyi gör.

26.) ❌ **TestFlight'a yükle** — iOS build al, Apple Developer hesabına yükle, TestFlight üzerinden test kullanıcılarına dağıt.
