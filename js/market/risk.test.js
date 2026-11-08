import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { LESSON_CONCEPTS } from '../intel/learn/concepts.js';

const require = createRequire(import.meta.url);
const candles = require('./candles.js');
globalThis.fpEtDateKey = candles.fpEtDateKey;
const risk = require('./risk.js');

const {
  FP_RISK_RF_ANNUAL, FP_RISK_MIN_RETURNS, FP_RISK_TRADING_DAYS, FP_RISK_LOOKBACK_DAYS,
  FP_RISK_LESSONS, FP_RISK_FORMULAS, FP_RISK_CUTOFFS,
  fpAnnualizedVol, fpSharpeRatio, fpMaxDrawdown, fpBetaFromReturns, fpConcentration,
  fpRiskAlignedReturns, fpRiskDailyCloses, fpRiskReport
} = risk;

const BANNED = /you should (buy|sell)|i recommend|buy signal|sell signal|consider (buying|selling)|you need to (buy|sell)|trim your|sell your|buy more/i;
const DAY = 86400;
const START = Math.floor(Date.parse('2026-10-05T20:00:00Z') / 1000);

// Ten +2% days and ten −1% days. Sample stdev uses n − 1 = 19.
// Yearly vol and Sharpe are locked to these inputs, not recomputed in the assertion.
const ALT_RETURNS = [];
for(let i = 0; i < 20; i++) ALT_RETURNS.push(i % 2 === 0 ? 0.02 : -0.01);
const KNOWN_VOL = 0.24430352131378663;
const KNOWN_SHARPE = 4.993788028265938;

function closesFrom(startPrice, returns, t0){
  const points = [{ t: t0 == null ? START : t0, c: startPrice }];
  let px = startPrice;
  returns.forEach(function(r, i){
    px = px * (1 + r);
    points.push({ t: (t0 == null ? START : t0) + (i + 1) * DAY, c: px });
  });
  return points;
}

function textOf(report){
  const bits = [report.windowNote].concat(report.coach);
  Object.keys(report.metrics).forEach(function(id){
    const m = report.metrics[id];
    bits.push(m.title, m.formula, m.teen, m.you, m.lesson && m.lesson.title, m.lesson && m.lesson.blurb);
  });
  return bits.filter(Boolean).join('\n');
}

function assertEducational(report){
  const text = textOf(report);
  assert.match(text, /not a reason to buy or sell/i);
  assert.doesNotMatch(text, BANNED);
  const stripped = text.replace(/not a reason to buy or sell/ig, '');
  assert.doesNotMatch(stripped, /\b(buy|sell|recommend)\b/i);
  Object.keys(report.metrics).forEach(function(id){
    const m = report.metrics[id];
    assert.ok(m.formula && m.formula.length > 40, id + ' formula');
    assert.ok(m.teen && m.teen.length > 40, id + ' teen');
    assert.ok(m.you && m.you.length > 20, id + ' you');
    assert.equal(m.lesson.slug, FP_RISK_LESSONS[id].slug);
    assert.ok(LESSON_CONCEPTS[m.lesson.slug], m.lesson.slug);
  });
}

test('yearly volatility uses the sample standard deviation and the square root of 252', function(){
  const vol = fpAnnualizedVol(ALT_RETURNS, 252);
  assert.ok(Math.abs(vol - KNOWN_VOL) < 1e-12);
  assert.equal(Math.round(vol * 1000) / 10, 24.4);
  const population = Math.sqrt(ALT_RETURNS.reduce(function(s, r){
    const d = r - 0.005;
    return s + d * d;
  }, 0) / 20) * Math.sqrt(252);
  assert.ok(Math.abs(vol - population) > 0.005);
  assert.equal(fpAnnualizedVol([0.01], 252), null);
});

test('Sharpe subtracts a 4% teaching risk-free rate before scaling by the square root of 252', function(){
  assert.equal(FP_RISK_RF_ANNUAL, 0.04);
  assert.equal(FP_RISK_TRADING_DAYS, 252);
  const sharpe = fpSharpeRatio(ALT_RETURNS, 0.04, 252);
  assert.ok(Math.abs(sharpe - KNOWN_SHARPE) < 1e-12);
  assert.equal(fpSharpeRatio(ALT_RETURNS.map(function(){ return 0.001; }), 0.04, 252), null);
  const negative = fpSharpeRatio(ALT_RETURNS.map(function(){ return -0.001; }), 0.04, 252);
  assert.equal(negative, null);
  const drifted = [];
  for(let i = 0; i < 20; i++) drifted.push(i % 2 === 0 ? -0.002 : -0.001);
  assert.ok(fpSharpeRatio(drifted, 0.04, 252) < 0);
});

test('max drawdown is the deepest peak-to-trough, not the change from start to end', function(){
  const dd = fpMaxDrawdown([100, 120, 90, 110, 60]);
  assert.equal(dd.maxDrawdown, -0.5);
  assert.equal(dd.peakAt, 1);
  assert.equal(dd.troughAt, 4);
  const flat = fpMaxDrawdown([10, 11, 12, 13]);
  assert.equal(flat.maxDrawdown, 0);
  assert.equal(fpMaxDrawdown([10]).maxDrawdown, null);
});

test('beta is 1.5 when every account return is 1.5 times the SPY return', function(){
  const bench = ALT_RETURNS.slice();
  const account = bench.map(function(r){ return r * 1.5; });
  const beta = fpBetaFromReturns(account, bench);
  assert.ok(Math.abs(beta - 1.5) < 1e-12);
  assert.equal(fpBetaFromReturns([0.01, 0.02], [0.01, 0.01]), null);
  assert.ok(Math.abs(fpBetaFromReturns(bench, bench) - 1) < 1e-12);
});

test('concentration reports the largest weight, holding HHI, and sector HHI', function(){
  const mix = fpConcentration([
    { ticker: 'AAPL', value: 50, sector: 'Technology' },
    { ticker: 'MSFT', value: 30, sector: 'Technology' },
    { ticker: 'KO', value: 20, sector: 'Consumer Staples' }
  ]);
  assert.equal(mix.largest, 0.5);
  assert.equal(mix.largestTicker, 'AAPL');
  assert.equal(mix.hhi, 0.38);
  assert.ok(Math.abs(mix.sectorHhi - 0.68) < 1e-12);
  assert.equal(mix.largestSector, 'Technology');
  assert.equal(mix.largestSectorWeight, 0.8);
  assert.equal(mix.single, false);
  const one = fpConcentration([{ ticker: 'AAPL', value: 10, sector: 'Technology' }]);
  assert.equal(one.single, true);
  assert.equal(one.largest, 1);
  assert.equal(one.hhi, 1);
  assert.equal(one.sectorHhi, 1);
  const bare = fpConcentration([{ ticker: 'AAPL', value: 40 }, { ticker: 'KO', value: 60 }]);
  assert.equal(bare.sectorHhi, null);
  assert.equal(bare.largestTicker, 'KO');
  assert.equal(fpConcentration([]).status, 'empty');
});

test('a shared New York date keeps the last close, and beta skips a day SPY does not have', function(){
  const sameDay = fpRiskDailyCloses([
    { t: Math.floor(Date.parse('2026-10-30T14:00:00Z') / 1000), c: 10 },
    { t: Math.floor(Date.parse('2026-10-30T20:00:00Z') / 1000), c: 12 }
  ]);
  assert.equal(sameDay.length, 1);
  assert.equal(sameDay[0].c, 12);
  assert.equal(sameDay[0].date, '2026-10-30');
  const t0 = Math.floor(Date.parse('2026-10-26T20:00:00Z') / 1000);
  const account = [100, 110, 121, 100, 100].map(function(c, i){ return { t: t0 + i * DAY, v: c, date: candles.fpEtDateKey(t0 + i * DAY) }; });
  const spy = [100, 100, 110, 110].map(function(c, i){
    const day = i < 2 ? i : i + 1;
    return { t: t0 + day * DAY, c: c };
  });
  const aligned = fpRiskAlignedReturns(account, fpRiskDailyCloses(spy).map(function(row){
    return { t: row.t, v: row.c, date: row.date };
  }));
  assert.equal(aligned.account.length, 3);
  assert.ok(Math.abs(aligned.account[1] - (100 / 110 - 1)) < 1e-12);
  assert.ok(Math.abs(aligned.bench[1] - 0.1) < 1e-12);
});

test('the report locks volatility, drawdown, beta, and Sharpe to the known return path', function(){
  const points = closesFrom(100, ALT_RETURNS);
  const bench = closesFrom(200, ALT_RETURNS);
  const report = fpRiskReport({
    holdings: [
      { ticker: 'AAA', shares: 1, value: 25, sector: 'Technology', points: points },
      { ticker: 'BBB', shares: 1, value: 25, sector: 'Financials', points: points },
      { ticker: 'CCC', shares: 1, value: 25, sector: 'Healthcare', points: points },
      { ticker: 'DDD', shares: 1, value: 25, sector: 'Energy', points: points }
    ],
    benchmarkPoints: bench
  });
  assert.equal(report.metrics.vol.status, 'ok');
  assert.ok(Math.abs(report.metrics.vol.value - KNOWN_VOL) < 1e-12);
  assert.equal(report.metrics.vol.display, '24.4%');
  assert.equal(report.metrics.drawdown.status, 'ok');
  assert.ok(Math.abs(report.metrics.drawdown.value - (-0.01)) < 1e-9);
  assert.equal(report.metrics.drawdown.display, '-1.0%');
  assert.equal(report.metrics.beta.status, 'ok');
  assert.ok(Math.abs(report.metrics.beta.value - 1) < 1e-12);
  assert.equal(report.metrics.beta.display, '1.00');
  assert.equal(report.metrics.sharpe.status, 'ok');
  assert.ok(Math.abs(report.metrics.sharpe.value - KNOWN_SHARPE) < 1e-12);
  assert.equal(report.metrics.sharpe.display, '4.99');
  assert.match(report.metrics.sharpe.formula, /4%/);
  assert.match(report.metrics.sharpe.formula, /252/);
  assert.match(report.metrics.sharpe.you, /4%/);
  assert.match(report.metrics.sharpe.you, /0\.0159%/);
  assert.match(report.metrics.sharpe.you, /not today’s Treasury rate/);
  assert.equal(report.metrics.concentration.largest, 0.25);
  assert.equal(report.metrics.concentration.hhi, 0.25);
  assert.equal(report.metrics.concentration.display, '25.0% · HHI 0.25 · sector HHI 0.25');
  assert.match(report.coach.join(' '), /teaching cutoffs/);
  assertEducational(report);
  const scaled = fpRiskReport({
    holdings: [{
      ticker: 'AAA',
      shares: 1,
      value: 10,
      sector: 'Technology',
      points: closesFrom(50, ALT_RETURNS.map(function(r){ return r * 1.5; }))
    }],
    benchmarkPoints: bench
  });
  assert.ok(Math.abs(scaled.metrics.beta.value - 1.5) < 1e-9);
  assert.equal(scaled.metrics.beta.display, '1.50');
  assert.equal(points.length, 21);
});

test('too few closes, missing candles, and a single holding each get a plain status', function(){
  const shortPoints = closesFrom(100, [0.01, -0.01, 0.01, 0.02]);
  const short = fpRiskReport({
    holdings: [
      { ticker: 'AAPL', shares: 2, value: 80, sector: 'Technology', points: shortPoints },
      { ticker: 'KO', shares: 1, value: 20, sector: 'Consumer Staples', points: shortPoints }
    ],
    benchmarkPoints: shortPoints
  });
  assert.equal(short.metrics.vol.status, 'short');
  assert.equal(short.metrics.drawdown.status, 'short');
  assert.equal(short.metrics.beta.status, 'short');
  assert.equal(short.metrics.sharpe.status, 'short');
  assert.equal(short.metrics.vol.display, '—');
  assert.match(short.metrics.vol.you, /at least 20 daily changes/);
  assert.match(short.metrics.vol.you, /There are 4 so far/);
  assert.match(short.metrics.beta.you, /at least 20/);
  assert.match(short.coach.join(' '), /waiting for at least 20/);
  assert.equal(short.metrics.concentration.status, 'ok');
  assert.equal(short.metrics.concentration.largestTicker, 'AAPL');
  assert.match(short.metrics.concentration.you, /80\.0%/);
  assert.match(short.coach.join(' '), /AAPL is 80\.0%/);
  assertEducational(short);

  const long = closesFrom(100, ALT_RETURNS);
  const missing = fpRiskReport({
    holdings: [
      { ticker: 'AAPL', shares: 1, value: 50, sector: 'Technology', points: long },
      { ticker: 'NEW', shares: 1, value: 50, sector: 'Healthcare', points: [] }
    ],
    benchmarkPoints: long
  });
  assert.deepEqual(missing.missing, ['NEW']);
  assert.equal(missing.metrics.vol.status, 'ok');
  assert.ok(Math.abs(missing.metrics.vol.value - KNOWN_VOL) < 1e-12);
  assert.match(missing.coach.join(' '), /NEW/);
  assert.match(missing.metrics.concentration.you, /50\.0%/);
  assert.equal(missing.holdingsUsed.join(','), 'AAPL');

  const only = fpRiskReport({
    holdings: [{ ticker: 'AAPL', shares: 4, value: 100, sector: 'Technology', points: long }],
    benchmarkPoints: closesFrom(100, ALT_RETURNS.map(function(r){ return r * 1.5; }))
  });
  assert.equal(only.single, true);
  assert.equal(only.metrics.concentration.display, '100.0% · HHI 1.00 · sector HHI 1.00');
  assert.match(only.metrics.concentration.you, /single holding \(AAPL\)/);
  assert.match(only.metrics.beta.you, /one holding/);
  assert.match(only.coach.join(' '), /only AAPL/);
  assert.equal(only.metrics.beta.display, '0.67');
  assertEducational(only);

  const noBench = fpRiskReport({
    holdings: [{ ticker: 'AAPL', shares: 1, value: 10, sector: 'Technology', points: long }],
    benchmarkPoints: []
  });
  assert.equal(noBench.metrics.vol.status, 'ok');
  assert.equal(noBench.metrics.beta.status, 'missing');
  assert.match(noBench.metrics.beta.you, /SPY/);
  assert.equal(noBench.benchmarkMissing, true);

  const none = fpRiskReport({
    holdings: [{ ticker: 'AAPL', shares: 1, value: 10, sector: 'Technology', points: [] }],
    benchmarkPoints: long
  });
  assert.equal(none.metrics.vol.status, 'missing');
  assert.equal(none.metrics.beta.status, 'missing');
  assert.match(none.metrics.beta.you, /Daily closes did not load/);
  assert.match(none.metrics.vol.you, /did not load/);
  assertEducational(none);
});

test('coach notes a bumpy window and a deep drop without telling anyone to trade', function(){
  const returns = [-0.30];
  for(let i = 0; i < 19; i++) returns.push(0.001);
  const points = closesFrom(100, returns);
  const spy = closesFrom(100, returns.map(function(){ return 0.001; }));
  const report = fpRiskReport({
    holdings: [
      { ticker: 'NVDA', shares: 1, value: 70, sector: 'Technology', points: points },
      { ticker: 'KO', shares: 1, value: 10, sector: 'Consumer Staples', points: points },
      { ticker: 'JPM', shares: 1, value: 20, sector: 'Financials', points: points }
    ],
    benchmarkPoints: spy
  });
  assert.ok(report.metrics.vol.value > FP_RISK_CUTOFFS.vol);
  assert.ok(report.metrics.drawdown.value <= FP_RISK_CUTOFFS.drawdown);
  assert.equal(report.metrics.drawdown.display, '-30.0%');
  const coach = report.coach.join(' ');
  assert.match(coach, /one stock: NVDA is 70\.0%/);
  assert.match(coach, /Technology \(70\.0%\)/);
  assert.match(coach, /yearly volatility is/);
  assert.match(coach, /deepest drop from a peak in this window was 30\.0%/);
  assert.match(coach, /not a reason to buy or sell/i);
  assert.doesNotMatch(coach, BANNED);
  assert.equal(FP_RISK_MIN_RETURNS, 20);
  assert.equal(FP_RISK_LOOKBACK_DAYS, 365);
});

test('the page, service worker, and candle window expose the risk check', function(){
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.match(sw, /finpath-v37/);
  assert.doesNotMatch(sw, /finpath-v36/);
  assert.match(sw, /js\/market\/risk\.js/);
  assert.match(html, /js\/market\/risk\.js/);
  assert.match(html, /id="riskCheck"/);
  assert.match(html, /id="paperRiskCheck"/);
  assert.match(html, /Portfolio Coach/);
  assert.match(html, /fpRiskReport/);
  assert.match(readme, /Risk check/);
  assert.match(readme, /4%/);
  const live = html.slice(html.indexOf('id="riskCheck"'), html.indexOf('id="paperWrap"'));
  const paper = html.slice(html.indexOf('id="paperRiskCheck"'), html.indexOf('id="thesisJournal"'));
  assert.match(live, /not a reason to buy or sell/i);
  assert.match(paper, /not a reason to buy or sell/i);
  assert.doesNotMatch(live + paper, BANNED);
  Object.keys(FP_RISK_FORMULAS).forEach(function(id){
    assert.match(FP_RISK_FORMULAS[id], /252|HHI|SPY|peak/);
  });
});
