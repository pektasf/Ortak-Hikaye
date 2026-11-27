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
