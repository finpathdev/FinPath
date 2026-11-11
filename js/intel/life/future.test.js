import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { futureLetter, projectAtAge, projectFutureSelves, rankDecisions, decisionLine, futureSelfLetter, buildFutureSelf, lifePathReady, portrayedAssumptions, FUTURE_SELF_AGES } from './future.js';
import { simulate, defaultInputs, monteCarloBands } from './engine.js';
import { PRESETS, applyPreset } from './presets.js';

const assumptions = JSON.parse(readFileSync(new URL('../../../data/life-assumptions.v1.json', import.meta.url), 'utf8'));
const ADVICE = /you should|i recommend|buy this|sell your|borrow more|you need to/i;

const path = {
  30: { portfolio: 8000, debt: 12000, netWorth: -4000 },
  45: { portfolio: 40000, debt: 0, netWorth: 40000 },
  65: { portfolio: 180000, debt: 0, netWorth: 180000 }
};
const alt = {
  30: { portfolio: 1000, debt: 12000, netWorth: -11000 },
  45: { portfolio: 22000, debt: 0, netWorth: 22000 },
  65: { portfolio: 90000, debt: 0, netWorth: 90000 }
};

test('future letter frames 65 and the what-if without advice', function(){
  const letter = futureLetter({
    dollars: 'today',
    ageNow: 16,
    pathLabel: 'age 16, in-state school, $50 a month',
    altLabel: 'Wait until 25',
    path: path,
    alt: alt,
    band: { p10: 60000, p50: 170000, p90: 420000 }
  });
  const text = [letter.title].concat(letter.paragraphs).join('\n');
  assert.match(letter.title, /65/);
  assert.match(text, /Hey/);
  assert.match(text, /180,000|180000/);
  assert.match(text, /Wait until 25/);
  assert.match(text, /90,000|90000/);
  assert.match(text, /60,000|60000/);
  assert.match(text, /420,000|420000/);
  assert.match(text, /postcard from age 30/i);
  assert.match(text, /postcard from age 45/i);
  assert.match(text, /not a reason to buy, sell, or borrow/i);
  assert.doesNotMatch(text, /literacy score/i);
  assert.doesNotMatch(text, /you should|i recommend|buy this|sell your|borrow more|you need to/i);
});

test('future letter can mention a study profile without giving advice', function(){
  const letter = futureLetter({
    dollars: 'today',
    ageNow: 16,
    pathLabel: 'age 16',
    altLabel: '',
    path: path,
    alt: null,
    band: null,
    identityLabel: 'Steady Saver',
    literacyScore: 240
  });
  const text = letter.paragraphs.join('\n');
  assert.match(text, /Steady Saver/);
  assert.match(text, /240 out of 1000/);
  assert.match(text, /not a reason to buy, sell, or borrow/i);
  assert.doesNotMatch(text, /you should|i recommend|buy this|sell your|borrow more|you need to/i);
});

test('future letter skips birthdays already behind the learner', function(){
  const letter = futureLetter({
    dollars: 'future',
    ageNow: 40,
    pathLabel: 'age 40',
    altLabel: '',
    path: path,
    alt: null,
    band: null
  });
  const text = letter.paragraphs.join('\n');
  assert.match(text, /future dollars/);
  assert.doesNotMatch(text, /postcard from age 30/i);
  assert.match(text, /postcard from age 45/i);
  assert.match(text, /not a reason to buy, sell, or borrow/i);
});

test('ages 40 and 60 project a classroom net-worth range from the Monte Carlo band', function(){
  const inputs = defaultInputs(assumptions);
  const result = simulate(inputs, assumptions);
  const bands = monteCarloBands(inputs, assumptions, { result: result, seed: 7, paths: 80 });
  const nominal = projectFutureSelves(result, bands, { dollars: 'future' });
  assert.deepEqual(FUTURE_SELF_AGES, [40, 60]);
  assert.deepEqual(nominal.map(function(card){ return card.age; }), [40, 60]);
  nominal.forEach(function(card){
    const row = result.rows.find(function(r){ return r.age === card.age; });
    const band = bands.rows.find(function(r){ return r.age === card.age; });
    const flow = result.flows.find(function(f){ return f.age === card.age; });
    assert.equal(card.reachable, true);
    assert.ok(card.netWorth.p10 <= card.netWorth.p50);
    assert.ok(card.netWorth.p50 <= card.netWorth.p90);
    assert.equal(Math.round(card.netWorth.p10 * 100), Math.round((band.p10 - row.debt) * 100));
    assert.equal(Math.round(card.netWorth.p50 * 100), Math.round((band.p50 - row.debt) * 100));
    assert.equal(Math.round(card.netWorth.p90 * 100), Math.round((band.p90 - row.debt) * 100));
    assert.equal(Math.round(card.netWorth.steady * 100), Math.round(row.netWorth * 100));
    assert.equal(card.retirement.freedom, row.freedom);
    assert.ok(card.retirement.meter >= 0 && card.retirement.meter <= 1);
    const take = flow.income - flow.tax;
    if(take > 1) assert.ok(Math.abs(card.savingsRate - flow.invested / take) < 1e-9);
    else assert.equal(card.savingsRate, null);
    if(row.living > 0) assert.ok(Math.abs(card.emergencyMonths - row.portfolio / (row.living / 12)) < 1e-6);
    assert.ok(card.debt.status === 'none' || card.debt.status === 'clear' || card.debt.status === 'open');
  });
  const today = projectAtAge(result, bands, 60, { dollars: 'today' });
  assert.ok(nominal[1].netWorth.steady > today.netWorth.steady);
  assert.ok(nominal[1].retirement.freedom >= nominal[0].retirement.freedom);
});

test('age 40 is already behind a path that starts at 55', function(){
  const inputs = Object.assign({}, defaultInputs(assumptions), { currentAge: 55, investStartAge: 55 });
  const result = simulate(inputs, assumptions);
  const selves = projectFutureSelves(result, null, { dollars: 'today' });
  assert.equal(selves[0].reachable, false);
  assert.equal(selves[0].reason, 'past');
  assert.equal(selves[1].reachable, true);
  const letter = futureSelfLetter(selves[0], { ageNow: 55 });
  const text = letter.paragraphs.join('\n');
  assert.match(text, /already behind/i);
  assert.match(text, /55/);
  assert.doesNotMatch(text, /\$\d/);
  assert.match(text, /not a reason to buy, sell, or borrow/i);
  assert.doesNotMatch(text, ADVICE);
});

test('rankDecisions keeps the three largest gaps and links into compare', function(){
  const ranked = rankDecisions(1000, [
    { id: 'a', label: 'Smaller', netWorth: 1100 },
    { id: 'b', label: 'Biggest', netWorth: 5000 },
    { id: 'c', label: 'Tiny', netWorth: 900 },
    { id: 'd', label: 'Same', netWorth: 1000 },
    { id: 'e', label: 'Middle', netWorth: 2000 },
    { id: 'nope/../x', label: 'Unsafe', netWorth: 9000 }
  ]);
  assert.deepEqual(ranked.map(function(row){ return row.id; }), ['nope/../x', 'b', 'e']);
  assert.equal(ranked[0].href, '#life/compare');
  assert.equal(ranked[1].href, '#life/compare/b');
  assert.equal(ranked[1].direction, 'higher');
  assert.match(decisionLine(ranked[1]), /higher/);
  assert.match(decisionLine(ranked[2]), /higher/);
  const tied = rankDecisions(100, [
    { id: 'b', label: 'B', netWorth: 150 },
    { id: 'a', label: 'A', netWorth: 50 }
  ]);
  assert.deepEqual(tied.map(function(row){ return row.id; }), ['a', 'b']);
  assert.equal(tied[0].direction, 'lower');
  assert.doesNotMatch(decisionLine(tied[0]) + decisionLine(tied[1]), ADVICE);
});

test('letters at 40 and 60 name the choices and stay warm without advice', function(){
  const portrait = function(age){
    return {
      age: age,
      reachable: true,
      dollars: 'today',
      ageNow: 16,
      netWorth: { steady: 42000, p10: 18000, p50: 40000, p90: 90000 },
      savingsLine: 'In the year that starts at this birthday, the model invests about 8.4% of take-home.',
      emergencyLine: 'The invested balance could cover about 4.2 months of this model\'s living costs.',
      debt: { line: 'About $8,000 of school or card debt is still in the model at this birthday.', status: 'open' },
      retirement: { line: 'The retirement meter reads 18% of the 25× yearly spending line this class uses.' }
    };
  };
  const decisions = [
    { id: 'wait25', label: 'Wait until 25', gap: -12000, direction: 'lower', href: '#life/compare/wait25' },
    { id: 'card', label: 'Credit card debt', gap: -4000, direction: 'lower', href: '#life/compare/card' },
    { id: 'raise', label: 'Raise, invest half', gap: 9000, direction: 'higher', href: '#life/compare/raise' }
  ];
  const ctx = {
    ageNow: 16,
    monthly: 50,
    collegeLabel: 'In-state public university (4 years)',
    careerLabel: 'Not sure yet — all occupations',
    stateName: 'California',
    identityLabel: 'Steady Saver',
    identitySource: 'picked',
    literacyScore: 240,
    decisions: decisions
  };
  const at40 = futureSelfLetter(portrait(40), ctx);
  const at60 = futureSelfLetter(portrait(60), Object.assign({}, ctx, { identitySource: 'suggested', identityLabel: 'Balanced Learner' }));
  const text = [at40.title].concat(at40.paragraphs, [at60.title], at60.paragraphs).join('\n');
  assert.match(at40.title, /you at 40/i);
  assert.match(at60.title, /you at 60/i);
  assert.match(text, /Hey/);
  assert.match(text, /\$50/);
  assert.match(text, /In-state public university/);
  assert.match(text, /California/);
  assert.match(text, /Steady Saver/);
  assert.match(text, /Balanced Learner/);
  assert.match(text, /240 out of 1000/);
  assert.match(text, /18,000|18000/);
  assert.match(text, /90,000|90000/);
  assert.match(text, /8\.4%/);
  assert.match(text, /Wait until 25/);
  assert.match(text, /Credit card debt/);
  assert.match(text, /Raise, invest half/);
  assert.match(text, /not a reason to buy, sell, or borrow/i);
  assert.match(text, /not picking a winner/i);
  assert.doesNotMatch(text, ADVICE);
});

test('buildFutureSelf ranks real what-ifs and discloses the sheet rates', function(){
  const inputs = defaultInputs(assumptions);
  inputs.state = 'CA';
  const result = simulate(inputs, assumptions);
  const bands = monteCarloBands(inputs, assumptions, { result: result, seed: 3, paths: 40 });
  const alternates = PRESETS.map(function(preset){
    return {
      id: preset.id,
      label: preset.label,
      title: preset.title,
      lesson: preset.lesson,
      result: simulate(applyPreset(inputs, preset.id, assumptions), assumptions)
    };
  });
  const built = buildFutureSelf({
    result: result,
    bands: bands,
    dollars: 'today',
    alternates: alternates,
    context: {
      ageNow: result.inputs.currentAge,
      monthly: result.inputs.monthlyInvest,
      collegeLabel: assumptions.colleges[result.inputs.college].label,
      careerLabel: assumptions.careers[result.inputs.career].label,
      stateName: 'California',
      identityLabel: 'Curious Investor',
      identitySource: 'suggested',
      literacyScore: 0
    }
  });
  assert.equal(built.letters.length, 2);
  assert.equal(built.decisionsByAge[40].length, 3);
  assert.equal(built.decisionsByAge[60].length, 3);
  built.decisionsByAge[40].forEach(function(row){
    assert.match(row.href, /^#life\/compare\/[a-z0-9]+$/);
    assert.ok(PRESETS.some(function(preset){ return preset.id === row.id; }));
  });
  const abs = built.decisionsByAge[60].map(function(row){ return Math.abs(row.gap); });
  assert.ok(abs[0] >= abs[1] && abs[1] >= abs[2]);
  const text = built.letters.map(function(letter){ return letter.paragraphs.join('\n'); }).join('\n');
  assert.match(text, /Curious Investor/);
  assert.match(text, /California/);
  assert.match(text, /\$50/);
  assert.doesNotMatch(text, ADVICE);
  const sheet = portrayedAssumptions(assumptions);
  assert.equal(sheet.stockNominal, 0.0964);
  assert.equal(sheet.inflation, 0.02);
  assert.equal(sheet.safeMultiple, 25);
  assert.deepEqual(sheet.lessons.map(function(link){ return link.hash; }), ['#lesson/6', '#lesson/16', '#lesson/9']);
});

test('life path is ready only after the learner saves it', function(){
  assert.equal(lifePathReady(null), false);
  assert.equal(lifePathReady({ touched: false, inputs: { currentAge: 16 } }), false);
  assert.equal(lifePathReady({ inputs: { currentAge: 16 } }), false);
  assert.equal(lifePathReady({ touched: true, inputs: { currentAge: 22 } }), true);
});

test('the future panel names both ages and the service worker is finpath-v41', function(){
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
  const boot = readFileSync(new URL('./boot.js', import.meta.url), 'utf8');
  const start = html.indexOf('id="lifePanelFuture"');
  const end = html.indexOf('id="lifePanelJournal"');
  const panel = html.slice(start, end);
  assert.match(panel, /class="life-note"/);
  assert.match(panel, /You at 40 and you at 60/);
  assert.match(panel, /not a reason to buy, sell, or borrow/i);
  assert.match(panel, /id="lifeFutureBody"/);
  assert.match(boot, /You at 40/);
  assert.match(boot, /You at 60/);
  assert.match(boot, /What changed this/);
  assert.match(boot, /lifePathReady/);
  assert.match(boot, /#life\/compare\//);
  assert.match(sw, /finpath-v41/);
  assert.doesNotMatch(sw, /finpath-v39/);
  assert.match(sw, /js\/intel\/life\/future\.js/);
});
