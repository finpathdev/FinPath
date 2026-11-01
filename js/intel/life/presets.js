// Decision Impact presets are input deltas. They do not invent a second engine.
export const PRESETS = [
  {
    id: 'invest50at16',
    label: '$50/mo from 16',
    title: 'What if I invest $50 a month from 16?',
    lesson: 'compound-interest',
    concepts: ['saving', 'index_funds'],
    blurb: 'The same $50 every month, starting as early as this path allows. The classic line below assumes the $50 never misses a month.'
  },
  {
    id: 'wait25',
    label: 'Wait until 25',
    title: 'What if I wait until 25?',
    lesson: 'compound-interest',
    concepts: ['saving', 'retirement'],
    blurb: 'The same $50 a month, but deposits start at 25. Compare it with starting at 16 — waiting is the expensive part.'
  },
  {
    id: 'card',
    label: 'Credit card debt',
    title: 'What if I carry credit card debt?',
    lesson: 'good-vs-bad-debt',
    concepts: ['credit', 'debt'],
    blurb: 'A $3,000 balance at the card rate on the assumptions sheet. Only the minimum is paid, so interest keeps working against you.'
  },
  {
    id: 'car',
    label: 'Car I can’t afford',
    title: 'What if I buy a car I can’t afford?',
    lesson: 'budget-50-30-20',
    concepts: ['budgeting', 'debt'],
    blurb: 'The payment is a new-car loan from the Federal Reserve’s G.19 release, or 20% of take-home if that is larger. The car is not counted as wealth.'
  },
  {
    id: 'raise',
    label: 'Raise, invest half',
    title: 'What if I get a raise and invest half of it?',
    lesson: 'negotiate-salary',
    concepts: ['budgeting', 'psychology'],
    blurb: 'A 10% raise on top of the yearly wage growth. Half of the after-tax increase is invested. The other half is added to living costs.'
  }
];

export function presetById(id){
  return PRESETS.find(function(p){ return p.id === id; }) || null;
}

export function applyPreset(inputs, id, assumptions){
  const next = Object.assign({}, inputs);
  const example = assumptions && assumptions.values && assumptions.values.card_example_balance
    ? Number(assumptions.values.card_example_balance.value) : 3000;
  const raisePct = assumptions && assumptions.values && assumptions.values.raise_pct
    ? Number(assumptions.values.raise_pct.value) : 0.10;
  const raiseShare = assumptions && assumptions.values && assumptions.values.raise_invest_share
    ? Number(assumptions.values.raise_invest_share.value) : 0.5;
  if(id === 'invest50at16'){
    next.monthlyInvest = 50;
    next.investStartAge = 16;
    next.cardBalance = 0;
    next.car = false;
    next.raisePct = 0;
  } else if(id === 'wait25'){
    next.monthlyInvest = 50;
    next.investStartAge = 25;
    next.cardBalance = 0;
    next.car = false;
    next.raisePct = 0;
  } else if(id === 'card'){
    next.cardBalance = example;
    next.car = false;
    next.raisePct = 0;
  } else if(id === 'car'){
    next.car = true;
    next.cardBalance = 0;
    next.raisePct = 0;
  } else if(id === 'raise'){
    next.raisePct = raisePct;
    next.raiseInvestShare = raiseShare;
    next.raiseAge = Math.max(25, Math.min(64, (Number(inputs.currentAge) || 16) < 30 ? 30 : Number(inputs.currentAge) + 1));
    next.cardBalance = 0;
    next.car = false;
  }
  return next;
}
