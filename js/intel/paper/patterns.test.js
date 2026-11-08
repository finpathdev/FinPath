import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LESSON_CONCEPTS } from '../learn/concepts.js';
import {
  PATTERNS_INTRO, OVERCONFIDENCE_RULES, DISPOSITION_RULES, PANIC_RULES,
  overconfidenceCriteria, dispositionCriteria, panicCriteria,
  bookOf, scoredClose, tradeHeldDays, tradeOutcome, tradeMovePct, falsifierMark, sizeOf,
  inRecentWindow, median,
  detectOverconfidence, detectDisposition, detectPanic, detectPatterns
} from './patterns.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 8);
const BANNED = /you should (buy|sell)|i recommend|buy signal|sell signal|you failed|you(?:'re| are) (?:overconfident|bad|reckless)|you panicked|panic-sold|shame on|stupid/i;

function trade(over){
  return Object.assign({
    t: 'EX',
    confidence: 60,
    expectedMove: 10,
    buyPrice: 100,
    sellPrice: 110,
    boughtAt: NOW - 20 * DAY,
    soldAt: NOW - 40 * DAY,
    timeframeDays: 90,
    pnl: 100,
    falsifierHappened: false
  }, over || {});
}

function check(report, id){
  const row = report.checks.find(function(c){ return c.id === id; });
  assert.ok(row, id);
  return row;
}

function days(n){
  return { boughtAt: 0, soldAt: n * DAY };
}

function collect(value, out){
  if(typeof value === 'string') out.push(value);
  else if(Array.isArray(value)) value.forEach(function(v){ collect(v, out); });
  else if(value && typeof value === 'object') Object.keys(value).forEach(function(k){ collect(value[k], out); });
}

test('empty and garbage books do not throw and stay short of every minimum', function(){
  [null, undefined, 'nope', 4, { journal: null, pos: 'x' }, [null, 1, 'a', [], { confidence: 'nope' }]].forEach(function(input){
    const report = detectPatterns(input, NOW);
    assert.equal(report.detectors.length, 3);
    report.detectors.forEach(function(card){
      assert.equal(card.status, 'insufficient');
      assert.equal(card.statusLabel, 'Not enough data yet');
      assert.match(card.headline, /Not enough data yet/);
      assert.ok(card.lesson && card.lesson.slug);
      assert.ok(card.prompt);
      card.checks.forEach(function(row){
        assert.equal(row.ready, false);
        assert.equal(row.fired, false);
        assert.equal(row.state, 'short');
      });
    });
  });
  assert.deepEqual(bookOf([trade()]).pos, []);
  assert.equal(bookOf([trade()]).journal.length, 1);
});

test('overconfidence stays quiet just under the confidence gap and notices at the line', function(){
  function book(conf){
    const journal = [true, true, false, false].map(function(hit){
      return trade({ confidence: conf, hit: hit, stakePct: 8, maxStakePct: 10 });
    });
    journal.push(trade({ confidence: 40, hit: true, stakePct: 8, maxStakePct: 10 }));
    return { journal: journal };
  }
  const under = detectOverconfidence(book(74), NOW);
  const gap = check(under, 'calibration');
  assert.equal(gap.ready, true);
  assert.equal(gap.fired, false);
  assert.equal(gap.state, 'quiet');
  assert.equal(gap.stats.scored, 5);
  assert.equal(gap.stats.high, 4);
  assert.equal(gap.stats.hits, 2);
  assert.equal(gap.stats.gap, 24);
  assert.equal(under.status, 'quiet');
  assert.equal(under.statusLabel, 'Nothing stands out yet');
  assert.match(gap.line, /gap 24/);
  assert.match(gap.line, /25 or more/);

  const on = detectOverconfidence(book(75), NOW);
  const hit = check(on, 'calibration');
  assert.equal(hit.stats.gap, 25);
  assert.equal(hit.fired, true);
  assert.equal(hit.state, 'noticed');
  assert.equal(on.status, 'noticed');
  assert.equal(on.statusLabel, 'A pattern showed up');
  assert.match(on.headline, /High confidence ran ahead/);
  assert.equal(check(on, 'size').fired, false);
  assert.equal(check(on, 'pace').ready, false);
});

test('confidence rounds like the calibration chart and a tiny high-confidence set stays short', function(){
  const rounded = detectOverconfidence({
    journal: [69.6, 69.6, 69.6, 69.6, 69.6].map(function(confidence){
      return trade({ confidence: confidence, hit: false });
    })
  }, NOW);
  const high = check(rounded, 'calibration');
  assert.equal(high.stats.high, 5);
  assert.equal(high.stats.mean, 70);
  assert.equal(high.fired, true);

  const low = detectOverconfidence({
    journal: [69, 69, 69, 69, 69].map(function(confidence){
      return trade({ confidence: confidence, hit: false });
    })
  }, NOW);
  assert.equal(check(low, 'calibration').stats.high, 0);
  assert.equal(check(low, 'calibration').ready, false);
  assert.equal(low.status, 'insufficient');

  const short = detectOverconfidence({
    journal: [1, 2, 3, 4].map(function(){ return trade({ confidence: 90, hit: false }); })
  }, NOW);
  assert.equal(check(short, 'calibration').stats.scored, 4);
  assert.equal(check(short, 'calibration').stats.high, 4);
  assert.equal(check(short, 'calibration').ready, false);
  assert.equal(short.status, 'insufficient');
});

test('a stored hit wins over the prices, and missing prices are left out', function(){
  const overridden = scoredClose({ confidence: 80, hit: true, expectedMove: 10, buyPrice: 100, sellPrice: 50 });
  assert.equal(overridden.hit, true);
  assert.equal(scoredClose({ confidence: '80', expectedMove: 10, buyPrice: 100, sellPrice: 90 }).hit, false);
  assert.equal(scoredClose({ confidence: 80, expectedMove: 10, buyPrice: 100, sellPrice: 110 }).hit, true);
  assert.equal(scoredClose({ confidence: 101, hit: false }), null);
  assert.equal(scoredClose({ confidence: -1, hit: true }), null);
  assert.equal(scoredClose({ confidence: '  ', hit: true }), null);
  assert.equal(scoredClose({ hit: false, expectedMove: 10, buyPrice: 100, sellPrice: 90 }), null);
  const missed = detectOverconfidence({
    journal: [1, 2, 3, 4, 5].map(function(){ return { confidence: 80, expectedMove: 10 }; })
  }, NOW);
  assert.equal(check(missed, 'calibration').stats.scored, 0);
  assert.equal(scoredClose({ confidence: 50, actualPct: 0, expectedMove: 10 }).hit, false);
});

test('size uses the written cap, counts open rows, and ignores a missing size', function(){
  assert.equal(sizeOf({ stakePct: 10, maxStakePct: 10 }).over, false);
  assert.equal(sizeOf({ stakePct: '20', maxStakePct: '10' }).over, true);
  assert.equal(sizeOf({ stakePct: 5, maxStakePct: 0 }), null);
  assert.equal(sizeOf({ stakePct: -1, maxStakePct: 10 }), null);
  assert.equal(sizeOf({ maxStakePct: 10 }), null);

  const half = detectOverconfidence({
    journal: [
      { stakePct: 11, maxStakePct: 10, soldAt: NOW - 40 * DAY },
      { stakePct: 11, maxStakePct: 10, soldAt: NOW - 40 * DAY },
      { stakePct: 9, maxStakePct: 10, soldAt: NOW - 40 * DAY },
      { stakePct: 10, maxStakePct: 10, soldAt: NOW - 40 * DAY }
    ]
  }, NOW);
  const sized = check(half, 'size');
  assert.equal(sized.stats.over, 2);
  assert.equal(sized.stats.sized, 4);
  assert.equal(sized.fired, true);
  assert.match(sized.line, /2 of 4/);
  assert.match(sized.line, /Matching the cap counts as inside it/);

  const under = detectOverconfidence({
    journal: [
      { stakePct: 20, maxStakePct: 10 },
      { stakePct: 5, maxStakePct: 10 },
      { stakePct: 5, maxStakePct: 10 }
    ]
  }, NOW);
  assert.equal(check(under, 'size').fired, false);
  assert.equal(check(under, 'size').state, 'quiet');

  const tiny = detectOverconfidence({
    pos: [
      { stakePct: 40, maxStakePct: 10 },
      { stakePct: 40, maxStakePct: 10 }
    ]
  }, NOW);
  assert.equal(check(tiny, 'size').stats.sized, 2);
  assert.equal(check(tiny, 'size').ready, false);
  assert.equal(check(tiny, 'pace').stats.inWindow, 0);

  const mixed = detectOverconfidence({
    journal: [{ stakePct: 30, maxStakePct: 10, soldAt: NOW }],
    pos: [
      { stakePct: 30, maxStakePct: 10 },
      { stakePct: 5, maxStakePct: 10 }
    ]
  }, NOW);
  assert.equal(check(mixed, 'size').stats.sized, 3);
  assert.equal(check(mixed, 'size').stats.over, 2);
  assert.equal(check(mixed, 'size').fired, true);
  assert.equal(mixed.status, 'noticed');
});

test('frequent closes use an inclusive 30-day window and ignore open positions', function(){
  assert.equal(inRecentWindow(NOW - 30 * DAY, NOW, 30), true);
  assert.equal(inRecentWindow(NOW - 30 * DAY - 1, NOW, 30), false);
  assert.equal(inRecentWindow(NOW, NOW, 30), true);
  assert.equal(inRecentWindow(NOW + 1, NOW, 30), false);
  assert.equal(inRecentWindow(null, NOW, 30), false);

  const journal = [];
  for(let i = 0; i < 8; i++) journal.push({ soldAt: NOW - i * DAY });
  journal.push({ soldAt: NOW - 30 * DAY - 1 });
  journal.push({ soldAt: NOW + DAY });
  journal.push({ soldAt: 'not-a-time' });
  const report = detectOverconfidence({ journal: journal, pos: [1, 2, 3, 4, 5, 6, 7, 8].map(function(){ return { t: 'OPEN' }; }) }, NOW);
  const pace = check(report, 'pace');
  assert.equal(pace.stats.inWindow, 8);
  assert.equal(pace.fired, true);
  assert.equal(report.status, 'noticed');
  assert.match(report.headline, /30 days/);

  const edge = detectOverconfidence({ journal: [{ soldAt: String(NOW - 30 * DAY) }] }, NOW);
  assert.equal(check(edge, 'pace').stats.inWindow, 1);

  const fallback = detectOverconfidence({
    journal: [{ soldAt: Date.now() - 1000 }, { soldAt: Date.now() + DAY }]
  }, 'nope');
  assert.equal(check(fallback, 'pace').stats.inWindow, 1);
});

test('two overconfidence counts name themselves without a single-count headline', function(){
  const journal = [true, false, false].map(function(hit){
    return trade({ confidence: 90, hit: hit, stakePct: 40, maxStakePct: 10, soldAt: NOW - 40 * DAY });
  });
  journal.push(trade({ confidence: 90, hit: false, stakePct: 4, maxStakePct: 10, soldAt: NOW - 40 * DAY }));
  journal.push(trade({ confidence: 40, hit: true, stakePct: 4, maxStakePct: 10, soldAt: NOW - 40 * DAY }));
  const report = detectOverconfidence({ journal: journal }, NOW);
  assert.equal(check(report, 'calibration').fired, true);
  assert.equal(check(report, 'size').fired, true);
  assert.match(report.headline, /More than one count/);
});

test('disposition waits for three winning and three losing closes', function(){
  const journal = [];
  for(let i = 0; i < 2; i++) journal.push(trade(Object.assign({ pnl: 20 }, days(4))));
  for(let i = 0; i < 3; i++) journal.push(trade(Object.assign({ pnl: -20 }, days(40))));
  journal.push(trade(Object.assign({ pnl: 0, sellPrice: 150 }, days(3))));
  const report = detectDisposition({ journal: journal, pos: [trade({ pnl: -50 })] });
  const hold = check(report, 'hold');
  assert.equal(hold.stats.winners, 2);
  assert.equal(hold.stats.losers, 3);
  assert.equal(hold.ready, false);
  assert.equal(report.status, 'insufficient');
  assert.equal(tradeOutcome(trade({ pnl: 0, sellPrice: 50 })), 'flat');
  assert.equal(tradeOutcome(trade({ pnl: '5', sellPrice: 50 })), 'win');
  assert.equal(tradeOutcome(trade({ sellPrice: 80, pnl: undefined })), 'loss');
});

test('holding losing closes longer notices at a ratio of 2 and a 7-day gap', function(){
  function holds(winDays, lossDays){
    const journal = [];
    for(let i = 0; i < 3; i++){
      journal.push(trade(Object.assign({ pnl: 10, timeframeDays: winDays }, days(winDays))));
    }
    for(let i = 0; i < 3; i++) journal.push(trade(Object.assign({ pnl: -10, timeframeDays: 10 }, days(lossDays))));
    return detectDisposition({ journal: journal });
  }
  const on = holds(7, 14);
  const hold = check(on, 'hold');
  assert.equal(hold.stats.ratio, 2);
  assert.equal(hold.stats.gapDays, 7);
  assert.equal(hold.fired, true);
  assert.equal(check(on, 'early').fired, false);
  assert.equal(on.status, 'noticed');
  assert.match(on.headline, /Losing closes were held much longer/);

  const gapShort = holds(4, 8);
  assert.equal(check(gapShort, 'hold').stats.ratio, 2);
  assert.equal(check(gapShort, 'hold').stats.gapDays, 4);
  assert.equal(check(gapShort, 'hold').fired, false);
  assert.equal(gapShort.status, 'quiet');

  const zeroOn = holds(0, 7);
  assert.equal(check(zeroOn, 'hold').stats.medianWinner, 0);
  assert.equal(check(zeroOn, 'hold').stats.ratio, null);
  assert.equal(check(zeroOn, 'hold').fired, true);
  assert.match(check(zeroOn, 'hold').line, /winner median is 0/);

  const zeroOff = holds(0, 6);
  assert.equal(check(zeroOff, 'hold').fired, false);
});

test('median hold uses the middle pair, and timestamps beat a stored hold field', function(){
  assert.equal(median([40, 2, 2, 40, 2, 40]), 21);
  const journal = [];
  [4, 4, 4].forEach(function(n){ journal.push(trade(Object.assign({ pnl: 5, timeframeDays: 90 }, days(n)))); });
  [2, 2, 2, 40, 40, 40].forEach(function(n){ journal.push(trade(Object.assign({ pnl: -5 }, days(n)))); });
  const report = detectDisposition({ journal: journal });
  assert.equal(check(report, 'hold').stats.medianLoser, 21);
  assert.equal(check(report, 'hold').stats.medianWinner, 4);
  assert.equal(check(report, 'hold').fired, true);

  const stamped = trade({ boughtAt: 0, soldAt: 10 * DAY, heldDays: 1, pnl: 5 });
  assert.equal(tradeHeldDays(stamped), 10);
  const fallback = trade({ boughtAt: 100, soldAt: 50, heldDays: 4, pnl: -5 });
  assert.equal(tradeHeldDays(fallback), 4);
  assert.equal(tradeHeldDays({ heldDays: -3, pnl: -5 }), null);
  assert.equal(tradeHeldDays({ pnl: -5 }), null);
});

test('selling winning closes early uses half the written timeframe', function(){
  function winners(specs){
    return detectDisposition({
      journal: specs.map(function(spec){
        return trade(Object.assign({ pnl: 15, sellPrice: 120 }, days(spec.days), { timeframeDays: spec.timeframe }));
      })
    });
  }
  const on = winners([{ days: 1, timeframe: 30 }, { days: 1, timeframe: 30 }, { days: 100, timeframe: 30 }]);
  const early = check(on, 'early');
  assert.equal(early.stats.early, 2);
  assert.equal(early.stats.eligible, 3);
  assert.equal(early.fired, true);
  assert.match(early.line, /2 of 3/);
  assert.match(on.headline, /before half the timeframe/);

  const inside = winners([{ days: 15, timeframe: 30 }, { days: 15, timeframe: 30 }, { days: 15, timeframe: 30 }]);
  assert.equal(check(inside, 'early').stats.early, 0);
  assert.equal(check(inside, 'early').fired, false);
  assert.equal(inside.status, 'quiet');

  const justUnder = winners([{ days: 14.9, timeframe: 30 }, { days: 1, timeframe: 30 }, { days: 1, timeframe: 30 }]);
  assert.equal(check(justUnder, 'early').stats.early, 3);
  assert.equal(check(justUnder, 'early').fired, true);

  const diluted = winners([
    { days: 1, timeframe: 30 }, { days: 1, timeframe: 30 }, { days: 1, timeframe: 30 },
    { days: 40, timeframe: 30 }, { days: 40, timeframe: 30 }
  ]);
  assert.equal(check(diluted, 'early').stats.early, 3);
  assert.equal(check(diluted, 'early').stats.eligible, 5);
  assert.equal(check(diluted, 'early').fired, false);

  const noTime = detectDisposition({
    journal: [1, 2].map(function(){ return trade(Object.assign({ pnl: 10, timeframeDays: null }, days(1))); })
  });
  assert.equal(check(noTime, 'early').stats.eligible, 0);
  assert.equal(check(noTime, 'early').ready, false);
});

test('both disposition counts can clear together', function(){
  const journal = [];
  for(let i = 0; i < 3; i++) journal.push(trade(Object.assign({ pnl: 12, timeframeDays: 90 }, days(2))));
  for(let i = 0; i < 3; i++) journal.push(trade(Object.assign({ pnl: -12, timeframeDays: 90 }, days(30))));
  const report = detectDisposition({ journal: journal });
  assert.equal(check(report, 'hold').fired, true);
  assert.equal(check(report, 'early').fired, true);
  assert.match(report.headline, /More than one count/);
});

test('panic selling counts an exact 10% drop on day 7 and ignores a smaller or slower sale', function(){
  function row(move, hold, extra){
    return trade(Object.assign({
      actualPct: move,
      pnl: move < 0 ? -10 : 10,
      falsifierHappened: null
    }, days(hold), extra || {}));
  }
  const on = detectPanic({
    journal: [row(-10, 7), row(-15, 1), row(-3, 2), row(8, 2)]
  });
  const sharp = check(on, 'sharp');
  assert.equal(sharp.stats.measured, 4);
  assert.equal(sharp.stats.sharp, 2);
  assert.equal(sharp.fired, true);
  assert.equal(on.status, 'noticed');
  assert.match(sharp.line, /2 of 4/);

  const slow = detectPanic({
    journal: [row(-10, 7.01), row(-9.99, 1), row(-15, 1), row(-1, 3)]
  });
  assert.equal(check(slow, 'sharp').stats.sharp, 1);
  assert.equal(check(slow, 'sharp').fired, false);
  assert.equal(slow.status, 'quiet');

  const tiny = detectPanic({ journal: [row(-20, 1), row(-20, 1)] });
  assert.equal(check(tiny, 'sharp').stats.measured, 2);
  assert.equal(check(tiny, 'sharp').ready, false);
  assert.equal(tiny.status, 'insufficient');

  const stored = tradeMovePct({ actualPct: '-10', buyPrice: 100, sellPrice: 100 });
  assert.equal(stored, -10);
  assert.equal(tradeMovePct({ buyPrice: 100, sellPrice: 80 }), -20);
  assert.equal(tradeMovePct({ buyPrice: 0, sellPrice: 80 }), null);
});

test('a loss sold against an unmet falsifier needs half of a marked sample', function(){
  function marked(happened, pnl){
    return trade(Object.assign({ falsifierHappened: happened, pnl: pnl, actualPct: pnl < 0 ? -4 : 4 }, days(20)));
  }
  const on = detectPanic({
    journal: [marked(false, -5), marked(false, -5), marked(true, -5), marked(false, 5)]
  });
  const row = check(on, 'falsifier');
  assert.equal(row.stats.checked, 4);
  assert.equal(row.stats.contradict, 2);
  assert.equal(row.fired, true);
  assert.match(row.line, /2 of 4/);
  assert.match(row.line, /skipped check is left out/i);

  const diluted = detectPanic({
    journal: [marked(false, -5), marked(false, -5), marked(true, -5), marked(false, 5), marked(true, 5)]
  });
  assert.equal(check(diluted, 'falsifier').stats.contradict, 2);
  assert.equal(check(diluted, 'falsifier').stats.checked, 5);
  assert.equal(check(diluted, 'falsifier').fired, false);

  const gains = detectPanic({
    journal: [marked(false, 5), marked(false, 5), marked(false, 5)]
  });
  assert.equal(check(gains, 'falsifier').stats.contradict, 0);
  assert.equal(check(gains, 'falsifier').state, 'quiet');

  const skipped = detectPanic({
    journal: [
      trade({ falsifierHappened: 'false', pnl: -5, actualPct: -12 }),
      trade({ falsifierHappened: 'no', pnl: -5 }),
      trade({ falsifierHappened: null, pnl: -5 }),
      marked(false, 0)
    ]
  });
  assert.equal(check(skipped, 'falsifier').stats.checked, 0);
  assert.equal(falsifierMark({ falsifierHappened: false }), false);
  assert.equal(falsifierMark({ falsifierHappened: 'false' }), null);

  const onePair = detectPanic({ journal: [marked(false, -5), marked(false, -5)] });
  assert.equal(check(onePair, 'falsifier').ready, false);
  assert.equal(check(onePair, 'falsifier').fired, false);
});

test('panic uses price for the drop and recorded profit for the falsifier count', function(){
  const odd = trade(Object.assign({
    pnl: 25,
    actualPct: -15,
    falsifierHappened: false
  }, days(2)));
  const fillers = [1, 2, 3].map(function(){
    return trade(Object.assign({ pnl: 10, actualPct: 4, falsifierHappened: true }, days(3)));
  });
  const report = detectPanic({ journal: [odd].concat(fillers) });
  assert.equal(check(report, 'sharp').stats.sharp, 1);
  assert.equal(check(report, 'sharp').fired, false);
  assert.equal(check(report, 'falsifier').stats.checked, 4);
  assert.equal(check(report, 'falsifier').stats.contradict, 0);
});

test('a mixed journal can notice every card once each sample is large enough', function(){
  function at(holdDays, soldAt, extra){
    return trade(Object.assign({
      boughtAt: soldAt - holdDays * DAY,
      soldAt: soldAt,
      stakePct: 8,
      maxStakePct: 10,
      buyPrice: undefined,
      sellPrice: undefined,
      actualPct: undefined
    }, extra));
  }
  const journal = [];
  for(let i = 0; i < 3; i++){
    journal.push(at(40, NOW - 40 * DAY, {
      confidence: 85, hit: false, pnl: -8, falsifierHappened: false
    }));
  }
  for(let i = 0; i < 3; i++){
    journal.push(at(3, NOW - 50 * DAY, {
      confidence: 80, hit: true, pnl: 12, falsifierHappened: false, timeframeDays: 90
    }));
  }
  [20, 20].forEach(function(holdDays){
    journal.push(at(holdDays, NOW - 45 * DAY, {
      confidence: 40, hit: false, pnl: -6, actualPct: -3, falsifierHappened: false
    }));
  });
  journal.push(at(2, NOW - 3 * DAY, {
    confidence: 40, hit: false, pnl: -20, actualPct: -12, falsifierHappened: false
  }));
  journal.push(at(1, NOW - 2 * DAY, {
    confidence: 42, hit: false, pnl: -20, actualPct: -14, falsifierHappened: false
  }));
  const report = detectPatterns({ journal: journal }, NOW);
  assert.deepEqual(report.detectors.map(function(card){ return card.id; }), ['overconfidence', 'disposition', 'panic']);
  report.detectors.forEach(function(card){ assert.equal(card.status, 'noticed', card.id); });
  assert.equal(check(report.detectors[0], 'calibration').fired, true);
  assert.equal(check(report.detectors[0], 'pace').fired, false);
  assert.equal(check(report.detectors[1], 'hold').fired, true);
  assert.equal(check(report.detectors[1], 'early').fired, true);
  assert.equal(check(report.detectors[2], 'sharp').stats.sharp >= 2, true);
  assert.equal(check(report.detectors[2], 'sharp').fired, true);
  assert.equal(check(report.detectors[2], 'falsifier').fired, true);
});

test('copy stays educational, shows the rules, and links real lessons', function(){
  const reports = [
    detectPatterns(null, NOW),
    detectPatterns({ journal: [trade({ confidence: 50, hit: true, stakePct: 5, maxStakePct: 20 })] }, NOW),
    detectOverconfidence({
      journal: [75, 75, 75, 75].map(function(confidence, i){
        return trade({ confidence: confidence, hit: i < 2, stakePct: 5, maxStakePct: 20 });
      }).concat([trade({ confidence: 40, hit: true, stakePct: 5, maxStakePct: 20 })])
    }, NOW)
  ];
  const blobs = [PATTERNS_INTRO, overconfidenceCriteria(), dispositionCriteria(), panicCriteria()];
  reports.forEach(function(report){
    const found = [];
    collect(report, found);
    blobs.push.apply(blobs, found);
  });
  blobs.forEach(function(text){ assert.doesNotMatch(text, BANNED); });
  assert.match(PATTERNS_INTRO, /not a reason to buy or sell/i);
  assert.match(overconfidenceCriteria(), /at least 5 scored closes/);
  assert.match(overconfidenceCriteria(), /70%/);
  assert.match(overconfidenceCriteria(), new RegExp(OVERCONFIDENCE_RULES.gapPoints + ' points'));
  assert.match(overconfidenceCriteria(), /30 days/);
  assert.match(overconfidenceCriteria(), /8 or more/);
  assert.match(dispositionCriteria(), /at least 3 winning closes/);
  assert.match(dispositionCriteria(), /7-day gap/);
  assert.match(dispositionCriteria(), /2 of every 3/);
  assert.match(panicCriteria(), /-10%/);
  assert.match(panicCriteria(), /7 days or less/);
  assert.match(panicCriteria(), /at least 4 closes/);
  assert.match(panicCriteria(), /not a reason to buy or sell/i);
  const slugs = { overconfidence: 'psychology-of-money', disposition: 'psychology-of-money', panic: 'stock-market' };
  detectPatterns(null, NOW).detectors.forEach(function(card){
    assert.equal(card.lesson.slug, slugs[card.id]);
    assert.ok(LESSON_CONCEPTS[card.lesson.slug]);
    assert.ok(card.criteria.length > 80);
    assert.ok(card.prompt.length > 20);
  });
  const src = readFileSync(new URL('./patterns.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /shame|stupid|reckless|you failed|you panicked/i);
});

test('the paper tab keeps the yellow note and the service worker is finpath-v39', function(){
  const sw = readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const boot = readFileSync(new URL('./boot.js', import.meta.url), 'utf8');
  assert.match(sw, /finpath-v39/);
  assert.doesNotMatch(sw, /finpath-v38/);
  assert.match(sw, /js\/intel\/paper\/patterns\.js/);
  assert.match(boot, /patterns\.js/);
  assert.match(boot, /FPPatterns/);
  assert.match(html, /psychology-of-money/);
  assert.match(html, /'stock-market'/);
  const paper = html.slice(html.indexOf('id="paperWrap"'), html.indexOf('id="paycheckEntryPort"'));
  assert.match(paper, /class="practice-note"/);
  assert.match(paper, /Practice mode\./);
  assert.match(paper, /virtual money/);
  assert.match(paper, /id="thesisPatterns"/);
  assert.match(paper, /Your patterns/);
  assert.match(paper, /not a reason to buy or sell/i);
  assert.doesNotMatch(paper, BANNED);
});
