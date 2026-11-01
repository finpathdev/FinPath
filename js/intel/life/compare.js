// Diff two simulate() results. No winner is declared — a higher balance can
// come with more debt, and the page says what moved.
import { deflate } from './engine.js';

function rowAt(result, age){
  if(!result || !result.rows) return null;
  for(let i = 0; i < result.rows.length; i++){
    if(result.rows[i].age === age) return result.rows[i];
  }
  return null;
}

function flowAt(result, age){
  if(!result || !result.flows) return null;
  for(let i = 0; i < result.flows.length; i++){
    if(result.flows[i].age === age) return result.flows[i];
  }
  return null;
}

function show(result, nominal, age, mode){
  if(mode === 'future') return nominal;
  return deflate(nominal, result.inflation, age - result.inputs.currentAge);
}

export function comparePaths(a, b, mode){
  const view = mode === 'future' ? 'future' : 'today';
  const ages = [22, 30, 45, 65];
  const rows = ages.map(function(age){
    const ra = rowAt(a, age);
    const rb = rowAt(b, age);
    return {
      age: age,
      a: ra ? pack(a, ra, view) : null,
      b: rb ? pack(b, rb, view) : null
    };
  });
  const cost = opportunityCost(a, b, view);
  return {
    mode: view,
    rows: rows,
    debtFreeA: a.debtFree,
    debtFreeB: b.debtFree,
    opportunity: cost,
    readinessA: readiness(a, view),
    readinessB: readiness(b, view)
  };
}

function pack(result, row, mode){
  return {
    netWorth: show(result, row.netWorth, row.age, mode),
    portfolio: show(result, row.portfolio, row.age, mode),
    debt: show(result, row.debt, row.age, mode),
    contrib: show(result, row.contrib, row.age, mode),
    earnings: show(result, row.earnings, row.age, mode),
    freedom: row.freedom,
    loan: show(result, row.loan, row.age, mode),
    card: show(result, row.card, row.age, mode)
  };
}

function readiness(result, mode){
  const row = rowAt(result, 65);
  if(!row) return null;
  return {
    portfolio: show(result, row.portfolio, 65, mode),
    living: show(result, row.living, 65, mode),
    freedom: row.freedom,
    netWorth: show(result, row.netWorth, 65, mode)
  };
}

// Extra interest (student loans, credit cards, and the car loan) grown to 65
// at the sheet's stock return. Principal is not added again — it already shows
// up in the net-worth gap when those dollars aren't invested. Car payments that
// still fit beside the investing habit show up as interest here, and as a
// share of take-home in the UI, not as a fake portfolio loss.
export function opportunityCost(a, b, mode){
  const rate = Number(a.stockRate) || 0;
  const ages = {};
  (a.flows || []).forEach(function(f){ ages[f.age] = true; });
  (b.flows || []).forEach(function(f){ ages[f.age] = true; });
  let fvA = 0;
  let fvB = 0;
  let interestA = 0;
  let interestB = 0;
  let carA = 0;
  let carB = 0;
  Object.keys(ages).forEach(function(key){
    const age = Number(key);
    const fa = flowAt(a, age);
    const fb = flowAt(b, age);
    const ia = fa ? fa.studentInterest + fa.cardInterest + fa.carInterest : 0;
    const ib = fb ? fb.studentInterest + fb.cardInterest + fb.carInterest : 0;
    const ca = fa ? fa.carPaid : 0;
    const cb = fb ? fb.carPaid : 0;
    const yearsLeft = Math.max(0, 65 - (age + 1));
    const grow = Math.pow(1 + rate, yearsLeft);
    interestA += ia;
    interestB += ib;
    carA += ca;
    carB += cb;
    fvA += ia * grow;
    fvB += ib * grow;
  });
  const view = mode === 'future' ? 'future' : 'today';
  const yearsTo65A = Math.max(0, 65 - a.inputs.currentAge);
  const yearsTo65B = Math.max(0, 65 - b.inputs.currentAge);
  // Both paths are deflated back to the viewer's current age. When the two
  // current ages match (the normal compare), the factor is the same.
  const fvShowA = view === 'future' ? fvA : deflate(fvA, a.inflation, yearsTo65A);
  const fvShowB = view === 'future' ? fvB : deflate(fvB, b.inflation, yearsTo65B);
  return {
    fvA: fvShowA,
    fvB: fvShowB,
    gap: fvShowA - fvShowB,
    interestA: interestA,
    interestB: interestB,
    carA: carA,
    carB: carB
  };
}
