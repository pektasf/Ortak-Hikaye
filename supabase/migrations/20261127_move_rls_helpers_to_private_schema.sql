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
