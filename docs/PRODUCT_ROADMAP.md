# Ortak Roman — Ürün ve Geliştirme Yol Haritası

Bu belge ürün kararlarının ve uygulama sırasının tek referansıdır. Tamamlandı olarak işaretlenen işler kod, veritabanı ve uygun testlerle doğrulanmadan tamamlanmış sayılmaz.

## Kesinleşen ürün kararları
- Tek kitap altında birden fazla hikâye bulunur.
- Her yazar kendi hikâyesini oluşturabilir.
- Bir hikâyeye davet edilen yazar aynı hikâyeye başka yazarları da davet edebilir.
- Davet yalnızca ilgili hikâyeye yazar üyeliği verir; global yönetici yetkisi vermez.
- Her hikâye bölümlere ayrılır; hikâye üyeleri bölüm oluşturup düzenleyebilir, hikâye sahibi silebilir.
- Okuma ilerlemesi kullanıcı ve hikâye bazında tutulur.
- Okuma deneyimi sayfalı veya kesintisiz kaydırmalı olacak.
- Tasarım klasik kitap estetiği ile modern, sade yönetim arayüzünü birleştirir.

## Aşama 0 — Temel altyapı
- [x] GitHub Pages ve Supabase bağlantısı
- [x] E-posta OTP oturumu
- [x] İlk sahip hesabı ve rol tabanlı erişim
- [x] Eski global yazma kilidi akışının istemci erişimini kapatma
- [x] GitHub Actions üretim derlemesi

## Aşama 1 — Hikâye ve bölüm mimarisi
- [x] Kitap, hikâye, bölüm ve hikâye üyeliği tabloları
- [x] Hikâye kapsamlı davet token'ları ve davet redeem RPC'si
- [x] Üye yazarların kendi hikâyelerini oluşturması
- [x] Hikâye üyelerinin davet oluşturabilmesi
- [x] Hikâye üyelerinin bölüm oluşturup düzenleyebilmesi
- [x] Bölüm silme yetkisinin hikâye sahibine sınırlandırılması
- [x] Eski `story_entries` verisini arşiv hikâyesine taşıma migration'ı
- [x] Eski kitap-geneli yazma tabloları ve RPC'lerini istemciden kapatma
- [x] Bölüm sürüm geçmişi
- [x] Kullanıcı/hikâye bazlı okuma ilerlemesi tablosu ve son bölümün hatırlanması
- [x] RLS helper fonksiyonlarını API'ye açık `public` şemasından `private` şemasına taşıma
- [ ] İki ayrı kullanıcı hesabıyla davet, erişim izolasyonu ve ortak düzenleme uçtan uca testi
- [ ] Hikâye başlığı/açıklaması/durumu düzenleme ve sıralama arayüzü
- [ ] Bölüm sıralama ve yeniden adlandırma akışını kullanıcı testiyle doğrulama

## Aşama 2 — Okuma deneyimi
- [ ] Kitap kapağı, başlık sayfası ve içindekiler
- [ ] Hikâye ve bölüm gezintisi; önceki/sonraki bölüm
- [ ] Sayfalı okuma modu
- [ ] Kesintisiz kaydırma modu
- [ ] Son okunan paragraf/scroll konumunu otomatik kaydetme
- [ ] Yer imleri ve kaldığın yerden devam et
- [ ] Yazı tipi/boyutu, satır aralığı ve sepya/açık/koyu temaları
- [ ] Mobil ve masaüstünde erişilebilir okuma deneyimi

## Aşama 3 — Metin etkileşimleri
- [ ] Metin aralığına bağlı kişisel alt çizme/vurgulama
- [ ] Kişisel vurguların yalnızca ilgili okuyucuya özel tutulması
- [ ] Ortak öne çıkan cümleler
- [ ] Paragraf/cümle bazlı yorumlar ve yanıtlar
- [ ] Yorum moderasyonu ve raporlama
- [ ] Metin değiştiğinde vurguların korunması için kalıcı anchor stratejisi

## Aşama 4 — Yönetici ve yazar paneli
- [ ] Kitap kimliği, kapak ve okuma görünümü ayarları
- [ ] Hikâye/bölüm sıralama ve yayın akışı
- [ ] Hikâye üyeleri ve davet bağlantısı yönetimi/iptali
- [ ] Katkı geçmişi ve sürüm karşılaştırma
- [ ] Yorum ve topluluk moderasyonu
- [ ] Kitap, hikâye ve bölüm bazında genel bakış

## Aşama 5 — Katkı ve okuma istatistikleri
- [ ] Yazar bazında yazılan/düzenlenen kelime istatistikleri
- [ ] Hikâye/bölüm bazında katkı dağılımı
- [ ] Okuma ilerlemesi ve toplu okuma istatistikleri
- [ ] Yorum, yer imi ve ortak vurgulama etkileşimleri
- [ ] Ham kelime sayısından ibaret olmayan adil katkı ölçümü

## Teknik ilkeler ve kabul kriterleri
1. Önce GitHub ana dalı ve canlı Supabase şeması kontrol edilir; aynı iş tekrar edilmez.
2. Her veritabanı değişikliği migration dosyasıyla sürümlenir.
3. Her tabloda RLS ve en az ayrıcalık ilkesi uygulanır.
4. Kullanıcı bir hikâyenin üyesi değilse o hikâyenin içeriğini göremez.
5. Davet redeem işlemi global erişim veya yönetici rolü vermez.
6. Yayın öncesi production build ve uygun akış testleri yapılır.
7. GitHub Actions başarılı olmadan canlıya alındığı söylenmez.

## Şu anki öncelik
1. Canlı Pages dağıtımını doğrula.
2. Ana yönetici hesabıyla ilk hikâyeyi oluşturup bölüm ekle.
3. İkinci test hesabını hikâye davetiyle dahil et.
4. İkinci hesabın yalnızca davet edildiği hikâyeyi gördüğünü; bölüm yazıp kaydedebildiğini; davet oluşturabildiğini doğrula.
5. Sonra okuma ekranı ve kitap içindekiler deneyimini geliştir.


## Yeni ürün geliştirmeleri
- [x] Hikâye sahibine hikâyeyi ve bağlı kayıtları güvenli biçimde silme
- [x] Defter veya geniş Word benzeri alan seçilebilen odaklı yazma ekranı
- [x] Yazar profili, düzenlenebilir görünen ad ve biyografi
- [x] Hikâye, katılım, bölüm, davet ve bölüm düzenleme istatistikleri
- [ ] Gerçek paragraf/metin bloğu bazlı yazarlık ve kelime katkısı
- [ ] Cümle vurguları ve yazarın cümlelerinin kaç kez vurgulandığı
- [ ] Profil görseli yükleme ve diğer yazarların profil sayfalarına geçiş


## Aşama 6 — Paragraf bazlı yazarlık ve katkı
- [x] Bölüm metnini paragraf bloklarına ayıran veri modeli
- [x] Yeni paragrafın ilk yazarını ve son düzenleyeni ayrı kaydetme
- [x] Eski bölüm metinlerini yazarı bilinmeyen arşiv blokları olarak koruma
- [ ] Paragraf katkı geçmişini ve kelime istatistiklerini profil sayfasında gösterme
- [ ] Paragraf silme/geri alma geçmişini görünür kılma
- [ ] Eşzamanlı düzenlemede çakışma kontrolü
