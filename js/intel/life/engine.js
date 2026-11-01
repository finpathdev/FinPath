// Yearly life-path model. No DOM and no network. Lesson calculators call the
// same future-value, payment, growth, and credit-score helpers so a number
// cannot drift between a lesson and the simulator.
export const ENGINE_VERSION = 'life-1';
export const SNAP_AGES = [22, 30, 45, 65];

export function fvMonthly(monthly, annualPct, years){
  const pmt = Number(monthly);
  const pct = Number(annualPct);
  const y = Number(years);
  if(!isFinite(pmt) || !isFinite(pct) || !isFinite(y) || y <= 0 || pmt === 0) return 0;
  const r = pct / 100 / 12;
  const n = Math.round(y * 12);
  if(n <= 0) return 0;
  if(r === 0) return pmt * n;
  return pmt * ((Math.pow(1 + r, n) - 1) / r);
}

export function monthlyPayment(principal, annualPct, years){
  const p = Number(principal);
  const pct = Number(annualPct);
  const y = Number(years);
  if(!isFinite(p) || p <= 0 || !isFinite(y) || y <= 0) return 0;
  const n = Math.round(y * 12);
  if(n <= 0) return 0;
  const r = (Number.isFinite(pct) ? pct : 0) / 100 / 12;
  if(r === 0) return p / n;
  const g = Math.pow(1 + r, n);
  return p * r * g / (g - 1);
}

export function compoundGrowth(principal, annualPct, years){
  const p = Number(principal);
  const pct = Number(annualPct);
  const y = Number(years);
  if(!isFinite(p)) return 0;
  if(!isFinite(pct) || !isFinite(y) || y <= 0) return p;
  return p * Math.pow(1 + pct / 100, y);
}

export function creditScoreEstimate(months, utilPct, ageYears){
  const m = clamp(Number(months), 0, 600);
  const u = clamp(Number(utilPct), 0, 100);
  const a = clamp(Number(ageYears), 0, 80);
  let score = 480 + Math.min(m, 48) * 3.2 + Math.max(0, 30 - u) * 2.6 - Math.max(0, u - 30) * 1.8 + Math.min(a, 10) * 8;
  score = Math.max(300, Math.min(850, Math.round(score)));
  const band = score >= 740 ? 'Excellent' : score >= 670 ? 'Good' : score >= 580 ? 'Fair' : 'Building';
  return { score: score, band: band };
}

export function deflate(nominal, inflationDecimal, years){
  const n = Number(nominal);
  const inf = Number(inflationDecimal);
  const y = Number(years);
  if(!isFinite(n)) return 0;
  if(!isFinite(inf) || !isFinite(y) || y === 0) return n;
  return n / Math.pow(1 + inf, y);
}

function clamp(n, lo, hi){
  if(!isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function cents(n){
  if(!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function val(assumptions, key){
  const item = assumptions && assumptions.values && assumptions.values[key];
  const n = item ? Number(item.value) : NaN;
  return isFinite(n) ? n : 0;
}

function collegeDef(assumptions, id){
  const c = assumptions && assumptions.colleges && assumptions.colleges[id];
  if(c && Array.isArray(c.segments)) return c;
  return { years: 0, segments: [], label: 'No college — start working' };
}

function careerDef(assumptions, id){
  const c = assumptions && assumptions.careers && assumptions.careers[id];
  if(c && isFinite(Number(c.wage))) return c;
  const fallback = assumptions && assumptions.careers && assumptions.careers.median;
  return fallback || { wage: 0, label: '' };
}

export function workStartAge(inputs, assumptions){
  const school = val(assumptions, 'school_start_age') || 18;
  return school + collegeDef(assumptions, inputs.college).years;
}

export function defaultInputs(assumptions){
  const age = 16;
  return {
    currentAge: age,
    state: 'US',
    college: 'instate',
    career: 'median',
    salary: null,
    scholarship: 0,
    monthlyInvest: val(assumptions, 'example_monthly') || 50,
    investStartAge: age,
    cardBalance: 0,
    car: false,
    raisePct: 0,
    raiseAge: 30,
    raiseInvestShare: val(assumptions, 'raise_invest_share') || 0.5,
    loansOverride: null
  };
}

export function normalizeInputs(raw, assumptions){
  const base = defaultInputs(assumptions);
  const src = raw && typeof raw === 'object' ? raw : {};
  const retire = val(assumptions, 'retire_age') || 65;
  let age = Math.round(clamp(Number(src.currentAge), 13, retire - 1));
  if(!isFinite(age)) age = base.currentAge;
  const stateId = (assumptions.states && assumptions.states[src.state]) ? src.state : 'US';
  const college = (assumptions.colleges && assumptions.colleges[src.college]) ? src.college : 'none';
  const career = (assumptions.careers && assumptions.careers[src.career]) ? src.career : 'median';
  let salary = src.salary == null || src.salary === '' ? null : Number(src.salary);
  if(salary != null && (!isFinite(salary) || salary < 0)) salary = null;
  if(salary != null) salary = Math.min(salary, 5000000);
  let loans = src.loansOverride == null || src.loansOverride === '' ? null : Number(src.loansOverride);
  if(loans != null && (!isFinite(loans) || loans < 0)) loans = null;
  if(loans != null) loans = Math.min(loans, 2000000);
  const investStart = Math.round(clamp(Number(src.investStartAge == null ? age : src.investStartAge), 0, retire));
  return {
    currentAge: age,
    state: stateId,
    college: college,
    career: career,
    salary: salary,
    scholarship: clamp(Number(src.scholarship), 0, 200000),
    monthlyInvest: clamp(Number(src.monthlyInvest), 0, 100000),
    investStartAge: investStart,
    cardBalance: clamp(Number(src.cardBalance), 0, 500000),
    car: src.car === true,
    raisePct: clamp(Number(src.raisePct), 0, 1),
    raiseAge: Math.round(clamp(Number(src.raiseAge == null ? 30 : src.raiseAge), 0, retire)),
    raiseInvestShare: clamp(Number(src.raiseInvestShare == null ? base.raiseInvestShare : src.raiseInvestShare), 0, 1),
    loansOverride: loans
  };
}

function rppOf(assumptions, stateId){
  const s = assumptions.states && assumptions.states[stateId];
  const n = s ? Number(s.rpp) : 100;
  return isFinite(n) && n > 0 ? n / 100 : 1;
}

function schoolSegment(assumptions, collegeId, yearIndex){
  const college = collegeDef(assumptions, collegeId);
  let left = yearIndex;
  for(let i = 0; i < college.segments.length; i++){
    const seg = college.segments[i];
    const years = Number(seg.years) || 0;
    if(left < years) return seg;
    left -= years;
  }
  return null;
}

function inSchool(age, inputs, assumptions){
  const start = val(assumptions, 'school_start_age') || 18;
  const end = workStartAge(inputs, assumptions);
  return inputs.college !== 'none' && age >= start && age < end;
}

function startingWage(inputs, assumptions){
  if(inputs.salary != null) return inputs.salary;
  return Number(careerDef(assumptions, inputs.career).wage) || 0;
}

function grossForAge(age, inputs, assumptions, flags){
  const start = workStartAge(inputs, assumptions);
  if(age < start){
    if(inSchool(age, inputs, assumptions)) return val(assumptions, 'in_school_earnings');
    return 0;
  }
  const grown = startingWage(inputs, assumptions) * Math.pow(1 + val(assumptions, 'wage_growth'), age - start);
  if(!flags.noRaise && inputs.raisePct > 0 && age >= inputs.raiseAge) return grown * (1 + inputs.raisePct);
  return grown;
}

function blankState(){
  return {
    portfolio: 0,
    loan: 0,
    card: 0,
    contrib: 0,
    earnings: 0,
    interest: 0,
    carBalance: 0,
    carPay: 0,
    carLeft: 0,
    carOn: false,
    loanPay: 0,
    loanOn: false,
    everDebt: false
  };
}

function priceFactor(age, currentAge, inflation){
  const years = age - currentAge;
  if(years <= 0 || !inflation) return 1;
  return Math.pow(1 + inflation, years);
}

function applyYear(state, age, inputs, assumptions, flags){
  const taxRate = val(assumptions, 'fica_rate') + val(assumptions, 'income_tax_rate');
  const inflation = val(assumptions, 'inflation');
  const stockM = val(assumptions, 'stock_nominal') / 12;
  const loanM = val(assumptions, 'loan_apr') / 12;
  const cardM = val(assumptions, 'card_apr') / 12;
  const carM = val(assumptions, 'car_apr') / 12;
  const factor = priceFactor(age, inputs.currentAge, inflation);
  const school = inSchool(age, inputs, assumptions);
  const baseGross = grossForAge(age, inputs, assumptions, { noRaise: true });
  const gross = grossForAge(age, inputs, assumptions, flags);
  const tax = gross * taxRate;
  const takeHome = gross - tax;
  const rpp = rppOf(assumptions, inputs.state);

  let living = 0;
  let borrow = 0;
  if(age < 18){
    living = 0;
  } else if(school){
    const start = val(assumptions, 'school_start_age') || 18;
    const seg = schoolSegment(assumptions, inputs.college, age - start);
    const tuition = (seg ? val(assumptions, seg.tuition) : 0) * factor;
    const studentLiving = (seg ? val(assumptions, seg.living) : 0) * factor;
    const aid = inputs.scholarship * factor;
    living = studentLiving;
    borrow = Math.max(0, tuition + studentLiving - aid - gross);
  } else {
    living = val(assumptions, 'needs_share') * takeHome * rpp;
  }

  if(!flags.noRaise && inputs.raisePct > 0 && age >= inputs.raiseAge && gross > baseGross){
    const extraTake = (gross - baseGross) * (1 - taxRate);
    living += extraTake * (1 - inputs.raiseInvestShare);
  }

  const flow = {
    age: age,
    income: 0,
    tax: 0,
    living: 0,
    invested: 0,
    studentInterest: 0,
    cardInterest: 0,
    carInterest: 0,
    carPaid: 0,
    borrowed: 0,
    loanPayment: 0
  };

  if(borrow > 0){
    state.loan = cents(state.loan + borrow);
    state.everDebt = true;
    flow.borrowed = borrow;
  }

  if(!school && state.loan > 0 && !state.loanOn){
    const years = val(assumptions, 'loan_years') || 10;
    state.loanPay = monthlyPayment(state.loan, val(assumptions, 'loan_apr') * 100, years);
    state.loanOn = true;
  }

  if(!flags.noCar && inputs.car && !state.carOn && age >= Math.max(inputs.currentAge, workStartAge(inputs, assumptions), 18)){
    const amount = val(assumptions, 'car_amount');
    const months = val(assumptions, 'car_months') || 1;
    const aprPct = val(assumptions, 'car_apr') * 100;
    let pay = monthlyPayment(amount, aprPct, months / 12);
    const takeMonthly = takeHome / 12;
    if(takeMonthly > 0) pay = Math.max(pay, takeMonthly * val(assumptions, 'car_force_share'));
    state.carBalance = cents(amount);
    state.carPay = pay;
    state.carLeft = months;
    state.carOn = true;
  }

  let investTarget = 0;
  const effectiveStart = Math.max(inputs.investStartAge, inputs.currentAge);
  if(!flags.noInvest && age >= effectiveStart){
    investTarget = inputs.monthlyInvest;
    if(!flags.noRaise && inputs.raisePct > 0 && age >= inputs.raiseAge){
      const extraTake = Math.max(0, gross - baseGross) * (1 - taxRate);
      investTarget += (extraTake * inputs.raiseInvestShare) / 12;
    }
  }

  const monthLiving = living / 12;
  const monthTake = takeHome / 12;

  for(let m = 0; m < 12; m++){
    let available = monthTake - monthLiving;

    if(state.loan > 0){
      const interest = state.loan * loanM;
      let pay = state.loanOn ? state.loanPay : 0;
      const due = state.loan + interest;
      pay = Math.min(pay, due);
      if(pay > available && available > 0) pay = Math.min(pay, available);
      if(available <= 0) pay = 0;
      state.loan = cents(due - pay);
      if(state.loan < 0.01) state.loan = 0;
      available -= pay;
      flow.studentInterest += interest;
      flow.loanPayment += pay;
      state.interest += interest;
      if(state.loan > 0) state.everDebt = true;
    }

    if(!flags.noCard && state.card > 0){
      const interest = state.card * cardM;
      const floor = val(assumptions, 'card_min_floor');
      const minPay = Math.max(floor, state.card * val(assumptions, 'card_min_share'));
      const due = state.card + interest;
      let pay = Math.min(minPay, due);
      if(pay > Math.max(0, available)) pay = Math.max(0, available);
      state.card = cents(due - pay);
      if(state.card < 0.01) state.card = 0;
      available -= pay;
      flow.cardInterest += interest;
      state.interest += interest;
      state.everDebt = true;
    }

    if(state.carOn && state.carLeft > 0 && state.carBalance > 0){
      const interest = state.carBalance * carM;
      const due = state.carBalance + interest;
      const pay = state.carPay;
      const toLoan = Math.min(pay, due);
      state.carBalance = cents(due - toLoan);
      if(state.carBalance < 0.01) state.carBalance = 0;
      state.carLeft -= 1;
      available -= pay;
      flow.carInterest += interest;
      flow.carPaid += pay;
      state.interest += interest;
    }

    let invest = 0;
    if(investTarget > 0){
      if(age < 18 && val(assumptions, 'under18_invest')) invest = investTarget;
      else invest = Math.min(investTarget, Math.max(0, available));
    }
    state.portfolio = cents(state.portfolio * (1 + stockM) + invest);
    state.contrib = cents(state.contrib + invest);
    flow.invested += invest;
  }

  flow.income = gross;
  flow.tax = tax;
  flow.living = living;
  state.earnings = cents(state.earnings + gross);
  state.interest = cents(state.interest);
  return { state: state, flow: roundFlow(flow), living: living, school: school };
}

function roundFlow(flow){
  ['income', 'tax', 'living', 'invested', 'studentInterest', 'cardInterest', 'carInterest', 'carPaid', 'borrowed', 'loanPayment'].forEach(function(k){
    flow[k] = cents(flow[k]);
  });
  return flow;
}

function snapshotRow(age, state, living, school, inputs){
  const debt = cents(state.loan + state.card);
  const multiple = 25;
  const freedom = living > 0 ? state.portfolio / (multiple * living) : null;
  return {
    age: age,
    portfolio: state.portfolio,
    loan: state.loan,
    card: state.card,
    debt: debt,
    netWorth: cents(state.portfolio - debt),
    contrib: state.contrib,
    earnings: state.earnings,
    interest: state.interest,
    living: cents(living),
    freedom: freedom,
    inSchool: school,
    prior: age < inputs.currentAge
  };
}

export function simulate(rawInputs, assumptions){
  const inputs = normalizeInputs(rawInputs, assumptions);
  const retire = val(assumptions, 'retire_age') || 65;
  const multiple = val(assumptions, 'safe_multiple') || 25;
  let state = blankState();
  if(inputs.loansOverride != null){
    state.loan = cents(inputs.loansOverride);
    if(state.loan > 0) state.everDebt = true;
  }

  let age = inputs.currentAge;
  const schoolStart = val(assumptions, 'school_start_age') || 18;
  if(inputs.loansOverride == null && inputs.college !== 'none' && inputs.currentAge > schoolStart){
    age = schoolStart;
    while(age < inputs.currentAge){
      const stepped = applyYear(state, age, inputs, assumptions, { noInvest: true, noCard: true, noCar: true, noRaise: true });
      state = stepped.state;
      age++;
    }
  }

  state.card = cents(inputs.cardBalance);
  if(state.card > 0) state.everDebt = true;

  const rows = [];
  const flows = [];
  let debtFree = null;
  let sawDebt = state.loan > 0 || state.card > 0;

  while(age <= retire){
    const school = inSchool(age, inputs, assumptions);
    const preview = previewLiving(age, inputs, assumptions);
    const row = snapshotRow(age, state, preview.living, school, inputs);
    row.freedom = preview.living > 0 ? state.portfolio / (multiple * preview.living) : null;
    rows.push(row);
    if(sawDebt && state.loan <= 0 && state.card <= 0 && debtFree == null && age >= inputs.currentAge) debtFree = age;
    if(age === retire) break;
    const stepped = applyYear(state, age, inputs, assumptions, {});
    state = stepped.state;
    flows.push(stepped.flow);
    if(state.loan > 0 || state.card > 0 || stepped.flow.borrowed > 0) sawDebt = true;
    age++;
  }

  const byAge = {};
  rows.forEach(function(r){ if(!r.prior) byAge[r.age] = r; });
  const snapshots = {};
  SNAP_AGES.forEach(function(a){
    snapshots[a] = byAge[a] || null;
  });

  let crossoverAge = null;
  rows.forEach(function(r){
    if(r.prior || crossoverAge != null) return;
    const growth = r.portfolio - r.contrib;
    if(r.contrib > 0 && growth > r.contrib) crossoverAge = r.age;
  });

  const totals = flows.reduce(function(acc, f){
    acc.invested += f.invested;
    acc.borrowed += f.borrowed;
    acc.studentInterest += f.studentInterest;
    acc.cardInterest += f.cardInterest;
    acc.carInterest += f.carInterest;
    acc.carPaid += f.carPaid;
    acc.income += f.income;
    return acc;
  }, { invested: 0, borrowed: 0, studentInterest: 0, cardInterest: 0, carInterest: 0, carPaid: 0, income: 0 });
  Object.keys(totals).forEach(function(k){ totals[k] = cents(totals[k]); });
  totals.interest = cents(totals.studentInterest + totals.cardInterest + totals.carInterest);

  let debtFreeOut;
  if(!sawDebt) debtFreeOut = { age: null, reason: 'none' };
  else if(debtFree != null) debtFreeOut = { age: debtFree, reason: 'clear' };
  else debtFreeOut = { age: null, reason: 'open' };

  return {
    engine: ENGINE_VERSION,
    assumptionsVersion: assumptions.version || '',
    inputs: inputs,
    inflation: val(assumptions, 'inflation'),
    stockRate: val(assumptions, 'stock_nominal'),
    rows: rows.filter(function(r){ return !r.prior; }),
    flows: flows,
    snapshots: snapshots,
    crossoverAge: crossoverAge,
    debtFree: debtFreeOut,
    totals: totals,
    used: usedKeys(inputs)
  };
}

function previewLiving(age, inputs, assumptions){
  const taxRate = val(assumptions, 'fica_rate') + val(assumptions, 'income_tax_rate');
  const inflation = val(assumptions, 'inflation');
  const factor = priceFactor(age, inputs.currentAge, inflation);
  if(age < 18) return { living: 0 };
  if(inSchool(age, inputs, assumptions)){
    const start = val(assumptions, 'school_start_age') || 18;
    const seg = schoolSegment(assumptions, inputs.college, age - start);
    return { living: cents((seg ? val(assumptions, seg.living) : 0) * factor) };
  }
  const gross = grossForAge(age, inputs, assumptions, {});
  const take = gross * (1 - taxRate);
  let living = val(assumptions, 'needs_share') * take * rppOf(assumptions, inputs.state);
  const base = grossForAge(age, inputs, assumptions, { noRaise: true });
  if(inputs.raisePct > 0 && age >= inputs.raiseAge && gross > base){
    living += (gross - base) * (1 - taxRate) * (1 - inputs.raiseInvestShare);
  }
  return { living: cents(living) };
}

function usedKeys(inputs){
  const keys = [
    'inflation', 'stock_nominal', 'wage_growth', 'fica_rate', 'income_tax_rate', 'needs_share',
    'safe_multiple', 'retire_age', 'under18_invest', 'example_monthly'
  ];
  if(inputs.college !== 'none'){
    keys.push('loan_apr', 'loan_years', 'unsubsidized_in_school', 'school_start_age', 'in_school_earnings');
    if(inputs.college === 'trade') keys.push('tuition_2yr', 'living_2yr');
    if(inputs.college === 'community') keys.push('tuition_2yr', 'living_2yr', 'tuition_instate', 'living_4yr');
    if(inputs.college === 'instate') keys.push('tuition_instate', 'living_4yr');
    if(inputs.college === 'outstate') keys.push('tuition_outstate', 'living_4yr');
    if(inputs.college === 'private') keys.push('tuition_private', 'living_private');
  }
  if(inputs.cardBalance > 0) keys.push('card_apr', 'card_min_share', 'card_min_floor', 'card_example_balance');
  if(inputs.car) keys.push('car_amount', 'car_apr', 'car_months', 'car_tight_share', 'car_force_share');
  if(inputs.raisePct > 0) keys.push('raise_pct', 'raise_invest_share');
  if(inputs.state && inputs.state !== 'US') keys.push('needs_share');
  return keys;
}

export function moneyAt(result, nominal, age){
  if(!result) return 0;
  const mode = arguments.length > 3 ? arguments[3] : 'today';
  if(mode === 'future') return nominal;
  return deflate(nominal, result.inflation, age - result.inputs.currentAge);
}
