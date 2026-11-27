-- Optional word limits and manager-defined story themes.
-- A zero word limit means unlimited. The save RPC remains the authoritative
-- server-side guard, so clients cannot bypass limits by sending direct API calls.

alter table public.stories
  add column if not exists theme text not null default '';

alter table public.books drop constraint if exists books_target_words_check;
alter table public.books
  add constraint books_target_words_check check (target_words >= 0);

alter table public.books drop constraint if exists books_extension_words_check;
alter table public.books
  add constraint books_extension_words_check check (extension_words >= 0);

alter table public.stories drop constraint if exists stories_target_words_check;
alter table public.stories
  add constraint stories_target_words_check check (target_words >= 0 and target_words <= 1000000);

alter table public.chapters drop constraint if exists chapters_target_words_check;
alter table public.chapters
  add constraint chapters_target_words_check check (target_words >= 0 and target_words <= 100000);

-- Preserve the existing ownership, lock, paragraph-integrity and book-limit
-- checks while making each configured word limit optional.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.save_chapter_blocks(uuid,text,text,jsonb)'::regprocedure);

  if position('v_chapter.target_words > 0 and' in v_def) = 0 then
    v_def := replace(v_def,
      'if v_words > v_chapter.target_words then',
      'if v_chapter.target_words > 0 and v_words > v_chapter.target_words then');
  end if;

  if position('v_story.target_words > 0 and' in v_def) = 0 then
    v_def := replace(v_def,
      'if v_total_story > v_story.target_words then',
      'if v_story.target_words > 0 and v_total_story > v_story.target_words then');
  end if;

  if position('v_book.target_words > 0 and' in v_def) = 0 then
    v_def := replace(v_def,
      'if v_total_book > v_book.target_words + v_book.extension_words then',
      'if v_book.target_words > 0 and v_total_book > v_book.target_words + v_book.extension_words then');
  end if;

  if position('v_chapter.target_words > 0 and' in v_def) = 0
     or position('v_story.target_words > 0 and' in v_def) = 0
     or position('v_book.target_words > 0 and' in v_def) = 0 then
    raise exception 'Could not safely update all optional word-limit checks.';
  end if;

  execute v_def;
end
$$;
