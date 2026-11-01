// Append-only quiz history. fp_quiz stays { lessonName: { c, t } } so Finance IQ
// keeps working. This log is the evidence Phase 2 can group by concept id.
// Retakes append. They do not erase earlier answers.

const MAX_ATTEMPTS = 400;

export function emptyQuizLog(){
  return { v: 1, attempts: [] };
}

export function appendAttempt(log, attempt){
  const prev = (log && Array.isArray(log.attempts)) ? log.attempts : [];
  const next = prev.slice();
  next.push(attempt);
  return { v: 1, attempts: next.length > MAX_ATTEMPTS ? next.slice(next.length - MAX_ATTEMPTS) : next };
}

// One row per quiz. A retake replaces the earlier attempt for scoring.
// The log itself still keeps every attempt.
export function latestAttempts(log){
  const byKey = {};
  const attempts = (log && Array.isArray(log.attempts)) ? log.attempts : [];
  attempts.forEach(function(attempt){
    if(!attempt || typeof attempt !== 'object') return;
    const key = String(attempt.quizKey || attempt.lessonName || '');
    if(!key) return;
    const prev = byKey[key];
    const t = Number(attempt.finishedAt) || 0;
    if(!prev || t >= (Number(prev.finishedAt) || 0)) byKey[key] = attempt;
  });
  return Object.keys(byKey).map(function(key){ return byKey[key]; });
}

export function makeAttempt(partial){
  const responses = Array.isArray(partial.responses) ? partial.responses.map(function(r){
    return {
      qid: String(r.qid || ''),
      conceptIds: Array.isArray(r.conceptIds) ? r.conceptIds.map(String) : [],
      chosen: Number(r.chosen),
      correct: r.correct === true
    };
  }) : [];
  return {
    id: String(partial.id || ''),
    quizKey: String(partial.quizKey || ''),
    lessonName: String(partial.lessonName || ''),
    contentVersion: 1,
    startedAt: Number(partial.startedAt) || 0,
    finishedAt: Number(partial.finishedAt) || 0,
    correct: Number(partial.correct) || 0,
    total: Number(partial.total) || responses.length,
    responses: responses
  };
}
