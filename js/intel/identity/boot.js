// Identity page. Math lives in profiles.js, mastery.js, and plan.js.
import { PROFILES, suggestProfile, resolveIdentity, profileById } from './profiles.js';
import { literacyScore, conceptMastery, STATUS_LABELS } from '../learn/mastery.js';
import { lessonsByConcept, CONCEPTS } from '../learn/concepts.js';
import { buildStudyPlan, currentPlan, planLimit, weekKey } from '../learn/plan.js';
import { presetById } from '../life/presets.js';

const PLAN_KEY = 'fp_study_plan';
const IDENTITY_KEY = 'fp_identity';
let BOUND = false;

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function readJSON(key, fallback){
  try{
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if(raw && typeof raw === 'object') return raw;
  }catch(e){}
  return fallback;
}

function readIntake(){
  if(typeof getProfile === 'function'){
    const profile = getProfile();
    if(!profile) return {};
    if(profile.skipped) return { skipped: true };
    return { goal: profile.goal, experience: profile.experience, time: profile.time };
  }
  return {};
}

function readLife(){
  const raw = readJSON('fp_life', null);
  if(!raw || !raw.inputs || typeof raw.inputs !== 'object') return null;
  return raw.inputs;
}

function readProgress(){
  if(typeof getLessonProgress === 'function') return getLessonProgress();
  const raw = readJSON('fp_lessons', {});
  return raw;
}

function readQuizLog(){
  const raw = readJSON('fp_quiz_log', { v: 1, attempts: [] });
  if(!Array.isArray(raw.attempts)) return { v: 1, attempts: [] };
  return raw;
}

function readStoredIdentity(){
  const raw = readJSON(IDENTITY_KEY, null);
  if(!raw) return null;
  return { id: raw.id, pinned: raw.pinned === true };
}

function writeStoredIdentity(id, pinned){
  try{
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ v: 1, id: id, pinned: !!pinned, updatedAt: Date.now() }));
  }catch(e){}
}

function readPlan(){
  return readJSON(PLAN_KEY, null);
}

function writePlan(plan){
  try{ localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); }catch(e){}
}

function lessonInfo(slug){
  if(typeof LESSONS === 'undefined') return { name: slug, free: true, quiz: true };
  const lesson = LESSONS.find(function(item){ return item && item.id === slug; });
  if(!lesson) return { name: slug, free: true, quiz: false };
  const quiz = typeof QUIZZES !== 'undefined' && !!QUIZZES[lesson.name];
  return { name: lesson.name, free: lesson.plan !== 'gold', quiz: quiz };
}

function freeSlugMap(){
  const map = {};
  if(typeof LESSONS === 'undefined') return map;
  LESSONS.forEach(function(lesson){
    if(lesson && lesson.id && lesson.plan !== 'gold') map[lesson.id] = 1;
  });
  return map;
}

function sectionFromHash(){
  const raw = (location.hash || '').replace(/^#/, '').replace(/^\/+|\/+$/g, '').toLowerCase();
  const parts = raw.split(/[?#]/)[0].split('/');
  if(parts[0] === 'identity') return parts[1] || '';
  if(parts[0] === 'life' && parts[1] === 'identity') return parts[2] || '';
  return '';
}

function model(){
  const intake = readIntake();
  const life = readLife();
  const progress = readProgress();
  const log = readQuizLog();
  const literacy = literacyScore(progress, log);
  const mastery = literacy.mastery;
  const suggestion = suggestProfile({ intake: intake, life: life, concepts: mastery });
  const identity = resolveIdentity(suggestion, readStoredIdentity());
  return {
    intake: intake,
    progress: progress,
    mastery: mastery,
    literacy: literacy,
    suggestion: suggestion,
    identity: identity
  };
}

function buildPlan(state, refresh){
  const profile = state.identity.profile;
  const limit = planLimit(state.intake && state.intake.time);
  const built = buildStudyPlan({
    mastery: state.mastery,
    progress: state.progress,
    lessonsByConcept: lessonsByConcept(),
    focusConcepts: profile.concepts,
    starterLessons: profile.lessons,
    freeSlugs: freeSlugMap(),
    limit: limit,
    hasQuiz: function(slug){ return lessonInfo(slug).quiz; }
  });
  const prev = readPlan();
  const profileChanged = !!(prev && prev.profileId !== state.identity.id);
  const plan = currentPlan(prev, built, new Date(), { refresh: !!refresh || profileChanged });
  plan.profileId = state.identity.id;
  if(!prev || prev.weekKey !== plan.weekKey || prev.profileId !== plan.profileId || JSON.stringify(prev.items) !== JSON.stringify(plan.items) || refresh){
    writePlan(plan);
  }
  return plan;
}

function statusLabel(status){
  return STATUS_LABELS[status] || 'Not started';
}

function profileCards(state){
  return '<div class="id-grid" role="radiogroup" aria-label="Financial identity profiles">' + PROFILES.map(function(profile){
    const on = profile.id === state.identity.id;
    const suggested = profile.id === state.identity.suggestedId;
    let badge = '';
    if(on && state.identity.source === 'picked') badge = '<span class="id-badge">Your pick</span>';
    else if(suggested) badge = '<span class="id-badge">Suggested</span>';
    return '<button type="button" class="id-card" role="radio" data-profile="' + esc(profile.id) + '" aria-checked="' + (on ? 'true' : 'false') + '">' +
      '<span class="id-card-top"><strong>' + esc(profile.label) + '</strong>' + badge + '</span>' +
      '<span class="id-card-blurb">' + esc(profile.blurb) + '</span>' +
      '</button>';
  }).join('') + '</div>';
}

function scoreBlock(literacy){
  const width = Math.max(0, Math.min(100, literacy.score / 10));
  const lines = literacy.lines.map(function(line){ return '<li>' + esc(line) + '</li>'; }).join('');
  return '<section class="id-section" id="identityScore">' +
    '<p class="id-kicker">Literacy score</p>' +
    '<h2>How the 0–1000 score is counted</h2>' +
    '<p class="id-score" role="meter" aria-valuemin="0" aria-valuemax="1000" aria-valuenow="' + literacy.score + '" aria-label="Literacy score ' + literacy.score + ' of 1000">' +
      literacy.score + ' <span>/ 1000</span></p>' +
    '<div class="id-bar" aria-hidden="true"><span style="width:' + width + '%"></span></div>' +
    '<p class="life-help">Lessons are worth up to 400, latest-quiz accuracy up to 400 (full credit needs 24 questions), and concepts you have touched up to 200. Nothing here is a credit score.</p>' +
    '<ul class="id-math">' + lines + '</ul>' +
    '</section>';
}

function masteryBlock(state){
  const focus = {};
  state.identity.profile.concepts.forEach(function(id){ focus[id] = 1; });
  const rows = Object.keys(state.mastery).map(function(id){ return state.mastery[id]; });
  rows.sort(function(a, b){
    const af = focus[a.id] ? 0 : 1;
    const bf = focus[b.id] ? 0 : 1;
    if(af !== bf) return af - bf;
    if(a.score !== b.score) return a.score - b.score;
    return a.label < b.label ? -1 : 1;
  });
  const body = rows.map(function(row){
    const quiz = row.quizTotal ? (row.quizCorrect + '/' + row.quizTotal + ' on the latest quiz') : 'no quiz saved';
    return '<li class="id-row"><div class="id-row-top"><span>' + esc(row.label) + '</span><span>' + esc(statusLabel(row.status)) + ' · ' + row.score + '</span></div>' +
      '<div class="id-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + row.score + '" aria-label="' + esc(row.label) + ' ' + row.score + ' of 100"><span style="width:' + row.score + '%"></span></div>' +
      '<p class="life-help">' + row.lessonsDone + ' of ' + row.lessonsTotal + ' lessons · ' + esc(quiz) + '</p></li>';
  }).join('');
  return '<section class="id-section" id="identityMastery">' +
    '<p class="id-kicker">Concept mastery</p>' +
    '<h2>Where the lessons have landed</h2>' +
    '<p class="life-help">With a saved quiz, the mark is 45% lessons and 55% latest-quiz accuracy. With no quiz, it tops out at 60 even if every tagged lesson is finished. Focus topics for this profile are listed first.</p>' +
    '<ul class="id-mastery">' + body + '</ul></section>';
}

function weekTitle(date){
  const src = date instanceof Date ? date : new Date();
  const day = src.getDay() || 7;
  const monday = new Date(src.getFullYear(), src.getMonth(), src.getDate() - day + 1);
  return 'week of ' + monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function planBlock(state, plan){
  const items = plan.items || [];
  let list;
  if(!items.length){
    list = '<p class="life-empty">No gap stood out, and the starter reads are already finished. The list stays short on purpose.</p>';
  } else {
    list = '<ol class="id-plan">' + items.map(function(item){
      const info = lessonInfo(item.slug);
      const done = !!(state.progress && state.progress[item.slug]);
      const kind = item.type === 'quiz' ? 'Quiz' : 'Lesson';
      const concept = CONCEPTS[item.conceptId] || '';
      return '<li>' +
        '<div class="id-row-top"><span class="id-kicker">' + esc(kind) + (concept ? ' · ' + esc(concept) : '') + '</span>' +
        (done ? '<span>Done</span>' : '') + '</div>' +
        '<div class="' + (done ? 'id-done' : '') + '">' + esc(info.name) + '</div>' +
        '<p class="life-help">' + esc(item.reason) + '</p>' +
        '<button type="button" class="btn-secondary" data-plan-slug="' + esc(item.slug) + '" data-plan-type="' + esc(item.type) + '">' +
          (item.type === 'quiz' ? 'Open the quiz' : 'Open the lesson') + '</button>' +
        '</li>';
    }).join('') + '</ol>';
  }
  const when = plan.weekKey || weekKey(new Date());
  return '<section class="id-section" id="identityPlan">' +
    '<p class="id-kicker">This week</p>' +
    '<h2>Study plan · ' + esc(weekTitle(new Date())) + '</h2>' +
    '<p class="life-help">At most four items, and fewer when onboarding said the week is short. The list stays put until next week (' + esc(when) + ') so it does not keep adding more. Saved on this device.</p>' +
    list +
    '<div class="life-actions"><button type="button" class="btn-secondary" id="identityRefreshPlan">Build a new plan</button></div>' +
    '</section>';
}

function focusBlock(state){
  const profile = state.identity.profile;
  const concepts = profile.concepts.map(function(id){ return CONCEPTS[id] || id; }).join(' · ');
  const reasons = state.identity.reasons.map(function(line){ return '<li>' + esc(line) + '</li>'; }).join('');
  const scores = state.suggestion.scores;
  const scoreList = PROFILES.map(function(item){
    return '<li>' + esc(item.label) + ': ' + (scores[item.id] || 0) + '</li>';
  }).join('');
  const whatifs = profile.whatifs.map(function(id){
    const preset = presetById(id);
    const label = preset ? preset.label : id;
    return '<button type="button" class="life-chip" data-whatif="' + esc(id) + '">' + esc(label) + '</button>';
  }).join('');
  const suggestedProfile = profileById(state.identity.suggestedId);
  const follow = state.identity.source === 'picked' && suggestedProfile && suggestedProfile.id !== profile.id
    ? '<div class="life-actions"><button type="button" class="btn-secondary" id="identityUseSuggestion">Follow the suggestion (' + esc(suggestedProfile.label) + ')</button></div>'
    : '';
  const pickedNote = state.identity.source === 'picked'
    ? 'You picked this profile. The suggestion still updates in the background.'
    : 'This is the suggestion from the counts below. Tap another card to keep a different one.';
  return '<section class="id-section" id="identityFocus">' +
    '<p class="id-kicker">Study focus</p>' +
    '<h2>' + esc(profile.label) + '</h2>' +
    '<p>' + esc(profile.focus) + '</p>' +
    '<p class="life-help">' + esc(pickedNote) + ' Topics: ' + esc(concepts) + '.</p>' +
    '<h3>Why this suggestion</h3>' +
    '<ul class="id-math">' + reasons + '</ul>' +
    '<details><summary>How the suggestion was counted</summary>' +
      '<ul class="id-math">' + scoreList + '</ul>' +
      '<p class="life-help">The highest count wins. Ties go to Balanced Learner, then Steady Saver, then Curious Investor, then Debt Navigator. A count is a study signal, not a rating of your money.</p>' +
    '</details>' +
    follow +
    '<h3>Life Path what-ifs to open next</h3>' +
    '<p class="life-help">These worksheets use your Life Path inputs. They show a different picture. They do not pick a path for you, and they are not a reason to buy, sell, or borrow.</p>' +
    '<div class="life-chips">' + whatifs + '</div>' +
    '</section>';
}

function render(refreshPlan){
  const host = document.getElementById('identityApp');
  const status = document.getElementById('identityStatus');
  if(!host) return;
  if(status) status.textContent = '';
  const state = model();
  const plan = buildPlan(state, refreshPlan);
  host.innerHTML = profileCards(state) + focusBlock(state) + scoreBlock(state.literacy) + masteryBlock(state) + planBlock(state, plan);
  const section = sectionFromHash();
  const target = section && document.getElementById('identity' + section.charAt(0).toUpperCase() + section.slice(1));
  if(target && target.scrollIntoView){
    try{ target.scrollIntoView({ block: 'start' }); }catch(e){}
  }
}

function bind(){
  if(BOUND) return;
  const root = document.getElementById('identityApp');
  if(!root) return;
  BOUND = true;
  root.addEventListener('keydown', function(e){
    if(e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const cards = Array.prototype.slice.call(root.querySelectorAll('[data-profile]'));
    const i = cards.indexOf(document.activeElement);
    if(i < 0) return;
    e.preventDefault();
    const n = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? (i + 1) % cards.length : (i - 1 + cards.length) % cards.length;
    cards[n].focus();
    cards[n].click();
  });
  root.addEventListener('click', function(e){
    const profileBtn = e.target.closest('[data-profile]');
    if(profileBtn){
      const id = profileBtn.getAttribute('data-profile');
      if(!profileById(id)) return;
      writeStoredIdentity(id, true);
      render(false);
      return;
    }
    const planBtn = e.target.closest('[data-plan-slug]');
    if(planBtn){
      const slug = planBtn.getAttribute('data-plan-slug');
      const type = planBtn.getAttribute('data-plan-type');
      if(type === 'quiz' && typeof openLessonQuiz === 'function') openLessonQuiz(slug);
      else if(typeof openLessonById === 'function') openLessonById(slug);
      return;
    }
    const what = e.target.closest('[data-whatif]');
    if(what){
      location.hash = '#life/whatif/' + what.getAttribute('data-whatif');
      return;
    }
    if(e.target.closest('#identityUseSuggestion')){
      const state = model();
      writeStoredIdentity(state.identity.suggestedId, false);
      render(false);
      return;
    }
    if(e.target.closest('#identityRefreshPlan')){
      render(true);
    }
  });
}

function snapshot(){
  const state = model();
  return {
    id: state.identity.id,
    label: state.identity.profile.label,
    source: state.identity.source,
    score: state.literacy.score
  };
}

function lifeLineHtml(){
  const snap = snapshot();
  return 'Study profile on this device: <b>' + esc(snap.label) + '</b>. Literacy score ' + snap.score +
    ' of 1000, counted from lessons and quizzes saved here. <a href="#identity">Open Identity</a>.';
}

window.FPIdentity = {
  render: function(){ render(false); },
  snapshot: snapshot,
  lifeLineHtml: lifeLineHtml
};

if(window.FPLearn){
  window.FPLearn.literacyScore = literacyScore;
  window.FPLearn.conceptMastery = conceptMastery;
}

bind();
if(document.getElementById('page-identity') && document.getElementById('page-identity').classList.contains('active')){
  render(false);
}
