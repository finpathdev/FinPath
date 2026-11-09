-- Ask FinPath daily and per-minute counters.
-- Writes happen only from the ask-finpath Edge Function (service role).
-- The function applies one daily cap for every signed-in user (50/UTC day
-- as of the free-for-everyone change). Clients cannot pass a limit or a day.
-- Question text is not stored here. The gold_users table is not read here.

create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0,
  constraint ai_usage_pkey primary key (user_id, day),
  constraint ai_usage_count_nonnegative check (count >= 0)
);

create table public.ai_usage_burst (
  user_id uuid not null references auth.users (id) on delete cascade,
  minute timestamptz not null,
  count integer not null default 0,
  constraint ai_usage_burst_pkey primary key (user_id, minute),
  constraint ai_usage_burst_count_nonnegative check (count >= 0)
);

comment on table public.ai_usage is
  'Ask FinPath questions counted per user per UTC day. Not a transcript.';
comment on table public.ai_usage_burst is
  'Ask FinPath per-minute burst counter. Rows older than a couple of hours are disposable.';

alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;
alter table public.ai_usage_burst enable row level security;
alter table public.ai_usage_burst force row level security;

revoke all on table public.ai_usage from public, anon, authenticated;
revoke all on table public.ai_usage_burst from public, anon, authenticated;

grant select on table public.ai_usage to authenticated;
grant select on table public.ai_usage_burst to authenticated;

grant select, insert, update, delete on table public.ai_usage to service_role;
grant select, insert, update, delete on table public.ai_usage_burst to service_role;

create policy ai_usage_select_own
  on public.ai_usage
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy ai_usage_burst_select_own
  on public.ai_usage_burst
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- security invoker: service_role bypasses RLS and is the only role that may
-- execute these. They stay out of the authenticated API by revoking EXECUTE.
create or replace function public.consume_ask_quota(
  p_user_id uuid,
  p_daily_limit integer,
  p_burst_limit integer
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_minute timestamptz := date_trunc('minute', (now() at time zone 'utc')) at time zone 'utc';
  v_daily integer;
  v_burst integer;
begin
  if p_user_id is null
     or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 1000
     or p_burst_limit is null or p_burst_limit < 1 or p_burst_limit > 60 then
    return jsonb_build_object('allowed', false, 'reason', 'bad_request', 'remaining', 0, 'limit', coalesce(p_daily_limit, 0));
  end if;

  insert into public.ai_usage (user_id, day, count)
  values (p_user_id, v_day, 0)
  on conflict (user_id, day) do nothing;

  select count into v_daily
  from public.ai_usage
  where user_id = p_user_id and day = v_day
  for update;

  insert into public.ai_usage_burst (user_id, minute, count)
  values (p_user_id, v_minute, 0)
  on conflict (user_id, minute) do nothing;

  select count into v_burst
  from public.ai_usage_burst
  where user_id = p_user_id and minute = v_minute
  for update;

  if v_daily >= p_daily_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily',
      'remaining', 0,
      'limit', p_daily_limit,
      'count', v_daily
    );
  end if;

  if v_burst >= p_burst_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'burst',
      'remaining', greatest(p_daily_limit - v_daily, 0),
      'limit', p_daily_limit,
      'count', v_daily
    );
  end if;

  update public.ai_usage
    set count = count + 1
    where user_id = p_user_id and day = v_day
    returning count into v_daily;

  update public.ai_usage_burst
    set count = count + 1
    where user_id = p_user_id and minute = v_minute
    returning count into v_burst;

  if random() < 0.02 then
    delete from public.ai_usage_burst
    where minute < v_minute - interval '2 hours';
  end if;

  return jsonb_build_object(
    'allowed', true,
    'reason', null,
    'remaining', greatest(p_daily_limit - v_daily, 0),
    'limit', p_daily_limit,
    'count', v_daily
  );
end;
$$;

create or replace function public.release_ask_quota(
  p_user_id uuid,
  p_daily_limit integer
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_minute timestamptz := date_trunc('minute', (now() at time zone 'utc')) at time zone 'utc';
  v_daily integer;
begin
  if p_user_id is null or p_daily_limit is null or p_daily_limit < 1 then
    return jsonb_build_object('released', false, 'remaining', 0);
  end if;

  update public.ai_usage
    set count = count - 1
    where user_id = p_user_id and day = v_day and count > 0
    returning count into v_daily;

  update public.ai_usage_burst
    set count = count - 1
    where user_id = p_user_id and minute = v_minute and count > 0;

  if v_daily is null then
    select count into v_daily
    from public.ai_usage
    where user_id = p_user_id and day = v_day;
  end if;

  return jsonb_build_object(
    'released', true,
    'remaining', greatest(p_daily_limit - coalesce(v_daily, 0), 0),
    'count', coalesce(v_daily, 0)
  );
end;
$$;

revoke all on function public.consume_ask_quota(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.release_ask_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ask_quota(uuid, integer, integer) to service_role;
grant execute on function public.release_ask_quota(uuid, integer) to service_role;
