// Runs the ai_usage migration against embedded Postgres.
//   npm install @electric-sql/pglite
//   node supabase/tests/ai_usage.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')

const root = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(root, '../migrations/20261101120000_ai_usage.sql'), 'utf8')
const FREE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const GOLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

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
await db.exec(`insert into auth.users (id) values ('${FREE}'), ('${GOLD}')`)
await db.exec(sql)

async function consume(user, daily, burst) {
  const res = await db.query(
    'select public.consume_ask_quota($1::uuid, $2::int, $3::int) as q',
    [user, daily, burst],
  )
  return res.rows[0].q
}

let last = null
for (let i = 1; i <= 5; i++) {
  last = await consume(FREE, 5, 60)
  assert.equal(last.allowed, true, 'free ask ' + i)
  assert.equal(last.remaining, 5 - i)
}
const sixth = await consume(FREE, 5, 60)
assert.equal(sixth.allowed, false)
assert.equal(sixth.reason, 'daily')
assert.equal(sixth.remaining, 0)
const count = await db.query('select count from public.ai_usage where user_id = $1', [FREE])
assert.equal(count.rows[0].count, 5)

const gold = []
for (let i = 0; i < 3; i++) gold.push(await consume(GOLD, 50, 2))
assert.equal(gold[0].allowed, true)
assert.equal(gold[1].allowed, true)
assert.equal(gold[2].allowed, false)
assert.equal(gold[2].reason, 'burst')
assert.equal(gold[2].remaining, 48)
const goldCount = await db.query('select count from public.ai_usage where user_id = $1', [GOLD])
assert.equal(goldCount.rows[0].count, 2)

const released = await db.query('select public.release_ask_quota($1::uuid, $2::int) as q', [GOLD, 50])
assert.equal(released.rows[0].q.released, true)
assert.equal(released.rows[0].q.remaining, 49)
const after = await consume(GOLD, 50, 2)
assert.equal(after.allowed, true)

await db.exec(`
  insert into public.ai_usage (user_id, day, count)
  values ('${GOLD}', (now() at time zone 'utc')::date, 7)
  on conflict (user_id, day) do update set count = excluded.count
`)
await db.exec("select set_config('request.jwt.claim.sub', '" + FREE + "', false)")
await db.exec('set role authenticated')
const own = await db.query('select user_id, count from public.ai_usage')
assert.equal(own.rows.length, 1)
assert.equal(own.rows[0].user_id, FREE)
let denied = false
try {
  await db.query('insert into public.ai_usage (user_id, day, count) values ($1::uuid, current_date, 1)', [FREE])
} catch {
  denied = true
}
assert.equal(denied, true)
let noExecute = false
try {
  await db.query('select public.consume_ask_quota($1::uuid, 5, 5)', [FREE])
} catch (err) {
  noExecute = /permission denied/i.test(String(err && err.message || err))
}
assert.equal(noExecute, true)
await db.exec('reset role')

console.log('ai_usage migration: free cap 5, burst cap, refund, RLS select-own, no client writes')
await db.close()
