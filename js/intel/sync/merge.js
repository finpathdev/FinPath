// Pure merge for Intelligence sync. localStorage stays the source of truth.
// A signed-out caller never receives upload batches. An empty remote copy
// does not wipe local rows. A tie keeps the row already stored, which is the
// local one when locals are applied first.

export const BATCH_SIZE = 50;

const STATUSES = { not_started: 1, just_met: 1, practicing: 1, steady: 1 };
const TIMEFRAMES = { 7: 1, 30: 1, 90: 1, 365: 1 };
const PLAN_TYPES = { lesson: 1, quiz: 1 };
const COLLECTIONS = ['lessons', 'concepts', 'literacy', 'thesis', 'behavior', 'risk', 'plans'];

export function timeMs(value){
  if(typeof value === 'number' && isFinite(value)) return value;
  const n = Date.parse(value);
  return isFinite(n) ? n : 0;
}

function clampInt(n, lo, hi){
  const x = Math.round(Number(n));
  if(!isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function optNum(n, lo, hi, places){
  if(n == null || n === '') return null;
  const x = Number(n);
  if(!isFinite(x) || x < lo || x > hi) return null;
  const m = Math.pow(10, places);
  return Math.round(x * m) / m;
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

export function conceptClocks(progress, log, byConcept, conceptsFor){
  const clocks = {};
  const prog = progress && typeof progress === 'object' && !Array.isArray(progress) ? progress : {};
  const map = byConcept && typeof byConcept === 'object' ? byConcept : {};
  Object.keys(map).forEach(function(id){
    let at = 0;
    (map[id] || []).forEach(function(slug){
      const ts = Number(prog[slug]) || 0;
      if(ts > at) at = ts;
    });
    clocks[id] = at;
  });
  const attempts = log && Array.isArray(log.attempts) ? log.attempts : [];
  attempts.forEach(function(attempt){
    if(!attempt || typeof attempt !== 'object') return;
    const t = Number(attempt.finishedAt) || 0;
    if(!t) return;
    const ids = {};
    const responses = Array.isArray(attempt.responses) ? attempt.responses : [];
    responses.forEach(function(response){
      const tagged = response && Array.isArray(response.conceptIds) ? response.conceptIds : [];
      tagged.forEach(function(id){ ids[String(id)] = 1; });
    });
    if(!Object.keys(ids).length && typeof conceptsFor === 'function'){
      const fallback = conceptsFor(attempt.quizKey || attempt.lessonName || '') || [];
      fallback.forEach(function(id){ ids[String(id)] = 1; });
    }
    Object.keys(ids).forEach(function(id){
      if(t > (clocks[id] || 0)) clocks[id] = t;
    });
  });
  return clocks;
}

export function normalizeConcept(row){
  if(!row || typeof row !== 'object') return null;
  const id = String(row.id || row.conceptId || row.concept_id || '').trim().slice(0, 40);
  if(!id) return null;
  const score = clampInt(row.score, 0, 100);
  const status = STATUSES[row.status] ? row.status : (score >= 70 ? 'steady' : score >= 40 ? 'practicing' : score > 0 ? 'just_met' : 'not_started');
  const lessonsTotal = clampInt(row.lessonsTotal != null ? row.lessonsTotal : row.lessons_total, 0, 200);
  const lessonsDone = Math.min(lessonsTotal, clampInt(row.lessonsDone != null ? row.lessonsDone : row.lessons_done, 0, 200));
  const quizTotal = clampInt(row.quizTotal != null ? row.quizTotal : row.quiz_total, 0, 400);
  const quizCorrect = Math.min(quizTotal, clampInt(row.quizCorrect != null ? row.quizCorrect : row.quiz_correct, 0, 400));
  return {
    id: id,
    at: timeMs(row.at != null ? row.at : row.updatedAt != null ? row.updatedAt : row.updated_at),
    score: score,
    status: status,
    lessonsDone: lessonsDone,
    lessonsTotal: lessonsTotal,
    quizCorrect: quizCorrect,
    quizTotal: quizTotal
  };
}

export function conceptRows(mastery, clocks){
  const src = mastery && typeof mastery === 'object' ? mastery : {};
  const when = clocks && typeof clocks === 'object' ? clocks : {};
  return Object.keys(src).map(function(id){
    const row = src[id];
    if(!row || typeof row !== 'object') return null;
    return normalizeConcept({
      id: row.id || id,
      at: when[id] || when[row.id] || 0,
      score: row.score,
      status: row.status,
      lessonsDone: row.lessonsDone,
      lessonsTotal: row.lessonsTotal,
      quizCorrect: row.quizCorrect,
      quizTotal: row.quizTotal
    });
  }).filter(Boolean);
}

export function normalizeLiteracy(row){
  if(!row || typeof row !== 'object') return null;
  const id = String(row.id || row.snapshotId || row.snapshot_id || '').trim().slice(0, 80);
  if(!id) return null;
  const lessonsTotal = clampInt(row.lessonsTotal != null ? row.lessonsTotal : row.lessons_total, 0, 200);
  const lessonsDone = Math.min(lessonsTotal, clampInt(row.lessonsDone != null ? row.lessonsDone : row.lessons_done, 0, 200));
  const quizTotal = clampInt(row.quizTotal != null ? row.quizTotal : row.quiz_total, 0, 2000);
  const quizCorrect = Math.min(quizTotal, clampInt(row.quizCorrect != null ? row.quizCorrect : row.quiz_correct, 0, 2000));
  const conceptCount = clampInt(row.conceptCount != null ? row.conceptCount : row.concept_count, 0, 40);
  const conceptsTouched = Math.min(conceptCount, clampInt(row.conceptsTouched != null ? row.conceptsTouched : row.concepts_touched, 0, 40));
  return {
    id: id,
    at: timeMs(row.at != null ? row.at : row.capturedAt != null ? row.capturedAt : row.captured_at),
    score: clampInt(row.score, 0, 1000),
    lessonPoints: clampInt(row.lessonPoints != null ? row.lessonPoints : row.lesson_points, 0, 400),
    quizPoints: clampInt(row.quizPoints != null ? row.quizPoints : row.quiz_points, 0, 400),
    breadthPoints: clampInt(row.breadthPoints != null ? row.breadthPoints : row.breadth_points, 0, 200),
    lessonsDone: lessonsDone,
    lessonsTotal: lessonsTotal,
    quizCorrect: quizCorrect,
    quizTotal: quizTotal,
    conceptsTouched: conceptsTouched,
    conceptCount: conceptCount
  };
}

function sameLiteracy(a, b){
  return a.score === b.score && a.lessonPoints === b.lessonPoints && a.quizPoints === b.quizPoints &&
    a.breadthPoints === b.breadthPoints && a.lessonsDone === b.lessonsDone && a.quizTotal === b.quizTotal;
}

export function appendLiteracy(history, literacy, now){
  const src = literacy && typeof literacy === 'object' ? literacy : {};
  const at = timeMs(now) || Date.now();
  const row = normalizeLiteracy({
    id: 'lit:' + at + ':' + clampInt(src.score, 0, 1000),
    at: at,
    score: src.score,
    lessonPoints: src.lessonPoints,
    quizPoints: src.quizPoints,
    breadthPoints: src.breadthPoints,
    lessonsDone: src.lessonsDone,
    lessonsTotal: src.lessonsTotal,
    quizCorrect: src.quizCorrect,
    quizTotal: src.quizTotal,
    conceptsTouched: src.conceptsTouched,
    conceptCount: src.conceptCount
  });
  const prev = (Array.isArray(history) ? history : []).map(normalizeLiteracy).filter(Boolean);
  const latest = prev.slice().sort(function(a, b){ return b.at - a.at; })[0];
  if(latest && sameLiteracy(latest, row)) return prev.slice(-200);
  return prev.concat(row).slice(-200);
}

function cleanScores(scores){
  if(!scores || typeof scores !== 'object' || Array.isArray(scores)) return null;
  const out = {};
  ['accuracy', 'research', 'decision', 'risk'].forEach(function(key){
    const raw = scores[key] && typeof scores[key] === 'object' ? scores[key].score : scores[key];
    if(raw == null || raw === '') return;
    const n = Number(raw);
    if(!isFinite(n)) return;
    out[key] = clampInt(n, 0, 100);
  });
  return Object.keys(out).length ? out : null;
}

export function normalizeThesis(row){
  if(!row || typeof row !== 'object') return null;
  const id = String(row.id || row.entryId || row.entry_id || '').trim().slice(0, 80);
  if(!id) return null;
  const days = Number(row.timeframeDays != null ? row.timeframeDays : row.timeframe_days);
  const confidence = row.confidence == null || row.confidence === '' ? null : clampInt(row.confidence, 0, 100);
  return {
    id: id,
    at: timeMs(row.at != null ? row.at : row.capturedAt != null ? row.capturedAt : row.captured_at),
    ticker: String(row.ticker || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12),
    thesis: String(row.thesis || '').trim().slice(0, 280),
    falsifier: String(row.falsifier || '').trim().slice(0, 280),
    expectedMove: optNum(row.expectedMove != null ? row.expectedMove : row.expected_move, -95, 500, 1),
    timeframeDays: TIMEFRAMES[days] ? days : null,
    confidence: confidence,
    maxStakePct: optNum(row.maxStakePct != null ? row.maxStakePct : row.max_stake_pct, 0.1, 100, 1),
    stakePct: optNum(row.stakePct != null ? row.stakePct : row.stake_pct, 0, 1000, 1),
    status: row.status === 'closed' ? 'closed' : 'open',
    scores: cleanScores(row.scores)
  };
}

export function thesisEntryId(ticker, at){
  const t = String(ticker || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12) || 'NOTE';
  return t + ':' + Math.max(0, Math.round(timeMs(at)));
}

function hasThesis(row){
  if(!row || typeof row !== 'object') return false;
  return !!String(row.thesis || '').trim() || !!String(row.falsifier || '').trim() ||
    (row.confidence != null && row.confidence !== '');
}

export function thesisRowsFromPaper(paper){
  const book = paper && typeof paper === 'object' ? paper : {};
  const rows = [];
  (Array.isArray(book.pos) ? book.pos : []).forEach(function(pos){
    if(!hasThesis(pos)) return;
    const at = timeMs(pos.ts);
    rows.push(normalizeThesis({
      id: thesisEntryId(pos.t, at),
      at: at,
      ticker: pos.t,
      thesis: pos.thesis,
      falsifier: pos.falsifier,
      expectedMove: pos.expectedMove,
      timeframeDays: pos.timeframeDays,
      confidence: pos.confidence,
      maxStakePct: pos.maxStakePct,
      stakePct: pos.stakePct,
      status: 'open',
      scores: null
    }));
  });
  (Array.isArray(book.journal) ? book.journal : []).forEach(function(trade){
    if(!hasThesis(trade)) return;
    const at = timeMs(trade.soldAt) || timeMs(trade.boughtAt);
    rows.push(normalizeThesis({
      id: thesisEntryId(trade.t, trade.boughtAt || trade.soldAt),
      at: at,
      ticker: trade.t,
      thesis: trade.thesis,
      falsifier: trade.falsifier,
      expectedMove: trade.expectedMove,
      timeframeDays: trade.timeframeDays,
      confidence: trade.confidence,
      maxStakePct: trade.maxStakePct,
      stakePct: trade.stakePct,
      status: 'closed',
      scores: trade.scores || null
    }));
  });
  return rows.filter(Boolean);
}

export function mergeThesisIntoPaper(paper, merged){
  const book = paper && typeof paper === 'object' ? paper : {};
  const byId = new Map();
  (Array.isArray(merged) ? merged : []).forEach(function(row){
    const next = normalizeThesis(row);
    if(next) byId.set(next.id, next);
  });
  const used = {};
  function apply(list, status){
    return (Array.isArray(list) ? list : []).map(function(item){
      if(!item || typeof item !== 'object') return item;
      const at = status === 'open' ? item.ts : (item.boughtAt || item.soldAt);
      const id = thesisEntryId(item.t, at);
      const row = byId.get(id);
      if(!row) return item;
      used[id] = 1;
      const localAt = status === 'open' ? timeMs(item.ts) : (timeMs(item.soldAt) || timeMs(item.boughtAt));
      if(timeMs(row.at) <= localAt) return item;
      return Object.assign({}, item, {
        thesis: row.thesis,
        falsifier: row.falsifier,
        expectedMove: row.expectedMove,
        timeframeDays: row.timeframeDays,
        confidence: row.confidence,
        maxStakePct: row.maxStakePct,
        stakePct: row.stakePct
      });
    });
  }
  const next = Object.assign({}, book, {
    pos: apply(book.pos, 'open'),
    journal: apply(book.journal, 'closed')
  });
  const accountOnly = [];
  byId.forEach(function(row){
    if(!used[row.id]) accountOnly.push(row);
  });
  return { paper: next, accountOnly: accountOnly.slice(0, 100) };
}

export function behaviorSnapshot(report, now){
  const detectors = report && Array.isArray(report.detectors) ? report.detectors : [];
  if(!detectors.length) return null;
  const at = timeMs(now) || Date.now();
  const cards = detectors.map(function(card){
    return {
      id: String(card && card.id || '').slice(0, 40),
      status: card && (card.status === 'noticed' || card.status === 'quiet') ? card.status : 'insufficient',
      checks: (card && Array.isArray(card.checks) ? card.checks : []).map(function(check){
        return {
          id: String(check && check.id || '').slice(0, 40),
          state: check && (check.state === 'noticed' || check.state === 'quiet') ? check.state : 'short',
          sample: clampInt(check && check.sample, 0, 10000),
          need: clampInt(check && check.need, 0, 10000)
        };
      }).slice(0, 8)
    };
  }).filter(function(card){ return card.id; }).slice(0, 8);
  if(!cards.length) return null;
  const day = new Date(at).toISOString().slice(0, 10);
  return { id: ('beh:' + day + ':' + hashKey(cards)).slice(0, 80), at: at, cards: cards };
}

export function riskSnapshot(source, report, now){
  const src = source === 'live' ? 'live' : 'paper';
  const metricsIn = report && report.metrics ? report.metrics : {};
  function val(block, key){
    const raw = block ? (key ? block[key] : block.value) : null;
    const n = Number(raw);
    return isFinite(n) ? Math.round(n * 10000) / 10000 : null;
  }
  const metrics = {
    vol: val(metricsIn.vol),
    drawdown: val(metricsIn.drawdown),
    beta: val(metricsIn.beta),
    sharpe: val(metricsIn.sharpe),
    largest: val(metricsIn.concentration, 'largest'),
    hhi: val(metricsIn.concentration, 'hhi'),
    holdings: clampInt(report && report.holdingsUsed && report.holdingsUsed.length, 0, 40)
  };
  const any = metrics.vol != null || metrics.drawdown != null || metrics.beta != null || metrics.sharpe != null || metrics.largest != null;
  if(!any) return null;
  const at = timeMs(now) || Date.now();
  const day = new Date(at).toISOString().slice(0, 10);
  return { id: ('risk:' + src + ':' + day + ':' + hashKey(metrics)).slice(0, 80), at: at, source: src, metrics: metrics };
}

export function normalizeBehavior(row){
  if(!row || typeof row !== 'object') return null;
  const snap = row.cards ? row : null;
  const id = String(row.id || row.snapshotId || row.snapshot_id || '').trim().slice(0, 80);
  if(!id || !snap || !Array.isArray(row.cards)) return null;
  return { id: id, at: timeMs(row.at != null ? row.at : row.capturedAt != null ? row.capturedAt : row.captured_at), cards: row.cards };
}

export function normalizeRisk(row){
  if(!row || typeof row !== 'object') return null;
  const id = String(row.id || row.snapshotId || row.snapshot_id || '').trim().slice(0, 80);
  if(!id || !row.metrics || typeof row.metrics !== 'object') return null;
  return {
    id: id,
    at: timeMs(row.at != null ? row.at : row.capturedAt != null ? row.capturedAt : row.captured_at),
    source: row.source === 'live' ? 'live' : 'paper',
    metrics: row.metrics
  };
}

function cleanPlanItem(item){
  if(!item || typeof item !== 'object') return null;
  const type = PLAN_TYPES[item.type] ? item.type : '';
  const slug = String(item.slug || '').trim().slice(0, 80);
  if(!type || !slug) return null;
  return {
    type: type,
    slug: slug,
    conceptId: String(item.conceptId || item.concept_id || '').slice(0, 40),
    reason: String(item.reason || '').slice(0, 180)
  };
}

export function normalizePlan(row){
  if(!row || typeof row !== 'object') return null;
  const id = String(row.id || row.weekKey || row.week_key || '').trim();
  if(!/^[0-9]{4}-W[0-9]{2}$/.test(id)) return null;
  const items = (Array.isArray(row.items) ? row.items : []).map(cleanPlanItem).filter(Boolean).slice(0, 4);
  return {
    id: id,
    at: timeMs(row.at != null ? row.at : row.generatedAt != null ? row.generatedAt : row.generated_at),
    profileId: String(row.profileId || row.profile_id || '').slice(0, 40),
    items: items
  };
}

export function appendSnapshot(list, row, cap){
  const prev = Array.isArray(list) ? list.slice() : [];
  if(!row || !row.id) return prev.slice(-(cap || 90));
  if(prev.some(function(item){ return item && item.id === row.id; })) return prev.slice(-(cap || 90));
  prev.push(row);
  return prev.slice(-(cap || 90));
}

export function normalizeLesson(row){
  if(!row || typeof row !== 'object') return null;
  const id = String(row.id != null ? row.id : row.lesson_id || '').trim();
  if(!id || id === '_v' || id.length > 80 || !/^[a-z0-9-]+$/i.test(id)) return null;
  const at = timeMs(row.at != null ? row.at : row.completed_at);
  if(at <= 0) return null;
  return { id: id, at: at };
}

export function lessonRowsFromProgress(progress){
  const src = progress && typeof progress === 'object' && !Array.isArray(progress) ? progress : {};
  const out = [];
  Object.keys(src).forEach(function(k){
    if(k === '_v') return;
    const row = normalizeLesson({ id: k, at: src[k] });
    if(row) out.push(row);
  });
  return out.sort(function(a, b){ return timeMs(b.at) - timeMs(a.at); });
}

export function progressFromLessonRows(rows){
  const store = { _v: 1 };
  (Array.isArray(rows) ? rows : []).forEach(function(row){
    const next = normalizeLesson(row);
    if(!next) return;
    if(!store[next.id] || next.at < store[next.id]) store[next.id] = next.at;
  });
  return store;
}

export function mergeRecords(local, remote){
  const map = new Map();
  function take(row){
    if(!row || !row.id) return;
    const prev = map.get(row.id);
    if(!prev){
      map.set(row.id, row);
      return;
    }
    if(timeMs(row.at) > timeMs(prev.at)) map.set(row.id, row);
  }
  (Array.isArray(local) ? local : []).forEach(take);
  (Array.isArray(remote) ? remote : []).forEach(take);
  return Array.from(map.values()).sort(function(a, b){ return timeMs(b.at) - timeMs(a.at); });
}

export function pushWinners(local, remote){
  const remoteAt = new Map();
  (Array.isArray(remote) ? remote : []).forEach(function(row){
    if(row && row.id) remoteAt.set(row.id, timeMs(row.at));
  });
  return (Array.isArray(local) ? local : []).filter(function(row){
    if(!row || !row.id) return false;
    // A zero clock is an untouched concept. Pushing it would look newer than
    // a real score once the server stamps it.
    if(timeMs(row.at) <= 0) return false;
    if(!remoteAt.has(row.id)) return true;
    return timeMs(row.at) >= remoteAt.get(row.id);
  });
}

export function batchRows(rows, size){
  const n = Math.max(1, Math.min(BATCH_SIZE, Number(size) || BATCH_SIZE));
  const src = Array.isArray(rows) ? rows : [];
  const out = [];
  for(let i = 0; i < src.length; i += n) out.push(src.slice(i, i + n));
  return out;
}

export function syncCollections(input){
  const src = input && typeof input === 'object' ? input : {};
  const signedIn = !!(src.signedIn && src.userId);
  const local = src.local && typeof src.local === 'object' ? src.local : {};
  const remote = signedIn && src.remote && typeof src.remote === 'object' ? src.remote : {};
  const merged = {};
  const push = {};
  COLLECTIONS.forEach(function(key){
    const l = Array.isArray(local[key]) ? local[key] : [];
    const r = Array.isArray(remote[key]) ? remote[key] : [];
    merged[key] = mergeRecords(l, r);
    push[key] = signedIn ? pushWinners(l, r) : [];
  });
  if(!signedIn){
    return { upload: false, reason: 'signed_out', userId: null, merged: merged, batches: [] };
  }
  const batches = [];
  COLLECTIONS.forEach(function(key){
    batchRows(push[key], BATCH_SIZE).forEach(function(rows){
      if(rows.length) batches.push({ table: key, rows: rows });
    });
  });
  return { upload: true, reason: 'signed_in', userId: String(src.userId), merged: merged, batches: batches };
}

function iso(at){
  const n = timeMs(at);
  return new Date(n > 0 ? n : 0).toISOString();
}

export function conceptDbRow(userId, row){
  const next = normalizeConcept(row);
  if(!userId || !next) return null;
  return {
    user_id: userId,
    concept_id: next.id,
    score: next.score,
    status: next.status,
    lessons_done: next.lessonsDone,
    lessons_total: next.lessonsTotal,
    quiz_correct: next.quizCorrect,
    quiz_total: next.quizTotal,
    updated_at: iso(next.at)
  };
}

export function literacyDbRow(userId, row){
  const next = normalizeLiteracy(row);
  if(!userId || !next) return null;
  return {
    user_id: userId,
    snapshot_id: next.id,
    score: next.score,
    lesson_points: next.lessonPoints,
    quiz_points: next.quizPoints,
    breadth_points: next.breadthPoints,
    lessons_done: next.lessonsDone,
    lessons_total: next.lessonsTotal,
    quiz_correct: next.quizCorrect,
    quiz_total: next.quizTotal,
    concepts_touched: next.conceptsTouched,
    concept_count: next.conceptCount,
    captured_at: iso(next.at),
    updated_at: iso(next.at)
  };
}

export function thesisDbRow(userId, row){
  const next = normalizeThesis(row);
  if(!userId || !next) return null;
  return {
    user_id: userId,
    entry_id: next.id,
    ticker: next.ticker,
    thesis: next.thesis,
    falsifier: next.falsifier,
    expected_move: next.expectedMove,
    timeframe_days: next.timeframeDays,
    confidence: next.confidence,
    max_stake_pct: next.maxStakePct,
    stake_pct: next.stakePct,
    status: next.status,
    scores: next.scores,
    captured_at: iso(next.at),
    updated_at: iso(next.at)
  };
}

export function behaviorDbRow(userId, row){
  const next = normalizeBehavior(row);
  if(!userId || !next) return null;
  return {
    user_id: userId,
    snapshot_id: next.id,
    captured_at: iso(next.at),
    cards: next.cards,
    updated_at: iso(next.at)
  };
}

export function riskDbRow(userId, row){
  const next = normalizeRisk(row);
  if(!userId || !next) return null;
  return {
    user_id: userId,
    snapshot_id: next.id,
    source: next.source,
    captured_at: iso(next.at),
    metrics: next.metrics,
    updated_at: iso(next.at)
  };
}

export function planDbRow(userId, row){
  const next = normalizePlan(row);
  if(!userId || !next) return null;
  return {
    user_id: userId,
    week_key: next.id,
    profile_id: next.profileId,
    generated_at: timeMs(next.at),
    items: next.items,
    updated_at: iso(next.at)
  };
}

export function conceptFromDb(row){
  if(!row) return null;
  return normalizeConcept({
    id: row.concept_id,
    at: row.updated_at,
    score: row.score,
    status: row.status,
    lessonsDone: row.lessons_done,
    lessonsTotal: row.lessons_total,
    quizCorrect: row.quiz_correct,
    quizTotal: row.quiz_total
  });
}

export function literacyFromDb(row){
  if(!row) return null;
  return normalizeLiteracy({
    id: row.snapshot_id,
    at: row.captured_at,
    score: row.score,
    lessonPoints: row.lesson_points,
    quizPoints: row.quiz_points,
    breadthPoints: row.breadth_points,
    lessonsDone: row.lessons_done,
    lessonsTotal: row.lessons_total,
    quizCorrect: row.quiz_correct,
    quizTotal: row.quiz_total,
    conceptsTouched: row.concepts_touched,
    conceptCount: row.concept_count
  });
}

export function thesisFromDb(row){
  if(!row) return null;
  return normalizeThesis({
    id: row.entry_id,
    at: row.captured_at,
    ticker: row.ticker,
    thesis: row.thesis,
    falsifier: row.falsifier,
    expectedMove: row.expected_move,
    timeframeDays: row.timeframe_days,
    confidence: row.confidence,
    maxStakePct: row.max_stake_pct,
    stakePct: row.stake_pct,
    status: row.status,
    scores: row.scores
  });
}

export function behaviorFromDb(row){
  if(!row) return null;
  return normalizeBehavior({ id: row.snapshot_id, at: row.captured_at, cards: row.cards });
}

export function riskFromDb(row){
  if(!row) return null;
  return normalizeRisk({ id: row.snapshot_id, at: row.captured_at, source: row.source, metrics: row.metrics });
}

export function planFromDb(row){
  if(!row) return null;
  return normalizePlan({ id: row.week_key, at: row.generated_at, profileId: row.profile_id, items: row.items });
}

export function pickMastery(computed, storedRows, clocks){
  const out = {};
  const fromAccount = {};
  const src = computed && typeof computed === 'object' ? computed : {};
  const when = clocks && typeof clocks === 'object' ? clocks : {};
  Object.keys(src).forEach(function(id){
    if(src[id]) out[id] = Object.assign({}, src[id], { fromAccount: false });
  });
  (Array.isArray(storedRows) ? storedRows : []).forEach(function(row){
    const next = normalizeConcept(row);
    if(!next) return;
    const localAt = timeMs(when[next.id]);
    if(out[next.id] && timeMs(next.at) <= localAt) return;
    if(!out[next.id] && timeMs(next.at) <= 0) return;
    const prev = out[next.id];
    out[next.id] = {
      id: next.id,
      label: prev && prev.label ? prev.label : next.id,
      score: next.score,
      status: next.status,
      lessonsDone: next.lessonsDone,
      lessonsTotal: next.lessonsTotal,
      quizCorrect: next.quizCorrect,
      quizTotal: next.quizTotal,
      fromAccount: timeMs(next.at) > localAt
    };
    if(out[next.id].fromAccount) fromAccount[next.id] = 1;
  });
  return { mastery: out, fromAccount: Object.keys(fromAccount).length };
}

export function lessonDbRow(userId, row){
  const next = normalizeLesson(row);
  if(!userId || !next) return null;
  return {
    user_id: userId,
    lesson_id: next.id,
    completed_at: iso(next.at),
    updated_at: iso(next.at)
  };
}

export function lessonFromDb(row){
  if(!row) return null;
  return normalizeLesson({ id: row.lesson_id, at: row.completed_at });
}

const DB = {
  concepts: { table: 'concept_mastery', conflict: 'user_id,concept_id', toRow: conceptDbRow, fromRow: conceptFromDb },
  literacy: { table: 'literacy_scores', conflict: 'user_id,snapshot_id', toRow: literacyDbRow, fromRow: literacyFromDb },
  thesis: { table: 'thesis_entries', conflict: 'user_id,entry_id', toRow: thesisDbRow, fromRow: thesisFromDb },
  behavior: { table: 'behavior_snapshots', conflict: 'user_id,snapshot_id', toRow: behaviorDbRow, fromRow: behaviorFromDb },
  risk: { table: 'risk_snapshots', conflict: 'user_id,snapshot_id', toRow: riskDbRow, fromRow: riskFromDb },
  plans: { table: 'study_plans', conflict: 'user_id,week_key', toRow: planDbRow, fromRow: planFromDb },
  lessons: { table: 'lesson_progress', conflict: 'user_id,lesson_id', toRow: lessonDbRow, fromRow: lessonFromDb }
};

export function tableSpec(key){
  return DB[key] || null;
}
