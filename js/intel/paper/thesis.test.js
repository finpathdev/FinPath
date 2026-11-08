import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FORMULAS, LAB_NOTE, CALIBRATION_BUCKETS, TIMEFRAMES,
  readPlan, scoreAccuracy, explainAccuracy, scoreResearch, explainResearch,
  scoreDecision, explainDecision, scoreRisk, explainRisk,
  directionHit, calibrate, gradeClosed, heldDays, accountStakePct,
  closedTradeFromPosition, actualMovePct, sameClaim, formatMove
} from './thesis.js';

const LONG = 'Earnings grow because the new product is already shipping.';
const FALSIFIER = 'Two straight quarters of falling revenue would prove this wrong.';

function plan(over){
  return Object.assign({
    thesis: LONG,
    falsifier: FALSIFIER,
    expectedMove: 10,
    timeframeDays: 30,
    confidence: 60,
    maxStakePct: 25
  }, over || {});
}

test('a matching move scores accuracy 100', function(){
  const result = scoreAccuracy(10, 10);
  assert.equal(result.score, 100);
  assert.equal(explainAccuracy(result), 'round(100 × (1 − min(1, 0 ÷ 20))) = 100');
});

test('halfway between expected and flat scores accuracy 75', function(){
  const result = scoreAccuracy(10, 5);
  assert.equal(result.error, 5);
  assert.equal(result.band, 10);
  assert.equal(result.score, 75);
  assert.equal(explainAccuracy(result), 'round(100 × (1 − min(1, 5 ÷ 20))) = 75');
});

test('an equal opposite move scores accuracy 0', function(){
  assert.equal(scoreAccuracy(10, -10).score, 0);
});

test('a flat forecast uses the 5-point band', function(){
  assert.equal(scoreAccuracy(0, 0).score, 100);
  assert.equal(scoreAccuracy(0, 5).score, 50);
  assert.equal(scoreAccuracy(0, 10).score, 0);
});

test('accuracy rejects a missing price move', function(){
  assert.equal(scoreAccuracy(10, NaN), null);
  assert.equal(actualMovePct(0, 10), null);
  assert.equal(actualMovePct(100, 110), 10);
});

test('research quality is 100 when the falsifier is a different sentence', function(){
  const result = scoreResearch(plan());
  assert.equal(result.score, 100);
  assert.equal(explainResearch(result), 'claim 40 + falsifier 40 + forecast 20 = 100');
});

test('copying the thesis into the falsifier drops the falsifier points', function(){
  const result = scoreResearch(plan({ falsifier: '  earnings   GROW because the new product is already shipping. ' }));
  assert.equal(sameClaim(LONG, result && plan({ falsifier: LONG }).falsifier), true);
  assert.equal(result.falsifier, 0);
  assert.equal(result.score, 60);
});

test('a short thesis keeps the falsifier and forecast points', function(){
  const result = scoreResearch(plan({ thesis: 'I like it' }));
  assert.equal(result.claim, 0);
  assert.equal(result.falsifier, 40);
  assert.equal(result.forecast, 20);
  assert.equal(result.score, 60);
});

test('a missing timeframe drops the forecast points', function(){
  assert.equal(scoreResearch(plan({ timeframeDays: 14 })).forecast, 0);
  assert.equal(scoreResearch(plan({ timeframeDays: 14 })).score, 80);
});

test('decision quality ignores profit', function(){
  const onTime = scoreDecision(30, 30, false);
  assert.equal(onTime.score, 100);
  assert.equal(explainDecision(30, 30, false, onTime), 'round(100 × (½ × 1 (held 30 of 30 days) + ½ × 1)) = 100');

  const unchecked = scoreDecision(30, 30, null);
  assert.equal(unchecked.score, 50);
  assert.equal(unchecked.checked, 0);

  const earlyStop = scoreDecision(30, 10, true);
  assert.equal(earlyStop.score, 100);
  assert.match(explainDecision(30, 10, true, earlyStop), /falsifier happened/);
});

test('closing early without the falsifier scales the on-time half', function(){
  const result = scoreDecision(30, 10, false);
  assert.equal(result.score, 83);
  assert.equal(explainDecision(30, 10, false, result), 'round(100 × (½ × (10 ÷ 30) ÷ 0.5 + ½ × 1)) = 83');
});

test('holding far past the timeframe scales the on-time half down', function(){
  const result = scoreDecision(30, 90, false);
  assert.equal(result.score, 71);
  assert.match(explainDecision(30, 90, false, result), /min\(1, 1\.25/);
});

test('skipping the falsifier check on time is 50', function(){
  assert.equal(scoreDecision(7, 7, null).score, 50);
  assert.equal(scoreDecision(7, -1, false), null);
});

test('risk discipline is the cap you wrote, not the profit', function(){
  const inside = scoreRisk(10, 25);
  assert.equal(inside.score, 100);
  assert.equal(explainRisk(inside), 'stake 10% is inside cap 25% = 100');
  const over = scoreRisk(40, 10);
  assert.equal(over.score, 25);
  assert.equal(explainRisk(over), 'round(100 × 10 ÷ 40) = 25');
  assert.equal(scoreRisk(30, 25).score, 83);
  assert.equal(scoreRisk(10, 0), null);
});

test('stake is position cost divided by the paper account at cost', function(){
  const positions = [{ t: 'AAPL', price: 100, sh: 100 }, { t: 'KO', price: 50, sh: 100 }];
  assert.equal(accountStakePct(85000, positions, 'AAPL'), 10);
  assert.equal(accountStakePct(-1, positions, 'AAPL'), null);
});

test('a losing practice close can still score 100 on decision and risk', function(){
  const bought = Date.UTC(2026, 0, 1);
  const sold = bought + 30 * 86400000;
  const entry = closedTradeFromPosition({
    t: 'AAPL', sh: 10, price: 100, ts: bought,
    thesis: LONG, falsifier: FALSIFIER,
    expectedMove: -8, timeframeDays: 30, confidence: 55, maxStakePct: 20, stakePct: 10
  }, { sellPrice: 92, soldAt: sold, falsifierHappened: false });
  const grade = gradeClosed(entry);
  assert.equal(grade.hit, true);
  assert.ok(grade.actualPct < 0);
  assert.equal(grade.decision.score, 100);
  assert.equal(grade.risk.score, 100);
  assert.equal(grade.accuracy.score > 0, true);
  assert.equal(heldDays(bought, sold), 30);
});

test('direction hit treats a flat forecast as within 1 point', function(){
  assert.equal(directionHit(10, 4), true);
  assert.equal(directionHit(10, -1), false);
  assert.equal(directionHit(0, 1), true);
  assert.equal(directionHit(0, 1.1), false);
  assert.equal(directionHit(5, 0), false);
  assert.equal(directionHit(5, NaN), null);
});

test('readPlan requires a falsifier and rejects a blank move that would look like zero', function(){
  const missing = readPlan({ thesis: LONG, falsifier: '   ', expectedMove: 8, timeframeDays: 30, confidence: 50, maxStakePct: 10 });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /falsifier/i);

  const blankMove = readPlan(plan({ expectedMove: '' }));
  assert.equal(blankMove.ok, false);
  assert.match(blankMove.error, /expected move/i);

  const zero = readPlan(plan({ expectedMove: '0', confidence: '0' }));
  assert.equal(zero.ok, true);
  assert.equal(zero.plan.expectedMove, 0);
  assert.equal(zero.plan.confidence, 0);
  assert.equal(formatMove(0), '0%');
  assert.equal(formatMove(8), '+8%');
});

test('readPlan rejects confidence above 100 and a zero cap', function(){
  assert.equal(readPlan(plan({ confidence: 101 })).ok, false);
  assert.equal(readPlan(plan({ maxStakePct: 0 })).ok, false);
  assert.equal(readPlan(plan({ timeframeDays: '14' })).ok, false);
  const ok = readPlan(plan({ expectedMove: '8.2', confidence: '99.6', maxStakePct: '10' }));
  assert.equal(ok.ok, true);
  assert.equal(ok.plan.expectedMove, 8.2);
  assert.equal(ok.plan.confidence, 100);
  assert.equal(ok.plan.timeframeDays, 30);
  assert.equal(TIMEFRAMES.length, 4);
});

test('calibration compares confidence buckets with the hit rate', function(){
  const report = calibrate([
    { confidence: 55, hit: true },
    { confidence: 58, hit: false },
    { confidence: 55, hit: true },
    { confidence: 92, expectedMove: 10, buyPrice: 50, sellPrice: 60 },
    { confidence: 49, expectedMove: 5, buyPrice: 20, sellPrice: 10 },
    { confidence: 49.6, hit: false },
    { thesis: 'legacy note', pnl: 5 },
    { confidence: null, expectedMove: 10, buyPrice: 10, sellPrice: 12 },
    null
  ]);
  const byId = {};
  report.buckets.forEach(function(b){ byId[b.id] = b; });
  assert.equal(CALIBRATION_BUCKETS.length, 6);
  assert.equal(byId['50-59'].n, 4);
  assert.equal(byId['50-59'].hits, 2);
  assert.equal(byId['50-59'].hitRate, 0.5);
  assert.equal(byId['90-100'].n, 1);
  assert.equal(byId['90-100'].hits, 1);
  assert.equal(byId['90-100'].hitRate, 1);
  assert.equal(byId['0-49'].n, 1);
  assert.equal(byId['0-49'].hits, 0);
  assert.equal(byId['80-89'].n, 0);
  assert.equal(byId['80-89'].hitRate, null);
  assert.equal(report.skipped, 3);
});

test('an old journal row without a falsifier is not graded', function(){
  assert.equal(gradeClosed({ thesis: 'because', buyPrice: 10, sellPrice: 12, confidence: 80 }), null);
});

test('formulas stay educational and cover the four scores', function(){
  assert.equal(FORMULAS.map(function(f){ return f.id; }).join(','), 'accuracy,research,decision,risk');
  const blob = FORMULAS.map(function(f){ return f.title + ' ' + f.text; }).join('\n') + '\n' + LAB_NOTE;
  assert.match(blob, /accuracy = round\(100/);
  assert.match(blob, /claim \+ falsifier \+ forecast/);
  assert.match(blob, /½ × on-time \+ ½ × checked/);
  assert.match(blob, /cap% ÷ stake%/);
  assert.match(blob, /not a reason to buy or sell/i);
  assert.match(blob, /Profit is not in this formula/);
  assert.doesNotMatch(blob, /you should (buy|sell)|i recommend|buy signal|sell signal/i);
});

test('service worker cache is finpath-v35 and the page keeps the yellow disclaimer', function(){
  const sw = readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /finpath-v35/);
  assert.doesNotMatch(sw, /finpath-v34/);
  assert.match(sw, /js\/intel\/paper\/thesis\.js/);
  assert.match(sw, /js\/intel\/paper\/boot\.js/);
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  assert.match(html, /js\/intel\/paper\/boot\.js/);
  assert.match(html, /class="practice-note"/);
  assert.match(html, /Practice mode\./);
  assert.match(html, /virtual money/);
  assert.match(html, /id="paperFalsifier"/);
  assert.match(html, /id="thesisCalibration"/);
  assert.match(html, /id="thesisFormulas"/);
  const paper = html.slice(html.indexOf('id="paperWrap"'), html.indexOf('id="paycheckEntryPort"'));
  assert.match(paper, /not a reason to buy or sell/i);
  assert.doesNotMatch(paper, /you should (buy|sell)|i recommend|buy signal|sell signal/i);
});
