-- Allow every member of a story to invite additional writers to that same story.
-- Invited writers do not receive owner or global administrator privileges.
create or replace function public.create_story_invite(
  p_story_id uuid,
  p_max_uses integer default null,
  p_hours_valid integer default 168
) returns text
language plpgsql security definer set search_path=public as $$
declare v_token text;
begin
  if auth.uid() is null or not public.is_authorized() then
    raise exception 'Davetli hesap gerekli.';
  end if;
  if not public.is_story_member(p_story_id) then
    raise exception 'Yalnızca katıldığın hikâyeye davet oluşturabilirsin.';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 100) then
    raise exception 'Davet kullanım sayısı 1-100 arasında olmalı veya sınırsız bırakılmalı.';
  end if;
  if p_hours_valid < 1 or p_hours_valid > 720 then
    raise exception 'Davet süresi 1-720 saat arasında olmalı.';
  end if;
  v_token := encode(gen_random_bytes(24),'hex');
  insert into public.story_invites(token_hash,story_id,created_by,max_uses,expires_at)
  values(digest(convert_to(v_token,'UTF8'),'sha256'),p_story_id,auth.uid(),p_max_uses,now()+make_interval(hours=>p_hours_valid));
  return v_token;
end $$;

revoke all on function public.create_story_invite(uuid,integer,integer) from public,anon;
grant execute on function public.create_story_invite(uuid,integer,integer) to authenticated;
