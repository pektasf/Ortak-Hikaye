create or replace function public.get_story_author_names(p_chapter_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_story_id uuid; v_result jsonb;
begin
 if auth.uid() is null then raise exception 'Önce giriş yapmalısın.'; end if;
 select story_id into v_story_id from public.chapters where id=p_chapter_id;
 if v_story_id is null or not private.is_story_member(v_story_id) then raise exception 'Bu hikâyeye erişimin yok.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',sm.user_id,'display_name',coalesce(p.display_name,'Yazar'))),'[]'::jsonb)
 into v_result from public.story_members sm left join public.profiles p on p.id=sm.user_id where sm.story_id=v_story_id;
 return v_result;
end $$;
revoke all on function public.get_story_author_names(uuid) from public,anon;
grant execute on function public.get_story_author_names(uuid) to authenticated;