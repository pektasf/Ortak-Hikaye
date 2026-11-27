# Ortak Roman

Çok yazarlı, davetli katılıma dayalı ortak roman uygulaması.

## Ürün kararları
- İlk kelime hedefi: **1.000**
- Katılım: **Davetli (invite-only)**
- Barındırma: **Ücretsiz katman**
- Tasarım: **Hybrid** — klasik kitap okuma deneyimi + sade modern yönetim arayüzü

## Mimari
- React + Vite: web istemcisi
- Supabase Auth: davetli kullanıcı oturumları
- Supabase Postgres + RLS + RPC: kitap, katkı, oy ve sunucu taraflı yazma kilidi
- Supabase Realtime: eşzamanlı güncellemeler
- GitHub: kaynak kodu ve sürüm geçmişi
- Vercel / Netlify: ücretsiz statik frontend yayını

## Dizinler
- `src/features/book`: kitap deneyimi
- `src/components`: paylaşılan bileşenler
- `src/lib`: Supabase ve yardımcılar
- `src/styles`: tasarım sistemi
- `supabase`: veritabanı şeması ve güvenlik politikaları
- `docs/legacy`: ilk Claude Artifact kaynağının korunmuş kopyası

## Yerel geliştirme
1. Node.js 20+ kur.
2. `npm install`
3. `.env.example` dosyasını `.env` olarak kopyala.
4. Supabase URL ve anon key değerlerini gir.
5. `supabase/schema.sql` dosyasını Supabase SQL Editor'de çalıştır.
6. `npm run dev`

Supabase bağlantısı yapılandırılmadan uygulama kurulum ekranını gösterir. Canlı çok kullanıcılı kullanım; Supabase kurulumu, davet ayarları ve iki hesapla güvenlik/eşzamanlılık testleri tamamlanınca açılmalıdır.

## Güvenlik
- `service_role` anahtarını asla frontend'e ekleme.
- Public signup kapalı tutulmalı; kullanıcılar yönetici davetiyle katılmalı.
- Tarayıcıdaki rol/görünürlük kontrolleri güvenlik sınırı değildir; yetkiler RLS ve RPC ile doğrulanır.

## Kaynak kodun korunması
İlk HTML/Claude Artifact dosyası mevcut çalışma alanında ayrı bir kaynak olarak korunuyor. Bu ilk GitHub aktarımında legacy HTML henüz depoya eklenmedi; sonraki aktarımda `docs/legacy/` altına eklenecek.