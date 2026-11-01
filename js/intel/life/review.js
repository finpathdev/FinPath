// Yearly Decision Journal review. Pure aggregation over items mergeJournal
// already builds, plus literacy and identity snapshots the page computes.
// Educational summary only. No advice, no network, no second copy of the stores.

const MIN_AT = 946684800000; // 2000-01-01. Same cutoff the journal timeline uses.

export function dated(at){
  const n = Number(at);
  return isFinite(n) && n >= MIN_AT;
}

export function yearWindow(year, nowMs){
  const now = Number(nowMs);
  if(!isFinite(now)) return null;
  const clock = new Date(now);
  const picked = year == null || year === '' ? clock.getFullYear() : Math.floor(Number(year));
  if(!isFinite(picked) || picked < 1970 || picked > 9999) return null;
  const start = new Date(picked, 0, 1, 0, 0, 0, 0).getTime();
  const next = new Date(picked + 1, 0, 1, 0, 0, 0, 0).getTime();
  if(!isFinite(start) || !isFinite(next) || next <= start) return null;
  if(now < start){
    return { year: picked, start: start, end: start, partial: false, label: String(picked) };
  }
  if(now >= next){
    return { year: picked, start: start, end: next, partial: false, label: String(picked) };
  }
  return { year: picked, start: start, end: now + 1, partial: true, label: picked + ' so far' };
}

export function inWindow(at, window){
  if(!window || !dated(at)) return false;
  const n = Number(at);
  return n >= window.start && n < window.end;
}

export function yearsPresent(items, nowMs){
  const now = Number(nowMs);
  const clock = new Date(isFinite(now) ? now : 0);
  const set = {};
  if(isFinite(clock.getFullYear())) set[clock.getFullYear()] = true;
  (Array.isArray(items) ? items : []).forEach(function(item){
    if(!item || !dated(item.at)) return;
    set[new Date(Number(item.at)).getFullYear()] = true;
  });
  return Object.keys(set).map(Number).filter(function(y){ return isFinite(y); }).sort(function(a, b){ return b - a; });
}

export function sliceProgress(progress, endExclusive){
  const src = progress && typeof progress === 'object' && !Array.isArray(progress) ? progress : {};
  const end = Number(endExclusive);
  const out = {};
  Object.keys(src).forEach(function(k){
    if(k === '_v') return;
    const ts = Number(src[k]);
    if(dated(ts)){
      if(isFinite(end) && ts < end) out[k] = ts;
      return;
    }
    // A completion with no clock still counts as already done, so a missing
    // date cannot look like a jump inside one year.
    if(src[k]) out[k] = 1;
  });
  return out;
}

export function sliceQuizLog(log, endExclusive){
  const attempts = log && Array.isArray(log.attempts) ? log.attempts : [];
  const end = Number(endExclusive);
  return {
    v: 1,
    attempts: attempts.filter(function(attempt){
      if(!attempt || typeof attempt !== 'object') return false;
      const ts = Number(attempt.finishedAt);
      if(dated(ts)) return isFinite(end) && ts < end;
      return true;
    })
  };
}

export function datedStudyBefore(progress, log, endExclusive){
  const end = Number(endExclusive);
  const src = progress && typeof progress === 'object' && !Array.isArray(progress) ? progress : {};
  const progressHit = Object.keys(src).some(function(k){
    if(k === '_v') return false;
    const ts = Number(src[k]);
    return dated(ts) && isFinite(end) && ts < end;
  });
  if(progressHit) return true;
  const attempts = log && Array.isArray(log.attempts) ? log.attempts : [];
  return attempts.some(function(attempt){
    const ts = Number(attempt && attempt.finishedAt);
    return dated(ts) && isFinite(end) && ts < end;
  });
}

function scoreOf(n){
  const v = Number(n);
  if(!isFinite(v)) return 0;
  return Math.max(0, Math.min(1000, Math.round(v)));
}

export function literacyDelta(startScore, endScore, meta){
  const start = scoreOf(startScore);
  const end = scoreOf(endScore);
  const info = meta && typeof meta === 'object' ? meta : {};
  if(!info.datedEvidence){
    if(info.partial && (start > 0 || end > 0)){
      return { available: true, start: end, end: end, delta: 0, undatedOnly: true };
    }
    return { available: false, start: null, end: null, delta: null, undatedOnly: false };
  }
  return { available: true, start: start, end: end, delta: end - start, undatedOnly: false };
}

function blankIdentity(){
  return { available: false, opening: null, closing: null, changed: false, pickedThisYear: false };
}

export function identitySpan(entries, window){
  if(!window) return blankIdentity();
  const list = (Array.isArray(entries) ? entries : []).filter(function(entry){
    return entry && entry.id && dated(entry.at);
  }).map(function(entry){
    return { id: String(entry.id), label: String(entry.label || entry.id), at: Number(entry.at) };
  }).sort(function(a, b){ return a.at - b.at; });
  if(!list.length) return blankIdentity();
  let opening = null;
  let closing = null;
  const during = [];
  list.forEach(function(entry){
    if(entry.at < window.start) opening = { id: entry.id, label: entry.label };
    if(entry.at < window.end) closing = { id: entry.id, label: entry.label };
    if(entry.at >= window.start && entry.at < window.end) during.push(entry);
  });
  if(!closing) return blankIdentity();
  const ids = {};
  if(opening) ids[opening.id] = true;
  during.forEach(function(entry){ ids[entry.id] = true; });
  return {
    available: true,
    opening: opening,
    closing: closing,
    changed: Object.keys(ids).length > 1,
    pickedThisYear: !opening && during.length > 0
  };
}

function kindOf(k){
  if(k === 'trade' || k === 'simulation' || k === 'goal' || k === 'learning' || k === 'reflection') return k;
  return 'reflection';
}

function pick(item, kind){
  return {
    id: String(item.id || ''),
    kind: kind,
    title: String(item.title || ''),
    why: String(item.why || ''),
    at: Number(item.at) || 0,
    ref: item.ref ? String(item.ref) : ''
  };
}

function whatifHref(ref){
  const id = String(ref || '');
  if(!/^[a-z0-9_-]+$/i.test(id)) return '#life/whatif/invest50at16';
  return '#life/whatif/' + id;
}

function clip(text, n){
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if(s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

export function yearbookLines(summary){
  const src = summary && typeof summary === 'object' ? summary : {};
  const window = src.window || { year: '', label: 'This year', partial: true };
  const counts = src.counts || {};
  const lines = [];
  lines.push(window.partial
    ? 'This is ' + window.year + ' so far. A yearbook page, not a grade.'
    : 'This is your ' + window.year + ' page. A look back, not a grade.');

  const total = Number(counts.total) || 0;
  if(!total){
    lines.push('The dated pages are still blank. Save a what-if, write a note, finish a lesson, or log a paper trade, and this page fills in from what is already on this device.');
  } else {
    const bits = [];
    if(counts.simulation) bits.push(counts.simulation + ' what-if' + (counts.simulation === 1 ? '' : 's'));
    if(counts.reflection) bits.push(counts.reflection + ' note' + (counts.reflection === 1 ? '' : 's'));
    if(counts.trade) bits.push(counts.trade + ' paper trade' + (counts.trade === 1 ? '' : 's'));
    if(counts.goal) bits.push(counts.goal + ' savings goal' + (counts.goal === 1 ? '' : 's'));
    if(counts.learning) bits.push(counts.learning + ' study check-in' + (counts.learning === 1 ? '' : 's'));
    lines.push('You left ' + bits.join(', ') + ' on this device. That is practice and study, not a record of real money.');
  }

  const whatifs = Array.isArray(src.whatifs) ? src.whatifs : [];
  if(whatifs.length){
    const names = whatifs.slice(0, 3).map(function(item){ return String(item.title || 'a what-if').replace(/[.?!]+$/, ''); });
    lines.push('What-ifs you opened: ' + names.join('; ') + '. Each one is a worksheet, not a reason to buy, sell, or borrow.');
  }

  const notes = (Array.isArray(src.notes) ? src.notes : []).slice().sort(function(a, b){ return (b.at || 0) - (a.at || 0); });
  if(notes.length){
    const latest = notes[0];
    const said = clip(latest.why || latest.title, 140);
    if(said) lines.push('You kept ' + notes.length + ' note' + (notes.length === 1 ? '' : 's') + '. The latest one says: “' + said + '”.');
  }

  if((src.trades || []).length){
    lines.push('Paper trades use practice cash. A result on this page is not money you gained or lost.');
  }
  if((src.goals || []).length || (src.trackedGoals || []).length){
    lines.push('A savings-goal date is the target you typed, not proof of a deposit.');
  }

  const concepts = Array.isArray(src.concepts) ? src.concepts : [];
  if(concepts.length){
    lines.push('Topics that came up most often in what you saved: ' + concepts.slice(0, 3).map(function(row){ return row.label || row.id; }).join(', ') + '.');
  }

  const lit = src.literacy;
  if(lit && lit.available){
    if(lit.undatedOnly){
      lines.push('Literacy score on this device is ' + lit.end + ' of 1000. The lessons and quizzes behind it have no dates, so this page can’t show how it moved through the year. It is not a credit score.');
    } else if(lit.delta > 0){
      lines.push('Literacy score moved from ' + lit.start + ' to ' + lit.end + ' (of 1000) on the lessons and quizzes dated on this device. It is not a credit score.');
    } else if(lit.delta < 0){
      lines.push('Literacy score moved from ' + lit.start + ' to ' + lit.end + ' (of 1000). A retake can change the latest-quiz part of the count. It is not a credit score.');
    } else {
      lines.push('Literacy score stayed at ' + lit.end + ' of 1000. That count is lessons and quizzes saved here, not a credit score.');
    }
  }

  const idn = src.identity;
  if(idn && idn.available && idn.closing){
    const nowLabel = idn.closing.label;
    if(idn.changed && idn.opening && idn.opening.id !== idn.closing.id){
      lines.push('At the start of ' + window.year + ' the study profile on this device was ' + idn.opening.label + '. It is ' + nowLabel + ' now. A profile only picks what to read next.');
    } else if(idn.changed){
      lines.push('The study profile changed during ' + window.year + '. It is ' + nowLabel + ' on this device now. A profile only picks what to read next.');
    } else if(!idn.opening){
      lines.push('Study profile saved in ' + window.year + ': ' + nowLabel + '. It organizes lessons. It does not rate your money.');
    } else {
      lines.push('The ' + nowLabel + ' study profile stayed in place. It still only organizes what to read next.');
    }
  }

  lines.push('Nothing on this page tells you what to do with money.');
  return lines;
}

function emptyCounts(){
  return { simulation: 0, reflection: 0, trade: 0, goal: 0, learning: 0, total: 0 };
}

export function buildYearReview(items, options){
  const opts = options && typeof options === 'object' ? options : {};
  const now = Number(opts.now);
  const window = opts.window || yearWindow(opts.year, isFinite(now) ? now : Date.now());
  const list = Array.isArray(items) ? items : [];
  const presetLabels = opts.presetLabels || {};
  const conceptLabels = opts.conceptLabels || {};
  const counts = emptyCounts();
  const inYear = [];
  let undated = 0;

  if(window){
    list.forEach(function(item){
      if(!item || typeof item !== 'object') return;
      if(!dated(item.at)){
        undated += 1;
        return;
      }
      if(inWindow(item.at, window)) inYear.push(item);
    });
  }

  const whatifMap = {};
  const notes = [];
  const trades = [];
  const goals = [];
  const lessons = [];
  const quizzes = [];
  const conceptCounts = {};

  inYear.forEach(function(item){
    const kind = kindOf(item.kind);
    counts[kind] += 1;
    counts.total += 1;
    const ids = Array.isArray(item.conceptIds) ? item.conceptIds : [];
    ids.forEach(function(id){
      const key = String(id || '');
      if(!key) return;
      conceptCounts[key] = (conceptCounts[key] || 0) + 1;
    });
    const row = pick(item, kind);
    if(kind === 'simulation'){
      const ref = String(item.ref || item.id || item.title || '');
      const prev = whatifMap[ref];
      if(!prev || row.at >= prev.at){
        whatifMap[ref] = {
          ref: String(item.ref || ''),
          title: String(item.title || presetLabels[item.ref] || 'What-if'),
          why: row.why,
          at: row.at,
          href: whatifHref(item.ref)
        };
      }
    } else if(kind === 'reflection'){
      notes.push(row);
    } else if(kind === 'trade'){
      trades.push(row);
    } else if(kind === 'goal'){
      goals.push(row);
    } else if(/^quiz:/.test(String(item.id || ''))){
      quizzes.push(row);
    } else {
      lessons.push(row);
    }
  });

  const whatifs = Object.keys(whatifMap).map(function(key){ return whatifMap[key]; });
  whatifs.sort(function(a, b){ return b.at - a.at; });
  if(counts.simulation > whatifs.length){
    counts.total -= counts.simulation - whatifs.length;
    counts.simulation = whatifs.length;
  }
  const concepts = Object.keys(conceptCounts).map(function(id){
    return { id: id, label: conceptLabels[id] || id, count: conceptCounts[id] };
  }).sort(function(a, b){ return b.count - a.count || (a.label < b.label ? -1 : 1); });

  const trackedGoals = [];
  if(window && window.partial){
    list.forEach(function(item){
      if(!item || kindOf(item.kind) !== 'goal') return;
      if(inWindow(item.at, window)) return;
      const at = Number(item.at) || 0;
      const future = dated(at) && at >= window.end;
      const missing = !dated(at);
      if(future || missing) trackedGoals.push(pick(item, 'goal'));
    });
  }

  const literacy = opts.literacy && typeof opts.literacy === 'object'
    ? opts.literacy
    : { available: false, start: null, end: null, delta: null, undatedOnly: false };
  const identity = opts.identity && typeof opts.identity === 'object' ? opts.identity : blankIdentity();

  const summary = {
    window: window,
    counts: counts,
    whatifs: whatifs,
    notes: notes,
    trades: trades,
    goals: goals,
    trackedGoals: trackedGoals,
    lessons: lessons,
    quizzes: quizzes,
    concepts: concepts,
    undatedCount: window && window.partial ? undated : 0,
    literacy: literacy,
    identity: identity,
    links: {
      timeline: '#life/journal',
      plan: '#identity/plan',
      identity: '#identity',
      whatif: '#life/whatif/invest50at16'
    }
  };
  summary.lines = yearbookLines(summary);
  summary.empty = counts.total === 0 && !literacy.available && !identity.available;
  summary.whatifs = whatifs.slice(0, 12);
  summary.notes = notes.slice(0, 12);
  summary.trades = trades.slice(0, 12);
  summary.goals = goals.slice(0, 12);
  summary.trackedGoals = trackedGoals.slice(0, 8);
  summary.lessons = lessons.slice(0, 12);
  summary.quizzes = quizzes.slice(0, 12);
  summary.concepts = concepts.slice(0, 6);
  return summary;
}
