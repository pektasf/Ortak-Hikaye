# Ortak Roman — Teknik Mimari

## Ürün ve erişim modeli
- Bir kitap birden fazla hikâye içerir; her hikâye bölümlere ayrılır.
- Her yazar kendi hikâyesini oluşturabilir.
- Hikâyeye davet edilen yazar yalnızca davet edildiği hikâyeye katılır; global yönetici olmaz.
- Her hikâye üyesi aynı hikâyenin bölümlerini oluşturabilir ve düzenleyebilir.
- Bölüm silme ve hikâye yönetimi hikâye sahibine aittir.
- Davet bağlantısı 7 gün geçerlidir; token'ın yalnızca SHA-256 özeti saklanır.
- Eski kitap-geneli yazım akışı devre dışıdır; tarihsel tablolar veri kaybını önlemek için korunur.

## Uygulama katmanları
```text
React / Vite
  ├─ features/book/App.jsx       Hikâye kütüphanesi, bölüm listesi, editör
  ├─ components/setup            Supabase kurulum ekranı
  ├─ lib/supabase                İstemci ve oturum
  └─ styles                      Kitap odaklı arayüz

Supabase
  ├─ Auth                        E-posta OTP
  ├─ public.stories              Hikâyeler
  ├─ public.chapters             Bölüm metinleri
  ├─ public.story_members        Hikâye bazlı üyelik/rol
  ├─ public.story_invites        Hash'lenmiş davetler
  ├─ public.chapter_revisions    Önceki bölüm sürümleri
  ├─ public.reading_progress     Kullanıcının hikâye içindeki son bölümü
  ├─ private.*                   RLS için API'ye açılmayan yetki yardımcıları
  └─ RLS + RPC                   Sunucu tarafı erişim sınırları

GitHub Actions → GitHub Pages
  └─ Vite production build ve statik dağıtım
```

## Veritabanı adlandırma standardı
- Tablo ve kolonlar İngilizce `snake_case` kullanır.
- Tekil varlık adları tablo adı olarak kullanılır: `stories`, `chapters`.
- Birincil anahtar `id`; yabancı anahtar `<entity>_id`.
- Zaman alanları `created_at`, `updated_at`; üyelik zamanı `joined_at`.
- Bağlantı tabloları iki varlığın adını taşır: `story_members`.
- Her tablo için RLS açık olmalı; istemci yetkileri en az ayrıcalık ilkesine göre verilir.

## Veri ilişkileri
- `books 1—N stories`
- `stories 1—N chapters`
- `stories N—N profiles` ilişkisi `story_members` üzerinden kurulur.
- `stories 1—N story_invites`
- `chapters 1—N chapter_revisions`
- `profiles 1—N reading_progress`; her kullanıcı-hikâye çifti için tek kayıt.

## Güvenlik sınırları
- Hikâye erişiminin kaynağı `story_members` üyeliğidir; `profiles.access_granted` yeni hikâye erişiminde kullanılmaz.
- Davet redeem işlemi yalnızca ilgili hikâyeye `writer` üyeliği ekler; global erişim veya yönetici rolü vermez.
- Her hikâye üyesi yalnızca üyesi olduğu hikâyeyi ve bölümlerini görebilir.
- Bölüm oluşturma/düzenleme hikâye üyelerine, silme hikâye sahibine aittir.
- Okuma ilerlemesi yalnızca kaydı oluşturan kullanıcı tarafından okunup güncellenebilir.
- Policy helper fonksiyonları `private` şemasındadır; PostgREST'in public API yüzeyine açılmaz.
- `create_story_invite` ve `redeem_story_invite` bilinçli olarak sunucu yetkili RPC uçlarıdır; girdileri ve üyelik koşulları fonksiyon içinde doğrulanır.
- `service_role` anahtarı istemciye veya Vite değişkenlerine konmaz.

## Eski şemanın durumu
- `story_entries`, `writing_locks`, `story_votes` ve kitap-geneli `invites` artık istemciden okunamaz/yazılamaz; ilgili RPC izinleri kaldırılmıştır.
- Migration sırasında eski `story_entries` kayıtları varsa `Ortak Roman — Arşiv` hikâyesine bölüm olarak aktarılır.
- Eski tablolar fiziksel olarak silinmez. Veri bütünlüğü ve geri dönüş için arşiv olarak tutulur.
- `profiles.access_granted` kolonu eski hesapların geçmişi için korunur; yeni erişim denetiminin yerine geçmez.

## Migration ilkesi
- Her canlı şema değişikliği `supabase/migrations/` altında SQL olarak saklanır.
- `supabase/schema.sql` yeni Supabase projesi için tam bootstrap dosyasıdır.
- Mevcut projede bootstrap dosyası tekrar çalıştırılmaz; yalnızca eksik migration uygulanır.
- Migration'lar veri silmeden ve geriye dönük uyumu gözeterek hazırlanır.
