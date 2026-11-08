# FinPath

FinPath is a personal-finance learning app: bite-sized lessons and quizzes, a portfolio tracker, a stock screener, and a look at the latest billionaire 13F filings. It runs as a single-page progressive web app (PWA).

## Plans
- **Free**: core lessons and tools.
- **FinPath Gold**: $4.99/month, billed monthly through Stripe. An annual plan is coming soon.

## Stack
- One static `index.html` (vanilla HTML/CSS/JS), plus `manifest.json` and a service worker (`sw.js`)
- Hosted on GitHub Pages (`_config.yml`)
- [Supabase](https://supabase.com) for auth and optional sync
- [Stripe](https://stripe.com) for Gold payments
- Live quotes from the `market-quotes` Supabase Edge Function (Yahoo Finance, shared 30-second cache, `verify_jwt` off, GitHub Pages and localhost only). [Finnhub](https://finnhub.io) is the backup quote feed, and still supplies news and fundamentals. Price history uses `market-candles`. Data may be delayed.

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Life Path, literacy, and identity checks (no build step):

```bash
node --test js/intel/life/*.test.js js/intel/learn/*.test.js js/intel/identity/*.test.js js/intel/paper/*.test.js js/intel/sync/*.test.js js/intel/study/*.test.js js/market/*.test.js supabase/functions/market-candles/handler.test.ts supabase/functions/market-quotes/handler.test.ts supabase/functions/efficacy-summary/*.test.ts supabase/tests/intel_sync_rls.test.mjs
```

Open `#life` for the classroom range (p10 / p50 / p90) around the invested balance, and `#life/future` for You at 40 and You at 60. Those cards use the same classroom range, plus savings rate, debt, an emergency-fund reading, and a retirement meter. A short letter and the three what-ifs that move the picture sit on each card. If Life Path has not been saved on this device, the cards stay blank. Open `#life/journal` for the Decision Journal timeline and `#life/journal/review` for this year’s yearbook (what-ifs, notes, paper trades, goals, lessons, quizzes, and literacy or identity change when those dates exist on the device). `#life/journal/review/2025` opens a past year. Open `#identity` (or `#life/identity`) for a study profile, the 0–1000 literacy score, concept mastery, and a weekly plan of at most four lessons or quizzes. All of that stays educational. It is not a prediction and not a reason to buy, sell, or borrow.

The identity page reads onboarding answers, Life Path inputs, lesson completions, and `fp_quiz_log` on this device. Picking a profile saves `fp_identity` in the browser. The weekly list saves `fp_study_plan`. Signed out, that stays on the device and nothing is uploaded. Signed in, concept marks, literacy score history, the weekly plan, thesis notes, pattern snapshots, and risk-check numbers can sync to the account. Lesson completions and the paper-account cash stay on the device.

The portfolio Paper tab is the thesis lab. A practice buy asks why you are buying, what would prove that wrong, the move you expect, a timeframe, a confidence, and a cap on the paper account. After the close, the journal shows four 0–100 scores (accuracy, research quality, decision quality, risk discipline) and a calibration view of confidence buckets against the hit rate. The formulas are on the page. The scores grade the note. They are not a reason to buy or sell. The note, falsifier, confidence, and scores can sync when you are signed in. The paper cash and share counts stay on the device.

The same tab has a Your patterns section under the journal. Three rule-based cards — overconfidence, loss aversion (the disposition effect), and panic selling — read that practice journal. Each card shows its rule, waits for a minimum count, and says “Not enough data yet” until then. A lesson link and a reflection question sit on every card. The notes are educational. They are not a reason to buy or sell.

The portfolio page has a Risk check, and the paper tab has the same check on the practice stocks (virtual cash is left out). It uses about one year of daily closes from `market-candles`, cached in `fp_candlecache`, with today’s share counts — it does not replay old buys and sells. The cards are yearly volatility, max drawdown, beta versus SPY, Sharpe, and concentration (largest holding, holding HHI, and sector HHI when a sector label exists). Sharpe assumes a 4% yearly risk-free rate split across 252 trading days. That rate is a teaching number, not today’s Treasury yield. Each card shows the formula, a plain-language line, what the number means for this account, and a lesson link. A Portfolio Coach note describes the mix. It is not a reason to buy or sell.

## Life Path cloud sync

Path inputs and the notes you save on the Journal tab stay in `localStorage` first. Signed-out use never requires an account. When someone is signed in, the page tries to sync those two things to Supabase project `ivhhfhemcecwqadrjmwq`. Goals, lesson completions, and the paper-account cash stay on the device. Thesis notes sync only through the intelligence tables below.

The migration was applied to project `ivhhfhemcecwqadrjmwq` on 2026-11-01. The same SQL is in `supabase/migrations/20261101180000_life_sync.sql` if it needs to be applied again (re-running is safe). Intelligence sync and the opt-in study are in `supabase/migrations/20261108120000_intel_sync.sql` (applied 2026-11-08, also safe to re-run):

https://supabase.com/dashboard/project/ivhhfhemcecwqadrjmwq/sql/new

The life script creates `life_paths` and `life_journal`, turns on row level security, and lets a signed-in user read and write only their own rows. The intelligence script does the same for `concept_mastery`, `literacy_scores`, `thesis_entries`, `behavior_snapshots`, `risk_snapshots`, and `study_plans`. `anon` has no grants. `efficacy_events` has no user id and no client read policy. The `efficacy-summary` Edge Function is deployed with `verify_jwt` off so signed-out learners can see the combined numbers; it still requires a user JWT before it stores an event, and it returns only k-anonymous aggregates (k = 10). Do not put the service role key in the static site. If the tables are missing, the page keeps working from this browser and shows that the account copy did not update.

Open `#study` for “Does FinPath work?”. The study is off until someone joins, and it is blocked for anyone under 13. It does not collect a name, school, exact age, or location. An age band is optional after a 13+ confirmation. Leave the study or delete its rows from that page. Deleting the account does not delete study rows, because they are not linked to the email. Delete them first if you want them gone.

## Disclaimer
FinPath is for education only. It is not financial, investment, tax or legal advice. Market data may be delayed or inaccurate, and past performance does not guarantee future results. Do your own research or talk to a licensed professional before you make financial decisions.

## Contact
support@finpath.app

See `LICENSE` for licensing.
