revoke all on function private.is_story_member(uuid),private.is_story_owner(uuid),private.can_access_workspace(),private.can_create_story(),private.is_moderator() from public,anon;
grant execute on function private.is_story_member(uuid),private.is_story_owner(uuid),private.can_access_workspace(),private.can_create_story(),private.is_moderator() to authenticated;
create index if not exists chapter_revisions_editor_id_idx on public.chapter_revisions(editor_id);
create index if not exists chapter_revisions_story_id_idx on public.chapter_revisions(story_id);
create index if not exists reading_progress_chapter_id_idx on public.reading_progress(chapter_id);