import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONCEPTS, LESSON_CONCEPTS, lessonsByConcept } from './concepts.js';
import { countCompleted } from './progress.js';
import { latestAttempts } from './quizlog.js';
import { literacyScore, conceptMastery, explainLiteracy, LITERACY_WEIGHTS, masteryStatus } from './mastery.js';

function progressOf(slugs){
  const progress = {};
  slugs.forEach(function(slug, i){ progress[slug] = 1000 + i; });
  return progress;
}

test('countCompleted only counts known slugs', function(){
  assert.equal(countCompleted({ 'compound-interest': 1, nope: 2 }, ['compound-interest', 'taxes']), 1);
  assert.equal(countCompleted(null, ['taxes']), 0);
});

test('latest attempt replaces an earlier retake', function(){
  const log = { v: 1, attempts: [
    { quizKey: 'taxes', finishedAt: 10, correct: 0, total: 3, responses: [
      { qid: 'taxes#0', conceptIds: ['taxes'], correct: false }
    ] },
    { quizKey: 'taxes', finishedAt: 20, correct: 1, total: 1, responses: [
      { qid: 'taxes#0', conceptIds: ['taxes'], correct: true }
    ] }
  ] };
  const latest = latestAttempts(log);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].finishedAt, 20);
  const row = conceptMastery({}, log).taxes;
  assert.equal(row.quizCorrect, 1);
  assert.equal(row.quizTotal, 1);
});

test('literacy score is 0 with no evidence', function(){
  const result = literacyScore({}, { v: 1, attempts: [] });
  assert.equal(result.score, 0);
  assert.equal(result.lessonPoints, 0);
  assert.equal(result.quizPoints, 0);
  assert.equal(result.breadthPoints, 0);
  assert.match(result.lines[1], /no saved quiz/i);
});

test('lesson points use 400 times finished over 34', function(){
  const slugs = Object.keys(LESSON_CONCEPTS).slice(0, 8);
  const result = literacyScore(progressOf(slugs), { attempts: [] });
  const expected = Math.round(400 * 8 / 34);
  assert.equal(result.lessonsDone, 8);
  assert.equal(result.lessonPoints, expected);
  assert.equal(result.lines[0], 'Lessons: round(400 × 8 / 34) = ' + expected);
});

test('quiz points scale accuracy by questions over 24', function(){
  const responses = [];
  for(let i = 0; i < 18; i++){
    responses.push({ qid: 'taxes#' + i, conceptIds: ['taxes'], correct: i < 15 });
  }
  const result = literacyScore({}, { attempts: [{ quizKey: 'taxes', finishedAt: 5, responses: responses }] });
  const expected = Math.round(400 * (15 / 18) * (18 / 24));
  assert.equal(expected, 250);
  assert.equal(result.quizPoints, 250);
  assert.equal(result.quizCorrect, 15);
  assert.equal(result.quizTotal, 18);
});

test('a full lesson set, a perfect 24-question quiz, and every concept is 1000', function(){
  const progress = progressOf(Object.keys(LESSON_CONCEPTS));
  const responses = [];
  Object.keys(CONCEPTS).forEach(function(id, index){
    responses.push({ qid: 'mix#' + index, conceptIds: [id], correct: true });
    responses.push({ qid: 'mix#' + index + 'b', conceptIds: [id], correct: true });
  });
  assert.equal(responses.length, 26);
  const result = literacyScore(progress, { attempts: [{ quizKey: 'long-term-strategy', finishedAt: 9, responses: responses }] });
  assert.equal(result.lessonPoints, 400);
  assert.equal(result.quizPoints, 400);
  assert.equal(result.conceptsTouched, Object.keys(CONCEPTS).length);
  assert.equal(result.breadthPoints, 200);
  assert.equal(result.score, 1000);
  assert.equal(explainLiteracy(result)[3], 'Total: 400 + 400 + 200 = 1000');
});

test('concept mastery is 45 percent lessons and 55 percent latest quiz', function(){
  const map = lessonsByConcept();
  const savingLessons = map.saving;
  assert.ok(savingLessons.length > 1);
  const done = {};
  done[savingLessons[0]] = 1;
  const lessonShare = 1 / savingLessons.length;
  const log = { attempts: [{ quizKey: savingLessons[0], finishedAt: 3, responses: [
    { qid: 'q', conceptIds: ['saving'], correct: true },
    { qid: 'q2', conceptIds: ['saving'], correct: false }
  ] }] };
  const row = conceptMastery(done, log).saving;
  assert.equal(row.score, Math.round(0.45 * lessonShare * 100 + 0.55 * 0.5 * 100));
  assert.equal(row.status, masteryStatus(row.score));
});

test('finished lessons without a quiz cap at 60', function(){
  const map = lessonsByConcept();
  const progress = progressOf(map.credit);
  const row = conceptMastery(progress, { attempts: [] }).credit;
  assert.equal(row.lessonsDone, row.lessonsTotal);
  assert.equal(row.score, LITERACY_WEIGHTS.lessonOnlyCap);
  assert.equal(row.status, 'practicing');
});

test('response concept ids do not spill onto sibling lesson tags', function(){
  const log = { attempts: [{ quizKey: 'schools-skipped', finishedAt: 4, responses: [
    { qid: 'schools-skipped#0', conceptIds: ['saving'], correct: true }
  ] }] };
  const mastery = conceptMastery({}, log);
  assert.equal(mastery.saving.quizTotal, 1);
  assert.equal(mastery.budgeting.quizTotal, 0);
});

test('attempts with no responses fall back to the lesson tags', function(){
  const log = { attempts: [{ quizKey: 'schools-skipped', finishedAt: 4, correct: 2, total: 3, responses: [] }] };
  const mastery = conceptMastery({}, log);
  assert.equal(mastery.saving.quizCorrect, 2);
  assert.equal(mastery.saving.quizTotal, 3);
  assert.equal(mastery.budgeting.quizTotal, 3);
});

test('service worker cache is finpath-v41 and precaches the new modules', function(){
  const sw = readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /finpath-v41/);
  assert.doesNotMatch(sw, /finpath-v39/);
  ['js/intel/life/review.js', 'js/intel/learn/mastery.js', 'js/intel/learn/plan.js', 'js/intel/identity/profiles.js', 'js/intel/identity/boot.js'].forEach(function(file){
    assert.match(sw, new RegExp(file.replace(/\//g, '\\/')));
  });
});
