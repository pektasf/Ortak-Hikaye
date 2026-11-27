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
