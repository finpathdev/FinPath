import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { deflate, fvMonthly } from '../life/engine.js';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
const portfolioSql = readFileSync(new URL('../../../supabase/migrations/20261123222552_close_portfolio_public_policy.sql', import.meta.url), 'utf8');

function grab(source, name){
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start > -1, name);
  let i = source.indexOf('{', start);
  let depth = 0;
  for(; i < source.length; i++){
    if(source[i] === '{') depth++;
    else if(source[i] === '}'){
      depth--;
      if(depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

test('service worker cache is finpath-v56', function(){
  assert.match(sw, /const CACHE = 'finpath-v56'/);
  assert.doesNotMatch(sw, /finpath-v55/);
});

test('playground deflates the ending balance instead of rerunning the annuity at rate minus 3', function(){
  const fn = grab(html, 'runBacktest');
  assert.match(fn, /FPLife\.deflate\(fv,\s*0\.03,\s*years\)/);
  assert.doesNotMatch(fn, /rate\s*-\s*3/);
  const fv = fvMonthly(200, 8, 30);
  const wrong = fvMonthly(200, 5, 30);
  const today = deflate(fv, 0.03, 30);
  assert.ok(Math.abs(today - wrong) > 10000, today + ' vs ' + wrong);
  const cash = fvMonthly(200, 0, 30);
  assert.ok(Math.abs(deflate(cash, 0.03, 30) - fvMonthly(200, -3, 30)) > 1000);
});

test('a goal deadline is the local end of that calendar day', function(){
  const fn = grab(html, 'goalDeadlineMs');
  const goalDeadlineMs = vm.runInNewContext(fn + '\ngoalDeadlineMs');
  const end = goalDeadlineMs('2026-12-01');
  const local = new Date(2026, 11, 1, 23, 59, 59, 999).getTime();
  assert.equal(end, local);
  assert.ok(end > Date.parse('2026-12-01'));
  assert.ok(Number.isNaN(goalDeadlineMs('tomorrow')));
});

test('finance IQ ignores a broken saved score instead of showing NaN or null', function(){
  const fn = grab(html, 'financeIQ');
  const saved = {
    'How Credit Scores Work': { c: 2, t: 3 },
    bad: 'x',
    empty: null
  };
  const financeIQ = vm.runInNewContext(
    'function getQuizScore(){ return saved; }\n' + fn + '\nfinanceIQ',
    { saved: saved, Number: Number, isFinite: isFinite, Object: Object }
  );
  assert.equal(financeIQ(), 67);
  const box = html.slice(html.indexOf('Your overall Finance IQ'), html.indexOf('Your overall Finance IQ') + 280);
  assert.match(box, /iq == null \? '\\u2014'/);
  assert.doesNotMatch(box, /financeIQ\(\) \+ '%'/);
});

test('a second tap cannot file the same paper or live buy twice', function(){
  const fn = grab(html, 'confirmAdd');
  assert.match(fn, /if\(ADDING\) return/);
  assert.match(fn, /ADDING = true/);
  assert.match(html, /let ADDING = false/);
});

test('a slow quote cannot price the stock opened after it', function(){
  const add = grab(html, 'openAddShares');
  const detail = grab(html, 'openDetail');
  assert.match(add, /selectedStock\.ticker !== ticker\) return/);
  assert.match(detail, /selectedStock\.ticker !== ticker\) return/);
});

test('a slower portfolio or paper render cannot paint over a newer one', function(){
  assert.match(grab(html, 'renderPortfolio'), /gen !== _portfolioRenderGen\) return/);
  assert.match(grab(html, 'renderPaper'), /gen !== _paperRenderGen\) return/);
  const paper = grab(html, 'renderPaper');
  assert.match(paper, /r\.x\.price > 0 && isFinite\(price\)/);
});

test('the portfolio public policy is dropped and the anon key loses table grants', function(){
  assert.match(portfolioSql, /drop policy if exists "Users can manage their own portfolio"/);
  assert.match(portfolioSql, /revoke all on table public\.portfolio from anon/);
  assert.match(portfolioSql, /revoke execute on function public\.handle_new_user\(\)/);
  assert.match(portfolioSql, /revoke execute on function public\.rls_auto_enable\(\)/);
  assert.doesNotMatch(html, /fixes this in one purchase/);
});

function grabConst(source, name, open, close){
  const start = source.indexOf('const ' + name + ' =') > -1 ? source.indexOf('const ' + name + ' =') : source.indexOf('const ' + name + '=');
  assert.ok(start > -1, name);
  let i = source.indexOf(open, start);
  let depth = 0;
  for(; i < source.length; i++){
    if(source[i] === open) depth++;
    else if(source[i] === close){
      depth--;
      if(depth === 0) return source.slice(source.indexOf(open, start), i + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

const LESSONS = vm.runInNewContext('(' + grabConst(html, 'LESSONS', '[', ']') + ')');
const QUIZZES = vm.runInNewContext('(' + grabConst(html, 'QUIZZES', '{', '}') + ')');
function lesson(name){
  const l = LESSONS.find(function(x){ return x && x.name === name; });
  assert.ok(l, name);
  return l;
}

test('crash lesson teaches steadiness instead of calling tops or buying dips', function(){
  const l = lesson('Understanding Economic Crashes');
  assert.doesNotMatch(l.desc, /see a market crash coming|benefit from it/);
  assert.doesNotMatch(l.content, /predictable pattern|price targets|at a discount|largest fortunes/);
  assert.match(l.content, /J\.P\. Morgan/);
  assert.match(l.content, /about 57%/);
  assert.match(l.content, /do not guarantee/);
});

test('international and long-term strategy lessons drop ticker picks and fixed allocations', function(){
  const intl = lesson('International Investing');
  const plan = lesson('Building a Long-Term Investment Strategy');
  for(const t of ['VEA', 'VWO', 'VXUS', 'VTI', 'BND']){
    assert.doesNotMatch(intl.content + plan.content, new RegExp('\\b' + t + '\\b'), t);
  }
  assert.doesNotMatch(intl.content, /SUGGESTED ALLOCATION|90% of their money/);
  assert.match(intl.content, /2010s/);
  assert.doesNotMatch(plan.content, /at 60%|at 30%|at 10%|drop 40%/);
  assert.match(plan.content, /rule of thumb/);
  assert.doesNotMatch(JSON.stringify(QUIZZES['International Investing']), /VEA/);
});

test('tax-loss harvesting states the two-sided wash-sale window and taxable-account scope', function(){
  const l = lesson('Tax-Loss Harvesting');
  assert.match(l.content, /30 days before or after/);
  assert.match(l.content, /61-day/);
  assert.match(l.content, /taxable brokerage account/);
  assert.match(l.content, /\$1,500 if married filing separately/);
  assert.match(l.content, /Publication 550/);
  const q = QUIZZES['Tax-Loss Harvesting'][2];
  assert.match(q.o[q.a], /before or after/);
});

test('every rewritten lesson keeps a three-question quiz with a valid answer index', function(){
  for(const name of ['Understanding Economic Crashes', 'International Investing', 'Building a Long-Term Investment Strategy', 'Tax-Loss Harvesting']){
    const qz = QUIZZES[name];
    assert.equal(qz.length, 3, name);
    for(const item of qz){
      assert.ok(item.a >= 0 && item.a < item.o.length, name);
      assert.ok(item.w.length > 20, name);
    }
  }
});

test('schools-never-teach lesson uses the same $200/month math as its quiz and drops the 7-streams claim', function(){
  const l = lesson('What Schools Never Teach You About Money');
  assert.doesNotMatch(l.content, /\$350,000|one bad month|The average millionaire has 7/);
  assert.match(l.content, /no solid data behind that number/);
  assert.match(l.content, /about \$1\.24 million/);
  assert.match(l.content, /about \$459,000/);
  assert.match(l.content, /never guaranteed/);
  assert.match(l.content, /0%, 15% or 20%/);
  const r = 0.08 / 12;
  const f = function(n){ return 200 * (Math.pow(1 + r, n) - 1) / r; };
  assert.ok(Math.abs(f(47 * 12) - 1242475) < 1000);
  assert.ok(Math.abs(f(35 * 12) - 458776) < 1000);
  const q = QUIZZES['What Schools Never Teach You About Money'][2];
  assert.match(q.o[q.a], /780k/);
});

test('income-streams lesson treats 7 streams as a myth and drops the dated 4-5% savings rate', function(){
  const l = lesson('How to Build Multiple Streams of Income');
  assert.doesNotMatch(l.content, /earning 4-5%|Start with \$500 in dividend stocks|earn forever/);
  assert.match(l.content, /no solid study/);
  assert.match(l.content, /Dividends are not guaranteed/);
  assert.match(l.content, /\$250,000 per depositor/);
  const qz = QUIZZES['How to Build Multiple Streams of Income'];
  assert.doesNotMatch(JSON.stringify(qz), /4–5% automatically|About seven/);
  assert.match(qz[0].o[qz[0].a], /no solid data/);
  assert.match(qz[2].o[qz[2].a], /changes over time/);
});

test('stock-market lesson explains index funds without a VOO buy prompt and qualifies the 10% history', function(){
  const l = lesson('How the Stock Market Actually Works');
  assert.doesNotMatch(l.content, /\bVOO\b|Buy VOO|Buy a little every month/);
  assert.match(l.content, /since 1926/);
  assert.match(l.content, /before inflation/);
  assert.match(l.content, /Trading Is Hazardous to Your Wealth/);
  assert.match(l.content, /does not recommend any specific fund/);
  const qz = QUIZZES['How the Stock Market Actually Works'];
  assert.match(qz[1].o[qz[1].a], /10%\/yr with dividends, before inflation/);
  assert.match(qz[2].o[qz[2].a], /Holds every company in an index/);
});

test('analyse-a-stock lesson is a research framework, not a buy signal', function(){
  const l = lesson('How to Analyse a Stock');
  assert.doesNotMatch(l.desc, /exact framework/);
  assert.doesNotMatch(l.content, /Before buying any stock|PEG ratio below 1 is generally undervalued|SET A TARGET PRICE|excited to pay/);
  for(const t of ['Apple', 'Coca-Cola', 'Visa', 'Meta', 'Amazon', 'Walmart', 'Microsoft']){
    assert.doesNotMatch(l.content, new RegExp('\\b' + t + '\\b'), t);
  }
  assert.match(l.content, /SPIVA/);
  assert.match(l.content, /EDGAR/);
  assert.match(l.content, /WRITE DOWN YOUR THESIS/);
  const qz = QUIZZES['How to Analyse a Stock'];
  assert.doesNotMatch(JSON.stringify(qz), /before buying any stock|buy it"\]/i);
  assert.match(qz[2].o[qz[2].a], /bargain or a business in trouble/);
});

test('v55 rewritten lessons keep three-question quizzes with valid answers and no buy prompts', function(){
  for(const name of ['What Schools Never Teach You About Money', 'How to Build Multiple Streams of Income', 'How the Stock Market Actually Works', 'How to Analyse a Stock']){
    const qz = QUIZZES[name];
    assert.equal(qz.length, 3, name);
    for(const item of qz){
      assert.ok(item.a >= 0 && item.a < item.o.length, name);
      assert.ok(item.w.length > 20, name);
      assert.doesNotMatch(item.o[item.a], /\bbuy\b/i, name);
    }
  }
});

test('the offline shell is scoped to app entry pages and its own cache', async function(){
  const listeners = {};
  const deleted = [];
  const saved = new Map();
  const scope = 'https://example.com/FinPath/';
  const cache = {
    put: async function(url, response){ saved.set(String(url), response); },
    match: async function(url){ return saved.get(String(url)); }
  };
  let offline = false;
  const shell = new Response('FinPath app', { headers: { 'content-type': 'text/html' } });
  vm.runInNewContext(sw, {
    URL, Response,
    self: {
      registration: { scope },
      clients: { claim: async function(){} },
      addEventListener: function(event, fn){ listeners[event] = fn; }
    },
    caches: {
      open: async function(){ return cache; },
      keys: async function(){ return ['finpath-v55', 'finpath-v56', 'another-app']; },
      delete: async function(key){ deleted.push(key); }
    },
    fetch: async function(){
      if(offline) throw new Error('offline');
      return shell;
    }
  });
  let activation;
  listeners.activate({ waitUntil: function(task){ activation = task; } });
  await activation;
  assert.deepEqual(deleted, ['finpath-v55']);

  function request(url, mode){
    let response;
    listeners.fetch({ request: { url, mode, method: 'GET' }, respondWith: function(task){ response = task; } });
    return response;
  }
  assert.equal(await request(scope + '?p=share', 'navigate'), shell);
  assert.equal(request(scope + 'unrelated.html', 'navigate'), undefined);
  assert.equal(request(scope + 'unlisted.json', 'cors'), undefined);
  assert.equal(request('https://api.example.com/quotes', 'cors'), undefined);
  offline = true;
  assert.equal(await (await request(scope, 'navigate')).text(), 'FinPath app');
});

test('intelligence sync keeps local changes made during the pull and a failed push', async function(){
  const source = readFileSync(new URL('../sync/boot.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function refreshLocal(){'), source.indexOf('function enqueue(){'));
  const ctx = { userId: 'learner' };
  let progress = [];
  let pulled;
  let status = '';
  let active = true;
  const sync = vm.runInNewContext(code + '\nsyncNow', {
    cloudCtx: function(){ return ctx; },
    sameAccount: function(){ return active; },
    collectLocal: function(){ return { progress }; },
    observeStudy: function(){},
    pullRemote: function(){ return new Promise(function(resolve){ pulled = resolve; }); },
    syncCollections: function(input){ return input; },
    applyMerged: function(local, plan){ progress = [...plan.local.progress, ...plan.remote.progress]; },
    pushBatches: async function(){
      progress = [...progress, 'during-push'];
      throw new Error('offline');
    },
    setStatus: function(text){ status = text; }
  });
  const run = sync();
  progress = ['during-pull'];
  pulled({ progress: ['cloud'] });
  await run;
  assert.deepEqual(progress, ['during-pull', 'cloud', 'during-push']);
  assert.match(status, /account didn’t update/);

  const switching = sync();
  active = false;
  pulled({ progress: ['previous-account'] });
  await switching;
  assert.deepEqual(progress, ['during-pull', 'cloud', 'during-push']);
});
