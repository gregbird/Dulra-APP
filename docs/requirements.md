# iOS Uygulama Gereksinimleri

> Tasarım sade ve temiz olmalıdır.

## Temel Kullanıcı Akışı ve İşlevler

### Kullanıcı Girişi (Authentication)
- Kullanıcılar uygulamaya giriş yapabilmelidir.

### Proje Yönetimi
- Giriş yapıldığında, kullanıcının erişebildiği tüm projeler listelenmelidir.
- Kullanıcı çalışmak istediği projeyi seçer.

### Anket/Araştırma Yönetimi (ör. Relevé Araştırması)
- Masaüstü uygulamasında başlatılan araştırmalar (ör. Relevé Araştırması), kullanıcı mobil uygulamaya giriş yaptığında hemen erişilebilir olmalıdır.
- Kullanıcılar tek bir saha ziyaretinde birden fazla araştırma yapabilmelidir. Bunun için açık bir "Yeni Araştırma Ekle" seçeneği bulunmalıdır.
- Tamamlanan araştırmalar, ayrı bir "Tamamlanan Araştırmalar" sekmesine taşınmalıdır.
- Kullanıcılar araştırma verilerini uygulama içinden düzenleyebilmeli veya güncelleyebilmelidir.

### Veri Erişimi ve Girişi
- Kullanıcılar mevcut Habitat haritalama ve hedef notları verilerine tam erişime sahip olmalıdır. Bu verilerin masaüstü uygulamasından mı yoksa başka bir yerden mi girildiği fark etmez.

### Fotoğraf Çekimi
- Uygulama, kullanıcıların sahada fotoğraf çekmesine olanak tanımalıdır.
- Her fotoğrafa otomatik olarak filigran (watermark) eklenmeli ve GPS koordinatları ile etiketlenmelidir.

## Veri Senkronizasyonu ve Kalıcılık

### Çevrimdışı Çalışma
- Tüm araştırma verileri ve fotoğraflar, internet bağlantısı (mobil veri veya Wi-Fi) olmasa bile uygulamada otomatik olarak yerel depolamaya kaydedilmelidir.

### Senkronizasyon
- İnternet bağlantısı yeniden sağlandığında, yerel olarak kaydedilmiş tüm veriler otomatik olarak senkronize edilmelidir. Veriler hem mobil uygulamadaki ilgili projeye hem de masaüstü uygulamasındaki karşılık gelen projeye kaydedilmelidir.
