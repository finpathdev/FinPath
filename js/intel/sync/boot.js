// Signed-in Intelligence sync. Local data stays on the device either way.
// Nothing is uploaded unless there is a signed-in Supabase client.
import { literacyScore } from '../learn/mastery.js';
import { lessonsByConcept, conceptsFor } from '../learn/concepts.js';
import { detectPatterns } from '../paper/patterns.js';
import { gradeClosed } from '../paper/thesis.js';
import {
  freshStudy, diffProgress, recordLiteracy, buildRecordBody, markUploaded
} from '../study/efficacy.js';
import {
  timeMs, conceptClocks, conceptRows, appendLiteracy, thesisRowsFromPaper, thesisEntryId,
  normalizeThesis, normalizeBehavior, normalizeRisk, normalizePlan, behaviorSnapshot,
  riskSnapshot, appendSnapshot, mergeRecords, mergeThesisIntoPaper, syncCollections,
  tableSpec, conceptFromDb, literacyFromDb, thesisFromDb, behaviorFromDb, riskFromDb, planFromDb,
  lessonFromDb, lessonRowsFromProgress, progressFromLessonRows
} from './merge.js';

const KEYS = {
  mastery: 'fp_intel_mastery',
  literacy: 'fp_literacy_history',
  behavior: 'fp_behavior_snapshots',
  risk: 'fp_risk_snapshots',
  plans: 'fp_study_plan_history',
  thesisAccount: 'fp_thesis_account',
  efficacy: 'fp_efficacy'
};

let TIMER = 0;
let CHAIN = Promise.resolve();

function readJSON(key, fallback){
  try{
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if(raw && typeof raw === 'object') return raw;
  }catch(e){}
  return fallback;
}

function writeJSON(key, value){
  const next = JSON.stringify(value);
  let prev = null;
  try{ prev = localStorage.getItem(key); }catch(e){ return false; }
  if(prev === next) return false;
  try{ localStorage.setItem(key, next); return true; }catch(e){ return false; }
}

function readEfficacy(){
  const raw = readJSON(KEYS.efficacy, null);
  const base = freshStudy();
  if(!raw || typeof raw !== 'object') return base;
  return Object.assign(base, raw, {
    pending: Array.isArray(raw.pending) ? raw.pending : [],
    progressIds: Array.isArray(raw.progressIds) ? raw.progressIds : [],
    seenLessons: raw.seenLessons && typeof raw.seenLessons === 'object' ? raw.seenLessons : {},
    seenQuizzes: Array.isArray(raw.seenQuizzes) ? raw.seenQuizzes : []
  });
}

function setStatus(text){
  const el = document.getElementById('identitySync');
  if(el && text) el.textContent = text;
}

function cloudCtx(){
  const client = window.supabaseClient;
  const user = window.currentUser;
  if(!client || !client.from || !user || !user.id) return null;
  return { client: client, userId: user.id };
}

function scoreClosed(paper, rows){
  const journal = paper && Array.isArray(paper.journal) ? paper.journal : [];
  return rows.map(function(row){
    if(!row || row.status !== 'closed') return row;
    const trade = journal.find(function(item){
      return item && thesisEntryId(item.t, item.boughtAt || item.soldAt) === row.id;
    });
    if(!trade) return row;
    let grade = null;
    try{ grade = gradeClosed(trade); }catch(e){ grade = null; }
    if(!grade) return row;
    return normalizeThesis(Object.assign({}, row, {
      scores: {
        accuracy: grade.accuracy && grade.accuracy.score,
        research: grade.research && grade.research.score,
        decision: grade.decision && grade.decision.score,
        risk: grade.risk && grade.risk.score
      }
    }));
  }).filter(Boolean);
}

function collectLocal(){
  const progress = readJSON('fp_lessons', {});
  const log = readJSON('fp_quiz_log', { v: 1, attempts: [] });
  if(!Array.isArray(log.attempts)) log.attempts = [];
  const literacy = literacyScore(progress, log);
  const clocks = conceptClocks(progress, log, lessonsByConcept(), conceptsFor);
  const concepts = conceptRows(literacy.mastery, clocks);
  const history = readJSON(KEYS.literacy, { entries: [] });
  const literacyRows = appendLiteracy(history.entries || history, literacy, Date.now());
  const paper = readJSON('fp_paper', null);
  const thesis = scoreClosed(paper, thesisRowsFromPaper(paper));
  const behaviorStore = readJSON(KEYS.behavior, { entries: [] });
  let behavior = (behaviorStore.entries || []).map(normalizeBehavior).filter(Boolean);
  try{
    const report = detectPatterns(paper || { journal: [], pos: [] }, Date.now());
    behavior = appendSnapshot(behavior, behaviorSnapshot(report, Date.now()), 90).map(normalizeBehavior).filter(Boolean);
  }catch(e){}
  const riskStore = readJSON(KEYS.risk, { entries: [] });
  const risk = (riskStore.entries || []).map(normalizeRisk).filter(Boolean);
  const planStore = readJSON(KEYS.plans, { plans: [] });
  let plans = (planStore.plans || []).map(normalizePlan).filter(Boolean);
  const current = readJSON('fp_study_plan', null);
  const currentRow = normalizePlan(current);
  if(currentRow) plans = mergeRecords(plans.filter(function(row){ return row.id !== currentRow.id; }), [currentRow]);
  return {
    concepts: concepts,
    literacy: literacyRows,
    thesis: thesis,
    behavior: behavior,
    risk: risk,
    plans: plans,
    literacyResult: literacy,
    progress: progress,
    lessons: lessonRowsFromProgress(progress),
    log: log,
    paper: paper
  };
}

function observeStudy(local){
  let state = readEfficacy();
  const quizIds = (local.log.attempts || []).map(function(attempt){ return attempt && attempt.id; }).filter(Boolean);
  const diff = diffProgress(state, local.progress, quizIds);
  state = recordLiteracy(diff.state, local.literacyResult, Date.now());
  writeJSON(KEYS.efficacy, state);
  return state;
}

function applyMerged(local, plan){
  let changed = false;
  if(writeJSON(KEYS.mastery, { v: 1, rows: plan.merged.concepts })) changed = true;
  if(writeJSON(KEYS.literacy, { v: 1, entries: plan.merged.literacy })) changed = true;
  if(writeJSON(KEYS.behavior, { v: 1, entries: plan.merged.behavior })) changed = true;
  if(writeJSON(KEYS.risk, { v: 1, entries: plan.merged.risk })) changed = true;
  if(writeJSON(KEYS.plans, { v: 1, plans: plan.merged.plans })) changed = true;
  if(Array.isArray(plan.merged.lessons)){
    const store = progressFromLessonRows(plan.merged.lessons);
    if(writeJSON('fp_lessons', store)){
      changed = true;
      try{
        if(typeof window.updateLessonProgress === 'function') window.updateLessonProgress();
        const lessonsPage = document.getElementById('page-lessons');
        if(lessonsPage && lessonsPage.classList.contains('active') && typeof window.renderLessons === 'function') window.renderLessons();
      }catch(e){}
    }
  }
  const paperMerge = mergeThesisIntoPaper(local.paper || { pos: [], journal: [] }, plan.merged.thesis);
  if(local.paper && JSON.stringify(paperMerge.paper) !== JSON.stringify(local.paper)){
    if(writeJSON('fp_paper', paperMerge.paper)) changed = true;
  }
  if(writeJSON(KEYS.thesisAccount, { v: 1, entries: paperMerge.accountOnly })) changed = true;
  const current = readJSON('fp_study_plan', null);
  const week = current && current.weekKey;
  const remotePlan = (plan.merged.plans || []).find(function(row){ return row.id === week; });
  if(remotePlan && timeMs(remotePlan.at) > timeMs(current && current.generatedAt)){
    if(writeJSON('fp_study_plan', {
      v: 1,
      weekKey: remotePlan.id,
      generatedAt: timeMs(remotePlan.at),
      profileId: remotePlan.profileId,
      items: remotePlan.items
    })) changed = true;
  }
  return changed;
}

async function pullRemote(ctx){
  const specs = [
    ['concepts', 'concept_id,score,status,lessons_done,lessons_total,quiz_correct,quiz_total,updated_at', conceptFromDb],
    ['literacy', 'snapshot_id,score,lesson_points,quiz_points,breadth_points,lessons_done,lessons_total,quiz_correct,quiz_total,concepts_touched,concept_count,captured_at', literacyFromDb],
    ['thesis', 'entry_id,ticker,thesis,falsifier,expected_move,timeframe_days,confidence,max_stake_pct,stake_pct,status,scores,captured_at', thesisFromDb],
    ['behavior', 'snapshot_id,captured_at,cards', behaviorFromDb],
    ['risk', 'snapshot_id,source,captured_at,metrics', riskFromDb],
    ['plans', 'week_key,profile_id,generated_at,items', planFromDb],
    ['lessons', 'lesson_id,completed_at', lessonFromDb]
  ];
  const remote = {};
  for(let i = 0; i < specs.length; i++){
    const spec = tableSpec(specs[i][0]);
    const { data, error } = await ctx.client.from(spec.table).select(specs[i][1]).eq('user_id', ctx.userId);
    if(error) throw error;
    remote[specs[i][0]] = (data || []).map(specs[i][2]).filter(Boolean);
  }
  return remote;
}

async function pushBatches(ctx, batches){
  for(let i = 0; i < batches.length; i++){
    const batch = batches[i];
    const spec = tableSpec(batch.table);
    if(!spec) continue;
    const rows = batch.rows.map(function(row){ return spec.toRow(ctx.userId, row); }).filter(Boolean);
    if(!rows.length) continue;
    const { error } = await ctx.client.from(spec.table).upsert(rows, { onConflict: spec.conflict });
    if(error) throw error;
  }
}

async function uploadStudy(client, state){
  const body = buildRecordBody(state, true);
  if(!body || !client || !client.functions || typeof client.functions.invoke !== 'function') return state;
  const { data, error } = await client.functions.invoke('efficacy-summary', { body: body });
  if(error || !data || data.ok !== true) return state;
  const ids = Array.isArray(data.accepted) ? data.accepted : body.events.map(function(event){ return event.eventId; });
  return markUploaded(state, ids);
}

function refreshOpenPages(){
  const identity = document.getElementById('page-identity');
  if(identity && identity.classList.contains('active') && window.FPIdentity && typeof FPIdentity.render === 'function'){
    try{ FPIdentity.render(); }catch(e){}
  }
  const study = document.getElementById('page-study');
  if(study && study.classList.contains('active') && window.FPStudy && typeof FPStudy.render === 'function'){
    try{ FPStudy.render(); }catch(e){}
  }
}

async function syncNow(){
  const local = collectLocal();
  let study = observeStudy(local);
  const ctx = cloudCtx();
  const plan = syncCollections({
    signedIn: !!ctx,
    userId: ctx ? ctx.userId : null,
    local: local,
    remote: null
  });
  if(!ctx){
    applyMerged(local, plan);
    setStatus('Saved on this device. Sign in if you want a copy on your account. Nothing is sent while you are signed out.');
    return;
  }
  try{
    const remote = await pullRemote(ctx);
    const merged = syncCollections({ signedIn: true, userId: ctx.userId, local: local, remote: remote });
    const changed = applyMerged(local, merged);
    await pushBatches(ctx, merged.batches);
    study = await uploadStudy(ctx.client, study);
    writeJSON(KEYS.efficacy, study);
    setStatus('Saved on this device and on your account.');
    if(changed) refreshOpenPages();
  }catch(e){
    applyMerged(local, plan);
    setStatus('Saved on this device. Your account didn’t update just now.');
  }
}

function enqueue(){
  CHAIN = CHAIN.then(function(){ return syncNow(); }).catch(function(){
    setStatus('Saved on this device. Your account didn’t update just now.');
  });
  return CHAIN;
}

function schedule(){
  clearTimeout(TIMER);
  TIMER = setTimeout(function(){ enqueue(); }, 800);
}

function noteRisk(source, report){
  const snap = riskSnapshot(source === 'live' ? 'live' : 'paper', report, Date.now());
  if(!snap) return;
  const store = readJSON(KEYS.risk, { entries: [] });
  const entries = appendSnapshot((store.entries || []).map(normalizeRisk).filter(Boolean), snap, 90);
  if(writeJSON(KEYS.risk, { v: 1, entries: entries })) schedule();
}

window.FPIntelSync = {
  schedule: schedule,
  syncNow: function(){ return enqueue(); },
  noteRisk: noteRisk
};

document.addEventListener('visibilitychange', function(){
  if(!document.hidden) schedule();
});

schedule();
