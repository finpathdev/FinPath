import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessonsByConcept, CONCEPTS } from './concepts.js';
import { conceptMastery } from './mastery.js';
import { buildStudyPlan, currentPlan, weekKey, planLimit, PLAN_MAX } from './plan.js';
import { profileById } from '../identity/profiles.js';

const banned = /you should|i recommend|buy this|sell your|borrow more|you need to/i;

test('week key changes on the Monday after Sunday 1 Nov 2026', function(){
  assert.notEqual(weekKey(new Date(2026, 10, 1)), weekKey(new Date(2026, 10, 2)));
  assert.equal(weekKey(new Date(2026, 10, 2)), weekKey(new Date(2026, 10, 8)));
});

test('short onboarding weeks stay under the handful cap', function(){
  assert.equal(planLimit('5'), 2);
  assert.equal(planLimit('15'), 3);
  assert.equal(planLimit('30'), PLAN_MAX);
  assert.equal(PLAN_MAX, 4);
});

test('plan prefers the profile focus and skips duplicate slugs', function(){
  const profile = profileById('debt_focused');
  const mastery = conceptMastery({}, { attempts: [] });
  const plan = buildStudyPlan({
    mastery: mastery,
    progress: {},
    lessonsByConcept: lessonsByConcept(),
    focusConcepts: profile.concepts,
    freeSlugs: { 'good-vs-bad-debt': 1, 'credit-scores': 1, 'first-credit-card': 1, 'money-mistakes-20s': 1 },
    limit: 4,
    hasQuiz: function(){ return true; }
  });
  assert.ok(plan.items.length >= 2);
  assert.ok(plan.items.length <= 4);
  const seen = {};
  plan.items.forEach(function(item){
    assert.equal(seen[item.slug], undefined);
    seen[item.slug] = 1;
    assert.equal(item.free, undefined);
    assert.equal(banned.test(item.reason), false, item.reason);
    assert.ok(CONCEPTS[item.conceptId]);
  });
  plan.items.slice(0, 2).forEach(function(item){
    assert.ok(profile.concepts.indexOf(item.conceptId) >= 0, item.conceptId);
  });
});

test('a free focus lesson comes before a gold-only focus gap', function(){
  const plan = buildStudyPlan({
    mastery: conceptMastery({}, { attempts: [] }),
    progress: {},
    lessonsByConcept: lessonsByConcept(),
    focusConcepts: ['diversification', 'index_funds'],
    freeSlugs: { 'compound-interest': 1, 'stock-market': 1 },
    limit: 2
  });
  assert.equal(plan.items[0].slug, 'compound-interest');
  assert.equal(plan.items[0].conceptId, 'index_funds');
});

test('a five-minute week returns at most two items', function(){
  const plan = buildStudyPlan({
    mastery: conceptMastery({}, { attempts: [] }),
    progress: {},
    lessonsByConcept: lessonsByConcept(),
    focusConcepts: profileById('balanced').concepts,
    limit: planLimit('5')
  });
  assert.ok(plan.items.length <= 2);
});

test('finished lessons with no quiz become a quiz item', function(){
  const map = lessonsByConcept();
  const progress = {};
  map.credit.forEach(function(slug){ progress[slug] = 1; });
  const mastery = conceptMastery(progress, { attempts: [] });
  assert.ok(mastery.credit.score < 70);
  const plan = buildStudyPlan({
    mastery: mastery,
    progress: progress,
    lessonsByConcept: map,
    focusConcepts: ['credit'],
    limit: 4,
    hasQuiz: function(slug){ return slug === 'credit-scores'; }
  });
  const quiz = plan.items.find(function(item){ return item.conceptId === 'credit'; });
  assert.ok(quiz);
  assert.equal(quiz.type, 'quiz');
  assert.equal(quiz.slug, 'credit-scores');
});

test('free lessons sort ahead of gold lessons', function(){
  const mastery = conceptMastery({}, { attempts: [] });
  const plan = buildStudyPlan({
    mastery: mastery,
    progress: {},
    lessonsByConcept: lessonsByConcept(),
    focusConcepts: ['index_funds'],
    freeSlugs: { 'stock-market': 1, 'compound-interest': 1 },
    limit: 1
  });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].type, 'lesson');
  assert.ok(plan.items[0].slug === 'compound-interest' || plan.items[0].slug === 'stock-market');
});

test('the same week keeps the saved list until refresh', function(){
  const now = new Date(2026, 10, 3);
  const stored = { v: 1, weekKey: weekKey(now), generatedAt: 10, items: [{ type: 'lesson', slug: 'taxes', conceptId: 'taxes', reason: 'kept' }] };
  const built = { items: [{ type: 'lesson', slug: 'paycheck', conceptId: 'taxes', reason: 'new' }] };
  const kept = currentPlan(stored, built, now, {});
  assert.equal(kept.items[0].slug, 'taxes');
  const rebuilt = currentPlan(stored, built, now, { refresh: true });
  assert.equal(rebuilt.items[0].slug, 'paycheck');
  const nextWeek = currentPlan(stored, built, new Date(2026, 10, 10), {});
  assert.equal(nextWeek.items[0].slug, 'paycheck');
});

test('a caught-up profile falls back to starter lessons', function(){
  const mastery = {};
  Object.keys(CONCEPTS).forEach(function(id){
    mastery[id] = { id: id, label: CONCEPTS[id], score: 90, lessonsDone: 1, lessonsTotal: 1, quizCorrect: 3, quizTotal: 3 };
  });
  const plan = buildStudyPlan({
    mastery: mastery,
    progress: {},
    lessonsByConcept: lessonsByConcept(),
    focusConcepts: ['saving'],
    starterLessons: ['emergency-fund', 'budget-50-30-20'],
    limit: 4
  });
  assert.deepEqual(plan.items.map(function(item){ return item.slug; }), ['emergency-fund', 'budget-50-30-20']);
});
