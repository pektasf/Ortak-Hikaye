-- Restore SQL privileges required by existing member-scoped chapter RLS policies.
grant insert, update on public.chapters to authenticated;
