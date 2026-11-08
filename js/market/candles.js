// Portfolio chart series helpers. No network and no DOM.
// The page loads this file as a classic script. Node tests require() it.

var FP_CANDLE_CACHE_KEY = 'fp_candlecache';
var FP_CANDLE_CACHE_MAX = 48;

function fpChartRequest(days){
  var d = Number(days);
  if(!isFinite(d) || d <= 1){
    return { interval: '5m', days: 5, displayDays: 1, cacheDays: 1, lastSession: true };
  }
  if(d <= 7){
    return { interval: '30m', days: 10, displayDays: 7, cacheDays: 7, lastSession: false };
  }
  if(d <= 30){
    return { interval: '1d', days: 40, displayDays: 30, cacheDays: 30, lastSession: false };
  }
  if(d <= 90){
    return { interval: '1d', days: 110, displayDays: 90, cacheDays: 90, lastSession: false };
  }
  // Risk check: about one year of daily closes. 370 calendar days covers
  // ~252 trading days. The fetch is a little longer so the first return
  // still sits inside the year. Cache key is separate from the 3M chart.
  return { interval: '1d', days: 400, displayDays: 370, cacheDays: 365, lastSession: false };
}

function fpCandleFreshMs(days){
  return fpChartRequest(days).cacheDays <= 1 ? 2 * 60 * 1000 : 15 * 60 * 1000;
}

function fpEtDateKey(unixSec){
  var n = Number(unixSec);
  if(!isFinite(n)) return '';
  try{
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(n * 1000));
  }catch(e){
    return '';
  }
}

function fpPointsFromPairs(times, closes){
  var out = [];
  if(!times || !closes) return out;
  var n = Math.min(times.length, closes.length);
  var i;
  for(i = 0; i < n; i++){
    var t = Number(times[i]);
    var c = Number(closes[i]);
    if(!isFinite(t) || !isFinite(c) || c <= 0) continue;
    out.push({ t: t, c: c });
  }
  out.sort(function(a, b){ return a.t - b.t; });
  var dedup = [];
  for(i = 0; i < out.length; i++){
    if(dedup.length && dedup[dedup.length - 1].t === out[i].t) dedup[dedup.length - 1] = out[i];
    else dedup.push(out[i]);
  }
  return dedup;
}

function fpClipSeries(points, days, nowSec){
  var req = fpChartRequest(days);
  var now = Number(nowSec);
  if(!isFinite(now)) now = Math.floor(Date.now() / 1000);
  var end = now + 180;
  var fetchFrom = end - req.days * 86400 - 180;
  var rows = [];
  var i;
  for(i = 0; i < (points ? points.length : 0); i++){
    var p = points[i];
    if(!p || !isFinite(p.t) || !isFinite(p.c) || p.c <= 0) continue;
    if(p.t < fetchFrom || p.t > end) continue;
    rows.push({ t: p.t, c: p.c });
  }
  rows.sort(function(a, b){ return a.t - b.t; });
  if(req.lastSession){
    var last = '';
    for(i = 0; i < rows.length; i++){
      var key = fpEtDateKey(rows[i].t);
      if(key) last = key;
    }
    if(last){
      var session = [];
      for(i = 0; i < rows.length; i++){
        if(fpEtDateKey(rows[i].t) === last) session.push(rows[i]);
      }
      return session;
    }
  } else {
    var from = end - req.displayDays * 86400 - 180;
    var windowed = [];
    for(i = 0; i < rows.length; i++){
      if(rows[i].t >= from) windowed.push(rows[i]);
    }
    return windowed;
  }
  return rows;
}

// Current share counts priced along each holding's closes. A holding with no
// usable series is listed in missing instead of being treated as $0.
function fpCombineHoldings(seriesList){
  var missing = [];
  var usable = [];
  var i, j;
  for(i = 0; i < (seriesList ? seriesList.length : 0); i++){
    var row = seriesList[i] || {};
    var shares = Number(row.shares);
    var points = (row.points || []).slice().sort(function(a, b){ return a.t - b.t; });
    var clean = [];
    for(j = 0; j < points.length; j++){
      if(points[j] && isFinite(points[j].t) && isFinite(points[j].c) && points[j].c > 0) clean.push(points[j]);
    }
    if(clean.length < 2 || !isFinite(shares) || shares <= 0){
      missing.push(row.ticker || '');
      continue;
    }
    usable.push({ ticker: row.ticker, shares: shares, points: clean });
  }
  if(!usable.length) return { points: [], missing: missing };
  var seen = {};
  var times = [];
  for(i = 0; i < usable.length; i++){
    for(j = 0; j < usable[i].points.length; j++){
      var ts = usable[i].points[j].t;
      if(!seen[ts]){ seen[ts] = 1; times.push(ts); }
    }
  }
  times.sort(function(a, b){ return a - b; });
  var idx = [];
  var last = [];
  for(i = 0; i < usable.length; i++){ idx.push(0); last.push(null); }
  var out = [];
  for(j = 0; j < times.length; j++){
    var t = times[j];
    var ok = true;
    var sum = 0;
    for(i = 0; i < usable.length; i++){
      var pts = usable[i].points;
      while(idx[i] < pts.length && pts[idx[i]].t <= t){
        last[i] = pts[idx[i]].c;
        idx[i]++;
      }
      if(last[i] == null){ ok = false; break; }
      sum += last[i] * usable[i].shares;
    }
    if(ok && isFinite(sum)) out.push({ t: t, v: sum });
  }
  return { points: out, missing: missing };
}

function fpChartLabel(unix, days){
  var req = fpChartRequest(days);
  var d = new Date(Number(unix) * 1000);
  if(!isFinite(d.getTime())) return '';
  try{
    if(req.cacheDays <= 1){
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
    }
    if(req.cacheDays <= 7){
      return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', timeZone: 'America/New_York' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  }catch(e){
    return '';
  }
}

function fpCacheKey(ticker, days){
  return String(ticker || '').toUpperCase() + '|' + fpChartRequest(days).cacheDays;
}

function fpReadStore(storage){
  if(!storage) return {};
  try{
    var raw = storage.getItem(FP_CANDLE_CACHE_KEY);
    var parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  }catch(e){
    return {};
  }
}

function fpWriteStore(storage, store){
  if(!storage) return;
  try{ storage.setItem(FP_CANDLE_CACHE_KEY, JSON.stringify(store)); }catch(e){}
}

function fpReadCandleCache(storage, ticker, days){
  var store = fpReadStore(storage);
  var row = store[fpCacheKey(ticker, days)];
  if(!row || !row.t || !row.c) return null;
  var points = fpPointsFromPairs(row.t, row.c);
  if(points.length < 2) return null;
  return { points: points, saved: Number(row.saved) || 0 };
}

function fpWriteCandleCache(storage, ticker, days, points, nowMs){
  if(!storage || !points || points.length < 2) return;
  var store = fpReadStore(storage);
  var trimmed = points.length > 500 ? points.slice(points.length - 500) : points;
  store[fpCacheKey(ticker, days)] = {
    t: trimmed.map(function(p){ return p.t; }),
    c: trimmed.map(function(p){ return p.c; }),
    saved: isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
  };
  var keys = Object.keys(store);
  if(keys.length > FP_CANDLE_CACHE_MAX){
    keys.sort(function(a, b){ return (store[a].saved || 0) - (store[b].saved || 0); });
    var drop = keys.length - FP_CANDLE_CACHE_MAX;
    var k;
    for(k = 0; k < drop; k++) delete store[keys[k]];
  }
  fpWriteStore(storage, store);
}

function fpCandleStatus(opts){
  opts = opts || {};
  if(opts.empty){
    return { mode: 'empty', text: 'Add a stock to see how the total moves over time.', retry: false };
  }
  if(opts.loading){
    return { mode: 'loading', text: 'Loading price history…', retry: false };
  }
  var missing = [];
  if(opts.missing && opts.missing.length){
    var i;
    for(i = 0; i < opts.missing.length; i++){
      if(opts.missing[i]) missing.push(opts.missing[i]);
    }
  }
  if(opts.failed){
    var text;
    if(opts.detail){
      text = opts.plan
        ? 'Historical prices aren’t included in the current market-data plan, and the backup feed didn’t respond. The quote above is still live.'
        : 'This price history didn’t load. The quote above is still live.';
    } else if(opts.plan){
      text = 'Historical prices aren’t included in the current market-data plan, and the backup feed didn’t respond. The total above is still live.';
    } else {
      text = 'Historical prices didn’t load. The total above is still using live quotes.';
    }
    return { mode: 'error', text: text, retry: true };
  }
  var bits = [];
  if(opts.stale) bits.push('Showing saved history from this device. Live totals above are current.');
  if(missing.length) bits.push('Left out ' + missing.join(', ') + ' — history for those holdings didn’t load, so the line is the rest.');
  return { mode: 'ok', text: bits.join(' '), retry: !!(opts.stale || missing.length) };
}

var fpCandleApi = {
  fpChartRequest: fpChartRequest,
  fpCandleFreshMs: fpCandleFreshMs,
  fpEtDateKey: fpEtDateKey,
  fpPointsFromPairs: fpPointsFromPairs,
  fpClipSeries: fpClipSeries,
  fpCombineHoldings: fpCombineHoldings,
  fpChartLabel: fpChartLabel,
  fpReadCandleCache: fpReadCandleCache,
  fpWriteCandleCache: fpWriteCandleCache,
  fpCandleStatus: fpCandleStatus
};
try{
  if(typeof module !== 'undefined' && module && module.exports) module.exports = fpCandleApi;
}catch(e){}
