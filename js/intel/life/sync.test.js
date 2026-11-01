import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  choosePath, mergeJournalEntries, journalRow, entryFromRow, timeMs
} from './sync.js';

const inputs = { currentAge: 16, monthlyInvest: 50, college: 'none' };

test('an untouched local default does not overwrite a cloud path', function(){
  const choice = choosePath(
    { inputs: { currentAge: 16 }, dollars: 'today', comparePreset: 'wait25', updatedAt: 0, touched: false },
    { inputs: inputs, dollars: 'future', comparePreset: 'card', updatedAt: 5000, touched: true }
  );
  assert.equal(choice.source, 'remote');
  assert.equal(choice.push, false);
  assert.equal(choice.record.dollars, 'future');
  assert.equal(choice.record.inputs.monthlyInvest, 50);
});

test('a newer local path wins and an empty cloud does not wipe it', function(){
  const local = { inputs: inputs, dollars: 'today', comparePreset: 'wait25', updatedAt: 9000, touched: true };
  const newer = choosePath(local, { inputs: { currentAge: 18 }, dollars: 'today', comparePreset: 'car', updatedAt: 1000, touched: true });
  assert.equal(newer.source, 'local');
  assert.equal(newer.push, true);
  assert.equal(newer.record.inputs.currentAge, 16);
  const empty = choosePath(local, null);
  assert.equal(empty.source, 'local');
  assert.equal(empty.push, true);
  const missing = choosePath(
    { inputs: { currentAge: 16 }, dollars: 'today', comparePreset: 'wait25', updatedAt: 0, touched: false },
    null
  );
  assert.equal(missing.source, 'none');
  assert.equal(missing.push, false);
});

test('journal merge keeps local notes when remote is empty and unions by id', function(){
  const local = [{ id: 'sim:card', kind: 'simulation', title: 'Card', why: 'local why', conceptIds: ['debt'], at: 100, ref: 'card' }];
  const kept = mergeJournalEntries(local, []);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].why, 'local why');
  const remoteOnly = mergeJournalEntries([], [{ entry_id: 'note:abc', kind: 'reflection', title: 'Note', why: 'from the other phone', concept_ids: [], at: 50, ref: '' }]);
  assert.equal(remoteOnly.length, 1);
  assert.equal(remoteOnly[0].id, 'note:abc');
  const both = mergeJournalEntries(
    local.concat([{ id: 'note:1', kind: 'reflection', title: 'Old', why: 'first', conceptIds: [], at: 10, ref: '' }]),
    [{ id: 'note:1', kind: 'reflection', title: 'New', why: 'second', conceptIds: [], at: 20, ref: '' }, { id: 'note:2', kind: 'reflection', title: 'Other', why: 'cloud', conceptIds: [], at: 15, ref: '' }]
  );
  const byId = {};
  both.forEach(function(e){ byId[e.id] = e; });
  assert.equal(byId['sim:card'].why, 'local why');
  assert.equal(byId['note:1'].why, 'second');
  assert.equal(byId['note:2'].why, 'cloud');
  const tie = mergeJournalEntries(
    [{ id: 'note:1', kind: 'reflection', title: 'Local', why: 'stay', conceptIds: [], at: 20, ref: '' }],
    [{ id: 'note:1', kind: 'reflection', title: 'Remote', why: 'lose the tie', conceptIds: [], at: 20, ref: '' }]
  );
  assert.equal(tie[0].why, 'stay');
});

test('journal rows round-trip and drop a blank id', function(){
  const row = journalRow('user-1', { id: 'sim:card', kind: 'nope', title: 'T', why: 'W', conceptIds: ['debt'], at: 40, ref: 'card' });
  assert.equal(row.user_id, 'user-1');
  assert.equal(row.kind, 'reflection');
  assert.equal(row.entry_id, 'sim:card');
  const back = entryFromRow(row);
  assert.equal(back.id, 'sim:card');
  assert.equal(back.conceptIds[0], 'debt');
  assert.equal(journalRow('user-1', { id: '', title: 'x' }), null);
  assert.ok(timeMs('2026-11-01T00:00:00.000Z') > 0);
});

test('life sync migration locks rows to the signed-in user', function(){
  const raw = readFileSync(new URL('../../../supabase/migrations/20261101180000_life_sync.sql', import.meta.url), 'utf8');
  const sql = raw.replace(/--[^\n]*/g, '');
  assert.match(sql, /create table if not exists public\.life_paths/);
  assert.match(sql, /create table if not exists public\.life_journal/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /\(select auth\.uid\(\)\) = user_id/);
  assert.match(sql, /life_paths_update_own/);
  assert.match(sql, /with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.doesNotMatch(sql, /grant\s+[^;]*\s+to\s+anon/i);
  assert.doesNotMatch(sql, /to\s+anon,\s*authenticated/i);
  assert.doesNotMatch(sql, /user_metadata/);
});
