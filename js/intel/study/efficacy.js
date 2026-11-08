// Opt-in efficacy study. Off until someone joins. Under 13 is blocked.
// The study id is random. The upload body has no name, email, school, exact
// age, or location. Signed-out devices keep the queue and send nothing.

export const AGE_BANDS = ['13-15', '16-17', '18-24', '25+'];
export const K_MIN = 10;

export function freshStudy(){
  return {
    v: 1,
    status: 'off',
    studyId: null,
    token: null,
    ageConfirmed: null,
    ageBand: null,
    consentedAt: null,
    pre: null,
    post: null,
    pending: [],
    progressIds: [],
    seenLessons: {},
    seenQuizzes: []
  };
}

export function confirmAge(state, answer){
  const prev = state && typeof state === 'object' ? state : freshStudy();
  if(answer === 'under13'){
    return Object.assign({}, prev, {
      status: 'blocked',
      ageConfirmed: 'under13',
      pending: []
    });
  }
  if(answer === '13plus'){
    return Object.assign({}, prev, {
      ageConfirmed: '13plus',
      status: prev.status === 'blocked' ? 'off' : prev.status
    });
  }
  return prev;
}

function literacySnap(literacy, now){
  const src = literacy && typeof literacy === 'object' ? literacy : {};
  const score = clamp(src.score, 0, 1000);
  return {
    capturedAt: Number(now) || 0,
    score: score,
    lessonPoints: clamp(src.lessonPoints, 0, 400),
    quizPoints: clamp(src.quizPoints, 0, 400),
    breadthPoints: clamp(src.breadthPoints, 0, 200)
  };
}

function clamp(n, lo, hi){
  const x = Math.round(Number(n));
  if(!isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function sameSnap(a, b){
  return !!a && !!b && a.score === b.score && a.lessonPoints === b.lessonPoints &&
    a.quizPoints === b.quizPoints && a.breadthPoints === b.breadthPoints;
}

export function hashKey(value){
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  let h = 2166136261;
  for(let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function progressEventId(action, key){
  const prefix = action === 'quiz_finished' ? 'quiz' : 'lesson';
  return (prefix + ':' + hashKey(String(key || ''))).slice(0, 80);
}

function canRecord(state){
  return !!state && state.status === 'joined' && state.ageConfirmed === '13plus' && !!state.studyId && !!state.token;
}

function literacyEvent(kind, snap, ageBand){
  return {
    eventId: kind === 'literacy_pre' ? 'literacy_pre' : ('post:' + snap.capturedAt),
    kind: kind,
    score: snap.score,
    lessonPoints: snap.lessonPoints,
    quizPoints: snap.quizPoints,
    breadthPoints: snap.breadthPoints,
    action: null,
    ageBand: ageBand || null
  };
}

export function recordLiteracy(state, literacy, now){
  if(!canRecord(state)) return state;
  const snap = literacySnap(literacy, now);
  if(!state.pre){
    const event = literacyEvent('literacy_pre', snap, state.ageBand);
    return Object.assign({}, state, { pre: snap, pending: state.pending.concat(event).slice(-40) });
  }
  const current = state.post || state.pre;
  if(sameSnap(current, snap)) return state;
  const event = literacyEvent('literacy_post', snap, state.ageBand);
  const pending = state.pending.filter(function(item){ return item.eventId !== event.eventId; }).concat(event);
  return Object.assign({}, state, { post: snap, pending: pending.slice(-40) });
}

export function joinStudy(state, opts){
  const prev = state && typeof state === 'object' ? state : freshStudy();
  const options = opts && typeof opts === 'object' ? opts : {};
  if(prev.ageConfirmed !== '13plus' || prev.status === 'blocked'){
    return { state: prev, error: 'blocked' };
  }
  if(options.agree !== true) return { state: prev, error: 'consent' };
  if(options.ageBand && AGE_BANDS.indexOf(options.ageBand) < 0) return { state: prev, error: 'band' };
  if(!options.studyId || !options.token) return { state: prev, error: 'id' };
  let next = Object.assign({}, prev, {
    status: 'joined',
    studyId: String(options.studyId),
    token: String(options.token),
    ageBand: options.ageBand || null,
    consentedAt: Number(options.now) || 0,
    pre: null,
    post: null,
    pending: [],
    progressIds: [],
    seenLessons: options.lessons && typeof options.lessons === 'object' ? options.lessons : {},
    seenQuizzes: Array.isArray(options.quizIds) ? options.quizIds.slice(-400) : []
  });
  if(options.literacy) next = recordLiteracy(next, options.literacy, options.now);
  return { state: next, error: null };
}

export function withdrawStudy(state){
  const prev = state && typeof state === 'object' ? state : freshStudy();
  if(prev.status === 'blocked') return Object.assign({}, prev, { pending: [] });
  if(prev.status !== 'joined') return Object.assign({}, prev, { status: 'off', pending: [] });
  return Object.assign({}, prev, { status: 'withdrawn', pending: [] });
}

export function recordProgress(state, action, key){
  if(!canRecord(state)) return state;
  if(action !== 'lesson_finished' && action !== 'quiz_finished') return state;
  const eventId = progressEventId(action, key);
  const ids = Array.isArray(state.progressIds) ? state.progressIds : [];
  if(ids.indexOf(eventId) >= 0) return state;
  const event = {
    eventId: eventId,
    kind: 'progress',
    score: null,
    lessonPoints: null,
    quizPoints: null,
    breadthPoints: null,
    action: action,
    ageBand: state.ageBand || null
  };
  return Object.assign({}, state, {
    progressIds: ids.concat(eventId).slice(-200),
    pending: state.pending.concat(event).slice(-40)
  });
}

export function diffProgress(state, lessons, quizIds){
  if(!canRecord(state)) return { state: state, added: [] };
  const seenLessons = state.seenLessons && typeof state.seenLessons === 'object' ? state.seenLessons : {};
  const seenQuizzes = Array.isArray(state.seenQuizzes) ? state.seenQuizzes : [];
  const nextLessons = Object.assign({}, seenLessons);
  const nextQuizzes = seenQuizzes.slice();
  let cursor = state;
  const added = [];
  const prog = lessons && typeof lessons === 'object' ? lessons : {};
  Object.keys(prog).forEach(function(slug){
    if(slug === '_v' || !prog[slug] || seenLessons[slug]) return;
    const key = slug + ':' + prog[slug];
    cursor = recordProgress(cursor, 'lesson_finished', key);
    nextLessons[slug] = prog[slug];
    added.push(progressEventId('lesson_finished', key));
  });
  (Array.isArray(quizIds) ? quizIds : []).forEach(function(id){
    if(!id || seenQuizzes.indexOf(id) >= 0) return;
    cursor = recordProgress(cursor, 'quiz_finished', id);
    nextQuizzes.push(id);
    added.push(progressEventId('quiz_finished', id));
  });
  cursor = Object.assign({}, cursor, { seenLessons: nextLessons, seenQuizzes: nextQuizzes.slice(-400) });
  return { state: cursor, added: added };
}

export function eventsToUpload(state, signedIn){
  if(!signedIn) return [];
  if(!canRecord(state)) return [];
  return (Array.isArray(state.pending) ? state.pending : []).filter(function(event){
    return event && event.eventId && (event.kind === 'literacy_pre' || event.kind === 'literacy_post' || event.kind === 'progress');
  });
}

export function publicEvent(event){
  return {
    eventId: String(event.eventId || '').slice(0, 80),
    kind: event.kind,
    score: event.score == null ? null : event.score,
    lessonPoints: event.lessonPoints == null ? null : event.lessonPoints,
    quizPoints: event.quizPoints == null ? null : event.quizPoints,
    breadthPoints: event.breadthPoints == null ? null : event.breadthPoints,
    action: event.action || null,
    ageBand: event.ageBand || null
  };
}

export function buildRecordBody(state, signedIn){
  const events = eventsToUpload(state, signedIn).map(publicEvent);
  if(!events.length || !state || !state.studyId || !state.token) return null;
  return {
    action: 'record',
    studyId: state.studyId,
    token: state.token,
    ageConfirmed: '13plus',
    ageBand: state.ageBand || null,
    events: events
  };
}

export function markUploaded(state, eventIds){
  if(!state) return state;
  const drop = {};
  (Array.isArray(eventIds) ? eventIds : []).forEach(function(id){ drop[id] = 1; });
  return Object.assign({}, state, {
    pending: (state.pending || []).filter(function(event){ return event && !drop[event.eventId]; })
  });
}

export function deletePayload(state){
  if(!state || !state.studyId || !state.token) return null;
  return { action: 'withdraw', studyId: state.studyId, token: state.token };
}

export function afterDelete(state){
  const blocked = state && state.ageConfirmed === 'under13';
  const next = freshStudy();
  if(blocked){
    next.status = 'blocked';
    next.ageConfirmed = 'under13';
  }
  return next;
}
