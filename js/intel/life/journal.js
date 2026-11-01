// Local Decision Journal v0. Simulation notes live in fp_journal. Trades, goals,
// and lesson completions are read from the stores that already exist so we
// don't copy them into a second place and drift.

export function mergeJournal(stores){
  const out = [];
  const saved = stores && Array.isArray(stores.entries) ? stores.entries : [];
  saved.forEach(function(e){
    if(!e || typeof e !== 'object') return;
    out.push({
      id: String(e.id || ''),
      kind: kindOf(e.kind),
      title: String(e.title || ''),
      why: String(e.why || ''),
      conceptIds: Array.isArray(e.conceptIds) ? e.conceptIds.map(String) : [],
      at: Number(e.at) || 0,
      ref: e.ref ? String(e.ref) : ''
    });
  });

  const paper = stores && stores.paper;
  if(paper && Array.isArray(paper.journal)){
    paper.journal.forEach(function(j){
      if(!j) return;
      const pnl = Number(j.pnl);
      out.push({
        id: 'trade:' + String(j.id || j.soldAt || ''),
        kind: 'trade',
        title: 'Paper sell ' + String(j.t || ''),
        why: [j.thesis ? 'Thesis: ' + j.thesis : '', j.reflection ? 'Reflection: ' + j.reflection : '', isFinite(pnl) ? 'Result: ' + (pnl >= 0 ? '+' : '−') + Math.abs(pnl).toFixed(2) : ''].filter(Boolean).join('\n'),
        conceptIds: ['psychology'],
        at: Number(j.soldAt) || 0,
        ref: 'fp_paper'
      });
    });
  }
  if(paper && Array.isArray(paper.pos)){
    paper.pos.forEach(function(p){
      if(!p || !p.t) return;
      out.push({
        id: 'trade-open:' + String(p.t),
        kind: 'trade',
        title: 'Open paper buy ' + String(p.t),
        why: p.thesis ? String(p.thesis) : '',
        conceptIds: ['psychology'],
        at: Number(p.ts) || 0,
        ref: 'fp_paper'
      });
    });
  }

  const goals = stores && Array.isArray(stores.goals) ? stores.goals : [];
  goals.forEach(function(g, i){
    if(!g) return;
    out.push({
      id: 'goal:' + i + ':' + String(g.name || ''),
      kind: 'goal',
      title: 'Savings goal: ' + String(g.name || 'Goal'),
      why: 'Saved ' + Number(g.saved || 0) + ' toward ' + Number(g.target || 0) + (g.date ? ' by ' + g.date : ''),
      conceptIds: ['saving', 'budgeting'],
      at: Date.parse(g.date) || 0,
      ref: 'fp_goals'
    });
  });

  const lessons = stores && stores.lessons && typeof stores.lessons === 'object' ? stores.lessons : {};
  Object.keys(lessons).forEach(function(slug){
    if(slug === '_v') return;
    const at = Number(lessons[slug]);
    if(!isFinite(at)) return;
    const name = stores.lessonNames && stores.lessonNames[slug] ? stores.lessonNames[slug] : slug;
    out.push({
      id: 'learn:' + slug,
      kind: 'learning',
      title: 'Finished lesson: ' + name,
      why: '',
      conceptIds: stores.lessonConcepts && stores.lessonConcepts[slug] ? stores.lessonConcepts[slug].slice() : [],
      at: at,
      ref: 'fp_lessons'
    });
  });

  const attempts = stores && stores.quizzes && Array.isArray(stores.quizzes.attempts) ? stores.quizzes.attempts : [];
  attempts.forEach(function(q){
    if(!q) return;
    const concepts = {};
    (q.responses || []).forEach(function(r){
      (r.conceptIds || []).forEach(function(id){ concepts[id] = true; });
    });
    out.push({
      id: 'quiz:' + String(q.id || q.finishedAt || ''),
      kind: 'learning',
      title: 'Quiz: ' + String(q.lessonName || q.quizKey || 'Lesson') + ' — ' + (Number(q.correct) || 0) + '/' + (Number(q.total) || 0),
      why: '',
      conceptIds: Object.keys(concepts),
      at: Number(q.finishedAt) || 0,
      ref: 'fp_quiz_log'
    });
  });

  out.sort(function(a, b){ return (b.at || 0) - (a.at || 0); });
  return out;
}

function kindOf(k){
  if(k === 'trade' || k === 'simulation' || k === 'goal' || k === 'learning' || k === 'reflection') return k;
  return 'reflection';
}

export function upsertEntry(entries, entry){
  const list = Array.isArray(entries) ? entries.slice() : [];
  const id = String(entry && entry.id || '');
  const next = {
    id: id,
    kind: kindOf(entry.kind),
    title: String(entry.title || '').slice(0, 140),
    why: String(entry.why || '').slice(0, 280),
    conceptIds: Array.isArray(entry.conceptIds) ? entry.conceptIds.map(String).slice(0, 8) : [],
    at: Number(entry.at) || Date.now(),
    ref: entry.ref ? String(entry.ref).slice(0, 40) : ''
  };
  const i = list.findIndex(function(e){ return e && e.id === id; });
  if(i >= 0) list[i] = next;
  else list.unshift(next);
  return list.slice(0, 300);
}
