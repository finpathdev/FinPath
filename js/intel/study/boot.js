// Consent screen and the public "Does FinPath work?" aggregate.
// The study is off until Join is pressed. Under 13 cannot join.
import {
  freshStudy, confirmAge, joinStudy, withdrawStudy, deletePayload, afterDelete, AGE_BANDS
} from './efficacy.js';

const KEY = 'fp_efficacy';
let BOUND = false;

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function readState(){
  try{
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if(raw && typeof raw === 'object'){
      return Object.assign(freshStudy(), raw, {
        pending: Array.isArray(raw.pending) ? raw.pending : [],
        progressIds: Array.isArray(raw.progressIds) ? raw.progressIds : [],
        seenLessons: raw.seenLessons && typeof raw.seenLessons === 'object' ? raw.seenLessons : {},
        seenQuizzes: Array.isArray(raw.seenQuizzes) ? raw.seenQuizzes : []
      });
    }
  }catch(e){}
  return freshStudy();
}

function writeState(state){
  try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){}
}

function signedIn(){
  return !!(window.supabaseClient && window.currentUser && window.currentUser.id);
}

function publicConfig(){
  const cfg = window.FP_PUBLIC_SUPABASE;
  if(cfg && cfg.url && cfg.key) return cfg;
  return null;
}

function literacyNow(){
  try{
    if(window.FPIdentity && typeof FPIdentity.model === 'function'){
      const state = FPIdentity.model();
      if(state && state.literacy) return state.literacy;
    }
  }catch(e){}
  return { score: 0, lessonPoints: 0, quizPoints: 0, breadthPoints: 0 };
}

function lessonMap(){
  try{
    const raw = JSON.parse(localStorage.getItem('fp_lessons') || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  }catch(e){ return {}; }
}

function quizIds(){
  try{
    const raw = JSON.parse(localStorage.getItem('fp_quiz_log') || '{"attempts":[]}');
    const attempts = raw && Array.isArray(raw.attempts) ? raw.attempts : [];
    return attempts.map(function(attempt){ return attempt && attempt.id; }).filter(Boolean);
  }catch(e){ return []; }
}

function setStatus(text){
  const el = document.getElementById('studyStatus');
  if(el) el.textContent = text || '';
}

function consentHtml(state){
  if(state.status === 'blocked' || state.ageConfirmed === 'under13'){
    return '<section class="id-section" id="studyBlock">' +
      '<h2>This study is not for anyone under 13</h2>' +
      '<p>FinPath still works. Lessons, the life model, and paper trading stay on this device. Nothing was sent for the study.</p>' +
      (state.studyId ? '<div class="life-actions"><button type="button" class="btn-secondary" id="studyDelete">Delete my study data</button></div>' : '') +
      '</section>';
  }
  if(state.status === 'joined' || state.status === 'withdrawn'){
    const band = state.ageBand ? esc(state.ageBand) : 'skipped';
    const joined = state.status === 'joined';
    return '<section class="id-section" id="studyJoined">' +
      '<h2>' + (joined ? 'You are in the study' : 'You left the study') + '</h2>' +
      '<p>Your study code stays on this device. It is not your name or your email. Age band: ' + band + '.</p>' +
      '<p class="life-help">' + (signedIn()
        ? 'You are signed in, so new scores can leave this device while you are in the study.'
        : 'You are signed out, so nothing leaves this device. Sign in only if you want a copy sent.') + '</p>' +
      '<p class="life-help">If you clear this browser’s saved data before deleting, we cannot find those rows again, because they are not tied to your email. Delete first if you want them gone.</p>' +
      '<div class="life-actions">' +
        (joined ? '<button type="button" class="btn-secondary" id="studyWithdraw">Leave the study</button>' : '') +
        '<button type="button" class="btn-primary" id="studyDelete">Delete my study data</button>' +
      '</div></section>';
  }
  const asked = state.ageConfirmed === '13plus';
  const bands = AGE_BANDS.map(function(band){
    return '<button type="button" class="life-chip" data-band="' + esc(band) + '" aria-pressed="false">' + esc(band) + '</button>';
  }).join('');
  return '<section class="id-section" id="studyConsent">' +
    '<h2>Join only if you want to</h2>' +
    '<p>This study asks whether FinPath helps people learn. It is off unless you turn it on.</p>' +
    '<p>If you join, FinPath saves a random study code on this device. It is not your name, email, school, or location. We do not ask your exact age. You can pick an age band, or skip it.</p>' +
    '<p>We save your literacy score when you join and again when it changes, and a count when you finish a lesson or a quiz. We do not save the lesson title, your answers, or your notes.</p>' +
    '<p>The study code is not tied to your email in the study table. You need to be signed in for a copy to leave this device. Signed out, it stays here.</p>' +
    '<p>You can leave whenever you want. Delete my study data removes the numbers stored for your study code.</p>' +
    '<h3>Are you 13 or older?</h3>' +
    '<div class="study-choice">' +
      '<button type="button" class="btn-secondary" id="studyAgeYes" aria-pressed="' + (asked ? 'true' : 'false') + '">Yes, I am 13 or older</button>' +
      '<button type="button" class="btn-secondary" id="studyAgeNo" aria-pressed="false">No, I am under 13</button>' +
    '</div>' +
    (asked
      ? '<h3>Age band, optional</h3><p class="life-help">Skip this if you would rather not say. We never ask for an exact age.</p>' +
        '<div class="study-choice" id="studyBands">' + bands +
        '<button type="button" class="life-chip" data-band="" aria-pressed="true">Skip</button></div>' +
        '<label class="study-check"><input type="checkbox" id="studyAgree"> <span>I understand and want to join. This is optional.</span></label>' +
        '<div class="life-actions"><button type="button" class="btn-primary" id="studyJoin">Join the study</button></div>'
      : '<p class="life-help">The study stays off until you answer. Under 13 cannot join.</p>') +
    '</section>';
}

function resultsHtml(summary, failed){
  if(failed){
    return '<section class="id-section" id="studyResults"><h2>The combined numbers</h2><p class="life-help">The summary didn’t load. The study on this device is unchanged.</p></section>';
  }
  if(!summary || summary.enough !== true){
    return '<section class="id-section" id="studyResults"><h2>The combined numbers</h2><p id="studyEnough">Not enough participants yet.</p><p class="life-help">FinPath shows a combined result only when at least 10 people have joined. Smaller groups are left out.</p></section>';
  }
  const lit = summary.literacy || {};
  function line(label, value, note){
    if(value == null) return '<li>' + esc(label) + ': ' + esc(note || 'Not enough for this number yet') + '</li>';
    return '<li>' + esc(label) + ': ' + esc(String(value)) + '</li>';
  }
  const bands = Array.isArray(summary.ageBands) && summary.ageBands.length
    ? '<h3>Age bands</h3><ul class="id-math">' + summary.ageBands.map(function(band){
      return '<li>' + esc(band.band) + ': ' + esc(String(band.participants)) + '</li>';
    }).join('') + '</ul>'
    : '<p class="life-help">Age bands are hidden when a group is smaller than 10.</p>';
  const progress = summary.progress
    ? '<li>Lessons finished: ' + esc(String(summary.progress.lessons)) + '</li><li>Quizzes finished: ' + esc(String(summary.progress.quizzes)) + '</li><li>People with a progress count: ' + esc(String(summary.progress.learners)) + '</li>'
    : '<li>Learning counts: Not enough for this number yet</li>';
  return '<section class="id-section" id="studyResults"><h2>The combined numbers</h2>' +
    '<p>' + esc(summary.message || '') + '</p>' +
    '<ul class="id-math">' +
      '<li>People in the study: ' + esc(String(summary.participants)) + '</li>' +
      line('Average literacy score at the start', lit.preMean, lit.preNote) +
      line('Average literacy score later', lit.postMean, lit.postNote) +
      line('Average change', lit.deltaMean, lit.deltaNote) +
      progress +
    '</ul>' + bands +
    '<p class="life-help">These are combined numbers. They are not a grade, and they are not a reason to buy or sell.</p></section>';
}

async function loadSummary(){
  const host = document.getElementById('studyResults');
  const cfg = publicConfig();
  if(!host) return;
  if(!cfg){
    host.innerHTML = resultsHtml(null, true);
    return;
  }
  try{
    const res = await fetch(cfg.url.replace(/\/$/, '') + '/functions/v1/efficacy-summary', {
      method: 'GET',
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key }
    });
    if(!res.ok){
      host.innerHTML = resultsHtml(null, true);
      return;
    }
    const body = await res.json();
    host.innerHTML = resultsHtml(body, false);
  }catch(e){
    host.innerHTML = resultsHtml(null, true);
  }
}

function render(){
  const host = document.getElementById('studyConsent');
  const results = document.getElementById('studyResults');
  if(!host) return;
  const state = readState();
  host.innerHTML = consentHtml(state);
  if(results && !results.dataset.loaded){
    results.innerHTML = '<p class="life-help">Loading the combined numbers…</p>';
  }
  loadSummary().then(function(){
    if(results) results.dataset.loaded = '1';
  });
}

function selectedBand(){
  const on = document.querySelector('#studyBands [data-band][aria-pressed="true"]');
  if(!on) return null;
  const value = on.getAttribute('data-band');
  return value ? value : null;
}

async function postStudy(body, withSession){
  const cfg = publicConfig();
  if(!cfg) return null;
  const headers = { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: 'Bearer ' + cfg.key };
  if(withSession && window.supabaseClient && window.supabaseClient.auth){
    try{
      const session = await window.supabaseClient.auth.getSession();
      const token = session && session.data && session.data.session && session.data.session.access_token;
      if(token) headers.Authorization = 'Bearer ' + token;
    }catch(e){}
  }
  const res = await fetch(cfg.url.replace(/\/$/, '') + '/functions/v1/efficacy-summary', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });
  let payload = null;
  try{ payload = await res.json(); }catch(e){ payload = null; }
  return { ok: res.ok, status: res.status, body: payload };
}

function bind(){
  if(BOUND) return;
  const root = document.getElementById('page-study');
  if(!root) return;
  BOUND = true;
  root.addEventListener('click', function(e){
    const band = e.target.closest('[data-band]');
    if(band && root.contains(band)){
      root.querySelectorAll('[data-band]').forEach(function(btn){ btn.setAttribute('aria-pressed', 'false'); });
      band.setAttribute('aria-pressed', 'true');
      return;
    }
    if(e.target.closest('#studyAgeNo')){
      const next = confirmAge(readState(), 'under13');
      writeState(next);
      render();
      setStatus('Nothing was sent.');
      return;
    }
    if(e.target.closest('#studyAgeYes')){
      const next = confirmAge(readState(), '13plus');
      writeState(next);
      render();
      return;
    }
    if(e.target.closest('#studyJoin')){
      const agree = document.getElementById('studyAgree');
      const result = joinStudy(readState(), {
        agree: !!(agree && agree.checked),
        ageBand: selectedBand(),
        studyId: crypto.randomUUID(),
        token: crypto.randomUUID() + crypto.randomUUID(),
        now: Date.now(),
        literacy: literacyNow(),
        lessons: lessonMap(),
        quizIds: quizIds()
      });
      if(result.error){
        setStatus(result.error === 'consent' ? 'Check the box if you want to join. The study stays off until you do.' : 'The study stays off.');
        return;
      }
      writeState(result.state);
      render();
      setStatus(signedIn()
        ? 'You joined. A copy can be saved when sync runs.'
        : 'You joined on this device. Nothing is sent until you sign in.');
      if(window.FPIntelSync && typeof FPIntelSync.schedule === 'function') FPIntelSync.schedule();
      return;
    }
    if(e.target.closest('#studyWithdraw')){
      writeState(withdrawStudy(readState()));
      render();
      setStatus('You left the study. New scores stay on this device. Use Delete my study data to remove what was already stored.');
      return;
    }
    if(e.target.closest('#studyDelete')){
      const state = readState();
      const payload = deletePayload(state);
      if(!payload){
        writeState(afterDelete(state));
        render();
        setStatus('There was no study data on this device to delete.');
        return;
      }
      writeState(withdrawStudy(state));
      render();
      setStatus('Deleting the stored study numbers…');
      postStudy(payload, false).then(function(res){
        if(res && res.ok){
          writeState(afterDelete(readState()));
          render();
          setStatus('Study data for that code was deleted. FinPath still works.');
        } else {
          setStatus('New scores stay on this device. The stored copy did not confirm a delete. Try Delete my study data again.');
        }
      }).catch(function(){
        setStatus('New scores stay on this device. The stored copy did not confirm a delete. Try again when you are online.');
      });
    }
  });
}

window.FPStudy = { render: render, readState: readState };

bind();
if(document.getElementById('page-study') && document.getElementById('page-study').classList.contains('active')) render();
