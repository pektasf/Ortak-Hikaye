-- Social author discovery/following, exclusive chapter writing presence and enforced word limits.
create table if not exists public.author_follows (
 follower_id uuid not null references public.profiles(id) on delete cascade,
 followed_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(follower_id,followed_id),
 constraint author_follows_no_self check(follower_id<>followed_id)
);
create index if not exists author_follows_followed_idx on public.author_follows(followed_id,created_at desc);
alter table public.author_follows enable row level security;
drop policy if exists "authenticated can read follows" on public.author_follows;
create policy "authenticated can read follows" on public.author_follows for select to authenticated using(true);
drop policy if exists "users follow as themselves" on public.author_follows;
create policy "users follow as themselves" on public.author_follows for insert to authenticated with check(follower_id=auth.uid() and followed_id<>auth.uid());
drop policy if exists "users unfollow as themselves" on public.author_follows;
create policy "users unfollow as themselves" on public.author_follows for delete to authenticated using(follower_id=auth.uid());
grant select,insert,delete on public.author_follows to authenticated;

create or replace function public.search_author_profiles(p_query text default '',p_limit integer default 30)
returns table(id uuid,display_name text,bio text,avatar_url text,followers_count bigint,following_count bigint,is_following boolean)
language sql stable security definer set search_path=public,private as $$
 select p.id,p.display_name,coalesce(p.bio,''),p.avatar_url,
  (select count(*) from public.author_follows f where f.followed_id=p.id),
  (select count(*) from public.author_follows f where f.follower_id=p.id),
  exists(select 1 from public.author_follows f where f.follower_id=auth.uid() and f.followed_id=p.id)
 from public.profiles p
 where auth.uid() is not null and p.id<>auth.uid()
 and (btrim(coalesce(p_query,''))='' or p.display_name ilike '%'||btrim(p_query)||'%' or p.bio ilike '%'||btrim(p_query)||'%')
 order by (select count(*) from public.author_follows f where f.followed_id=p.id) desc,p.created_at desc
 limit greatest(1,least(coalesce(p_limit,30),60));
$$;
revoke all on function public.search_author_profiles(text,integer) from public,anon;
grant execute on function public.search_author_profiles(text,integer) to authenticated;

create or replace function public.get_author_profile(p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_user_id uuid:=coalesce(p_user_id,auth.uid()); v_profile public.profiles%rowtype;
begin
 if auth.uid() is null or v_user_id is null then raise exception 'Profil görüntülemek için giriş yapmalısın.'; end if;
 select * into v_profile from public.profiles where id=v_user_id;
 if not found then raise exception 'Yazar profili bulunamadı.'; end if;
 return jsonb_build_object(
  'id',v_profile.id,'display_name',v_profile.display_name,'bio',coalesce(v_profile.bio,''),'avatar_url',v_profile.avatar_url,'member_since',v_profile.created_at,
  'is_following',exists(select 1 from public.author_follows f where f.follower_id=auth.uid() and f.followed_id=v_user_id),
  'followers_count',(select count(*) from public.author_follows f where f.followed_id=v_user_id),
  'following_count',(select count(*) from public.author_follows f where f.follower_id=v_user_id),
  'stats',jsonb_build_object(
   'stories_created',(select count(*) from public.stories s where s.owner_id=v_user_id),
   'stories_joined',(select count(*) from public.story_members sm where sm.user_id=v_user_id and sm.role='writer'),
   'chapters_written',(select count(*) from public.chapters c where c.created_by=v_user_id),
   'paragraphs_written',(select count(*) from public.chapter_blocks b where b.author_id=v_user_id),
   'words_authored_current',(select coalesce(sum(case when btrim(b.content)='' then 0 else cardinality(regexp_split_to_array(btrim(b.content),'\s+')) end),0) from public.chapter_blocks b where b.author_id=v_user_id),
   'paragraphs_last_edited',(select count(*) from public.chapter_blocks b where b.updated_by=v_user_id and b.author_id is distinct from v_user_id),
   'writers_invited',(select count(*) from public.story_members sm where sm.invited_by=v_user_id and sm.role='writer'),
   'invite_links_created',(select count(*) from public.story_invites si where si.created_by=v_user_id),
   'chapter_edits',(select count(*) from public.chapter_revisions cr where cr.editor_id=v_user_id),
   'sentences_highlighted',null));
end $$;
revoke all on function public.get_author_profile(uuid) from public,anon;
grant execute on function public.get_author_profile(uuid) to authenticated;

alter table public.stories add column if not exists target_words integer not null default 10000;
alter table public.chapters add column if not exists target_words integer not null default 1000;
alter table public.stories drop constraint if exists stories_target_words_check;
alter table public.stories add constraint stories_target_words_check check(target_words between 100 and 1000000);
alter table public.chapters drop constraint if exists chapters_target_words_check;
alter table public.chapters add constraint chapters_target_words_check check(target_words between 100 and 100000);

create table if not exists public.chapter_writing_locks(
 chapter_id uuid primary key references public.chapters(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 expires_at timestamptz not null,
 updated_at timestamptz not null default now()
);
alter table public.chapter_writing_locks enable row level security;
drop policy if exists "story members see chapter writing status" on public.chapter_writing_locks;
create policy "story members see chapter writing status" on public.chapter_writing_locks
 for select to authenticated using(exists(select 1 from public.chapters c where c.id=chapter_id and private.is_story_member(c.story_id)));
grant select on public.chapter_writing_locks to authenticated;

create or replace function public.acquire_chapter_writing_lock(p_chapter_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_user uuid; v_name text; v_expiry timestamptz;
begin
 if auth.uid() is null or not private.is_story_member((select story_id from public.chapters where id=p_chapter_id)) then raise exception 'Bu bölüme yazma erişimin yok.'; end if;
 insert into public.chapter_writing_locks(chapter_id,user_id,expires_at,updated_at)
 values(p_chapter_id,auth.uid(),now()+interval '35 seconds',now())
 on conflict(chapter_id) do update set user_id=excluded.user_id,expires_at=excluded.expires_at,updated_at=now()
 where public.chapter_writing_locks.expires_at<now() or public.chapter_writing_locks.user_id=auth.uid()
 returning user_id,expires_at into v_user,v_expiry;
 if v_user is null then
  select l.user_id,p.display_name,l.expires_at into v_user,v_name,v_expiry from public.chapter_writing_locks l join public.profiles p on p.id=l.user_id where l.chapter_id=p_chapter_id;
  return jsonb_build_object('acquired',false,'user_id',v_user,'display_name',coalesce(v_name,'Bir yazar'),'expires_at',v_expiry);
 end if;
 select display_name into v_name from public.profiles where id=v_user;
 return jsonb_build_object('acquired',true,'user_id',v_user,'display_name',coalesce(v_name,'Yazar'),'expires_at',v_expiry);
end $$;
create or replace function public.renew_chapter_writing_lock(p_chapter_id uuid)
returns boolean language plpgsql security definer set search_path=public,private as $$
begin
 update public.chapter_writing_locks set expires_at=now()+interval '35 seconds',updated_at=now()
 where chapter_id=p_chapter_id and user_id=auth.uid() and expires_at>now();
 return found;
end $$;
create or replace function public.release_chapter_writing_lock(p_chapter_id uuid)
returns void language sql security definer set search_path=public,private as $$
 delete from public.chapter_writing_locks where chapter_id=p_chapter_id and user_id=auth.uid();
$$;
revoke all on function public.acquire_chapter_writing_lock(uuid),public.renew_chapter_writing_lock(uuid),public.release_chapter_writing_lock(uuid) from public,anon;
grant execute on function public.acquire_chapter_writing_lock(uuid),public.renew_chapter_writing_lock(uuid),public.release_chapter_writing_lock(uuid) to authenticated;

create or replace function public.save_chapter_blocks(p_chapter_id uuid,p_title text,p_status text,p_blocks jsonb)
returns public.chapters language plpgsql security definer set search_path=public,private as $$
declare v_chapter public.chapters%rowtype; v_item jsonb; v_position integer:=0; v_id uuid; v_content text:=''; v_words integer;
 v_story public.stories%rowtype; v_book public.books%rowtype; v_total_story integer; v_total_book integer;
begin
 if auth.uid() is null then raise exception 'Önce giriş yapmalısın.'; end if;
 select * into v_chapter from public.chapters where id=p_chapter_id for update;
 if not found or not private.is_story_member(v_chapter.story_id) then raise exception 'Bu hikâyeye erişimin yok.'; end if;
 if not exists(select 1 from public.chapter_writing_locks l where l.chapter_id=p_chapter_id and l.user_id=auth.uid() and l.expires_at>now()) then raise exception 'Yazma oturumu sona erdi. Bölümü yeniden açarak yazma sırasını al.'; end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 120 then raise exception 'Bölüm başlığı 1-120 karakter olmalı.'; end if;
 if p_status not in ('draft','published') then raise exception 'Geçersiz bölüm durumu.'; end if;
 if jsonb_typeof(p_blocks)<>'array' or jsonb_array_length(p_blocks)>500 then raise exception 'Paragraf listesi geçersiz veya çok uzun.'; end if;
 for v_item in select value from jsonb_array_elements(p_blocks) loop
  if jsonb_typeof(v_item->'content')<>'string' then raise exception 'Paragraf içeriği metin olmalı.'; end if;
  if char_length(v_item->>'content')>50000 then raise exception 'Tek paragraf en fazla 50.000 karakter olabilir.'; end if;
  v_content:=v_content||case when v_position=0 then '' else E'\n\n' end||(v_item->>'content'); v_position:=v_position+1;
 end loop;
 v_words:=case when btrim(v_content)='' then 0 else cardinality(regexp_split_to_array(btrim(v_content),'\s+')) end;
 if v_words>v_chapter.target_words then raise exception 'Bölüm kelime sınırı aşıldı. Hedef: % kelime.',v_chapter.target_words; end if;
 select * into v_story from public.stories where id=v_chapter.story_id;
 select * into v_book from public.books where id=v_story.book_id;
 select coalesce(sum(case when c.id=p_chapter_id then v_words else cardinality(regexp_split_to_array(nullif(btrim(c.content),''),'\s+')) end),0) into v_total_story from public.chapters c where c.story_id=v_story.id;
 if v_total_story>v_story.target_words then raise exception 'Hikâye kelime sınırı aşıldı. Hedef: % kelime.',v_story.target_words; end if;
 select coalesce(sum(case when c.id=p_chapter_id then v_words else cardinality(regexp_split_to_array(nullif(btrim(c.content),''),'\s+')) end),0) into v_total_book from public.chapters c join public.stories s on s.id=c.story_id where s.book_id=v_book.id;
 if v_total_book>v_book.target_words+v_book.extension_words then raise exception 'Kitap genel kelime sınırı aşıldı. İzin verilen toplam: % kelime.',v_book.target_words+v_book.extension_words; end if;
 update public.chapters set title=btrim(p_title),content=v_content,status=p_status,updated_at=now() where id=p_chapter_id returning * into v_chapter;
 update public.chapter_blocks set position=position+10000 where chapter_id=p_chapter_id; v_position:=0;
 for v_item in select value from jsonb_array_elements(p_blocks) loop
  v_id:=nullif(v_item->>'id','')::uuid;
  if v_id is not null then
   update public.chapter_blocks set position=v_position,content=v_item->>'content',updated_by=auth.uid(),updated_at=now() where id=v_id and chapter_id=p_chapter_id;
   if not found then raise exception 'Paragraf bu bölüme ait değil.'; end if;
  else
   insert into public.chapter_blocks(chapter_id,position,content,author_id,updated_by) values(p_chapter_id,v_position,v_item->>'content',auth.uid(),auth.uid());
  end if;
  v_position:=v_position+1;
 end loop;
 delete from public.chapter_blocks where chapter_id=p_chapter_id and position>=10000;
 return v_chapter;
end $$;
revoke all on function public.save_chapter_blocks(uuid,text,text,jsonb) from public,anon;
grant execute on function public.save_chapter_blocks(uuid,text,text,jsonb) to authenticated;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chapter_writing_locks') then
  alter publication supabase_realtime add table public.chapter_writing_locks;
 end if;
end $$;
