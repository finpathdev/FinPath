-- Intelligence sync and the opt-in efficacy study.
-- Anonymous use stays on localStorage. The static client never sends the
-- service role key. Signed-in users can read and write only their own rows
-- on the six intelligence tables. The efficacy study is a separate table:
-- it has no user id and no email, and clients cannot read it.
--
-- Apply once to project ivhhfhemcecwqadrjmwq (FinPath):
--   1. Open the SQL editor:
--      https://supabase.com/dashboard/project/ivhhfhemcecwqadrjmwq/sql/new
--   2. Paste this file and run it.
--   3. RLS checks (also encoded in supabase/tests/intel_sync_rls.test.mjs):
--      a. concept_mastery, literacy_scores, thesis_entries,
--         behavior_snapshots, risk_snapshots, and study_plans show
--         relrowsecurity and relforcerowsecurity.
--      b. As user A, select returns only A's rows. User B's select does not
--         include A's rows. User B's insert of a row with A's user_id fails
--         the WITH CHECK policy.
--      c. anon has no grants on these tables.
--      d. efficacy_events has RLS forced on, no client policies, and no
--         grants for anon or authenticated. A signed-in select returns zero
--         rows. Inserts and deletes go through the efficacy-summary Edge
--         Function (service role), which never returns individual rows.
-- Re-running is safe: tables use IF NOT EXISTS, and policies are replaced.
-- Do not put the service role key in the PWA.
--
-- COPPA: the study table is not for anyone under 13. The client blocks
-- under-13 enrollment, and the Edge Function refuses a record that does not
-- attest 13+. This table stores no name, school, exact age, or location.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Keep a client timestamp when the sync sends one. That is the conflict
  -- clock. Fill or bump only when the statement did not change updated_at.
  if tg_op = 'INSERT' then
    if new.updated_at is null then
      new.updated_at = now();
    end if;
  elsif new.updated_at is null or new.updated_at = old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function public.touch_updated_at() from public, anon;
grant execute on function public.touch_updated_at() to authenticated, service_role;

create table if not exists public.concept_mastery (
  user_id uuid not null references auth.users (id) on delete cascade,
  concept_id text not null,
  score smallint not null,
  status text not null,
  lessons_done integer not null default 0,
  lessons_total integer not null default 0,
  quiz_correct integer not null default 0,
  quiz_total integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concept_mastery_pkey primary key (user_id, concept_id),
  constraint concept_mastery_id_len check (char_length(concept_id) between 1 and 40),
  constraint concept_mastery_score check (score between 0 and 100),
  constraint concept_mastery_status check (status in ('not_started', 'just_met', 'practicing', 'steady')),
  constraint concept_mastery_lessons check (lessons_done >= 0 and lessons_total >= 0 and lessons_done <= 200 and lessons_total <= 200),
  constraint concept_mastery_quiz check (quiz_correct >= 0 and quiz_total >= 0 and quiz_correct <= quiz_total and quiz_total <= 400)
);

create table if not exists public.literacy_scores (
  user_id uuid not null references auth.users (id) on delete cascade,
  snapshot_id text not null,
  score integer not null,
  lesson_points integer not null,
  quiz_points integer not null,
  breadth_points integer not null,
  lessons_done integer not null,
  lessons_total integer not null,
  quiz_correct integer not null,
  quiz_total integer not null,
  concepts_touched integer not null,
  concept_count integer not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint literacy_scores_pkey primary key (user_id, snapshot_id),
  constraint literacy_scores_id_len check (char_length(snapshot_id) between 1 and 80),
  constraint literacy_scores_score check (score between 0 and 1000),
  constraint literacy_scores_parts check (
    lesson_points between 0 and 400
    and quiz_points between 0 and 400
    and breadth_points between 0 and 200
  ),
  constraint literacy_scores_counts check (
    lessons_done >= 0 and lessons_total >= 0 and lessons_done <= lessons_total
    and quiz_correct >= 0 and quiz_total >= 0 and quiz_correct <= quiz_total
    and concepts_touched >= 0 and concept_count >= 0 and concepts_touched <= concept_count
    and lessons_total <= 200 and quiz_total <= 2000 and concept_count <= 40
  )
);

create table if not exists public.thesis_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_id text not null,
  ticker text not null default '',
  thesis text not null default '',
  falsifier text not null default '',
  expected_move numeric(6, 1),
  timeframe_days integer,
  confidence smallint,
  max_stake_pct numeric(5, 1),
  stake_pct numeric(6, 1),
  status text not null,
  scores jsonb,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint thesis_entries_pkey primary key (user_id, entry_id),
  constraint thesis_entries_id_len check (char_length(entry_id) between 1 and 80),
  constraint thesis_entries_ticker_len check (char_length(ticker) <= 12),
  constraint thesis_entries_thesis_len check (char_length(thesis) <= 280),
  constraint thesis_entries_falsifier_len check (char_length(falsifier) <= 280),
  constraint thesis_entries_status check (status in ('open', 'closed')),
  constraint thesis_entries_confidence check (confidence is null or confidence between 0 and 100),
  constraint thesis_entries_timeframe check (timeframe_days is null or timeframe_days in (7, 30, 90, 365)),
  constraint thesis_entries_expected check (expected_move is null or expected_move between -95 and 500),
  constraint thesis_entries_cap check (max_stake_pct is null or (max_stake_pct > 0 and max_stake_pct <= 100)),
  constraint thesis_entries_stake check (stake_pct is null or (stake_pct >= 0 and stake_pct <= 1000)),
  constraint thesis_entries_scores check (scores is null or (jsonb_typeof(scores) = 'object' and octet_length(scores::text) <= 2000))
);

create table if not exists public.behavior_snapshots (
  user_id uuid not null references auth.users (id) on delete cascade,
  snapshot_id text not null,
  captured_at timestamptz not null,
  cards jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint behavior_snapshots_pkey primary key (user_id, snapshot_id),
  constraint behavior_snapshots_id_len check (char_length(snapshot_id) between 1 and 80),
  constraint behavior_snapshots_cards check (jsonb_typeof(cards) = 'array' and octet_length(cards::text) <= 4000)
);

create table if not exists public.risk_snapshots (
  user_id uuid not null references auth.users (id) on delete cascade,
  snapshot_id text not null,
  source text not null,
  captured_at timestamptz not null,
  metrics jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint risk_snapshots_pkey primary key (user_id, snapshot_id),
  constraint risk_snapshots_id_len check (char_length(snapshot_id) between 1 and 80),
  constraint risk_snapshots_source check (source in ('paper', 'live')),
  constraint risk_snapshots_metrics check (jsonb_typeof(metrics) = 'object' and octet_length(metrics::text) <= 2000)
);

create table if not exists public.study_plans (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_key text not null,
  profile_id text not null default '',
  generated_at bigint not null,
  items jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_plans_pkey primary key (user_id, week_key),
  constraint study_plans_week check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  constraint study_plans_profile check (char_length(profile_id) <= 40),
  constraint study_plans_generated check (generated_at >= 0),
  constraint study_plans_items check (jsonb_typeof(items) = 'array' and octet_length(items::text) <= 4000)
);

-- Study rows are keyed by a random study id. There is no user_id, email,
-- name, school, exact age, or location column. age_band is optional and only
-- accepted after the client attests 13+.
create table if not exists public.efficacy_events (
  study_id uuid not null,
  event_id text not null,
  token_hash text not null,
  kind text not null,
  score integer,
  lesson_points integer,
  quiz_points integer,
  breadth_points integer,
  action text,
  age_band text,
  created_at timestamptz not null default now(),
  constraint efficacy_events_pkey primary key (study_id, event_id),
  constraint efficacy_events_event_id check (event_id ~ '^[a-z0-9:_-]{1,80}$'),
  constraint efficacy_events_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint efficacy_events_kind check (kind in ('literacy_pre', 'literacy_post', 'progress')),
  constraint efficacy_events_score check (score is null or score between 0 and 1000),
  constraint efficacy_events_lesson_points check (lesson_points is null or lesson_points between 0 and 400),
  constraint efficacy_events_quiz_points check (quiz_points is null or quiz_points between 0 and 400),
  constraint efficacy_events_breadth_points check (breadth_points is null or breadth_points between 0 and 200),
  constraint efficacy_events_action check (action is null or action in ('lesson_finished', 'quiz_finished')),
  constraint efficacy_events_age_band check (age_band is null or age_band in ('13-15', '16-17', '18-24', '25+')),
  constraint efficacy_events_shape check (
    (
      kind in ('literacy_pre', 'literacy_post')
      and score is not null
      and action is null
    )
    or (
      kind = 'progress'
      and action is not null
      and score is null
      and lesson_points is null
      and quiz_points is null
      and breadth_points is null
    )
  )
);

comment on table public.concept_mastery is
  'Per-concept literacy marks for one signed-in learner. Local lessons stay the source of truth.';
comment on table public.literacy_scores is
  'Literacy score history for one signed-in learner. Not a credit score.';
comment on table public.thesis_entries is
  'Paper-trade thesis notes, falsifier, confidence, and scores. Not an order.';
comment on table public.behavior_snapshots is
  'Practice-journal pattern counts. Status and sample size only, no free-text notes.';
comment on table public.risk_snapshots is
  'Risk-check numbers for one account. No ticker list.';
comment on table public.study_plans is
  'Weekly study plan items for one signed-in learner.';
comment on table public.efficacy_events is
  'Opt-in efficacy study. Random study id, not an account. No name, email, school, exact age, or location. Clients cannot select rows.';

create index if not exists concept_mastery_user_created_idx
  on public.concept_mastery (user_id, created_at desc);
create index if not exists concept_mastery_user_updated_idx
  on public.concept_mastery (user_id, updated_at desc);
create index if not exists literacy_scores_user_created_idx
  on public.literacy_scores (user_id, created_at desc);
create index if not exists literacy_scores_user_captured_idx
  on public.literacy_scores (user_id, captured_at desc);
create index if not exists thesis_entries_user_created_idx
  on public.thesis_entries (user_id, created_at desc);
create index if not exists thesis_entries_user_updated_idx
  on public.thesis_entries (user_id, updated_at desc);
create index if not exists behavior_snapshots_user_created_idx
  on public.behavior_snapshots (user_id, created_at desc);
create index if not exists risk_snapshots_user_created_idx
  on public.risk_snapshots (user_id, created_at desc);
create index if not exists study_plans_user_created_idx
  on public.study_plans (user_id, created_at desc);
create index if not exists study_plans_user_updated_idx
  on public.study_plans (user_id, updated_at desc);
create index if not exists efficacy_events_created_idx
  on public.efficacy_events (created_at desc);
create unique index if not exists efficacy_events_one_pre
  on public.efficacy_events (study_id) where kind = 'literacy_pre';

alter table public.concept_mastery enable row level security;
alter table public.concept_mastery force row level security;
alter table public.literacy_scores enable row level security;
alter table public.literacy_scores force row level security;
alter table public.thesis_entries enable row level security;
alter table public.thesis_entries force row level security;
alter table public.behavior_snapshots enable row level security;
alter table public.behavior_snapshots force row level security;
alter table public.risk_snapshots enable row level security;
alter table public.risk_snapshots force row level security;
alter table public.study_plans enable row level security;
alter table public.study_plans force row level security;
alter table public.efficacy_events enable row level security;
alter table public.efficacy_events force row level security;

revoke all on table public.concept_mastery from public, anon, authenticated;
revoke all on table public.literacy_scores from public, anon, authenticated;
revoke all on table public.thesis_entries from public, anon, authenticated;
revoke all on table public.behavior_snapshots from public, anon, authenticated;
revoke all on table public.risk_snapshots from public, anon, authenticated;
revoke all on table public.study_plans from public, anon, authenticated;
revoke all on table public.efficacy_events from public, anon, authenticated;

grant select, insert, update, delete on table public.concept_mastery to authenticated;
grant select, insert, update, delete on table public.literacy_scores to authenticated;
grant select, insert, update, delete on table public.thesis_entries to authenticated;
grant select, insert, update, delete on table public.behavior_snapshots to authenticated;
grant select, insert, update, delete on table public.risk_snapshots to authenticated;
grant select, insert, update, delete on table public.study_plans to authenticated;

grant select, insert, update, delete on table public.concept_mastery to service_role;
grant select, insert, update, delete on table public.literacy_scores to service_role;
grant select, insert, update, delete on table public.thesis_entries to service_role;
grant select, insert, update, delete on table public.behavior_snapshots to service_role;
grant select, insert, update, delete on table public.risk_snapshots to service_role;
grant select, insert, update, delete on table public.study_plans to service_role;
grant select, insert, update, delete on table public.efficacy_events to service_role;

drop policy if exists concept_mastery_select_own on public.concept_mastery;
drop policy if exists concept_mastery_insert_own on public.concept_mastery;
drop policy if exists concept_mastery_update_own on public.concept_mastery;
drop policy if exists concept_mastery_delete_own on public.concept_mastery;
drop policy if exists literacy_scores_select_own on public.literacy_scores;
drop policy if exists literacy_scores_insert_own on public.literacy_scores;
drop policy if exists literacy_scores_update_own on public.literacy_scores;
drop policy if exists literacy_scores_delete_own on public.literacy_scores;
drop policy if exists thesis_entries_select_own on public.thesis_entries;
drop policy if exists thesis_entries_insert_own on public.thesis_entries;
drop policy if exists thesis_entries_update_own on public.thesis_entries;
drop policy if exists thesis_entries_delete_own on public.thesis_entries;
drop policy if exists behavior_snapshots_select_own on public.behavior_snapshots;
drop policy if exists behavior_snapshots_insert_own on public.behavior_snapshots;
drop policy if exists behavior_snapshots_update_own on public.behavior_snapshots;
drop policy if exists behavior_snapshots_delete_own on public.behavior_snapshots;
drop policy if exists risk_snapshots_select_own on public.risk_snapshots;
drop policy if exists risk_snapshots_insert_own on public.risk_snapshots;
drop policy if exists risk_snapshots_update_own on public.risk_snapshots;
drop policy if exists risk_snapshots_delete_own on public.risk_snapshots;
drop policy if exists study_plans_select_own on public.study_plans;
drop policy if exists study_plans_insert_own on public.study_plans;
drop policy if exists study_plans_update_own on public.study_plans;
drop policy if exists study_plans_delete_own on public.study_plans;

create policy concept_mastery_select_own
  on public.concept_mastery for select to authenticated
  using ((select auth.uid()) = user_id);
create policy concept_mastery_insert_own
  on public.concept_mastery for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy concept_mastery_update_own
  on public.concept_mastery for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy concept_mastery_delete_own
  on public.concept_mastery for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy literacy_scores_select_own
  on public.literacy_scores for select to authenticated
  using ((select auth.uid()) = user_id);
create policy literacy_scores_insert_own
  on public.literacy_scores for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy literacy_scores_update_own
  on public.literacy_scores for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy literacy_scores_delete_own
  on public.literacy_scores for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy thesis_entries_select_own
  on public.thesis_entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy thesis_entries_insert_own
  on public.thesis_entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy thesis_entries_update_own
  on public.thesis_entries for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy thesis_entries_delete_own
  on public.thesis_entries for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy behavior_snapshots_select_own
  on public.behavior_snapshots for select to authenticated
  using ((select auth.uid()) = user_id);
create policy behavior_snapshots_insert_own
  on public.behavior_snapshots for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy behavior_snapshots_update_own
  on public.behavior_snapshots for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy behavior_snapshots_delete_own
  on public.behavior_snapshots for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy risk_snapshots_select_own
  on public.risk_snapshots for select to authenticated
  using ((select auth.uid()) = user_id);
create policy risk_snapshots_insert_own
  on public.risk_snapshots for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy risk_snapshots_update_own
  on public.risk_snapshots for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy risk_snapshots_delete_own
  on public.risk_snapshots for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy study_plans_select_own
  on public.study_plans for select to authenticated
  using ((select auth.uid()) = user_id);
create policy study_plans_insert_own
  on public.study_plans for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy study_plans_update_own
  on public.study_plans for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy study_plans_delete_own
  on public.study_plans for delete to authenticated
  using ((select auth.uid()) = user_id);

-- efficacy_events: no policies. Default deny for anon and authenticated.
-- service_role bypasses RLS and is the only writer the Edge Function uses.

drop trigger if exists concept_mastery_touch on public.concept_mastery;
create trigger concept_mastery_touch
  before insert or update on public.concept_mastery
  for each row execute function public.touch_updated_at();

drop trigger if exists literacy_scores_touch on public.literacy_scores;
create trigger literacy_scores_touch
  before insert or update on public.literacy_scores
  for each row execute function public.touch_updated_at();

drop trigger if exists thesis_entries_touch on public.thesis_entries;
create trigger thesis_entries_touch
  before insert or update on public.thesis_entries
  for each row execute function public.touch_updated_at();

drop trigger if exists behavior_snapshots_touch on public.behavior_snapshots;
create trigger behavior_snapshots_touch
  before insert or update on public.behavior_snapshots
  for each row execute function public.touch_updated_at();

drop trigger if exists risk_snapshots_touch on public.risk_snapshots;
create trigger risk_snapshots_touch
  before insert or update on public.risk_snapshots
  for each row execute function public.touch_updated_at();

drop trigger if exists study_plans_touch on public.study_plans;
create trigger study_plans_touch
  before insert or update on public.study_plans
  for each row execute function public.touch_updated_at();
