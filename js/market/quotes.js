// Live-quote batching, cache, and fallback decisions. No network and no DOM.
// The page loads this file as a classic script. Node tests require() it.
//
// Fresh (15s): serve the saved price and do not call the network.
// Recent (5 min): a failed refresh stays quiet and the page shows "as of".
// Older than that, with every source failed: the page may show the rate-limit banner.

var FP_QUOTE_FRESH_MS = 15000;
var FP_QUOTE_RECENT_MS = 5 * 60 * 1000;
var FP_QUOTE_BATCH_MS = 30;
var FP_QUOTE_CHUNK = 40;
var FP_FALLBACK_LIMIT = 2;
var FP_FALLBACK_BACKOFF_MS = 20000;
var FP_FALLBACK_BACKOFF_MAX = 120000;
var FP_TICKER = /^[A-Z][A-Z.\-]{0,9}$/;

function fpNormalizeTicker(t){
  var s = String(t == null ? '' : t).trim().toUpperCase();
  if(!FP_TICKER.test(s)) return '';
  return s;
}

function fpNormalizeQuote(raw, now){
  if(!raw || typeof raw.c !== 'number' || !isFinite(raw.c) || raw.c <= 0) return null;
  var q = { c: raw.c, ts: now, stale: false };
  if(typeof raw.d === 'number' && isFinite(raw.d)) q.d = raw.d;
  if(typeof raw.dp === 'number' && isFinite(raw.dp)) q.dp = raw.dp;
  if(typeof raw.o === 'number' && isFinite(raw.o) && raw.o > 0) q.o = raw.o;
  if(typeof raw.pc === 'number' && isFinite(raw.pc) && raw.pc > 0) q.pc = raw.pc;
  return q;
}

function fpQuoteIsFresh(q, now){
  if(!q || typeof q.c !== 'number' || !(q.c > 0) || !isFinite(q.ts) || !isFinite(now)) return false;
  var age = now - q.ts;
  return age >= 0 && age < FP_QUOTE_FRESH_MS;
}

function fpQuoteIsRecent(q, now){
  if(!q || typeof q.c !== 'number' || !(q.c > 0) || !isFinite(q.ts) || !isFinite(now)) return false;
  var age = now - q.ts;
  return age >= 0 && age < FP_QUOTE_RECENT_MS;
}

function fpQuoteAsOfLabel(ts, now){
  var age = Number(now) - Number(ts);
  if(!isFinite(age) || age < 0) return '';
  if(age < 60000) return 'as of ' + Math.max(1, Math.round(age / 1000)) + 's ago';
  if(age < 3600000) return 'as of ' + Math.max(1, Math.round(age / 60000)) + 'm ago';
  if(age < 86400000) return 'as of ' + Math.max(1, Math.round(age / 3600000)) + 'h ago';
  return 'as of ' + Math.max(1, Math.round(age / 86400000)) + 'd ago';
}

function fpStaleQuote(q){
  var copy = {};
  var k;
  for(k in q){
    if(Object.prototype.hasOwnProperty.call(q, k)) copy[k] = q[k];
  }
  copy.stale = true;
  return copy;
}

function fpCreateQuoteBook(deps){
  var waiters = [];
  var inflight = {};
  var timer = null;
  var deadKey = false;
  var cooldownUntil = 0;
  var backoffMs = FP_FALLBACK_BACKOFF_MS;
  var status = { show: false, reason: '' };

  function publish(next){
    var reason = next.reason || '';
    if(next.show === status.show && reason === status.reason) return;
    status = { show: !!next.show, reason: reason };
    if(deps.onStatus) deps.onStatus(status);
  }

  function hasRecent(now){
    var keys = deps.cacheSymbols ? deps.cacheSymbols() : [];
    var i;
    for(i = 0; i < keys.length; i++){
      if(fpQuoteIsRecent(deps.readCache(keys[i]), now)) return true;
    }
    return false;
  }

  function consider(rows){
    if(!rows || !rows.length) return;
    var i;
    for(i = 0; i < rows.length; i++){
      if(rows[i].live){
        publish({ show: false, reason: '' });
        return;
      }
    }
    if(hasRecent(deps.now())){
      publish({ show: false, reason: '' });
      return;
    }
    var limit = false;
    var dead = false;
    for(i = 0; i < rows.length; i++){
      if(rows[i].limit) limit = true;
      if(rows[i].dead) dead = true;
    }
    publish({ show: true, reason: limit ? 'limit' : (dead ? 'dead' : 'outage') });
  }

  function armCooldown(){
    var now = deps.now();
    if(now < cooldownUntil) return;
    cooldownUntil = now + backoffMs;
    backoffMs = Math.min(FP_FALLBACK_BACKOFF_MAX, backoffMs * 2);
  }

  function fallbackSymbol(symbol){
    if(deadKey) return Promise.resolve({ error: 'dead' });
    if(deps.now() < cooldownUntil) return Promise.resolve({ error: 'limit' });
    return Promise.resolve(deps.fetchFallback(symbol)).then(function(res){
      if(res && typeof res.c === 'number' && res.c > 0){
        cooldownUntil = 0;
        backoffMs = FP_FALLBACK_BACKOFF_MS;
        return res;
      }
      if(res && res.error === 'dead') deadKey = true;
      else if(res && res.error === 'limit') armCooldown();
      return res && res.error ? res : { error: 'fail' };
    }, function(){
      return { error: 'fail' };
    });
  }

  function mapLimit(items, limit, fn){
    var results = new Array(items.length);
    var cursor = 0;
    var active = 0;
    return new Promise(function(resolve){
      if(!items.length){ resolve(results); return; }
      function pump(){
        if(cursor >= items.length && active === 0){ resolve(results); return; }
        while(active < limit && cursor < items.length){
          (function(idx){
            var item = items[idx];
            active++;
            Promise.resolve(fn(item)).then(function(res){
              results[idx] = res;
              active--;
              pump();
            }, function(){
              results[idx] = { error: 'fail' };
              active--;
              pump();
            });
          })(cursor);
          cursor++;
        }
      }
      pump();
    });
  }

  function settle(jobs, value){
    var i;
    for(i = 0; i < jobs.length; i++) jobs[i].resolve(value);
  }

  function assignment(jobs, value, row){
    return { jobs: jobs, value: value, row: row };
  }

  function distribute(symbols, byTicker, body){
    var quotes = (body && body.quotes) || {};
    var planned = [];
    var missing = [];
    var now = deps.now();
    var i;
    for(i = 0; i < symbols.length; i++){
      var t = symbols[i];
      var live = fpNormalizeQuote(quotes[t], now);
      if(live){
        deps.writeCache(t, live);
        planned.push(assignment(byTicker[t], live, { live: true, recent: true, limit: false, dead: false }));
      } else {
        missing.push(t);
      }
    }
    if(!missing.length) return Promise.resolve(planned);
    return mapLimit(missing, FP_FALLBACK_LIMIT, fallbackSymbol).then(function(results){
      var j;
      for(j = 0; j < missing.length; j++){
        var ticker = missing[j];
        var res = results[j];
        var now2 = deps.now();
        var fresh = fpNormalizeQuote(res, now2);
        if(fresh){
          deps.writeCache(ticker, fresh);
          planned.push(assignment(byTicker[ticker], fresh, { live: true, recent: true, limit: false, dead: false }));
          continue;
        }
        var cached = deps.readCache(ticker);
        planned.push(assignment(byTicker[ticker], cached ? fpStaleQuote(cached) : null, {
          live: false,
          recent: fpQuoteIsRecent(cached, now2),
          limit: !!(res && res.error === 'limit'),
          dead: !!(res && res.error === 'dead')
        }));
      }
      return planned;
    });
  }

  function resolveChunk(symbols, byTicker){
    return Promise.resolve().then(function(){
      return deps.fetchBatch(symbols);
    }).then(function(body){
      return distribute(symbols, byTicker, body || {});
    }, function(){
      return distribute(symbols, byTicker, { quotes: {} });
    });
  }

  function flush(){
    timer = null;
    var jobs = waiters.splice(0, waiters.length);
    if(!jobs.length) return;
    var byTicker = {};
    var i;
    for(i = 0; i < jobs.length; i++){
      var t = jobs[i].t;
      if(!byTicker[t]) byTicker[t] = [];
      byTicker[t].push(jobs[i]);
    }
    var symbols = Object.keys(byTicker).sort();
    var chunks = [];
    for(i = 0; i < symbols.length; i += FP_QUOTE_CHUNK) chunks.push(symbols.slice(i, i + FP_QUOTE_CHUNK));
    Promise.all(chunks.map(function(chunk){ return resolveChunk(chunk, byTicker); })).then(function(parts){
      var rows = [];
      var planned = [];
      var p, r;
      for(p = 0; p < parts.length; p++){
        for(r = 0; r < parts[p].length; r++){
          planned.push(parts[p][r]);
          rows.push(parts[p][r].row);
        }
      }
      consider(rows);
      for(r = 0; r < planned.length; r++) settle(planned[r].jobs, planned[r].value);
    }).catch(function(){
      var keys = Object.keys(byTicker);
      var n;
      for(n = 0; n < keys.length; n++) settle(byTicker[keys[n]], null);
    });
  }

  function fetchQ(ticker, opts){
    var t = fpNormalizeTicker(ticker);
    if(!t) return Promise.resolve(null);
    var now = deps.now();
    var cached = deps.readCache(t);
    var force = !!(opts && opts.force);
    if(!force && fpQuoteIsFresh(cached, now)) return Promise.resolve(cached);
    if(inflight[t]) return inflight[t];
    var promise = new Promise(function(resolve){
      waiters.push({ t: t, resolve: resolve });
      if(!timer){
        var wait = deps.batchMs != null ? deps.batchMs : FP_QUOTE_BATCH_MS;
        timer = deps.schedule(flush, wait);
      }
    });
    inflight[t] = promise;
    promise.then(function(){
      if(inflight[t] === promise) delete inflight[t];
    }, function(){
      if(inflight[t] === promise) delete inflight[t];
    });
    return promise;
  }

  return {
    fetchQ: fetchQ,
    status: function(){ return { show: status.show, reason: status.reason }; }
  };
}

var fpQuoteApi = {
  FP_QUOTE_FRESH_MS: FP_QUOTE_FRESH_MS,
  FP_QUOTE_RECENT_MS: FP_QUOTE_RECENT_MS,
  FP_QUOTE_CHUNK: FP_QUOTE_CHUNK,
  FP_FALLBACK_LIMIT: FP_FALLBACK_LIMIT,
  FP_FALLBACK_BACKOFF_MS: FP_FALLBACK_BACKOFF_MS,
  fpNormalizeTicker: fpNormalizeTicker,
  fpNormalizeQuote: fpNormalizeQuote,
  fpQuoteIsFresh: fpQuoteIsFresh,
  fpQuoteIsRecent: fpQuoteIsRecent,
  fpQuoteAsOfLabel: fpQuoteAsOfLabel,
  fpCreateQuoteBook: fpCreateQuoteBook
};
try{
  if(typeof module !== 'undefined' && module && module.exports) module.exports = fpQuoteApi;
}catch(e){}
