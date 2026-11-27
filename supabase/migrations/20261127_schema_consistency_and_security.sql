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