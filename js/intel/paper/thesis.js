// Structured thesis lab for paper trades.
// Scores grade the note written before a practice buy. They are not a
// signal to buy, sell, or size a real position. Nothing here is advice.

export const NOTE_MAX = 280;
export const RESEARCH_MIN_CHARS = 24;
export const RESEARCH_POINTS = { claim: 40, falsifier: 40, forecast: 20 };
export const ACCURACY_BAND_FLOOR = 5;
export const FLAT_HIT_POINTS = 1;
export const TIME_EARLY = 0.5;
export const TIME_LATE = 1.25;
export const EXPECTED_MIN = -95;
export const EXPECTED_MAX = 500;

export const TIMEFRAMES = [
  { days: 7, label: '1 week' },
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
  { days: 365, label: '1 year' }
];

export const CALIBRATION_BUCKETS = [
  { id: '0-49', label: '0–49%', lo: 0, hi: 49 },
  { id: '50-59', label: '50–59%', lo: 50, hi: 59 },
  { id: '60-69', label: '60–69%', lo: 60, hi: 69 },
  { id: '70-79', label: '70–79%', lo: 70, hi: 79 },
  { id: '80-89', label: '80–89%', lo: 80, hi: 89 },
  { id: '90-100', label: '90–100%', lo: 90, hi: 100 }
];

export const FORMULAS = [
  {
    id: 'accuracy',
    title: 'Accuracy',
    text: 'accuracy = round(100 × (1 − min(1, |actual% − expected%| ÷ (2 × max(|expected%|, 5)))))'
  },
  {
    id: 'research',
    title: 'Research quality',
    text: 'research quality = claim + falsifier + forecast. Claim is 40 if the thesis is at least 24 characters, else 0. Falsifier is 40 if it is at least 24 characters and not the same words as the thesis, else 0. Forecast is 20 if the expected move, timeframe, and confidence are filled in, else 0.'
  },
  {
    id: 'decision',
    title: 'Decision quality',
    text: 'decision quality = round(100 × (½ × on-time + ½ × checked)). Checked is 1 if you mark that the falsifier did or did not happen, else 0. On-time is 1 if the falsifier happened, or if days held ÷ timeframe is from 0.5 through 1.25. Earlier than that, on-time = (days held ÷ timeframe) ÷ 0.5. Later than that, on-time = min(1, 1.25 ÷ (days held ÷ timeframe)). Profit is not in this formula.'
  },
  {
    id: 'risk',
    title: 'Risk discipline',
    text: 'risk discipline = 100 if the buy used no more of the paper account than the cap you wrote. Otherwise round(100 × cap% ÷ stake%). Stake% is position cost ÷ paper account at cost, after the buy. A gain or a loss does not change this score.'
  }
];

export const LAB_NOTE = 'Scores grade the note you wrote before the practice buy. They are not a reason to buy or sell.';

export function clampNote(s){
  s = String(s == null ? '' : s).trim();
  if(s.length > NOTE_MAX) s = s.slice(0, NOTE_MAX).trim();
  return s;
}

export function clampScore(n){
  if(!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function round1(n){
  return Math.round(n * 10) / 10;
}

function parseRequiredNumber(raw){
  if(typeof raw === 'number') return isFinite(raw) ? raw : null;
  const s = String(raw == null ? '' : raw).trim();
  if(!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function finiteOrNull(n){
  const x = Number(n);
  return isFinite(x) ? x : null;
}

export function sameClaim(a, b){
  const norm = function(s){ return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); };
  return norm(a) === norm(b);
}

export function timeframeLabel(days){
  const n = Number(days);
  const hit = TIMEFRAMES.find(function(t){ return t.days === n; });
  if(hit) return hit.label;
  if(!isFinite(n) || n <= 0) return '—';
  return n + ' days';
}

export function formatMove(n){
  if(!isFinite(Number(n))) return '—';
  const r = round1(Number(n));
  const body = Number.isInteger(r) ? String(r) : r.toFixed(1);
  return (r > 0 ? '+' : '') + body + '%';
}

export function formatStake(n){
  if(!isFinite(Number(n))) return '—';
  const r = round1(Number(n));
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + '%';
}

function forecastReady(plan){
  const move = Number(plan && plan.expectedMove);
  const days = Number(plan && plan.timeframeDays);
  const conf = Number(plan && plan.confidence);
  const allowed = TIMEFRAMES.some(function(t){ return t.days === days; });
  return isFinite(move) && move >= EXPECTED_MIN && move <= EXPECTED_MAX &&
    allowed && isFinite(conf) && conf >= 0 && conf <= 100;
}

export function readPlan(raw){
  const src = raw || {};
  const errors = [];
  const thesis = clampNote(src.thesis);
  const falsifier = clampNote(src.falsifier);
  if(!thesis) errors.push('Write a short thesis first — why are you buying?');
  if(!falsifier) errors.push('Write a falsifier — what would prove this thesis wrong?');

  const expectedRaw = parseRequiredNumber(src.expectedMove);
  let expectedMove = null;
  if(expectedRaw == null) errors.push('Enter an expected move, such as 8 or −5.');
  else if(expectedRaw < EXPECTED_MIN || expectedRaw > EXPECTED_MAX) errors.push('Enter an expected move from −95% to 500%.');
  else expectedMove = expectedRaw === 0 ? 0 : round1(expectedRaw);

  const daysRaw = parseRequiredNumber(src.timeframeDays);
  const timeframeDays = daysRaw == null ? null : daysRaw;
  if(!TIMEFRAMES.some(function(t){ return t.days === timeframeDays; })) errors.push('Choose a timeframe.');

  const confRaw = parseRequiredNumber(src.confidence);
  let confidence = null;
  if(confRaw == null || confRaw < 0 || confRaw > 100) errors.push('Enter a confidence from 0 to 100.');
  else confidence = Math.round(confRaw);

  const capRaw = parseRequiredNumber(src.maxStakePct);
  let maxStakePct = null;
  if(capRaw == null || capRaw <= 0 || capRaw > 100) errors.push('Enter a paper-account cap above 0 and up to 100.');
  else maxStakePct = round1(capRaw);

  return {
    ok: errors.length === 0,
    error: errors[0] || '',
    errors: errors,
    plan: {
      thesis: thesis,
      falsifier: falsifier,
      expectedMove: expectedMove,
      timeframeDays: timeframeDays,
      confidence: confidence,
      maxStakePct: maxStakePct
    }
  };
}

export function actualMovePct(buyPrice, sellPrice){
  const buy = Number(buyPrice);
  const sell = Number(sellPrice);
  if(!isFinite(buy) || buy <= 0 || !isFinite(sell)) return null;
  return (sell - buy) / buy * 100;
}

export function directionHit(expectedPct, actualPct){
  const expected = Number(expectedPct);
  const actual = Number(actualPct);
  if(!isFinite(expected) || !isFinite(actual)) return null;
  if(expected === 0) return Math.abs(actual) <= FLAT_HIT_POINTS;
  if(actual === 0) return false;
  return Math.sign(expected) === Math.sign(actual);
}

export function scoreAccuracy(expectedPct, actualPct){
  const expected = Number(expectedPct);
  const actual = Number(actualPct);
  if(!isFinite(expected) || !isFinite(actual)) return null;
  const error = Math.abs(actual - expected);
  const band = Math.max(Math.abs(expected), ACCURACY_BAND_FLOOR);
  const ratio = Math.min(1, error / (2 * band));
  return { score: clampScore(100 * (1 - ratio)), error: error, band: band };
}

export function explainAccuracy(result){
  if(!result) return '';
  return 'round(100 × (1 − min(1, ' + trimNum(result.error) + ' ÷ ' + trimNum(2 * result.band) + '))) = ' + result.score;
}

export function scoreResearch(plan){
  const thesis = String(plan && plan.thesis || '').trim();
  const falsifier = String(plan && plan.falsifier || '').trim();
  const claim = thesis.length >= RESEARCH_MIN_CHARS ? RESEARCH_POINTS.claim : 0;
  const falsifierPts = (falsifier.length >= RESEARCH_MIN_CHARS && !sameClaim(thesis, falsifier)) ? RESEARCH_POINTS.falsifier : 0;
  const forecast = forecastReady(plan) ? RESEARCH_POINTS.forecast : 0;
  return {
    score: claim + falsifierPts + forecast,
    claim: claim,
    falsifier: falsifierPts,
    forecast: forecast
  };
}

export function explainResearch(result){
  if(!result) return '';
  return 'claim ' + result.claim + ' + falsifier ' + result.falsifier + ' + forecast ' + result.forecast + ' = ' + result.score;
}

export function scoreDecision(timeframeDays, heldDays, falsifierHappened){
  const days = Number(timeframeDays);
  const held = Number(heldDays);
  if(!isFinite(days) || days <= 0 || !isFinite(held) || held < 0) return null;
  const windowRatio = held / days;
  let onTime;
  if(falsifierHappened === true) onTime = 1;
  else if(windowRatio >= TIME_EARLY && windowRatio <= TIME_LATE) onTime = 1;
  else if(windowRatio < TIME_EARLY) onTime = windowRatio / TIME_EARLY;
  else onTime = Math.min(1, TIME_LATE / windowRatio);
  const checked = (falsifierHappened === true || falsifierHappened === false) ? 1 : 0;
  return {
    score: clampScore(100 * (0.5 * onTime + 0.5 * checked)),
    onTime: onTime,
    checked: checked,
    window: windowRatio
  };
}

export function explainDecision(timeframeDays, heldDays, falsifierHappened, result){
  if(!result) return '';
  const held = trimNum(heldDays);
  const days = trimNum(timeframeDays);
  let onTimeText;
  if(falsifierHappened === true) onTimeText = '1 (falsifier happened)';
  else if(result.window >= TIME_EARLY && result.window <= TIME_LATE) onTimeText = '1 (held ' + held + ' of ' + days + ' days)';
  else if(result.window < TIME_EARLY) onTimeText = '(' + held + ' ÷ ' + days + ') ÷ 0.5';
  else onTimeText = 'min(1, 1.25 ÷ (' + held + ' ÷ ' + days + '))';
  return 'round(100 × (½ × ' + onTimeText + ' + ½ × ' + result.checked + ')) = ' + result.score;
}

export function scoreRisk(stakePct, maxStakePct){
  const stake = Number(stakePct);
  const cap = Number(maxStakePct);
  if(!isFinite(stake) || stake < 0 || !isFinite(cap) || cap <= 0) return null;
  if(stake <= cap) return { score: 100, stakePct: stake, maxStakePct: cap, inside: true };
  return { score: clampScore(100 * cap / stake), stakePct: stake, maxStakePct: cap, inside: false };
}

export function explainRisk(result){
  if(!result) return '';
  if(result.inside) return 'stake ' + trimNum(result.stakePct) + '% is inside cap ' + trimNum(result.maxStakePct) + '% = ' + result.score;
  return 'round(100 × ' + trimNum(result.maxStakePct) + ' ÷ ' + trimNum(result.stakePct) + ') = ' + result.score;
}

export function heldDays(boughtAt, soldAt){
  const a = Number(boughtAt);
  const b = Number(soldAt);
  if(!isFinite(a) || !isFinite(b) || b < a) return null;
  return (b - a) / 86400000;
}

export function accountStakePct(cash, positions, ticker){
  if(!isFinite(Number(cash)) || Number(cash) < 0 || !Array.isArray(positions)) return null;
  let account = Number(cash);
  let positionCost = 0;
  for(let i = 0; i < positions.length; i++){
    const p = positions[i];
    if(!p || !isFinite(Number(p.price)) || !isFinite(Number(p.sh))) return null;
    const cost = Number(p.price) * Number(p.sh);
    if(cost < 0) return null;
    account += cost;
    if(p.t === ticker) positionCost += cost;
  }
  if(account <= 0) return null;
  return positionCost / account * 100;
}

export function isStructured(entry){
  if(!entry) return false;
  return !!String(entry.falsifier || '').trim() && isFinite(Number(entry.expectedMove));
}

function happenedOf(value){
  if(value === true) return true;
  if(value === false) return false;
  return null;
}

export function closedTradeFromPosition(position, sale){
  const pos = position || {};
  const fill = sale || {};
  return {
    t: pos.t,
    sh: pos.sh,
    thesis: pos.thesis || '',
    falsifier: pos.falsifier || '',
    expectedMove: finiteOrNull(pos.expectedMove),
    timeframeDays: finiteOrNull(pos.timeframeDays),
    confidence: finiteOrNull(pos.confidence),
    maxStakePct: finiteOrNull(pos.maxStakePct),
    stakePct: finiteOrNull(pos.stakePct),
    buyPrice: pos.price,
    sellPrice: fill.sellPrice,
    boughtAt: pos.ts || null,
    soldAt: fill.soldAt,
    falsifierHappened: happenedOf(fill.falsifierHappened)
  };
}

export function gradeClosed(entry){
  if(!isStructured(entry)) return null;
  const actualPct = isFinite(Number(entry.actualPct)) ? Number(entry.actualPct) : actualMovePct(entry.buyPrice, entry.sellPrice);
  if(actualPct == null) return null;
  const held = isFinite(Number(entry.heldDays)) ? Number(entry.heldDays) : heldDays(entry.boughtAt, entry.soldAt);
  const happened = happenedOf(entry.falsifierHappened);
  return {
    actualPct: actualPct,
    hit: directionHit(entry.expectedMove, actualPct),
    heldDays: held,
    falsifierHappened: happened,
    accuracy: scoreAccuracy(entry.expectedMove, actualPct),
    research: scoreResearch(entry),
    decision: held == null ? null : scoreDecision(entry.timeframeDays, held, happened),
    risk: scoreRisk(entry.stakePct, entry.maxStakePct)
  };
}

function trimNum(n){
  if(!isFinite(Number(n))) return '—';
  const r = Math.round(Number(n) * 1000) / 1000;
  return String(r);
}

export function calibrate(trades){
  const buckets = CALIBRATION_BUCKETS.map(function(b){
    return { id: b.id, label: b.label, lo: b.lo, hi: b.hi, n: 0, hits: 0, hitRate: null };
  });
  let skipped = 0;
  const list = Array.isArray(trades) ? trades : [];
  list.forEach(function(trade){
    if(!trade || typeof trade !== 'object'){ skipped++; return; }
    if(trade.confidence == null || String(trade.confidence).trim() === ''){ skipped++; return; }
    const raw = Number(trade.confidence);
    if(!isFinite(raw) || raw < 0 || raw > 100){ skipped++; return; }
    const confidence = Math.round(raw);
    let hit = trade.hit;
    if(typeof hit !== 'boolean'){
      const actual = isFinite(Number(trade.actualPct)) ? Number(trade.actualPct) : actualMovePct(trade.buyPrice, trade.sellPrice);
      hit = directionHit(trade.expectedMove, actual);
    }
    if(typeof hit !== 'boolean'){ skipped++; return; }
    const bucket = buckets.find(function(b){ return confidence >= b.lo && confidence <= b.hi; });
    if(!bucket){ skipped++; return; }
    bucket.n += 1;
    if(hit) bucket.hits += 1;
  });
  buckets.forEach(function(b){ b.hitRate = b.n ? b.hits / b.n : null; });
  return { buckets: buckets, skipped: skipped };
}
