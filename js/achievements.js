(() => {
  const page = document.getElementById('page-achievements');
  const viewport = page.querySelector('.ach-map');
  const world = page.querySelector('.ach-world');
  const detail = page.querySelector('.ach-detail');
  const width = 840, height = 460;
  const primary = [
    { id:'first_lesson', name:'First Lesson', x:100, y:218, goal:1, desc:'Complete your first lesson.' },
    { id:'quiz_whiz', name:'Quiz Starter', x:290, y:255, goal:1, desc:'Finish a lesson knowledge check.' },
    { id:'money_basics', name:'Money Basics', x:480, y:218, goal:3, desc:'Complete three different lessons.' },
    { id:'budget_builder', name:'Budget Builder', x:710, y:125, goal:1, desc:'Complete the 50/30/20 budgeting lesson.' },
    { id:'paper_trader', name:'Paper Trader', x:710, y:330, goal:1, desc:'Make your first practice trade with virtual money.' }
  ];
  const extras = ACHVS.filter(b => !primary.some(p => p.id === b.id)).map(b => ({
    ...b, goal:b.id === 'scholar' ? 5 : b.id === 'graduate' ? coreLessonCount() : b.id === 'streak_7' ? 7 : 1,
    desc:b.id === 'graduate' ? 'Complete all ' + coreLessonCount() + ' core lessons.' : b.desc
  }));
  const badges = [...primary, ...extras];
  const buttons = new Map();
  let selected, scale = 1, ready = false, blockClick = false;
  const pointers = new Map();
  const svg = world.querySelector('svg');
  const paths = [
    ['quiz_whiz','M100 218 C180 218 209 255 290 255'],
    ['money_basics','M290 255 C370 255 402 218 480 218'],
    ['budget_builder','M480 218 C600 218 605 125 710 125'],
    ['paper_trader','M480 218 C600 218 605 330 710 330']
  ].map(([id,d]) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',d);
    svg.append(path);
    return [id,path];
  });

  function addBadge(badge) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = badge.x ? 'ach-node' : 'ach-extra';
    if (badge.x) {
      button.style.left = badge.x / width * 100 + '%';
      button.style.top = badge.y / height * 100 + '%';
    }
    const icon = document.createElement('span');
    icon.className = 'ach-icon';
    icon.setAttribute('aria-hidden','true');
    const label = document.createElement('span');
    label.className = 'ach-name';
    label.textContent = badge.name;
    const hint = document.createElement('span');
    hint.className = 'ach-hint';
    hint.setAttribute('aria-hidden','true');
    button.append(icon,label,hint);
    (badge.x ? world : page.querySelector('.ach-extras')).append(button);
    button.addEventListener('click', event => {
      if (blockClick && event.detail) return;
      selected = badge;
      render();
      if (!badge.x || matchMedia('(max-width: 760px)').matches) {
        detail.focus({preventScroll:true});
        detail.scrollIntoView({block:'nearest'});
      }
    });
    buttons.set(badge.id, { button, icon, hint });
  }
  badges.forEach(addBadge);

  function render() {
    const earned = getAchv() || {};
    const lessonCount = catalogDoneCount();
    const lessonProgress = getLessonProgress();
    const paper = getPaper();
    const quiz = getQuizScore() || {};
    let attempts = [];
    try { attempts = JSON.parse(localStorage.getItem('fp_quiz_log') || '{}')?.attempts || []; } catch {}
    const counts = {
      first_lesson: lessonCount,
      quiz_whiz: Number(Object.values(quiz).some(q => q && q.t > 0) ||
        (Array.isArray(attempts) && attempts.some(a => a && a.total > 0 && a.finishedAt > 0))),
      money_basics: lessonCount,
      budget_builder: Number(Boolean(lessonProgress['budget-50-30-20'])),
      paper_trader: Number(Boolean(paper.pos.length || paper.journal.length)),
      scholar: lessonCount,
      graduate: coreDoneCount(),
      streak_7: getStreak()?.count
    };
    const progress = new Map(badges.map(b => [b.id, earned[b.id] ? b.goal : Math.min(b.goal, counts[b.id] || 0)]));
    if (!selected) selected = primary.find(b => progress.get(b.id) < b.goal) || primary[0];
    for (const b of badges) {
      const {button,icon,hint} = buttons.get(b.id);
      const value = progress.get(b.id);
      const state = value === b.goal ? 'Earned' : value ? 'In progress' : 'Locked';
      button.dataset.state = state;
      button.setAttribute('aria-pressed',String(b === selected));
      button.setAttribute('aria-label',b.name + ', ' + state + ', ' + value + ' of ' + b.goal);
      icon.textContent = state === 'Earned' ? '✓' : value ? '◔' : '🔒';
      hint.textContent = value + ' of ' + b.goal + ' complete';
    }
    for (const [id,path] of paths) path.classList.toggle('earned',buttons.get(id).button.dataset.state === 'Earned');
    const count = progress.get(selected.id);
    page.querySelector('.ach-count').textContent = primary.filter(b => progress.get(b.id) === b.goal).length + ' of ' + primary.length + ' map badges earned';
    detail.querySelector('h2').textContent = selected.name;
    detail.querySelector('.ach-status').textContent = buttons.get(selected.id).button.dataset.state;
    detail.querySelector('.ach-requirement').textContent = selected.desc;
    detail.querySelector('.ach-progress-text').textContent = count + ' of ' + selected.goal + ' complete';
    const bar = detail.querySelector('progress');
    bar.max = selected.goal;
    bar.value = count;
    const action = detail.querySelector('.ach-action');
    const actions = {
      budget_builder:['Open budgeting lesson', () => openLessonById('budget-50-30-20')],
      paper_trader:['Open paper portfolio', () => { showPage('portfolio'); setMode('paper'); }],
      quiz_whiz:['Browse lessons and quizzes', () => showPage('lessons')],
      first_lesson:['Browse lessons', () => showPage('lessons')],
      money_basics:['Continue lessons', () => showPage('lessons')],
      scholar:['Continue lessons', () => showPage('lessons')],
      graduate:['Continue lessons', () => showPage('lessons')]
    };
    const next = actions[selected.id];
    action.hidden = !next || count === selected.goal;
    action.textContent = next ? next[0] : '';
    action.onclick = next ? next[1] : null;
    if (!ready) { ready = true; reset(); }
  }

  function size() {
    world.style.width = width * scale + 'px';
    world.style.height = height * scale + 'px';
  }
  function minimum() {
    return Math.min(.8, viewport.clientWidth / width, viewport.clientHeight / height);
  }
  function zoom(target, x, y, fromX = x, fromY = y) {
    const before = scale;
    scale = Math.min(2, Math.max(minimum(),target));
    const left = (viewport.scrollLeft + fromX) / before;
    const top = (viewport.scrollTop + fromY) / before;
    size();
    viewport.scrollLeft = left * scale - x;
    viewport.scrollTop = top * scale - y;
  }
  function reset() {
    scale = Math.max(.85, Math.min(1,viewport.clientWidth / width));
    size();
    viewport.scrollLeft = 0;
    viewport.scrollTop = Math.max(0,(world.offsetHeight - viewport.clientHeight) / 2);
  }
  function centerZoom(factor) { zoom(scale * factor, viewport.clientWidth / 2, viewport.clientHeight / 2); }
  page.querySelector('[data-ach-zoom="in"]').onclick = () => centerZoom(1.25);
  page.querySelector('[data-ach-zoom="out"]').onclick = () => centerZoom(.8);
  page.querySelector('[data-ach-zoom="reset"]').onclick = reset;
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const box = viewport.getBoundingClientRect();
    zoom(scale * Math.exp(-event.deltaY * .002), event.clientX - box.left, event.clientY - box.top);
  }, {passive:false});
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport) return;
    const moves = {ArrowLeft:[-48,0], ArrowRight:[48,0], ArrowUp:[0,-48], ArrowDown:[0,48]};
    if (moves[event.key]) { event.preventDefault(); viewport.scrollBy(...moves[event.key]); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); centerZoom(1.25); }
    else if (event.key === '-') { event.preventDefault(); centerZoom(.8); }
    else if (event.key === '0') { event.preventDefault(); reset(); }
  });
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointers.size >= 2) return;
    if (!pointers.size) blockClick = false;
    pointers.set(event.pointerId, {x:event.clientX,y:event.clientY});
    if (pointers.size === 2) blockClick = true;
  });
  viewport.addEventListener('pointermove', event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const x = event.clientX, y = event.clientY;
    if (!blockClick && Math.hypot(x - previous.x,y - previous.y) < 5) return;
    blockClick = true;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('dragging');
    const other = [...pointers].find(([key]) => key !== event.pointerId)?.[1];
    if (other) {
      const before = Math.hypot(previous.x - other.x,previous.y - other.y);
      const after = Math.hypot(x - other.x,y - other.y);
      const box = viewport.getBoundingClientRect();
      if (before > 0) zoom(scale * after / before,(x + other.x)/2 - box.left,(y + other.y)/2 - box.top,
        (previous.x + other.x)/2 - box.left,(previous.y + other.y)/2 - box.top);
    } else {
      viewport.scrollBy(previous.x - x,previous.y - y);
    }
    pointers.set(event.pointerId,{x,y});
  });
  function end(event) {
    pointers.delete(event.pointerId);
    if (!pointers.size) viewport.classList.remove('dragging');
  }
  viewport.addEventListener('pointerup',end);
  viewport.addEventListener('pointercancel',end);
  viewport.addEventListener('lostpointercapture',end);
  viewport.addEventListener('pointerleave',event => {
    if (event.pointerType === 'mouse' && !viewport.hasPointerCapture(event.pointerId)) end(event);
  });
  viewport.addEventListener('click',event => {
    if (blockClick && event.detail) { event.preventDefault(); event.stopPropagation(); }
  },true);
  window.FPAchievements = {render};
  if (page.classList.contains('active')) render();
  window.addEventListener('storage',() => { if (page.classList.contains('active')) render(); });
})();
