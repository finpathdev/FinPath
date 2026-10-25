# FinPath — Fixer pass notes (Agent 7)

Fixer pass on 2026-10-24. **These changes are local only. Nothing has been committed or pushed.**
I only edited `index.html`. I didn't touch `sw.js`.
I checked the syntax of all 3 inline `<script>` blocks with `node --check`, and each one passed.
I also ran a quick node test of `sanitizeSharedList` and `escapeHtml` against an XSS payload, negative shares, Infinity and a non-array input. Each bad input was rejected or escaped.

## What changed (index.html, approximate line numbers after the patch)

| # | Fix | Where |
|---|-----|-------|
| P0 XSS | Added `isValidTicker()` (`/^[A-Z.\-]{1,10}$/`, a hoisted function) and `sanitizeSharedList()`. These require positive, finite share counts (no more than 1e9), at most 100 rows, and no duplicate tickers. `handleSharedLink` rejects bad `#p=` payloads straight away (it cleans the hash and shows a toast). `importShared` validates the list again and skips holdings that have no live price. The shared-list modal escapes ticker and share values. | ~5831–5880 |
| P0 XSS | `escapeHtml()` now wraps the ticker, company and share values in the portfolio rows (`renderPortfolio`), in `renderAlerts` (both the Gold and non-Gold paths, including `adv.action` and `adv.text`) and in the paper-positions list | ~3761, ~3805, ~3818, ~5390 |
| P0 XSS (defense in depth) | `loadFromDB` drops holdings with an invalid ticker or share count, whether they come from localStorage or from Supabase rows | ~3612–3621 |
| P0 fake charts | Removed the `Math.random` random-walk fallbacks in `renderPortfolioChart` and `renderDetailChart`. A new `chartUnavailable()`/`chartAvailable()` pair hides the canvas and shows the message "Chart unavailable — historical price data isn't available right now…" | ~3861–3895, ~3964 |
| P0 fake charts | The Gold hourly modal (`openHourly`) no longer simulates hourly values. It says plainly that hour-by-hour data isn't available on the current data plan and shows only the live value and today's change. | ~3913 |
| P1 Gold bypass | Deleted the `onAuthStateChange` block that set `IS_GOLD=true` on `?gold=success`. Gold is now granted only through `checkGoldStatus` (the `gold_users` table) or `verifyStripeSession` (the `payments` table). | ~4004 |
| P1 Search | `handleSearch` now searches every key in `COMPANIES` (so BTC, ETH, SOL, DOGE, UBER, SHOP and the rest are all reachable), returning up to 12 results. A query with no results shows a "No matches" empty state. A match with no quote shows "Price unavailable" instead of disappearing. **I did not change POP, COMPANIES or SECTORS. Coder A owns those.** | ~3644–3670 |
| P1 Price guards | `openAddShares` treats a missing, stale or zero quote as "price unavailable". `confirmAdd` blocks the add or buy when there is no valid price. Adding to an existing holding now uses a weighted-average `buyPrice`, the same way `paperBuy` does. `paperBuy` rejects a price or share count that is ≤0 or not a finite number. `paperSell` is now async: it clears the cache entry, waits for a fresh `fetchQ`, and blocks the sale if the quote is stale or missing. | ~3681–3706, ~5412–5440 |
| P2 Counts | `LESSONS` has a sparse hole at index 15 (a stray `,` on its own line at ~2613), so `LESSONS.length` was 35 even though there are 34 real lessons (20 free and 14 Gold). The progress label, the progress bar and the certificate milestone now use `LESSONS.filter(Boolean).length`. I left the hole in place on purpose, because lesson progress is keyed by index and removing it would shift saved progress for lessons 16 and later. I changed "15 Gold lessons" and "15 premium lessons" to **14**. The "34 lessons" meta text was already correct. | ~1761, ~3112, ~3128, ~3314 |
| TODO markers | Added `TODO(siddharth)` above `const FK` (rotate the key and move it behind a proxy) and above the Stripe **test** Payment Link (swap it for the live link). I added no new keys or URLs. | ~2311, ~3381 |

## Blocked on Siddharth (dashboards only, nothing to code here)
1. **Stripe live Payment Link.** Replace `https://buy.stripe.com/test_…` in `openGoldPayment()` with the live link. In the live Payment Link settings, set the after-payment redirect to `https://finpathdev.github.io/FinPath/?gold=success&session_id={CHECKOUT_SESSION_ID}`. Without that, `checkPaymentReturn` never sees a `session_id`, and paying users won't get Gold until `gold_users` is updated.
2. **Finnhub key.** The current key (`d8pn…`, redacted) is public in the repo, so treat it as leaked. Rotate it in Finnhub. Ideally, proxy `/quote` and `/stock/candle` through a Supabase Edge Function so the key never ships to the browser. Candle (history) calls appear to fail on the current plan, which is why the charts now say "unavailable".
3. **Supabase webhook and tables.** Check these in the dashboard:
   - The Stripe webhook (Edge Function or other) writes **both** of these:
     - `payments` (`session_id`, `user_id`, `status='paid'`), which `verifyStripeSession` reads
     - `gold_users` (`user_id`, `active`), which `checkGoldStatus` reads
   - One code comment mentions `profiles.is_gold`, but the code actually reads `gold_users`. Decide which table is the source of truth, then make the webhook and the code agree.
   - **RLS:** `gold_users` and `payments` should allow SELECT only where `user_id = auth.uid()` and should allow **no** INSERT or UPDATE from the anon or authenticated roles (only the service role). `portfolio` should allow SELECT, INSERT, UPDATE and DELETE only on the user's own rows.
   - How the webhook links a Stripe customer to a Supabase user (for example, by email or `client_reference_id`).

## Hunter bugs NOT fixed in this pass
- The Stripe live-link swap, Finnhub key rotation or proxy, and the webhook and RLS checks listed above.
- I didn't expand COMPANIES, SECTORS or POP. That's Coder A's job, and my search fix will pick up new keys automatically.
- The search doesn't accept arbitrary tickers that aren't in `COMPANIES` (for example, through Finnhub symbol search).
- Other `innerHTML` sinks that render only static or trusted data (news headlines are already escaped, but `n.url` goes into `href` unvalidated, so a `javascript:` URL from the API is a theoretical risk). I didn't do a full app-wide audit of `innerHTML`.
- `renderPortfolio` still shows a stale or `buyPrice` value when a quote fails, without labelling it as stale.
- `fetchCandles` doesn't use the `CRYPTO` symbol map, so crypto charts always show "unavailable".
- The stray `,` hole in `LESSONS` itself. Removing it needs a progress-index migration.
- The share-link URL is hardcoded to the GitHub Pages origin.

## Coder A — stocks
- COMPANIES expanded (GOOG, CVX, BABA, AVGO, LLY, WMT, MA, COST, AMD, MU, NFLX, ORCL, PLTR, PG, HD, BAC, ABBV, MCD, PEP, DIS, NEE, LIN, PLD + 8 ETFs: VOO, VTI, SPY, QQQ, IWM, SCHD, VT, BND); GOOGL relabelled "Class A".
- Added `ETFS` Set; `POP` is now an explicit array (incl. VOO/QQQ/SPY/AVGO) instead of `Object.keys(COMPANIES).slice(0,14)`.
- SECTORS replaced: UBER → Industrials; GOOG/CVX/BABA + all new names; ETFs → "Index Fund"; new Utilities/Materials/Real Estate sectors.
- handleSearch: searches all COMPANIES keys, ranks exact > prefix > name match, allows a typed unknown ticker matching /^[A-Z.]{1,6}$/, "No matches" empty state kept (Fixer's).
- Search results show "(last known)" when a quote is stale.
- AI_INSIGHT: added VOO, QQQ, AVGO, LLY (neutral, educational).
- Copy: meta/og/twitter "live billionaire trades" → "the latest billionaire 13F trades"; globe header "Live market pulse" → "Global exchanges"; globe city fake % values → "—" (neutral colour); Gold gate "all 19 investor moves" → `${MOVES.length}`; earnings error no longer mentions a Finnhub upgrade.
- Screener: universe = COMPANIES minus crypto/ETFs; uncached metric calls throttled 1100 ms; metric cache now 24h in localStorage (`fp_metric_cache`); sector dropdown hides Crypto/Index Fund.
- Demo portfolio diversified: VOO×2, AAPL×3, JPM×2, KO×5, LLY×1.
- Chart Math.random fallbacks were already removed by Fixer — not touched.

## Coder B — content/pricing
- Roth IRA lesson (Tax Basics): "Limit $7,000 per year in 2026" → "The IRS limit is $7,500 per year in 2026 (higher if you are 50 or older)." The 401(k) text gives no dollar limit, so I left it (the 2026 limit is $24,500 if one is ever added).
- Gold pricing card: removed the "or $39.99/year — save 33%" line, which had no checkout behind it. It now says "Billed monthly · annual plan coming soon". $4.99/mo is still the only plan you can buy. I didn't add or change any Stripe URL.
- Safety Net card: "4–5% APY" → "~3–5% APY (rates vary)".
- Terms ("Last updated: July 2026"): not changed.
- Added a short README.md (what FinPath is, plans, stack, how to run it locally, disclaimer, support@finpath.app).
- TODO(siddharth): once annual Stripe checkout exists, put the annual price back on the card at index.html around line 1771, and in the README.

## Coder A — 13F Q2 2026
- `MOVES` replaced verbatim with /workspace/agent2/moves.js (with its source comment header): 50 moves, 6 investors (Buffett, Ackman, Tepper, Druckenmiller, Li Lu, Klarman), all dated Q2 2026.
- New `INVESTORS` const (unique investors from MOVES) drives the Gold filter tabs, the screener "Guru-owned" dropdown (now populated in JS) and the deep-analysis `gurus` tally.
- Hero: copy now says the latest 13F trades from 6 legendary investors; stat "3 Billionaires you can copy" → "6 Legendary investors tracked".
- Landing investor preview: title → "What legendary investors just reported"; subtitle → Q2 2026, as of June 30, filed Aug 14, next after Nov 16 (dropped "the moment they drop"); cards → WB Alphabet ADD 83%, BA Visa BUY, DT Amazon ADD 15.7%, plus a 4th SD Natera ADD 4% card (grid is auto-fit).
- Copy that named only Buffett/Ackman/Tepper (how-it-works, Gold feature card, both pricing bullets, Gold page hero, Gold gate, guru-alignment empty state) → 6 legendary investors. "See billionaire moves" CTA → "See investor moves".
- Added a 13F disclaimer under the Investor Moves grid (45-day delay, long U.S. positions only, educational).
- AI_INSIGHT MSFT/GOOGL/AMZN/META and AI_ADVISOR GOOGL/AMZN: replaced the stale "tripled / this quarter / just bought" lines with Q2 2026 facts.
- "What Billionaires Actually Invest In" lesson: refreshed the Buffett/Ackman/Tepper holdings to Q2 and added short Druckenmiller, Li Lu and Klarman sections.
- COMPANIES + SECTORS: added TSM, BA, NTRA, STM, PDD, EWBC, ELV, GPC, CME, HHH, QSR, SPGI, LEN, KR, STZ. ETFS set unchanged.
- sw.js CACHE → finpath-v5.

## 2026-10-24 — Live prices outage diagnosis + polish pass (finpath-v6)
**Root cause of "no live prices":** the Finnhub key `FK` in index.html (`d8pn5n…d7g`) is rejected. Finnhub returns
`HTTP 401 {"error":"Invalid API key."}` for AAPL, SPY and BINANCE:BTCUSDT (tested 2026-10-24 from the box with Origin
https://finpathdev.github.io). CORS is fine (`access-control-allow-origin: *`), and symbol mapping is fine. The price-guard/stale
logic didn't cause this; it was masking the failure. Every quote came back with no `c`, so rows fell back silently.
- **TODO(siddharth):** create a new free key at https://finnhub.io/dashboard and replace `FK` (TODO comment added there).
  Better: proxy it via a Supabase Edge Function. No replacement key was invented.

**Outage UX**
- New `apiKeyInvalid()`: on a 401, a red "Market data unavailable" banner (dismissible) shows right away. `fetchQ` stops
  calling Finnhub (it serves last-known/`null`). The scheduled SPY retry stops, the WebSocket is closed and its 6s reconnect
  loop is disabled, and the green `.live-dot`s turn grey (`.is-offline`).
- Market pulse and sector heat map now show an explicit "Market data unavailable" message instead of an empty grid.
  Pulse tiles show a "last known" flag on stale quotes. The Markets pulse subtitle changed to "live when market data is available".
- Portfolio rows: a `price-flag` badge reads "no live price" (valued at cost basis) or "last known" (stale quote).

**Polish**
1. `renderMoves`: photo, investor, stock, ticker, notes, amount and date now go through `escapeHtml`. `getActionBadge` escapes its label too.
2. Portfolio stale badge (see above).
3. Hash router: `ROUTES = home|portfolio|lessons|gold|markets|legal`. `showPage` pushes `#page` (home → clean path) and never touches
   `#p=` share links. `routeFromHash` runs on load, `hashchange` and `popstate`. Back/forward works, and `#p=` links still open the import modal.
4. `renderSearchResults` priced branch: `COMPANIES[t]` is now escaped.
5. Added `robots.txt` and `sitemap.xml` (https://finpathdev.github.io/FinPath/). Note: crawlers only read robots.txt at the domain root,
   so for a project page submit the sitemap in Google Search Console.
6. Markets header: "Live market pulse…" → "Market pulse (live when data is available)… Some figures are reference snapshots".
7. New badge styles: `badge-sold` (red), `badge-put` (orange) and `badge-new`. "Sold out" and "New put (bearish)" no longer use the generic reduce style.
- sw.js CACHE → finpath-v6. The Stripe test link was not changed.
- Verified: `node --check` on all 3 inline scripts and on sw.js. A headless Chrome smoke test showed the banner on a 401, the pulse message,
  the #markets deep link, pushState plus Back, hashchange, the #p= modal and the portfolio "no live price" flag, with no page errors.

## 2026-10-25 — Finnhub key rotation
- Replaced the dead (401) Finnhub key in index.html with a new free key; live quotes, candles, news and WebSocket restored.
- sw.js CACHE → finpath-v7 so clients fetch the new HTML.

## 2026-10-25 — Polish pass: speed, link safety, privacy, PWA (finpath-v8)
- **Faster first load:** removed the render-blocking `js.stripe.com/v3` script from `<head>`. It wasn't used, because Gold checkout opens a hosted Payment Link via `window.open`. That's one less third-party script on every page view. The Stripe **test** Payment Link was not changed (live link still deferred).
- **News link safety:** new `safeUrl()` lets through only `http(s)` URLs, HTML-escaped. It's used for news-card links and images (`loadNews`) and "Why it might be moving" headlines (`loadWhyMoved`), so a bad feed item can't inject `javascript:` URLs or break the markup. Both now check `r.ok` and drop items with no URL or headline. News images use `decoding="async"` and `referrerpolicy="no-referrer"`.
- **Privacy:** the legacy `?user=<email>` URL param is now ignored and removed from the address bar. Before, it was saved as `fp_uid` in localStorage and stayed in any copied link. Any old `fp_uid` that looks like an email is cleared. (`UID` isn't used by cloud sync; signed-in sync uses `currentUser.id`.)
- **Shared portfolio links:** links are built from the current origin/path, so they work on previews and localhost too (falls back to the main site). The preview modal marks holdings with no price as "no price" instead of silently counting $0, and the total says how many have no price. A plain-English note explains that links hold tickers and share counts only, and that a shared portfolio is a snapshot, not a recommendation. Esc now closes this modal (and any other id-less overlay) and clears `#p=`. Late quote responses after closing no longer throw an error.
- **PWA manifest:** the description is honest now: "latest 13F filings… live prices when available" instead of "live billionaire trades / real-time". Also added `id`, set `orientation: any` (tablets/landscape), renamed the shortcut to "Investor Moves" (13F, 45-day delay) and added a Markets shortcut.
- **Offline:** the SW precaches the maskable icon, apple-touch icon and logo mark (dropped og-image, which only crawlers need). Google Fonts CORS responses are now runtime-cached, so offline lessons keep their typography. `CACHE` → `finpath-v8`.
- Verified: `node --check` on all 3 inline scripts and on sw.js, and manifest JSON parses. Finnhub AAPL quote with the current FK → HTTP 200. Headless Chrome on the `#p=` link with `?user=`: the modal rendered with the new note, with no page errors.

**Deferred / for Siddharth**
- The Finnhub key is still client-side, as before. A Supabase Edge Function proxy is the real fix and is out of scope for a static pass.
- Gold status checks the `gold_users` table, payment verification checks `payments`, and comments mention `profiles.is_gold`. Make sure the Stripe webhook writes the tables the client reads before going live.
- Stripe live Payment Link: still deferred.

## 2026-10-25 — 13F freshness + beginner clarity pass (finpath-v9)
**Data review:** `MOVES` still has the latest public 13F data, for Q2 2026 (positions as of Jun 30, filed Aug 13–14). The Q3 2026 deadline is Nov 16, 2026 (45 days after Sep 30, rolled to a business day), so there are no newer filings yet. MOVES was **not** changed and nothing was invented. COMPANIES covers every MOVES ticker. When Q3 filings land, refresh `MOVES` and the new `F13` constant (quarter / asOf / filed / nextQuarter / nextDue).

**Investor Moves (Gold page)**
- Freshness line computed from `F13`: "Latest available data: Q2 2026… Q3 filings due by Nov 16, 2026 (in N days)". Once the deadline passes it switches to an honest "Q3 filings are now due/out — moves below are still Q2 until reviewed". The landing-page 13F subtitle (`#landing13fNote`) switches the same way.
- New collapsible explainer, "How to read these investor moves": what a 13F is, BUY/NEW/ADD/REDUCE/SOLD OUT/HOLD, what "$37.8B — 12.6%" means, and why the 45-day delay means these are ideas to research, not trades to copy.
- Fixed a dead UI piece: move cards showed a pointer cursor but did nothing on click. Clicking a card (or pressing Enter/Space) now expands it to show the full note, which was cut off at 2 lines. It has role=button and aria-expanded.
- "+ Track TICKER" button on each card opens Add-stock search with the ticker filled in.

**Markets**
- New market-status chip next to Market pulse ("Market open / Pre-market / After hours / Market closed"), worked out in New York time with `Intl` (`usMarketStatus()`). Exchange holidays aren't modelled.
- The pulse note no longer says "Broad market is having a strong day" on weekends or overnight. When the market is closed it says so and describes the last session in the past tense.
- `isMarketHours()` (refresh cadence) now uses the accurate ET status instead of a fixed UTC window, which used to drift by an hour across DST.
- Each pulse tile shows its ticker and a one-line beginner description (e.g. SPY = 500 of the largest U.S. companies). The section subtitle explains what an index ETF is.

**Portfolio**
- The empty state is now a beginner on-ramp: a short explanation plus three choices (demo portfolio, add a stock, practice with paper money), and a note that the demo is a sample, not a recommendation.

- sw.js CACHE → finpath-v9. The Stripe test link was not changed.
- Verified: `node --check` on all 3 inline scripts and on sw.js. Finnhub AAPL → 200. Headless Chrome check (Gold forced on in a temp copy only): freshness line + explainer rendered, the card expanded (aria-expanded=true), Track filled search with "KO", the Markets chip showed "Market closed" on a Sunday with ticker/description tiles, the new portfolio empty state rendered, no page errors.

## 2026-10-25 — Crypto candle symbol wiring (finpath-v10)
Market data only. No Stripe, 13F, lesson, or pricing edits. Rebased onto the 13F freshness pass above; that pass's notes and MOVES content are unchanged.

- `fetchCandles` called `/stock/candle` with the raw ticker. Quotes already remap BTC/ETH/SOL/DOGE through `CRYPTO` to `BINANCE:*USDT`; candles did not. Verified the same day: raw `BTC` quotes at ~$36 and raw `ETH` at ~$23 (different listings). `BINANCE:BTCUSDT` / `ETHUSDT` / `SOLUSDT` / `DOGEUSDT` are the live coins (~$80.6k / ~$2,355 / ~$102 / ~$0.077).
- Finnhub crypto history is `GET /crypto/candle?symbol=BINANCE:BTCUSDT` (resolutions `1, 5, 15, 30, 60, D, W, M`), not `/stock/candle`. Docs mark both stock and crypto candles as premium. `fetchCandles` now picks `/crypto/candle` when `CRYPTO[t]` is set and otherwise `/stock/candle`, and encodes the symbol the same way `fetchQ` does. A non-OK response (the free key returns HTTP 403 `You don't have access to this resource.` for AAPL, BRK.B, and every crypto candle tried, daily and 5-minute) still returns null, so the existing "Chart unavailable" state stays. No synthetic series.
- `BRK.B` and `BRK-B` both returned the same live quote, so nothing remaps class shares. Market pulse and the sector heat map go through `fetchQ` with plain ETF tickers (SPY, QQQ, DIA, sector ETFs) — no crypto gap. `stock/metric` and `company-news` are stock endpoints; the screener and dividend card already skip crypto, and an empty headline list stays hidden. Not remapped onto `BINANCE:*`.
- WebSocket subscribe already sent the exchange pair; unsubscribe sent the raw ticker (`BTC`), so a crypto unwatch never left the socket. Unsubscribe now uses `finnhubSymbol` too.
- `index.html` is a precached shell asset, so sw.js `CACHE` goes `finpath-v9` → `finpath-v10`. It is not rolled back.

## 2026-10-25 — Bug hunt + fixes (finpath-v10)
**Scan results:** every inline handler (`onclick` / `oninput` / …) calls a function that exists. `innerHTML` writes were checked for unescaped data.

**Fixed**
1. **Stored XSS in Savings Goals:** the goal name went into `innerHTML` raw (goal card and milestone toast). Typing `<img src=x onerror=…>` as a name ran script on every Portfolio visit. Now escaped. Also escaped tickers in the transaction history and price-alert list (they come from localStorage, so they shouldn't be trusted).
2. **Goal validation:** rejects a target of $0 or less, a deadline in the past, or a name over 60 characters. "Add to goal" uses `isFinite`, guards a missing index, and handles older goals with no `hit` map (that used to throw). Deleting a goal now asks for confirmation first.
3. **Gold honesty, "AI Suggestions":** the "instructions" textarea was fake. The output said "Taking into account your instruction… suggestion adjusted accordingly" while nothing changed, and the instruction was also injected unescaped. The textarea and that sentence are removed. The disclaimer now says suggestions are rule-based educational notes, not a live AI. The Gold pricing bullets "AI buy/hold/sell suggestions with full reasoning / Give AI specific trading instructions / Priority alerts and notifications" became "Buy/hold/sell suggestions with plain-English reasoning (rule-based, educational)" and "Holding alerts with the reasoning behind each suggestion". The feature-card copy was updated the same way. This now matches the Legal page, which already called it rule-based. No Stripe or payment code was touched.
4. **NaN P&L:** `runAI`, the portfolio analytics and the deep-analysis valuation used `q.c` even when a cached quote had no price. They now fall back to cost basis unless `q.c` is a finite number > 0.
5. **Market holidays:** `usMarketStatus()` now knows the NYSE 2026–2027 full-day holidays and 1 PM ET early closes (source: nyse.com/markets/hours-calendars). On those days it shows e.g. "Market closed — closed today for Thanksgiving" and "Open · closes 1 PM ET". `NYSE_HOLIDAYS` needs extending each year (TODO in code).
6. **Lessons nav:** clicking "Lessons" while reading a lesson now closes the lesson and shows the list. Before, nothing visibly happened.
7. **Accessibility:** new `a11yLabelFields()` links sibling `<label>Text</label><input id>` pairs with `for` (screener, backtest, calculators, parent-consent form). It also gives unlabeled fields an `aria-label` from their placeholder (login email, goal name/target, price alert). A debounced MutationObserver re-applies this to calculators rendered later.
- sw.js CACHE → finpath-v10.
- Verified: `node --check` on all 3 inline scripts and on sw.js. Finnhub AAPL → 200. Headless Chrome on a temp copy: the goal-name payload rendered as text (did not run); 13 labels linked; runAI output had no instruction text and no textarea; Thanksgiving 2026 → closed (holiday), Nov 27 2026 at 1:30 PM ET → after hours (early close), Mon Oct 26 at 11 AM ET → open; Lessons nav closes an open lesson; no page errors.

**Documented, not changed — Gold backend mismatch (for Siddharth)**
- `checkGoldStatus()` reads **`gold_users`** (`user_id`, `active`).
- `verifyStripeSession()` reads **`payments`** (`session_id`, `user_id`, `status='paid'`), then re-checks `gold_users`.
- Code comments say the webhook flips **`profiles.is_gold`**, but no client code reads that column.
- So a real purchase only unlocks Gold if the Stripe webhook (server side) writes **both** a `payments` row (status `paid`, keyed by Checkout `session_id` and the Supabase `user_id`) **and** an active `gold_users` row. If it only sets `profiles.is_gold`, paying users won't get Gold. Also, a Payment Link only sends `session_id` back when its success URL includes `?gold=success&session_id={CHECKOUT_SESSION_ID}`. Check this before switching to the live link. RLS must stop clients from writing either table.

**Deferred**
- Finnhub key is still client-side (proxy out of scope). The 13F refresh waits until after Nov 16, 2026. The live Stripe link is still deferred.
- The cached ticker-tape row can show prices up to 5 minutes old with no "last known" flag during an outage (minor).

## 2026-10-25 — Beginner learning pass (finpath-v11)
1. **Beginner path:** a "New to investing? Start here" card at the top of Lessons. It's a fixed order of 6 existing free lessons: stock market basics → compound interest → emergency fund → budgeting → inflation → money psychology. It shows a done count, ✓ marks and a "Continue: …" button, and hides while you search. No new lesson content was written.
2. **Lesson UX:**
   - Each lesson card shows an estimated read time (about 200 words per minute).
   - Lesson pages show "Lesson N of 34 · ~X min read · Free/Gold" at the top and Previous/Next buttons at the bottom. Free users skip past Gold lessons. Next turns primary once the lesson is marked complete.
   - Closing a lesson refreshes the list, so checkmarks and the path update.
   - Lesson cards and glossary terms now open with the keyboard (role=button + tabindex + a global Enter/Space handler).
3. **Glossary:**
   - 15 beginner terms added (stock, ticker, portfolio, brokerage account, expense ratio, dollar cost averaging, Roth IRA, 401(k), emergency fund, inflation, bond, credit score, net worth, 13F), for 28 in total.
   - A browsable "📖 Glossary" section sits under the lesson grid.
   - `glossaryWrap` now makes a single pass over the text, so one term can no longer match inside the markup added for another. Popups escape their text.
4. **Onboarding:**
   - New 4th card, "Good to know": not advice, notes are rule-based, 13F filings are weeks old, paper trading is virtual.
   - The last button changed from "Browse lessons" to "Start the beginner path", which opens path lesson 1.
5. **Paper trading and demo clarity:**
   - A "Practice mode" note on Paper Trading: virtual money, no brokerage, instant fills at the latest quote with no fees, taxes or slippage.
   - The demo portfolio now shows a toast explaining the holdings are samples "bought" at today's price and are not a recommendation.
6. **Honesty: removed the remaining "AI" overclaims.** The app has no LLM or AI API calls. Everything is rule-based, so user-facing labels changed:
   - "AI Suggestions" → "Stock Suggestions (rule-based)"
   - "AI analyzer" → "Portfolio check-up"
   - "AI Alerts" → "Holding alerts"
   - "AI insight" → "Quick take (general info, not advice)"
   - "AI SUGGESTION" → "RULE-BASED SUGGESTION"
   - The landing, pricing and upgrade copy dropped "personalised AI".
   - Legal §3 is renamed "Automated ("AI") Features Disclaimer". It now says no LLM generates the content and notes the old feature name. The liability bullets are unchanged.
- sw.js CACHE → finpath-v11.
- Verified: `node --check` on all 3 inline scripts and on sw.js. Finnhub AAPL → 200. Headless Chrome on a temp copy confirmed:
  - The path card renders, then shows "1 of 6 done" after completing a lesson.
  - 28 glossary entries; no nested terms; Enter on a term opens its popup.
  - Lesson meta and the Previous/Next nav are correct; the practice note shows; the new labels appear.
  - No horizontal overflow at the narrowest headless width (500px) on home, lessons, a lesson page and portfolio. No page errors.

**Deferred:** real-device check at 320–375px (headless Chrome can't go below 500px). Per-lesson glossary links in the Gold lesson content. The 13F refresh waits until after Nov 16, 2026. Stripe live link and Finnhub proxy are still out of scope.

## Pass 5 — Mobile + PWA polish (finpath-v12, 2026-10-25)

**Shipped**
- Safe-area / notch support: `viewport-fit=cover`; sticky nav, mobile menu, page top padding, offline bar, toasts, modals, install pill and iOS tip all offset by `env(safe-area-inset-*)`.
- Mobile menu bug fix: tapping a menu link used to leave the menu open (`showPage` closed it, then the link's `toggleMenu()` reopened it). Links now call `toggleMenu(false)`; `showPage`/Escape use it too, so `aria-expanded` stays in sync.
- Menu also closes on an outside tap or Escape; hamburger gets `aria-expanded`, a 44×44 tap target, and a label that changes with its state. Menu links are 44px tall and scroll if the screen is short.
- Keyboard: nav anchors are `role=button tabindex=0`, and the global Enter/Space handler now activates `<a>` without href (it used to skip all anchors).
- ≤640px: form fields are 16px (no iOS zoom on focus); chips, tabs and the theme button get ≥40px tap targets; toasts span the screen width.
- Offline: a clearer `role=status` bar ("Lessons, the glossary and your saved portfolio still work; live prices, news and sign-in pause…") plus a "Back online" toast.
- Install: the pill copy now explains the benefit ("Opens like an app · lessons work offline · free"); `beforeinstallprompt` no longer double-counts `fp_visits`.
- sw.js: navigations are cached only under `./index.html`, and only for same-origin responses, so `?gold=success&session_id=…` / `?p=…` URLs no longer pile up in the cache. Cache bumped to `finpath-v12`.

**Verified**: node --check (3 inline scripts + sw.js); Finnhub AAPL 200; headless Chrome (500px minimum): menu open/close/outside/Escape/link tap, keyboard Enter navigation, 16px inputs, offline/online bar + toast, no horizontal overflow, no page errors.

**Deferred**
- Real-device check at 320–375px with a notch (headless can't go below 500px).
- No bottom tab bar (the hamburger menu is enough for now; adding one would be a bigger UX change).
- Gold `gold_users`/`payments` mismatch is still documented only (Stripe untouched).

## 2026-10-25 — Investor move cards (finpath-v13)
Rebased onto the mobile/PWA pass (`finpath-v12`). The freshness line, "How to read these moves" explainer, and "+ Track" button stay.

- Gold move cards split **action** (badge + colour bar) from **position size** (dollar figure) and **% of portfolio**. `parseMoveAmount` reads the existing `amount` string (`$37.8B — 12.62%`, `$0 (was $94.9M)`, `$242M notional`). `getActionBadge` styles are unchanged (sold out, put, buy, new, add, hold, reduce).
- Initials use the shared `.inv-avatar` chip (landing preview and Gold grid). Notes render in full; `escapeHtml` still covers investor, stock, ticker, notes, size, and date.
- Gold grid defaults to non-Hold moves. A secondary **Show holds** toggle (not an investor tab) reveals the unchanged positions still stored in `MOVES`. Landing preview still shows the same four real moves.
- sw.js CACHE → finpath-v13 (main was already at v12). Stripe, pricing, auth, Finnhub key, COMPANIES, SECTORS, and POP were not touched.

## 2026-10-25 — Q2 2026 MOVES accuracy audit (finpath-v14)

Checked all 50 `MOVES` rows against the SEC Form 13F-HR information tables for the quarter ended June 30, 2026 (filed Aug 13–14, 2026). Share-count changes are quarter over quarter. "% of portfolio" uses reported value divided by that filer's long-equity total, with put/call rows left out of the denominator. Baupost (CIK 1061768) and Duquesne (CIK 1536411) report info-table values in thousands of dollars; the other four report dollars. Scaled values match share count × quarter-end price. Dataroma's Q2 2026 holdings pages match these SEC aggregates, with the Howard Hughes exception below.

### Fixed
- **Druckenmiller / Delta (DAL):** reported value is $56,477,000, which rounds to **$56.5M**, not $56.6M. Weight stays 1.30% of the $4.35B long-equity book. It is a new equity buy (603,000 shares). United Airlines equity went from 262,495 to 794,795 shares (3.03×), so "also tripled" stays.
- **Tepper / Taiwan Semiconductor note:** "His biggest add of the quarter" was wrong. The TSM add is real (1,327,500 → 1,650,000 shares, +24.29%, $788.0M, 10.55%), but the Amazon add was larger by quarter-end dollars (680,000 shares, about $162M vs about $154M) and by portfolio-weight change. The new Boeing stake ($173M) was a larger new buy. Note now says he added about 24% more shares. Action, dollar amount, and weight were already right. No AI insight or lesson cited the old sentence.

### Verified correct
Portfolio totals in the `MOVES` comments match the filings: Berkshire $299.25B (CIK 1067983), Pershing Square Inc. $19.47B (CIK 2026053), Appaloosa long equity $7.47B / 13F $7.73B including puts (CIK 1656456), Duquesne long equity $4.35B / 13F $5.21B including calls (CIK 1536411), Himalaya $3.70B (CIK 1709323), Baupost $5.42B (CIK 1061768).

- **Buffett:** AAPL hold $66.0B / 22.04% (shares flat; value rose from $57.84B on price). AXP hold $51.3B / 17.14%. KO hold $32.5B / 10.86%, exactly 400,000,000 shares. BAC reduce 5.89% to 483,394,015 shares, $27.5B / 9.20%. CVX hold $14.0B / 4.67%; value fell about $3.47B from $17.46B with shares unchanged. OXY hold, same 264,941,431 shares, $12.9B / 4.30%. DAL add 43.99% (shown as 44%), $5.4B / 1.79%; Q1 was a new buy. Schedule 13G/A filed Aug 14, 2026 reports **8.7%** of Delta. LEN Class A add 29.82%, $1.19B shown as $1.2B / 0.40% (Class B is a separate $26.4M add, not in that figure). NVR was unchanged; DHI is a new 3,564-share buy ($581k). KR reduce exactly 22% (sold 11,000,000 shares), $2.2B / 0.72%. STZ sold out; Q1 value was $94.9M. Combined Alphabet (GOOGL + GOOG) is $37.76B / 12.62% and about +83% in shares, third behind Apple and American Express. The GOOGL ticker with the Class A + Class C note matches the filing.
- **Ackman:** Compared Q2 Pershing Square Inc. with Q1 Pershing Square Capital Management (CIK 1336528) plus Pershing Square Inc. The old manager filed a 13F-NT for Q2 (holdings moved). UBER add 14.58% $2.48B / 12.72% (largest). BN reduce 3.71% $2.45B / 12.58%. MSFT add 9.77% $2.32B / 11.89%. AMZN reduce 25.22% $2.04B / 10.49%. META add 20.11% $1.80B / 9.25%. QSR add 14.02% $1.87B / 9.62%. New buys: V $1.12B / 5.76%, MA $1.09B / 5.61%, SPGI $1.06B / 5.43%, NFLX $934M / 4.80%. **HHH is a Hold**, not an add: Q1 was 18,852,064 shares at the old manager plus 9,000,000 at Pershing Square Inc.; Q2 Pershing Square Inc. reports the same 27,852,064 shares ($1.99B / 10.23%) on two lines. Dataroma's "Add 47.74%" compares only the old filer's Q1 line to the combined Q2 total. The card's note is the right reading. Pershing's Aug 12, 2026 shareholder letter (linked from the Aug 13 8-K) says Alcon and ICE were initiated after June 30, and neither CUSIP is in the 13F.
- **Tepper:** AMZN add 15.74% $1.19B / 15.95%. MU reduce 41.44% $1.13B / 15.06%; value went from $562.5M to $1,125.4M with fewer shares. GOOG is Class C only (CUSIP 02079K107), add 6.77% $654M / 8.75%, no Class A row. UBER add 21.50% $555M / 7.43%. META add 54.64% $380M / 5.09% after a Q1 trim of 27.25%. NVDA add 3.64% $305M / 4.08% after a Q1 trim of 13.44%. BABA reduce 42.28% $192M / 2.57%. Q2 equity table has no PDD, JD.com, or KraneShares CSI China Internet (KWEB; Q1 was 1,080,000 shares). BA new $173M / 2.32%, plus new American Airlines. AAPL is a put, not shares: 835,000 underlying shares, reported value $241,615,600 (shown as $242M notional), excluded from the equity weight. MSFT sold out; Q1 value $33.3M (shown as $33M).
- **Druckenmiller:** NTRA add 4.01% $864.9M (shown as $865M) / 19.86%, largest equity line. TSM add 19.06% $282M / 6.47%. STM add 18.75% $232M / 5.34%. AMZN equity 45,800 → 541,600 shares (+1082.53%, shown as 1083%) $129M / 2.96%, with a separate call row (459,300 underlying shares, $109.5M notional) that is not in that dollar figure. GOOGL is new Class A only (CUSIP 02079K305), $120.2M shown as $120M / 2.76%. No Class C row.
- **Li Lu:** GOOGL and GOOG shares both unchanged; combined $1,775M (shown as $1.78B) / 47.94%. PDD add 133.53% $821M / 22.17%. BRK.B add 23.46% $555M / 14.98%. EWBC hold $358M / 9.68%. BAC sold out; Q1 value $146.2M (shown as $146M). The other five exits are OXY, H&R Block, Moody's, S&P Global, and MSCI. Q2 has 8 equity names.
- **Klarman:** AMZN add 20.04% $892M / 16.48%. ELV hold $493M / 9.11%. GOOG is Class C only, add 16.15% $485M / 8.95%, no Class A. QSR reduce 16.42% $490M / 9.04%. GPC add 88.96% (shown as 89%) $332M / 6.13%. CME new $136.7M shown as $137M / 2.52%.
- Lesson and insight copy that repeats these Q2 facts (Alphabet +83% and top-3, Li Lu ~48%, Ackman Microsoft ~10% / ~$2.3B, Tepper sold Microsoft, Amazon adds vs Ackman's trim, Meta +20% and +55%, Buffett weights, Natera ~20%) still matches the filings. No new investors and no card redesign. Stripe, pricing, auth, Finnhub, COMPANIES, SECTORS, and POP were not touched. Cache bumped to finpath-v14.

### Not added (coverage, not a wrong row)
Highlight cards are not the full 13F. Left as-is and not treated as errors: Ackman fully sold a small Alphabet stake (Q1 about $98.7M across both classes); Tepper opened a new Berkshire Class B put worth $12.5M notional; both books have other positions and exits the cards do not list.

### Could not use as a source
WhaleWisdom filer pages returned a JavaScript shell with no holdings table, so they were not used. Dataroma does not list Duquesne; that book was checked from the SEC info table only.

## 2026-10-25 — Three more Q2 2026 investors (finpath-v15)

Added 17 moves for three filers whose June 30, 2026 Form 13F-HR information tables are clean equity books. Share changes are versus each filer's own March 31, 2026 table. Weights are reported value ÷ that filer's long-equity total. None of these three tables has a put or call row. `MOVES` is now 67 rows and 9 investors. Cache is `finpath-v15`.

### Added
- **Bill Gates / Gates Foundation Trust (CIK 1166559), 5 cards, 13F total $34,424,791,932.** BRK.B reduce 13.83% (17,048,304 → 14,689,844) $7,350,651,039 / 21.35%. CAT hold, 6,353,614 shares, value $4,501,281,374 → $6,765,963,549 / 19.65%. WM reduce 3.33% (27,642,344 → 26,720,744) $5,955,519,423 / 17.30%. HD new, exactly 1,000,000 shares, $352,680,000 / 1.02%. FDXF is labeled **New spin-off**, not Buy: FedEx shares stayed 2,384,362 and FedEx Freight shares are exactly half (1,192,181), matching the June 1, 2026 one-for-two spin-off (ticker FDXF, CUSIP 314352105), value $180,019,331 / 0.52%. Berkshire + Caterpillar + Canadian National (unchanged 51,826,786 shares, 17.95%) + Waste Management = 76.25%.
- **Chase Coleman / Tiger Global Management LLC (CIK 1167483), 6 cards, equity $23,981,506,027.** GOOGL Class A only (CUSIP 02079K305) reduce 45.39% (10,631,402 → 5,805,687) $2,074,778,363 / 8.65%. AVGO reduce 51.07% (3,584,814 → 1,754,062) $662,596,921 / 2.76%. CBRS new 2,999,000 Class A shares (CUSIP 15675D103, IPO May 2026) $662,779,000 / 2.76%. INTC add 159.52% (1,638,700 → 4,252,690) $593,803,105 / 2.48%. APP sold out; Q1 value exactly $398,000,000. AMD new 674,727 shares, $391,955,662 / 1.63%.
- **Terry Smith / Fundsmith LLP (CIK 1569205), 6 cards, equity $13,648,923,682.** MTD sold out; Q1 value $717,012,379. UBER new 8,943,151 shares, $645,337,776 / 4.73%. MA new $639,458,194 / 4.68%. TSM new $548,464,789 / 4.02%. GOOGL Class A only reduce 40.01% (2,956,198 → 1,773,354) $633,743,519 / 4.64%. NFLX new $499,110,633 / 3.66%. The Mettler note also says Zoetis was sold; Q1 Zoetis value was $458,366,249 and it is absent in Q2.

Copy that said "6 legendary investors" now says 9 and names Gates, Coleman and Smith (hero, hero stat, how-it-works, feature card, both pricing bullets, Gold hero). The Gold paywall already uses `INVESTORS.length`. The portfolio check-up empty state now uses that count too. The lesson "What Billionaires Actually Invest In" has a short Q2 paragraph for each new manager. The moves disclaimer says nine managers. No Stripe, price, auth, or Finnhub edits.

### Not added to COMPANIES / SECTORS
New tickers on the cards (FDXF, CBRS, MTD, and AMD/APP/AVGO/HD/CAT/WM/INTC where they were already absent) still render, because a card reads `MOVES` fields directly. Track search already accepts a typed symbol that is not in `COMPANIES`. The market-universe lists were left to the stocks owner.

### Considered and not added
- **Michael Burry / Scion Asset Management (CIK 1649339):** no 2026 Form 13F-HR. The newest 13F is for the quarter ended September 30, 2025, filed November 3, 2025. An EDGAR search for a 2026 Scion or Burry 13F-HR returned nothing.
- **Ray Dalio / Bridgewater (CIK 1350694):** filed, but the Q2 table is about 997 positions and the largest lines are S&P 500 ETFs. That is not a short, concentrated story.
- **Howard Marks / Oaktree (CIK 949509):** filed, but the table is about 145 rows of distressed names, convertibles and ETF puts. Left out rather than pick a misleading handful.
- **Mohnish Pabrai / Dalal Street LLC (CIK 1549575):** filed August 13, 2026, and the book is real and concentrated ($326,749,980, four lines). Warrior Met Coal 1,810,831 → 1,744,050 (−3.69%, $141.5M, 43.32%), Transocean essentially unchanged (20,392,672 → 20,398,659, $99.7M, 30.53%), Alpha Metallurgical 579,738 → 517,194 (−10.79%, $85.3M, 26.11%), plus a new Kaspi stub of 1,702 shares ($150k, 0.05%). The quarter does not have four meaningful moves without padding, so he was not added.
- **Fundsmith Investment Services Ltd (CIK 1868537)** filed its own Q2 13F of overlapping names. Cards use Fundsmith LLP only, so a second reporting entity is not counted as a fresh set of buys.

## 2026-10-25 — Calculators, Gold honesty, sharing (finpath-v16)

**Shipped**
1. **Lesson calculators were blank on open (bug).** All five (compound interest, rent vs buy, 401k match, credit score, DRIP) only filled their result after you typed. `runLessonCalc()` now runs right after the lesson body renders.
2. **Calculator clarity and input safety.** Inputs are clamped through `_cv()` (negative, blank or huge values no longer give nonsense like negative years). Each result now has a one-line assumptions note. Compound interest also shows the result in today’s dollars (~3%/yr inflation). Rent vs buy dropped "strong buy signal" for neutral wording and lists its assumptions (20% down, 30-year fixed, tax/insurance/maintenance rates, what it ignores). The 401k note mentions vesting. The credit-score note says it is a teaching model, not FICO/VantageScore. DRIP notes taxes and dividend cuts. Inputs get `min="0" inputmode="decimal"` for phone keypads.
3. **Free vs Gold honesty: the "hourly breakdown".** Pricing promised "Full profit tracking with hourly breakdown", but the modal only showed one live total, because hour-by-hour history isn't on the data plan. The Gold modal now shows **today’s change by holding** (sorted by dollar impact, with % and "no price" handling), and the pricing bullets, feature card, portfolio hint, modal title and aria-label all describe that instead. Free users get a toast and the Gold page instead of a blocking `alert()`.
4. **Share a lesson deep-links to it.** `shareLesson` used to share the home page. It now shares `…#lesson/N` from the current origin, which the hash router already opens. Gold lessons show their preview/lock.
5. **Share portfolio on phones** uses the native share sheet (Android/iOS), with copy-to-clipboard kept on desktop. The import toast now explains that imported holdings use today’s price as the buy price, so P/L starts at $0.
6. **Performance:** merged the separate Caveat Google Fonts stylesheet into the main fonts request (one fewer render-blocking request).

**Verified:** node --check (3 inline scripts + sw.js); Finnhub AAPL 200; headless Chrome checked that all calculators render on open, clamping works, the share URL is `#lesson/6`, the Gold today's-change modal is sorted with a no-price row, free users are sent to Gold, there is one fonts link and no horizontal overflow. Stripe test link unchanged. `sw.js` CACHE → `finpath-v16`.

**Deferred**
- Supabase JS is still a render-blocking `<script>` pinned only to `@2`. Deferring it needs `initAuth` reordered, so it was left alone this pass.
- Real intraday/hourly portfolio history (needs a data plan with candles).
- `LESSONS[15]` is an empty slot (sparse array). Code already skips it; leaving the indices stable avoids breaking saved progress and `#lesson/N` links.
- Gold `gold_users`/`payments` mismatch: still documented only. Stripe is untouched.

## 2026-10-25 — Search, keyboard access, news, faster load (finpath-v17)

**Shipped**
1. **Lesson search actually works for phrases.** It used to match the raw lesson HTML as one exact string, so tag names (`strong`, `class`, `div`) matched almost everything, and "credit score" missed lessons that had both words apart. Now every word must appear in the title, summary, category or tag-stripped text (cached per lesson). Title hits rank first, and an `aria-live` status line reads "N lessons match …". An exact glossary term (or a prefix of 4+ letters) shows its plain-English definition above the results. No matches gets suggestions and a **Clear search** button. The input is `type="search"`.
2. **Keyboard / screen-reader access for clickable cards.** 15 static cards (logo, How-it-works, feature cards, daily-change row, screener presets) and dynamic rows (stock, watchlist, heat-map, search results) were `<div onclick>` with no role or focus. `a11yLabelFields()` now gives any non-interactive `[onclick]` element `role="button" tabindex="0"`, skipping `.modal-overlay`. The existing global Enter/Space handler activates them. The compare dropdowns and the alert-direction select got `aria-label`s (they were the only unlabelled fields).
3. **News: retry and a beginner cue.** The failure state explains why (offline or a busy free feed) and has a **Try again** button (resets `newsLoadedAt`). Under the grid there is a note: headlines come from outside sources via Finnhub, are not advice, and link to the existing lesson "How to Read a Financial News Article Without Being Misled".
4. **Supabase SDK no longer blocks first paint.** The CDN `<script>` is now `defer`. The client is made by `ensureSupabase()` in a `bootAuth()` that runs on `DOMContentLoaded` (after deferred scripts), then `initAuth()` and `checkPaymentReturn()` run in the same order as before. `sendMagicLink` also calls `ensureSupabase()`. If the CDN is blocked, the app still boots with sign-in unavailable, as before.

**Verified:** node --check (3 inline scripts + sw.js); Finnhub AAPL 200; headless Chrome checked that the Supabase client exists after boot, search ranking/status/glossary/clear works, 15/15 static cards have role+tabindex, no overlay got a role, Enter on a feature card navigates, and the news lesson link opens. Stripe test link unchanged. `sw.js` CACHE → `finpath-v17`.

**Deferred**
- `LESSONS[15]` empty slot: left on purpose. Every counter already uses `filter(Boolean)`/`lessonOrder()`, and compacting the array would shift `#lesson/N` links, saved progress keys and `BEGINNER_PATH`. That isn't worth the risk.
- Supabase CDN is still pinned only to `@2` with no SRI. Pinning an exact version + integrity hash should be done when someone can test sign-in end-to-end.
- Real-device check of keyboard focus outlines on the newly focusable cards.
