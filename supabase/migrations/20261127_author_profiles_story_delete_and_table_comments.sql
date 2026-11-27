-- Story deletion, author profiles and explanatory table/column comments.
alter table public.profiles add column if not exists bio text not null default '', add column if not exists avatar_url text;
alter table public.profiles drop constraint if exists profiles_bio_length_check;
alter table public.profiles add constraint profiles_bio_length_check check (char_length(bio)<=500);

create or replace function public.delete_story(p_story_id uuid)
returns void language plpgsql security definer set search_path=public,private as $$
begin
 if auth.uid() is null or not private.is_story_owner(p_story_id) then raise exception 'Yalnızca kendi oluşturduğun hikâyeyi silebilirsin.'; end if;
 delete from public.stories where id=p_story_id;
 if not found then raise exception 'Hikâye bulunamadı.'; end if;
end $$;
revoke all on function public.delete_story(uuid) from public,anon;
grant execute on function public.delete_story(uuid) to authenticated;

create or replace function public.get_author_profile(p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_user_id uuid:=coalesce(p_user_id,auth.uid()); v_profile public.profiles%rowtype; v_shared boolean;
begin
 if auth.uid() is null or v_user_id is null then raise exception 'Profil görüntülemek için giriş yapmalısın.'; end if;
 select exists(select 1 from public.story_members mine join public.story_members theirs on theirs.story_id=mine.story_id where mine.user_id=auth.uid() and theirs.user_id=v_user_id) into v_shared;
 if v_user_id<>auth.uid() and not v_shared then raise exception 'Bu profili görüntülemek için aynı hikâyenin üyesi olmalısın.'; end if;
 select * into v_profile from public.profiles where id=v_user_id;
 if not found then raise exception 'Yazar profili bulunamadı.'; end if;
 return jsonb_build_object(
  'id',v_profile.id,'display_name',v_profile.display_name,'bio',coalesce(v_profile.bio,''),'avatar_url',v_profile.avatar_url,'member_since',v_profile.created_at,
  'stats',jsonb_build_object(
   'stories_created',(select count(*) from public.stories s where s.owner_id=v_user_id),
   'stories_joined',(select count(*) from public.story_members sm where sm.user_id=v_user_id and sm.role='writer'),
   'chapters_written',(select count(*) from public.chapters c where c.created_by=v_user_id),
   'words_in_started_chapters',(select coalesce(sum(case when btrim(c.content)='' then 0 else cardinality(regexp_split_to_array(btrim(c.content),'\s+')) end),0) from public.chapters c where c.created_by=v_user_id),
   'invites_sent',(select count(*) from public.story_invites si where si.created_by=v_user_id),
   'chapter_edits',(select count(*) from public.chapter_revisions cr where cr.editor_id=v_user_id),
   'sentences_highlighted',null
  )
 );
end $$;
revoke all on function public.get_author_profile(uuid) from public,anon;
grant execute on function public.get_author_profile(uuid) to authenticated;

create or replace function public.update_author_profile(p_display_name text,p_bio text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles%rowtype;
begin
 if auth.uid() is null then raise exception 'Önce giriş yapmalısın.'; end if;
 if p_display_name is null or char_length(btrim(p_display_name)) not between 2 and 40 then raise exception 'Görünen ad 2-40 karakter arasında olmalı.'; end if;
 if char_length(coalesce(p_bio,''))>500 then raise exception 'Hakkımda alanı en fazla 500 karakter olabilir.'; end if;
 update public.profiles set display_name=btrim(p_display_name),bio=coalesce(btrim(p_bio),'') where id=auth.uid() returning * into v_profile;
 if not found then raise exception 'Profil kaydı bulunamadı.'; end if;
 return jsonb_build_object('id',v_profile.id,'display_name',v_profile.display_name,'bio',v_profile.bio);
end $$;
revoke all on function public.update_author_profile(text,text) from public,anon;
grant execute on function public.update_author_profile(text,text) to authenticated;

comment on table public.books is 'KİTAP | Ana kitap bilgileri ve genel ayarlar.';
comment on table public.profiles is 'YAZAR PROFİLLERİ | Kullanıcı görünen adı, rolü ve profil bilgileri.';
comment on table public.stories is 'HİKÂYELER | Kitap altındaki bağımsız hikâyeler; sahip, açıklama ve durum.';
comment on table public.chapters is 'BÖLÜMLER | Hikâye bölüm başlıkları, metinleri ve yayın durumu.';
comment on table public.story_members is 'HİKÂYE YAZARLARI | Hangi kullanıcının hangi hikâyeye hangi rolle katıldığı.';
comment on table public.story_invites is 'HİKÂYE DAVETLERİ | Hikâyeye özel, hash saklanan davet bağlantıları.';
comment on table public.chapter_revisions is 'BÖLÜM SÜRÜM GEÇMİŞİ | Önceki metin sürümleri ve düzenleyen yazar.';
comment on table public.reading_progress is 'OKUMA İLERLEMESİ | Kullanıcının hikâyede kaldığı bölüm ve konum.';
comment on table public.story_entries is 'ESKİ SİSTEM ARŞİVİ | Önceki kitap-geneli katkılar; yeni uygulama akışında kullanılmaz.';
comment on table public.writing_locks is 'ESKİ SİSTEM ARŞİVİ | Önceki global yazma kilitleri; yeni uygulama akışında kullanılmaz.';
comment on table public.story_votes is 'ESKİ SİSTEM ARŞİVİ | Önceki global oylamalar; yeni uygulama akışında kullanılmaz.';
comment on table public.invites is 'ESKİ SİSTEM ARŞİVİ | Önceki kitap-geneli davetler; yeni uygulama akışında kullanılmaz.';
comment on column public.profiles.display_name is 'Yazarın herkese gösterilen adı.';
comment on column public.profiles.bio is 'Yazarın kısa tanıtım metni; en fazla 500 karakter.';
comment on column public.profiles.avatar_url is 'Profil görseli URL adresi.';
comment on column public.stories.owner_id is 'Hikâyeyi oluşturan ve silebilen yazar.';
comment on column public.chapters.created_by is 'Bölümü ilk oluşturan yazar; tüm metnin yazarı anlamına gelmez.';
comment on column public.story_invites.token_hash is 'Davet tokenının kendisi değil SHA-256 özeti.';
comment on column public.reading_progress.scroll_position is 'Okuma ekranındaki dikey konum; şu an bölüm değişiminde sıfırlanır.';
