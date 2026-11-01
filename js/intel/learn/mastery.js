// Literacy score and per-concept mastery.
// Local evidence only: lesson slug completions + the latest quiz attempt per lesson.
//
// Literacy score, 0–1000:
//   Lessons  (0–400) = round(400 × finished tagged lessons / 34)
//   Quizzes  (0–400) = round(400 × accuracy × min(1, questions / 24))
//                      accuracy = correct ÷ answered on the latest try of each quiz
//                      24 questions is eight 3-question checks. Fewer than that
//                      cannot fill the quiz bucket. Wrong answers add nothing.
//   Breadth  (0–200) = round(200 × concepts touched / concept count)
//                      a concept is touched when a tagged lesson is finished
//                      or a latest-quiz response counts toward it
//   Total            = lessons + quizzes + breadth, clamped to 0–1000
//
// Concept mark, 0–100:
//   No quiz on file: round(lesson share × 60). Finishing every tagged lesson
//   without a quiz stays at 60 so the dashboard still shows a quiz gap.
//   Quiz and lessons: round(45% lesson share + 55% latest-quiz accuracy).

import { CONCEPTS, LESSON_CONCEPTS, conceptsFor, lessonsByConcept } from './concepts.js';
import { countCompleted } from './progress.js';
import { latestAttempts } from './quizlog.js';

export const LITERACY_WEIGHTS = {
  lessons: 400,
  quizzes: 400,
  breadth: 200,
  quizQuestionsForFull: 24,
  lessonOnlyCap: 60
};

export const TAGGED_LESSON_COUNT = Object.keys(LESSON_CONCEPTS).length;

function clamp(n, lo, hi){
  return Math.max(lo, Math.min(hi, n));
}

function round(n){
  return Math.round(n);
}

export function masteryStatus(score){
  const n = Number(score) || 0;
  if(n <= 0) return 'not_started';
  if(n < 40) return 'just_met';
  if(n < 70) return 'practicing';
  return 'steady';
}

export const STATUS_LABELS = {
  not_started: 'Not started',
  just_met: 'Just met',
  practicing: 'Practicing',
  steady: 'Steady'
};

function quizBuckets(log){
  const buckets = {};
  latestAttempts(log).forEach(function(attempt){
    const responses = Array.isArray(attempt.responses) ? attempt.responses : [];
    if(responses.length){
      responses.forEach(function(response){
        const tagged = Array.isArray(response.conceptIds) ? response.conceptIds.filter(function(id){ return CONCEPTS[id]; }) : [];
        const ids = tagged.length ? tagged : conceptsFor(attempt.quizKey);
        ids.forEach(function(id){
          if(!CONCEPTS[id]) return;
          if(!buckets[id]) buckets[id] = { correct: 0, total: 0 };
          buckets[id].total += 1;
          if(response.correct === true) buckets[id].correct += 1;
        });
      });
      return;
    }
    const ids = conceptsFor(attempt.quizKey);
    const total = Number(attempt.total) || 0;
    const correct = Number(attempt.correct) || 0;
    if(!ids.length || !total) return;
    ids.forEach(function(id){
      if(!buckets[id]) buckets[id] = { correct: 0, total: 0 };
      buckets[id].total += total;
      buckets[id].correct += correct;
    });
  });
  return buckets;
}

function quizTotals(log){
  let correct = 0;
  let total = 0;
  latestAttempts(log).forEach(function(attempt){
    const responses = Array.isArray(attempt.responses) ? attempt.responses : [];
    if(responses.length){
      responses.forEach(function(response){
        total += 1;
        if(response.correct === true) correct += 1;
      });
      return;
    }
    const t = Number(attempt.total) || 0;
    const c = Number(attempt.correct) || 0;
    total += t;
    correct += Math.max(0, Math.min(t, c));
  });
  return { correct: correct, total: total };
}

export function conceptMastery(progress, log){
  const byConcept = lessonsByConcept();
  const quizzes = quizBuckets(log);
  const mastery = {};
  Object.keys(CONCEPTS).forEach(function(id){
    const slugs = byConcept[id] || [];
    const lessonsDone = countCompleted(progress, slugs);
    const lessonsTotal = slugs.length;
    const lessonShare = lessonsTotal ? lessonsDone / lessonsTotal : 0;
    const quiz = quizzes[id] || null;
    const quizShare = quiz && quiz.total ? quiz.correct / quiz.total : null;
    let score;
    if(quizShare == null){
      score = round(lessonShare * LITERACY_WEIGHTS.lessonOnlyCap);
    } else if(!lessonsTotal){
      score = round(quizShare * 100);
    } else {
      score = round(0.45 * lessonShare * 100 + 0.55 * quizShare * 100);
    }
    score = clamp(score, 0, 100);
    mastery[id] = {
      id: id,
      label: CONCEPTS[id],
      score: score,
      status: masteryStatus(score),
      lessonsDone: lessonsDone,
      lessonsTotal: lessonsTotal,
      quizCorrect: quiz ? quiz.correct : 0,
      quizTotal: quiz ? quiz.total : 0
    };
  });
  return mastery;
}

export function literacyScore(progress, log){
  const slugs = Object.keys(LESSON_CONCEPTS);
  const lessonsDone = countCompleted(progress, slugs);
  const lessonsTotal = slugs.length || 1;
  const lessonPoints = round(LITERACY_WEIGHTS.lessons * lessonsDone / lessonsTotal);

  const quiz = quizTotals(log);
  const accuracy = quiz.total ? quiz.correct / quiz.total : 0;
  const coverage = Math.min(1, quiz.total / LITERACY_WEIGHTS.quizQuestionsForFull);
  const quizPoints = quiz.total ? round(LITERACY_WEIGHTS.quizzes * accuracy * coverage) : 0;

  const mastery = conceptMastery(progress, log);
  const conceptCount = Object.keys(CONCEPTS).length || 1;
  const conceptsTouched = Object.keys(mastery).filter(function(id){
    const row = mastery[id];
    return row.lessonsDone > 0 || row.quizTotal > 0;
  }).length;
  const breadthPoints = round(LITERACY_WEIGHTS.breadth * conceptsTouched / conceptCount);

  const score = clamp(lessonPoints + quizPoints + breadthPoints, 0, 1000);
  const result = {
    score: score,
    lessonPoints: lessonPoints,
    quizPoints: quizPoints,
    breadthPoints: breadthPoints,
    lessonsDone: lessonsDone,
    lessonsTotal: slugs.length,
    quizCorrect: quiz.correct,
    quizTotal: quiz.total,
    conceptsTouched: conceptsTouched,
    conceptCount: Object.keys(CONCEPTS).length,
    weights: LITERACY_WEIGHTS,
    mastery: mastery
  };
  result.lines = explainLiteracy(result);
  return result;
}

export function explainLiteracy(result){
  const src = result || {};
  const weights = src.weights || LITERACY_WEIGHTS;
  const lessonsTotal = src.lessonsTotal || TAGGED_LESSON_COUNT;
  const lessonLine = 'Lessons: round(' + weights.lessons + ' × ' + (src.lessonsDone || 0) + ' / ' + lessonsTotal + ') = ' + (src.lessonPoints || 0);
  let quizLine;
  if(!src.quizTotal){
    quizLine = 'Quizzes: no saved quiz answers yet = 0';
  } else {
    quizLine = 'Quizzes: round(' + weights.quizzes + ' × ' + src.quizCorrect + ' / ' + src.quizTotal + ' × min(1, ' + src.quizTotal + ' / ' + weights.quizQuestionsForFull + ')) = ' + src.quizPoints;
  }
  const breadthLine = 'Breadth: round(' + weights.breadth + ' × ' + (src.conceptsTouched || 0) + ' / ' + (src.conceptCount || Object.keys(CONCEPTS).length) + ') = ' + (src.breadthPoints || 0);
  const totalLine = 'Total: ' + (src.lessonPoints || 0) + ' + ' + (src.quizPoints || 0) + ' + ' + (src.breadthPoints || 0) + ' = ' + (src.score || 0);
  return [lessonLine, quizLine, breadthLine, totalLine];
}
