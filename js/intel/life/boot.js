// Life Path UI. The math lives in engine.js. This file only reads inputs,
// draws the page, and keeps the local journal.
import { simulate, defaultInputs, normalizeInputs, fvMonthly, monthlyPayment, compoundGrowth, creditScoreEstimate, deflate, monteCarloBands, SNAP_AGES, ENGINE_VERSION } from './engine.js';
import { PRESETS, presetById, applyPreset } from './presets.js';
import { comparePaths } from './compare.js';
import { mergeJournal, upsertEntry } from './journal.js';
import { futureLetter } from './future.js';
import { choosePath, mergeJournalEntries, journalRow, entryFromRow } from './sync.js';
import { conceptsFor, CONCEPTS } from '../learn/concepts.js';
import { lessonProgressMap, lessonStoreFromProgress } from '../learn/progress.js';
import { appendAttempt, makeAttempt, emptyQuizLog } from '../learn/quizlog.js';

const ASSUMPTIONS_URL = new URL('../../../data/life-assumptions.v1.json', import.meta.url);
let ASSUMPTIONS = null;
let BOUND = false;
let DOLLARS = 'today';
let COMPARE_ID = 'wait25';
let SYNC_TIMER = 0;
let SYNC_CHAIN = Promise.resolve();

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function money(n){
  if(!isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
}

function pct(n){
  if(!isFinite(n)) return '—';
  return (n * 100).toFixed(n * 100 >= 10 ? 1 : 2).replace(/\.0$/, '') + '%';
}

function viewOf(result, nominal, age){
  if(!isFinite(nominal)) return 0;
  if(DOLLARS === 'future') return nominal;
  const years = age - result.inputs.currentAge;
  if(!years) return nominal;
  return nominal / Math.pow(1 + result.inflation, years);
}

function loadStore(){
  try{
    const raw = JSON.parse(localStorage.getItem('fp_life') || 'null');
    if(raw && typeof raw === 'object') return raw;
  }catch(e){}
  return null;
}

function inputKey(inputs){
  if(!inputs) return '';
  return JSON.stringify({
    currentAge: inputs.currentAge,
    state: inputs.state,
    college: inputs.college,
    career: inputs.career,
    salary: inputs.salary == null || inputs.salary === '' ? null : inputs.salary,
    scholarship: inputs.scholarship,
    monthlyInvest: inputs.monthlyInvest
  });
}

function writeStore(record){
  try{
    localStorage.setItem('fp_life', JSON.stringify({
      v: 2,
      inputs: record.inputs,
      dollars: record.dollars === 'future' ? 'future' : 'today',
      comparePreset: record.comparePreset || COMPARE_ID,
      updatedAt: record.updatedAt || 0,
      touched: !!record.touched
    }));
    localStorage.setItem('fp_intel_v', '1');
  }catch(e){}
}

// Phase 1 stores had inputs and no timestamp. Stamp them once so a later
// cloud row cannot replace a path the learner already built on this device.
function ensureStamp(){
  const prev = loadStore();
  if(!prev || !prev.inputs) return;
  if(prev.updatedAt != null || prev.touched === false) return;
  prev.v = 2;
  prev.touched = true;
  prev.updatedAt = Date.now();
  try{ localStorage.setItem('fp_life', JSON.stringify(prev)); }catch(e){}
}

function saveStore(inputs){
  const prev = loadStore();
  if(prev && prev.inputs && inputKey(prev.inputs) === inputKey(inputs) && (prev.dollars || 'today') === DOLLARS && (prev.comparePreset || 'wait25') === COMPARE_ID) return;
  if(!prev){
    writeStore({ inputs: inputs, dollars: DOLLARS, comparePreset: COMPARE_ID, updatedAt: 0, touched: false });
    return;
  }
  writeStore({ inputs: inputs, dollars: DOLLARS, comparePreset: COMPARE_ID, updatedAt: Date.now(), touched: true });
  scheduleCloudPush();
}

function currentView(){
  const raw = (location.hash || '').replace(/^#/, '').replace(/^\/+|\/+$/g, '').toLowerCase();
  const parts = raw.split('/');
  if(parts[0] !== 'life') return { name: 'path', preset: null };
  const name = parts[1] || 'path';
  if(name === 'compare') return { name: 'compare', preset: null };
  if(name === 'future' || name === 'future-self') return { name: 'future', preset: null };
  if(name === 'journal') return { name: 'journal', preset: null };
  if(name === 'assumptions') return { name: 'assumptions', preset: null };
  if(name === 'whatif' || name === 'what-if') return { name: 'whatif', preset: parts[2] || 'invest50at16' };
  return { name: 'path', preset: null };
}

function setTab(name){
  const map = { path: 'lifeTabPath', compare: 'lifeTabCompare', whatif: 'lifeTabWhat', future: 'lifeTabFuture', journal: 'lifeTabJournal', assumptions: 'lifeTabAssume' };
  const panels = { path: 'lifePanelPath', compare: 'lifePanelCompare', whatif: 'lifePanelWhat', future: 'lifePanelFuture', journal: 'lifePanelJournal', assumptions: 'lifePanelAssume' };
  Object.keys(map).forEach(function(key){
    const tab = document.getElementById(map[key]);
    const panel = document.getElementById(panels[key]);
    const on = key === name;
    if(tab){
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    }
    if(panel) panel.hidden = !on;
  });
}

function go(hash){
  if(location.hash === hash) renderLife();
  else location.hash = hash;
}

function fillSelects(){
  const state = document.getElementById('lifeState');
  const career = document.getElementById('lifeCareer');
  const college = document.getElementById('lifeCollege');
  const compare = document.getElementById('lifeComparePick');
  if(state && !state.dataset.ready){
    const ids = Object.keys(ASSUMPTIONS.states);
    ids.sort(function(a, b){
      if(a === 'US') return -1;
      if(b === 'US') return 1;
      return ASSUMPTIONS.states[a].name.localeCompare(ASSUMPTIONS.states[b].name);
    });
    state.innerHTML = ids.map(function(id){
      const s = ASSUMPTIONS.states[id];
      const note = id === 'US' ? '' : ' · prices ' + s.rpp;
      return '<option value="' + esc(id) + '">' + esc(s.name + note) + '</option>';
    }).join('');
    state.dataset.ready = '1';
  }
  if(career && !career.dataset.ready){
    career.innerHTML = Object.keys(ASSUMPTIONS.careers).map(function(id){
      const c = ASSUMPTIONS.careers[id];
      return '<option value="' + esc(id) + '">' + esc(c.label) + ' · median ' + money(c.wage) + '</option>';
    }).join('');
    career.dataset.ready = '1';
  }
  if(college && !college.dataset.ready){
    college.innerHTML = Object.keys(ASSUMPTIONS.colleges).map(function(id){
      return '<option value="' + esc(id) + '">' + esc(ASSUMPTIONS.colleges[id].label) + '</option>';
    }).join('');
    college.dataset.ready = '1';
  }
  [compare, document.getElementById('lifeFuturePick')].forEach(function(el){
    if(el && !el.dataset.ready){
      el.innerHTML = PRESETS.map(function(p){
        return '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>';
      }).join('');
      el.dataset.ready = '1';
    }
  });
  const chips = document.getElementById('lifeWhatChips');
  if(chips && !chips.dataset.ready){
    chips.innerHTML = PRESETS.map(function(p){
      return '<button type="button" class="life-chip" data-preset="' + esc(p.id) + '" aria-pressed="false">' + esc(p.label) + '</button>';
    }).join('');
    chips.dataset.ready = '1';
    chips.addEventListener('click', function(e){
      const btn = e.target.closest('[data-preset]');
      if(!btn) return;
      go('#life/whatif/' + btn.getAttribute('data-preset'));
    });
  }
}

function applySaved(){
  const saved = loadStore();
  const defaults = defaultInputs(ASSUMPTIONS);
  const inputs = Object.assign({}, defaults, saved && saved.inputs ? saved.inputs : {});
  DOLLARS = saved && saved.dollars === 'future' ? 'future' : 'today';
  COMPARE_ID = saved && presetById(saved.comparePreset) ? saved.comparePreset : 'wait25';
  const set = function(id, value){
    const el = document.getElementById(id);
    if(el && value != null) el.value = String(value);
  };
  set('lifeAge', inputs.currentAge);
  set('lifeState', inputs.state);
  set('lifeCollege', inputs.college);
  set('lifeScholarship', inputs.scholarship || 0);
  set('lifeCareer', inputs.career);
  const salary = document.getElementById('lifeSalary');
  if(salary) salary.value = inputs.salary == null ? '' : String(inputs.salary);
  set('lifeMonthly', inputs.monthlyInvest);
  const pick = document.getElementById('lifeComparePick');
  const futurePick = document.getElementById('lifeFuturePick');
  if(pick) pick.value = COMPARE_ID;
  if(futurePick) futurePick.value = COMPARE_ID;
  syncDollarButtons();
  syncSalaryHint();
}

function syncDollarButtons(){
  const today = document.getElementById('lifeToday');
  const future = document.getElementById('lifeFuture');
  if(today) today.setAttribute('aria-pressed', DOLLARS === 'today' ? 'true' : 'false');
  if(future) future.setAttribute('aria-pressed', DOLLARS === 'future' ? 'true' : 'false');
}

function syncSalaryHint(){
  const career = document.getElementById('lifeCareer');
  const hint = document.getElementById('lifeSalaryHint');
  const salary = document.getElementById('lifeSalary');
  if(!career || !ASSUMPTIONS) return;
  const c = ASSUMPTIONS.careers[career.value] || ASSUMPTIONS.careers.median;
  if(salary) salary.placeholder = String(c.wage);
  if(hint){
    hint.textContent = 'Blank uses the May 2024 national median for this occupation ($' + Math.round(c.wage).toLocaleString('en-US') + ', BLS OEWS, SOC ' + c.soc + '). That median includes experienced workers. It is not a starting salary. New workers often earn less.';
  }
}

function readInputs(){
  const defaults = defaultInputs(ASSUMPTIONS);
  const age = document.getElementById('lifeAge');
  const salaryEl = document.getElementById('lifeSalary');
  const salaryRaw = salaryEl ? salaryEl.value.trim() : '';
  return {
    currentAge: age ? Number(age.value) : defaults.currentAge,
    state: (document.getElementById('lifeState') || {}).value || 'US',
    college: (document.getElementById('lifeCollege') || {}).value || defaults.college,
    career: (document.getElementById('lifeCareer') || {}).value || defaults.career,
    salary: salaryRaw === '' ? null : Number(salaryRaw),
    scholarship: Number((document.getElementById('lifeScholarship') || {}).value || 0),
    monthlyInvest: Number((document.getElementById('lifeMonthly') || {}).value || defaults.monthlyInvest),
    investStartAge: age ? Number(age.value) : defaults.currentAge,
    cardBalance: 0,
    car: false,
    raisePct: 0,
    raiseAge: 30,
    raiseInvestShare: 0.5,
    loansOverride: null
  };
}

function bind(){
  if(BOUND) return;
  BOUND = true;
  const form = document.getElementById('lifeForm');
  if(form) form.addEventListener('input', function(){ syncSalaryHint(); renderLife(); });
  const today = document.getElementById('lifeToday');
  const future = document.getElementById('lifeFuture');
  if(today) today.addEventListener('click', function(){ DOLLARS = 'today'; syncDollarButtons(); renderLife(); });
  if(future) future.addEventListener('click', function(){ DOLLARS = 'future'; syncDollarButtons(); renderLife(); });
  const suggest = document.getElementById('lifeUse20');
  if(suggest) suggest.addEventListener('click', function(){
    const inputs = readInputs();
    const wage = inputs.salary == null ? (ASSUMPTIONS.careers[inputs.career] || ASSUMPTIONS.careers.median).wage : inputs.salary;
    const tax = ASSUMPTIONS.values.fica_rate.value + ASSUMPTIONS.values.income_tax_rate.value;
    const monthly = Math.round(wage * (1 - tax) * 0.20 / 12);
    const el = document.getElementById('lifeMonthly');
    if(el) el.value = String(monthly);
    renderLife();
  });
  const twoHundred = document.getElementById('lifeUse200');
  if(twoHundred) twoHundred.addEventListener('click', function(){
    const el = document.getElementById('lifeMonthly');
    if(el) el.value = '200';
    renderLife();
  });
  document.querySelectorAll('[data-life-tab]').forEach(function(btn){
    btn.addEventListener('click', function(){
      const name = btn.getAttribute('data-life-tab');
      if(name === 'whatif') go('#life/whatif/invest50at16');
      else if(name === 'path') go('#life');
      else go('#life/' + name);
    });
  });
  const tabs = document.getElementById('lifeTabs');
  if(tabs) tabs.addEventListener('keydown', function(e){
    if(e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const list = Array.prototype.slice.call(tabs.querySelectorAll('[role="tab"]'));
    const i = list.indexOf(document.activeElement);
    if(i < 0) return;
    e.preventDefault();
    const n = e.key === 'ArrowRight' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[n].focus();
    list[n].click();
  });
  const pick = document.getElementById('lifeComparePick');
  const futurePick = document.getElementById('lifeFuturePick');
  function onPreset(value){
    if(!presetById(value)) return;
    COMPARE_ID = value;
    if(pick) pick.value = value;
    if(futurePick) futurePick.value = value;
    renderLife();
  }
  if(pick) pick.addEventListener('change', function(){ onPreset(pick.value); });
  if(futurePick) futurePick.addEventListener('change', function(){ onPreset(futurePick.value); });
  const saveCompare = document.getElementById('lifeSaveCompare');
  if(saveCompare) saveCompare.addEventListener('click', function(){ saveJournalCompare(); });
  const noteForm = document.getElementById('lifeNoteForm');
  if(noteForm) noteForm.addEventListener('submit', function(e){
    e.preventDefault();
    const input = document.getElementById('lifeNote');
    const text = input ? input.value.trim() : '';
    if(!text) return;
    writeEntry({
      id: 'note:' + Date.now().toString(36),
      kind: 'reflection',
      title: 'Note',
      why: text,
      conceptIds: [],
      at: Date.now(),
      ref: ''
    });
    if(input) input.value = '';
    renderLife();
  });
}

function readJournalEntries(){
  try{
    const raw = JSON.parse(localStorage.getItem('fp_journal') || 'null');
    if(raw && Array.isArray(raw.entries)) return raw.entries;
  }catch(e){}
  return [];
}

function writeEntry(entry){
  const next = upsertEntry(readJournalEntries(), entry);
  try{ localStorage.setItem('fp_journal', JSON.stringify({ v: 1, entries: next })); }catch(e){}
  scheduleCloudPush();
}

function lessonNames(){
  const names = {};
  if(typeof LESSONS === 'undefined') return names;
  LESSONS.forEach(function(l){ if(l && l.id) names[l.id] = l.name; });
  return names;
}

function journalItems(){
  let paper = null, goals = [], lessons = {}, quizzes = emptyQuizLog();
  try{ paper = JSON.parse(localStorage.getItem('fp_paper') || 'null'); }catch(e){}
  try{ goals = JSON.parse(localStorage.getItem('fp_goals') || '[]'); }catch(e){}
  try{ lessons = JSON.parse(localStorage.getItem('fp_lessons') || '{}'); }catch(e){}
  try{ quizzes = JSON.parse(localStorage.getItem('fp_quiz_log') || '{"v":1,"attempts":[]}'); }catch(e){}
  return mergeJournal({
    entries: readJournalEntries(),
    paper: paper,
    goals: goals,
    lessons: lessons,
    lessonNames: lessonNames(),
    lessonConcepts: null,
    quizzes: quizzes
  }).map(function(item){
    if(item.kind === 'learning' && item.ref === 'fp_lessons'){
      const slug = item.id.replace(/^learn:/, '');
      item.conceptIds = conceptsFor(slug);
    }
    return item;
  });
}

function assumptionList(keys){
  const seen = {};
  return keys.filter(function(k){
    if(seen[k] || !ASSUMPTIONS.values[k]) return false;
    seen[k] = 1;
    return true;
  }).map(function(k){
    const item = ASSUMPTIONS.values[k];
    const src = ASSUMPTIONS.sources[item.source] || {};
    return { key: k, item: item, src: src };
  });
}

function assumptionHtml(keys){
  const rows = assumptionList(keys);
  if(!rows.length) return '';
  return '<div class="life-sources"><h3>Assumptions used</h3><p class="life-help">Every rate below is a sourced input to this model. Change the inputs above if one of them is not your situation.</p><ul>' +
    rows.map(function(r){
      const url = (r.src.url && /^https:\/\//.test(r.src.url)) ? r.src.url : '';
      const value = formatAssumption(r.item);
      return '<li><b>' + esc(value) + '</b> — ' + esc(r.item.note || '') +
        '<div class="life-cite">' + esc(r.src.name || '') + (r.src.asOf ? ' · as of ' + esc(r.src.asOf) : '') +
        (url ? ' · <a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Source</a>' : '') +
        '</div></li>';
    }).join('') + '</ul></div>';
}

function formatAssumption(item){
  const n = Number(item.value);
  if(item.unit === 'annual_rate' || item.unit === 'share' || item.unit === 'share_of_takehome' || item.unit === 'share_of_balance' || item.unit === 'share_of_monthly_takehome' || item.unit === 'share_of_raise_takehome') return pct(n);
  if(item.unit === 'usd' || item.unit === 'usd_per_year' || item.unit === 'usd_per_month') return money(n);
  if(item.unit === 'flag') return n ? 'On' : 'Off';
  if(item.unit === 'years' || item.unit === 'months' || item.unit === 'age' || item.unit === 'times_spending') return String(n);
  return String(n);
}

function takeaway(result, bands){
  const end = result.snapshots[65];
  if(!end) return 'This path does not reach 65. Enter an age from 13 to 64.';
  const nw = money(viewOf(result, end.netWorth, 65));
  let base;
  if(result.crossoverAge){
    base = 'Around age ' + result.crossoverAge + ', growth on this path is larger than the dollars put in. By 65 the model’s net worth is ' + nw + '. That is the shape of compounding in a steady-rate model, not a forecast.';
  } else {
    base = 'By 65 this model’s net worth is ' + nw + '. Growth has not yet passed the dollars put in. A longer stretch of deposits is what makes compounding visible here. This is not a forecast.';
  }
  const band = bands && bands.rows ? bands.rows.find(function(r){ return r.age === 65; }) : null;
  if(!band) return base;
  return base + ' A classroom range around the invested balance at 65 runs from ' + money(viewOf(result, band.p10, 65)) + ' to ' + money(viewOf(result, band.p90, 65)) + '. That shade is uncertainty in a teaching model, not a forecast.';
}

function snapCards(result, bands){
  const band65 = bands && bands.rows ? bands.rows.find(function(r){ return r.age === 65; }) : null;
  const copy = {
    22: 'Starting line. For a four-year path that began at 18, this is graduation morning: school debt is in place, work has not started.',
    30: 'How fast the loan is falling, and whether investing has started.',
    45: 'Where compounding has had time to matter. Gross pay is the sum of paychecks in the model, not money saved.',
    65: 'The horizon of this model. Freedom progress uses 25× yearly living costs, a teaching rule of thumb, not a promise you can stop working.'
  };
  return SNAP_AGES.map(function(age){
    const row = result.snapshots[age];
    if(!row){
      return '<article class="life-snap"><h3>Age ' + age + '</h3><p class="life-help">This path starts at ' + result.inputs.currentAge + ', so age ' + age + ' is not in the projection.</p></article>';
    }
    const bits = [
      ['Net worth', money(viewOf(result, row.netWorth, age))],
      ['Invested', money(viewOf(result, row.portfolio, age))],
      ['Debt', money(viewOf(result, row.debt, age))],
      ['Put in', money(viewOf(result, row.contrib, age))]
    ];
    if(age >= 30) bits.push(['Gross pay in this model', money(viewOf(result, row.earnings, age))]);
    if(age >= 30) bits.push(['Freedom progress', row.freedom == null ? '—' : Math.round(row.freedom * 100) + '%']);
    if(age === 22) bits.push(['Yearly living costs ahead', money(viewOf(result, row.living, age))]);
    if(age === 65 && band65) bits.push(['Classroom range', money(viewOf(result, band65.p10, 65)) + ' – ' + money(viewOf(result, band65.p90, 65))]);
    return '<article class="life-snap"><h3>Age ' + age + '</h3><dl>' +
      bits.map(function(b){ return '<div><dt>' + b[0] + '</dt><dd>' + b[1] + '</dd></div>'; }).join('') +
      '</dl><p class="life-help">' + copy[age] + '</p></article>';
  }).join('');
}

function chartSvg(result, bands){
  const rows = result.rows;
  if(rows.length < 2) return '';
  const byAge = {};
  if(bands && bands.rows) bands.rows.forEach(function(r){ byAge[r.age] = r; });
  const vals = rows.map(function(r){ return viewOf(result, r.portfolio, r.age); });
  const cons = rows.map(function(r){ return viewOf(result, r.contrib, r.age); });
  const p10 = rows.map(function(r){ return viewOf(result, byAge[r.age] ? byAge[r.age].p10 : r.portfolio, r.age); });
  const p50 = rows.map(function(r){ return viewOf(result, byAge[r.age] ? byAge[r.age].p50 : r.portfolio, r.age); });
  const p90 = rows.map(function(r){ return viewOf(result, byAge[r.age] ? byAge[r.age].p90 : r.portfolio, r.age); });
  const maxV = Math.max.apply(null, vals.concat(cons, p90, [1]));
  const w = 640, h = 200, pad = 16;
  const x = function(i){ return pad + (w - pad * 2) * (i / (rows.length - 1)); };
  const y = function(v){ return h - pad - (v / maxV) * (h - pad * 2); };
  const line = function(arr){ return arr.map(function(v, i){ return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' '); };
  const bandPts = p90.map(function(v, i){ return x(i).toFixed(1) + ',' + y(v).toFixed(1); });
  for(let i = p10.length - 1; i >= 0; i--) bandPts.push(x(i).toFixed(1) + ',' + y(p10[i]).toFixed(1));
  const end = byAge[65];
  const range = end
    ? ' Classroom range at 65: low ' + money(viewOf(result, end.p10, 65)) + ', middle ' + money(viewOf(result, end.p50, 65)) + ', high ' + money(viewOf(result, end.p90, 65)) + '.'
    : '';
  const label = (result.crossoverAge
    ? 'Invested balance and contributions from age ' + result.inputs.currentAge + ' to 65, with a shaded classroom range. Growth passes contributions around age ' + result.crossoverAge + '.'
    : 'Invested balance and contributions from age ' + result.inputs.currentAge + ' to 65, with a shaded classroom range. Contributions are still larger than growth at 65 in this model.') + range;
  const legend = '<div class="life-legend"><span><i class="swatch band"></i>Classroom range (p10–p90)</span><span><i class="swatch mid"></i>Middle path (p50)</span><span><i class="swatch growth"></i>Steady invested balance</span><span><i class="swatch contrib"></i>Dollars put in</span></div>';
  return '<div class="life-chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' +
    '<polygon points="' + bandPts.join(' ') + '" fill="rgba(34,197,94,.20)" stroke="none"/>' +
    '<polyline points="' + line(cons) + '" fill="none" stroke="#93a693" stroke-width="2" stroke-dasharray="4 4"/>' +
    '<polyline points="' + line(p50) + '" fill="none" stroke="#86efac" stroke-width="1.5" stroke-dasharray="2 3"/>' +
    '<polyline points="' + line(vals) + '" fill="none" stroke="#22c55e" stroke-width="2.5"/>' +
    '</svg>' + legend +
    '<p class="life-help">' + esc(label) + ' The shade uses the same deposits as the steady line. It is a teaching range, not a forecast. Figures are ' + (DOLLARS === 'today' ? 'today’s dollars, using the 2% inflation assumption.' : 'future dollars, before adjusting for inflation.') + '</p></div>';
}

function bandTable(result, bands){
  if(!bands || !bands.rows) return '';
  const byAge = {};
  bands.rows.forEach(function(r){ byAge[r.age] = r; });
  const ages = SNAP_AGES.filter(function(age){ return byAge[age]; });
  if(!ages.length) return '';
  const body = ages.map(function(age){
    const r = byAge[age];
    return '<tr><th scope="row">' + age + '</th><td>' + money(viewOf(result, r.p10, age)) + '</td><td>' + money(viewOf(result, r.p50, age)) + '</td><td>' + money(viewOf(result, r.steady, age)) + '</td><td>' + money(viewOf(result, r.p90, age)) + '</td></tr>';
  }).join('');
  return '<div class="life-table-scroll"><table class="life-table"><caption>Classroom range for the invested balance. About 10% of the practice paths fell below the low column, and about 10% landed above the high column. Not a prediction.</caption><thead><tr><th>Age</th><th>Low (p10)</th><th>Middle (p50)</th><th>Steady</th><th>High (p90)</th></tr></thead><tbody>' + body + '</tbody></table></div>';
}

function yearTable(result){
  const head = '<table class="life-table"><caption>Birthday balances in this model</caption><thead><tr><th>Age</th><th>Invested</th><th>Put in</th><th>Debt</th><th>Net worth</th></tr></thead><tbody>';
  const body = result.rows.filter(function(r){
    return SNAP_AGES.indexOf(r.age) >= 0 || r.age === result.inputs.currentAge || r.age % 5 === 0;
  }).map(function(r){
    return '<tr><th scope="row">' + r.age + '</th><td>' + money(viewOf(result, r.portfolio, r.age)) + '</td><td>' + money(viewOf(result, r.contrib, r.age)) + '</td><td>' + money(viewOf(result, r.debt, r.age)) + '</td><td>' + money(viewOf(result, r.netWorth, r.age)) + '</td></tr>';
  }).join('');
  return head + body + '</tbody></table>';
}

function debtText(d){
  if(!d || d.reason === 'none') return 'No debt in this path';
  if(d.reason === 'clear') return 'Debt-free at ' + d.age;
  return 'Still in debt at 65';
}

function paintPath(inputs, result, bands){
  const meta = document.getElementById('lifeMeta');
  const college = ASSUMPTIONS.colleges[inputs.college];
  const state = ASSUMPTIONS.states[inputs.state];
  if(meta){
    meta.textContent = 'Age ' + result.inputs.currentAge + ' · ' + (college ? college.label : '') + ' · ' + (state ? state.name : '') + ' · assumptions ' + ASSUMPTIONS.version + ' · engine ' + ENGINE_VERSION;
  }
  const say = document.getElementById('lifeTakeaway');
  if(say) say.textContent = takeaway(result, bands);
  const snaps = document.getElementById('lifeSnaps');
  if(snaps) snaps.innerHTML = snapCards(result, bands);
  const chart = document.getElementById('lifeChart');
  if(chart) chart.innerHTML = chartSvg(result, bands) + bandTable(result, bands) + yearTable(result);
  const used = document.getElementById('lifeUsed');
  if(used){
    const keys = result.used.slice();
    if(ASSUMPTIONS.values.stock_vol && keys.indexOf('stock_vol') < 0) keys.push('stock_vol');
    used.innerHTML = assumptionHtml(keys);
  }
  const warn = document.getElementById('lifeAgeWarn');
  if(warn){
    const raw = Number((document.getElementById('lifeAge') || {}).value);
    warn.hidden = !(raw > 64 || raw < 13);
  }
}

function paintCompare(inputs, baseline){
  const host = document.getElementById('lifeCompareBody');
  if(!host || !ASSUMPTIONS) return;
  const preset = presetById(COMPARE_ID) || PRESETS[1];
  const otherInputs = applyPreset(inputs, preset.id, ASSUMPTIONS);
  const other = simulate(otherInputs, ASSUMPTIONS);
  const cmp = comparePaths(baseline, other, DOLLARS);
  const ages = cmp.rows.map(function(row){
    const cell = function(side){
      if(!side) return '<td>Not in this path</td>';
      return '<td>' + money(side.netWorth) + '<div class="life-help">Debt ' + money(side.debt) + '</div></td>';
    };
    return '<tr><th scope="row">Net worth at ' + row.age + '</th>' + cell(row.a) + cell(row.b) + '</tr>';
  }).join('');
  const gap = cmp.opportunity.gap;
  const who = gap > 1 ? 'My path' : gap < -1 ? preset.label : 'Neither path';
  const line = Math.abs(gap) < 1
    ? 'The two paths pay about the same interest in this model. Any net-worth gap comes from when deposits happen, not from extra interest.'
    : who + ' pays more interest. Grown to 65 at the sheet’s stock return (' + pct(baseline.stockRate) + '), that extra interest is about ' + money(Math.abs(gap)) + '. This is a next-best-use illustration, not a prediction, and it does not pick a winner.';
  const endA = baseline.snapshots[65];
  const endB = other.snapshots[65];
  host.innerHTML =
    '<div class="life-pair">' +
      '<section><h3>My path</h3><p class="life-help">' + esc(pathBlurb(inputs)) + '</p>' + metricList(baseline, endA) + '</section>' +
      '<section><h3>' + esc(preset.label) + '</h3><p class="life-help">' + esc(preset.blurb) + '</p>' + metricList(other, endB) + '</section>' +
    '</div>' +
    '<div class="life-callout"><h3>Opportunity cost</h3><p>' + esc(line) + '</p></div>' +
    '<table class="life-table"><caption>Side by side. ' + (DOLLARS === 'today' ? 'Today’s dollars.' : 'Future dollars.') + '</caption><thead><tr><th>Age</th><th>My path</th><th>' + esc(preset.label) + '</th></tr></thead><tbody>' +
      ages +
      '<tr><th scope="row">Debt-free</th><td>' + esc(debtText(baseline.debtFree)) + '</td><td>' + esc(debtText(other.debtFree)) + '</td></tr>' +
      '<tr><th scope="row">Freedom progress at 65</th><td>' + freedomCell(endA) + '</td><td>' + freedomCell(endB) + '</td></tr>' +
    '</tbody></table>' +
    '<p class="life-help">A higher balance can come with more years of work or more debt. Read the row, don’t crown a winner.</p>' +
    assumptionHtml(baseline.used.concat(other.used));
}

function freedomCell(row){
  if(!row || row.freedom == null) return '—';
  return Math.round(row.freedom * 100) + '% of 25× spending';
}

function metricList(result, end){
  if(!end) return '<p class="life-help">No age-65 snapshot.</p>';
  return '<dl class="life-metrics"><div><dt>Net worth at 65</dt><dd>' + money(viewOf(result, end.netWorth, 65)) + '</dd></div>' +
    '<div><dt>Invested</dt><dd>' + money(viewOf(result, end.portfolio, 65)) + '</dd></div>' +
    '<div><dt>Debt</dt><dd>' + money(viewOf(result, end.debt, 65)) + '</dd></div>' +
    '<div><dt>Interest paid</dt><dd>' + money(viewOf(result, result.totals.interest, 65)) + '</dd></div></dl>';
}

function pathBlurb(inputs){
  const college = ASSUMPTIONS.colleges[inputs.college];
  return 'Your inputs: age ' + inputs.currentAge + ', ' + (college ? college.label : 'school') + ', investing ' + money(inputs.monthlyInvest) + ' a month from that age when the paycheck covers it.';
}

function shortPath(inputs){
  const college = ASSUMPTIONS.colleges[inputs.college];
  return 'age ' + inputs.currentAge + ', ' + (college ? college.label : 'school') + ', ' + money(inputs.monthlyInvest) + ' a month';
}

function paintFuture(inputs, baseline, bands){
  const host = document.getElementById('lifeFutureBody');
  if(!host) return;
  const pick = document.getElementById('lifeFuturePick');
  if(pick) pick.value = COMPARE_ID;
  const preset = presetById(COMPARE_ID) || PRESETS[1];
  const other = simulate(applyPreset(inputs, preset.id, ASSUMPTIONS), ASSUMPTIONS);
  const pack = function(result){
    const out = {};
    SNAP_AGES.forEach(function(age){
      const row = result.snapshots[age];
      if(!row) return;
      out[age] = {
        portfolio: viewOf(result, row.portfolio, age),
        debt: viewOf(result, row.debt, age),
        netWorth: viewOf(result, row.netWorth, age)
      };
    });
    return out;
  };
  const end = bands && bands.rows ? bands.rows.find(function(r){ return r.age === 65; }) : null;
  let study = null;
  try{
    if(window.FPIdentity && typeof FPIdentity.snapshot === 'function') study = FPIdentity.snapshot();
  }catch(e){ study = null; }
  const letter = futureLetter({
    dollars: DOLLARS,
    ageNow: baseline.inputs.currentAge,
    pathLabel: shortPath(inputs),
    altLabel: preset.label,
    path: pack(baseline),
    alt: pack(other),
    band: end ? {
      p10: viewOf(baseline, end.p10, 65),
      p50: viewOf(baseline, end.p50, 65),
      p90: viewOf(baseline, end.p90, 65)
    } : null,
    identityLabel: study && study.label,
    literacyScore: study ? study.score : null
  });
  host.innerHTML = '<article class="life-letter"><h3>' + esc(letter.title) + '</h3>' +
    letter.paragraphs.map(function(p){ return '<p>' + esc(p) + '</p>'; }).join('') +
    '</article><p class="life-help">The other path is the what-if selected above, on your age, state, school, and pay. Figures are ' +
    (DOLLARS === 'today' ? 'today’s dollars.' : 'future dollars.') + ' This note is educational. It does not tell you what to do.</p>';
}

function paintWhat(inputs, baseline){
  const host = document.getElementById('lifeWhatBody');
  if(!host) return;
  const view = currentView();
  const id = view.preset && presetById(view.preset) ? view.preset : 'invest50at16';
  document.querySelectorAll('#lifeWhatChips .life-chip').forEach(function(btn){
    const on = btn.getAttribute('data-preset') === id;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const preset = presetById(id);
  const afterInputs = applyPreset(inputs, id, ASSUMPTIONS);
  const after = simulate(afterInputs, ASSUMPTIONS);
  const beforeEnd = baseline.snapshots[65];
  const afterEnd = after.snapshots[65];
  const three = [
    ['Net worth at 65', beforeEnd ? money(viewOf(baseline, beforeEnd.netWorth, 65)) : '—', afterEnd ? money(viewOf(after, afterEnd.netWorth, 65)) : '—'],
    ['Interest paid', money(viewOf(baseline, baseline.totals.interest, 65)), money(viewOf(after, after.totals.interest, 65))],
    ['Debt-free', debtText(baseline.debtFree), debtText(after.debtFree)]
  ];
  let extra = '';
  if(id === 'invest50at16' || id === 'wait25'){
    const ratePct = ASSUMPTIONS.values.stock_nominal.value * 100;
    const from16 = fvMonthly(50, ratePct, 49);
    const from25 = fvMonthly(50, ratePct, 40);
    const inflateYears = 49;
    const show16 = DOLLARS === 'today' ? from16 / Math.pow(1 + baseline.inflation, inflateYears) : from16;
    const show25 = DOLLARS === 'today' ? from25 / Math.pow(1 + baseline.inflation, inflateYears) : from25;
    extra = '<div class="life-callout"><h3>The classic comparison</h3><p>$50 every month, invested without a break, at the sheet’s stock return (' + pct(ASSUMPTIONS.values.stock_nominal.value) + '). No taxes, fees, or crashes. This is the compound-interest lesson’s math, using the same future-value function as the calculator.</p>' +
      '<dl class="life-metrics"><div><dt>From 16 to 65 (49 years)</dt><dd>' + money(show16) + '</dd></div>' +
      '<div><dt>From 25 to 65 (40 years)</dt><dd>' + money(show25) + '</dd></div>' +
      '<div><dt>Cost of waiting, in this illustration</dt><dd>' + money(show16 - show25) + '</dd></div></dl>' +
      '<p class="life-help">On your own path, deposits start at ' + after.inputs.currentAge + ' and pause when a school-year paycheck can’t cover them. The classic line does not pause.</p></div>';
  }
  if(id === 'car'){
    const payYear = after.flows.filter(function(f){ return f.carPaid > 0; })[0];
    if(payYear){
      const monthlyPay = payYear.carPaid / 12;
      const take = (payYear.income - payYear.tax) / 12;
      const share = take > 0 ? monthlyPay / take : null;
      const tight = ASSUMPTIONS.values.car_tight_share.value;
      extra = '<div class="life-callout"><h3>The payment</h3><p>About ' + money(monthlyPay) + ' a month' +
        (share == null ? '.' : ' — ' + Math.round(share * 100) + '% of take-home that year.') +
        (share != null && share > tight ? ' This model calls a payment above ' + pct(tight) + ' of take-home tight.' : ' If this is under ' + pct(tight) + ' of take-home, the payment still fits beside a small investing habit.') +
        ' The car is not added to net worth. Interest on the loan is about ' + money(viewOf(after, after.totals.carInterest, 65)) + ' over the loan.</p></div>';
    }
  }
  host.innerHTML = '<h3>' + esc(preset.title) + '</h3><p>' + esc(preset.blurb) + '</p>' +
    '<table class="life-table"><caption>Before and after, on your inputs</caption><thead><tr><th></th><th>My path</th><th>This what-if</th></tr></thead><tbody>' +
    three.map(function(r){ return '<tr><th scope="row">' + r[0] + '</th><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') +
    '</tbody></table>' + extra +
    '<div class="life-actions"><button type="button" class="btn-primary" id="lifeSaveWhat">Save this what-if to the journal</button>' +
    '<button type="button" class="btn-secondary" id="lifeOpenLesson">Open the lesson</button>' +
    '<button type="button" class="btn-secondary" id="lifeOpenQuiz">Try the quiz</button></div>' +
    assumptionHtml(after.used);
  const save = document.getElementById('lifeSaveWhat');
  if(save) save.addEventListener('click', function(){
    writeEntry({
      id: 'sim:' + preset.id,
      kind: 'simulation',
      title: preset.title,
      why: 'At 65 this model shows ' + (afterEnd ? money(viewOf(after, afterEnd.netWorth, 65)) : 'no') + ' net worth versus ' + (beforeEnd ? money(viewOf(baseline, beforeEnd.netWorth, 65)) : 'no') + ' on my path.',
      conceptIds: preset.concepts,
      at: Date.now(),
      ref: preset.id
    });
    const status = document.getElementById('lifeWhatSaved');
    if(status) status.textContent = 'Saved to the journal on this device.';
  });
  const lessonBtn = document.getElementById('lifeOpenLesson');
  const quizBtn = document.getElementById('lifeOpenQuiz');
  if(lessonBtn) lessonBtn.addEventListener('click', function(){ if(typeof openLessonById === 'function') openLessonById(preset.lesson); });
  if(quizBtn) quizBtn.addEventListener('click', function(){ if(typeof openLessonQuiz === 'function') openLessonQuiz(preset.lesson); });
}

function paintJournal(){
  const list = document.getElementById('lifeJournalList');
  if(!list) return;
  const items = journalItems();
  if(!items.length){
    list.innerHTML = '<p class="life-empty">Nothing here yet. Finish a lesson, set a savings goal, place a paper trade, or save a what-if. Notes stay in this browser.</p>';
    return;
  }
  list.innerHTML = '<ol class="life-journal">' + items.slice(0, 80).map(function(item){
    const when = item.at > 946684800000 ? new Date(item.at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const tags = item.conceptIds.map(function(id){ return CONCEPTS[id] || id; }).filter(Boolean);
    return '<li><div class="life-journal-top"><span class="life-kind">' + esc(item.kind) + '</span><time>' + esc(when) + '</time></div>' +
      '<div class="life-journal-title">' + esc(item.title) + '</div>' +
      (item.why ? '<p>' + esc(item.why) + '</p>' : '') +
      (tags.length ? '<p class="life-help">' + esc(tags.join(' · ')) + '</p>' : '') +
      '</li>';
  }).join('') + '</ol>';
}

function paintAssumptions(){
  const host = document.getElementById('lifeAssumeBody');
  if(!host || host.dataset.ready) return;
  const keys = Object.keys(ASSUMPTIONS.values);
  host.innerHTML = '<p>Version <b>' + esc(ASSUMPTIONS.version) + '</b>, reviewed ' + esc(ASSUMPTIONS.reviewed) + '. These are national sticker prices and medians, not a quote for your life. State price levels scale living costs. Wages stay at the national median.</p>' + assumptionHtml(keys);
  const states = Object.keys(ASSUMPTIONS.states).filter(function(id){ return id !== 'US'; }).map(function(id){
    const s = ASSUMPTIONS.states[id];
    return '<tr><th scope="row">' + esc(s.name) + '</th><td>' + s.rpp.toFixed(1) + '</td></tr>';
  }).join('');
  host.innerHTML += '<h3>State price levels</h3><p class="life-help">BEA regional price parities, all items, 2023. United States = 100.</p><div class="life-table-scroll"><table class="life-table"><caption>Regional price parities</caption><thead><tr><th>State</th><th>RPP</th></tr></thead><tbody>' + states + '</tbody></table></div>';
  host.dataset.ready = '1';
}

function saveJournalCompare(){
  const preset = presetById(COMPARE_ID);
  if(!preset) return;
  writeEntry({
    id: 'sim:compare:' + preset.id,
    kind: 'simulation',
    title: 'Compared my path with “' + preset.label + '”',
    why: 'Saved from the compare view.',
    conceptIds: preset.concepts,
    at: Date.now(),
    ref: preset.id
  });
  const status = document.getElementById('lifeCompareSaved');
  if(status) status.textContent = 'Saved to the journal on this device.';
}

function renderLife(){
  const status = document.getElementById('lifeStatus');
  if(!ASSUMPTIONS){
    if(status) status.textContent = 'Loading the life model…';
    return;
  }
  if(status) status.textContent = '';
  ensureStamp();
  fillSelects();
  if(!BOUND){
    applySaved();
    bind();
  }
  const view = currentView();
  setTab(view.name);
  const inputs = readInputs();
  saveStore(inputs);
  let result;
  try{ result = simulate(inputs, ASSUMPTIONS); }
  catch(e){
    if(status) status.textContent = 'The life model hit a problem on these inputs. Check the numbers and try again.';
    return;
  }
  let bands = null;
  try{ bands = monteCarloBands(inputs, ASSUMPTIONS, { result: result }); }
  catch(e){ bands = null; }
  paintPath(inputs, result, bands);
  if(view.name === 'compare') paintCompare(inputs, result);
  if(view.name === 'whatif') paintWhat(inputs, result);
  if(view.name === 'future') paintFuture(inputs, result, bands);
  if(view.name === 'journal') paintJournal();
  if(view.name === 'assumptions') paintAssumptions();
  syncDollarButtons();
  paintIdentityLine();
}

function paintIdentityLine(){
  const el = document.getElementById('lifeIdentityLine');
  if(!el) return;
  let html = '';
  try{
    if(window.FPIdentity && typeof FPIdentity.lifeLineHtml === 'function') html = FPIdentity.lifeLineHtml() || '';
  }catch(e){ html = ''; }
  el.innerHTML = html;
  el.hidden = !html;
}

async function loadAssumptions(){
  const res = await fetch(ASSUMPTIONS_URL);
  if(!res.ok) throw new Error('assumptions ' + res.status);
  return res.json();
}

window.FPLearn = {
  conceptsFor: conceptsFor,
  lessonProgressMap: lessonProgressMap,
  lessonStoreFromProgress: lessonStoreFromProgress,
  appendAttempt: appendAttempt,
  makeAttempt: makeAttempt,
  emptyQuizLog: emptyQuizLog
};

function enqueueSync(fn){
  SYNC_CHAIN = SYNC_CHAIN.then(function(){ return fn(); }).catch(function(){});
  return SYNC_CHAIN;
}

function scheduleCloudPush(){
  clearTimeout(SYNC_TIMER);
  SYNC_TIMER = setTimeout(function(){ enqueueSync(pushCloud); }, 800);
}

function cloudCtx(){
  const client = window.supabaseClient;
  const user = window.currentUser;
  if(!client || !client.from || !user || !user.id || !ASSUMPTIONS) return null;
  return { client: client, userId: user.id };
}

function setSyncStatus(text){
  const el = document.getElementById('lifeSync');
  if(el && text) el.textContent = text;
}

function localRecord(raw){
  if(!raw || !raw.inputs) return null;
  return {
    inputs: raw.inputs,
    dollars: raw.dollars,
    comparePreset: raw.comparePreset,
    updatedAt: raw.updatedAt,
    touched: raw.touched === true
  };
}

function applyRecord(record){
  if(!record || !record.inputs) return;
  DOLLARS = record.dollars === 'future' ? 'future' : 'today';
  if(presetById(record.comparePreset)) COMPARE_ID = record.comparePreset;
  writeStore({
    inputs: record.inputs,
    dollars: DOLLARS,
    comparePreset: COMPARE_ID,
    updatedAt: record.updatedAt,
    touched: true
  });
  const set = function(id, value){
    const el = document.getElementById(id);
    if(el && value != null) el.value = String(value);
  };
  set('lifeAge', record.inputs.currentAge);
  set('lifeState', record.inputs.state);
  set('lifeCollege', record.inputs.college);
  set('lifeScholarship', record.inputs.scholarship || 0);
  set('lifeCareer', record.inputs.career);
  const salary = document.getElementById('lifeSalary');
  if(salary) salary.value = record.inputs.salary == null ? '' : String(record.inputs.salary);
  set('lifeMonthly', record.inputs.monthlyInvest);
  const pick = document.getElementById('lifeComparePick');
  const futurePick = document.getElementById('lifeFuturePick');
  if(pick) pick.value = COMPARE_ID;
  if(futurePick) futurePick.value = COMPARE_ID;
  syncDollarButtons();
  syncSalaryHint();
  renderLife();
}

async function fetchRemotePath(ctx){
  const { data, error } = await ctx.client.from('life_paths').select('inputs,dollars,compare_preset,updated_at').eq('user_id', ctx.userId).maybeSingle();
  if(error) throw error;
  if(!data || !data.inputs || typeof data.inputs !== 'object') return null;
  return {
    inputs: data.inputs,
    dollars: data.dollars,
    comparePreset: data.compare_preset,
    updatedAt: data.updated_at,
    touched: true
  };
}

async function pushPath(ctx, record){
  const inputs = normalizeInputs(record.inputs, ASSUMPTIONS);
  const { error } = await ctx.client.from('life_paths').upsert({
    user_id: ctx.userId,
    inputs: inputs,
    dollars: record.dollars === 'future' ? 'future' : 'today',
    compare_preset: String(record.comparePreset || 'wait25').slice(0, 40),
    assumptions_version: String(ASSUMPTIONS.version || '').slice(0, 40),
    engine: String(ENGINE_VERSION).slice(0, 40),
    updated_at: new Date(record.updatedAt).toISOString()
  }, { onConflict: 'user_id' });
  if(error) throw error;
}

async function pullJournal(ctx){
  const { data, error } = await ctx.client.from('life_journal').select('entry_id,kind,title,why,concept_ids,at,ref').eq('user_id', ctx.userId);
  if(error) throw error;
  const remote = (data || []).map(entryFromRow).filter(Boolean);
  const local = readJournalEntries();
  const merged = mergeJournalEntries(local, remote);
  if(JSON.stringify(merged) !== JSON.stringify(local)){
    try{ localStorage.setItem('fp_journal', JSON.stringify({ v: 1, entries: merged })); }catch(e){}
    if(currentView().name === 'journal') paintJournal();
  }
}

async function pushJournalFromLocal(ctx){
  const rows = readJournalEntries().map(function(entry){ return journalRow(ctx.userId, entry); }).filter(Boolean);
  if(!rows.length) return;
  for(let i = 0; i < rows.length; i += 100){
    const { error } = await ctx.client.from('life_journal').upsert(rows.slice(i, i + 100), { onConflict: 'user_id,entry_id' });
    if(error) throw error;
  }
}

async function pushCloud(){
  const ctx = cloudCtx();
  if(!ctx){
    setSyncStatus('Saved on this device. Sign in if you want a copy on your account too.');
    return;
  }
  try{
    const remote = await fetchRemotePath(ctx);
    const choice = choosePath(localRecord(loadStore()), remote);
    if(choice.source === 'remote'){
      applyRecord(choice.record);
      await pullJournal(ctx);
      setSyncStatus('Brought the newer copy from your account onto this device. Your notes stayed here too.');
      return;
    }
    if(choice.push && choice.record) await pushPath(ctx, choice.record);
    await pullJournal(ctx);
    await pushJournalFromLocal(ctx);
    setSyncStatus('Saved on this device and on your account.');
  }catch(e){
    setSyncStatus('Saved on this device. Your account didn’t update just now.');
  }
}

async function syncNow(){
  if(!ASSUMPTIONS) return;
  ensureStamp();
  const ctx = cloudCtx();
  if(!ctx){
    setSyncStatus('Saved on this device. Sign in if you want a copy on your account too.');
    return;
  }
  try{
    const remote = await fetchRemotePath(ctx);
    const choice = choosePath(localRecord(loadStore()), remote);
    if(choice.source === 'remote') applyRecord(choice.record);
    else if(choice.push && choice.record) await pushPath(ctx, choice.record);
    await pullJournal(ctx);
    await pushJournalFromLocal(ctx);
    setSyncStatus('Saved on this device. Your account has this path and the notes you saved here.');
  }catch(e){
    setSyncStatus('Saved on this device. Your account didn’t update just now.');
  }
}

window.FPLife = {
  ENGINE_VERSION: ENGINE_VERSION,
  fvMonthly: fvMonthly,
  monthlyPayment: monthlyPayment,
  compoundGrowth: compoundGrowth,
  creditScoreEstimate: creditScoreEstimate,
  deflate: deflate,
  simulate: simulate,
  monteCarloBands: monteCarloBands,
  render: renderLife,
  syncNow: function(){ enqueueSync(syncNow); }
};

loadAssumptions().then(function(data){
  ASSUMPTIONS = data;
  if(document.getElementById('page-life') && document.getElementById('page-life').classList.contains('active')) renderLife();
  enqueueSync(syncNow);
}).catch(function(){
  const status = document.getElementById('lifeStatus');
  if(status) status.textContent = 'The assumptions file didn’t load. Refresh once you’re online. The rest of FinPath still works.';
});
