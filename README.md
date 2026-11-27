# Ortak Roman

Davet bağlantısıyla katılım sağlayan yazarların ortak bir hikâye oluşturduğu web uygulaması.

## Canlı yayın
- Site: https://pektasf.github.io/Ortak-Hikaye/
- Dağıtım: GitHub Actions → GitHub Pages
- Backend: Supabase (Auth, PostgreSQL, RLS, Realtime)

## Ürün kararları
- İlk kelime hedefi: **1.000**
- Katılım: **Davet bağlantısı ile**
- Hosting: **Ücretsiz katman**
- Tasarım: **Hybrid** — klasik kitap okuma estetiği + modern yönetim arayüzü

## Ürün yol haritası

Ürün kararları, kitap/hikâye/bölüm yapısı ve geliştirme aşamaları: [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md).

## Hızlı kurulum
Yayın, Supabase ve GitHub Actions yapılandırmasına ihtiyaç duyar. Adım adım yönerge: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

1. Yeni Supabase projesinde `supabase/schema.sql` dosyasının tamamını SQL Editor'de çalıştırın. Bu dosya temel şemayı ve hikâye/davet/güvenlik eklemelerini birlikte içerir. Mevcut projelerde yalnızca henüz uygulanmamış migration dosyalarını sırayla uygulayın; bootstrap dosyasını tekrar çalıştırmayın.
2. Email OTP sağlayıcısını açın; Supabase Site URL ve Redirect URL'lerini Pages adresine ayarlayın.
3. GitHub Actions repository secrets olarak `VITE_SUPABASE_URL` ve `VITE_SUPABASE_ANON_KEY` ekleyin.
4. Repository Settings → Pages → Source: **GitHub Actions**.
5. `main` dalına yapılan her push otomatik derlenir ve yayınlanır.

**Güvenlik:** Supabase `service_role` anahtarını hiçbir zaman frontend'e veya GitHub Actions secrets üzerinden Vite build'ine vermeyin. Yalnızca anon/public key kullanılır. Davet token'ları veritabanında SHA-256 özeti olarak saklanır ve RLS içerikleri yetkisiz hesaplardan gizler.

## Geliştirme
Node.js 22+, `npm install`, `.env.example` dosyasını `.env` olarak kopyalama ve `npm run dev`.

## Durum
GitHub Actions dağıtım workflow'u ve davet doğrulama altyapısı depoda. İlk canlı kullanım için Supabase projesi, iki GitHub Actions secret'ı ve ilk sahip hesabı bootstrap adımı gerekir.