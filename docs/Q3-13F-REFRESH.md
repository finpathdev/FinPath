# Q3 2026 13F refresh checklist

Do this only after the real Form 13F-HR filings are on EDGAR. Q3 2026 ended September 30, 2026. The usual deadline is 45 days later, **November 16, 2026** (a Monday). Until a filing is on EDGAR, leave `MOVES` on Q2 2026. Do not draft, estimate, or “preview” Q3 positions from letters, interviews, 13D/13G filings, or last quarter’s trend.

The app still shows Q2 on purpose. `F13.nextDue` is `2026-11-16`. After that date the freshness line and the landing note say Q3 is due and that the cards are still Q2 until someone reviews them.

## Where the data lives

All of it is in `index.html`.

- `MOVES` — one object per card. Fields: `investor`, `stock`, `ticker`, `action`, `amount`, `date`, `notes`, `photo`. The comment above each investor block has the CIK and the filing total.
- `INVESTORS` — derived from `MOVES`. Do not hand-edit the list.
- `F13` — `{quarter, asOf, filed, nextQuarter, nextDue}`. The freshness line, source line, filing-lag timeline, and the post-deadline landing note all read this object.
- `moveActionKind` / `getActionBadge` — classify `action` in this order: `sold out`, `put`, `buy`, starts with `new`, `add`, `hold`, otherwise `reduce`. Puts and “New …” rows (spin-offs) stay under **All actions**. They are not Buy.

`amount` shapes the card already understands:

- `$37.8B — 12.62%` → dollars, then “% of portfolio”
- `$0 (was $94.9M)` → sold out
- `$242M notional` → option row, not shares owned

“% of portfolio” is reported value ÷ that filer’s **long-equity** total. Leave put and call rows out of the denominator.

## Verify each CIK on EDGAR

Open the filer’s EDGAR page, form type **13F-HR**, and confirm the **period of report is 2026-09-30** before changing a number. Compare share counts to that same filer’s own Q2 table (period 2026-06-30), not to a different reporting entity.

| Investor on the card | Filer | CIK | Q2 note |
| --- | --- | --- | --- |
| Warren Buffett | Berkshire Hathaway | 1067983 | 13F total $299.25B |
| Bill Ackman | Pershing Square Inc. | 2026053 | 13F total $19.47B. Q2 was compared with Q1 Pershing Square Capital Management, CIK 1336528, because the book moved. Check which entity filed Q3. |
| David Tepper | Appaloosa | 1656456 | Long equity $7.47B. The 13F total including puts was $7.73B. |
| Stanley Druckenmiller | Duquesne Family Office | 1536411 | Long equity $4.35B. 13F total including calls was $5.21B. Q2 info-table values were in **thousands** of dollars. Re-read the Q3 column before scaling. |
| Li Lu | Himalaya Capital | 1709323 | 13F total $3.70B |
| Seth Klarman | Baupost Group | 1061768 | 13F total $5.42B. Q2 info-table values were in **thousands**. Re-read the Q3 column before scaling. |
| Bill Gates | Gates Foundation Trust | 1166559 | 13F total $34.42B. This is the foundation trust, not a personal account. |
| Chase Coleman | Tiger Global Management | 1167483 | Equity $23.98B |
| Terry Smith | Fundsmith LLP | 1569205 | Equity $13.65B. Do not also add Fundsmith Investment Services Ltd (CIK 1868537); that was a second entity over the same names. |

Useful EDGAR path: `https://www.sec.gov/edgar/browse/?CIK=<cik>&owner=exclude`, then the 13F-HR information table. A blog or holdings tracker is a cross-check, not the source. If EDGAR has no 13F-HR for that period, do not add the row.

## Copy that names the quarter or the investor count

These strings are hardcoded. `INVESTORS.length` / `MOVES.length` / `F13` already cover the paywall, the portfolio check-up line, the source line under the grid, and the timeline. Update the rest if the count or the quarter changes:

- Hero paragraph (“9 legendary investors”) and `#heroStat3` (`9`)
- How-it-works step 3, the Investor Moves feature card, both pricing bullets
- Gold hero: “9 legendary investors … (Q2 2026)”
- Landing subtitle `#landing13fNote` (the static Q2 sentence; the overdue sentence is built from `F13`)
- Landing preview cards in `.investor-grid` — four real rows, not generated from `MOVES`: Buffett / GOOGL Add 83% $37.8B, Ackman / V Buy $1.12B, Tepper / AMZN Add 15.7% $1.19B, Druckenmiller / NTRA Add 4% $865M. Replace a card only with a row you actually put in `MOVES`.
- `AI_INSIGHT`: `MSFT`, `GOOGL`, `AMZN`, `META` cite Q2 facts
- `AI_ADVISOR`: `GOOGL`, `AMZN` cite Q2 facts
- Lesson **What Billionaires Actually Invest In** — one Q2 paragraph per manager

Search the repo for `Q2 2026` and `9 legendary` before you ship.

## After the data change

1. Bump `CACHE` in `sw.js` (this UX pass is `finpath-v19`, after the Markets pass at `finpath-v18`; the refresh needs the next name, e.g. `finpath-v20`).
2. `node --check` the inline scripts you touched, and `sw.js`.
3. Add a short note to `FIXES-NOTES.md`: which filings you opened, what you changed, and what you left out.
4. Confirm the Gold grid still defaults to non-Hold moves, Show holds still reveals Holds, and Buy / Add / Reduce / Sold out still combine with the investor tabs.

## Do not invent

- No Q3 (or later) row, dollar figure, percent, or “he probably sold” note without that quarter’s information table.
- A letter or a 13F-NT is not a holdings table. Post-quarter trades wait for the next 13F. (Ackman’s Aug 12, 2026 letter named Alcon and ICE; they were not in the June 30 filing and they are not cards.)
- Do not relabel a put, a call, or a spin-off as Buy.
- Do not touch Stripe, pricing logic, auth, the Finnhub key, or `COMPANIES` / `SECTORS` / `POP`. A card can show a ticker that is not in the market universe; track search already accepts a typed symbol. Universe edits belong to the stocks owner.
- Do not add a manager just to raise the count. Q2 left out Burry (no 2026 13F-HR), Bridgewater, Oaktree, Pabrai, and the second Fundsmith entity for the reasons in `FIXES-NOTES.md`.
