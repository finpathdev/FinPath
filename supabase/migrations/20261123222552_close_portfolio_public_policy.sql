-- Drop the PUBLIC portfolio policy that used USING (true) / WITH CHECK (true).
-- RLS policies are OR'd, so it let the anon key read and write every row.
-- Signed-in owners keep "users have full control of their own portfolio".
-- Applied to project ivhhfhemcecwqadrjmwq on 2026-11-23 (version 20261123222552).
-- Re-running is safe.

drop policy if exists "Users can manage their own portfolio" on public.portfolio;

revoke all on table public.portfolio from anon;
revoke truncate, references, trigger on table public.portfolio from authenticated;

-- These are trigger functions. They should not be callable through the Data API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
