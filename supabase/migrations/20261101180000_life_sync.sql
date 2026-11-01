-- Optional sync for Life Path inputs and learner-written journal notes.
-- Anonymous use stays on localStorage. The static client never sends the
-- service role key. Signed-in users can read and write only their own rows.
--
-- Apply once to project ivhhfhemcecwqadrjmwq (FinPath):
--   1. Open the SQL editor:
--      https://supabase.com/dashboard/project/ivhhfhemcecwqadrjmwq/sql/new
--   2. Paste this file and run it.
--   3. Confirm life_paths and life_journal show RLS enabled, and that a
--      second user cannot select the first user's rows.
-- Re-running is safe: tables use IF NOT EXISTS, and policies are replaced.
-- Do not grant these tables to anon. Do not put the service role key in the PWA.

create table if not exists public.life_paths (
  user_id uuid primary key references auth.users (id) on delete cascade,
  inputs jsonb not null,
  dollars text not null default 'today',
  compare_preset text not null default 'wait25',
  assumptions_version text not null default '',
  engine text not null default '',
  updated_at timestamptz not null default now(),
  constraint life_paths_inputs_object check (jsonb_typeof(inputs) = 'object'),
  constraint life_paths_inputs_size check (octet_length(inputs::text) <= 12000),
  constraint life_paths_dollars check (dollars in ('today', 'future')),
  constraint life_paths_preset_len check (char_length(compare_preset) <= 40),
  constraint life_paths_version_len check (char_length(assumptions_version) <= 40),
  constraint life_paths_engine_len check (char_length(engine) <= 40)
);

create table if not exists public.life_journal (
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_id text not null,
  kind text not null,
  title text not null default '',
  why text not null default '',
  concept_ids text[] not null default '{}',
  at bigint not null,
  ref text not null default '',
  updated_at timestamptz not null default now(),
  constraint life_journal_pkey primary key (user_id, entry_id),
  constraint life_journal_id_len check (char_length(entry_id) between 1 and 80),
  constraint life_journal_kind check (kind in ('trade', 'simulation', 'goal', 'learning', 'reflection')),
  constraint life_journal_title_len check (char_length(title) <= 140),
  constraint life_journal_why_len check (char_length(why) <= 280),
  constraint life_journal_ref_len check (char_length(ref) <= 40),
  constraint life_journal_concepts_len check (cardinality(concept_ids) <= 8),
  constraint life_journal_at_nonnegative check (at >= 0)
);

comment on table public.life_paths is
  'Current Life Path inputs for one signed-in learner. Educational model state, not an account balance.';
comment on table public.life_journal is
  'Learner-written Life Path notes (simulations and reflections). Paper trades and lessons stay in the browser.';

create index if not exists life_journal_user_at_idx
  on public.life_journal (user_id, at desc);

alter table public.life_paths enable row level security;
alter table public.life_paths force row level security;
alter table public.life_journal enable row level security;
alter table public.life_journal force row level security;

revoke all on table public.life_paths from public, anon, authenticated;
revoke all on table public.life_journal from public, anon, authenticated;

grant select, insert, update, delete on table public.life_paths to authenticated;
grant select, insert, update, delete on table public.life_journal to authenticated;
grant select, insert, update, delete on table public.life_paths to service_role;
grant select, insert, update, delete on table public.life_journal to service_role;

drop policy if exists life_paths_select_own on public.life_paths;
drop policy if exists life_paths_insert_own on public.life_paths;
drop policy if exists life_paths_update_own on public.life_paths;
drop policy if exists life_paths_delete_own on public.life_paths;
drop policy if exists life_journal_select_own on public.life_journal;
drop policy if exists life_journal_insert_own on public.life_journal;
drop policy if exists life_journal_update_own on public.life_journal;
drop policy if exists life_journal_delete_own on public.life_journal;

create policy life_paths_select_own
  on public.life_paths
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy life_paths_insert_own
  on public.life_paths
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy life_paths_update_own
  on public.life_paths
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy life_paths_delete_own
  on public.life_paths
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy life_journal_select_own
  on public.life_journal
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy life_journal_insert_own
  on public.life_journal
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy life_journal_update_own
  on public.life_journal
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy life_journal_delete_own
  on public.life_journal
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
