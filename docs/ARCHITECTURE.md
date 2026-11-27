# Ortak Roman — Proje Mimarisi

## Ürün kararları
- Katılım davet bağlantısıyla yapılır.
- Bir kitap birden fazla hikâye içerir; her hikâye bölümlere ayrılır.
- Hikâye sahibi ve hikâye yazarları, yalnızca üyesi oldukları hikâyeye davet gönderebilir.
- Davetle katılan kişi global yönetici olmaz; hikâye düzeyinde yazar üyeliği alır.
- Okuma deneyimi kitap düzeninde; yönetim ve yazarlık arayüzü sade ve erişilebilir olur.

## Katmanlar

```text
Browser
  └─ React UI (src/)
      ├─ features/book       Uygulama kabuğu ve mevcut yazma alanı
      ├─ components          Paylaşılan arayüz parçaları
      ├─ config              Ürün varsayılanları
      ├─ lib/supabase        Supabase istemcisi
      └─ styles              Tasarım tokenları ve global stiller

Supabase
  ├─ Auth                   E-posta OTP ve oturum
  ├─ Postgres               Profil, kitap, hikâye, bölüm, üyelik, davet
  ├─ Realtime               Mevcut ortak yazım akışındaki canlı güncellemeler
  └─ RLS + RPC              Veri erişimi ve davet doğrulaması

GitHub
  ├─ Source                 Uygulama ve SQL migration geçmişi
  └─ Actions / Pages        Derleme ve statik yayın
```

## Veritabanı adlandırma standardı
- Tablo ve kolonlar İngilizce, `snake_case`; tekil varlık adları tablo adı olarak kullanılır.
- Birincil anahtarlar `id`; ilişkiler `<entity>_id`; zaman alanları `created_at`, `updated_at`.
- Bağlantı tabloları `story_members` gibi iki varlığın adını taşır.
- Davet token'ları düz metin saklanmaz; yalnızca SHA-256 özeti saklanır.
- `invites` eski kitap-geneli davet akışıdır; `story_invites` hikâye kapsamındaki davet akışıdır. İkisi henüz tek modele taşınmamıştır.
- `story_entries`, `writing_locks` ve `story_votes` eski kitap-geneli yazma akışına aittir. Yeni `stories`/`chapters` modeliyle tam birleştirme henüz tamamlanmamıştır; bu nedenle eski tablolar silinmemeli veya yeniden adlandırılmamalıdır.

## Güvenlik sınırları
- Arayüzde buton gizlemek yetkilendirme değildir; her işlem RLS veya kontrollü RPC ile korunur.
- `service_role` / secret API key tarayıcıya veya Vite değişkenlerine konmaz.
- `invites` ve `story_invites` tablolarına doğrudan istemci erişimi verilmez; token işlemleri RPC üzerinden yürütülür.
- Trigger amaçlı SECURITY DEFINER fonksiyonları istemciden çağrılamaz.
- Hikâye üyeliğinin eski kitap-geneli erişimden tamamen ayrılması ve bölüm katkı akışının yeni modele taşınması sonraki refaktör aşamasıdır.

## Migration yaklaşımı
- Yeni şema değişiklikleri `supabase/migrations/` altında geriye dönük uyumlu SQL ile tutulur.
- Canlı veritabanına uygulanan her migration aynı SQL ile depoda da saklanır.
- `supabase/schema.sql` yalnızca yeni kurulum için tam bootstrap dosyasıdır; canlı projede migration geçmişinin yerine kullanılmaz.
