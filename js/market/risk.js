// Portfolio risk check. Educational math on daily closes. No network and no DOM.
// The page loads this file as a classic script after candles.js.
// Node tests require() it. Nothing here tells anyone to buy or sell.

var FP_RISK_TRADING_DAYS = 252;
var FP_RISK_RF_ANNUAL = 0.04;
var FP_RISK_MIN_RETURNS = 20;
var FP_RISK_BENCH = 'SPY';
var FP_RISK_LOOKBACK_DAYS = 365;

var FP_RISK_CUTOFFS = {
  largeWeight: 0.45,
  sectorWeight: 0.55,
  vol: 0.25,
  drawdown: -0.20,
  betaHigh: 1.20,
  betaLow: 0.80
};

var FP_RISK_LESSONS = {
  vol: {
    slug: 'stock-market',
    title: 'How the Stock Market Actually Works',
    blurb: 'A free lesson on why a price moves from day to day, and what the S&P 500 is. It is background reading. It is not a reason to buy or sell.'
  },
  drawdown: {
    slug: 'economic-crashes',
    title: 'Understanding Economic Crashes',
    blurb: 'A lesson on how a long rise can be followed by a deep drop from a peak. It is background reading. It is not a reason to buy or sell.'
  },
  beta: {
    slug: 'etfs-vs-stocks',
    title: 'ETFs vs Individual Stocks',
    blurb: 'A lesson on one company versus a fund that holds many, including funds that track a big index such as the S&P 500. It is background reading. It is not a reason to buy or sell.'
  },
  sharpe: {
    slug: 'long-term-strategy',
    title: 'Building a Long-Term Investment Strategy',
    blurb: 'A lesson on time horizon and how large a swing you can sit with. It is background reading. It is not a reason to buy or sell.'
  },
  concentration: {
    slug: 'bonds-diversification',
    title: 'Bonds Cash and Portfolio Diversification',
    blurb: 'A lesson on spreading money across different kinds of assets instead of one pile. It is background reading. It is not a reason to buy or sell.'
  }
};

var FP_RISK_FORMULAS = {
  vol: 'Yearly volatility = sample standard deviation of daily returns × square root of 252. The sample standard deviation squares each day’s distance from the average daily return, divides by (number of days − 1), then takes the square root. 252 is the number of trading days used to scale one day up to a year.',
  drawdown: 'Max drawdown = the smallest value of (close ÷ running peak − 1). The running peak is the highest close seen so far in the window. The result is zero or negative. −20% means the total fell by a fifth from an earlier high close.',
  beta: 'Beta versus SPY = covariance(account daily returns, SPY daily returns) ÷ variance(SPY daily returns). Covariance and variance use the same days and the same sample (divide by n − 1), so that divisor cancels. A day counts only when both the account and SPY have a close.',
  sharpe: 'Sharpe = (average daily return − 0.04 ÷ 252) ÷ sample standard deviation of daily returns × square root of 252. The 0.04 is a 4% yearly risk-free rate assumed for teaching. It is not today’s Treasury rate. 252 is the trading-day count. Splitting 4% across 252 days is about 0.0159% per trading day.',
  concentration: 'Largest holding = biggest current value ÷ total invested value. Holding HHI = the sum of each weight times itself, with weights as fractions of the total. Sector HHI is the same sum on sector groups when a sector label exists. An HHI of 1 means one bucket. Equal weights across four buckets is 0.25.'
};

var FP_RISK_TEENS = {
  vol: 'This is how much the total usually jumps from one close to the next, stretched out to a year. A bigger percent means a bumpier ride. It describes closes already in the window, not next year.',
  drawdown: 'This is the deepest drop from a high close to a later lower close inside the window. It is the worst peak-to-bottom move you would have seen, not the change from the first day to the last.',
  beta: 'Beta compares this account with SPY, a fund that tracks the S&P 500. Near 1 means the daily percent changes were about the same size. Above 1 means this account moved more. Below 1 means it moved less. A negative beta means they tended to move in opposite directions.',
  sharpe: 'Sharpe puts the average daily change next to how bumpy those days were, after a pretend 4% “safe” yearly rate. A higher number means more average gain per unit of bumpiness in this past window. It is not a grade and not a promise.',
  concentration: 'This shows whether one stock, or one sector group, is most of the invested dollars. The largest-holding percent is the simple share. HHI squares those shares and adds them up, so a few big pieces raise the number faster than many small ones.'
};

function fpRiskDateKey(unixSec){
  var fn = null;
  try{
    if(typeof fpEtDateKey === 'function') fn = fpEtDateKey;
  }catch(e){}
  if(!fn){
    try{
      if(typeof globalThis !== 'undefined' && typeof globalThis.fpEtDateKey === 'function') fn = globalThis.fpEtDateKey;
    }catch(e2){}
  }
  if(fn) return fn(unixSec);
  var n = Number(unixSec);
  if(!isFinite(n)) return '';
  try{ return new Date(n * 1000).toISOString().slice(0, 10); }catch(e3){ return ''; }
}

function fpRiskFmtPct(frac){
  if(!isFinite(Number(frac))) return '—';
  var rounded = Math.round(Number(frac) * 1000) / 10;
  if(Object.is(rounded, -0)) rounded = 0;
  return rounded.toFixed(1) + '%';
}

function fpRiskFmtNum(x){
  if(!isFinite(Number(x))) return '—';
  var rounded = Math.round(Number(x) * 100) / 100;
  if(Object.is(rounded, -0)) rounded = 0;
  return rounded.toFixed(2);
}

function fpMean(xs){
  var s = 0;
  var i;
  for(i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

function fpSampleStdev(xs){
  if(!xs || xs.length < 2) return null;
  var m = fpMean(xs);
  var acc = 0;
  var i;
  for(i = 0; i < xs.length; i++){
    var d = xs[i] - m;
    acc += d * d;
  }
  return Math.sqrt(acc / (xs.length - 1));
}

function fpAnnualizedVol(returns, tradingDays){
  var xs = [];
  var i;
  var src = returns || [];
  for(i = 0; i < src.length; i++){
    var n = Number(src[i]);
    if(isFinite(n)) xs.push(n);
  }
  var days = Number(tradingDays);
  if(!isFinite(days) || days <= 0) days = FP_RISK_TRADING_DAYS;
  var std = fpSampleStdev(xs);
  if(std == null) return null;
  return std * Math.sqrt(days);
}

function fpSharpeRatio(returns, rfAnnual, tradingDays){
  var xs = [];
  var i;
  var src = returns || [];
  for(i = 0; i < src.length; i++){
    var n = Number(src[i]);
    if(isFinite(n)) xs.push(n);
  }
  var days = Number(tradingDays);
  if(!isFinite(days) || days <= 0) days = FP_RISK_TRADING_DAYS;
  var rf = Number(rfAnnual);
  if(!isFinite(rf)) rf = FP_RISK_RF_ANNUAL;
  var std = fpSampleStdev(xs);
  // Identical closes still leave a tiny float residue. Treat that as zero
  // so the ratio does not explode. A real daily spread is far above this.
  if(std == null || std < 1e-12) return null;
  var excess = fpMean(xs) - rf / days;
  return excess / std * Math.sqrt(days);
}

function fpMaxDrawdown(values){
  var peak = null;
  var maxDd = 0;
  var peakAt = -1;
  var troughAt = -1;
  var worstPeakAt = -1;
  var i;
  var src = values || [];
  var n = 0;
  for(i = 0; i < src.length; i++){
    var v = Number(src[i]);
    if(!isFinite(v) || v <= 0) continue;
    n++;
    if(peak == null || v > peak){
      peak = v;
      peakAt = i;
    }
    var dd = v / peak - 1;
    if(dd < maxDd){
      maxDd = dd;
      troughAt = i;
      worstPeakAt = peakAt;
    }
  }
  if(n < 2) return { maxDrawdown: null, peakAt: -1, troughAt: -1 };
  return { maxDrawdown: maxDd, peakAt: worstPeakAt, troughAt: troughAt };
}

function fpBetaFromReturns(account, bench){
  var a = [];
  var b = [];
  var i;
  var n = Math.min(account ? account.length : 0, bench ? bench.length : 0);
  for(i = 0; i < n; i++){
    var ar = Number(account[i]);
    var br = Number(bench[i]);
    if(!isFinite(ar) || !isFinite(br)) continue;
    a.push(ar);
    b.push(br);
  }
  if(a.length < 2) return null;
  var ma = fpMean(a);
  var mb = fpMean(b);
  var cov = 0;
  var vari = 0;
  for(i = 0; i < a.length; i++){
    var da = a[i] - ma;
    var db = b[i] - mb;
    cov += da * db;
    vari += db * db;
  }
  if(!(vari > 1e-18)) return null;
  return cov / vari;
}

function fpRiskDailyCloses(points){
  var rows = [];
  var i;
  var src = points || [];
  for(i = 0; i < src.length; i++){
    var p = src[i];
    if(!p) continue;
    var t = Number(p.t);
    var c = Number(p.c != null ? p.c : p.v);
    if(!isFinite(t) || !isFinite(c) || c <= 0) continue;
    rows.push({ t: t, c: c });
  }
  rows.sort(function(a, b){ return a.t - b.t; });
  var byDate = {};
  var dates = [];
  for(i = 0; i < rows.length; i++){
    var key = fpRiskDateKey(rows[i].t);
    if(!key) continue;
    if(!byDate[key]) dates.push(key);
    byDate[key] = { t: rows[i].t, c: rows[i].c, date: key };
  }
  dates.sort();
  var out = [];
  for(i = 0; i < dates.length; i++) out.push(byDate[dates[i]]);
  return out;
}

function fpRiskMergeHoldings(holdings){
  var map = {};
  var order = [];
  var i;
  var src = holdings || [];
  for(i = 0; i < src.length; i++){
    var h = src[i] || {};
    var ticker = String(h.ticker || '').trim();
    if(!ticker) continue;
    var shares = Number(h.shares);
    var value = Number(h.value);
    var points = Array.isArray(h.points) ? h.points : [];
    if(!map[ticker]){
      map[ticker] = {
        ticker: ticker,
        shares: isFinite(shares) && shares > 0 ? shares : 0,
        value: isFinite(value) && value > 0 ? value : 0,
        sector: h.sector,
        hasSector: h.sector != null && String(h.sector) !== '',
        points: points
      };
      order.push(ticker);
      continue;
    }
    var row = map[ticker];
    if(isFinite(shares) && shares > 0) row.shares += shares;
    if(isFinite(value) && value > 0) row.value += value;
    if(points.length > row.points.length) row.points = points;
    if(!row.hasSector && h.sector != null && String(h.sector) !== ''){
      row.sector = h.sector;
      row.hasSector = true;
    }
  }
  var out = [];
  for(i = 0; i < order.length; i++) out.push(map[order[i]]);
  return out;
}

function fpRiskAccountSeries(holdings){
  var missing = [];
  var books = [];
  var i;
  var j;
  for(i = 0; i < holdings.length; i++){
    var h = holdings[i];
    var daily = fpRiskDailyCloses(h.points);
    if(!(h.shares > 0) || daily.length < 2){
      missing.push(h.ticker);
      continue;
    }
    var map = {};
    var dates = [];
    for(j = 0; j < daily.length; j++){
      map[daily[j].date] = daily[j];
      dates.push(daily[j].date);
    }
    books.push({ ticker: h.ticker, shares: h.shares, map: map, dates: dates });
  }
  if(!books.length) return { series: [], missing: missing, tickers: [] };
  var common = books[0].dates.filter(function(date){
    var k;
    for(k = 1; k < books.length; k++){
      if(!books[k].map[date]) return false;
    }
    return true;
  });
  var series = [];
  for(j = 0; j < common.length; j++){
    var date = common[j];
    var v = 0;
    var t = 0;
    for(i = 0; i < books.length; i++){
      var row = books[i].map[date];
      v += row.c * books[i].shares;
      if(row.t > t) t = row.t;
    }
    if(v > 0) series.push({ t: t, v: v, date: date });
  }
  return {
    series: series,
    missing: missing,
    tickers: books.map(function(b){ return b.ticker; })
  };
}

function fpRiskReturns(series){
  var out = [];
  var i;
  for(i = 1; i < (series ? series.length : 0); i++){
    var prev = Number(series[i - 1].v);
    var cur = Number(series[i].v);
    if(!(prev > 0) || !(cur > 0)) continue;
    out.push({ date: series[i].date, t: series[i].t, r: cur / prev - 1 });
  }
  return out;
}

function fpRiskAlignedReturns(accountSeries, benchSeries){
  var aMap = {};
  var bMap = {};
  var i;
  for(i = 0; i < (accountSeries ? accountSeries.length : 0); i++) aMap[accountSeries[i].date] = accountSeries[i].v;
  for(i = 0; i < (benchSeries ? benchSeries.length : 0); i++){
    var row = benchSeries[i];
    var v = Number(row.v != null ? row.v : row.c);
    if(row && row.date && v > 0) bMap[row.date] = v;
  }
  var dates = [];
  for(i = 0; i < (accountSeries ? accountSeries.length : 0); i++){
    var d = accountSeries[i].date;
    if(bMap[d] != null) dates.push(d);
  }
  var account = [];
  var bench = [];
  for(i = 1; i < dates.length; i++){
    var ap = aMap[dates[i - 1]];
    var ac = aMap[dates[i]];
    var bp = bMap[dates[i - 1]];
    var bc = bMap[dates[i]];
    if(!(ap > 0) || !(ac > 0) || !(bp > 0) || !(bc > 0)) continue;
    account.push(ac / ap - 1);
    bench.push(bc / bp - 1);
  }
  return { account: account, bench: bench, dates: dates };
}

function fpConcentration(holdings){
  var rows = [];
  var i;
  var sawSector = false;
  var src = holdings || [];
  for(i = 0; i < src.length; i++){
    var h = src[i] || {};
    var value = Number(h.value);
    if(!isFinite(value) || value <= 0){
      var daily = fpRiskDailyCloses(h.points || []);
      var shares = Number(h.shares);
      if(daily.length && isFinite(shares) && shares > 0) value = shares * daily[daily.length - 1].c;
    }
    if(!isFinite(value) || value <= 0) continue;
    var hasSector = h.hasSector != null ? !!h.hasSector : (h.sector != null && String(h.sector) !== '');
    if(hasSector) sawSector = true;
    rows.push({
      ticker: String(h.ticker || ''),
      value: value,
      sector: hasSector ? (String(h.sector || 'Other') || 'Other') : null
    });
  }
  if(!rows.length){
    return {
      status: 'empty',
      single: false,
      largest: null,
      largestTicker: '',
      hhi: null,
      sectorHhi: null,
      largestSector: '',
      largestSectorWeight: null,
      partialSector: false,
      count: 0
    };
  }
  var total = 0;
  for(i = 0; i < rows.length; i++) total += rows[i].value;
  var hhi = 0;
  var largest = 0;
  var largestTicker = '';
  var sectorTotals = {};
  var partial = false;
  for(i = 0; i < rows.length; i++){
    var w = rows[i].value / total;
    hhi += w * w;
    if(w > largest || !largestTicker){
      largest = w;
      largestTicker = rows[i].ticker;
    }
    var label = sawSector ? (rows[i].sector || 'Other') : null;
    if(label){
      if(label === 'Other') partial = true;
      sectorTotals[label] = (sectorTotals[label] || 0) + rows[i].value;
    }
  }
  var sectorHhi = null;
  var largestSector = '';
  var largestSectorWeight = null;
  if(sawSector){
    sectorHhi = 0;
    var labels = Object.keys(sectorTotals);
    for(i = 0; i < labels.length; i++){
      var sw = sectorTotals[labels[i]] / total;
      sectorHhi += sw * sw;
      if(largestSectorWeight == null || sw > largestSectorWeight){
        largestSectorWeight = sw;
        largestSector = labels[i];
      }
    }
  }
  return {
    status: 'ok',
    single: rows.length === 1,
    largest: largest,
    largestTicker: largestTicker,
    hhi: hhi,
    sectorHhi: sectorHhi,
    largestSector: largestSector,
    largestSectorWeight: largestSectorWeight,
    partialSector: partial,
    count: rows.length
  };
}

function fpRiskLesson(id){
  var lesson = FP_RISK_LESSONS[id];
  if(!lesson) return null;
  return { slug: lesson.slug, title: lesson.title, blurb: lesson.blurb };
}

function fpPathStatus(account, minReturns){
  if(!account.tickers.length) return { status: 'missing', n: 0, closes: 0 };
  var closes = account.series.length;
  var n = Math.max(0, closes - 1);
  if(closes < 2 || n < minReturns) return { status: 'short', n: n, closes: closes };
  return { status: 'ok', n: n, closes: closes };
}

function fpVolYou(status, n, minReturns, display){
  if(status === 'missing') return 'Daily closes did not load, so there is no yearly swing to show.';
  if(status === 'short') return 'This needs at least ' + minReturns + ' daily changes before a yearly number is worth reading. There are ' + n + ' so far, so one noisy week would not be stretched into a year.';
  if(display === '0.0%') return 'Across ' + n + ' daily changes, the closes did not vary, so yearly volatility is 0.0%. A different window can look different.';
  return 'Across ' + n + ' daily changes, the yearly swing measured from those closes is ' + display + '. A larger percent means the total jumped around more. This is the past window, not a forecast.';
}

function fpDrawdownYou(status, n, minReturns, value){
  if(status === 'missing') return 'Daily closes did not load, so there is no peak-to-bottom drop to show.';
  if(status === 'short') return 'This needs at least ' + minReturns + ' daily changes before the deepest drop is worth reading. There are ' + n + ' so far.';
  if(!(value < 0)) return 'In this window the total never closed below an earlier peak, so the deepest drop is 0.0%. A different window can look different.';
  return 'The deepest drop from a peak in this window was ' + fpRiskFmtPct(Math.abs(value)) + '. The total fell from an earlier high close to a later lower close. It is not a prediction of the next drop.';
}

function fpBetaYou(status, n, minReturns, display, single, reason){
  if(status === 'missing' && reason === 'account') return 'Daily closes did not load, so there is no beta versus SPY.';
  if(status === 'missing') return 'SPY’s daily closes did not load, so there is no comparison with that benchmark.';
  if(status === 'short') return 'Beta needs at least ' + minReturns + ' days when both this account and SPY have a close. There are ' + n + ' so far.';
  if(status === 'flat') return 'On the shared days, SPY’s closes did not vary, so beta is not defined. There is no market move to compare against.';
  var line = 'On ' + n + ' days that both this account and SPY had a close, beta is ' + display + '. Near 1 means the percent changes were similar in size. Above 1 means this account moved more than SPY. Below 1 means it moved less.';
  if(single) line += ' This is one holding, so the beta is that one price, not a mix.';
  return line;
}

function fpSharpeYou(status, n, minReturns, display){
  var rate = 'The risk-free rate assumed here is 4% a year, split across 252 trading days (about 0.0159% per day). It is a teaching number, not today’s Treasury rate.';
  if(status === 'missing') return 'Daily closes did not load, so there is no Sharpe ratio. ' + rate;
  if(status === 'short') return 'This needs at least ' + minReturns + ' daily changes. There are ' + n + ' so far. ' + rate;
  if(status === 'flat') return 'The daily percent changes were all the same, so the spread is zero and the Sharpe ratio is not defined. ' + rate;
  return 'With that 4% teaching rate, the Sharpe ratio for this window is ' + display + '. It compares the average daily change, after the rate, with how wide the daily changes were. It is not a score to beat and not a forecast. ' + rate;
}

function fpConcentrationYou(conc){
  if(!conc || conc.status === 'empty') return 'Add a stock with a value above zero to see how concentrated the invested dollars are.';
  if(conc.single){
    return 'This is a single holding (' + conc.largestTicker + '), so it is ' + fpRiskFmtPct(conc.largest) + ' of the invested amount and the holding HHI is ' + fpRiskFmtNum(conc.hhi) + '. A down day in that one price shows up in the whole account.';
  }
  var line = 'The largest holding is ' + conc.largestTicker + ' at ' + fpRiskFmtPct(conc.largest) + '. Holding HHI is ' + fpRiskFmtNum(conc.hhi) + ', where 1.00 is a single holding and equal weights across four holdings is 0.25. ';
  if(conc.sectorHhi == null){
    line += 'Sector labels were not available, so there is no sector HHI.';
  } else {
    line += 'The largest sector group is ' + conc.largestSector + ' at ' + fpRiskFmtPct(conc.largestSectorWeight) + ', and the sector HHI is ' + fpRiskFmtNum(conc.sectorHhi) + '.';
    if(conc.partialSector) line += ' Holdings without a specific sector are grouped as Other.';
  }
  return line;
}

function fpConcentrationDisplay(conc){
  if(!conc || conc.status !== 'ok') return '—';
  var text = fpRiskFmtPct(conc.largest) + ' · HHI ' + fpRiskFmtNum(conc.hhi);
  if(conc.sectorHhi != null) text += ' · sector HHI ' + fpRiskFmtNum(conc.sectorHhi);
  return text;
}

function fpCoachLines(report){
  var lines = [];
  var conc = report.metrics.concentration;
  var vol = report.metrics.vol;
  var dd = report.metrics.drawdown;
  var beta = report.metrics.beta;
  var cuts = FP_RISK_CUTOFFS;
  if(report.missing && report.missing.length){
    lines.push('Daily closes did not load for ' + report.missing.join(', ') + ', so those holdings are left out of the path.');
  }
  if(conc && conc.status === 'ok' && conc.single){
    lines.push('Most of the movement here comes from one stock, because this account holds only ' + conc.largestTicker + '.');
  } else if(conc && conc.status === 'ok' && conc.largest >= cuts.largeWeight){
    lines.push('Most of the movement here comes from one stock: ' + conc.largestTicker + ' is ' + fpRiskFmtPct(conc.largest) + ' of the invested amount.');
  }
  if(conc && conc.status === 'ok' && !conc.single && conc.largestSectorWeight != null && conc.largestSectorWeight >= cuts.sectorWeight){
    if(conc.largestSector === 'Index Fund'){
      lines.push('Most of the invested amount is in an index fund (' + fpRiskFmtPct(conc.largestSectorWeight) + '). A fund is already a basket, and it can still move with the market it tracks.');
    } else if(conc.largestSector === 'Other'){
      lines.push('Most of the invested amount has no sector label (' + fpRiskFmtPct(conc.largestSectorWeight) + ' is grouped as Other), so the sector HHI is only a rough bucket.');
    } else {
      lines.push('Most of the invested amount is grouped as ' + conc.largestSector + ' (' + fpRiskFmtPct(conc.largestSectorWeight) + '). Prices in one group often move together.');
    }
  }
  if(vol && vol.status === 'ok' && vol.value >= cuts.vol){
    lines.push('The daily closes in this window were bumpy: yearly volatility is ' + vol.display + '. Bigger swings mean the total can change faster.');
  }
  if(dd && dd.status === 'ok' && dd.value <= cuts.drawdown){
    lines.push('The deepest drop from a peak in this window was ' + fpRiskFmtPct(Math.abs(dd.value)) + '.');
  }
  if(beta && beta.status === 'ok' && beta.value >= cuts.betaHigh){
    lines.push('On the shared days, these closes moved more than SPY (beta ' + beta.display + ').');
  } else if(beta && beta.status === 'ok' && beta.value <= cuts.betaLow){
    lines.push('On the shared days, these closes moved less than SPY (beta ' + beta.display + ').');
  }
  if(vol && vol.status === 'short'){
    lines.push('The yearly numbers are waiting for at least ' + report.minReturns + ' daily changes.');
  }
  if(!lines.length){
    lines.push('No single stock or sector group crosses the teaching cutoffs on this check, and the swings in this window stay under those lines too.');
  }
  lines.push('These notes describe past closes and the current mix. They are not a reason to buy or sell.');
  return lines;
}

function fpRiskReport(input){
  input = input || {};
  var minReturns = Number(input.minReturns);
  if(!isFinite(minReturns) || minReturns < 2) minReturns = FP_RISK_MIN_RETURNS;
  var tradingDays = Number(input.tradingDays);
  if(!isFinite(tradingDays) || tradingDays <= 0) tradingDays = FP_RISK_TRADING_DAYS;
  var rfAnnual = Number(input.rfAnnual);
  if(!isFinite(rfAnnual)) rfAnnual = FP_RISK_RF_ANNUAL;
  var merged = fpRiskMergeHoldings(input.holdings || []);
  var account = fpRiskAccountSeries(merged);
  var benchDaily = fpRiskDailyCloses(input.benchmarkPoints || []);
  var benchSeries = benchDaily.map(function(row){ return { t: row.t, v: row.c, date: row.date }; });
  var benchmarkMissing = benchSeries.length < 2;
  var path = fpPathStatus(account, minReturns);
  var returns = fpRiskReturns(account.series);
  var retXs = returns.map(function(row){ return row.r; });
  var values = account.series.map(function(row){ return row.v; });
  var volValue = path.status === 'ok' ? fpAnnualizedVol(retXs, tradingDays) : null;
  var volStatus = path.status;
  var volDisplay = volStatus === 'ok' ? fpRiskFmtPct(volValue) : '—';
  var ddRaw = path.status === 'ok' ? fpMaxDrawdown(values) : { maxDrawdown: null };
  var ddValue = ddRaw.maxDrawdown;
  var ddStatus = path.status;
  var ddDisplay = ddStatus === 'ok' ? fpRiskFmtPct(ddValue) : '—';
  var aligned = fpRiskAlignedReturns(account.series, benchSeries);
  var betaValue = null;
  var betaStatus = 'missing';
  var betaReason = 'benchmark';
  var betaN = aligned.account.length;
  if(!account.tickers.length){
    betaStatus = 'missing';
    betaReason = 'account';
  } else if(benchmarkMissing){
    betaStatus = 'missing';
    betaReason = 'benchmark';
  } else if(betaN < minReturns){
    betaStatus = 'short';
  } else {
    betaValue = fpBetaFromReturns(aligned.account, aligned.bench);
    betaStatus = betaValue == null ? 'flat' : 'ok';
  }
  var betaDisplay = betaStatus === 'ok' ? fpRiskFmtNum(betaValue) : '—';
  var sharpeValue = null;
  var sharpeStatus = path.status;
  if(path.status === 'ok'){
    sharpeValue = fpSharpeRatio(retXs, rfAnnual, tradingDays);
    if(sharpeValue == null) sharpeStatus = 'flat';
  }
  var sharpeDisplay = sharpeStatus === 'ok' ? fpRiskFmtNum(sharpeValue) : '—';
  var concHoldings = merged.map(function(h){
    return { ticker: h.ticker, shares: h.shares, value: h.value, sector: h.hasSector ? h.sector : null, points: h.points, hasSector: h.hasSector };
  });
  var conc = fpConcentration(concHoldings);
  var single = !!(conc && conc.single);
  var volMetric = {
    id: 'vol',
    title: 'Yearly volatility',
    status: volStatus,
    value: volValue,
    display: volDisplay,
    n: returns.length,
    formula: FP_RISK_FORMULAS.vol,
    teen: FP_RISK_TEENS.vol,
    you: fpVolYou(volStatus, returns.length, minReturns, volDisplay),
    lesson: fpRiskLesson('vol')
  };
  var ddMetric = {
    id: 'drawdown',
    title: 'Max drawdown',
    status: ddStatus,
    value: ddValue,
    display: ddDisplay,
    n: returns.length,
    formula: FP_RISK_FORMULAS.drawdown,
    teen: FP_RISK_TEENS.drawdown,
    you: fpDrawdownYou(ddStatus, returns.length, minReturns, ddValue),
    lesson: fpRiskLesson('drawdown')
  };
  var betaMetric = {
    id: 'beta',
    title: 'Beta vs SPY',
    status: betaStatus,
    value: betaValue,
    display: betaDisplay,
    n: betaN,
    formula: FP_RISK_FORMULAS.beta,
    teen: FP_RISK_TEENS.beta,
    you: fpBetaYou(betaStatus, betaN, minReturns, betaDisplay, single, betaReason),
    lesson: fpRiskLesson('beta')
  };
  var sharpeMetric = {
    id: 'sharpe',
    title: 'Sharpe ratio',
    status: sharpeStatus,
    value: sharpeValue,
    display: sharpeDisplay,
    n: returns.length,
    formula: FP_RISK_FORMULAS.sharpe,
    teen: FP_RISK_TEENS.sharpe,
    you: fpSharpeYou(sharpeStatus, returns.length, minReturns, sharpeDisplay),
    lesson: fpRiskLesson('sharpe')
  };
  var concMetric = {
    id: 'concentration',
    title: 'Concentration',
    status: conc.status,
    value: conc.largest,
    display: fpConcentrationDisplay(conc),
    n: conc.count,
    single: conc.single,
    largest: conc.largest,
    largestTicker: conc.largestTicker,
    hhi: conc.hhi,
    sectorHhi: conc.sectorHhi,
    largestSector: conc.largestSector,
    largestSectorWeight: conc.largestSectorWeight,
    partialSector: conc.partialSector,
    formula: FP_RISK_FORMULAS.concentration,
    teen: FP_RISK_TEENS.concentration,
    you: fpConcentrationYou(conc),
    lesson: fpRiskLesson('concentration')
  };
  var report = {
    benchmark: input.benchmark || FP_RISK_BENCH,
    rfAnnual: rfAnnual,
    tradingDays: tradingDays,
    minReturns: minReturns,
    missing: account.missing,
    stale: !!input.stale,
    holdingsUsed: account.tickers,
    closes: account.series.length,
    benchmarkMissing: benchmarkMissing,
    single: single,
    windowNote: 'The path uses today’s share counts on past daily closes. It does not replay earlier buys and sells. Each New York date keeps the last close that day, for up to about a year.',
    metrics: {
      vol: volMetric,
      drawdown: ddMetric,
      beta: betaMetric,
      sharpe: sharpeMetric,
      concentration: concMetric
    },
    coach: []
  };
  report.coach = fpCoachLines(report);
  return report;
}

var fpRiskApi = {
  FP_RISK_TRADING_DAYS: FP_RISK_TRADING_DAYS,
  FP_RISK_RF_ANNUAL: FP_RISK_RF_ANNUAL,
  FP_RISK_MIN_RETURNS: FP_RISK_MIN_RETURNS,
  FP_RISK_BENCH: FP_RISK_BENCH,
  FP_RISK_LOOKBACK_DAYS: FP_RISK_LOOKBACK_DAYS,
  FP_RISK_CUTOFFS: FP_RISK_CUTOFFS,
  FP_RISK_LESSONS: FP_RISK_LESSONS,
  FP_RISK_FORMULAS: FP_RISK_FORMULAS,
  FP_RISK_TEENS: FP_RISK_TEENS,
  fpRiskFmtPct: fpRiskFmtPct,
  fpRiskFmtNum: fpRiskFmtNum,
  fpSampleStdev: fpSampleStdev,
  fpAnnualizedVol: fpAnnualizedVol,
  fpSharpeRatio: fpSharpeRatio,
  fpMaxDrawdown: fpMaxDrawdown,
  fpBetaFromReturns: fpBetaFromReturns,
  fpRiskDailyCloses: fpRiskDailyCloses,
  fpRiskAccountSeries: fpRiskAccountSeries,
  fpRiskAlignedReturns: fpRiskAlignedReturns,
  fpConcentration: fpConcentration,
  fpCoachLines: fpCoachLines,
  fpRiskReport: fpRiskReport
};
try{
  if(typeof module !== 'undefined' && module && module.exports) module.exports = fpRiskApi;
}catch(e){}
