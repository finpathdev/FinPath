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

test('service worker cache is finpath-v54', function(){
  assert.match(sw, /const CACHE = 'finpath-v54'/);
  assert.doesNotMatch(sw, /finpath-v53/);
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
