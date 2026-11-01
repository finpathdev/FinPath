// Financial identity profiles. A study label for this device.
// Signals come from onboarding, Life Path inputs, and concept mastery.
// The label organizes lessons and what-if worksheets. It is not advice.

export const TIE_ORDER = ['balanced', 'saver', 'investor_curious', 'debt_focused'];

export const PROFILES = [
  {
    id: 'balanced',
    label: 'Balanced Learner',
    blurb: 'A wide base across saving, credit, and the first market ideas.',
    focus: 'A short mix of budgeting, saving, and credit so the week is not all one topic.',
    concepts: ['budgeting', 'saving', 'credit', 'risk'],
    lessons: ['schools-skipped', 'budget-50-30-20', 'credit-scores', 'emergency-fund'],
    whatifs: ['wait25', 'card']
  },
  {
    id: 'saver',
    label: 'Steady Saver',
    blurb: 'Practice keeping money before spending it, using the classroom worksheets.',
    focus: 'Saving habits, a starter emergency fund, and how a small monthly amount changes on the compound-interest worksheet.',
    concepts: ['saving', 'budgeting', 'retirement'],
    lessons: ['emergency-fund', 'budget-50-30-20', 'compound-interest', 'financial-goals'],
    whatifs: ['invest50at16', 'wait25']
  },
  {
    id: 'investor_curious',
    label: 'Curious Investor',
    blurb: 'Learn what shares, funds, and market swings are before any real money is involved.',
    focus: 'What a share is, how index funds and ETFs group many companies, and why spreading money around is a lesson here — not a product to pick.',
    concepts: ['index_funds', 'etfs', 'diversification', 'risk', 'psychology'],
    lessons: ['stock-market', 'etfs-vs-stocks', 'compound-interest', 'psychology-of-money'],
    whatifs: ['invest50at16', 'raise']
  },
  {
    id: 'debt_focused',
    label: 'Debt Navigator',
    blurb: 'Learn how balances and interest behave in the lessons and the life model.',
    focus: 'How credit scores are built, how a classroom card balance grows when only the minimum is paid, and which lessons explain interest. Not a reason to borrow.',
    concepts: ['debt', 'credit', 'budgeting'],
    lessons: ['good-vs-bad-debt', 'credit-scores', 'first-credit-card', 'money-mistakes-20s'],
    whatifs: ['card', 'car']
  }
];

const SCHOOL_WITH_TUITION = { community: 1, instate: 1, outstate: 1, private: 1, trade: 1 };

export function profileById(id){
  return PROFILES.find(function(profile){ return profile.id === id; }) || null;
}

function emptyScores(){
  return { balanced: 1, saver: 0, investor_curious: 0, debt_focused: 0 };
}

function activity(concepts, ids){
  return ids.reduce(function(sum, id){
    const row = concepts[id] || {};
    return sum + (Number(row.quizTotal) || 0) + (Number(row.lessonsDone) || 0) * 3;
  }, 0);
}

function dollars(n){
  const v = Math.round(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}

export function suggestProfile(input){
  const src = input && typeof input === 'object' ? input : {};
  const intake = src.intake && typeof src.intake === 'object' ? src.intake : {};
  const life = src.life && typeof src.life === 'object' ? src.life : null;
  const concepts = src.concepts && typeof src.concepts === 'object' ? src.concepts : {};
  const scores = emptyScores();
  const why = { balanced: [], saver: [], investor_curious: [], debt_focused: [] };

  if(intake.skipped){
    why.balanced.push('Onboarding questions were skipped, so nothing narrows the profile yet.');
  }
  if(intake.goal === 'learn'){
    scores.balanced += 3;
    scores.saver += 1;
    why.balanced.push('Onboarding goal was “Learn the basics.”');
  } else if(intake.goal === 'invest'){
    scores.investor_curious += 4;
    why.investor_curious.push('Onboarding goal was “Start investing (practice first).”');
  } else if(intake.goal === 'job'){
    scores.saver += 4;
    why.saver.push('Onboarding goal was “First job / first paycheck.”');
  } else if(intake.goal === 'debt'){
    scores.debt_focused += 4;
    why.debt_focused.push('Onboarding goal was “Pay down debt / get organized.”');
  }

  if(intake.experience === 'new'){
    scores.balanced += 2;
    scores.saver += 1;
    why.balanced.push('Onboarding experience was “Brand new.”');
  } else if(intake.experience === 'some'){
    scores.investor_curious += 1;
    scores.balanced += 1;
    why.investor_curious.push('Onboarding experience was “Know a few terms.”');
  } else if(intake.experience === 'comfortable'){
    scores.investor_curious += 2;
    why.investor_curious.push('Onboarding experience was “Comfortable, want structure.”');
  }

  if(life){
    const monthly = Number(life.monthlyInvest);
    if(isFinite(monthly) && monthly >= 100){
      scores.saver += 2;
      scores.investor_curious += 1;
      why.saver.push('Life Path monthly amount is ' + dollars(monthly) + '.');
    } else if(isFinite(monthly) && monthly >= 25){
      scores.saver += 2;
      why.saver.push('Life Path monthly amount is ' + dollars(monthly) + '.');
    } else if(isFinite(monthly) && monthly === 0){
      scores.debt_focused += 1;
      why.debt_focused.push('Life Path monthly amount is $0.');
    }
    if(SCHOOL_WITH_TUITION[life.college]){
      scores.debt_focused += 1;
      why.debt_focused.push('Life Path school path includes tuition in the classroom model.');
    } else if(life.college === 'none'){
      scores.saver += 1;
      why.saver.push('Life Path school path is set to start working, with no tuition line.');
    }
    const age = Number(life.currentAge);
    if(isFinite(age) && age > 0 && age <= 18){
      scores.saver += 1;
      why.saver.push('Life Path age is ' + age + '.');
    }
  }

  const lanes = [
    activity(concepts, ['saving', 'budgeting', 'retirement']),
    activity(concepts, ['index_funds', 'etfs', 'diversification', 'psychology']),
    activity(concepts, ['debt', 'credit'])
  ];
  const saverAct = Math.min(4, lanes[0]);
  const investAct = Math.min(4, lanes[1]);
  const debtAct = Math.min(4, lanes[2]);
  if(saverAct){
    scores.saver += saverAct;
    why.saver.push('Saved lessons or quizzes already touch saving or budgeting.');
  }
  if(investAct){
    scores.investor_curious += investAct;
    why.investor_curious.push('Saved lessons or quizzes already touch funds, risk, or investing psychology.');
  }
  if(debtAct){
    scores.debt_focused += debtAct;
    why.debt_focused.push('Saved lessons or quizzes already touch credit or debt.');
  }
  const lanesOn = lanes.filter(function(n){ return n > 0; }).length;
  if(lanesOn >= 2){
    scores.balanced += 2;
    why.balanced.push('Lesson and quiz history touches more than one topic.');
  }
  if(lanesOn >= 3) scores.balanced += 2;

  let best = TIE_ORDER[0];
  let bestScore = scores[best];
  TIE_ORDER.forEach(function(id){
    if(scores[id] > bestScore){
      best = id;
      bestScore = scores[id];
    }
  });
  let reasons = why[best].filter(function(line, i, arr){ return line && arr.indexOf(line) === i; }).slice(0, 3);
  if(!reasons.length) reasons = ['There isn’t much history on this device yet, so the wide starter profile fits.'];
  return {
    id: best,
    scores: scores,
    reasons: reasons,
    profile: profileById(best)
  };
}

export function resolveIdentity(suggestion, stored){
  const suggested = suggestion && suggestion.id ? suggestion : suggestProfile({});
  const pinned = stored && stored.pinned && profileById(stored.id);
  const id = pinned ? stored.id : suggested.id;
  return {
    id: id,
    source: pinned ? 'picked' : 'suggested',
    suggestedId: suggested.id,
    scores: suggested.scores,
    reasons: suggested.reasons,
    profile: profileById(id)
  };
}
