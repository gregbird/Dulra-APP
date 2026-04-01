# iOS App Requirements

> Original client requirements + implementation status

---

## 1. User Authentication

> *"Users must be able to log in to the application."*

- [x] Supabase Auth ile email/password login
- [x] Token `expo-secure-store`'da saklanir
- [x] Oturum kontrolu ile otomatik yonlendirme

## 2. Project Management

> *"A list of all accessible projects should be displayed upon login. Users select a specific project to work on."*

- [x] Giris sonrasi rol bazli proje listesi (admin: tumu, diger: member + created_by)
- [x] Proje secimi → proje detay ekrani (surveys, habitats, target notes)

## 3. Survey Management

> *"Surveys initiated on the desktop application (e.g., a Releve Survey) must be immediately accessible upon the user logging into the mobile app."*

- [x] `cacheAllData()` ile tum survey'ler app acilisinda cekilir
- [x] Desktop'ta olusturulan survey'ler mobilde gorunur ve duzenlenebilir

> *"Users require the option to conduct multiple surveys within a single field visit, facilitated by a clear 'Add another survey' option."*

- [x] Proje detay ve survey listesinde "Start New Survey" butonu
- [x] SurveyTypePicker ile survey tipi secimi (releve, vb.)

> *"Completed surveys should be moved to a dedicated 'Completed Survey' tab."*

- [x] Survey listesinde in_progress / completed filtreleme

> *"Users must be able to edit or amend survey data directly within the app."*

- [x] Mevcut survey'ler acilip duzenlenebilir (online ve offline)
- [x] Releve form: section bazli alanlar + species girisi

## 4. Data Access

> *"Users require full access to existing Habitat mapping and target notes data, regardless of whether it was initially inputted on the desktop application or not."*

- [x] Habitat polygon verileri goruntulenebilir (read-only, cache destekli)
- [x] Target notes verileri goruntulenebilir (read-only, cache destekli)
- [x] Offline'da cache'den erisilebilir

## 5. Photography

> *"The app must allow users to take photographs in the field. Each photograph must be automatically watermarked and geo-coordinate tagged."*

- [x] `expo-camera` ile fotograf cekme
- [x] `expo-location` ile GPS koordinat ekleme
- [x] `WatermarkEngine` ile otomatik watermark (tarih, koordinat, proje adi)
- [x] Fotograflar survey'e baglanir, Supabase Storage'a yuklenir

## 6. Offline Capability

> *"All survey data and photographs must be automatically saved locally within the app, ensuring data persistence even when there is no cellular network or Wi-Fi connection."*

- [x] `expo-sqlite` ile lokal veritabani (pending_surveys, pending_photos)
- [x] Form verileri + fotograflar offline kaydedilebilir
- [x] Cache tablolari ile mevcut veriler offline okunabilir

## 7. Auto-Sync

> *"Upon regaining access to a cellular network and/or Wi-Fi, all locally saved data must automatically synchronize and be saved to both the relevant project within the mobile app and the corresponding desktop application project."*

- [x] `NetInfo` listener ile baglanti durumu izlenir
- [x] Internet geldiginde `syncPendingData()` otomatik calisir
- [x] Survey verileri + fotograflar Supabase'e sync edilir
- [x] Sync sonrasi lokal cache guncellenir
- [x] Basarisiz cache'leme internet geldiginde otomatik retry

---

## Web Tarafinin Sorumlulugu (scope disinda)

Asagidaki maddeler mobil uygulama scope'unda degil — web (Dulra) tarafinda yapilmasi gereken isler:

- [ ] Tekrarlanabilir bolum destegi (repeatable sections)
- [ ] Kosullu alan destegi (visible_when)
- [ ] Template editor'de yeni alan tipleri (photo, gps)
- [ ] Rol bazli erisim kontrolu (assessor vs admin)

---

## Ek Calisma: Multi-Site (Faz 3)

Orijinal requirements'ta istenmemis ancak proje yapisinda `project_sites` tablosu mevcut. Ileride eklenecek:

- [ ] SQLite'ta `cached_project_sites` tablosu
- [ ] `cacheAllData()`'a project_sites sorgusu
- [ ] Survey olusturmada site_id destegi
- [ ] Proje detayinda site secim UI
- [ ] Listeleri site bazli filtreleme
