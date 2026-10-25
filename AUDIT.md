# FinPath audit notes (read-only)

Audited tree: `origin/main` at `5d88f0b` ("Mobile + PWA polish… sw nav cache (finpath-v12)"), 2026-10-25.

This pass did not change product code. Stripe, payments, and billing were not reviewed and were not edited. Repros below were run in headless Chrome 156 against a local static server of this commit, unless a row says "code only".

Recent commits on `main` already fixed several items that are easy to re-file. Do not redo these:

- Goal names and transaction/alert/paper tickers go through `escapeHtml` (`00ac11f`).
- News and "why it moved" links go through `safeUrl` (`74da893`, still present).
- Escape closes the shared-portfolio overlay (`.modal-overlay.open:not([id])`).
- Primary nav anchors are `role="button"` `tabindex="0"`, and Enter activates them (verified: focus lands, Enter opens Gold).
- `beforeinstallprompt` no longer increments `fp_visits` on every fire.
- Service worker stores HTML under one cache key (`./index.html`) instead of every query string, and it will cache Google Fonts CORS responses.

---

## 1. High — Blocked or offline Supabase script aborts boot

**Where:** `index.html` `supabase.createClient` (~4254). Everything after that line in the same classic script never runs, including the offline bar (~5092), the key handlers (~4852, ~5059, ~5120), `routeFromHash` (~6414), `handleSharedLink()` (~6411), and the initial `renderLessons()` (~6428). `sw.js` does not precache `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` (and `jsdelivr.net` is not in `alwaysNetwork`).

**Repro:**

1. Load the app once online so the service worker can cache the shell (or just load `index.html` with the CDN blocked; the throw happens either way).
2. Block `cdn.jsdelivr.net` (and, offline, the script simply fails).
3. Open `index.html#lessons`.

**Expected:** Lessons open. The offline bar says lessons, the glossary, and the saved portfolio still work.

**Actual (headless):** `ReferenceError: supabase is not defined`. The visible page stays `page-home` while the URL is `#lessons`. `#lessonsGrid` has 0 cards. `#liveActivityText` stays "Loading recent activity…". `.offline-bar` is never created. `showPage` still exists (function declarations are hoisted), so a later click on Lessons does render the 34 cards. Deep links, share links (`#p=`), theme restore, auth init, and keyboard shortcuts do not run.

**Fix direction:** Guard `supabase.createClient` (skip auth when the global is missing) and move routing, `renderLessons()`, and the offline bar above that call or into their own script.

---

## 2. Medium — Home ticker tape assigns localStorage HTML

**Where:** second inline script, `fp_tape_row` read (~6451–6453) and write (~6466). `escapeHtml` is not used.

**Repro:**

1. In the console on the FinPath origin: `localStorage.setItem('fp_tape_row', '<img src=x onerror="window.__tape=1">')` and `localStorage.setItem('fp_tape_at', String(Date.now()))`.
2. Reload the home page. Block Finnhub if you want the cache to stick for the full 5 minutes; a fresh timestamp already returns before the network refresh.

**Expected:** The tape shows ticker text, or ignores a cache value that is not a known-safe row.

**Actual (headless):** `window.__tape === 1` and `#tapeTrack` contains the injected `<img>`. The payload runs on every home visit until the cache is older than 5 minutes and a successful quote refresh overwrites it.

**Fix direction:** Build the tape with `textContent` / `escapeHtml`, and do not `innerHTML` the stored string.

Related low sink, same idea: `renderWatchlist` (~4767) concatenates `fp_watch` tickers into HTML and attribute handlers with no `isValidTicker` check on read. A poisoned watchlist entry can break out of the markup. UI search only inserts `/^[A-Z.]{1,6}$/` or `COMPANIES` keys, so this needs a localStorage write.

---

## 3. Medium — Earnings rows print API fields as HTML

**Where:** `loadEarnings` (~6076–6092). `x.symbol`, `x.date`, `x.hour`, and `x.epsEstimate` are concatenated into `innerHTML`. News headlines in the same file already use `escapeHtml` / `safeUrl`.

**Repro (code; not poisoned against live Finnhub):** If any earnings row has `symbol` (or `date` / `hour`) equal to `<img src=x onerror=alert(1)>`, `earnList.innerHTML = items.map(...)` runs it for every visitor of Markets. `hour.toUpperCase()` also throws if `hour` is a non-string, and the `catch` replaces the whole calendar with "couldn't be loaded" even when other rows were fine.

**Expected:** Symbols and dates are text. A bad field drops that row.

**Actual:** The fields are treated as HTML.

**Fix direction:** Pass symbol, date, hour, and the EPS value through `escapeHtml` (and only call `toUpperCase` on strings).

---

## 4. Medium — Hash router only accepts an exact page name

**Where:** `ROUTES` and `routeFromHash` (~3242, ~6414–6425). `showPage` (~3243). Manifest shortcuts correctly use `./#portfolio` (those work).

**Repro:**

1. Open `index.html#/portfolio`.
2. Open `index.html#portfolio` (this one works), then change the hash to `#lessons/` or `#l-no-fiduciary` and press Enter.
3. Also try `#Lessons` and `#portfolio?x`.

**Expected:** `#/portfolio` opens Portfolio (slash form is what many shared links use). A trailing slash or different case still resolves. An unknown hash shows a not-found state or opens Legal and scrolls to `l-no-fiduciary`.

**Actual (headless):** `#/portfolio` leaves `page-home` active. After a successful `#portfolio`, changing the hash to `#lessons/` or `#l-no-fiduciary` does not navigate: the previous page stays up and the URL lies. `routeFromHash` returns when `ROUTES.indexOf(p) < 0`. There is no empty/404 state. Legal section ids in the page (`l-no-fiduciary` and the other `l-*` anchors) are unreachable by hash.

**Fix direction:** Normalize the hash (`replace(/^\/+|\/+$/g,'').split(/[?#]/)[0].toLowerCase()`) before the `ROUTES` check, and if it still misses, show a one-line unknown-link state instead of leaving the old page up.

---

## 5. Medium — Browser Back from an open lesson leaves Lessons

**Where:** `openLesson` (~3502) never calls `pushState`. `closeLessonDetail` (~3533). `showPage('lessons')` does call `closeLessonDetail` (~3256), so the nav click path is fine. `routeFromHash` bails out when that page is already active (~6420), so it will not close a lesson either.

**Repro:**

1. Open Lessons (`#lessons`). Note history.
2. Open any lesson. The URL stays `#lessons`. The list is `display:none`.
3. Press the browser Back button.

**Expected:** Back returns to the lesson list.

**Actual (headless):** Back goes to the previous history entry (home, hash cleared). `page-home` is active, but `#lessonDetail` stays `.active` and the list stays `display:none` until something later calls `showPage('lessons')`. There is still no `#lesson/<id>` to copy or restore.

**Fix direction:** `pushState` a lesson hash when opening, and have `routeFromHash` call `closeLessonDetail` when the hash is plain `#lessons`.

---

## 6. Medium — "/" shortcut is swallowed, and it fails inside a lesson

**Where:** keydown handler ~5120–5128.

**Repro:**

1. On Home, press `/`.
2. Open a lesson (list hidden), then press `/` again.

**Expected:** On Home, `/` does nothing and is not cancelled (Firefox uses `/` for quick find). Inside a lesson, `/` does not steal the key, or it focuses a visible search field.

**Actual (headless):** The handler always `preventDefault`s unless the key is modified or focus is an `INPUT`/`TEXTAREA`. On Home, search does not open (`searchModal` stays closed) and the event is cancelled. Inside a lesson, `page-lessons` is still active so it calls `lessonSearch.focus()`, but that input sits in `#lessons-list-view` which `openLesson` set to `display:none`. Focus does not move (`activeElement` stays `body`) and the key is still cancelled. `SELECT` is not excluded either.

**Fix direction:** Only `preventDefault` when a visible target exists; if the lesson detail is open, return without focusing `#lessonSearch`.

---

## 7. Medium — Enter/Space on an investor move card fires twice and looks dead

**Where:** `renderMoves` inline `onkeydown` (~3588) calls `toggleMoveCard`. The document handler (~5059) then `click()`s every `role="button"` that is not a native control, which runs the card's `onclick` (`toggleMoveCard`) again. `preventDefault` does not stop the event from reaching `document`.

**Repro:**

1. Set `IS_GOLD = true` and call `renderGold()` (or use a Gold account).
2. Focus a `.move-card` and press Enter.

**Expected:** The card expands (`aria-expanded="true"`, `.expanded`).

**Actual (headless):** `toggleMoveCard` runs twice. The card ends collapsed (`expanded: false`). Keyboard users see a control that does nothing. Click still works (one toggle). Glossary terms are special-cased in the document handler and are fine. Nav links have no inline `onkeydown`, so they only fire once (verified).

**Fix direction:** Remove the inline `onkeydown` and let the document handler be the only Enter/Space path, or `stopPropagation` in the inline handler.

---

## 8. Medium — Escape does not close onboarding or install help

**Where:** Escape handler ~4852–4870 closes the named modals, the login dialog, the phone menu, the user menu, and id-less `.modal-overlay.open` nodes. It does not know `.ob-overlay` (`initOnboarding`, ~5157) or `#installHelpModal` (`showInstallHelp`, ~6594). The comment says it closes any open layer.

**Repro:** Clear `localStorage.fp_onboarded`, reload, and press Escape when the welcome tour is up. Or open the install-help dialog (`triggerInstall()` with no deferred prompt) and press Escape.

**Expected:** The dialog closes, same as the search modal.

**Actual (headless, onboarding):** `.ob-overlay` is present before and after Escape. The tour is `role="dialog"` `aria-modal="true"`.

**Fix direction:** On Escape, remove `.ob-overlay` (and mark `fp_onboarded`) and call `closeInstallHelp()`.

---

## 9. Medium — Search says "No matches" when every quote fails

**Where:** `loadSearchResults` (~3898) does `quotes.filter(x => x.q)` and `renderSearchResults` (~3905) uses one empty string for both "nothing matched" and "nothing loaded". `handleSearch` (~3919 area) does keep rows and can say "Price unavailable". Initial open does not.

**Repro:** Block `finnhub.io`, clear `localStorage.fp_pricecache` (and in-memory `priceCache`), open Portfolio, click "+ Add stock".

**Expected:** "Market data unavailable" (the same idea as the pulse empty state), with last-known prices if any exist.

**Actual (headless):** "No matches. Try a ticker like AAPL, UBER or BTC." None of those fetches have a timeout, so a hung quote also leaves the six skeleton rows up (`Promise.all` in `loadSearchResults`). Same hang shape in `renderPulse`, `renderHeatMap`, `loadNews`, and `loadEarnings` (code only; not held open in this pass).

**Fix direction:** If every `fetchQ` returns null, show the market-data empty copy; keep the "No matches" string for a real query miss.

---

## 10. Medium — A failed dividend lookup is described as "no dividends"

**Where:** `renderDividends` (~6331–6346), called from `renderAnalytics` (~4816) without `await`. `fetchMetrics` failure becomes yield `0`. If every holding is `0`, the card says none of them pay a dividend.

**Repro:** Put AAPL (or any dividend payer) in the portfolio, block `finnhub.io` or the `/stock/metric` call, clear `fp_metric_cache`, open Portfolio, wait for the dividend card under sector allocation.

**Expected:** "Dividend data unavailable" when `fetchMetrics` returns null. "None of your holdings pay a dividend yet" only when a real yield of 0 came back.

**Actual:** Null metrics and a true zero yield share one sentence, and it names the Understanding Dividends lesson as if the portfolio simply has no payers. (The headless check confirmed the branch: `y` is 0 when `met` is null, and `!annual` writes that sentence. Read the card after `renderDividends` settles; `renderPortfolio` does not await it.)

**Fix direction:** Track whether any metric request failed, and use a different sentence in that case.

---

## 11. Low — Empty lesson slot makes "you finished the playbook" unreachable

**Where:** stray comma in `LESSONS` at ~2698 (index 15 is empty; `LESSONS.length` is 35; `filter(Boolean)` is 34). `lessonOrder` skips the hole, so the grid still renders 34 cards (headless: label "0 of 34 lessons completed"). `checkGraduateComplete` (~3383) compares completion count to `LESSONS.length` (35). `renderCertificateCTA` (~3287) is never called.

**Repro:** Complete all 34 visible lessons. The progress label can reach "34 of 34". The toast "You finished the entire Financial Playbook!" never runs, because `done >= 35` is impossible from the UI. The milestone certificate card in `renderCertificateCTA` never appears.

**Expected:** Finishing the 34th visible lesson runs the full-playbook toast and the certificate card.

**Actual:** The toast threshold counts the hole. Free-lesson graduation (`checkGraduate`) uses `filter` and can still show its button.

**Fix direction:** Compare against `LESSONS.filter(Boolean).length` (do not delete the hole without a progress-index migration; saved lesson indexes after 15 would shift). Call `renderCertificateCTA` from `updateLessonProgress`, or delete it if the `certBtn` path is the one you want.

---

## Focus-area checklist

### XSS / unsafe HTML or URL

Findings 2 and 3. Also finding 2's watchlist note.

Checked, nothing further found: portfolio rows, goals, alerts, transactions, paper positions, 13F move cards, shared-portfolio import list, news URLs/images, and company-news URLs all escape or allowlist. `runAI` no longer appends the instruction box into HTML. Lesson body text has no raw `<`. `safeUrl` rejects `javascript:` and `data:`.

### Keyboard

Findings 6, 7, and 8.

Checked, nothing further found: Enter on the email field submits login. Enter/Space on nav links opens the page (verified Gold). Glossary `.term` chips are handled once. Escape closes search/shares/hourly/detail/login/phone menu/user menu and the shared-portfolio overlay.

### Hash routes

Findings 4 and 5. Finding 1 makes every hash a no-op when the Supabase script did not load.

Checked, nothing further found: `#portfolio`, `#lessons`, `#gold`, `#markets`, `#legal`, `#home`, and an empty hash route. `#p=` is left for `handleSharedLink` and is not overwritten by `showPage`.

### PWA / service worker

Finding 1 is the user-visible offline bug.

Checked, nothing further found: `sw.js` (`finpath-v12`) is network-first for navigations, does not cache Finnhub/Supabase/Stripe responses, deletes other cache names on activate, and stores the fresh HTML document under `./index.html` only. An infinite reload loop is not in the source. `install` calls `skipWaiting`, and the page reloads once on `controllerchange`; that is one reload per new worker, not a loop. I did not publish two deploys to watch it. Same-origin images stay cache-first until `CACHE` changes; recent commits have been bumping that string.

### Empty states

Findings 9, 10, and 11. Finding 1 also leaves "Loading recent activity…" up and the lessons grid empty on a `#lessons` deep link.

Checked, nothing further found: portfolio, paper, goals, transactions, screener, pulse, heat map, and news each have a real empty or error string when their data is missing or the request rejects. The lessons grid is not blank in the online case (34 cards; the hole is skipped by `map`/`forEach`).

---

## Not verified

- Live Finnhub earnings payloads (finding 3 is the sink, not a captured response).
- A request that never settles (skeletons in search/pulse/heat/news/earnings). Logic only.
- Service-worker update behavior across two deployed cache versions.
- iOS Add to Home Screen tip, and standalone display mode.
- Supabase RLS, the `gold_users` / `payments` tables, and whether a real checkout grants Gold.
- Stripe. Left alone on purpose: `openGoldPayment` still points at a test Payment Link, and that was not investigated.
