// A letter from "future you" inside the worksheet. Educational copy only.
// No buy, sell, or borrow instructions.

function money(n){
  if(!isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v < 0 ? '−' : '';
  return sign + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
}

function dollarWord(mode){
  return mode === 'future' ? 'future dollars, before adjusting for inflation' : "today's dollars";
}

function rowOf(bag, age){
  if(!bag) return null;
  const row = bag[age] || bag[String(age)] || null;
  if(!row || !isFinite(Number(row.portfolio))) return null;
  return row;
}

function postcard(age, ageNow, pathRow, altRow){
  if(!pathRow && !altRow) return '';
  const when = age === ageNow ? 'A postcard from right now, age ' + age : 'A postcard from age ' + age;
  let text = when + ': ';
  if(pathRow){
    text += 'the path on your screen shows about ' + money(pathRow.portfolio) + ' invested';
    if(Number(pathRow.debt) > 1) text += ', with about ' + money(pathRow.debt) + ' of debt still sitting in the model';
  }
  if(altRow){
    text += (pathRow ? '. The other worksheet shows about ' : 'the other worksheet shows about ') + money(altRow.portfolio) + ' invested';
  }
  text += '. Same kind of picture, different inputs. Not a score.';
  return text;
}

export function futureLetter(model){
  const src = model && typeof model === 'object' ? model : {};
  const ageNow = Number(src.ageNow);
  const dollars = src.dollars === 'future' ? 'future' : 'today';
  const pathLabel = String(src.pathLabel || 'the path on your screen');
  const altLabel = src.altLabel ? String(src.altLabel) : '';
  const path65 = rowOf(src.path, 65);
  const alt65 = rowOf(src.alt, 65);
  const band = src.band && isFinite(Number(src.band.p10)) && isFinite(Number(src.band.p90)) ? src.band : null;
  const paragraphs = [];

  const helloAge = isFinite(ageNow) ? ' I am glad you are looking at this while you are ' + ageNow + '.' : '';
  paragraphs.push('Hey. It is you at 65 — the version of you that lives inside this worksheet, not a fortune teller.' + helloAge);

  if(path65){
    let line = 'On the path on your screen (' + pathLabel + '), the steady line puts invested money around ' + money(path65.portfolio) + ' in ' + dollarWord(dollars) + '.';
    if(Number(path65.debt) > 1) line += ' The model still has about ' + money(path65.debt) + ' of debt at that birthday.';
    paragraphs.push(line);
  } else {
    paragraphs.push('This path does not have an age-65 snapshot yet. Check that the age on the Path tab is between 13 and 64.');
  }

  if(band && path65){
    paragraphs.push(
      'Markets do not move in a straight line, so the same deposits — using the sheet’s average return and a historical-size wobble — land between about ' +
      money(band.p10) + ' and ' + money(band.p90) + ' in this classroom exercise. The middle of that range is about ' +
      money(band.p50) + '. Those marks are percentiles (p10, p50, and p90), not a promise, and not a reason to buy, sell, or borrow.'
    );
  } else if(path65){
    paragraphs.push('The steady line is one rate from the assumptions sheet. It is not a promise, and not a reason to buy, sell, or borrow.');
  }

  if(altLabel && alt65){
    paragraphs.push(
      'I also peeked at the “' + altLabel + '” worksheet. That one shows about ' + money(alt65.portfolio) +
      ' invested at 65 on its own steady line. The size of that number is not a prize and not a verdict. It just shows how one change moves the picture.'
    );
  } else if(altLabel){
    paragraphs.push('The “' + altLabel + '” worksheet does not reach 65 from these ages, so there is no second number to set beside yours.');
  }

  [30, 45].forEach(function(age){
    if(isFinite(ageNow) && age < ageNow) return;
    const text = postcard(age, ageNow, rowOf(src.path, age), altLabel ? rowOf(src.alt, age) : null);
    if(text) paragraphs.push(text);
  });

  if(src.identityLabel){
    const score = Number(src.literacyScore);
    let line = 'The study profile saved on this device is ' + String(src.identityLabel) + '.';
    if(isFinite(score)) line += ' The literacy score is ' + Math.round(score) + ' out of 1000, from lessons and quizzes already saved in this browser.';
    line += ' That label only organizes what to study. It is not a reason to buy, sell, or borrow.';
    paragraphs.push(line);
  }

  paragraphs.push('The assumptions are listed on this page if you want to see where the rates came from. This letter does not know your real job, your family, or your luck. It is a note from a model.');

  return {
    title: 'A note from you at 65',
    paragraphs: paragraphs
  };
}

// Portraits at 40 and 60. The classroom range is the Monte Carlo band around
// the invested balance. Debt stays on the steady path, so net worth at each
// percentile is that balance minus the debt in the model. No buy, sell, or
// borrow instructions.

export const FUTURE_SELF_AGES = [40, 60];

const LESSON_LINKS = [
  { slug: 'compound-interest', hash: '#lesson/6', label: 'Compound interest lesson' },
  { slug: 'inflation', hash: '#lesson/16', label: 'Inflation lesson' },
  { slug: 'emergency-fund', hash: '#lesson/9', label: 'Emergency fund lesson' }
];

export function lifePathReady(store){
  return !!(store && store.touched === true && store.inputs && typeof store.inputs === 'object');
}

export function formatShare(rate){
  if(!isFinite(Number(rate))) return '—';
  const pct = Number(rate) * 100;
  if(Math.abs(pct) >= 10) return String(Math.round(pct)) + '%';
  return String(Math.round(pct * 10) / 10) + '%';
}

export function formatMonths(n){
  if(!isFinite(Number(n))) return '—';
  const v = Number(n);
  if(v >= 10) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

function showMoney(nominal, inflation, years, dollars){
  const n = Number(nominal);
  if(!isFinite(n)) return null;
  if(dollars === 'future' || !years) return n;
  const inf = Number(inflation);
  const y = Number(years);
  if(!isFinite(inf) || !isFinite(y) || y === 0) return n;
  return n / Math.pow(1 + inf, y);
}

function rowAt(result, age){
  const rows = result && result.rows ? result.rows : [];
  for(let i = 0; i < rows.length; i++){
    if(rows[i].age === age) return rows[i];
  }
  return null;
}

function flowAt(result, age){
  const flows = result && result.flows ? result.flows : [];
  for(let i = 0; i < flows.length; i++){
    if(flows[i].age === age) return flows[i];
  }
  return null;
}

function bandAt(bands, age){
  const rows = bands && bands.rows ? bands.rows : [];
  for(let i = 0; i < rows.length; i++){
    if(rows[i].age === age) return rows[i];
  }
  return null;
}

function finiteOrNull(n){
  const v = Number(n);
  return isFinite(v) ? v : null;
}

function retirementBand(freedom){
  if(freedom == null) return '';
  if(freedom >= 1) return 'The invested balance is at or past that line in this model.';
  if(freedom >= 0.5) return 'The invested balance is at least halfway to that line in this model.';
  return 'The invested balance is still under halfway to that line in this model.';
}

function debtStory(result, row){
  const amount = Number(row.debt) || 0;
  const info = result.debtFree || {};
  if((info.reason === 'none' || !info.reason) && amount <= 1){
    return { status: 'none', statusLabel: 'No debt in this path', freeAge: null };
  }
  if(amount <= 1){
    const freeAge = info.reason === 'clear' && isFinite(Number(info.age)) ? Number(info.age) : null;
    return { status: 'clear', statusLabel: 'Debt-free in this model', freeAge: freeAge };
  }
  return { status: 'open', statusLabel: 'Still in the model', freeAge: null };
}

function debtLine(story, shownAmount){
  if(story.status === 'none') return 'No school or card debt shows up on this path.';
  if(story.status === 'clear'){
    return story.freeAge
      ? 'The model is debt-free by age ' + story.freeAge + ', so this birthday has no school or card balance left.'
      : 'This birthday has no school or card balance left in the model.';
  }
  return 'About ' + money(shownAmount) + ' of school or card debt is still in the model at this birthday.';
}

export function projectAtAge(result, bands, age, options){
  const dollars = options && options.dollars === 'future' ? 'future' : 'today';
  const target = Number(age);
  const ageNow = result && result.inputs ? Number(result.inputs.currentAge) : NaN;
  if(!result || !isFinite(target)){
    return { age: target, reachable: false, reason: 'missing', dollars: dollars };
  }
  if(isFinite(ageNow) && target < ageNow){
    return { age: target, reachable: false, reason: 'past', ageNow: ageNow, dollars: dollars };
  }
  const row = rowAt(result, target);
  if(!row){
    return { age: target, reachable: false, reason: 'outside', ageNow: isFinite(ageNow) ? ageNow : null, dollars: dollars };
  }
  const years = isFinite(ageNow) ? target - ageNow : 0;
  const show = function(n){ return showMoney(n, result.inflation, years, dollars); };
  const band = bandAt(bands, target);
  const debtNominal = Number(row.debt) || 0;
  const invested = {
    steady: show(row.portfolio),
    p10: band ? show(band.p10) : null,
    p50: band ? show(band.p50) : null,
    p90: band ? show(band.p90) : null
  };
  const netWorth = {
    steady: show(row.netWorth),
    p10: band && finiteOrNull(band.p10) != null ? show(Number(band.p10) - debtNominal) : null,
    p50: band && finiteOrNull(band.p50) != null ? show(Number(band.p50) - debtNominal) : null,
    p90: band && finiteOrNull(band.p90) != null ? show(Number(band.p90) - debtNominal) : null
  };
  const flow = flowAt(result, target);
  const takeHome = flow ? Number(flow.income) - Number(flow.tax) : NaN;
  const savingsRate = flow && takeHome > 1 ? Number(flow.invested) / takeHome : null;
  const living = Number(row.living) || 0;
  const emergencyMonths = living > 0 ? Number(row.portfolio) / (living / 12) : null;
  const freedom = row.freedom == null || !isFinite(Number(row.freedom)) ? null : Number(row.freedom);
  const story = debtStory(result, row);
  const debtAmount = show(debtNominal);
  const savingsLine = savingsRate == null
    ? 'This birthday does not have a take-home paycheck in the model, so there is no savings rate to read.'
    : 'In the year that starts at this birthday, the model invests about ' + formatShare(savingsRate) + ' of take-home.';
  const emergencyLine = emergencyMonths == null
    ? 'Living costs are zero here, so an emergency-fund month count does not apply.'
    : 'The invested balance could cover about ' + formatMonths(emergencyMonths) + ' months of this model\'s living costs. The worksheet does not keep a separate cash emergency fund, so that count reads the invested balance, not a savings account. A classroom lesson often uses 3–6 months as an example. This count is not a grade.';
  const bandText = retirementBand(freedom);
  const meterPct = freedom == null ? null : Math.round(freedom * 100);
  const retirementLine = freedom == null
    ? 'The retirement meter needs living costs, and this birthday does not have them.'
    : 'The retirement meter reads ' + meterPct + '% of the 25× yearly spending line this class uses. ' + bandText + ' The meter is a ruler in the model, not a date to stop working.';
  const whenLine = isFinite(ageNow) && ageNow === target
    ? 'This is the age on the Path tab.'
    : (isFinite(ageNow) ? (target - ageNow) + ' years ahead of age ' + ageNow + ' on the Path tab.' : '');
  return {
    age: target,
    reachable: true,
    dollars: dollars,
    ageNow: isFinite(ageNow) ? ageNow : null,
    whenLine: whenLine,
    netWorth: netWorth,
    invested: invested,
    savingsRate: savingsRate == null || !isFinite(savingsRate) ? null : savingsRate,
    savingsLine: savingsLine,
    emergencyMonths: emergencyMonths == null || !isFinite(emergencyMonths) ? null : emergencyMonths,
    emergencyLine: emergencyLine,
    debt: {
      amount: debtAmount,
      status: story.status,
      statusLabel: story.statusLabel,
      freeAge: story.freeAge,
      line: debtLine(story, debtAmount)
    },
    retirement: {
      freedom: freedom,
      meter: freedom == null ? null : Math.max(0, Math.min(1, freedom)),
      meterPct: meterPct,
      multiple: 25,
      band: bandText,
      line: retirementLine
    }
  };
}

export function projectFutureSelves(result, bands, options){
  const ages = options && Array.isArray(options.ages) && options.ages.length ? options.ages : FUTURE_SELF_AGES;
  return ages.map(function(age){ return projectAtAge(result, bands, age, options); });
}

function whatIfHref(id){
  const safe = String(id || '');
  if(!/^[a-z0-9]+$/.test(safe)) return '#life/compare';
  return '#life/compare/' + safe;
}

export function rankDecisions(baseNetWorth, options){
  const base = Number(baseNetWorth);
  if(!isFinite(base)) return [];
  const rows = (options || []).map(function(opt){
    const src = opt && typeof opt === 'object' ? opt : {};
    const nw = Number(src.netWorth);
    const gap = isFinite(nw) ? nw - base : null;
    return {
      id: src.id,
      label: src.label,
      title: src.title,
      lesson: src.lesson,
      gap: gap,
      abs: gap == null ? -1 : Math.abs(gap)
    };
  }).filter(function(row){ return row.gap != null && row.label; });
  rows.sort(function(a, b){
    if(b.abs !== a.abs) return b.abs - a.abs;
    const ai = String(a.id || '');
    const bi = String(b.id || '');
    if(ai < bi) return -1;
    if(ai > bi) return 1;
    return 0;
  });
  return rows.slice(0, 3).map(function(row){
    let direction = 'same';
    if(row.abs >= 1) direction = row.gap > 0 ? 'higher' : 'lower';
    return {
      id: row.id,
      label: String(row.label),
      title: row.title ? String(row.title) : '',
      lesson: row.lesson ? String(row.lesson) : '',
      gap: row.gap,
      direction: direction,
      href: whatIfHref(row.id)
    };
  });
}

export function decisionLine(decision){
  if(!decision || !decision.label) return '';
  const label = String(decision.label);
  const gap = Number(decision.gap);
  if(decision.direction === 'same' || !isFinite(gap) || Math.abs(gap) < 1){
    return label + ' lands within about a dollar of the path on your screen.';
  }
  const way = decision.direction === 'higher' || gap > 0 ? 'higher' : 'lower';
  return label + ' is about ' + money(Math.abs(gap)) + ' ' + way + ' at this birthday than the path on your screen.';
}

function choiceSentence(ctx){
  const bits = [];
  if(isFinite(Number(ctx.monthly))) bits.push(money(ctx.monthly) + ' a month');
  if(ctx.collegeLabel) bits.push(String(ctx.collegeLabel));
  if(ctx.careerLabel) bits.push(String(ctx.careerLabel));
  if(!bits.length) return 'The path on your screen is the one on the Path tab.';
  let line = 'On the path on your screen: ' + bits.join(', ') + '.';
  if(ctx.stateName) line += ' Living costs use the price level for ' + String(ctx.stateName) + '.';
  return line;
}

function rangeSentence(portrait){
  const nw = portrait.netWorth || {};
  const word = dollarWord(portrait.dollars);
  let line = 'In ' + word + ', the steady line shows net worth around ' + money(nw.steady) + '.';
  if(nw.p10 != null && nw.p50 != null && nw.p90 != null){
    line += ' The classroom range — same deposits, with a historical-size wobble — runs from about ' +
      money(nw.p10) + ' to ' + money(nw.p90) + '. The middle of that range (p50) is about ' + money(nw.p50) + '.';
  }
  line += ' Those marks use the p10, p50, and p90 of the invested balance, minus the debt in this model. They are not a promise, and not a reason to buy, sell, or borrow.';
  return line;
}

function metricSentence(portrait){
  return [portrait.savingsLine, portrait.debt && portrait.debt.line, portrait.emergencyLine, portrait.retirement && portrait.retirement.line]
    .filter(Boolean)
    .join(' ');
}

function decisionParagraph(decisions){
  if(!decisions || !decisions.length) return '';
  const names = decisions.map(function(d){ return d.label; }).filter(Boolean);
  if(!names.length) return '';
  let joined = names[0];
  if(names.length === 2) joined = names[0] + ' and ' + names[1];
  else if(names.length > 2) joined = names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  return 'What changed this picture the most, one worksheet at a time: ' + joined + '. The list under this note opens each one beside the path on your screen. I am not picking a winner, and a higher number is not a prize.';
}

function identityParagraph(ctx){
  if(!ctx.identityLabel) return '';
  let line = ctx.identitySource === 'picked'
    ? 'You pinned the study profile ' + String(ctx.identityLabel) + ' on this device.'
    : 'From what is saved on this device, the study page would call this ' + String(ctx.identityLabel) + '.';
  const score = Number(ctx.literacyScore);
  if(isFinite(score)) line += ' The literacy score is ' + Math.round(score) + ' out of 1000.';
  line += ' That label organizes lessons. It is not a grade of your money, and not a reason to buy, sell, or borrow.';
  return line;
}

function greeting(age, ageNow){
  const now = isFinite(Number(ageNow)) ? Number(ageNow) : null;
  let glad = '';
  if(now != null && now === age) glad = ' You are standing on this birthday in the model.';
  else if(now != null) glad = ' I am glad you are looking while you are ' + now + '.';
  if(age === 60){
    return 'Hey. It is you at 60 — still the worksheet version, not a fortune teller.' + glad + ' I do not know your real job, your people, or your luck. I only know the choices on the Path tab.';
  }
  return 'Hey. It is you at ' + age + ' — the version of you that lives in this worksheet, not a fortune teller.' + glad;
}

export function futureSelfLetter(portrait, context){
  const card = portrait && typeof portrait === 'object' ? portrait : { age: null, reachable: false };
  const ctx = context && typeof context === 'object' ? context : {};
  const age = card.age;
  const title = 'A note from you at ' + age;
  if(!card.reachable){
    const now = isFinite(Number(card.ageNow)) ? card.ageNow : (isFinite(Number(ctx.ageNow)) ? ctx.ageNow : null);
    const where = now == null ? 'the age on the Path tab' : 'the age on the Path tab (' + now + ')';
    return {
      age: age,
      title: title,
      paragraphs: [
        'Hey. It is you, writing from inside this worksheet. Age ' + age + ' is already behind ' + where + ', so I do not have a future portrait to send from that birthday.',
        'The Path tab is where the age lives. This note does not tell you what to do, and it is not a reason to buy, sell, or borrow.'
      ]
    };
  }
  const paragraphs = [
    greeting(age, ctx.ageNow != null ? ctx.ageNow : card.ageNow),
    choiceSentence(ctx),
    rangeSentence(card),
    metricSentence(card)
  ];
  const changed = decisionParagraph(ctx.decisions);
  if(changed) paragraphs.push(changed);
  const who = identityParagraph(ctx);
  if(who) paragraphs.push(who);
  paragraphs.push('The stock return and the inflation rate on the assumptions sheet are what move these dollars. This letter does not tell you what to do. It is not a reason to buy, sell, or borrow.');
  return { age: age, title: title, paragraphs: paragraphs };
}

export function buildFutureSelf(input){
  const src = input && typeof input === 'object' ? input : {};
  const dollars = src.dollars === 'future' ? 'future' : 'today';
  const selves = projectFutureSelves(src.result, src.bands, { dollars: dollars, ages: src.ages });
  const decisionsByAge = {};
  const letters = selves.map(function(portrait){
    let decisions = [];
    if(portrait.reachable && portrait.netWorth){
      const alts = (src.alternates || []).map(function(alt){
        const row = rowAt(alt.result, portrait.age);
        if(!row || !alt.result) return null;
        const years = portrait.age - Number(alt.result.inputs.currentAge);
        return {
          id: alt.id,
          label: alt.label,
          title: alt.title,
          lesson: alt.lesson,
          netWorth: showMoney(row.netWorth, alt.result.inflation, years, dollars)
        };
      }).filter(Boolean);
      decisions = rankDecisions(portrait.netWorth.steady, alts);
    }
    decisionsByAge[portrait.age] = decisions;
    const ctx = Object.assign({}, src.context || {}, { decisions: decisions, ageNow: src.context && src.context.ageNow != null ? src.context.ageNow : portrait.ageNow });
    return futureSelfLetter(portrait, ctx);
  });
  return { selves: selves, decisionsByAge: decisionsByAge, letters: letters };
}

export function portrayedAssumptions(assumptions){
  const values = assumptions && assumptions.values ? assumptions.values : {};
  function rate(key){
    const item = values[key];
    const n = item ? Number(item.value) : NaN;
    return isFinite(n) ? n : null;
  }
  return {
    stockNominal: rate('stock_nominal'),
    inflation: rate('inflation'),
    stockVol: rate('stock_vol'),
    safeMultiple: rate('safe_multiple'),
    lessons: LESSON_LINKS.map(function(link){ return Object.assign({}, link); })
  };
}
