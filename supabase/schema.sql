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
