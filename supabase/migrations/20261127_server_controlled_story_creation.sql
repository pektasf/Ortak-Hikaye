-- Create stories through a narrow SECURITY DEFINER RPC instead of direct table inserts.
-- This keeps ownership assignment server-controlled and prevents owner_id spoofing.
drop policy if exists "writers create own stories" on public.stories;
revoke insert on public.stories from authenticated;

create or replace function public.create_story(
  p_book_id uuid,
  p_title text,
  p_description text default ''
) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_story public.stories%rowtype;
begin
  if auth.uid() is null or not private.can_create_story() then
    raise exception 'Bir hikâye oluşturmak için önce bir hikâyeye katılmış olmalısın.';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 120 then
    raise exception 'Hikâye adı 1-120 karakter arasında olmalı.';
  end if;
  if char_length(coalesce(p_description,''))>600 then
    raise exception 'Hikâye açıklaması en fazla 600 karakter olabilir.';
  end if;
  if not exists(select 1 from public.books b where b.id=p_book_id) then
    raise exception 'Kitap bulunamadı.';
  end if;
  insert into public.stories(book_id,owner_id,title,description,status)
  values(p_book_id,auth.uid(),trim(p_title),coalesce(trim(p_description),''),'published')
  returning * into v_story;
  return to_jsonb(v_story);
end $$;
revoke all on function public.create_story(uuid,text,text) from public,anon;
grant execute on function public.create_story(uuid,text,text) to authenticated;
