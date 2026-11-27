# Supabase tablo sözlüğü
SQL Editor'de tabloların açıklamalarını görmek için canlı veritabanına uygulanan `COMMENT ON TABLE` ve `COMMENT ON COLUMN` açıklamaları kullanılır. Fiziksel tablo adları kod uyumluluğu için İngilizce snake_case olarak kalır.

| Tablo | Ekranda gösterilecek ad | Ne tutar |
|---|---|---|
| books | Kitaplar | Kitap adı, alt başlık ve genel ayarlar |
| profiles | Yazar profilleri | Görünen ad, biyografi ve kullanıcı rolü |
| stories | Hikâyeler | Hikâyenin sahibi, açıklaması ve durumu |
| chapters | Bölümler | Bölüm metni, başlığı ve yayın durumu |
| story_members | Hikâye yazarları | Hikâye-kullanıcı üyelikleri ve roller |
| story_invites | Hikâye davetleri | Hikâyeye özel davet token özetleri |
| chapter_revisions | Bölüm sürüm geçmişi | Önceki metin sürümleri ve düzenleyen |
| reading_progress | Okuma ilerlemesi | Kullanıcının kaldığı bölüm ve konum |
| story_entries | Eski katkı arşivi | Önceki kitap-geneli yazma akışı; yeni uygulama kullanmaz |
| writing_locks | Eski kilit arşivi | Önceki global yazma kilitleri |
| story_votes | Eski oylama arşivi | Önceki kitap-geneli oylamalar |
| invites | Eski davet arşivi | Önceki kitap-geneli davetler |

Eski tablolar veri kaybını önlemek için korunur. Yeni geliştirmelerde `stories`, `chapters`, `story_members`, `story_invites`, `chapter_revisions` ve `reading_progress` kullanılır.
