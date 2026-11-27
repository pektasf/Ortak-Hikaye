-- Ortak Roman: story-scoped writing, legacy migration and reading progress.
-- Applied to the live Supabase project as migration story_scoped_writing_and_legacy_migration.
-- Historical global-writing tables are preserved but no longer exposed to clients.

create or replace function public.is_story_member(p_story_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and exists (
    select 1 from public.story_members sm
    where sm.story_id=p_story_id and sm.user_id=auth.uid()
  );
$$;

create or replace function public.is_story_owner(p_story_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and exists (
    select 1 from public.stories s
    where s.id=p_story_id and s.owner_id=auth.uid()
  );
$$;

create or replace function public.can_access_workspace()
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and (
    exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','moderator'))
    or exists(select 1 from public.story_members sm where sm.user_id=auth.uid())
  );
$$;

create or replace function public.can_create_story()
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and (
    exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='owner')
    or exists(select 1 from public.story_members sm where sm.user_id=auth.uid())
  );
$$;

do $$
declare v_owner uuid; v_book uuid; v_story uuid;
begin
  if exists(select 1 from public.story_entries) then
    select id into v_owner from public.profiles where role='owner' order by created_at limit 1;
    if v_owner is null then select id into v_owner from public.profiles order by created_at limit 1; end if;
    select id into v_book from public.books order by updated_at desc limit 1;
    if v_owner is null or v_book is null then
      raise exception 'Legacy story entries exist but an owner profile or book could not be found. No rows were migrated.';
    end if;
    insert into public.stories(book_id,owner_id,title,description,status,sort_order)
    values(v_book,v_owner,'Ortak Roman — Arşiv','Eski ortak yazım alanından taşınan katkılar.','published',-1)
    returning id into v_story;
    insert into public.story_members(story_id,user_id,role,invited_by)
    select v_story,p.id,case when p.id=v_owner then 'owner' else 'writer' end,v_owner
    from public.profiles p
    where p.id=v_owner or exists(select 1 from public.story_entries e where e.user_id=p.id)
    on conflict(story_id,user_id) do nothing;
    insert into public.chapters(story_id,title,content,status,sort_order,created_by)
    select v_story,left(coalesce(nullif(trim(e.display_name),''),'Yazar') || ' katkısı',120),
      e.content,'published',row_number() over(order by e.created_at,e.id)::integer,e.user_id
    from public.story_entries e order by e.created_at,e.id;
  end if;
end $$;

create table if not exists public.chapter_revisions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  editor_id uuid not null references public.profiles(id) on delete restrict,
  title text not null, content text not null, created_at timestamptz not null default now()
);
create index if not exists chapter_revisions_chapter_created_idx
  on public.chapter_revisions(chapter_id,created_at desc);

create or replace function public.capture_chapter_revision()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.title is distinct from new.title or old.content is distinct from new.content then
    insert into public.chapter_revisions(chapter_id,story_id,editor_id,title,content)
    values(old.id,old.story_id,auth.uid(),old.title,old.content);
  end if;
  return new;
end $$;
drop trigger if exists capture_chapter_revision_before_update on public.chapters;
create trigger capture_chapter_revision_before_update before update on public.chapters
for each row execute function public.capture_chapter_revision();

create table if not exists public.reading_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete set null,
  scroll_position integer not null default 0 check(scroll_position >= 0),
  updated_at timestamptz not null default now(), primary key(user_id,story_id)
);
create index if not exists reading_progress_story_idx on public.reading_progress(story_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at:=now(); return new; end $$;
drop trigger if exists set_stories_updated_at on public.stories;
create trigger set_stories_updated_at before update on public.stories for each row execute function public.set_updated_at();
drop trigger if exists set_chapters_updated_at on public.chapters;
create trigger set_chapters_updated_at before update on public.chapters for each row execute function public.set_updated_at();
drop trigger if exists set_reading_progress_updated_at on public.reading_progress;
create trigger set_reading_progress_updated_at before update on public.reading_progress for each row execute function public.set_updated_at();

drop policy if exists "members read stories" on public.stories;
create policy "members read stories" on public.stories for select to authenticated using((select public.is_story_member(id)));
drop policy if exists "writers create own stories" on public.stories;
create policy "writers create own stories" on public.stories for insert to authenticated
with check((select public.can_create_story()) and owner_id=(select auth.uid()));
drop policy if exists "owners update own stories" on public.stories;
create policy "owners update own stories" on public.stories for update to authenticated
using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
drop policy if exists "owners delete own stories" on public.stories;
create policy "owners delete own stories" on public.stories for delete to authenticated using(owner_id=(select auth.uid()));

drop policy if exists "members read chapters" on public.chapters;
create policy "members read chapters" on public.chapters for select to authenticated using((select public.is_story_member(story_id)));
drop policy if exists "owners create chapters" on public.chapters;
create policy "members create chapters" on public.chapters for insert to authenticated
with check((select public.is_story_member(story_id)) and created_by=(select auth.uid()));
drop policy if exists "owners update chapters" on public.chapters;
create policy "members update chapters" on public.chapters for update to authenticated
using((select public.is_story_member(story_id))) with check((select public.is_story_member(story_id)));
drop policy if exists "owners delete chapters" on public.chapters;
create policy "owners delete chapters" on public.chapters for delete to authenticated using((select public.is_story_owner(story_id)));
drop policy if exists "members read story memberships" on public.story_members;
create policy "members read story memberships" on public.story_members for select to authenticated using((select public.is_story_member(story_id)));

alter table public.chapter_revisions enable row level security;
drop policy if exists "members read chapter revisions" on public.chapter_revisions;
create policy "members read chapter revisions" on public.chapter_revisions for select to authenticated using((select public.is_story_member(story_id)));
revoke all on public.chapter_revisions from anon,authenticated;
grant select on public.chapter_revisions to authenticated;

alter table public.reading_progress enable row level security;
drop policy if exists "users read own story progress" on public.reading_progress;
create policy "users read own story progress" on public.reading_progress for select to authenticated
using(user_id=(select auth.uid()) and (select public.is_story_member(story_id)));
drop policy if exists "users create own story progress" on public.reading_progress;
create policy "users create own story progress" on public.reading_progress for insert to authenticated
with check(user_id=(select auth.uid()) and (select public.is_story_member(story_id)));
drop policy if exists "users update own story progress" on public.reading_progress;
create policy "users update own story progress" on public.reading_progress for update to authenticated
using(user_id=(select auth.uid()) and (select public.is_story_member(story_id)))
with check(user_id=(select auth.uid()) and (select public.is_story_member(story_id)));
grant select,insert,update on public.reading_progress to authenticated;

drop policy if exists "invited members read books" on public.books;
create policy "story members read books" on public.books for select to authenticated using((select public.can_access_workspace()));
drop policy if exists "moderators update books" on public.books;
create policy "owners update books" on public.books for update to authenticated
using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='owner'))
with check(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='owner'));

create or replace function public.create_story_invite(
  p_story_id uuid,p_max_uses integer default null,p_hours_valid integer default 168
) returns text language plpgsql security definer set search_path=public as $$
declare v_token text;
begin
  if auth.uid() is null or not public.is_story_member(p_story_id) then
    raise exception 'Yalnızca üyesi olduğun hikâyeye davet oluşturabilirsin.';
  end if;
  if p_max_uses is not null and (p_max_uses<1 or p_max_uses>100) then
    raise exception 'Davet kullanım sayısı 1-100 arasında olmalı veya sınırsız bırakılmalı.';
  end if;
  if p_hours_valid is null or p_hours_valid<1 or p_hours_valid>720 then
    raise exception 'Davet süresi 1-720 saat arasında olmalı.';
  end if;
  v_token:=encode(gen_random_bytes(24),'hex');
  insert into public.story_invites(token_hash,story_id,created_by,max_uses,expires_at)
  values(digest(convert_to(v_token,'UTF8'),'sha256'),p_story_id,auth.uid(),p_max_uses,now()+make_interval(hours=>p_hours_valid));
  return v_token;
end $$;

create or replace function public.redeem_story_invite(p_token text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_invite public.story_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Önce e-posta bağlantısıyla giriş yapmalısın.'; end if;
  if p_token is null or length(p_token)<32 or length(p_token)>128 then raise exception 'Hikâye daveti geçersiz veya süresi dolmuş.'; end if;
  select * into v_invite from public.story_invites where token_hash=digest(convert_to(p_token,'UTF8'),'sha256') for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at<=now()
    or (v_invite.max_uses is not null and v_invite.uses_count>=v_invite.max_uses) then
    raise exception 'Hikâye daveti geçersiz, iptal edilmiş veya süresi dolmuş.';
  end if;
  if not exists(select 1 from public.profiles p where p.id=auth.uid()) then raise exception 'Kullanıcı profili henüz hazır değil. Biraz sonra tekrar dene.'; end if;
  insert into public.story_members(story_id,user_id,role,invited_by)
  values(v_invite.story_id,auth.uid(),'writer',v_invite.created_by) on conflict(story_id,user_id) do nothing;
  if not exists(select 1 from public.story_members sm where sm.story_id=v_invite.story_id and sm.user_id=auth.uid()) then
    raise exception 'Hikâyeye katılım doğrulanamadı.';
  end if;
  update public.story_invites set uses_count=uses_count+1 where token_hash=v_invite.token_hash;
  return v_invite.story_id;
end $$;

drop policy if exists "invited members read entries" on public.story_entries;
drop policy if exists "writers insert own entry while holding lock" on public.story_entries;
drop policy if exists "moderators delete entries" on public.story_entries;
drop policy if exists "invited members read lock" on public.writing_locks;
drop policy if exists "invited members read votes" on public.story_votes;
drop policy if exists "contributors vote once" on public.story_votes;
drop policy if exists "contributors change own vote" on public.story_votes;
revoke all on public.story_entries,public.writing_locks,public.story_votes,public.invites from anon,authenticated;
revoke all on function public.acquire_writing_lock(text) from public,anon,authenticated;
revoke all on function public.renew_writing_lock() from public,anon,authenticated;
revoke all on function public.release_writing_lock() from public,anon,authenticated;
revoke all on function public.create_invite(integer,integer) from public,anon,authenticated;
revoke all on function public.redeem_invite(text) from public,anon,authenticated;
revoke all on function public.moderator_resolve_vote(text) from public,anon,authenticated;

revoke all on function public.create_story_invite(uuid,integer,integer) from public,anon;
revoke all on function public.redeem_story_invite(text) from public,anon;
revoke all on function public.is_story_member(uuid) from public,anon;
revoke all on function public.is_story_owner(uuid) from public,anon;
revoke all on function public.can_access_workspace() from public,anon;
revoke all on function public.can_create_story() from public,anon;
revoke all on function public.capture_chapter_revision() from public,anon,authenticated;
revoke all on function public.set_updated_at() from public,anon,authenticated;
grant execute on function public.create_story_invite(uuid,integer,integer),public.redeem_story_invite(text),
 public.is_story_member(uuid),public.is_story_owner(uuid),public.can_access_workspace(),public.can_create_story() to authenticated;
