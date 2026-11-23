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

test('service worker cache is finpath-v53', function(){
  assert.match(sw, /const CACHE = 'finpath-v53'/);
  assert.doesNotMatch(sw, /finpath-v52/);
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
