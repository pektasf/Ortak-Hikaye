-- Distinguish invite links created from writers who actually joined through them.
create or replace function public.get_author_profile(p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare v_user_id uuid:=coalesce(p_user_id,auth.uid()); v_profile public.profiles%rowtype; v_shared boolean;
begin
 if auth.uid() is null or v_user_id is null then raise exception 'Profil görüntülemek için giriş yapmalısın.'; end if;
 select exists(select 1 from public.story_members mine join public.story_members theirs on theirs.story_id=mine.story_id where mine.user_id=auth.uid() and theirs.user_id=v_user_id) into v_shared;
 if v_user_id<>auth.uid() and not v_shared then raise exception 'Bu profili görüntülemek için aynı hikâyenin üyesi olmalısın.'; end if;
 select * into v_profile from public.profiles where id=v_user_id;
 if not found then raise exception 'Yazar profili bulunamadı.'; end if;
 return jsonb_build_object('id',v_profile.id,'display_name',v_profile.display_name,'bio',coalesce(v_profile.bio,''),'avatar_url',v_profile.avatar_url,'member_since',v_profile.created_at,'stats',jsonb_build_object(
 'stories_created',(select count(*) from public.stories s where s.owner_id=v_user_id),
 'stories_joined',(select count(*) from public.story_members sm where sm.user_id=v_user_id and sm.role='writer'),
 'chapters_written',(select count(*) from public.chapters c where c.created_by=v_user_id),
 'words_in_started_chapters',(select coalesce(sum(case when btrim(c.content)='' then 0 else cardinality(regexp_split_to_array(btrim(c.content),'\s+')) end),0) from public.chapters c where c.created_by=v_user_id),
 'writers_invited',(select count(*) from public.story_members sm where sm.invited_by=v_user_id and sm.role='writer'),
 'invite_links_created',(select count(*) from public.story_invites si where si.created_by=v_user_id),
 'chapter_edits',(select count(*) from public.chapter_revisions cr where cr.editor_id=v_user_id),
 'sentences_highlighted',null));
end $$;
revoke all on function public.get_author_profile(uuid) from public,anon;
grant execute on function public.get_author_profile(uuid) to authenticated;