import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const quotes = createRequire(import.meta.url)('./quotes.js');
const {
  fpNormalizeTicker, fpQuoteAsOfLabel, fpQuoteIsFresh, fpQuoteIsRecent, fpCreateQuoteBook,
  FP_QUOTE_FRESH_MS, FP_QUOTE_RECENT_MS, FP_QUOTE_CHUNK, FP_FALLBACK_BACKOFF_MS
} = quotes;

function clockAt(start){
  const state = { now: start, queue: [] };
  return {
    now: function(){ return state.now; },
    advance: function(ms){ state.now += ms; },
    schedule: function(fn){ state.queue.push(fn); return state.queue.length; },
    clear: function(){},
    flush: function(){
      const fn = state.queue.shift();
      if(fn) fn();
    },
    pending: function(){ return state.queue.length; }
  };
}

function harness(overrides){
  const cache = {};
  const calls = [];
  const fallbacks = [];
  const statuses = [];
  const clock = clockAt(1_000_000);
  let batchImpl = async function(symbols){
    calls.push(symbols.slice());
    const out = {};
    symbols.forEach(function(t){ out[t] = { c: 100 + t.length, d: 1, dp: 1, pc: 99 }; });
    return { quotes: out, errors: {} };
  };
  let fallbackImpl = async function(t){
    fallbacks.push(t);
    return { c: 50, d: 0, dp: 0, pc: 50, o: 49 };
  };
  const book = fpCreateQuoteBook({
    now: clock.now,
    schedule: clock.schedule,
    clear: clock.clear,
    readCache: function(t){ return cache[t] || null; },
    writeCache: function(t, q){ cache[t] = q; },
    cacheSymbols: function(){ return Object.keys(cache); },
    fetchBatch: function(symbols){ return batchImpl(symbols); },
    fetchFallback: function(t){ return fallbackImpl(t); },
    onStatus: function(s){ statuses.push({ show: s.show, reason: s.reason }); },
    batchMs: 30
  });
  const api = {
    book: book,
    cache: cache,
    calls: calls,
    fallbacks: fallbacks,
    statuses: statuses,
    clock: clock,
    setBatch: function(fn){ batchImpl = fn; },
    setFallback: function(fn){ fallbackImpl = fn; }
  };
  if(overrides && overrides.ready) overrides.ready(api);
  return api;
}

async function load(h, symbols, opts){
  const before = h.calls.length;
  const pending = symbols.map(function(t){ return h.book.fetchQ(t, opts); });
  assert.equal(h.calls.length, before);
  h.clock.flush();
  return Promise.all(pending);
}

test('as-of labels and fresh versus recent windows', function(){
  assert.equal(fpQuoteAsOfLabel(1000, 1000 + 12000), 'as of 12s ago');
  assert.equal(fpQuoteAsOfLabel(1000, 1000 + 4 * 60000), 'as of 4m ago');
  assert.equal(fpQuoteAsOfLabel(1000, 1000 + 2 * 3600000), 'as of 2h ago');
  assert.equal(fpQuoteAsOfLabel(1000, 1000 + 3 * 86400000), 'as of 3d ago');
  assert.equal(fpQuoteAsOfLabel(5000, 1000), '');
  const fresh = { c: 10, ts: 1000 };
  assert.equal(fpQuoteIsFresh(fresh, 1000 + FP_QUOTE_FRESH_MS - 1), true);
  assert.equal(fpQuoteIsFresh(fresh, 1000 + FP_QUOTE_FRESH_MS), false);
  assert.equal(fpQuoteIsRecent(fresh, 1000 + FP_QUOTE_RECENT_MS - 1), true);
  assert.equal(fpQuoteIsRecent(fresh, 1000 + FP_QUOTE_RECENT_MS), false);
  assert.equal(fpNormalizeTicker(' brk.b '), 'BRK.B');
  assert.equal(fpNormalizeTicker('../etc'), '');
});

test('symbols requested together become one batch and a fresh cache skips the network', async function(){
  const h = harness();
  const got = await load(h, ['MSFT', 'AAPL', 'AAPL']);
  assert.deepEqual(h.calls, [['AAPL', 'MSFT']]);
  assert.equal(h.fallbacks.length, 0);
  assert.equal(got[0].c, 104);
  assert.equal(got[1].c, got[2].c);
  assert.equal(got[0].stale, false);
  assert.deepEqual(h.statuses, []);

  h.clock.advance(5000);
  const again = h.book.fetchQ('AAPL');
  assert.equal(h.clock.pending(), 0);
  assert.equal((await again).c, 104);
  assert.equal(h.calls.length, 1);
});

test('a missed batch uses Finnhub with a concurrency cap and backs off', async function(){
  const h = harness();
  let open = 0;
  let maxOpen = 0;
  let release;
  const gate = new Promise(function(resolve){ release = resolve; });
  h.setBatch(async function(){ throw new Error('down'); });
  h.setFallback(function(t){
    open++;
    maxOpen = Math.max(maxOpen, open);
    h.fallbacks.push(t);
    return gate.then(function(){
      open--;
      return { error: 'limit' };
    });
  });
  const symbols = ['AAPL', 'MSFT', 'NVDA', 'KO', 'JPM'];
  const pending = symbols.map(function(t){ return h.book.fetchQ(t); });
  h.clock.flush();
  for(let spin = 0; spin < 12 && h.fallbacks.length < 2; spin++) await Promise.resolve();
  assert.equal(h.fallbacks.length, 2);
  assert.equal(maxOpen, 2);
  release();
  const got = await Promise.all(pending);
  assert.equal(h.fallbacks.length, 2);
  assert.ok(got.every(function(q){ return q == null; }));
  assert.equal(h.statuses.length, 1);
  assert.equal(h.statuses[0].show, true);
  assert.equal(h.statuses[0].reason, 'limit');

  h.clock.advance(1000);
  const during = h.book.fetchQ('AAPL');
  h.clock.flush();
  assert.equal(await during, null);
  assert.equal(h.fallbacks.length, 2);

  h.clock.advance(FP_FALLBACK_BACKOFF_MS);
  h.setFallback(async function(t){
    h.fallbacks.push(t);
    return { c: 12, d: -1, dp: -1, pc: 13 };
  });
  const after = h.book.fetchQ('AAPL');
  h.clock.flush();
  const live = await after;
  assert.equal(live.c, 12);
  assert.equal(live.stale, false);
  assert.equal(h.statuses[h.statuses.length - 1].show, false);
});

test('a recent cached price hides the banner and is labeled stale', async function(){
  const h = harness();
  h.cache.SPY = { c: 400, d: 2, dp: 0.5, pc: 398, ts: h.clock.now() - 60 * 1000 };
  h.setBatch(async function(){ return { quotes: {}, errors: { SPY: 'busy' } }; });
  h.setFallback(async function(){ return { error: 'limit' }; });
  const q = (await load(h, ['SPY']))[0];
  assert.equal(q.c, 400);
  assert.equal(q.stale, true);
  assert.equal(q.pc, 398);
  assert.equal(h.cache.SPY.stale, undefined);
  assert.equal(fpQuoteAsOfLabel(q.ts, h.clock.now()), 'as of 1m ago');
  assert.deepEqual(h.statuses, []);
});

test('an old cache still shows the price and raises the banner when every source fails', async function(){
  const h = harness();
  h.cache.AAPL = { c: 10, d: 0, dp: 0, ts: h.clock.now() - FP_QUOTE_RECENT_MS - 1000 };
  h.setBatch(async function(){ throw new Error('down'); });
  h.setFallback(async function(){ return { error: 'fail' }; });
  const q = (await load(h, ['AAPL']))[0];
  assert.equal(q.stale, true);
  assert.equal(q.c, 10);
  assert.equal(h.statuses[0].show, true);
  assert.equal(h.statuses[0].reason, 'outage');
});

test('a dead fallback key is not hammered, and one live symbol clears the banner', async function(){
  const h = harness();
  h.setBatch(async function(symbols){
    h.calls.push(symbols.slice());
    if(symbols.indexOf('AAPL') !== -1 && symbols.length === 1) throw new Error('down');
    const quotes = {};
    symbols.forEach(function(t){ quotes[t] = { c: 8, d: 0, dp: 0, pc: 8 }; });
    return { quotes: quotes };
  });
  h.setFallback(async function(t){
    h.fallbacks.push(t);
    return { error: 'dead' };
  });
  const first = (await load(h, ['AAPL']))[0];
  assert.equal(first, null);
  assert.deepEqual(h.fallbacks, ['AAPL']);
  assert.equal(h.statuses[0].reason, 'dead');

  const rows = await load(h, ['AAPL', 'MSFT']);
  assert.equal(h.fallbacks.length, 1);
  assert.equal(rows[1].c, 8);
  assert.equal(h.statuses[h.statuses.length - 1].show, false);

  h.setBatch(async function(){ throw new Error('down'); });
  const skipped = h.book.fetchQ('NVDA');
  h.clock.flush();
  assert.equal(await skipped, null);
  assert.equal(h.fallbacks.length, 1);
});

test('more than one chunk is still a single banner decision', async function(){
  const h = harness();
  const symbols = [];
  let i;
  for(i = 0; i < FP_QUOTE_CHUNK + 1; i++){
    symbols.push(String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
  }
  await load(h, symbols);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].length, FP_QUOTE_CHUNK);
  assert.equal(h.calls[1].length, 1);
  assert.equal(h.statuses.length, 0);
});

test('a forced refresh bypasses a fresh cache and keeps the old price if the network fails', async function(){
  const h = harness();
  await load(h, ['KO']);
  assert.equal(h.calls.length, 1);
  h.setBatch(async function(){ throw new Error('down'); });
  h.setFallback(async function(){ return { error: 'limit' }; });
  const forced = h.book.fetchQ('KO', { force: true });
  h.clock.flush();
  const q = await forced;
  assert.equal(q.stale, true);
  assert.ok(q.c > 0);
  assert.equal(h.statuses.length, 0);
});

test('the page, service worker, and function auth match the shared quote path', function(){
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const cfg = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(sw, /finpath-v37/);
  assert.doesNotMatch(sw, /finpath-v36/);
  assert.match(sw, /js\/market\/quotes\.js/);
  assert.match(html, /js\/market\/quotes\.js/);
  assert.match(html, /market-quotes/);
  assert.match(html, /fpCreateQuoteBook/);
  assert.match(html, /fetchFinnhubQuote/);
  assert.doesNotMatch(html, /quote\?symbol=SPY&token=/);
  assert.match(cfg, /\[functions\.market-quotes\][\s\S]*verify_jwt = false/);
  assert.match(cfg, /\[functions\.market-candles\][\s\S]*verify_jwt = false/);
});
