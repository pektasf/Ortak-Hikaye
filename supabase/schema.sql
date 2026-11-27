-- ORTAK ROMAN — complete Supabase bootstrap schema
-- This file is the canonical fresh-project setup. It includes the base schema
-- followed by every additive migration in dependency order. Safe to run on a
-- fresh project; existing live projects should use migrations, not rerun this
-- file as a substitute for migration history.

-- ORTAK ROMAN / Supabase PostgreSQL schema
-- Fresh Supabase project. Email OTP sign-in must be enabled.
-- Public signup can remain enabled: RLS blocks every uninvited account.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Yazar' check (char_length(display_name) between 1 and 24),
  role text not null default 'writer' check (role in ('writer','moderator','owner')),
  access_granted boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists access_granted boolean not null default false;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,display_name,access_granted)
 values(new.id,left(coalesce(new.raw_user_meta_data->>'name','Yazar'),24),false)
 on conflict(id) do nothing;
 return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create table if not exists public.books (
 id uuid primary key default gen_random_uuid(),
 title text not null default 'Ortak Roman',
 subtitle text not null default 'Bir hikâye, birçok ses',
 note text not null default '',
 target_words integer not null default 1000 check(target_words >= 100),
 extension_words integer not null default 1000 check(extension_words >= 100),
 finished boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into public.books(title,subtitle,note)
select 'Ortak Roman','Bir hikâye, birçok ses','Bu kitap, birbirini hiç tanımayan insanların aynı hikâyede buluşmasıyla doğdu.'
where not exists(select 1 from public.books);

create table if not exists public.story_entries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 display_name text not null,
 content text not null check(char_length(content) between 1 and 6000),
 created_at timestamptz not null default now()
);
create table if not exists public.writing_locks (
 id integer primary key default 1 check(id=1),
 user_id uuid references public.profiles(id) on delete set null,
 display_name text, expires_at timestamptz, updated_at timestamptz not null default now()
);
insert into public.writing_locks(id) values(1) on conflict do nothing;
create table if not exists public.story_votes (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 choice text not null check(choice in ('extend','end')),
 created_at timestamptz not null default now()
);
create table if not exists public.invites (
 token_hash bytea primary key,
 max_uses integer default null check(max_uses is null or max_uses > 0),
 uses_count integer not null default 0 check(uses_count >= 0),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);

create or replace function public.is_authorized() returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select access_granted from public.profiles where id=auth.uid()),false);
$$;
create or replace function public.current_profile_role() returns text
language sql stable security definer set search_path=public as $$
 select role from public.profiles where id=auth.uid() and access_granted=true;
$$;
create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(public.is_authorized() and public.current_profile_role() in ('owner','moderator'),false);
$$;

-- An invitation token is never readable from the client. Only its SHA-256 hash is stored.
create or replace function public.create_invite(p_max_uses integer default null, p_hours_valid integer default 168)
returns text language plpgsql security definer set search_path=public as $$
declare v_token text;
begin
 if not public.is_moderator() or public.current_profile_role() <> 'owner' then
   raise exception 'Yalnızca kitap sahibi davet oluşturabilir.';
 end if;
 if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 100) then raise exception 'Davet kullanım sayısı 1-100 arasında olmalı veya sınırsız bırakılmalı.'; end if;
 if p_hours_valid < 1 or p_hours_valid > 720 then raise exception 'Davet süresi 1-720 saat arasında olmalı.'; end if;
 v_token := encode(gen_random_bytes(24),'hex');
 insert into public.invites(token_hash,max_uses,expires_at,created_by)
 values(digest(convert_to(v_token,'UTF8'),'sha256'),p_max_uses,now()+make_interval(hours=>p_hours_valid),auth.uid());
 return v_token;
end $$;

create or replace function public.redeem_invite(p_token text) returns boolean
language plpgsql security definer set search_path=public as $$
declare v_invite public.invites%rowtype;
begin
 if auth.uid() is null then raise exception 'Önce e-posta bağlantısıyla giriş yapmalısın.'; end if;
 if public.is_authorized() then return true; end if;
 if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
   raise exception 'Davet bağlantısı geçersiz veya süresi dolmuş.';
 end if;
 select * into v_invite from public.invites
 where token_hash=digest(convert_to(p_token,'UTF8'),'sha256')
 for update;
 if not found or v_invite.revoked_at is not null or v_invite.expires_at <= now()
    or v_invite.uses_count >= v_invite.max_uses then
   raise exception 'Davet bağlantısı geçersiz, kullanılmış veya süresi dolmuş.';
 end if;
 update public.invites set uses_count=uses_count+1
 where token_hash=v_invite.token_hash;
 update public.profiles set access_granted=true
 where id=auth.uid();
 return true;
end $$;

create or replace function public.acquire_writing_lock(p_display_name text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare l public.writing_locks%rowtype;
begin
 if auth.uid() is null or not public.is_authorized() then raise exception 'Davetli erişimi gerekli.'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Profil kaydı bulunamadı.'; end if;
 select * into l from public.writing_locks where id=1 for update;
 if l.user_id is not null and l.expires_at > now() and l.user_id <> auth.uid() then
   return jsonb_build_object('ok',false,'message',coalesce(l.display_name,'Bir yazar')||' yazıyor.');
 end if;
 if exists(select 1 from public.story_entries e order by e.created_at desc limit 1) then
   if (select e.user_id=auth.uid() and e.created_at>now()-interval '15 minutes' from public.story_entries e order by e.created_at desc limit 1) then
     return jsonb_build_object('ok',false,'message','Arka arkaya tur alamazsın. Başka biri yazdıktan sonra veya 15 dakika sonra tekrar dene.');
   end if;
 end if;
 update public.writing_locks set user_id=auth.uid(),display_name=left(trim(p_display_name),24),
 expires_at=now()+interval '25 seconds',updated_at=now() where id=1 returning * into l;
 return jsonb_build_object('ok',true,'lock',to_jsonb(l));
end $$;
create or replace function public.renew_writing_lock() returns void
language plpgsql security definer set search_path=public as $$
begin
 update public.writing_locks set expires_at=now()+interval '25 seconds',updated_at=now()
 where id=1 and user_id=auth.uid() and expires_at>now() and public.is_authorized();
end $$;
create or replace function public.release_writing_lock() returns void
language plpgsql security definer set search_path=public as $$
begin
 update public.writing_locks set user_id=null,display_name=null,expires_at=null,updated_at=now()
 where id=1 and user_id=auth.uid();
end $$;
create or replace function public.moderator_resolve_vote(p_choice text) returns void
language plpgsql security definer set search_path=public as $$
declare yes_count int; no_count int; eligible_count int; next_target int;
begin
 if not public.is_moderator() then raise exception 'Bu işlem için moderatör yetkisi gerekli.'; end if;
 if p_choice not in ('extend','end') then raise exception 'Geçersiz karar.'; end if;
 select count(*) filter(where choice='extend'),count(*) filter(where choice='end')
 into yes_count,no_count from public.story_votes v
 where exists(select 1 from public.story_entries e where e.user_id=v.user_id);
 select count(distinct user_id) into eligible_count from public.story_entries;
 if (p_choice='extend' and yes_count < floor(eligible_count/2.0)+1)
 or (p_choice='end' and no_count < floor(eligible_count/2.0)+1) then
   raise exception 'Bu karar için yazarların çoğunluk oyu henüz oluşmadı.';
 end if;
 if p_choice='extend' then
   select target_words+extension_words into next_target from public.books limit 1;
   update public.books set target_words=next_target,finished=false,updated_at=now();
 else
   update public.books set finished=true,updated_at=now();
 end if;
 delete from public.story_votes;
end $$;

alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.story_entries enable row level security;
alter table public.writing_locks enable row level security;
alter table public.story_votes enable row level security;
alter table public.invites enable row level security;

drop policy if exists "profiles visible to authenticated" on public.profiles;
drop policy if exists "users create own profile" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;
create policy "members read own profile or moderators read all" on public.profiles
 for select to authenticated using(id=auth.uid() or public.is_moderator());

drop policy if exists "books readable" on public.books;
create policy "invited members read books" on public.books
 for select to authenticated using(public.is_authorized());
drop policy if exists "moderators update books" on public.books;
create policy "moderators update books" on public.books
 for update to authenticated using(public.is_moderator()) with check(public.is_moderator());

drop policy if exists "entries readable" on public.story_entries;
create policy "invited members read entries" on public.story_entries
 for select to authenticated using(public.is_authorized());
drop policy if exists "writers insert own entry while holding lock" on public.story_entries;
create policy "writers insert own entry while holding lock" on public.story_entries
 for insert to authenticated with check(
  public.is_authorized() and user_id=auth.uid()
  and exists(select 1 from public.writing_locks l where l.id=1 and l.user_id=auth.uid() and l.expires_at>now())
  and (select count(*) from regexp_split_to_table(trim(content), E'\\s+') as token where token <> '') <= 200
);
drop policy if exists "moderators delete entries" on public.story_entries;
create policy "moderators delete entries" on public.story_entries
 for delete to authenticated using(public.is_moderator());

drop policy if exists "lock readable" on public.writing_locks;
create policy "invited members read lock" on public.writing_locks
 for select to authenticated using(public.is_authorized());
drop policy if exists "votes readable" on public.story_votes;
create policy "invited members read votes" on public.story_votes
 for select to authenticated using(public.is_authorized());
drop policy if exists "contributors vote once" on public.story_votes;
create policy "contributors vote once" on public.story_votes
 for insert to authenticated with check(public.is_authorized() and user_id=auth.uid()
 and exists(select 1 from public.story_entries e where e.user_id=auth.uid()));
drop policy if exists "contributors change own vote" on public.story_votes;
create policy "contributors change own vote" on public.story_votes
 for update to authenticated using(public.is_authorized() and user_id=auth.uid()
 and exists(select 1 from public.story_entries e where e.user_id=auth.uid()))
 with check(public.is_authorized() and user_id=auth.uid()
 and exists(select 1 from public.story_entries e where e.user_id=auth.uid()));

grant usage on schema public to authenticated;
grant select on public.profiles,public.books,public.story_entries,public.writing_locks,public.story_votes to authenticated;
grant update on public.books to authenticated;
grant insert,delete on public.story_entries to authenticated;
grant insert,update on public.story_votes to authenticated;
revoke all on public.invites from anon,authenticated;
revoke all on function public.create_invite(integer,integer) from public,anon;
revoke all on function public.redeem_invite(text) from public,anon;
revoke all on function public.acquire_writing_lock(text) from public,anon;
revoke all on function public.renew_writing_lock() from public,anon;
revoke all on function public.release_writing_lock() from public,anon;
revoke all on function public.moderator_resolve_vote(text) from public,anon;
revoke all on function public.is_authorized() from public,anon;
revoke all on function public.current_profile_role() from public,anon;
revoke all on function public.is_moderator() from public,anon;
grant execute on function public.redeem_invite(text),public.acquire_writing_lock(text),
 public.renew_writing_lock(),public.release_writing_lock(),public.is_authorized(),
 public.current_profile_role(),public.is_moderator() to authenticated;
grant execute on function public.create_invite(integer,integer),public.moderator_resolve_vote(text) to authenticated;

-- FIRST OWNER BOOTSTRAP:
-- 1) Sign in once with your own email (the profile is created but has no access).
-- 2) In Supabase SQL Editor, replace the email below and run:
-- update public.profiles p set access_granted=true, role='owner'
-- from auth.users u where p.id=u.id and u.email='YOUR_EMAIL_ADDRESS';
-- Then sign out/in. The owner can create invite links from the app.
-- Supabase Auth: enable Email provider + email OTP. Set Site URL and Redirect URL to:
-- https://pektasf.github.io/Ortak-Hikaye/
-- Keep public signup enabled for first-time invited users; RLS denies access until invite token redemption.
-- Enable Realtime for books, story_entries and writing_locks in the supabase_realtime publication.
do $$
declare t text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['books','story_entries','writing_locks','story_votes'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;


-- === MIGRATION: author-owned stories ===
-- Ortak Roman: author-owned stories and story-scoped invitations.
-- Additive migration; preserves the existing book, profiles, invites and story_entries.
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '',
  status text not null default 'published' check (status in ('draft','published','archived')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  content text not null default '',
  status text not null default 'draft' check (status in ('draft','published')),
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.story_members (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'writer' check (role in ('owner','writer')),
  invited_by uuid references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (story_id,user_id)
);

create table if not exists public.story_invites (
  token_hash bytea primary key,
  story_id uuid not null references public.stories(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  max_uses integer default null check (max_uses is null or max_uses between 1 and 100),
  uses_count integer not null default 0 check (uses_count >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists stories_owner_created_idx on public.stories(owner_id,created_at desc);
create index if not exists chapters_story_order_idx on public.chapters(story_id,sort_order,created_at);
create index if not exists story_members_user_idx on public.story_members(user_id,story_id);

create or replace function public.is_story_member(p_story_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.story_members sm
    where sm.story_id=p_story_id and sm.user_id=auth.uid()
  );
$$;

create or replace function public.is_story_owner(p_story_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.stories s
    where s.id=p_story_id and s.owner_id=auth.uid()
  );
$$;

create or replace function public.add_story_owner_membership() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.story_members(story_id,user_id,role,invited_by)
  values(new.id,new.owner_id,'owner',new.owner_id)
  on conflict(story_id,user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_story_created_add_owner on public.stories;
create trigger on_story_created_add_owner
after insert on public.stories
for each row execute function public.add_story_owner_membership();

create or replace function public.create_story_invite(
  p_story_id uuid,
  p_max_uses integer default null,
  p_hours_valid integer default 168
) returns text
language plpgsql security definer set search_path=public as $$
declare v_token text;
begin
  if auth.uid() is null or not public.is_authorized() then
    raise exception 'Davetli hesap gerekli.';
  end if;
  if not public.is_story_owner(p_story_id) then
    raise exception 'Yalnızca hikâyenin sahibi davet oluşturabilir.';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 100) then
    raise exception 'Davet kullanım sayısı 1-100 arasında olmalı veya sınırsız bırakılmalı.';
  end if;
  if p_hours_valid < 1 or p_hours_valid > 720 then
    raise exception 'Davet süresi 1-720 saat arasında olmalı.';
  end if;
  v_token := encode(gen_random_bytes(24),'hex');
  insert into public.story_invites(token_hash,story_id,created_by,max_uses,expires_at)
  values(digest(convert_to(v_token,'UTF8'),'sha256'),p_story_id,auth.uid(),p_max_uses,now()+make_interval(hours=>p_hours_valid));
  return v_token;
end $$;

create or replace function public.redeem_story_invite(p_token text) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_invite public.story_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Önce e-posta bağlantısıyla giriş yapmalısın.'; end if;
  if p_token is null or length(p_token)<32 or length(p_token)>128 then
    raise exception 'Hikâye daveti geçersiz veya süresi dolmuş.';
  end if;
  select * into v_invite from public.story_invites
  where token_hash=digest(convert_to(p_token,'UTF8'),'sha256')
  for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at<=now()
     or (v_invite.max_uses is not null and v_invite.uses_count>=v_invite.max_uses) then
    raise exception 'Hikâye daveti geçersiz, iptal edilmiş veya süresi dolmuş.';
  end if;
  update public.story_invites set uses_count=uses_count+1 where token_hash=v_invite.token_hash;
  update public.profiles set access_granted=true where id=auth.uid();
  insert into public.story_members(story_id,user_id,role,invited_by)
  values(v_invite.story_id,auth.uid(),'writer',v_invite.created_by)
  on conflict(story_id,user_id) do nothing;
  return v_invite.story_id;
end $$;

alter table public.stories enable row level security;
alter table public.chapters enable row level security;
alter table public.story_members enable row level security;
alter table public.story_invites enable row level security;

drop policy if exists "members read stories" on public.stories;
create policy "members read stories" on public.stories
for select to authenticated using(public.is_story_member(id) or owner_id=auth.uid());
drop policy if exists "writers create own stories" on public.stories;
create policy "writers create own stories" on public.stories
for insert to authenticated with check(public.is_authorized() and owner_id=auth.uid());
drop policy if exists "owners update own stories" on public.stories;
create policy "owners update own stories" on public.stories
for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
drop policy if exists "owners delete own stories" on public.stories;
create policy "owners delete own stories" on public.stories
for delete to authenticated using(owner_id=auth.uid());

drop policy if exists "members read chapters" on public.chapters;
create policy "members read chapters" on public.chapters
for select to authenticated using(public.is_story_member(story_id));
drop policy if exists "owners create chapters" on public.chapters;
create policy "owners create chapters" on public.chapters
for insert to authenticated with check(public.is_authorized() and public.is_story_owner(story_id) and created_by=auth.uid());
drop policy if exists "owners update chapters" on public.chapters;
create policy "owners update chapters" on public.chapters
for update to authenticated using(public.is_story_owner(story_id)) with check(public.is_story_owner(story_id));
drop policy if exists "owners delete chapters" on public.chapters;
create policy "owners delete chapters" on public.chapters
for delete to authenticated using(public.is_story_owner(story_id));

drop policy if exists "members read story memberships" on public.story_members;
create policy "members read story memberships" on public.story_members
for select to authenticated using(public.is_story_member(story_id) or public.is_story_owner(story_id));

grant select,insert,update,delete on public.stories to authenticated;
grant select,insert,update,delete on public.chapters to authenticated;
grant select on public.story_members to authenticated;
revoke all on public.story_invites from anon,authenticated;
revoke all on function public.create_story_invite(uuid,integer,integer) from public,anon;
revoke all on function public.redeem_story_invite(text) from public,anon;
revoke all on function public.is_story_member(uuid) from public,anon;
revoke all on function public.is_story_owner(uuid) from public,anon;
grant execute on function public.create_story_invite(uuid,integer,integer),public.redeem_story_invite(text),
 public.is_story_member(uuid),public.is_story_owner(uuid) to authenticated;

do $$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='stories') then
   alter publication supabase_realtime add table public.stories;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chapters') then
   alter publication supabase_realtime add table public.chapters;
  end if;
 end if;
end $$;


-- === MIGRATION: member story invitations ===
-- Allow every member of a story to invite additional writers to that same story.
-- Invited writers do not receive owner or global administrator privileges.
create or replace function public.create_story_invite(
  p_story_id uuid,
  p_max_uses integer default null,
  p_hours_valid integer default 168
) returns text
language plpgsql security definer set search_path=public as $$
declare v_token text;
begin
  if auth.uid() is null or not public.is_authorized() then
    raise exception 'Davetli hesap gerekli.';
  end if;
  if not public.is_story_member(p_story_id) then
    raise exception 'Yalnızca katıldığın hikâyeye davet oluşturabilirsin.';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 100) then
    raise exception 'Davet kullanım sayısı 1-100 arasında olmalı veya sınırsız bırakılmalı.';
  end if;
  if p_hours_valid < 1 or p_hours_valid > 720 then
    raise exception 'Davet süresi 1-720 saat arasında olmalı.';
  end if;
  v_token := encode(gen_random_bytes(24),'hex');
  insert into public.story_invites(token_hash,story_id,created_by,max_uses,expires_at)
  values(digest(convert_to(v_token,'UTF8'),'sha256'),p_story_id,auth.uid(),p_max_uses,now()+make_interval(hours=>p_hours_valid));
  return v_token;
end $$;

revoke all on function public.create_story_invite(uuid,integer,integer) from public,anon;
grant execute on function public.create_story_invite(uuid,integer,integer) to authenticated;


-- === MIGRATION: schema consistency and security hardening ===
-- Schema consistency, index coverage, trigger hardening and RLS initplan cleanup.
-- Additive and data-preserving: no table or column is dropped or renamed.

create index if not exists chapters_created_by_idx on public.chapters(created_by);
create index if not exists invites_created_by_idx on public.invites(created_by);
create index if not exists stories_book_id_idx on public.stories(book_id);
create index if not exists story_entries_user_id_idx on public.story_entries(user_id);
create index if not exists story_invites_created_by_idx on public.story_invites(created_by);
create index if not exists story_invites_story_id_idx on public.story_invites(story_id);
create index if not exists story_members_invited_by_idx on public.story_members(invited_by);
create index if not exists writing_locks_user_id_idx on public.writing_locks(user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_stories_updated_at on public.stories;
create trigger set_stories_updated_at
before update on public.stories
for each row execute function public.set_updated_at();

drop trigger if exists set_chapters_updated_at on public.chapters;
create trigger set_chapters_updated_at
before update on public.chapters
for each row execute function public.set_updated_at();

revoke all on function public.add_story_owner_membership() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

drop policy if exists "members read own profile or moderators read all" on public.profiles;
create policy "members read own profile or moderators read all" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select public.is_moderator()));

drop policy if exists "invited members read books" on public.books;
create policy "invited members read books" on public.books
for select to authenticated using ((select public.is_authorized()));

drop policy if exists "moderators update books" on public.books;
create policy "moderators update books" on public.books
for update to authenticated
using ((select public.is_moderator()))
with check ((select public.is_moderator()));

drop policy if exists "invited members read entries" on public.story_entries;
create policy "invited members read entries" on public.story_entries
for select to authenticated using ((select public.is_authorized()));

drop policy if exists "writers insert own entry while holding lock" on public.story_entries;
create policy "writers insert own entry while holding lock" on public.story_entries
for insert to authenticated
with check (
  (select public.is_authorized())
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.writing_locks l
    where l.id = 1 and l.user_id = (select auth.uid()) and l.expires_at > now()
  )
  and (
    select count(*)
    from regexp_split_to_table(trim(content), E'\\s+') as token
    where token <> ''
  ) <= 200
);

drop policy if exists "moderators delete entries" on public.story_entries;
create policy "moderators delete entries" on public.story_entries
for delete to authenticated using ((select public.is_moderator()));

drop policy if exists "invited members read votes" on public.story_votes;
create policy "invited members read votes" on public.story_votes
for select to authenticated using ((select public.is_authorized()));

drop policy if exists "contributors vote once" on public.story_votes;
create policy "contributors vote once" on public.story_votes
for insert to authenticated
with check (
  (select public.is_authorized())
  and user_id = (select auth.uid())
  and exists (select 1 from public.story_entries e where e.user_id = (select auth.uid()))
);

drop policy if exists "contributors change own vote" on public.story_votes;
create policy "contributors change own vote" on public.story_votes
for update to authenticated
using (
  (select public.is_authorized())
  and user_id = (select auth.uid())
  and exists (select 1 from public.story_entries e where e.user_id = (select auth.uid()))
)
with check (
  (select public.is_authorized())
  and user_id = (select auth.uid())
  and exists (select 1 from public.story_entries e where e.user_id = (select auth.uid()))
);

drop policy if exists "writers create own stories" on public.stories;
create policy "writers create own stories" on public.stories
for insert to authenticated
with check ((select public.is_authorized()) and owner_id = (select auth.uid()));

drop policy if exists "owners update own stories" on public.stories;
create policy "owners update own stories" on public.stories
for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "owners delete own stories" on public.stories;
create policy "owners delete own stories" on public.stories
for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "owners create chapters" on public.chapters;
create policy "owners create chapters" on public.chapters
for insert to authenticated
with check (
  (select public.is_authorized())
  and (select public.is_story_owner(story_id))
  and created_by = (select auth.uid())
);

-- invites and story_invites intentionally have no direct client policies;
-- token operations are handled through scoped RPC functions.


-- === MIGRATION: story-scoped writing and legacy migration ===
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


-- === MIGRATION: private RLS helpers ===
-- Move policy-only SECURITY DEFINER helpers out of the exposed public API schema.
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;

create or replace function private.is_story_member(p_story_id uuid)
returns boolean language sql stable security definer set search_path=public,private as $$
  select auth.uid() is not null and exists(select 1 from public.story_members sm where sm.story_id=p_story_id and sm.user_id=auth.uid());
$$;
create or replace function private.is_story_owner(p_story_id uuid)
returns boolean language sql stable security definer set search_path=public,private as $$
  select auth.uid() is not null and exists(select 1 from public.stories s where s.id=p_story_id and s.owner_id=auth.uid());
$$;
create or replace function private.can_access_workspace()
returns boolean language sql stable security definer set search_path=public,private as $$
  select auth.uid() is not null and (
    exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','moderator'))
    or exists(select 1 from public.story_members sm where sm.user_id=auth.uid())
  );
$$;
create or replace function private.can_create_story()
returns boolean language sql stable security definer set search_path=public,private as $$
  select auth.uid() is not null and (
    exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='owner')
    or exists(select 1 from public.story_members sm where sm.user_id=auth.uid())
  );
$$;
create or replace function private.is_moderator()
returns boolean language sql stable security definer set search_path=public,private as $$
  select auth.uid() is not null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','moderator') and p.access_granted);
$$;
grant execute on function private.is_story_member(uuid),private.is_story_owner(uuid),private.can_access_workspace(),private.can_create_story(),private.is_moderator() to authenticated;

drop policy if exists "members read own profile or moderators read all" on public.profiles;
create policy "members read own profile or moderators read all" on public.profiles for select to authenticated
using(id=(select auth.uid()) or (select private.is_moderator()));
drop policy if exists "story members read books" on public.books;
create policy "story members read books" on public.books for select to authenticated using((select private.can_access_workspace()));
drop policy if exists "members read stories" on public.stories;
create policy "members read stories" on public.stories for select to authenticated using((select private.is_story_member(id)));
drop policy if exists "writers create own stories" on public.stories;
create policy "writers create own stories" on public.stories for insert to authenticated with check((select private.can_create_story()) and owner_id=(select auth.uid()));
drop policy if exists "members read chapters" on public.chapters;
create policy "members read chapters" on public.chapters for select to authenticated using((select private.is_story_member(story_id)));
drop policy if exists "members create chapters" on public.chapters;
create policy "members create chapters" on public.chapters for insert to authenticated with check((select private.is_story_member(story_id)) and created_by=(select auth.uid()));
drop policy if exists "members update chapters" on public.chapters;
create policy "members update chapters" on public.chapters for update to authenticated using((select private.is_story_member(story_id))) with check((select private.is_story_member(story_id)));
drop policy if exists "owners delete chapters" on public.chapters;
create policy "owners delete chapters" on public.chapters for delete to authenticated using((select private.is_story_owner(story_id)));
drop policy if exists "members read story memberships" on public.story_members;
create policy "members read story memberships" on public.story_members for select to authenticated using((select private.is_story_member(story_id)));
drop policy if exists "members read chapter revisions" on public.chapter_revisions;
create policy "members read chapter revisions" on public.chapter_revisions for select to authenticated using((select private.is_story_member(story_id)));
drop policy if exists "users read own story progress" on public.reading_progress;
create policy "users read own story progress" on public.reading_progress for select to authenticated using(user_id=(select auth.uid()) and (select private.is_story_member(story_id)));
drop policy if exists "users create own story progress" on public.reading_progress;
create policy "users create own story progress" on public.reading_progress for insert to authenticated with check(user_id=(select auth.uid()) and (select private.is_story_member(story_id)));
drop policy if exists "users update own story progress" on public.reading_progress;
create policy "users update own story progress" on public.reading_progress for update to authenticated using(user_id=(select auth.uid()) and (select private.is_story_member(story_id))) with check(user_id=(select auth.uid()) and (select private.is_story_member(story_id)));

create or replace function public.create_story_invite(p_story_id uuid,p_max_uses integer default null,p_hours_valid integer default 168)
returns text language plpgsql security definer set search_path=public,private as $$
declare v_token text;
begin
  if auth.uid() is null or not private.is_story_member(p_story_id) then raise exception 'Yalnızca üyesi olduğun hikâyeye davet oluşturabilirsin.'; end if;
  if p_max_uses is not null and (p_max_uses<1 or p_max_uses>100) then raise exception 'Davet kullanım sayısı 1-100 arasında olmalı veya sınırsız bırakılmalı.'; end if;
  if p_hours_valid is null or p_hours_valid<1 or p_hours_valid>720 then raise exception 'Davet süresi 1-720 saat arasında olmalı.'; end if;
  v_token:=encode(gen_random_bytes(24),'hex');
  insert into public.story_invites(token_hash,story_id,created_by,max_uses,expires_at)
  values(digest(convert_to(v_token,'UTF8'),'sha256'),p_story_id,auth.uid(),p_max_uses,now()+make_interval(hours=>p_hours_valid));
  return v_token;
end $$;

revoke all on function public.is_story_member(uuid),public.is_story_owner(uuid),public.can_access_workspace(),public.can_create_story(),public.is_authorized(),public.current_profile_role(),public.is_moderator() from public,anon,authenticated;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.is_story_member(uuid),private.is_story_owner(uuid),private.can_access_workspace(),private.can_create_story(),private.is_moderator() to authenticated;


-- === MIGRATION: private helper grants and foreign-key indexes ===
revoke all on function private.is_story_member(uuid),private.is_story_owner(uuid),private.can_access_workspace(),private.can_create_story(),private.is_moderator() from public,anon;
grant execute on function private.is_story_member(uuid),private.is_story_owner(uuid),private.can_access_workspace(),private.can_create_story(),private.is_moderator() to authenticated;
create index if not exists chapter_revisions_editor_id_idx on public.chapter_revisions(editor_id);
create index if not exists chapter_revisions_story_id_idx on public.chapter_revisions(story_id);
create index if not exists reading_progress_chapter_id_idx on public.reading_progress(chapter_id);


-- === MIGRATION: chapter identity and reading progress integrity ===
-- Protect chapter ownership/scope and keep reading progress consistent.
create or replace function public.guard_chapter_identity()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.story_id is distinct from old.story_id or new.created_by is distinct from old.created_by then
    raise exception 'Bölümün hikâyesi ve oluşturan yazarı değiştirilemez.';
  end if;
  return new;
end $$;
drop trigger if exists guard_chapter_identity_before_update on public.chapters;
create trigger guard_chapter_identity_before_update before update on public.chapters
for each row execute function public.guard_chapter_identity();

-- Limit client updates to editorial fields; story_id and created_by are immutable.
revoke insert,update on public.chapters from authenticated;
grant insert(story_id,title,content,status,sort_order,created_by) on public.chapters to authenticated;
grant update(title,content,status,sort_order) on public.chapters to authenticated;

create or replace function public.validate_reading_progress_chapter()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.chapter_id is not null and not exists(
    select 1 from public.chapters c where c.id=new.chapter_id and c.story_id=new.story_id
  ) then
    raise exception 'Seçilen bölüm bu hikâyeye ait değil.';
  end if;
  return new;
end $$;
drop trigger if exists validate_reading_progress_chapter_before_write on public.reading_progress;
create trigger validate_reading_progress_chapter_before_write before insert or update on public.reading_progress
for each row execute function public.validate_reading_progress_chapter();

revoke all on function public.guard_chapter_identity() from public,anon,authenticated;
revoke all on function public.validate_reading_progress_chapter() from public,anon,authenticated;



-- === MIGRATION: server-controlled story creation ===
-- Create stories through a narrow SECURITY DEFINER RPC instead of direct table inserts.
-- This keeps ownership assignment server-controlled and prevents owner_id spoofing.
drop policy if exists "writers create own stories" on public.stories;
revoke insert on public.stories from authenticated;

create or replace function public.create_story(
  p_book_id uuid,
  p_title text,
  p_description text default ''
) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_story public.stories%rowtype;
begin
  if auth.uid() is null or not private.can_create_story() then
    raise exception 'Bir hikâye oluşturmak için önce bir hikâyeye katılmış olmalısın.';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 120 then
    raise exception 'Hikâye adı 1-120 karakter arasında olmalı.';
  end if;
  if char_length(coalesce(p_description,''))>600 then
    raise exception 'Hikâye açıklaması en fazla 600 karakter olabilir.';
  end if;
  if not exists(select 1 from public.books b where b.id=p_book_id) then
    raise exception 'Kitap bulunamadı.';
  end if;
  insert into public.stories(book_id,owner_id,title,description,status)
  values(p_book_id,auth.uid(),trim(p_title),coalesce(trim(p_description),''),'published')
  returning * into v_story;
  return to_jsonb(v_story);
end $$;
revoke all on function public.create_story(uuid,text,text) from public,anon;
grant execute on function public.create_story(uuid,text,text) to authenticated;



-- === MIGRATION: pgcrypto function search path ===
-- pgcrypto is installed in Supabase's extensions schema; include it in SECURITY DEFINER RPC search_path.
alter function public.create_story_invite(uuid,integer,integer)
  set search_path = public, private, extensions;
alter function public.redeem_story_invite(text)
  set search_path = public, private, extensions;



-- === MIGRATION: author profiles, story delete and table comments ===
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



-- === MIGRATION: accurate profile invitation metrics ===
create or replace function public.get_author_profile(p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_user_id uuid:=coalesce(p_user_id,auth.uid()); v_profile public.profiles%rowtype; v_shared boolean;
begin
 if auth.uid() is null or v_user_id is null then raise exception 'Profil görüntülemek için giriş yapmalısın.'; end if;
 select exists(select 1 from public.story_members mine join public.story_members theirs on theirs.story_id=mine.story_id where mine.user_id=auth.uid() and theirs.user_id=v_user_id) into v_shared;
 if v_user_id<>auth.uid() and not v_shared then raise exception 'Bu profili görüntülemek için aynı hikâyenin üyesi olmalısın.'; end if;
 select * into v_profile from public.profiles where id=v_user_id;
 if not found then raise exception 'Yazar profili bulunamadı.'; end if;
 return jsonb_build_object('id',v_profile.id,'display_name',v_profile.display_name,'bio',coalesce(v_profile.bio,''),'avatar_url',v_profile.avatar_url,'member_since',v_profile.created_at,'stats',jsonb_build_object(
 'stories_created',(select count(*) from public.stories s where s.owner_id=v_user_id),
 'stories_joined',(select count(*) from public.story_members sm where sm.user_id=v_user_id and sm.role='writer'),
 'chapters_written',(select count(*) from public.chapters c where c.created_by=v_user_id),
 'words_in_started_chapters',(select coalesce(sum(case when btrim(c.content)='' then 0 else cardinality(regexp_split_to_array(btrim(c.content),'\s+')) end),0) from public.chapters c where c.created_by=v_user_id),
 'writers_invited',(select count(*) from public.story_members sm where sm.invited_by=v_user_id and sm.role='writer'),
 'invite_links_created',(select count(*) from public.story_invites si where si.created_by=v_user_id),
 'chapter_edits',(select count(*) from public.chapter_revisions cr where cr.editor_id=v_user_id),
 'sentences_highlighted',null));
end $$;
revoke all on function public.get_author_profile(uuid) from public,anon;
grant execute on function public.get_author_profile(uuid) to authenticated;


-- === MIGRATION: paragraph-level authorship ===
-- Paragraph-level authorship and contribution history.
create table if not exists public.chapter_blocks (
 id uuid primary key default gen_random_uuid(),
 chapter_id uuid not null references public.chapters(id) on delete cascade,
 position integer not null default 0 check (position>=0),
 content text not null default '',
 author_id uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(chapter_id,position)
);
create index if not exists chapter_blocks_author_idx on public.chapter_blocks(author_id);
create index if not exists chapter_blocks_chapter_position_idx on public.chapter_blocks(chapter_id,position);
alter table public.chapter_blocks enable row level security;
drop policy if exists "Members can read chapter blocks" on public.chapter_blocks;
create policy "Members can read chapter blocks" on public.chapter_blocks for select to authenticated using (
 exists(select 1 from public.chapters c join public.story_members sm on sm.story_id=c.story_id where c.id=chapter_id and sm.user_id=auth.uid())
);
drop policy if exists "Members can write chapter blocks" on public.chapter_blocks;
create policy "Members can write chapter blocks" on public.chapter_blocks for all to authenticated using (
 exists(select 1 from public.chapters c join public.story_members sm on sm.story_id=c.story_id where c.id=chapter_id and sm.user_id=auth.uid())
) with check (
 exists(select 1 from public.chapters c join public.story_members sm on sm.story_id=c.story_id where c.id=chapter_id and sm.user_id=auth.uid())
);
insert into public.chapter_blocks(chapter_id,position,content,author_id,updated_by)
select c.id, row_number() over(partition by c.id order by p.ordinality)-1, p.content, null, null
from public.chapters c
cross join lateral regexp_split_to_table(c.content,E'\n[[:space:]]*\n') with ordinality as p(content,ordinality)
where btrim(p.content)<>''
and not exists(select 1 from public.chapter_blocks b where b.chapter_id=c.id);
create or replace function public.save_chapter_blocks(p_chapter_id uuid,p_title text,p_status text,p_blocks jsonb)
returns public.chapters language plpgsql security definer set search_path=public,private as $$
declare v_chapter public.chapters%rowtype; v_item jsonb; v_position integer:=0; v_id uuid; v_content text:='';
begin
 if auth.uid() is null then raise exception 'Önce giriş yapmalısın.'; end if;
 if not private.is_story_member((select story_id from public.chapters where id=p_chapter_id)) then raise exception 'Bu hikâyeye erişimin yok.'; end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 120 then raise exception 'Bölüm başlığı 1-120 karakter olmalı.'; end if;
 if p_status not in ('draft','published') then raise exception 'Geçersiz bölüm durumu.'; end if;
 if jsonb_typeof(p_blocks)<>'array' or jsonb_array_length(p_blocks)>500 then raise exception 'Paragraf listesi geçersiz veya çok uzun.'; end if;
 for v_item in select value from jsonb_array_elements(p_blocks) loop
  if jsonb_typeof(v_item->'content')<>'string' then raise exception 'Paragraf içeriği metin olmalı.'; end if;
  if char_length(v_item->>'content')>50000 then raise exception 'Tek paragraf en fazla 50.000 karakter olabilir.'; end if;
  v_content:=v_content||case when v_position=0 then '' else E'\\n\\n' end||(v_item->>'content');
  v_position:=v_position+1;
 end loop;
 update public.chapters set title=btrim(p_title),content=v_content,status=p_status,updated_at=now()
 where id=p_chapter_id returning * into v_chapter;
 if not found then raise exception 'Bölüm bulunamadı.'; end if;
 update public.chapter_blocks set position=position+10000 where chapter_id=p_chapter_id;
 v_position:=0;
 for v_item in select value from jsonb_array_elements(p_blocks) loop
  v_id:=nullif(v_item->>'id','')::uuid;
  if v_id is not null then
   update public.chapter_blocks set position=v_position,content=v_item->>'content',updated_by=auth.uid(),updated_at=now()
   where id=v_id and chapter_id=p_chapter_id;
   if not found then raise exception 'Paragraf bu bölüme ait değil.'; end if;
  else
   insert into public.chapter_blocks(chapter_id,position,content,author_id,updated_by)
   values(p_chapter_id,v_position,v_item->>'content',auth.uid(),auth.uid());
  end if;
  v_position:=v_position+1;
 end loop;
 delete from public.chapter_blocks where chapter_id=p_chapter_id and position>=v_position;
 return v_chapter;
end $$;
revoke all on function public.save_chapter_blocks(uuid,text,text,jsonb) from public,anon;
grant execute on function public.save_chapter_blocks(uuid,text,text,jsonb) to authenticated;
comment on table public.chapter_blocks is 'PARAGRAF KATKILARI | Bölümün paragraf metni, ilk yazarı, son düzenleyeni ve sırası.';
comment on column public.chapter_blocks.author_id is 'Paragrafın ilk yazarı; paragrafı sonradan düzenleyen kişiden bağımsızdır. Eski metinlerde NULL olabilir.';
comment on column public.chapter_blocks.updated_by is 'Paragrafı en son düzenleyen yazar.';



-- === MIGRATION: author profile paragraph contribution metrics ===
create or replace function public.get_author_profile(p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_user_id uuid:=coalesce(p_user_id,auth.uid()); v_profile public.profiles%rowtype; v_shared boolean;
begin
 if auth.uid() is null or v_user_id is null then raise exception 'Profil görüntülemek için giriş yapmalısın.'; end if;
 select exists(select 1 from public.story_members mine join public.story_members theirs on theirs.story_id=mine.story_id where mine.user_id=auth.uid() and theirs.user_id=v_user_id) into v_shared;
 if v_user_id<>auth.uid() and not v_shared then raise exception 'Bu profili görüntülemek için aynı hikâyenin üyesi olmalısın.'; end if;
 select * into v_profile from public.profiles where id=v_user_id;
 if not found then raise exception 'Yazar profili bulunamadı.'; end if;
 return jsonb_build_object('id',v_profile.id,'display_name',v_profile.display_name,'bio',coalesce(v_profile.bio,''),'avatar_url',v_profile.avatar_url,'member_since',v_profile.created_at,'stats',jsonb_build_object(
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


-- === MIGRATION: correct paragraph separators to real newlines ===
create or replace function public.save_chapter_blocks(p_chapter_id uuid,p_title text,p_status text,p_blocks jsonb)
returns public.chapters language plpgsql security definer set search_path=public,private as $$
declare v_chapter public.chapters%rowtype; v_item jsonb; v_position integer:=0; v_id uuid; v_content text:='';
begin
 if auth.uid() is null then raise exception 'Önce giriş yapmalısın.'; end if;
 if not private.is_story_member((select story_id from public.chapters where id=p_chapter_id)) then raise exception 'Bu hikâyeye erişimin yok.'; end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 120 then raise exception 'Bölüm başlığı 1-120 karakter olmalı.'; end if;
 if p_status not in ('draft','published') then raise exception 'Geçersiz bölüm durumu.'; end if;
 if jsonb_typeof(p_blocks)<>'array' or jsonb_array_length(p_blocks)>500 then raise exception 'Paragraf listesi geçersiz veya çok uzun.'; end if;
 for v_item in select value from jsonb_array_elements(p_blocks) loop
  if jsonb_typeof(v_item->'content')<>'string' then raise exception 'Paragraf içeriği metin olmalı.'; end if;
  if char_length(v_item->>'content')>50000 then raise exception 'Tek paragraf en fazla 50.000 karakter olabilir.'; end if;
  v_content:=v_content||case when v_position=0 then '' else E'\n\n' end||(v_item->>'content');
  v_position:=v_position+1;
 end loop;
 update public.chapters set title=btrim(p_title),content=v_content,status=p_status,updated_at=now()
 where id=p_chapter_id returning * into v_chapter;
 if not found then raise exception 'Bölüm bulunamadı.'; end if;
 update public.chapter_blocks set position=position+10000 where chapter_id=p_chapter_id;
 v_position:=0;
 for v_item in select value from jsonb_array_elements(p_blocks) loop
  v_id:=nullif(v_item->>'id','')::uuid;
  if v_id is not null then
   update public.chapter_blocks set position=v_position,content=v_item->>'content',updated_by=auth.uid(),updated_at=now()
   where id=v_id and chapter_id=p_chapter_id;
   if not found then raise exception 'Paragraf bu bölüme ait değil.'; end if;
  else
   insert into public.chapter_blocks(chapter_id,position,content,author_id,updated_by)
   values(p_chapter_id,v_position,v_item->>'content',auth.uid(),auth.uid());
  end if;
  v_position:=v_position+1;
 end loop;
 delete from public.chapter_blocks where chapter_id=p_chapter_id and position>=10000;
 return v_chapter;
end $$;
revoke all on function public.save_chapter_blocks(uuid,text,text,jsonb) from public,anon;
grant execute on function public.save_chapter_blocks(uuid,text,text,jsonb) to authenticated;


-- === MIGRATION: safe story-scoped author display names ===
create or replace function public.get_story_author_names(p_chapter_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_story_id uuid; v_result jsonb;
begin
 if auth.uid() is null then raise exception 'Önce giriş yapmalısın.'; end if;
 select story_id into v_story_id from public.chapters where id=p_chapter_id;
 if v_story_id is null or not private.is_story_member(v_story_id) then raise exception 'Bu hikâyeye erişimin yok.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',sm.user_id,'display_name',coalesce(p.display_name,'Yazar'))),'[]'::jsonb)
 into v_result from public.story_members sm left join public.profiles p on p.id=sm.user_id where sm.story_id=v_story_id;
 return v_result;
end $$;
revoke all on function public.get_story_author_names(uuid) from public,anon;
grant execute on function public.get_story_author_names(uuid) to authenticated;
