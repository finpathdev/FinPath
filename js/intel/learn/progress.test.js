import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conceptsFor, LESSON_CONCEPTS, CONCEPTS } from './concepts.js';

test('every tagged lesson points at known concepts', function(){
  Object.keys(LESSON_CONCEPTS).forEach(function(slug){
    const ids = conceptsFor(slug);
    assert.ok(ids.length > 0, slug);
    ids.forEach(function(id){ assert.ok(CONCEPTS[id], slug + ' ' + id); });
  });
  assert.equal(Object.keys(LESSON_CONCEPTS).length, 34);
});

import { readFileSync } from 'node:fs';
import { lessonProgressMap, lessonStoreFromProgress, countCompleted } from './progress.js';

test('slug progress counts only known lessons and rewrites old index keys', function(){
  const ids = ['schools-skipped', null, 'compound-interest', 'taxes'];
  const got = lessonProgressMap({ _v: 0, '0': 100, '2': 200, '99': 300, taxes: 400 }, ids);
  assert.equal(got.rewrite, true);
  assert.equal(got.progress['schools-skipped'], 100);
  assert.equal(got.progress['compound-interest'], 200);
  assert.equal(got.progress.taxes, 400);
  assert.equal(countCompleted(got.progress, ids.filter(Boolean)), 3);
  const store = lessonStoreFromProgress(got.progress);
  assert.equal(store._v, 1);
  assert.equal(store[0], undefined);
});

test('index.html keeps login and lesson completion consistent for every user', function(){
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /finpath-v44/);
  assert.doesNotMatch(html, /STRIPE_PK|STRIPE_PRICE/);
  assert.match(html, /persistSession:\s*true/);
  assert.match(html, /autoRefreshToken:\s*true/);
  assert.match(html, /detectSessionInUrl:\s*true/);
  assert.match(html, /flowType:\s*'pkce'/);
  assert.match(html, /window\.currentUser = currentUser/);
  assert.match(html, /window\.supabaseClient = supabaseClient/);
  assert.match(html, /function isAuthCallbackHash/);
  assert.match(html, /function catalogDoneCount/);
  assert.match(html, /function coreDoneCount/);
  assert.match(html, /isLessonDone\(p, i\)/);
  assert.doesNotMatch(html, /l\.plan === 'free' && p\[i\]/);
  assert.match(html, /emailRedirectTo: 'https:\/\/finpathdev\.github\.io\/FinPath\/'/);
  assert.match(html, /fp_lessons_pre_demo/);
  assert.doesNotMatch(html, /plausible\.io\/js|gtag\(|googletagmanager|mixpanel|analytics\.js/);
  const countFree = (html.match(/plan:"free"/g) || []).length;
  const countGold = (html.match(/plan:"gold"/g) || []).length;
  assert.equal(countFree, 20);
  assert.ok(countGold >= 14 && countGold <= 15, 'gold labels ' + countGold);
  assert.match(html, /plan:"gold" is a curriculum label/);
  assert.match(html, /all 20 core lessons/);
});
