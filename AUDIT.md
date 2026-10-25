# FinPath audit — remaining issues (delta vs PR #6)

Audited tree: `56d4cbd` (`origin/main`), service-worker cache `finpath-v17` (`sw.js`).

This note lists bugs still open **after** [PR #6](https://github.com/finpathdev/FinPath/pull/6) (merge `70ef151`) and the later v16/v17 commits. PR #6 items that still hold are recorded once under “Closed on this tree” and are not re-filed.

Stripe payment code, the Finnhub proxy, and any “Q3” product invention were left alone.

How this was checked: read of `index.html` and `sw.js`, plus headless Chrome (puppeteer-core) against a local static server. Finnhub, Supabase, Stripe, and font/CDN hosts were aborted except where a test says otherwise. Line numbers are `index.html` on `56d4cbd`.

Severity is high / medium / low. Fix directions are non-binding.

---

## Closed on this tree (PR #3 items 1–11)

| # | Status on `56d4cbd` |
| --- | --- |
| 1 Blocked Supabase script aborted boot | Fixed. `ensureSupabase` only calls `createClient` when it exists. With the CDN aborted, the shell still renders (34 lesson cards, no throw). |
| 2 Ticker-tape / watchlist `innerHTML` XSS | Fixed. Tape cache is JSON `{s,c,dp}`; a poisoned HTML string is ignored. Invalid watch tickers are dropped. Retested. |
| 3 Earnings `innerHTML` | Fixed in `loadEarnings` (~6350): symbol/date/hour/EPS are escaped; a bad symbol drops the row. |
| 4 Hash router only accepted exact page names | Fixed for page routes (`#/portfolio`, `#Portfolio/`, `#lessons/`, `#LESSONS`, `#portfolio?x=1` normalize; unknown hash goes Home and the hash is cleared; `#p=` is ignored). Cold `#l-*` scroll is a leftover — issue 11. |
| 5 Back from an open lesson left Lessons | **Regressed.** Cold `#lesson/N` and the in-page “Back to lessons” button work. Browser Back and a second deep link do not. Filed as issue 1. |
| 6 `/` shortcut swallowed keystrokes | Fixed in the key handler (~5369): `preventDefault` only when a visible search target exists. Inputs, selects, and an open lesson are skipped. |
| 7 Move-card Enter double-toggle | Still obsolete. `toggleMoveCard` (~3734) is not called from `renderMoves`. |
| 8 Escape left onboarding / install help open | Fixed (~5089): Escape removes `.ob-overlay`, sets `fp_onboarded`, and calls `closeInstallHelp()`. |
| 9 Search said “No matches” when every quote failed | Fixed (~4108): “Market data unavailable…”. |
| 10 Failed dividend lookup said “no dividends” | Fixed in `renderDividends`: a failed lookup with no annual figure uses the unavailable sentence. |
| 11 Empty `LESSONS` hole blocked the playbook toast | Fixed. The hole at index 15 stays (progress is keyed by index). `checkGraduateComplete` counts `LESSONS.filter(Boolean)`. `#lesson/15` correctly opens Home. |

---

## Remaining issues

### 1. Medium — Browser Back and a second `#lesson/N` close the lesson

**Where:** `closeLessonDetail` ~3682–3693; `showPage` ~3361 (always calls `closeLessonDetail` when `p === 'lessons'`); `routeFromHash` ~6711–6717 (calls `showPage('lessons', true)` before `openLesson` when Lessons is not the active page).

`closeLessonDetail` rewrites any `#lesson/N` hash to `#lessons` whenever the detail panel is still `.active`. `showPage('portfolio')` leaves that panel `.active`. The next time the router opens Lessons, the rewrite runs, then a follow-up `#lessons` hashchange closes the lesson `openLesson` just opened.

**Repro A (browser Back)**

1. Open Lessons and open lesson 0. URL is `#lesson/0` and the detail panel is open.
2. Open Portfolio. URL is `#portfolio`. The detail panel stays `.active` (it is only closed when the destination is Lessons).
3. Press the browser Back button.

Expected: `#lesson/0` with lesson 0 open.

Actual: `#lessons`, detail closed, lesson list visible. Press Back again: `#lesson/0` opens.

**Repro B (deep link while a lesson panel is still open)**

1. Open any lesson, then go to Portfolio without using the in-page “Back to lessons” button (detail stays `.active`).
2. Set the location to `#lesson/3` (paste a shared lesson link).

Expected: lesson 3 open, URL stays `#lesson/3`.

Actual: URL becomes `#lessons` and the list is what you see. An instrumented run logged: close while the hash is still `#lesson/3` (pushState `#lessons`), `openLesson(3)` briefly opens the panel, then the `#lessons` hashchange closes it. The title is left as lesson 3, but the panel is not `.active`.

A cold load of `#lesson/2` still works, because the panel starts closed and the rewrite does not run.

**Fix direction:** Rewrite the hash to `#lessons` only from the in-page back button. When routing to `#lesson/N`, do not `pushState('#lessons')` over that hash, and do not close the detail the router just opened.

---

### 2. Medium — `dp.toFixed` throws and blanks the watchlist (same shape in search, alerts, pulse, heatmap)

**Where:** `renderWatchlist` ~4991–5007 (`q.dp.toFixed` at 5007). Same unguarded `dp` in `renderSearchResults` ~4125–4126, `renderAlerts` ~4287 and ~4300, `renderPulse` ~6247–6248, `renderHeatMap` ~6268–6271.

`fetchQ` (~4000) stores `dp: d.dp` whenever Finnhub returns a truthy `c`, including `dp: null`. `null >= 0` is `true` in JavaScript, so the “up” branch still calls `toFixed`.

**Repro**

1. Watch a valid ticker (AAPL).
2. Make `fetchQ` resolve `{c: 123.45, d: null, dp: null}` — the object `fetchQ` writes when `c` is present and `dp` is null, and the object `fp_pricecache` will restore.
3. Call `renderWatchlist()`.

Expected: the price row renders; the percent is omitted or shown as “—”.

Actual: `TypeError: Cannot read properties of null (reading 'toFixed')`. `#watchGrid` stays on the skeleton rows.

Search: `renderSearchResults([{t:'AAPL', q:{c:10, d:1, dp:null}}])` throws the same error and leaves “Loading live prices...”.

A live Finnhub response with `dp: null` was not captured this pass (calls aborted). The crash is the stored shape.

**Fix direction:** Call `toFixed` only when `typeof dp === 'number' && isFinite(dp)`. On a missing change, render the price and skip the percent so one bad quote does not abort the whole list.

---

### 3. Medium — Price alerts duplicate, fire when already true, and treat a stale cache as “now”

**Where:** `addAlertFromDetail` ~5885–5896; `checkAlerts` ~5909–5919; `startAlertLoop` ~5921–5926. `checkAlerts` also runs at the end of `renderPortfolio` (~4272) and from `applyLivePrices` (~4967). `priceCache` is restored from `localStorage` with no max age. `checkAlerts` ignores `q.ts` and `q.stale`.

**Repro**

1. Set `selectedStock = {ticker:'AAPL'}` and `priceCache.AAPL = {c:180, dp:1.2, ts: Date.now() - 3 days}`.
2. Set the alert price to `100`, direction `above`. Call `addAlertFromDetail()` twice (the function clears the input, so fill it again before the second call).
3. Call `checkAlerts()` (Portfolio render and the 90s loop do this on their own).

Expected: one watching alert, which fires only when a fresh quote crosses $100 upward.

Actual: two identical `AAPL / above / 100` entries and two “Alert set” toasts. Both are marked done immediately. Two notifications say AAPL is now $180.00 using the three-day-old cache. There is no duplicate check, no “already past this level” check, and no staleness check. `null <= price` is also true, so a missing `c` can satisfy a “below” alert.

**Fix direction:** Reject a duplicate ticker + direction + price. Do not notify or mark done when the cached quote is already past the level, older than a short TTL, or `c` is not a finite number.

---

### 4. Medium — Alert ticker is written into a toast with `innerHTML`, and the handler runs

**Where:** `toast` ~5794–5799 (`t.innerHTML`); `notify` ~5815–5819 (`'<b>' + title + '</b><br>' + body`); `checkAlerts` ~5916 passes `al.t` through unescaped. `renderAlertsList` (~5906) does `escapeHtml(al.t)`, so the list itself is safe. The toast is not.

The in-app add path uses `selectedStock.ticker` after ticker validation. Triggering this needs a `localStorage` write on the origin (`fp_alerts`), the same class as the tape bug PR #6 already fixed.

**Repro**

1. Set `localStorage.fp_alerts` to `[{t:'<img src=/nope.png onerror="window.__xss=1">', dir:'below', price:20, done:false}]`.
2. Set `priceCache` for that same string key to `{c:5, dp:0, ts:1}`.
3. Call `checkAlerts()`. Wait ~400ms.

Expected: the ticker is shown as text.

Actual (headless Chrome): the toast DOM contains the `<img>`, and `window.__xss` becomes `1`. A direct `innerHTML` assignment of the same image also runs.

Other sinks checked and left closed: lesson bodies have no raw `<`; glossary terms are escaped; news and “why it moved” use `safeUrl` + `escapeHtml`; goals escape names; portfolio and watch tickers go through `isValidTicker` + `escapeHtml`; earnings are escaped; calculator output goes through `fmt`; the share-list path escapes; the tape JSON path ignores an HTML string (retested).

**Fix direction:** Render toast and notification text with `textContent`, or `escapeHtml` the title and body. Keep the list’s existing escape.

---

### 5. Medium — Compare colors “better” in green, and market cap prints as integer billions

**Where:** `compareStocks` ~6657–6684. `row()` ~6665–6671 paints the winner `#4ade80` whenever `higherWins` is set. Today (~6677) and Market cap (~6680) both pass `higherWins = true`. Market cap format is `'$' + (v/1000).toFixed(0) + 'B'`. The same display formula is in `runScreener` ~6339 (`(r.cap/1000).toFixed(0) + 'B cap'`). The screener **filter** (`minCap * 1000`) matches Finnhub’s millions; only the display is wrong. Footnote at ~6684: “Green = better on that metric”.

**Repro**

1. Stub quotes and metrics: AAPL price 190, today −1.5%, market cap 3,800,000 (Finnhub millions ≈ $3.8T), P/E 32. KO price 60, today +2.0%, market cap 400 (≈ $400M), P/E 12.
2. Run `compareStocks()`.

Expected: caps shown on the order of $3.8T and $400M. A one-day percent and company size are not colored as a win.

Actual: the table reads `MARKET CAP $3800B $0B` (`400/1000 = 0.4`, `toFixed(0)` → `0`). Today’s +2.0% is green, the lower P/E is green, and the larger cap is green (three uses of `#4ade80`). The footnote tells the reader green means better. In light mode that green on white is about 1.74:1 (issue 8), so the “winner” is also hard to read.

**Fix direction:** Format millions as `$XB` under ~1,000 and `$X.XT` above that. Stop coloring today’s percent and market-cap size as a win; keep a neutral number, or only color a metric the footnote actually defines.

---

### 6. Medium — Strategy Playground says a flat-rate projection “would have grown”

**Where:** `runBacktest` ~6396–6458, headline string ~6442. Section copy ~2090 (“would have played out”) and ~2092 (“What if I had invested…”). `spShare` ~6462 (“If I invested… I’d have”). The math is `_fv` at a constant monthly rate, not a historical price path. The Tesla option is labeled “~35%/yr since 2015”, and any year count, including 30–40, uses 35%. A disclaimer under the number (~6458) does say historical average and that past performance does not guarantee future returns.

**Repro**

1. Markets → Strategy Playground.
2. $100/month, 10 years, S&P 500 index → Run.

Expected: wording such as “at a steady 10%/yr this projects to”.

Actual headline: “Investing $100.00/month in S&P 500 index for 10 years would have grown to:” followed by the flat-rate future value.

**Fix direction:** Change the headline, the section sub, and the share text so they describe a constant-rate illustration. Leave the formula.

---

### 7. Low — Playground ignores `max` and can print a nonsense fortune

**Where:** inputs ~2095–2096 (`max="50000"` and `max="40"`). `runBacktest` ~6397–6398 uses `parseFloat(...) || 0` with no clamp. The year loop (~6413) runs `years + 1` times with an inner 12-step loop. Lesson calculators already clamp with `_cv`. The playground does not.

**Repro**

1. Set `#btYears` to 500, `#btAsset` to 35, `#btAmt` to 50000.
2. Call `runBacktest()`.

Expected: values clamped to the field max, or the existing “enter a monthly amount…” message.

Actual: no throw. `.sp-big` shows a ~10^78 dollar figure. Blank or zero years still shows the error string; that part is fine.

**Fix direction:** Clamp amount and years the same way `_cv` does, before `_fv` and before the chart loop.

---

### 8. Medium — Light mode paints gains, “Free”, and “Correct” in `#4ade80` on white (~1.74:1)

**Where:** `.up{color:#4ade80}` at line 418. The same hex is hardcoded on `.plan-free` ~353, `.t-up` ~287, `.daily-up` ~416, `.act-buy` ~472, `.alert-pct` ~487, quiz “Correct.” ~5687, compare’s inline style ~6670, and earnings “You own this” ~6372. There is no `body.light .up` rule. Light cards are forced to `#ffffff`.

**Repro**

1. Toggle light theme (`body.light`).
2. Read a portfolio percent (`.up`), a lesson “Free” pill, or a quiz “Correct.”

Expected: small text at least 4.5:1 against the card.

Actual: computed color `rgb(74, 222, 128)` on `#ffffff` is about **1.74:1** (fails WCAG AA, including the 3:1 large-text floor). Dark mode `#4ade80` on `#040604` is about 11.7:1 and is fine.

**Fix direction:** In light mode, use a dark green (the globe hover already uses `#15803d`) for `.up` and those badges.

---

### 9. Medium — `--muted2` fails contrast for small text in both themes

**Where:** `:root` line 75 `--muted2:#5a6b5c` on `--bg:#040604`. `body.light` line 608 `--muted2:#8ba28d`. Used by `.footer-copy` (12px, ~543), `.p-desc` (~427), placeholders (~859–862 force `#8ba28d` in light mode), and many inline `color:var(--muted2)` labels (install hint ~1901, “no price”). Page footers hardcode `#5a6b5c` at ~1927, ~1939, ~2060, ~6760.

`--muted` itself passes and should stay: `#93a693` on `#040604` ≈ 7.9:1; light `#546b58` on `#f7faf6` ≈ 5.5:1. Nav links use `--muted`. Light mode already overrides `.footer-copy` / `.footer-sub` to `#3d5245` (~834), which passes. Placeholders and inline `var(--muted2)` do not get that override.

**Repro**

1. Home, dark theme. Read the 12px footer line and the install hint (“Opens fullscreen…”).
2. Switch to light. Read a placeholder (lesson search) or a `var(--muted2)` label on a white card.

Expected: ≥ 4.5:1 for 12–13px text.

Actual:

| Pair | Ratio | AA normal (4.5:1) |
| --- | --- | --- |
| `#5a6b5c` on `#040604` | ≈ 3.57:1 | fails (passes 3:1 large only) |
| `#8ba28d` on `#f7faf6` | ≈ 2.61:1 | fails, including large text |
| `#8ba28d` on `#ffffff` | ≈ 2.74:1 | fails, including large text |

**Fix direction:** Lighten dark `--muted2` and darken light `--muted2` until 12px text clears 4.5:1 on both backgrounds. Point the hardcoded `#5a6b5c` footers at that token. Leave `--muted` as it is.

---

### 10. Medium — The Gold plan button opens Portfolio

**Where:** pricing card ~1884: `<button class="price-btn" onclick="showPage('portfolio')">Start with Gold</button>`. Other upgrade buttons call `openGoldPayment()` (user menu ~4611, lesson lock ~3655, gold gate ~3704, suggestions gate ~4308).

**Repro**

1. Home → pricing → “Start with Gold” on the $4.99 card.

Expected: the same upgrade entry as the other “Upgrade to Gold” buttons.

Actual: Portfolio opens. No paywall and no checkout. The Free card’s “Get started free” correctly calls `handleAuthClick()`.

Do not edit the Stripe Payment Link or any Stripe file. Point this button at the existing `openGoldPayment()` entry.

Counts that match the code and are not bugs: 14 Gold lessons, 9 investors, “annual plan coming soon”, and the today’s-change modal stating that hour-by-hour history is not available.

---

### 11. Low — Copy still calls Gold filings “free”, quotes “real-time”, and the rules engine “AI”

**Where:**

- Founder bio ~1848: “real filings from real billionaires, and a live portfolio tracker — all free.” Investor Moves is a Gold “no” row on the Free card (~1865). The live tracker itself is on the Free plan.
- `<meta name="description">` ~34, `og:description` ~41, `twitter:description` ~51: “the latest billionaire 13F trades” and “a real-time portfolio tracker”. The Markets header (~2066) already says figures are not always real-time. `manifest.json` is already the honest description.
- Legal §3 ~2194–2203: the paragraph correctly says no large language model generates the commentary. The bullets still say “AI outputs may be inaccurate”, “AI does not verify”, and “verify AI outputs”.
- Non-Gold holding alerts ~4285 hardcode a blurred “Hold ·” on every ticker. It is not that holding’s suggestion. Low.

**Repro:** read those four spots while logged out.

Expected: Free copy lists Free features; 13F is described as Gold; quotes match the Markets “not always real-time” line; the legal bullets describe rule-based commentary.

**Fix direction:** Soften the founder “all free” clause and the meta “real-time / billionaire trades” lines. Rewrite the legal bullets so they describe the rule-based notes. Leave Stripe alone.

---

### 12. Low — A full page load of `#l-*` opens Legal and stays at the top of the page

**Where:** `routeFromHash` ~6722–6730 (`scrollIntoView` after `showPage`). `showPage` ~3360 calls `window.scrollTo(0,0)`. `html { scroll-behavior: smooth }` at line 83. The router runs at the bottom of the script (~6749), during first layout, and that scroll does not stick.

**Repro**

1. Open a fresh `index.html#l-no-fiduciary` (a cache-bust query is fine).
2. Wait until load plus about a second.

Expected: `#l-no-fiduciary` near the top of the viewport.

Actual: `page-legal` is active and the hash remains, but the section’s `getBoundingClientRect().top` is about **843** (the window is still at the top of Legal).

Once the app is up, the same hash works: `#l-ages` while already on Legal scrolls to top 0, and from Portfolio `#l-no-fiduciary` scrolls (top 0, `scrollY` about 853). PR #6’s “section in view” check matches that in-app path.

**Fix direction:** After `showPage`, scroll the anchor on `requestAnimationFrame` or `window` `load`, with `behavior: 'instant'`, so `scrollTo(0,0)` and the browser’s fragment scroll do not cancel it.

---

## Checked, nothing further to file

- **XSS / escape**, other than issue 4. See the sink list under that issue.
- **Hash routes**, other than issues 1 and 12. Slash, case, trailing slash, and a query on a page name normalize. Unknown hash → Home and the hash is cleared. Cold `#lesson/N`, `#/lesson/N/`, and `#LESSON/N` open the lesson (the hash is not canonicalized; it still works). `#lesson/15` (the empty slot) opens Home. `#p=` stays ignored.
- **PWA.** After one online visit, an offline reload still shows the lesson list (34 cards) and `routeFromHash`. The first `controllerchange` reloads once (`navs` length 2); it does not loop. HTML is network-first. API hosts are in `alwaysNetwork`. `CACHE` is `finpath-v17`, matching this HTML. `icon-32.png` is a favicon and is not in `SHELL`; fonts and Chart.js are runtime-cached after first use; Supabase is intentionally not precached (PR #6).
- **Mobile menu** at 390×844. Hamburger opens (`aria-expanded`, label “Close navigation menu”). Escape closes it. Enter on the first link navigates Home and closes the menu. It is a disclosure panel: no focus trap and no body scroll lock, and keyboard use still works. The outside-click listener is in source (~3341).
- **Lesson calculators.** They render on open (compound lesson: $72,000.00 in, $298,071.89 out). Empty or invalid input clamps to the low bound. No `NaN` or `Infinity` in the output. An `<img>` in the amount field does not inject. `fmt` is `en-US`. A 0% rent rate does not divide by zero.
- **Gold counts and the today’s-change modal.** 14 Gold lessons, 9 investors, and the “hour-by-hour isn’t available” copy match the code.

---

## Unverified

- A live Finnhub quote whose `dp` is actually `null` (issue 2 was reproduced with the object `fetchQ` stores).
- Two deployed service-worker caches in production. Locally, one install reloads once and then the offline shell works.
- iOS Add to Home Screen visuals and standalone display.
- Mobile-menu outside tap (the listener is present; Escape and Enter were the browser checks).
- Supabase RLS, a real Gold grant, and Stripe checkout. Left alone on purpose.
- A screen-reader pass. Contrast figures are computed colors, not a sweep of every screen.
- The `/` shortcut and Escape-on-onboarding were read on this tree and not re-fired in the browser this pass.
