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
