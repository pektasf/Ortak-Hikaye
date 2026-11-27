# Ortak Roman — Proje Mimarisi

## Onaylı ürün kararları
- İlk kelime hedefi: **1.000**
- Katılım: **Davetli (invite-only)**
- Barındırma: **Ücretsiz katman** (Supabase Free + statik frontend hosting)
- Tasarım: **Hybrid** — okuma alanında klasik kitap estetiği, yönetim ve etkileşimlerde sade modern arayüz

## Katmanlar

```text
Browser
  └─ React UI (src/)
      ├─ features/book       Roman okuma ve yazma deneyimi
      ├─ components          Paylaşılan arayüz parçaları
      ├─ config              Onaylı ürün varsayılanları
      ├─ lib/supabase        Supabase istemci bağlantısı
      ├─ lib                 Saf yardımcılar
      └─ styles              Tasarım tokenları ve global stiller

Supabase (ücretsiz katman)
  ├─ Auth                   E-posta daveti / oturum
  ├─ Postgres               Kitap, katkı, kilit, oy, profil
  ├─ Realtime               Katkı ve sıra güncellemeleri
  └─ RLS + RPC              Yetki ve atomik yazma sırası

GitHub                    Kaynak kodu ve sürüm geçmişi
Vercel / Netlify          Ücretsiz statik frontend yayını
```

## Güven sınırları
Tarayıcıdaki görünürlük kontrolleri yetkilendirme değildir. Davetli kayıt, profil rolü, katkı ekleme, oy ve kilit işlemleri veritabanı RLS/RPC ile doğrulanmalıdır. `service_role` anahtarı istemciye konmaz.

## İlk kaynak
İlk HTML tabanlı Claude Artifact kaynağı çalışma alanında ayrı tutuluyor. GitHub deposuna legacy dosya aktarımı henüz tamamlanmadı; hedef konum `docs/legacy/Ortak-Roman-Claude-Artifact.html`.
