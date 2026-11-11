import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeJournal } from './journal.js';
import { literacyScore } from '../learn/mastery.js';
import {
  yearWindow,
  yearsPresent,
  inWindow,
  sliceProgress,
  sliceQuizLog,
  datedStudyBefore,
  literacyDelta,
  identitySpan,
  buildYearReview,
  yearbookLines
} from './review.js';

const NOW = new Date(2026, 10, 1, 12, 0, 0, 0).getTime();
const JAN = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
const MARCH = new Date(2026, 2, 1, 12, 0, 0, 0).getTime();
const LAST_DEC = new Date(2025, 11, 20, 12, 0, 0, 0).getTime();
const JUNE = new Date(2026, 5, 15, 12, 0, 0, 0).getTime();

function items(){
  return mergeJournal({
    entries: [
      { id: 'sim:card', kind: 'simulation', title: 'What if I carry credit card debt?', why: 'Looked at the card worksheet.', conceptIds: ['debt', 'credit'], at: JAN, ref: 'card' },
      { id: 'sim:card', kind: 'simulation', title: 'What if I carry credit card debt?', why: 'Opened it again.', conceptIds: ['debt'], at: MARCH, ref: 'card' },
      { id: 'sim:wait25', kind: 'simulation', title: 'What if I wait until 25?', why: 'Compared waiting.', conceptIds: ['saving'], at: LAST_DEC, ref: 'wait25' },
      { id: 'note:1', kind: 'reflection', title: 'Note', why: 'I wanted to see the picture before a campus job.', conceptIds: [], at: JUNE, ref: '' },
      { id: 'goal:bike', kind: 'goal', title: 'Savings goal: Bike', why: 'Saved 20 toward 100', conceptIds: ['saving'], at: JUNE, ref: 'fp_goals' },
      { id: 'goal:later', kind: 'goal', title: 'Savings goal: Laptop', why: 'Saved 0 toward 800', conceptIds: ['saving'], at: new Date(2027, 3, 1).getTime(), ref: 'fp_goals' },
      { id: 'goal:nodate', kind: 'goal', title: 'Savings goal: Fund', why: 'Saved 5 toward 50', conceptIds: ['saving'], at: 0, ref: 'fp_goals' }
    ],
    paper: { journal: [{ id: 't1', t: 'AAPL', pnl: 12.5, thesis: 'class example', reflection: 'practice only', soldAt: MARCH }] },
    lessons: { 'compound-interest': MARCH, 'taxes': LAST_DEC },
    lessonNames: { 'compound-interest': 'Compound interest', taxes: 'Taxes' },
    quizzes: { attempts: [{ id: 'q1', lessonName: 'Compound interest', quizKey: 'compound-interest', correct: 2, total: 3, finishedAt: JUNE, responses: [{ conceptIds: ['saving'], correct: true }] }] }
  });
}

test('year window labels this year so far and a closed past year', function(){
  const current = yearWindow(null, NOW);
  assert.equal(current.year, 2026);
  assert.equal(current.partial, true);
  assert.equal(current.label, '2026 so far');
  assert.ok(inWindow(JAN, current));
  assert.equal(inWindow(LAST_DEC, current), false);
  assert.equal(inWindow(0, current), false);

  const past = yearWindow(2025, NOW);
  assert.equal(past.partial, false);
  assert.equal(past.label, '2025');
  assert.ok(inWindow(LAST_DEC, past));
  assert.equal(inWindow(new Date(2026, 0, 1).getTime(), past), false);
  assert.equal(yearWindow('nope', NOW), null);
});

test('review groups this year and leaves last year’s what-if out', function(){
  const review = buildYearReview(items(), {
    now: NOW,
    year: 2026,
    conceptLabels: { debt: 'Debt', credit: 'Credit', saving: 'Saving' }
  });
  assert.equal(review.window.label, '2026 so far');
  assert.equal(review.counts.simulation, 1);
  assert.equal(review.counts.reflection, 1);
  assert.equal(review.counts.trade, 1);
  assert.equal(review.counts.goal, 1);
  assert.equal(review.counts.learning, 2);
  assert.equal(review.whatifs.length, 1);
  assert.equal(review.whatifs[0].ref, 'card');
  assert.equal(review.whatifs[0].href, '#life/whatif/card');
  assert.equal(review.whatifs[0].why, 'Opened it again.');
  assert.equal(review.notes.length, 1);
  assert.equal(review.trades.length, 1);
  assert.match(review.trades[0].title, /AAPL/);
  assert.equal(review.goals.length, 1);
  assert.equal(review.goals[0].title, 'Savings goal: Bike');
  assert.equal(review.trackedGoals.length, 2);
  assert.equal(review.lessons.length, 1);
  assert.match(review.lessons[0].title, /Compound interest/);
  assert.equal(review.quizzes.length, 1);
  assert.equal(review.concepts[0].label, 'Debt');
  assert.ok(review.undatedCount >= 1);
  assert.equal(review.links.plan, '#identity/plan');
  assert.equal(review.links.identity, '#identity');
  assert.equal(review.links.timeline, '#life/journal');

  const past = buildYearReview(items(), { now: NOW, year: 2025 });
  assert.equal(past.counts.simulation, 1);
  assert.equal(past.whatifs[0].ref, 'wait25');
  assert.equal(past.trackedGoals.length, 0);
  assert.equal(past.lessons.length, 1);
  assert.match(past.lessons[0].title, /Taxes/);
  assert.equal(past.quizzes.length, 0);
});

test('empty year stays blank and names the cross-links', function(){
  const review = buildYearReview([], { now: NOW, year: 2026 });
  assert.equal(review.empty, true);
  assert.equal(review.counts.total, 0);
  assert.match(review.lines.join('\n'), /still blank/);
  assert.match(review.lines.join('\n'), /Nothing on this page tells you what to do with money/);
  const years = yearsPresent([], NOW);
  assert.deepEqual(years, [2026]);
});

test('literacy delta hides when nothing is dated and shows a real as-of change', function(){
  const hidden = literacyDelta(0, 0, { datedEvidence: false, partial: true });
  assert.equal(hidden.available, false);
  const undated = literacyDelta(40, 40, { datedEvidence: false, partial: true });
  assert.equal(undated.available, true);
  assert.equal(undated.undatedOnly, true);
  assert.equal(undated.delta, 0);
  const pastUndated = literacyDelta(40, 40, { datedEvidence: false, partial: false });
  assert.equal(pastUndated.available, false);

  const window = yearWindow(2026, NOW);
  const progress = { 'compound-interest': MARCH, 'taxes': LAST_DEC };
  const log = { attempts: [{ quizKey: 'compound-interest', finishedAt: JUNE, correct: 2, total: 3, responses: [] }] };
  assert.equal(datedStudyBefore(progress, log, window.start), true);
  const start = literacyScore(sliceProgress(progress, window.start), sliceQuizLog(log, window.start));
  const end = literacyScore(sliceProgress(progress, window.end), sliceQuizLog(log, window.end));
  assert.ok(end.score > start.score);
  const delta = literacyDelta(start.score, end.score, { datedEvidence: true, partial: true });
  assert.equal(delta.available, true);
  assert.equal(delta.delta, end.score - start.score);
  assert.equal(sliceProgress({ 'compound-interest': MARCH }, window.start)['compound-interest'], undefined);
  assert.equal(sliceQuizLog(log, window.start).attempts.length, 0);
  assert.equal(sliceQuizLog({ attempts: [{ quizKey: 'x', finishedAt: 0, correct: 1, total: 1 }] }, window.end).attempts.length, 1);
});

test('identity span reports a change, a keep, and a first pick', function(){
  const window = yearWindow(2026, NOW);
  const changed = identitySpan([
    { id: 'saver', label: 'Steady Saver', at: LAST_DEC },
    { id: 'debt_focused', label: 'Debt Navigator', at: MARCH }
  ], window);
  assert.equal(changed.available, true);
  assert.equal(changed.changed, true);
  assert.equal(changed.opening.label, 'Steady Saver');
  assert.equal(changed.closing.label, 'Debt Navigator');

  const roundTrip = identitySpan([
    { id: 'saver', label: 'Steady Saver', at: LAST_DEC },
    { id: 'debt_focused', label: 'Debt Navigator', at: JAN },
    { id: 'saver', label: 'Steady Saver', at: JUNE }
  ], window);
  assert.equal(roundTrip.changed, true);
  assert.equal(roundTrip.closing.id, 'saver');

  const kept = identitySpan([{ id: 'balanced', label: 'Balanced Learner', at: LAST_DEC }], window);
  assert.equal(kept.changed, false);
  assert.equal(kept.opening.id, 'balanced');
  assert.equal(kept.pickedThisYear, false);

  const first = identitySpan([{ id: 'investor_curious', label: 'Curious Investor', at: JUNE }], window);
  assert.equal(first.opening, null);
  assert.equal(first.pickedThisYear, true);
  assert.equal(identitySpan([], window).available, false);
});

test('yearbook copy stays educational', function(){
  const review = buildYearReview(items(), {
    now: NOW,
    year: 2026,
    conceptLabels: { debt: 'Debt', saving: 'Saving', credit: 'Credit' },
    literacy: { available: true, start: 80, end: 140, delta: 60, undatedOnly: false },
    identity: {
      available: true,
      opening: { id: 'saver', label: 'Steady Saver' },
      closing: { id: 'debt_focused', label: 'Debt Navigator' },
      changed: true
    }
  });
  const text = review.lines.join('\n');
  assert.match(text, /What if I carry credit card debt/);
  assert.match(text, /campus job/);
  assert.match(text, /80/);
  assert.match(text, /140/);
  assert.match(text, /Steady Saver/);
  assert.match(text, /Debt Navigator/);
  assert.match(text, /not a credit score/i);
  assert.match(text, /not a reason to buy, sell, or borrow/i);
  assert.match(text, /Nothing on this page tells you what to do with money/);
  assert.doesNotMatch(text, /you should|i recommend|buy this|sell your|borrow more|you need to/i);
  const bare = yearbookLines({ window: yearWindow(2024, NOW), counts: { total: 0 } });
  assert.match(bare.join('\n'), /2024/);
  assert.doesNotMatch(bare.join('\n'), /literacy score/i);
});

test('service worker cache is finpath-v41 and precaches the review', function(){
  const sw = readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /finpath-v41/);
  assert.doesNotMatch(sw, /finpath-v39/);
  assert.match(sw, /js\/intel\/life\/review\.js/);
});
