// Practice-journal pattern notes. The counts describe paper trades saved in
// this browser. They are not a grade of the person, and they are not a
// reason to buy, sell, or size a real position.

import { actualMovePct, directionHit, heldDays } from './thesis.js';

export const PATTERNS_INTRO = 'Your patterns reads the practice journal saved in this browser. Each card publishes its rule and waits for a minimum count. These notes are not a grade of you, and they are not a reason to buy or sell.';

export const OVERCONFIDENCE_RULES = {
  minScored: 5,
  highConfidence: 70,
  minHigh: 3,
  gapPoints: 25,
  minSized: 3,
  oversizeShare: 0.5,
  windowDays: 30,
  minFrequent: 8
};

export const DISPOSITION_RULES = {
  minWinners: 3,
  minLosers: 3,
  holdRatio: 2,
  minGapDays: 7,
  earlyFraction: 0.5,
  minEarly: 3
};

export const PANIC_RULES = {
  minMeasured: 4,
  sharpDrop: -10,
  shortDays: 7,
  minSharp: 2,
  minChecked: 3,
  minContradict: 2
};

const DAY_MS = 86400000;

const LESSON_PSYCHOLOGY = {
  slug: 'psychology-of-money',
  title: 'The Psychology of Money: Why Smart People Make Bad Financial Decisions',
  blurb: 'A free lesson on behaviour and mental traps, including loss aversion. It is background reading. It is not a reason to buy or sell.'
};

const LESSON_MARKET = {
  slug: 'stock-market',
  title: 'How the Stock Market Actually Works',
  blurb: 'A free lesson on how a short-term price move differs from owning a business for years. It is background reading. It is not a reason to buy or sell.'
};

export function overconfidenceCriteria(){
  const r = OVERCONFIDENCE_RULES;
  return 'Three separate counts. A count runs only after its minimum. The card notices a pattern if any count clears its line. ' +
    'Confidence: gap = mean confidence of scored closes at ' + r.highConfidence + '% or above, minus that group’s hit rate in percentage points. Confidence is rounded to the nearest whole number. The hit rate uses the same direction rule as the calibration chart, including the 1-point band on a 0% forecast. ' +
    'Noticed when there are at least ' + r.minScored + ' scored closes, at least ' + r.minHigh + ' of them at ' + r.highConfidence + '% or above, and the gap is ' + r.gapPoints + ' points or more. ' +
    'Size: share = paper rows whose stake percent is above the cap written on the note, divided by rows that have both numbers. Open positions and closed trades both count. Matching the cap is inside it. A row with no recorded size is left out. ' +
    'Noticed when that count is at least ' + r.minSized + ' and the share is at least half. ' +
    'Pace: closed trades whose sell time falls in the last ' + r.windowDays + ' days, including a sale exactly ' + r.windowDays + ' days ago and excluding anything after the clock used for the count. ' +
    'Noticed when that count is ' + r.minFrequent + ' or more. Dollar profit is not in these counts.';
}

export function dispositionCriteria(){
  const r = DISPOSITION_RULES;
  return 'Two counts on closed practice trades. Open positions are left out. A flat result is left out. When dollar profit is recorded, that sign is the result. Otherwise the price change is the result. ' +
    'Hold time uses the buy and sell times when both are present and the sale is not earlier than the buy. Otherwise a recorded hold of zero or more days is used. ' +
    'Hold comparison: median days for losing closes minus median days for winning closes. Noticed when there are at least ' + r.minWinners + ' winning closes and ' + r.minLosers + ' losing closes with a hold time, the gap is at least ' + r.minGapDays + ' days, and the losing median is at least ' + r.holdRatio + ' times the winning median. If the winning median is 0, only the ' + r.minGapDays + '-day gap is required. ' +
    'Early winning closes: a winning close is early when its hold is below half the timeframe written on the note. A hold equal to half stays inside the line. ' +
    'Noticed when at least ' + r.minEarly + ' winning closes have both a hold and a timeframe, and at least 2 of every 3 of those closes are early. Dollar profit does not add points beyond labeling a close as winning or losing.';
}

export function panicCriteria(){
  const r = PANIC_RULES;
  return 'Two counts on closed practice trades. Open positions are left out. ' +
    'Sharp drop: the price change from the recorded buy to the recorded sell is ' + r.sharpDrop + '% or lower, and the hold is ' + r.shortDays + ' days or less. A drop of exactly ' + Math.abs(r.sharpDrop) + '% on day ' + r.shortDays + ' counts. The price change is used here, not the dollar profit field. ' +
    'Noticed when at least ' + r.minMeasured + ' closes have both a price change and a hold, at least ' + r.minSharp + ' of them match, and those matches are at least half of the measured closes. ' +
    'Falsifier: a marked close has the falsifier saved as happened or as not happened, plus a win or a loss. A skipped check is left out. A flat result is left out. ' +
    'A contradicting close is a loss whose falsifier was marked as not happened. Noticed when at least ' + r.minChecked + ' closes are marked, at least ' + r.minContradict + ' of them contradict, and those contradicts are at least half of the marked closes. ' +
    'Clearing a line describes the count. It is not a reason to buy or sell.';
}

function trimNum(n){
  if(!isFinite(Number(n))) return '—';
  const r = Math.round(Number(n) * 10) / 10;
  if(Object.is(r, -0)) return '0';
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function plural(n, word){
  return (n === 1 ? word : word + 's');
}

function asNow(now){
  const n = now == null ? Date.now() : Number(now);
  return isFinite(n) ? n : Date.now();
}

export function bookOf(input){
  if(Array.isArray(input)) return { journal: input, pos: [] };
  const src = input && typeof input === 'object' ? input : {};
  return {
    journal: Array.isArray(src.journal) ? src.journal : [],
    pos: Array.isArray(src.pos) ? src.pos : []
  };
}

function rowsOf(list){
  if(!Array.isArray(list)) return [];
  return list.filter(function(row){ return !!row && typeof row === 'object' && !Array.isArray(row); });
}

export function scoredClose(trade){
  if(!trade || typeof trade !== 'object' || Array.isArray(trade)) return null;
  if(trade.confidence == null || String(trade.confidence).trim() === '') return null;
  const raw = Number(trade.confidence);
  if(!isFinite(raw) || raw < 0 || raw > 100) return null;
  const confidence = Math.round(raw);
  let hit = trade.hit;
  if(typeof hit !== 'boolean'){
    const actual = isFinite(Number(trade.actualPct)) ? Number(trade.actualPct) : actualMovePct(trade.buyPrice, trade.sellPrice);
    // actualMovePct returns null when a price is missing. Number(null) is 0,
    // so a missing price must not be handed to the direction check.
    hit = actual == null ? null : directionHit(trade.expectedMove, actual);
  }
  if(typeof hit !== 'boolean') return null;
  return { confidence: confidence, hit: hit };
}

export function tradeHeldDays(trade){
  if(!trade || typeof trade !== 'object' || Array.isArray(trade)) return null;
  const fromStamps = heldDays(trade.boughtAt, trade.soldAt);
  if(fromStamps != null) return fromStamps;
  const field = Number(trade.heldDays);
  if(isFinite(field) && field >= 0) return field;
  return null;
}

export function tradeOutcome(trade){
  if(!trade || typeof trade !== 'object' || Array.isArray(trade)) return null;
  if(isFinite(Number(trade.pnl))){
    const n = Number(trade.pnl);
    if(n > 0) return 'win';
    if(n < 0) return 'loss';
    return 'flat';
  }
  const pct = tradeMovePct(trade);
  if(pct == null) return null;
  if(pct > 0) return 'win';
  if(pct < 0) return 'loss';
  return 'flat';
}

export function tradeMovePct(trade){
  if(!trade || typeof trade !== 'object' || Array.isArray(trade)) return null;
  if(isFinite(Number(trade.actualPct))) return Number(trade.actualPct);
  return actualMovePct(trade.buyPrice, trade.sellPrice);
}

export function falsifierMark(trade){
  if(!trade || typeof trade !== 'object') return null;
  if(trade.falsifierHappened === true) return true;
  if(trade.falsifierHappened === false) return false;
  return null;
}

export function sizeOf(row){
  if(!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const stake = Number(row.stakePct);
  const cap = Number(row.maxStakePct);
  if(!isFinite(stake) || stake < 0 || !isFinite(cap) || cap <= 0) return null;
  return { stake: stake, cap: cap, over: stake > cap };
}

export function inRecentWindow(soldAt, now, windowDays){
  const t = Number(soldAt);
  const clock = Number(now);
  const days = Number(windowDays);
  if(!isFinite(t) || !isFinite(clock) || !isFinite(days) || days < 0) return false;
  return t >= clock - days * DAY_MS && t <= clock;
}

export function median(values){
  const nums = (Array.isArray(values) ? values : []).filter(function(n){ return isFinite(Number(n)); }).map(Number).sort(function(a, b){ return a - b; });
  if(!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if(nums.length % 2) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

function atLeastHalf(part, whole){
  return whole > 0 && part * 2 >= whole;
}

function check(spec){
  const ready = !!spec.ready;
  const fired = ready && !!spec.fired;
  return {
    id: spec.id,
    label: spec.label,
    state: !ready ? 'short' : fired ? 'noticed' : 'quiet',
    ready: ready,
    fired: fired,
    sample: spec.sample,
    need: spec.need,
    line: spec.line,
    headline: spec.headline,
    stats: spec.stats || {}
  };
}

function assemble(meta, checks){
  const fired = checks.filter(function(c){ return c.fired; });
  let status = 'insufficient';
  if(fired.length) status = 'noticed';
  else if(checks.some(function(c){ return c.ready; })) status = 'quiet';
  const statusLabel = status === 'noticed'
    ? 'A pattern showed up'
    : status === 'quiet'
      ? 'Nothing stands out yet'
      : 'Not enough data yet';
  let headline;
  if(status === 'insufficient') headline = 'Not enough data yet. The counts below show what this card is waiting for.';
  else if(status === 'quiet') headline = 'The counts with enough trades are still inside the lines in the rule.';
  else if(fired.length === 1) headline = fired[0].headline;
  else headline = 'More than one count cleared its line. Each line is restated in the rule.';
  return {
    id: meta.id,
    title: meta.title,
    status: status,
    statusLabel: statusLabel,
    headline: headline,
    criteria: meta.criteria,
    lesson: meta.lesson,
    prompt: meta.prompts[status],
    checks: checks
  };
}

function mean(values){
  if(!values.length) return null;
  let sum = 0;
  for(let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

export function detectOverconfidence(input, now){
  const r = OVERCONFIDENCE_RULES;
  const clock = asNow(now);
  const book = bookOf(input);
  const journal = rowsOf(book.journal);
  const scored = [];
  journal.forEach(function(trade){
    const row = scoredClose(trade);
    if(row) scored.push(row);
  });
  const high = scored.filter(function(row){ return row.confidence >= r.highConfidence; });
  const hits = high.filter(function(row){ return row.hit; }).length;
  const meanConfidence = mean(high.map(function(row){ return row.confidence; }));
  const hitRatePct = high.length ? (hits / high.length) * 100 : null;
  const gap = (meanConfidence == null || hitRatePct == null) ? null : meanConfidence - hitRatePct;
  const calibrationReady = scored.length >= r.minScored && high.length >= r.minHigh && gap != null;
  const calibrationFired = calibrationReady && gap >= r.gapPoints;
  const calibrationLine = scored.length + ' scored ' + plural(scored.length, 'close') + ' (need ' + r.minScored + '). ' +
    high.length + ' at ' + r.highConfidence + '% or above (need ' + r.minHigh + ').' +
    (high.length && gap != null
      ? ' Mean confidence ' + trimNum(meanConfidence) + ' − hit rate ' + trimNum(hitRatePct) + ' = gap ' + trimNum(gap) + '. The line is a gap of ' + r.gapPoints + ' or more.'
      : '');

  const sized = [];
  rowsOf(book.journal).concat(rowsOf(book.pos)).forEach(function(row){
    const size = sizeOf(row);
    if(size) sized.push(size);
  });
  const over = sized.filter(function(row){ return row.over; }).length;
  const sizeReady = sized.length >= r.minSized;
  const sizeFired = sizeReady && atLeastHalf(over, sized.length);
  const sizeLine = sizeReady
    ? over + ' of ' + sized.length + ' sized trades used more than the written cap. The line is at least half, once ' + r.minSized + ' trades have both numbers. Matching the cap counts as inside it.'
    : sized.length + ' sized ' + plural(sized.length, 'trade') + ' (need ' + r.minSized + '). A sized trade has both a stake percent and a cap.';

  let inWindow = 0;
  journal.forEach(function(trade){
    if(inRecentWindow(trade.soldAt, clock, r.windowDays)) inWindow += 1;
  });
  const paceReady = inWindow >= r.minFrequent;
  const paceLine = paceReady
    ? inWindow + ' closed trades in the last ' + r.windowDays + ' days. The line is ' + r.minFrequent + ' or more.'
    : inWindow + ' closed ' + plural(inWindow, 'trade') + ' in the last ' + r.windowDays + ' days (need ' + r.minFrequent + ').';

  return assemble({
    id: 'overconfidence',
    title: 'Overconfidence',
    criteria: overconfidenceCriteria(),
    lesson: Object.assign({}, LESSON_PSYCHOLOGY, {
      blurb: 'The lesson’s opening idea is that behaviour can outweigh a careful note. A high confidence number is one place that shows up. It is reading, not a grade, and not a reason to buy or sell.'
    }),
    prompts: {
      insufficient: 'After a few more closes, you might ask what the confidence number was standing in for.',
      quiet: 'The lines on this card are holding. Before the next note, what fact would make the confidence number smaller?',
      noticed: 'Before the next practice note, what fact would make the confidence number lower than the one you first reached for?'
    }
  }, [
    check({
      id: 'calibration',
      label: 'High confidence vs hit rate',
      ready: calibrationReady,
      fired: calibrationFired,
      sample: scored.length,
      need: r.minScored,
      line: calibrationLine,
      headline: 'High confidence ran ahead of how often the price followed the note.',
      stats: { scored: scored.length, high: high.length, hits: hits, mean: meanConfidence, hitRatePct: hitRatePct, gap: gap }
    }),
    check({
      id: 'size',
      label: 'Size versus the cap you wrote',
      ready: sizeReady,
      fired: sizeFired,
      sample: sized.length,
      need: r.minSized,
      line: sizeLine,
      headline: 'More than half of the sized trades were above the cap written on the note.',
      stats: { sized: sized.length, over: over, share: sized.length ? over / sized.length : null }
    }),
    check({
      id: 'pace',
      label: 'Closed trades in 30 days',
      ready: paceReady,
      fired: paceReady,
      sample: inWindow,
      need: r.minFrequent,
      line: paceLine,
      headline: 'Closed practice trades came through quickly over ' + r.windowDays + ' days.',
      stats: { inWindow: inWindow, windowDays: r.windowDays }
    })
  ]);
}

export function detectDisposition(input){
  const r = DISPOSITION_RULES;
  const journal = rowsOf(bookOf(input).journal);
  const winningHolds = [];
  const losingHolds = [];
  const earlyPool = [];
  journal.forEach(function(trade){
    const outcome = tradeOutcome(trade);
    if(outcome !== 'win' && outcome !== 'loss') return;
    const held = tradeHeldDays(trade);
    if(held == null) return;
    if(outcome === 'win') winningHolds.push(held);
    else losingHolds.push(held);
    const timeframe = Number(trade.timeframeDays);
    if(outcome === 'win' && isFinite(timeframe) && timeframe > 0){
      earlyPool.push(held < timeframe * r.earlyFraction);
    }
  });
  const medianWin = median(winningHolds);
  const medianLoss = median(losingHolds);
  const holdReady = winningHolds.length >= r.minWinners && losingHolds.length >= r.minLosers && medianWin != null && medianLoss != null;
  const gapDays = holdReady ? medianLoss - medianWin : null;
  const ratio = holdReady && medianWin > 0 ? medianLoss / medianWin : null;
  const ratioOk = !holdReady ? false : medianWin <= 0 ? true : ratio >= r.holdRatio;
  const holdFired = holdReady && gapDays >= r.minGapDays && ratioOk;
  const holdLine = 'Winning closes with a hold time: ' + winningHolds.length + ' (need ' + r.minWinners + '). Losing closes with a hold time: ' + losingHolds.length + ' (need ' + r.minLosers + ').' +
    (holdReady
      ? ' Median hold is ' + trimNum(medianLoss) + ' days for losing closes and ' + trimNum(medianWin) + ' days for winning closes (' +
        (medianWin <= 0 ? 'winner median is 0, so the ratio is not used' : 'ratio ' + trimNum(ratio)) +
        ', gap ' + trimNum(gapDays) + ' days). The line is a gap of at least ' + r.minGapDays + ' days and a ratio of ' + r.holdRatio + ' or more, unless the winner median is 0.'
      : '');

  const earlyCount = earlyPool.filter(Boolean).length;
  const earlyReady = earlyPool.length >= r.minEarly;
  const earlyFired = earlyReady && earlyCount * 3 >= earlyPool.length * 2;
  const earlyLine = earlyReady
    ? earlyCount + ' of ' + earlyPool.length + ' winning closes were sold before half the written timeframe. The line is at least 2 of every 3, once ' + r.minEarly + ' winning closes have both numbers. A hold equal to half the timeframe stays inside the line.'
    : 'Winning closes with a hold time and a timeframe: ' + earlyPool.length + ' (need ' + r.minEarly + ').';

  return assemble({
    id: 'disposition',
    title: 'Loss aversion (disposition effect)',
    criteria: dispositionCriteria(),
    lesson: Object.assign({}, LESSON_PSYCHOLOGY, {
      blurb: 'The lesson has a short section on loss aversion: a loss can feel louder than a similar gain. That is the idea behind this count. It is not a verdict, and not a reason to buy or sell.'
    }),
    prompts: {
      insufficient: 'When a later close has a hold time, you might look back at whether it was a winning close or a losing close.',
      quiet: 'The hold times in this journal are still inside the lines. What was the falsifier waiting on for the longer closes?',
      noticed: 'For a losing close that stayed open longer, what was the falsifier waiting to see?'
    }
  }, [
    check({
      id: 'hold',
      label: 'Holding losing closes longer',
      ready: holdReady,
      fired: holdFired,
      sample: Math.min(winningHolds.length, losingHolds.length),
      need: r.minWinners,
      line: holdLine,
      headline: 'Losing closes were held much longer than winning closes.',
      stats: {
        winners: winningHolds.length,
        losers: losingHolds.length,
        medianWinner: medianWin,
        medianLoser: medianLoss,
        ratio: ratio,
        gapDays: gapDays
      }
    }),
    check({
      id: 'early',
      label: 'Selling winning closes early',
      ready: earlyReady,
      fired: earlyFired,
      sample: earlyPool.length,
      need: r.minEarly,
      line: earlyLine,
      headline: 'Winning closes were sold before half the timeframe written on the note.',
      stats: { eligible: earlyPool.length, early: earlyCount, share: earlyPool.length ? earlyCount / earlyPool.length : null }
    })
  ]);
}

export function detectPanic(input){
  const r = PANIC_RULES;
  const journal = rowsOf(bookOf(input).journal);
  let measured = 0;
  let sharp = 0;
  let checked = 0;
  let contradict = 0;
  journal.forEach(function(trade){
    const move = tradeMovePct(trade);
    const held = tradeHeldDays(trade);
    if(move != null && held != null){
      measured += 1;
      if(move <= r.sharpDrop && held <= r.shortDays) sharp += 1;
    }
    const mark = falsifierMark(trade);
    const outcome = tradeOutcome(trade);
    if(mark == null || (outcome !== 'win' && outcome !== 'loss')) return;
    checked += 1;
    if(mark === false && outcome === 'loss') contradict += 1;
  });
  const sharpReady = measured >= r.minMeasured;
  const sharpFired = sharpReady && sharp >= r.minSharp && atLeastHalf(sharp, measured);
  const sharpLine = sharpReady
    ? sharp + ' of ' + measured + ' measured closes fell ' + Math.abs(r.sharpDrop) + '% or more and were sold within ' + r.shortDays + ' days. The line is at least ' + r.minSharp + ', and at least half of the measured closes.'
    : measured + ' ' + plural(measured, 'close') + ' with a price move and a hold time (need ' + r.minMeasured + ').';
  const markReady = checked >= r.minChecked;
  const markFired = markReady && contradict >= r.minContradict && atLeastHalf(contradict, checked);
  const markLine = markReady
    ? contradict + ' of ' + checked + ' marked closes were losses sold while the falsifier was marked as not happened. The line is at least ' + r.minContradict + ', and at least half of the marked closes. A skipped check is left out. A gain is left out.'
    : checked + ' ' + plural(checked, 'close') + ' with a falsifier mark and a win or a loss (need ' + r.minChecked + ').';

  return assemble({
    id: 'panic',
    title: 'Panic selling',
    criteria: panicCriteria(),
    lesson: Object.assign({}, LESSON_MARKET, {
      blurb: 'The lesson contrasts a short-term price move with staying with a business through a drop. It is background reading. It is not a reason to buy or sell.'
    }),
    prompts: {
      insufficient: 'After more closes, this card can compare the price path with the falsifier mark.',
      quiet: 'The sharp-drop and falsifier counts are inside their lines. Which of those two lines do you want to keep an eye on?',
      noticed: 'On a close that went against the note, what did the falsifier say, and was that the thing you looked at before the sale?'
    }
  }, [
    check({
      id: 'sharp',
      label: 'Sharp drop sold within a week',
      ready: sharpReady,
      fired: sharpFired,
      sample: measured,
      need: r.minMeasured,
      line: sharpLine,
      headline: 'Some closes were sharp drops sold within a week of the buy.',
      stats: { measured: measured, sharp: sharp, share: measured ? sharp / measured : null }
    }),
    check({
      id: 'falsifier',
      label: 'Sold at a loss while the falsifier had not happened',
      ready: markReady,
      fired: markFired,
      sample: checked,
      need: r.minChecked,
      line: markLine,
      headline: 'Some losing closes were sold even though the falsifier was marked as not happened.',
      stats: { checked: checked, contradict: contradict, share: checked ? contradict / checked : null }
    })
  ]);
}

export function detectPatterns(input, now){
  const clock = asNow(now);
  return {
    intro: PATTERNS_INTRO,
    detectors: [
      detectOverconfidence(input, clock),
      detectDisposition(input, clock),
      detectPanic(input, clock)
    ]
  };
}
