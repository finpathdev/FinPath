import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const candles = createRequire(import.meta.url)('./candles.js');
const {
  fpChartRequest, fpEtDateKey, fpPointsFromPairs, fpClipSeries, fpCombineHoldings,
  fpReadCandleCache, fpWriteCandleCache, fpCandleStatus, fpCandleFreshMs, fpChartLabel
} = candles;

const FRI_CLOSE = Math.floor(Date.parse('2026-10-30T20:00:00Z') / 1000);
const FRI_OPEN = Math.floor(Date.parse('2026-10-30T13:35:00Z') / 1000);
const THU_CLOSE = Math.floor(Date.parse('2026-10-29T20:00:00Z') / 1000);
const OCT20 = Math.floor(Date.parse('2026-10-20T20:00:00Z') / 1000);
const SUNDAY = Math.floor(Date.parse('2026-11-01T16:30:00Z') / 1000);

function memoryStore(){
  const data = {};
  return {
    getItem(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v){ data[k] = String(v); }
  };
}

test('chart windows match the portfolio period buttons', function(){
  assert.deepEqual(fpChartRequest(1), { interval: '5m', days: 5, displayDays: 1, cacheDays: 1, lastSession: true });
  assert.equal(fpChartRequest(7).interval, '30m');
  assert.equal(fpChartRequest(7).displayDays, 7);
  assert.equal(fpChartRequest(30).interval, '1d');
  assert.equal(fpChartRequest(30).displayDays, 30);
  assert.equal(fpChartRequest(90).displayDays, 90);
  assert.equal(fpChartRequest(90).days, 110);
  assert.equal(fpChartRequest(90).cacheDays, 90);
  assert.equal(fpChartRequest(365).interval, '1d');
  assert.equal(fpChartRequest(365).days, 400);
  assert.equal(fpChartRequest(365).displayDays, 370);
  assert.equal(fpChartRequest(365).cacheDays, 365);
  assert.notEqual(fpChartRequest(365).cacheDays, fpChartRequest(90).cacheDays);
  assert.equal(fpCandleFreshMs(1), 2 * 60 * 1000);
  assert.equal(fpCandleFreshMs(30), 15 * 60 * 1000);
});

test('1D on a weekend keeps the last New York session, not an empty Saturday', function(){
  assert.equal(fpEtDateKey(FRI_CLOSE), '2026-10-30');
  assert.equal(fpEtDateKey(THU_CLOSE), '2026-10-29');
  const points = [
    { t: THU_CLOSE - 3600, c: 10 },
    { t: THU_CLOSE, c: 11 },
    { t: FRI_OPEN, c: 12 },
    { t: FRI_CLOSE, c: 13 }
  ];
  const clipped = fpClipSeries(points, 1, SUNDAY);
  assert.deepEqual(clipped.map(function(p){ return p.c; }), [12, 13]);
});

test('1W and 3M windows drop bars outside the selected span', function(){
  const points = [
    { t: OCT20, c: 1 },
    { t: THU_CLOSE, c: 2 },
    { t: FRI_CLOSE, c: 3 }
  ];
  const week = fpClipSeries(points, 7, SUNDAY);
  assert.deepEqual(week.map(function(p){ return p.c; }), [2, 3]);
  const quarter = fpClipSeries(points, 90, SUNDAY);
  assert.equal(quarter.length, 3);
});

test('pair parser skips nulls, non-positive closes, and duplicate timestamps', function(){
  const points = fpPointsFromPairs([30, 10, 20, 20], [3, null, 0, 2]);
  assert.deepEqual(points, [{ t: 20, c: 2 }, { t: 30, c: 3 }]);
});

test('portfolio line forward-fills and does not treat a missing holding as zero', function(){
  const combined = fpCombineHoldings([
    { ticker: 'AAPL', shares: 2, points: [{ t: 1, c: 10 }, { t: 2, c: 11 }, { t: 3, c: 12 }] },
    { ticker: 'VOO', shares: 1, points: [{ t: 2, c: 100 }, { t: 3, c: 100 }, { t: 4, c: 110 }] },
    { ticker: 'JPM', shares: 2, points: [] }
  ]);
  assert.deepEqual(combined.missing, ['JPM']);
  assert.deepEqual(combined.points, [
    { t: 2, v: 122 },
    { t: 3, v: 124 },
    { t: 4, v: 134 }
  ]);
});

test('saved series round-trip and the oldest entry is dropped past the cap', function(){
  const store = memoryStore();
  fpWriteCandleCache(store, 'aapl', 1, [{ t: FRI_OPEN, c: 12 }, { t: FRI_CLOSE, c: 13 }], 1000);
  const hit = fpReadCandleCache(store, 'AAPL', 1);
  assert.equal(hit.saved, 1000);
  assert.equal(hit.points.length, 2);
  assert.equal(fpReadCandleCache(store, 'AAPL', 7), null);
  let i;
  for(i = 0; i < 50; i++){
    fpWriteCandleCache(store, 'T' + i, 30, [{ t: 1, c: 1 }, { t: 2, c: 2 }], i);
  }
  const raw = JSON.parse(store.getItem('fp_candlecache'));
  assert.equal(Object.keys(raw).length, 48);
  assert.equal(raw['T0|30'], undefined);
  assert.ok(raw['T49|30']);
});

test('status copy distinguishes an empty book, a plan limit, and saved history', function(){
  assert.match(fpCandleStatus({ empty: true }).text, /Add a stock/);
  assert.equal(fpCandleStatus({ loading: true }).retry, false);
  const plan = fpCandleStatus({ failed: true, plan: true });
  assert.match(plan.text, /market-data plan/);
  assert.match(plan.text, /backup feed/);
  assert.equal(plan.retry, true);
  assert.doesNotMatch(fpCandleStatus({ failed: true }).text, /market-data plan/);
  const stale = fpCandleStatus({ stale: true, missing: ['KO'] });
  assert.equal(stale.mode, 'ok');
  assert.match(stale.text, /saved history/);
  assert.match(stale.text, /Left out KO/);
  assert.equal(stale.retry, true);
  assert.equal(fpCandleStatus({}).text, '');
  assert.match(fpChartLabel(FRI_CLOSE, 1), /PM|AM/);
});

test('service worker is finpath-v39 and precaches the chart helper', function(){
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /finpath-v39/);
  assert.doesNotMatch(sw, /finpath-v38/);
  assert.match(sw, /js\/market\/candles\.js/);
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /js\/market\/candles\.js/);
  assert.match(html, /market-candles/);
  assert.doesNotMatch(html, /Chart unavailable — historical price data/);
});
