import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LESSON_CONCEPTS, CONCEPTS } from '../learn/concepts.js';
import { PRESETS } from '../life/presets.js';
import { PROFILES, suggestProfile, resolveIdentity, profileById } from './profiles.js';

const banned = /you should|i recommend|buy this|sell your|borrow more|you need to|you must/i;

test('profiles point at real concepts, lessons, and what-ifs', function(){
  assert.equal(PROFILES.length, 4);
  PROFILES.forEach(function(profile){
    assert.equal(banned.test(profile.blurb + ' ' + profile.focus), false, profile.id);
    profile.concepts.forEach(function(id){ assert.ok(CONCEPTS[id], id); });
    profile.lessons.forEach(function(slug){ assert.ok(LESSON_CONCEPTS[slug], slug); });
    profile.whatifs.forEach(function(id){ assert.ok(PRESETS.some(function(p){ return p.id === id; }), id); });
  });
});

test('an empty device suggests Balanced Learner', function(){
  const suggestion = suggestProfile({});
  assert.equal(suggestion.id, 'balanced');
  assert.match(suggestion.reasons.join(' '), /wide starter|skipped|history/i);
  suggestion.reasons.forEach(function(line){ assert.equal(banned.test(line), false); });
});

test('onboarding goal picks the matching study profile', function(){
  assert.equal(suggestProfile({ intake: { goal: 'debt', experience: 'new' } }).id, 'debt_focused');
  assert.equal(suggestProfile({ intake: { goal: 'invest', experience: 'comfortable' } }).id, 'investor_curious');
  assert.equal(suggestProfile({ intake: { goal: 'job', experience: 'new' } }).id, 'saver');
  assert.equal(suggestProfile({ intake: { goal: 'learn', experience: 'new' } }).id, 'balanced');
});

test('quiz history can suggest Curious Investor without onboarding', function(){
  const concepts = {
    index_funds: { lessonsDone: 2, quizTotal: 3 },
    etfs: { lessonsDone: 1, quizTotal: 3 }
  };
  const suggestion = suggestProfile({ concepts: concepts });
  assert.equal(suggestion.id, 'investor_curious');
  assert.match(suggestion.reasons.join(' '), /funds|quiz/i);
});

test('a pinned profile wins and still reports the suggestion', function(){
  const suggestion = suggestProfile({ intake: { goal: 'debt', experience: 'some' } });
  assert.equal(suggestion.id, 'debt_focused');
  const resolved = resolveIdentity(suggestion, { id: 'saver', pinned: true });
  assert.equal(resolved.id, 'saver');
  assert.equal(resolved.source, 'picked');
  assert.equal(resolved.suggestedId, 'debt_focused');
  assert.equal(resolved.profile.label, 'Steady Saver');
  const unpinned = resolveIdentity(suggestion, { id: 'saver', pinned: false });
  assert.equal(unpinned.id, 'debt_focused');
  assert.equal(unpinned.source, 'suggested');
  assert.equal(profileById('nope'), null);
  assert.equal(resolveIdentity(suggestion, { id: 'nope', pinned: true }).id, 'debt_focused');
});

test('life path school and age add saver or debt reasons without advice', function(){
  const teen = suggestProfile({ life: { currentAge: 16, college: 'none', monthlyInvest: 50 } });
  assert.equal(teen.id, 'saver');
  assert.match(teen.reasons.join(' '), /50|age is 16|start working/);
  const school = suggestProfile({ life: { currentAge: 19, college: 'instate', monthlyInvest: 0 } });
  assert.equal(school.id, 'debt_focused');
  school.reasons.forEach(function(line){ assert.equal(banned.test(line), false, line); });
});
