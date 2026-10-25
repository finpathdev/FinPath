# FinPath scan — thesis journal, sell modal, v20 regressions

Notes only. No product code in this branch.

**Scanned tree:** `main` at `8f1dda2` (merge of PR #12, “Ask for a thesis on every paper buy…”).  
**Service worker:** `sw.js` `CACHE` is `finpath-v22`.  
**Date:** 2026-10-25.  
**Out of scope, not tested:** Stripe checkout, the Finnhub key / proxy, and any Q3 13F content.

Headless Chrome loaded this commit over `http://127.0.0.1`. Finnhub was stubbed. Service-worker registration was stubbed so the worker’s `controllerchange` reload would not interrupt the page. Payloads were a real `<img src=x onerror=…>` string, checked with `window.__xss` and with `querySelector('img')`.

## Summary for Fixer

Thesis and reflection text is escaped everywhere it is painted. The sell dialog’s own HTML is escaped. Two older `innerHTML` sinks still run a planted string: the transaction row’s share count, and the paper buy/sell toast’s ticker. Neither is reachable by typing in the thesis box or the ticker search. Two behavior bugs are in the new sell/journal flow: an in-flight confirm closes a newer sell dialog, and a second buy of the same symbol drops the new thesis from the position. PR #8 / `finpath-v20` guards that were re-checked still hold.

| ID | Severity | Area | One line |
| --- | --- | --- | --- |
| F1 | Low | Journal HTML | `fp_txns[].sh` is concatenated into `renderTxns` `innerHTML` and executes |
| F2 | Low | Sell flow | Paper sell/buy toasts put the ticker into `toast()` `innerHTML` |
| F3 | Low | Sell modal | A finished in-flight sell calls `closePaperSell()` on whatever dialog is open now |
| F4 | Low | Thesis display | Adding to a position keeps the first thesis and drops the one just required |
| F5 | Low | Sell modal focus | Escape closes the dialog and leaves focus on the hidden reflection field |

## F1 — Transaction share count is raw HTML

**Severity:** Low. Stored XSS if `fp_txns` is edited in this origin. The buy form cannot create it: share count goes through `parseFloat` and `paperBuy` rejects non-finite numbers. Thesis text in the same row is escaped. Nothing on the network writes `fp_txns`.

**Where:** `index.html`, `renderTxns`, `shTxt` (~line 6832), inserted into the buy row (~6835) and the sell/remove row (~6840). `toast` is not involved.

**Repro**

1. On the Portfolio page, in the console:

   ```js
   localStorage.setItem('fp_txns', JSON.stringify([{
     type:'buy', mode:'paper', t:'AAPL',
     sh:'<img src=x onerror=alert(1)>',
     price:10, thesis:'safe thesis', ts:Date.now()
   }]))
   ```

2. Reload, or call `renderTxns()`.
3. Look at `#txnList .txn-sub`.

**Expected:** the share count is text.  
**Actual:** the substring is a live `<img>`. In the headless run `onerror` incremented `window.__xss`, while the ticker cell was `&lt;img…&gt;` and `.txn-thesis` stayed the text `safe thesis`.

**Fix hint:** build `shTxt` with `escapeHtml` on `x.sh` (and keep `fmt` for the price) before that string is placed in `innerHTML`.

## F2 — Paper buy/sell toasts parse the ticker

**Severity:** Low. Same planted-storage class as the `fp_alerts` toast bug fixed in PR #8. `notify()` itself still escapes (re-checked below). The sell dialog does not parse the ticker.

**Where:** `index.html`

- `toast` assigns `msg` with `innerHTML` (~6359).
- `paperSell` calls `toast(…, 'Sold ' + x.t + ' — ' + …)` (~6772). `x.t` is the stored position ticker.
- `paperBuy` calls `toast(…, 'Paper-bought ' + sh + ' ' + t + ' @ ' + …)` (~6696). Search only passes a `COMPANIES` key or `/^[A-Z.]{1,6}$/`, so the buy screen cannot supply this string. The same sink fires if `paperBuy` is called with one.

**Repro**

1. Plant a paper book whose position ticker is the img payload (numeric price, any thesis, enough cash).
2. Switch to paper mode. The position row and the journal show the payload as text (`#paperGrid img` and `#thesisJournal img` stayed 0).
3. Sell → the dialog title is `textContent` (`Sell <img…>?` as characters). The thesis block has no `img`.
4. Confirm the sale once a quote returns.

**Expected:** the toast shows the ticker as text.  
**Actual:** the toast’s `innerHTML` is `Sold <img src="x" onerror=…> — profit $40.00`, and `onerror` ran. Grid, journal, and `#paperSellModal` did not parse it.

**Fix hint:** escape `t` / `x.t` before passing them to `toast`, or make `toast` escape `msg` unless the caller opts into HTML.

## F3 — In-flight sell closes a newer sell dialog

**Severity:** Low. Needs a slow quote plus Escape after Confirm, then another Sell before that quote returns. The first sale is the one the user confirmed. The second position is not sold.

**Where:** `index.html`, `paperConfirmSell` (~6727–6741) always calls `closePaperSell()` (~6720) when `paperSell` resolves true. `closePaperSell` clears `PAPER_SELL_I`, removes `open`, and wipes `#paperReflect`. The Escape listener (~5479) calls that same closer while `PAPER_SELLING` is still true, so the request keeps going.

**Repro**

1. Hold two paper names, AAPL and MSFT.
2. Sell AAPL, type a reflection, click Sell.
3. Press Escape before the quote returns. The dialog hides. The sale is still in flight.
4. Click Sell on MSFT and type a different reflection.
5. Let the AAPL quote return.

**Expected:** the MSFT dialog stays open with the draft reflection. The AAPL sale can finish on its own.  
**Actual:** AAPL is journaled with the first reflection, MSFT is still a position, and the MSFT dialog is closed with the reflection field cleared (`PAPER_SELL_I` is null). A second click on Sell during `PAPER_SELLING` is ignored, so the user cannot confirm MSFT in that window either.

**Fix hint:** pair each confirm with a token, and have the completion path close the dialog only when that token is still the open one; ignore Escape while `PAPER_SELLING` is set.

## F4 — A second buy keeps the first thesis

**Severity:** Low. Display bug, not XSS. The page tip says each paper buy asks why you are buying and that you will see that note again when you sell.

**Where:** `index.html`, `paperBuy` (~6686–6690): `if(!ex.thesis) ex.thesis = thesis`. The required textarea value is still passed to `logTxn`, which is why the transaction row shows it.

**Repro**

1. Paper-buy AAPL with thesis `FIRST thesis`.
2. Paper-buy AAPL again with thesis `SECOND thesis that should be visible`.
3. Read the position card, the Open section of the trade journal, and Sell.

**Expected:** the note from the buy you just completed is the one on the position and in the sell dialog.  
**Actual:** `pos[0].thesis`, the open journal, the card, and the sell dialog stay on `FIRST thesis`. The transaction list shows `SECOND thesis…` under that buy. Headless result: `paperBuy` returned true, weighted price moved to $110, thesis field stayed `FIRST thesis`.

**Fix hint:** decide one rule — show the latest thesis on the position, or stop requiring a new thesis when the symbol already has one — and make the sell dialog use that same string.

## F5 — Escape does not return focus

**Severity:** Low. Keyboard only. The trap works while the dialog is open.

**Where:** `index.html`, `paperAskSell` focuses `#paperReflect` (~6718). `closePaperSell` (~6720) and the Escape listener (~5479) remove `open` and do not move focus. The dialog is `.modal-overlay` / `display:none` when closed.

**Repro**

1. Open Sell on a paper position. Focus is `#paperReflect`. Tab order is field → Sell → Cancel → field. Shift+Tab from the field wraps to Cancel.
2. Press Escape.

**Expected:** focus returns to the Sell button that opened the dialog.  
**Actual:** the dialog is closed, the reflection value is cleared, `PAPER_SELL_I` is null, and `document.activeElement` is still `#paperReflect` inside the hidden dialog (`offsetParent` null). The next Tab moves to `document.body`.

Clicking the backdrop does not dismiss (same as the search and shares dialogs). After that click, Tab kept cycling inside the dialog in this run.

**Fix hint:** on close, move focus back to the Sell button for `PAPER_SELL_I` before clearing that index.

## Thesis and reflection — clean

Checked create, the stored record, and every paint site. There is no edit-after-save control. Notes are not sent to an API. There is no markdown renderer; closed notes and the sell dialog use `white-space: pre-wrap`.

| Sink | Behavior with `<img onerror>` |
| --- | --- |
| `#paperThesis` / `#paperReflect` | textarea values |
| `fp_paper.pos[].thesis`, `fp_paper.journal[]`, `fp_txns[].thesis` / `.reflection` | stored as the raw string |
| Open journal (`renderTradeJournal`, ~6615) | `escapeHtml(clipText(thesis, 120))`. `clipText` flattens whitespace first, so a multi-line note is one line until the sell dialog or a closed row |
| Position card (~6655) | `escapeHtml(clipText(thesis, 90))` |
| Sell dialog body (`paperAskSell`, ~6708) | `escapeHtml` on the thesis; shares via `escapeHtml(String(x.sh))`; cost via `fmt`. Title is `textContent` |
| Closed journal (~6623) | `escapeHtml` on thesis and reflection. P&L is rendered only when `pnl` is a finite number |
| Transaction thesis snippet (~6834) | `escapeHtml(clipText(thesis, 88))`. Reflection is stored on the txn and not painted there |

A buy and a sell typed entirely through `confirmAdd` / `paperConfirmSell` kept `window.__xss === 0` and created no `img` in the journal, the card, the dialog, or the transaction list. A breakout string `</textarea><img…><textarea>` in the reflection was text in the closed journal.

`escapeHtml` (~5432) encodes `& < > " '`.

## Sell dialog handlers — clean

`#paperSellConfirm` and Cancel use fixed `onclick` handlers. The row button is `paperAskSell(i)` with the array index, not the ticker. Confirm is single-flight via `PAPER_SELLING`. `paperSell` re-reads the book and aborts if `pos[i].t` no longer matches the ticker captured at the start of the request.

## PR #8 / finpath-v20 — no regression found

Re-checked on this commit. These are the guards from the audit fix (PR #8, cache `finpath-v20`), not new work.

| Guard | Result |
| --- | --- |
| Alert toast XSS | `notify('<img…>', '<img…>')` paints `&lt;img…&gt;`. `window.__xss` stayed 0 |
| `quoteDp` | `quoteDp({c:123.45, dp:null})` is `null` |
| Watchlist partial quote | NVDA with `{c:123.45, dp:null}` rendered `$123.45` and did not throw |
| Price alerts | A 3-day-old AAPL quote did not mark an “above $100” alert done. A second add of that same alert was blocked (`addAlertFromDetail`) |
| `#lesson/N` Back | In-page “← Back to lessons” moved `#lesson/0` to `#lessons` and removed `.active`. Cold `#lesson/2` opened that lesson. Setting `#lesson/3` left the detail open |
| Compare | Today had no `up` class. Market cap rendered `$3.80T` and `$400M` with no `up` class |
| Playground | Amount `1e20`, years `500`, rate `100000` clamped to `$50,000` / `40` / `40%`. Copy says “steady” and does not say “would have” |
| Contrast | Light `.up` is `rgb(21, 128, 61)` (5.02:1 on white). Dark `.up` is `rgb(74, 222, 128)`. New `.thesis-reflect` / `.thesis-journal-sub` use `--muted` (`#5a705d` on white, 5.37:1) |
| Start with Gold | The pricing-card button’s `onclick` is `openGoldPayment()`. This scan did not read or change the Payment Link |
| Honesty copy | Founder text still limits free lessons and practice cash, and says Investor Moves are Gold and prices show when market data is available. Meta description still says 13F filings lag by weeks. Legal §3 still says no large language model. A locked holding row has the “no recommendation yet” line and no blurred “Hold ·” |
| Cold `#l-*` | `#l-no-fiduciary` opened Legal with the heading about 103px from the top (`scroll-margin-top: 100px` is still on `.legal-section`) |

`showPage('lessons')` without `fromHash` still rewrites a `#lesson/N` hash to `#lessons` and closes the detail. That is the nav path. The hash router calls `showPage('lessons', true)`, which leaves `#lesson/N` in place. Cold load and in-page Back both matched the v20 notes.
