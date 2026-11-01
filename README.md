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
- [Finnhub](https://finnhub.io) for market data (it may be delayed)

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Life Path, literacy, and identity checks (no build step):

```bash
node --test js/intel/life/*.test.js js/intel/learn/*.test.js js/intel/identity/*.test.js
```

Open `#life` for the classroom range (p10 / p50 / p90) around the invested balance, and `#life/future` for the Future Self letter. Open `#identity` (or `#life/identity`) for a study profile, the 0–1000 literacy score, concept mastery, and a weekly plan of at most four lessons or quizzes. All of that stays educational. It is not a prediction and not a reason to buy, sell, or borrow.

The identity page reads onboarding answers, Life Path inputs, lesson completions, and `fp_quiz_log` on this device. Picking a profile saves `fp_identity` in the browser. The weekly list saves `fp_study_plan`. Neither one is synced to an account. Signed-out use is unchanged.

## Life Path cloud sync

Path inputs and the notes you save on the Journal tab stay in `localStorage` first. Signed-out use never requires an account. When someone is signed in, the page tries to sync those two things to Supabase project `ivhhfhemcecwqadrjmwq`. Paper trades, goals, and lesson progress stay on the device.

The migration was applied to project `ivhhfhemcecwqadrjmwq` on 2026-11-01. The same SQL is in `supabase/migrations/20261101180000_life_sync.sql` if it needs to be applied again (re-running is safe):

https://supabase.com/dashboard/project/ivhhfhemcecwqadrjmwq/sql/new

The script creates `life_paths` and `life_journal`, turns on row level security, and lets a signed-in user read and write only their own rows. `anon` has no grants. Do not put the service role key in the static site. If the tables are missing, the page keeps working from this browser and shows that the account copy did not update.

## Disclaimer
FinPath is for education only. It is not financial, investment, tax or legal advice. Market data may be delayed or inaccurate, and past performance does not guarantee future results. Do your own research or talk to a licensed professional before you make financial decisions.

## Contact
support@finpath.app

See `LICENSE` for licensing.
