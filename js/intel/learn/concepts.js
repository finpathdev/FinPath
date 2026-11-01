// Stable concept ids. Quiz responses, journal entries, the literacy score,
// and the identity dashboard all group by these ids.
export const CONCEPTS = {
  budgeting: 'Budgeting',
  saving: 'Saving',
  credit: 'Credit',
  debt: 'Debt',
  taxes: 'Taxes',
  risk: 'Risk',
  diversification: 'Diversification',
  etfs: 'ETFs',
  index_funds: 'Index Funds',
  asset_allocation: 'Asset Allocation',
  psychology: 'Investing Psychology',
  retirement: 'Retirement Planning',
  macro: 'Macroeconomics'
};

// Lesson-level tags. Question ids stay slug#index so a later pass can retag
// one question without throwing away the responses already saved.
export const LESSON_CONCEPTS = {
  'schools-skipped': ['budgeting', 'saving'],
  'assets-liabilities': ['budgeting', 'debt'],
  'billionaire-investing': ['psychology', 'index_funds'],
  'budget-50-30-20': ['budgeting', 'saving'],
  'credit-scores': ['credit'],
  'market-signals': ['macro', 'psychology'],
  'compound-interest': ['saving', 'index_funds', 'retirement'],
  'taxes': ['taxes', 'retirement'],
  'income-streams': ['saving', 'asset_allocation'],
  'emergency-fund': ['saving', 'risk'],
  'good-vs-bad-debt': ['debt', 'credit'],
  'economic-crashes': ['macro', 'risk'],
  'stock-market': ['index_funds', 'risk'],
  'rich-vs-wealthy': ['saving', 'retirement'],
  'real-estate': ['debt', 'asset_allocation'],
  'inflation': ['macro', 'saving'],
  'financial-goals': ['budgeting', 'saving'],
  'analyze-a-stock': ['risk', 'psychology'],
  'first-credit-card': ['credit', 'debt'],
  'paycheck': ['taxes', 'budgeting'],
  'etfs-vs-stocks': ['etfs', 'index_funds', 'diversification'],
  'rent-vs-buy': ['debt', 'budgeting'],
  'negotiate-salary': ['budgeting', 'retirement'],
  'dollar-cost-averaging': ['psychology', 'index_funds'],
  'psychology-of-money': ['psychology'],
  'financial-news': ['psychology', 'macro'],
  'dividends': ['index_funds', 'saving'],
  'building-credit': ['credit'],
  'money-mistakes-20s': ['saving', 'debt', 'credit'],
  'bonds-diversification': ['diversification', 'asset_allocation', 'risk'],
  'annual-report': ['risk'],
  'tax-loss-harvesting': ['taxes'],
  'international-investing': ['diversification', 'macro'],
  'long-term-strategy': ['asset_allocation', 'retirement', 'psychology']
};

export function conceptsFor(slug){
  const list = LESSON_CONCEPTS[slug];
  return Array.isArray(list) ? list.slice() : [];
}

// Lessons that teach each concept, in slug order. Used by mastery and the
// weekly plan so a gap can point at a real lesson.
export function lessonsByConcept(){
  const out = {};
  Object.keys(CONCEPTS).forEach(function(id){ out[id] = []; });
  Object.keys(LESSON_CONCEPTS).forEach(function(slug){
    LESSON_CONCEPTS[slug].forEach(function(id){
      if(!out[id]) out[id] = [];
      out[id].push(slug);
    });
  });
  return out;
}
