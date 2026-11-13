import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(root, '../migrations/20261112200000_lesson_progress.sql'), 'utf8')
const stripped = sql.replace(/--[^\n]*/g, '')

test('lesson_progress is owner-only and closed to anonymous visitors', function(){
  assert.match(stripped, /enable row level security/)
  assert.match(stripped, /force row level security/)
  assert.match(stripped, /\(select auth\.uid\(\)\) = user_id/)
  assert.match(stripped, /grant select, insert, update, delete on table public\.lesson_progress to authenticated/)
  assert.doesNotMatch(stripped, /grant [^;]*lesson_progress[^;]* to anon/i)
  assert.doesNotMatch(stripped, /user_metadata/)
  assert.match(stripped, /lesson_id ~ '\^\[a-z0-9-\]\+\$'/)
})
