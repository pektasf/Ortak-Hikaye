# Ortak Roman — UX denetimi ve uygulama planı

Bu belge mevcut uygulama üzerinde yapılan ilk kaynak kodu/veritabanı incelemesinin bulgularını ve onaylanan geliştirme sırasını kaydeder. Tamamlandı işaretleri yalnızca kod ve testle doğrulanan işler için kullanılmalıdır.

## Ürün yönü

Ortak Roman; kitap, hikâye, yazma oturumları ve yazar topluluğunu bir araya getiren edebî üretim platformu olarak geliştirilecektir. Tek bir ortak roman akışı korunurken üç yazım deneyimi hedeflenir:

1. **Ortak roman:** Katılımcılar aynı metni sırayla geliştirir.
2. **Aynı konu, ayrı yorumlar:** Katılımcılar aynı brief üzerinden birbirinden bağımsız metinler üretir; tamamlandığında birlikte okunur.
3. **Kelime zinciri:** Katılımcılar belirlenmiş kelime sayısı veya tur kuralıyla canlı, sırayla ortak metin oluşturur.

Bu deneyimler tek hesap, ortak yazar profili ve ortak kitaplık içinde sunulmalıdır.

## İlk inceleme bulguları

### Güçlü mevcut altyapı
- React 19 ve Vite tabanlı uygulama.
- Supabase Auth, PostgreSQL ve RLS.
- Kitap, hikâye, bölüm ve hikâye üyeliği.
- Davet bağlantıları ve üyelik akışı.
- Paragraf/blok yazarlığı ve bölüm sürüm geçmişi.
- Taslak kaydı ve yazma kilidi.
- Okuma ilerlemesi, sayfalı/kaydırmalı okuyucu ve cümle vurguları.
- Yazar profilleri, arama ve takip altyapısı.
- GitHub Actions ve GitHub Pages dağıtımı.

### Teknik riskler
- Ana uygulama mantığının büyük bölümü tek bir React dosyasında toplanmış.
- Global CSS dosyasında çok sayıda tarihsel/tekrarlanan kural bulunuyor.
- Yeni yazım modları için oturum, katılımcı, varyant, tur ve katkı kavramları mevcut hikâye tablolarına doğrudan sıkıştırılmamalı.
- Gerçek cihaz ve çoklu hesap uçtan uca testleri tamamlanmadan özellikler üretime hazır sayılmamalı.

### İlk doğrulanan düzeltme adayı
Hikâye ayarları kaydetme akışı `theme` alanını güncelliyor; ancak çalışma alanı yenilenirken hikâye SELECT alanları arasında `theme` bulunmuyordu. Bu nedenle konu/tema yenileme sonrasında yeniden yüklenmeyebilirdi. İlk UX temeli dalında bu alan SELECT listesine eklendi.

### UI/UX sorunları
- Hikâye konusu/teması önizlemesi uzun içerikte sınırsız büyüyebiliyor.
- Ayar textarea alanları dikey yeniden boyutlandırılabiliyor; bu da düzeni öngörülemez yapıyor.
- Kitap okuyucu mevcut kapak/sayfalama altyapısına sahip olsa da künye, içindekiler ve bölüm navigasyonu tek bir kitap deneyimi olarak tamamlanmalı.
- Ana sayfa, kitaplık, çalışma alanı, yazma stüdyosu ve okuyucu aynı tasarım sistemini paylaşmalı.
- Mobil kullanım ayrı bir kabul kriteri olmalı.

## Tasarım ilkeleri

- Editoryal/kitap estetiği ile modern ürün arayüzü dengelenmeli.
- Krem/kâğıt yüzeyler, koyu mürekkep metni ve ölçülü vurgu rengi kullanılmalı.
- Tekrarlanan CSS yamaları yerine token ve bileşen katmanları oluşturulmalı.
- Sayfa başına tek bir birincil eylem olmalı.
- Uzun metin alanları içerik büyüdükçe sayfayı kontrolsüz uzatmamalı; sınırlandırılmış ve kendi içinde kaydırılabilir olmalı.
- Okuma ve yazma deneyimleri farklı görsel ritimlere sahip olmalı.
- Klavye, dokunmatik ve ekran okuyucu erişilebilirliği korunmalı.
- Mevcut yazarlık, üyelik, taslak, sürüm ve okuma verileri korunmalı.

## Uygulama aşamaları

### Aşama 0 — Güvenli temel
- [x] İncelenen ana uygulama, stil ve ürün yol haritasını belirleme.
- [x] Yeni geliştirmeler için ayrı Git dalı açma.
- [x] Hikâye konu/tema alanının yenileme sorgusuna eklenmesi.
- [x] Uzun konu/tema önizlemesinin sınırlanması ve kendi içinde kaydırılması.
- [ ] Üretim derlemesi ve mevcut ana akışların doğrulanması (bu çalışma ortamında GitHub erişimi/DNS olmadığı için henüz çalıştırılamadı).

### Aşama 1 — Tasarım sistemi ve ana navigasyon
- [x] İlk renk, tipografi, ölçü, boşluk, radius, gölge ve odak tokenları tanımlandı.
- [ ] Ortak buton, input, textarea, kart, modal, bildirim ve boş durum bileşenlerinin tamamlanması.
- [x] Mevcut üst navigasyonun masaüstü/mobil görsel düzeni iyileştirildi; alt navigasyon ve ekran bazlı testler bekliyor.
- [x] Ana sayfa/kitaplık için kart, boşluk, yüzey ve mobil kırılım iyileştirmeleri yapıldı.
- [x] Kitaplık kartlarına sahiplik bilgisi, hikâye sayacı ve ilk kullanım için boş durum yönlendirmesi eklendi.
- [ ] Ana sayfa/kitaplık değişikliklerinin gerçek cihazlarda görsel doğrulaması.
- [ ] Çalışma alanı ve hikâye ayarları.
- [ ] Tablet/mobil uyum ve erişilebilirlik uçtan uca doğrulaması.

### Aşama 2 — Kitap okuyucu
- [ ] Kapak ve künye sayfaları.
- [x] Birden fazla bölümü olan kitaplarda tıklanabilir içindekiler ve bölüm seçimi eklendi.
- [ ] Önceki/sonraki bölüm ve kaldığın yerden devam.
- [ ] Sayfalı, açık kitap ve kaydırmalı düzenlerin tutarlı çalışması.
- [ ] Yazar atıfları, cümle vurguları ve okuma araçları.
- [ ] Küçük ekranlarda tek sayfa okuyucu.

### Aşama 3 — Yazma stüdyosu
- [ ] Odak modu ve yazı alanı hiyerarşisi.
- [ ] Taslak, otomatik kayıt ve yayın akışı.
- [ ] Sıra, kelime hakkı, katılımcı varlığı ve kilit durumu.
- [ ] Paragraf yazarlığı ve sürüm geçmişi.
- [ ] Bağlantı kopması ve eşzamanlı düzenleme testleri.

### Aşama 4 — Yazım oturumları
- [ ] Yazım oturumu ve katılımcı veri modeli.
- [ ] Ortak roman oturumunun mevcut hikâye modeline güvenli eşlemesi.
- [ ] Bağımsız yazar varyantları ve tamamlanma/yayın kuralları.
- [ ] Kelime zinciri turları, sıra yönetimi ve kelime sınırı.
- [ ] Realtime geçici yayın ve tur sonunda kalıcı kayıt.
- [ ] RLS, RPC ve çoklu hesap testleri.

### Aşama 5 — Topluluk ve oyunlaştırma
- [ ] Süreli etkinlikler ve yazım meydan okumaları.
- [ ] Kelime hedefleri ve ilerleme.
- [ ] Tema/brief kütüphanesi.
- [ ] Eser keşfi ve topluluk akışı.
- [ ] Moderasyon ve raporlama.

### Aşama 6 — Yayın kalitesi
- [ ] Masaüstü, tablet ve mobil uçtan uca test.
- [ ] Erişilebilirlik ve performans kontrolü.
- [ ] Veri bütünlüğü ve yetki testleri.
- [ ] GitHub Actions derlemesi.
- [ ] Canlı Pages dağıtımının doğrulanması.

## Korunacak veri ve davranışlar

- Kullanıcı kimlikleri ve mevcut anonim hesaplar.
- Kitaplar, hikâyeler, bölümler ve üyelikler.
- Paragraf yazarları ve düzenleyen bilgileri.
- Bölüm sürüm geçmişleri.
- Taslaklar ve okuma ilerlemesi.
- Cümle vurguları ve yazar profilleri.
- Davet token'ları ve mevcut RLS sınırları.

## Değişiklik yönetimi

- İlk geliştirmeler ayrı dalda yapılır; doğrudan `main` dalına yazılmaz.
- Her aşama küçük, gözden geçirilebilir commit'lere bölünür.
- Veritabanı değişikliği gerektiren her iş migration ve RLS testiyle yapılır.
- Kullanıcı içeriği ve üretim verisi üzerinde deneme yapılmaz.
- Build ve kritik akış testleri başarılı olmadan ana dala birleştirme veya canlıya alma yapılmaz.
