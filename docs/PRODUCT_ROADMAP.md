# Ortak Roman — Ürün ve Geliştirme Yol Haritası

Bu belge ürün kararlarının ve uygulama sırasının tek referansıdır. Tamamlandı olarak işaretlenen işler GitHub'da kodu ve testleri doğrulanmadan tamamlanmış sayılmaz.

## Kesinleşen ürün kararları

- Tek bir kitap altında birden fazla hikâye oluşturulabilir.
- Her davetli yazar kendi hikâyesini oluşturabilir ve yalnızca kendi hikâyesine katılmaları için davet bağlantısı üretebilir.
- Hikâye daveti, kişiye genel kitap yöneticiliği vermez; erişim ilgili hikâyeyle sınırlıdır.
- Her hikâye kendi içinde bölümlere ayrılabilir.
- Yönetici ihtiyaç oldukça hikâye veya bölüm oluşturabilir; sıralayabilir, yeniden adlandırabilir, taslağa alabilir ve yayımlayabilir.
- Okuyucu iki okuma biçiminden birini seçebilir: sayfa sayfa kitap görünümü veya kesintisiz kaydırma.
- Okuma konumu kullanıcı bazında kaydedilir; okuyucu kaldığı sayfa/paragraftan devam eder.
- Tasarım, klasik kitap okuma hissi ile sade ve modern yönetim arayüzünü birleştirir.
- Davetle katılım ve rol tabanlı erişim korunur.

## Aşama 0 — Mevcut temel

- [x] GitHub Pages dağıtımı ve Supabase bağlantısı
- [x] E-posta OTP oturumu ve davet doğrulama
- [x] İlk sahip hesabı ve rol tabanlı erişim
- [x] Yazma sırası kilidi
- [x] Kitap başlığı, alt başlığı, açıklaması ve kelime hedefleri için ilk yönetici formu
- [x] Kitap güncelleme izni için SQL grant ve RLS politikası kontrolü
- [ ] Yönetici ayar formunun canlı sitede uçtan uca testi

## Aşama 1 — Kitap içerik modeli

Amaç: Mevcut tek metin akışını, esnek kitap / hikâye / bölüm yapısına dönüştürmek.

- [x] İlk ek şema: hikâyeler, bölümler, hikâye üyeleri ve hikâyeye özel davetler (migration hazır; Supabase'te uygulanması bekleniyor)
- [ ] Veritabanı şeması: kitaplar, hikâyeler, bölümler, sıralama, durum (taslak/yayında), oluşturma ve güncelleme zamanları
- [ ] İçerik bloklarının bölüm ve hikâyeyle ilişkilendirilmesi
- [ ] Her paragraf/cümle için kalıcı kimlik ve yazar sahipliği; düzenleme geçmişi
- [x] Her yazar için hikâye oluşturma ve kendi hikâyesine özel davet bağlantısı üretme arayüzü (migration uygulandıktan sonra kullanılabilir)
- [ ] Yönetici için hikâye ve bölüm oluşturma, düzenleme, sıralama, yayımlama ve arşivleme
- [ ] Eski story_entries verisini kaybetmeden yeni yapıya geçiş ve doğrulama
- [ ] RLS: yalnızca yetkili roller yönetim işlemi yapabilir; davetsiz kullanıcı içerikleri göremez

## Aşama 2 — Okuma deneyimi

- [ ] Kitap kapağı, başlık sayfası ve içindekiler
- [ ] Hikâye ve bölüm gezintisi; önceki/sonraki bölüm
- [ ] Sayfalı okuma modu
- [ ] Kesintisiz kaydırma modu
- [ ] Okuma modu tercihini kullanıcı bazında hatırlama
- [ ] Son okunan hikâye, bölüm ve paragrafı otomatik kaydetme
- [ ] Yer imleri ve kaldığın yerden devam et
- [ ] Yazı tipi/boyutu, satır aralığı ve açık/koyu/sepya temaları
- [ ] Mobil ve masaüstünde erişilebilir, rahat okuma

## Aşama 3 — Metin etkileşimleri

- [ ] Metin aralığına bağlı kişisel alt çizme/vurgulama
- [ ] Alt çizgileri yalnızca ilgili okuyucuya özel tutma
- [ ] İsteğe bağlı ortak öne çıkan cümleler alanı
- [ ] Paragraf/cümle bazlı yorumlar ve yanıtlar
- [ ] Yorum moderasyonu ve raporlama
- [ ] Metin değiştiğinde eski vurguların bozulmaması için kalıcı metin aralığı/anchor stratejisi

## Aşama 4 — Gelişmiş yönetici paneli

- [ ] Genel bakış: kitap durumu, toplam kelime, hikâye ve bölüm sayısı
- [ ] Kitap kimliği: başlık, alt başlık, açıklama, kapak
- [ ] Okuma görünümü: varsayılan mod, tipografi ve tema seçenekleri
- [ ] Hikâye/bölüm içerik yönetimi ve sıralama
- [ ] Yazar davetleri, roller ve erişim yönetimi
- [ ] Yorum ve topluluk moderasyonu
- [ ] Taslak/yayın akışı ve değişiklik geçmişi

## Aşama 5 — Katkı ve okuma istatistikleri

- [ ] Yazar bazında yazılan, düzenlenen ve silinen kelime/karakter istatistikleri
- [ ] Katkı geçmişi ve sürüm karşılaştırma
- [ ] Hikâye/bölüm bazında katkı dağılımı
- [ ] Okuma ilerlemesi ve anonim/toplu okuma istatistikleri
- [ ] Yorum, yer imi ve ortak öne çıkan cümle etkileşimleri
- [ ] Katkı ölçümünde yalnızca ham kelime sayısına dayanmayan adil raporlama

## Teknik ilkeler ve kabul kriterleri

1. Önce mevcut GitHub ana dalı incelenir; aynı iş tekrar yapılmaz.
2. Her aşama küçük ve doğrulanabilir parçalara bölünür.
3. Veritabanı değişiklikleri migration dosyalarıyla sürümlenir; mevcut veriler korunur.
4. Her tablo için RLS ve gerekli en az yetki ilkesi uygulanır.
5. Kullanıcıya ait okuma konumu, tercihler, yer imleri ve vurgular hesap bazında saklanır.
6. Yayın öncesi build/test çalıştırılır; GitHub Actions başarılı olmadan canlıya alındığı söylenmez.
7. Her aşama sonrası canlı site ve temel kullanıcı akışları doğrulanır.

## Şu anki öncelik

1. `supabase/migrations/20261127_author_owned_stories.sql` dosyasını Supabase SQL Editor'de çalıştırıp hikâye tablolarını ve hikâyeye özel davet RPC'lerini etkinleştir.
2. Yazar hikâyesi oluşturma ve davetle katılma akışını iki farklı hesapla test et.
3. Sonra hikâye/bölüm içerik editörü ve yazarların ortak yazma akışını mevcut genel yazma sırasından bağımsızlaştır.
4. Okuma ekranı ve etkileşimleri bu içerik modelinin üzerine kur.
