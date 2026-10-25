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
