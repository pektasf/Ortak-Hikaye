-- pgcrypto is installed in Supabase's extensions schema; include it in SECURITY DEFINER RPC search_path.
alter function public.create_story_invite(uuid,integer,integer)
  set search_path = public, private, extensions;
alter function public.redeem_story_invite(text)
  set search_path = public, private, extensions;
