-- Server-side paragraph ownership guard for the collaborative chapter save RPC.
-- No existing rows are backfilled, rewritten or deleted by this migration.
create or replace function public.save_chapter_blocks(p_chapter_id uuid,p_title text,p_status text,p_blocks jsonb)
returns public.chapters language plpgsql security definer set search_path=public,private as $$
declare
 v_chapter public.chapters%rowtype; v_item jsonb; v_position integer:=0; v_id uuid;
 v_content text:=''; v_words integer; v_story public.stories%rowtype; v_book public.books%rowtype;
 v_total_story integer; v_total_book integer; v_old_protected uuid[]; v_new_protected uuid[];
begin
 if auth.uid() is null then raise exception 'Önce giriş yapmalısın.'; end if;
 select * into v_chapter from public.chapters where id=p_chapter_id for update;
 if not found or not private.is_story_member(v_chapter.story_id) then raise exception 'Bu hikâyeye erişimin yok.'; end if;
 if not exists(select 1 from public.chapter_writing_locks l where l.chapter_id=p_chapter_id and l.user_id=auth.uid() and l.expires_at>now()) then
   raise exception 'Yazma oturumu sona erdi. Bölümü yeniden açarak yazma sırasını al.';
 end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 120 then raise exception 'Bölüm başlığı 1-120 karakter olmalı.'; end if;
 if p_status not in ('draft','published') then raise exception 'Geçersiz bölüm durumu.'; end if;
 if jsonb_typeof(p_blocks)<>'array' or jsonb_array_length(p_blocks)>500 then raise exception 'Paragraf listesi geçersiz veya çok uzun.'; end if;

 select coalesce(array_agg(id order by position),array[]::uuid[]) into v_old_protected
 from public.chapter_blocks where chapter_id=p_chapter_id and author_id is distinct from auth.uid();
 select coalesce(array_agg((x.item->>'id')::uuid order by x.ordinality),array[]::uuid[]) into v_new_protected
 from jsonb_array_elements(p_blocks) with ordinality as x(item,ordinality)
 where nullif(x.item->>'id','') is not null
 and exists(select 1 from public.chapter_blocks b where b.id=(x.item->>'id')::uuid and b.chapter_id=p_chapter_id and b.author_id is distinct from auth.uid());
 if v_old_protected is distinct from v_new_protected then
   raise exception 'Başka yazarlara ait paragraflar silinemez veya sıraları değiştirilemez.';
 end if;
 if exists(
   select 1 from public.chapter_blocks b where b.chapter_id=p_chapter_id and b.author_id is distinct from auth.uid()
   and not exists(select 1 from jsonb_array_elements(p_blocks) x where nullif(x->>'id','')::uuid=b.id and x->>'content'=b.content)
 ) then raise exception 'Başka yazarlara ait paragraflar değiştirilemez veya silinemez.'; end if;
 if exists(select 1 from (select (x->>'id')::uuid id from jsonb_array_elements(p_blocks) x where nullif(x->>'id','') is not null group by (x->>'id')::uuid having count(*)>1) d) then
   raise exception 'Aynı paragraf birden fazla kez gönderildi.';
 end if;
 for v_item in select value from jsonb_array_elements(p_blocks) loop
   if jsonb_typeof(v_item->'content')<>'string' then raise exception 'Paragraf içeriği metin olmalı.'; end if;
   if char_length(v_item->>'content')>50000 then raise exception 'Tek paragraf en fazla 50.000 karakter olabilir.'; end if;
   v_id:=nullif(v_item->>'id','')::uuid;
   if v_id is not null and not exists(select 1 from public.chapter_blocks b where b.id=v_id and b.chapter_id=p_chapter_id) then raise exception 'Paragraf bu bölüme ait değil.'; end if;
   v_content:=v_content||case when v_position=0 then '' else E'\n\n' end||(v_item->>'content');
   v_position:=v_position+1;
 end loop;
 v_words:=case when btrim(v_content)='' then 0 else cardinality(regexp_split_to_array(btrim(v_content),'\s+')) end;
 if v_words>v_chapter.target_words then raise exception 'Bölüm kelime sınırı aşıldı. Hedef: % kelime.',v_chapter.target_words; end if;
 select * into v_story from public.stories where id=v_chapter.story_id;
 select * into v_book from public.books where id=v_story.book_id;
 select coalesce(sum(case when c.id=p_chapter_id then v_words else cardinality(regexp_split_to_array(nullif(btrim(c.content),''),'\s+')) end),0) into v_total_story from public.chapters c where c.story_id=v_story.id;
 if v_total_story>v_story.target_words then raise exception 'Hikâye kelime sınırı aşıldı. Hedef: % kelime.',v_story.target_words; end if;
 select coalesce(sum(case when c.id=p_chapter_id then v_words else cardinality(regexp_split_to_array(nullif(btrim(c.content),''),'\s+')) end),0) into v_total_book from public.chapters c join public.stories s on s.id=c.story_id where s.book_id=v_book.id;
 if v_total_book>v_book.target_words+v_book.extension_words then raise exception 'Kitap kelime sınırı aşıldı. İzin verilen toplam: % kelime.',v_book.target_words+v_book.extension_words; end if;

 update public.chapters set title=btrim(p_title),content=v_content,status=p_status,updated_at=now() where id=p_chapter_id returning * into v_chapter;
 update public.chapter_blocks set position=position+10000 where chapter_id=p_chapter_id;
 v_position:=0;
 for v_item in select value from jsonb_array_elements(p_blocks) loop
   v_id:=nullif(v_item->>'id','')::uuid;
   if v_id is not null then
     update public.chapter_blocks set position=v_position,
       content=case when author_id=auth.uid() then v_item->>'content' else content end,
       updated_by=case when author_id=auth.uid() then auth.uid() else updated_by end,
       updated_at=case when author_id=auth.uid() then now() else updated_at end
     where id=v_id and chapter_id=p_chapter_id;
   else
     insert into public.chapter_blocks(chapter_id,position,content,author_id,updated_by)
     values(p_chapter_id,v_position,v_item->>'content',auth.uid(),auth.uid());
   end if;
   v_position:=v_position+1;
 end loop;
 delete from public.chapter_blocks where chapter_id=p_chapter_id and position>=10000 and author_id=auth.uid();
 return v_chapter;
end $$;
revoke all on function public.save_chapter_blocks(uuid,text,text,jsonb) from public,anon;
grant execute on function public.save_chapter_blocks(uuid,text,text,jsonb) to authenticated;

-- Rollback: restore the function body from the preceding
-- 20261127_social_network_live_writing_and_word_limits migration.
