-- Per-lesson completion for signed-in learners.
-- Local fp_lessons stays the working copy on the device. This table is the
-- account copy so checkmarks restore after a re-login or on another device.
-- Anonymous use stays in localStorage only.
--
-- Apply once to project ivhhfhemcecwqadrjmwq (FinPath). Re-running is safe:
-- the table uses IF NOT EXISTS, and policies are replaced.
-- Do not put the service role key in the PWA.

create table if not exists public.lesson_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_progress_pkey primary key (user_id, lesson_id),
  constraint lesson_progress_id_shape check (
    char_length(lesson_id) between 1 and 80
    and lesson_id ~ '^[a-z0-9-]+$'
  )
);

comment on table public.lesson_progress is
  'Which catalog lessons a signed-in learner marked complete. Slug plus time only.';

create index if not exists lesson_progress_user_updated_idx
  on public.lesson_progress (user_id, updated_at desc);

alter table public.lesson_progress enable row level security;
alter table public.lesson_progress force row level security;

revoke all on table public.lesson_progress from public, anon, authenticated;
grant select, insert, update, delete on table public.lesson_progress to authenticated;
grant select, insert, update, delete on table public.lesson_progress to service_role;

drop policy if exists lesson_progress_select_own on public.lesson_progress;
drop policy if exists lesson_progress_insert_own on public.lesson_progress;
drop policy if exists lesson_progress_update_own on public.lesson_progress;
drop policy if exists lesson_progress_delete_own on public.lesson_progress;

create policy lesson_progress_select_own
  on public.lesson_progress for select to authenticated
  using ((select auth.uid()) = user_id);
create policy lesson_progress_insert_own
  on public.lesson_progress for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy lesson_progress_update_own
  on public.lesson_progress for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy lesson_progress_delete_own
  on public.lesson_progress for delete to authenticated
  using ((select auth.uid()) = user_id);

drop trigger if exists lesson_progress_touch on public.lesson_progress;
create trigger lesson_progress_touch
  before insert or update on public.lesson_progress
  for each row execute function public.touch_updated_at();
