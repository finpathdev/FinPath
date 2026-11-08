import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mergeRecords, pushWinners, batchRows, syncCollections, conceptRows, appendLiteracy,
  thesisRowsFromPaper, mergeThesisIntoPaper, normalizeThesis, conceptDbRow, pickMastery,
  behaviorSnapshot, riskSnapshot, BATCH_SIZE
} from './merge.js';

const localConcept = { id: 'saving', at: 2000, score: 40, status: 'practicing', lessonsDone: 1, lessonsTotal: 4, quizCorrect: 1, quizTotal: 3 };
const remoteConcept = { id: 'saving', at: 5000, score: 80, status: 'steady', lessonsDone: 3, lessonsTotal: 4, quizCorrect: 3, quizTotal: 3 };

test('newer remote concept wins, a tie keeps local, and an empty remote does not wipe local', function(){
  const newer = mergeRecords([localConcept], [remoteConcept]);
  assert.equal(newer.length, 1);
  assert.equal(newer[0].score, 80);
  const older = mergeRecords([localConcept], [Object.assign({}, remoteConcept, { at: 1000, score: 10 })]);
  assert.equal(older[0].score, 40);
  const tie = mergeRecords([localConcept], [Object.assign({}, remoteConcept, { at: 2000, score: 1 })]);
  assert.equal(tie[0].score, 40);
  const kept = mergeRecords([localConcept, { id: 'debt', at: 3000, score: 20, status: 'just_met', lessonsDone: 0, lessonsTotal: 2, quizCorrect: 0, quizTotal: 0 }], []);
  assert.equal(kept.length, 2);
  const remoteOnly = mergeRecords([], [remoteConcept]);
  assert.equal(remoteOnly[0].id, 'saving');
});

test('push skips untouched clocks and does not upload remote-only rows', function(){
  const local = [localConcept, { id: 'taxes', at: 0, score: 0, status: 'not_started', lessonsDone: 0, lessonsTotal: 2, quizCorrect: 0, quizTotal: 0 }];
  const remote = [remoteConcept, { id: 'debt', at: 4000, score: 50, status: 'practicing', lessonsDone: 1, lessonsTotal: 2, quizCorrect: 0, quizTotal: 0 }];
  const winners = pushWinners(local, remote);
  assert.deepEqual(winners.map(function(row){ return row.id; }), []);
  const localWins = pushWinners([Object.assign({}, localConcept, { at: 9000, score: 55 })], [remoteConcept]);
  assert.equal(localWins.length, 1);
  assert.equal(localWins[0].score, 55);
  const onlyLocal = pushWinners([localConcept], []);
  assert.equal(onlyLocal.length, 1);
});

test('signed-out sync sends nothing, even if a remote payload was passed', function(){
  const plan = syncCollections({
    signedIn: false,
    userId: null,
    local: { concepts: [localConcept], literacy: [], thesis: [], behavior: [], risk: [], plans: [] },
    remote: { concepts: [remoteConcept] }
  });
  assert.equal(plan.upload, false);
  assert.equal(plan.reason, 'signed_out');
  assert.equal(plan.batches.length, 0);
  assert.equal(plan.merged.concepts[0].score, 40);
  const signedIn = syncCollections({
    signedIn: true,
    userId: 'user-1',
    local: { concepts: [Object.assign({}, localConcept, { at: 9000 })] },
    remote: { concepts: [remoteConcept] }
  });
  assert.equal(signedIn.upload, true);
  assert.equal(signedIn.batches.length, 1);
  assert.equal(signedIn.batches[0].table, 'concepts');
  assert.equal(signedIn.batches[0].rows[0].score, 40);
});

test('upserts are batched and a full local set stays conflict-safe', function(){
  const rows = [];
  for(let i = 0; i < 120; i++){
    rows.push({ id: 'c' + i, at: 1000 + i, score: 1, status: 'just_met', lessonsDone: 0, lessonsTotal: 1, quizCorrect: 0, quizTotal: 0 });
  }
  const batches = batchRows(rows, BATCH_SIZE);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].length, 50);
  assert.equal(batches[2].length, 20);
  const plan = syncCollections({ signedIn: true, userId: 'user-1', local: { concepts: rows }, remote: {} });
  assert.equal(plan.batches.length, 3);
  const row = conceptDbRow('user-1', localConcept);
  assert.equal(row.user_id, 'user-1');
  assert.equal(row.concept_id, 'saving');
  assert.equal(JSON.stringify(row).includes('email'), false);
});

test('literacy history unions by snapshot id and does not duplicate an unchanged score', function(){
  const first = appendLiteracy([], { score: 10, lessonPoints: 10, quizPoints: 0, breadthPoints: 0, lessonsDone: 1, lessonsTotal: 34, quizCorrect: 0, quizTotal: 0, conceptsTouched: 1, conceptCount: 13 }, 1000);
  const same = appendLiteracy(first, { score: 10, lessonPoints: 10, quizPoints: 0, breadthPoints: 0, lessonsDone: 1, lessonsTotal: 34, quizCorrect: 0, quizTotal: 0, conceptsTouched: 1, conceptCount: 13 }, 2000);
  assert.equal(same.length, 1);
  const next = appendLiteracy(same, { score: 20, lessonPoints: 20, quizPoints: 0, breadthPoints: 0, lessonsDone: 2, lessonsTotal: 34, quizCorrect: 0, quizTotal: 0, conceptsTouched: 2, conceptCount: 13 }, 3000);
  assert.equal(next.length, 2);
  const merged = mergeRecords(next, [{ id: 'lit:remote', at: 2500, score: 15, lessonPoints: 15, quizPoints: 0, breadthPoints: 0, lessonsDone: 1, lessonsTotal: 34, quizCorrect: 0, quizTotal: 0, conceptsTouched: 1, conceptCount: 13 }]);
  assert.equal(merged.length, 3);
  const empty = mergeRecords(next, []);
  assert.equal(empty.length, 2);
});

test('thesis merge keeps the local note on a tie and does not invent a paper position', function(){
  const paper = { cash: 100000, pos: [{ t: 'AAPL', sh: 1, price: 10, ts: 1000, thesis: 'local claim', falsifier: 'local wrong', confidence: 40 }], journal: [] };
  const rows = thesisRowsFromPaper(paper);
  assert.equal(rows[0].id, 'AAPL:1000');
  assert.equal(rows[0].thesis, 'local claim');
  const remote = [normalizeThesis({ id: 'AAPL:1000', at: 1000, ticker: 'AAPL', thesis: 'remote claim', falsifier: 'remote', confidence: 90, status: 'open' })];
  const tie = mergeThesisIntoPaper(paper, remote);
  assert.equal(tie.paper.pos[0].thesis, 'local claim');
  assert.equal(tie.paper.cash, 100000);
  const newer = mergeThesisIntoPaper(paper, [Object.assign({}, remote[0], { at: 5000, thesis: 'newer claim' })]);
  assert.equal(newer.paper.pos[0].thesis, 'newer claim');
  assert.equal(newer.paper.pos[0].sh, 1);
  const extra = mergeThesisIntoPaper(paper, [normalizeThesis({ id: 'MSFT:9', at: 9, ticker: 'MSFT', thesis: 'from the other phone', falsifier: 'rates', confidence: 10, status: 'closed' })]);
  assert.equal(extra.paper.pos.length, 1);
  assert.equal(extra.accountOnly.length, 1);
  assert.equal(extra.accountOnly[0].ticker, 'MSFT');
});

test('pattern and risk snapshots keep counts, not ticker names or free-text prompts', function(){
  const behavior = behaviorSnapshot({
    detectors: [{ id: 'overconfidence', status: 'quiet', prompt: 'secret reflection', checks: [{ id: 'calibration', state: 'quiet', sample: 5, need: 5 }] }]
  }, Date.parse('2026-11-08T00:00:00Z'));
  assert.equal(JSON.stringify(behavior).includes('secret'), false);
  assert.equal(behavior.cards[0].status, 'quiet');
  const risk = riskSnapshot('paper', {
    holdingsUsed: ['AAPL', 'MSFT'],
    metrics: { vol: { value: 0.2 }, drawdown: { value: -0.1 }, beta: { value: 1 }, sharpe: { value: 0.4 }, concentration: { largest: 0.5, hhi: 0.3 } }
  }, Date.parse('2026-11-08T00:00:00Z'));
  assert.equal(JSON.stringify(risk).includes('AAPL'), false);
  assert.equal(risk.metrics.holdings, 2);
  assert.equal(risk.source, 'paper');
});

test('account mastery overlays only a newer stored row', function(){
  const computed = { saving: { id: 'saving', label: 'Saving', score: 10, status: 'just_met', lessonsDone: 1, lessonsTotal: 4, quizCorrect: 0, quizTotal: 0 } };
  const clocks = { saving: 5000 };
  const older = pickMastery(computed, [Object.assign({}, remoteConcept, { at: 1000 })], clocks);
  assert.equal(older.mastery.saving.score, 10);
  assert.equal(older.fromAccount, 0);
  const newer = pickMastery(computed, [remoteConcept], { saving: 1000 });
  assert.equal(newer.mastery.saving.score, 80);
  assert.equal(newer.fromAccount, 1);
  const rows = conceptRows(computed, clocks);
  assert.equal(rows[0].at, 5000);
});

test('intelligence migration locks rows to the signed-in user and hides the study table', function(){
  const raw = readFileSync(new URL('../../../supabase/migrations/20261108120000_intel_sync.sql', import.meta.url), 'utf8');
  const sql = raw.replace(/--[^\n]*/g, '');
  ['concept_mastery', 'literacy_scores', 'thesis_entries', 'behavior_snapshots', 'risk_snapshots', 'study_plans', 'efficacy_events'].forEach(function(table){
    assert.match(sql, new RegExp('create table if not exists public\\.' + table));
    assert.match(sql, new RegExp('alter table public\\.' + table + ' enable row level security'));
    assert.match(sql, new RegExp('alter table public\\.' + table + ' force row level security'));
  });
  assert.match(sql, /\(select auth\.uid\(\)\) = user_id/);
  assert.match(sql, /concept_mastery_update_own/);
  assert.match(sql, /with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(sql, /concept_mastery_user_created_idx/);
  assert.match(sql, /touch_updated_at/);
  assert.match(sql, /execute function public\.touch_updated_at/);
  assert.doesNotMatch(sql, /grant\s+[^;]*efficacy_events[^;]*to\s+anon/i);
  assert.doesNotMatch(sql, /grant\s+[^;]*efficacy_events[^;]*to\s+authenticated/i);
  assert.doesNotMatch(sql, /user_metadata/);
  assert.doesNotMatch(sql, /\bemail\s+text\b/i);
  assert.match(sql, /No name, email, school, exact age, or location/);
  assert.match(raw, /no user_id/i);
  const studyTable = sql.slice(sql.indexOf('create table if not exists public.efficacy_events'), sql.indexOf('comment on table public.efficacy_events'));
  assert.doesNotMatch(studyTable, /user_id/);
});
