// Weekly study plan. At most four items, fewer when onboarding said the week is short.
// Items point at lesson slugs already in the catalog. The caller turns slugs into links.

export const PLAN_MAX = 4;

export function planLimit(time){
  if(String(time) === '5') return 2;
  if(String(time) === '15') return 3;
  return PLAN_MAX;
}

export function weekKey(date){
  const src = date instanceof Date ? date : new Date(date);
  const d = new Date(Date.UTC(src.getFullYear(), src.getMonth(), src.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

function slugRank(slug, freeSlugs){
  if(!freeSlugs) return 0;
  return freeSlugs[slug] ? 0 : 1;
}

function sortedSlugs(list, freeSlugs){
  return (list || []).slice().sort(function(a, b){
    const rank = slugRank(a, freeSlugs) - slugRank(b, freeSlugs);
    if(rank) return rank;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function buildStudyPlan(opts){
  const src = opts && typeof opts === 'object' ? opts : {};
  const mastery = src.mastery || {};
  const progress = src.progress || {};
  const byConcept = src.lessonsByConcept || {};
  const focus = {};
  const focusList = src.focusConcepts || [];
  focusList.forEach(function(id){ focus[id] = 1; });
  const freeSlugs = src.freeSlugs || null;
  const hasQuiz = typeof src.hasQuiz === 'function' ? src.hasQuiz : function(){ return true; };
  const limit = Math.max(1, Math.min(PLAN_MAX, Number(src.limit) || PLAN_MAX));
  const gaps = Object.keys(mastery).map(function(id){ return mastery[id]; }).filter(function(row){
    return row && row.score < 70;
  });
  gaps.sort(function(a, b){
    const af = focus[a.id] ? 0 : 1;
    const bf = focus[b.id] ? 0 : 1;
    if(af !== bf) return af - bf;
    if(a.score !== b.score) return a.score - b.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const items = [];
  const used = {};
  function push(item){
    if(items.length >= limit || !item || !item.slug || used[item.slug]) return;
    used[item.slug] = 1;
    items.push(item);
  }

  const candidates = [];
  gaps.forEach(function(row){
    const slugs = sortedSlugs(byConcept[row.id], freeSlugs);
    const unread = slugs.filter(function(slug){ return !progress[slug]; });
    if(unread.length){
      const slug = unread[0];
      candidates.push({
        type: 'lesson',
        slug: slug,
        conceptId: row.id,
        reason: 'Unread lesson tagged ' + (row.label || row.id),
        free: !freeSlugs || !!freeSlugs[slug]
      });
      return;
    }
    const accuracy = row.quizTotal ? row.quizCorrect / row.quizTotal : 0;
    const needsQuiz = row.quizTotal === 0 || accuracy < 0.7;
    if(!needsQuiz) return;
    const quizSlug = slugs.filter(function(slug){ return progress[slug] && hasQuiz(slug); })[0];
    if(!quizSlug) return;
    candidates.push({
      type: 'quiz',
      slug: quizSlug,
      conceptId: row.id,
      reason: 'Quiz for ' + (row.label || row.id) + '. The lesson is already marked done.',
      free: !freeSlugs || !!freeSlugs[quizSlug]
    });
  });
  // Lessons the caller marks free fill the short list first.
  candidates.filter(function(item){ return item.free; }).forEach(push);
  candidates.filter(function(item){ return !item.free; }).forEach(push);

  if(!items.length){
    const starters = src.starterLessons || [];
    starters.forEach(function(slug){
      if(progress[slug]) return;
      push({
        type: 'lesson',
        slug: slug,
        conceptId: focusList[0] || '',
        reason: 'Starter read for this study profile'
      });
    });
  }

  return {
    items: items.map(function(item){
      return { type: item.type, slug: item.slug, conceptId: item.conceptId, reason: item.reason };
    })
  };
}

export function currentPlan(stored, built, now, opts){
  const when = now instanceof Date ? now : new Date(now || Date.now());
  const key = weekKey(when);
  const refresh = !!(opts && opts.refresh);
  const fresh = (built && Array.isArray(built.items)) ? built.items.slice(0, PLAN_MAX) : [];
  if(!refresh && stored && stored.weekKey === key && Array.isArray(stored.items)){
    return {
      v: 1,
      weekKey: key,
      generatedAt: Number(stored.generatedAt) || when.getTime(),
      items: stored.items.slice(0, PLAN_MAX)
    };
  }
  return {
    v: 1,
    weekKey: key,
    generatedAt: when.getTime(),
    items: fresh
  };
}
