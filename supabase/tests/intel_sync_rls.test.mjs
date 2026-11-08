// Documents and, when PGlite is installed, runs the RLS checks for
// 20261108120000_intel_sync.sql.
//
//   npm install @electric-sql/pglite
//   node --test supabase/tests/intel_sync_rls.test.mjs
//
// The static assertions always run. The live role check runs when PGlite loads.
// Manual check on project ivhhfhemcecwqadrjmwq: as user A, select returns only
// A's rows; user B cannot insert a row with A's user_id; anon has no grants;
// authenticated cannot select efficacy_events.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(root, '../migrations/20261108120000_intel_sync.sql'), 'utf8')
const stripped = sql.replace(/--[^\n]*/g, '')

test('the migration documents owner-only RLS and a closed study table', function(){
  assert.match(sql, /RLS checks/)
  assert.match(sql, /under 13/i)
  assert.match(stripped, /enable row level security/)
  assert.match(stripped, /force row level security/)
  assert.match(stripped, /\(select auth\.uid\(\)\) = user_id/)
  assert.match(stripped, /grant select, insert, update, delete on table public\.efficacy_events to service_role/)
  assert.doesNotMatch(stripped, /grant [^;]*efficacy_events[^;]* to authenticated/i)
  assert.doesNotMatch(stripped, /grant [^;]*efficacy_events[^;]* to anon/i)
  assert.doesNotMatch(stripped, /user_metadata/)
})

test('authenticated users see only their intelligence rows and cannot read the study', async function(){
  let PGlite
  try{
    PGlite = (await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')).PGlite
  }catch{
    console.log('PGlite is not installed; static RLS checks above still ran.')
    return
  }
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const db = new PGlite()
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
      language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
  `)
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}')`)
  await db.exec(sql)
  await db.exec(`
    insert into public.concept_mastery (user_id, concept_id, score, status, lessons_done, lessons_total, quiz_correct, quiz_total, updated_at)
    values ('${A}', 'saving', 40, 'practicing', 1, 4, 1, 3, '2026-11-01T00:00:00Z'),
           ('${B}', 'debt', 10, 'just_met', 0, 2, 0, 0, '2026-11-02T00:00:00Z');
    insert into public.efficacy_events (study_id, event_id, token_hash, kind, score, lesson_points, quiz_points, breadth_points)
    values ('${A}', 'literacy_pre', repeat('ab', 32), 'literacy_pre', 20, 10, 0, 0);
  `)
  await db.exec(`select set_config('request.jwt.claim.sub', '${A}', false)`)
  await db.exec('set role authenticated')
  const own = await db.query('select concept_id from public.concept_mastery order by concept_id')
  assert.deepEqual(own.rows.map((row) => row.concept_id), ['saving'])
  let crossed = false
  try{
    await db.query(`insert into public.concept_mastery (user_id, concept_id, score, status) values ('${B}', 'taxes', 1, 'just_met')`)
  }catch{
    crossed = true
  }
  assert.equal(crossed, true)
  let studyRows = null
  let studyReadDenied = false
  try{
    const study = await db.query('select count(*)::int as n from public.efficacy_events')
    studyRows = study.rows[0].n
  }catch(err){
    studyReadDenied = /permission denied/i.test(String(err && err.message || err))
  }
  assert.equal(studyReadDenied || studyRows === 0, true)
  let studyInsert = false
  try{
    await db.query(`insert into public.efficacy_events (study_id, event_id, token_hash, kind, score, lesson_points, quiz_points, breadth_points) values ('${B}', 'literacy_pre', repeat('cd', 32), 'literacy_pre', 1, 0, 0, 0)`)
  }catch{
    studyInsert = true
  }
  assert.equal(studyInsert, true)
  await db.exec('reset role')
  await db.close()
})
