# Yayın ve ilk kurulum

## Yayın modeli
- Frontend: GitHub Pages (ücretsiz).
- CI/CD: GitHub Actions; her `main` push işleminde üretim derlemesi ve yayın.
- Auth, veritabanı, davet doğrulaması ve Realtime: Supabase Free.
- Site adresi: https://pektasf.github.io/Ortak-Hikaye/

## GitHub tarafı
1. Repository Settings → Pages → Build and deployment → Source: **GitHub Actions**. İlk etkinleştirmeyi GitHub arayüzünden yapın; bağlı GitHub uygulamasının Pages sitesini ilk kez oluşturma yönetim izni bulunmuyor.
2. Actions sekmesinde workflow çalışmasını izleyin.
3. Başarılı yayın sonrası Pages URL'si açılır.

## Supabase tarafı (gerekli, bu repo tarafından otomatik oluşturulamaz)
1. Supabase'te yeni Free proje oluşturun.
2. SQL Editor'de `supabase/schema.sql` dosyasının tamamını çalıştırın.
3. Authentication → Providers bölümünde Email'i etkinleştirin ve Email OTP/Magic Link kullanımını açık bırakın.
4. Authentication → URL Configuration:
   - Site URL: `https://pektasf.github.io/Ortak-Hikaye/`
   - Redirect URL allowlist: `https://pektasf.github.io/Ortak-Hikaye/**`
5. Project Settings → API bölümünden Project URL ve anon/public key değerlerini alın.
6. GitHub repository Settings → Secrets and variables → Actions → New repository secret:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon/public key
7. Workflow'u yeniden çalıştırın (Actions → Build and deploy Ortak Roman → Run workflow).

Anon key frontend'de kullanılmak üzere tasarlanmıştır. **service_role key'i GitHub secret'a veya frontend'e eklemeyin.**

## İlk sahip hesabı ve davetler
1. Site açıldıktan sonra ilk sahip hesabını oluşturmak için şu kurulum bağlantısını açın: `https://pektasf.github.io/Ortak-Hikaye/?setup=1`. Kendi e-posta adresinizle giriş bağlantısı isteyin.
2. İlk girişte profil erişimsiz oluşturulur. Supabase SQL Editor'de şu sorguyu kendi e-posta adresinizle çalıştırın:

```sql
update public.profiles p
set access_granted=true, role='owner'
from auth.users u
where p.id=u.id and u.email='SIZIN_EPOSTA_ADRESINIZ';
```

3. Uygulamadan çıkış yapıp tekrar giriş yapın.
4. Yönetici panelinden davet bağlantısı üretin. Varsayılan bağlantı 7 gün geçerlidir ve süresi dolana kadar sınırsız sayıda yeni hesap tarafından kullanılabilir.
5. Davet alan kişi linki açar, kendi e-postasına gönderilen OTP bağlantısıyla giriş yapar. Veritabanı token'ı doğrular ve hesabı yetkilendirir.

## Güvenlik notları
- İçerik tabloları anonim kullanıcılara açık değildir.
- Davet token'ları yalnızca SHA-256 özetiyle saklanır; istemciden davet tablosu okunamaz.
- Kullanıcı rolü ve davet yetkisi tarayıcıdan değiştirilemez.
- E-posta sağlayıcısının teslimat/rate limitleri Supabase planına ve SMTP ayarlarına bağlıdır. Üretim için özel SMTP yapılandırması önerilir.
- Supabase Free projeleri kullanılmadığında duraklatılabilir; ücretsiz hizmet garantili 7/24 sunucu değildir.

## Yerel geliştirme
`npm install`, `.env.example` dosyasını `.env` olarak kopyalayıp iki Vite değişkenini girin, ardından `npm run dev`.
