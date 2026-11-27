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
