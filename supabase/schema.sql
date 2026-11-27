-- ORTAK ROMAN / Supabase PostgreSQL schema
-- Run once in Supabase SQL Editor. Auth is invite-only: disable public signups in Authentication settings.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Yazar' check (char_length(display_name) between 1 and 24),
  role text not null default 'writer' check (role in ('writer','moderator','owner')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'name','Yazar')) on conflict(id) do nothing;
 return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Ortak Roman', subtitle text not null default 'Bir hikâye, birçok ses',
  note text not null default '', target_words integer not null default 1000 check(target_words >= 100),
  extension_words integer not null default 1000 check(extension_words >= 100),
  finished boolean not null default false, updated_at timestamptz not null default now()
);
insert into public.books(title,subtitle,note) select 'Ortak Roman','Bir hikâye, birçok ses','Bu kitap, birbirini hiç tanımayan insanların aynı hikâyede buluşmasıyla doğdu.' where not exists(select 1 from public.books);
create table if not exists public.story_entries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 display_name text not null, content text not null check(char_length(content) between 1 and 6000), created_at timestamptz not null default now()
);
create table if not exists public.writing_locks (
 id integer primary key default 1 check(id=1), user_id uuid references public.profiles(id) on delete set null,
 display_name text, expires_at timestamptz, updated_at timestamptz not null default now()
);
insert into public.writing_locks(id) values(1) on conflict do nothing;
create table if not exists public.story_votes (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 choice text not null check(choice in ('extend','end')), created_at timestamptz not null default now()
);

create or replace function public.current_profile_role() returns text language sql stable security definer set search_path=public as $$
 select role from public.profiles where id=auth.uid();
$$;
create or replace function public.is_moderator() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.current_profile_role() in ('owner','moderator'),false);
$$;
create or replace function public.acquire_writing_lock(p_display_name text) returns jsonb language plpgsql security definer set search_path=public as $$
declare l public.writing_locks%rowtype;
begin
 if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Profil kaydı bulunamadı.'; end if;
 select * into l from public.writing_locks where id=1 for update;
 if l.user_id is not null and l.expires_at > now() and l.user_id <> auth.uid() then
   return jsonb_build_object('ok',false,'message',coalesce(l.display_name,'Bir yazar')||' yazıyor.');
 end if;
 -- Prevent consecutive turns for 15 minutes unless another writer contributed in between.
 if exists(select 1 from public.story_entries e order by e.created_at desc limit 1) then
   if (select e.user_id=auth.uid() and e.created_at>now()-interval '15 minutes' from public.story_entries e order by e.created_at desc limit 1) then
     return jsonb_build_object('ok',false,'message','Arka arkaya tur alamazsın. Başka biri yazdıktan sonra veya 15 dakika sonra tekrar dene.');
   end if;
 end if;
 update public.writing_locks set user_id=auth.uid(),display_name=left(trim(p_display_name),24),expires_at=now()+interval '25 seconds',updated_at=now() where id=1 returning * into l;
 return jsonb_build_object('ok',true,'lock',to_jsonb(l));
end $$;
create or replace function public.renew_writing_lock() returns void language plpgsql security definer set search_path=public as $$
begin update public.writing_locks set expires_at=now()+interval '25 seconds',updated_at=now() where id=1 and user_id=auth.uid() and expires_at>now(); end $$;
create or replace function public.release_writing_lock() returns void language plpgsql security definer set search_path=public as $$
begin update public.writing_locks set user_id=null,display_name=null,expires_at=null,updated_at=now() where id=1 and user_id=auth.uid(); end $$;
create or replace function public.moderator_resolve_vote(p_choice text) returns void language plpgsql security definer set search_path=public as $$
declare yes_count int; no_count int; eligible_count int; next_target int;
begin
 if not public.is_moderator() then raise exception 'Bu işlem için moderatör yetkisi gerekli.'; end if;
 if p_choice not in ('extend','end') then raise exception 'Geçersiz karar.'; end if;
 select count(*) filter(where choice='extend'),count(*) filter(where choice='end') into yes_count,no_count from public.story_votes v where exists(select 1 from public.story_entries e where e.user_id=v.user_id);
 select count(distinct user_id) into eligible_count from public.story_entries;
 if (p_choice='extend' and yes_count < floor(eligible_count/2.0)+1) or (p_choice='end' and no_count < floor(eligible_count/2.0)+1) then
   raise exception 'Bu karar için yazarların çoğunluk oyu henüz oluşmadı.';
 end if;
 if p_choice='extend' then
   select target_words+extension_words into next_target from public.books limit 1;
   update public.books set target_words=next_target,finished=false,updated_at=now();
 else update public.books set finished=true,updated_at=now(); end if;
 delete from public.story_votes;
end $$;

alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.story_entries enable row level security;
alter table public.writing_locks enable row level security;
alter table public.story_votes enable row level security;

drop policy if exists "profiles visible to authenticated" on public.profiles;
create policy "profiles visible to authenticated" on public.profiles for select to authenticated using(true);
drop policy if exists "users create own profile" on public.profiles;
create policy "users create own profile" on public.profiles for insert to authenticated with check(id=auth.uid() and role='writer');
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid() and role=public.current_profile_role());

drop policy if exists "books readable" on public.books;
create policy "books readable" on public.books for select to anon,authenticated using(true);
drop policy if exists "moderators update books" on public.books;
create policy "moderators update books" on public.books for update to authenticated using(public.is_moderator()) with check(public.is_moderator());

drop policy if exists "entries readable" on public.story_entries;
create policy "entries readable" on public.story_entries for select to anon,authenticated using(true);
drop policy if exists "writers insert own entry while holding lock" on public.story_entries;
create policy "writers insert own entry while holding lock" on public.story_entries for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.writing_locks l where l.id=1 and l.user_id=auth.uid() and l.expires_at>now()) and (select count(*) from regexp_split_to_table(trim(content), E'\\s+') as token where token <> '') <= 200);
drop policy if exists "moderators delete entries" on public.story_entries;
create policy "moderators delete entries" on public.story_entries for delete to authenticated using(public.is_moderator());

drop policy if exists "lock readable" on public.writing_locks;
create policy "lock readable" on public.writing_locks for select to anon,authenticated using(true);
drop policy if exists "votes readable" on public.story_votes;
create policy "votes readable" on public.story_votes for select to authenticated using(true);
drop policy if exists "contributors vote once" on public.story_votes;
create policy "contributors vote once" on public.story_votes for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.story_entries e where e.user_id=auth.uid()));
drop policy if exists "contributors change own vote" on public.story_votes;
create policy "contributors change own vote" on public.story_votes for update to authenticated using(user_id=auth.uid() and exists(select 1 from public.story_entries e where e.user_id=auth.uid())) with check(user_id=auth.uid() and exists(select 1 from public.story_entries e where e.user_id=auth.uid()));

grant usage on schema public to anon,authenticated;
grant select on public.books,public.story_entries,public.writing_locks to anon,authenticated;
grant select,insert,update on public.profiles to authenticated;
grant insert,select,delete on public.story_entries to authenticated;
grant select,insert,update on public.story_votes to authenticated;
grant execute on function public.acquire_writing_lock(text),public.renew_writing_lock(),public.release_writing_lock(),public.moderator_resolve_vote(text),public.is_moderator(),public.current_profile_role() to authenticated;

-- After creating your own account via an invitation, run this with that account's UUID:
-- update public.profiles set role='owner' where id='YOUR-AUTH-USER-UUID';
-- Enable Realtime for story_entries, writing_locks, story_votes and books in Supabase publication settings.

-- Enable database change broadcasts (safe to run repeatedly).
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
