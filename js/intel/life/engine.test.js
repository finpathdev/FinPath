import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fvMonthly, monthlyPayment, compoundGrowth, creditScoreEstimate, deflate,
  simulate, defaultInputs
} from './engine.js';
import { applyPreset } from './presets.js';
import { comparePaths } from './compare.js';
import { lessonProgressMap, lessonStoreFromProgress } from '../learn/progress.js';
import { appendAttempt, makeAttempt, emptyQuizLog } from '../learn/quizlog.js';
import { mergeJournal, upsertEntry } from './journal.js';

const assumptions = JSON.parse(readFileSync(new URL('../../../data/life-assumptions.v1.json', import.meta.url), 'utf8'));

test('monthly future value matches the ordinary-annuity formula', function(){
  const r = 0.12 / 12;
  const n = 12;
  const hand = 100 * ((Math.pow(1 + r, n) - 1) / r);
  assert.ok(Math.abs(fvMonthly(100, 12, 1) - hand) < 1e-6);
  assert.equal(fvMonthly(100, 0, 1), 1200);
  assert.equal(fvMonthly(0, 8, 30), 0);
});

test('loan payment matches the standard amortization formula', function(){
  const principal = 80000;
  const apr = 6.5;
  const years = 30;
  const r = apr / 100 / 12;
  const n = 360;
  const hand = principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  assert.ok(Math.abs(monthlyPayment(principal, apr, years) - hand) < 1e-6);
});

test('a 10-year loan pays off', function(){
  let bal = 10000;
  const pay = monthlyPayment(10000, 6, 10);
  const r = 0.06 / 12;
  for(let i = 0; i < 120; i++){
    const interest = bal * r;
    bal = bal + interest - pay;
  }
  assert.ok(Math.abs(bal) < 1);
});

test('compound growth and inflation deflator', function(){
  assert.ok(Math.abs(compoundGrowth(10000, 10, 30) - 10000 * Math.pow(1.1, 30)) < 1e-4);
  assert.ok(Math.abs(deflate(1000, 0.03, 10) - 1000 / Math.pow(1.03, 10)) < 1e-6);
});

test('credit score helper matches the lesson formula', function(){
  const months = 12, util = 25, age = 2;
  let score = 480 + Math.min(months, 48) * 3.2 + Math.max(0, 30 - util) * 2.6 - Math.max(0, util - 30) * 1.8 + Math.min(age, 10) * 8;
  score = Math.max(300, Math.min(850, Math.round(score)));
  const got = creditScoreEstimate(months, util, age);
  assert.equal(got.score, score);
  assert.equal(got.band, 'Building');
});

test('$50 a month from 16 to 65 matches fvMonthly for a no-college path', function(){
  const inputs = defaultInputs(assumptions);
  inputs.college = 'none';
  inputs.monthlyInvest = 50;
  inputs.investStartAge = 16;
  inputs.currentAge = 16;
  const result = simulate(inputs, assumptions);
  const at65 = result.snapshots[65];
  const classic = fvMonthly(50, assumptions.values.stock_nominal.value * 100, 49);
  assert.ok(at65, 'age 65 snapshot');
  assert.ok(Math.abs(at65.portfolio - classic) < 5, at65.portfolio + ' vs ' + classic);
  assert.ok(at65.netWorth > at65.contrib);
});

test('waiting until 25 invests less by 65 than starting at 16', function(){
  const base = defaultInputs(assumptions);
  base.college = 'none';
  base.currentAge = 16;
  const early = simulate(applyPreset(base, 'invest50at16', assumptions), assumptions);
  const late = simulate(applyPreset(base, 'wait25', assumptions), assumptions);
  assert.ok(early.snapshots[65].portfolio > late.snapshots[65].portfolio);
  assert.equal(late.rows.find(function(r){ return r.age === 25; }).contrib, 0);
});

test('scholarship reduces debt at 22 and a card adds interest', function(){
  const base = defaultInputs(assumptions);
  base.currentAge = 18;
  base.college = 'instate';
  base.monthlyInvest = 0;
  const full = simulate(base, assumptions);
  const aided = simulate(Object.assign({}, base, { scholarship: 15000 }), assumptions);
  assert.ok(full.snapshots[22].debt > aided.snapshots[22].debt);
  assert.ok(full.snapshots[22].debt > 0);
  const withCard = simulate(applyPreset(base, 'card', assumptions), assumptions);
  assert.ok(withCard.totals.cardInterest > full.totals.cardInterest);
  const cmp = comparePaths(withCard, full, 'today');
  assert.ok(cmp.opportunity.gap > 0);
});

test('a large car payment crowds out investing once the habit no longer fits', function(){
  const base = defaultInputs(assumptions);
  base.college = 'none';
  base.currentAge = 22;
  base.monthlyInvest = 2000;
  const plain = simulate(base, assumptions);
  const car = simulate(applyPreset(base, 'car', assumptions), assumptions);
  assert.ok(car.totals.carPaid > 10000);
  assert.ok(car.totals.carInterest > 1000);
  assert.ok(car.totals.invested < plain.totals.invested);
  const cmp = comparePaths(car, plain, 'today');
  assert.ok(cmp.opportunity.gap > 0);
});

test('raise preset invests more than the baseline', function(){
  const base = defaultInputs(assumptions);
  base.college = 'none';
  base.currentAge = 22;
  base.monthlyInvest = 100;
  const plain = simulate(base, assumptions);
  const raised = simulate(applyPreset(base, 'raise', assumptions), assumptions);
  assert.ok(raised.totals.invested > plain.totals.invested);
  assert.ok(raised.totals.income > plain.totals.income);
});

test('every assumption value cites a source', function(){
  Object.keys(assumptions.values).forEach(function(key){
    const item = assumptions.values[key];
    const src = assumptions.sources[item.source];
    assert.ok(src && src.url && src.asOf && src.name, key);
    assert.ok(isFinite(Number(item.value)), key);
  });
  assert.equal(Object.keys(assumptions.states).length, 52);
  assert.equal(assumptions.states.CA.rpp, 112.6);
});

test('lesson index keys migrate to slugs and keep the later timestamp', function(){
  const ids = [null, 'assets-liabilities', 'budget-50-30-20'];
  const raw = { '1': 100, '2': 50, 'assets-liabilities': 80, _v: 1 };
  const got = lessonProgressMap(raw, ids);
  assert.equal(got.rewrite, true);
  assert.equal(got.progress['assets-liabilities'], 100);
  assert.equal(got.progress['budget-50-30-20'], 50);
  const stored = lessonStoreFromProgress(got.progress);
  assert.equal(stored._v, 1);
  const again = lessonProgressMap(stored, ids);
  assert.equal(again.rewrite, false);
});

test('quiz log appends and keeps concept ids', function(){
  const attempt = makeAttempt({
    id: 'a1',
    quizKey: 'compound-interest',
    lessonName: 'The Power of Compound Interest',
    startedAt: 1,
    finishedAt: 2,
    correct: 2,
    total: 3,
    responses: [{ qid: 'compound-interest#0', conceptIds: ['saving'], chosen: 1, correct: true }]
  });
  const log = appendAttempt(emptyQuizLog(), attempt);
  assert.equal(log.attempts.length, 1);
  assert.equal(log.attempts[0].responses[0].conceptIds[0], 'saving');
  assert.equal(log.v, 1);
});

test('journal merges trades, goals, and lessons without dropping a sim note', function(){
  const entries = upsertEntry([], {
    id: 'sim:card',
    kind: 'simulation',
    title: 'Ran the credit-card what-if',
    why: 'I wanted to see the interest',
    conceptIds: ['debt'],
    at: 500
  });
  const merged = mergeJournal({
    entries: entries,
    paper: { journal: [{ id: 'j1', t: 'AAPL', thesis: 'because', reflection: 'learned', pnl: -12.5, soldAt: 800 }], pos: [] },
    goals: [{ name: 'Emergency fund', saved: 250, target: 1000, date: '2027-01-01' }],
    lessons: { _v: 1, 'compound-interest': 100 },
    lessonNames: { 'compound-interest': 'The Power of Compound Interest' },
    quizzes: emptyQuizLog()
  });
  const kinds = merged.map(function(e){ return e.kind; });
  assert.ok(kinds.indexOf('simulation') >= 0);
  assert.ok(kinds.indexOf('trade') >= 0);
  assert.ok(kinds.indexOf('goal') >= 0);
  assert.ok(kinds.indexOf('learning') >= 0);
  assert.ok(merged.some(function(e){ return e.id === 'sim:card' && e.why.indexOf('interest') >= 0; }));
});
