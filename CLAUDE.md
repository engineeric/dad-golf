# The Daddy Invitational

Website for a Ryder Cup–style golf trip between two teams of 8 friends. It has a live scoreboard, schedule, team rosters and a matchup preview tool.

- **Live site:** https://daddyinvitational.com (GitHub Pages; repo `engineeric/dad-golf`; remote name `github`; branch `main`).
- **Data:** a single Google Sheet. There is no backend, no accounts and no build step: plain HTML/CSS/ES modules.
- **Owner:** Eric, who maintains the site and the sheet and captains one team. He is not the tournament commissioner; the commissioner (someone else) picks the Tournament MVP.
- **Design:** matches his macOS draft app at `/Users/erichaslag/Developer/Apps/DaddyDraft` (`Theme.swift`).

## Working agreements

- **Commit, don't push.** Commit each finished change (with the Co-Authored-By trailer), but don't push unless asked; Eric usually pushes himself. Every push to `main` goes live within about a minute. Never force-push without explicit approval.
- **Verify in the browser before reporting done.** Use demo mode (below) and the browser pane, and check desktop, 375px mobile (no horizontal scroll) and dark mode. Screenshots often fail when the pane is hidden. When that happens, measure with `javascript_tool` (computed styles, bounding rects, innerText) instead.
- **Mock up UI ideas first.** Use the visualize `show_widget` tool, in the site's colours, and ask before building anything non-trivial. Eric iterates on mockups (names, icons, layout) before approving.
- **You cannot edit the Google Sheet.** The Drive connector is read-only for cells, and the browser pane isn't signed in to Google; never sign in for him.
  - Every sheet change goes into `tools/setup-sheet.gs`. Eric pastes it into Extensions → Apps Script and runs `setupSheet`.
  - Give him `pbcopy < tools/setup-sheet.gs` to copy it.
  - The script must stay **idempotent**: create missing tabs and columns, never overwrite data.
- **Privacy: players are nicknames only.** The Players tab has no full-name column, and full names must never appear in the repo, the site or commit messages. Git history was rewritten once to remove them.
- **Results appear only on the Scoreboard.** That covers match results and hole-prize winners. Schedule shows matchups, tee times and prize holes, never outcomes.
- **Team names are never hard-coded.** Code uses sides `red`/`blue`; names come from Settings. The same goes for the edition numeral ("IV"), so the site can be reused next year by copying the sheet.

## Running locally

```bash
python3 tools/serve.py        # http://localhost:8765, sends Cache-Control: no-store
```

Use this server rather than `python3 -m http.server`, whose browser caching mixed stale JS with fresh HTML. The browser-pane launch config is `.claude/launch.json` (gitignored), named `site`; it runs the same command.

**Demo mode** (localhost only; ignored in production): append `?demo=<scenario>` to any page.

| Scenario | State |
|---|---|
| `countdown` | Tee sheets posted, round 1 in 10 days, live countdown |
| `day1` | Day 1 complete (standings and awards appear), day 2 tee sheet |
| `midway` | Two days complete, day 3 tee sheet, prizes for days 1–2 |
| `final` | All 16 matches, Team Eric wins (trophy), MVP = JD, day cards collapse |

- Add `&hcp=index` to use handicap index; demos default to course handicaps.
- Fixture data lives in `demo/data.js` and uses the real nicknames.
- `withDemo()` in `js/ui.js` carries the query string across nav links.
- For one-off fixtures, temporary `_stub.js` + `_test-*.html` files that override `window.fetch` also work. Delete them before committing.

## Files

| File | Role |
|---|---|
| `index.html` + `js/scoreboard.js` | Scoreboard: banner/countdown, hero score, Tournament MVP card, day cards with match rows, strokes and hole prizes, then player standings and awards |
| `schedule.html` + `js/schedule.js` | Per-day course info, map embed, directions, QR "send to phone", prize holes, tee sheet, "Find me", calendar export |
| `teams.html` + `js/teams.js` | Rosters by flight, captains, average handicap index |
| `matchups.html` + `js/matchups.js` | Lineup preview for Matched / Mixed / Singles, with team handicaps and strokes; state is kept in the URL hash |
| `js/sheet.js` | Fetches and normalizes the sheet tabs, and handles demo mode |
| `js/golf.js` | Pure rules: formats, handicaps, scoring, standings, awards, `buildDays` |
| `js/ui.js` | Header/footer chrome, `esc`, chips, icons (trophy, star, flag), `applyEdition`, `withDemo` |
| `js/calendar.js` | `.ics` generation with an America/Chicago VTIMEZONE, and Google Calendar links |
| `js/vendor/qrcode.js` | qrcode-generator (MIT), vendored |
| `css/theme.css` | Design tokens, light/dark mode, shared components |
| `tools/setup-sheet.gs` | Apps Script that sets up or migrates the sheet |
| `tools/serve.py` | Local server with caching disabled |
| `CNAME` | Custom domain file, committed by GitHub. Don't delete it. |

## Google Sheet (the only data source)

- **Sheet ID:** `1e_PIxZAjMYLLzAvzeEaWkSR-L7PKB_KzsxhkDPi71oQ`, in `js/sheet.js`. It is shared as "anyone with the link can view".
- **How it's read:** the site fetches `gviz/tq?tqx=out:csv&headers=1&sheet=<Tab>` (CORS works) and matches columns by **normalized header name**, so column order doesn't matter.

| Tab | Columns | Notes |
|---|---|---|
| Players | Nickname, Handicap Index, Team, Flight, Captain | Flight is A or B. Captain is a checkbox. |
| Matches | Round, Tee Time, Red 1, Red 2, Blue 1, Blue 2, Winner, Result | Winner is a team name or Halved; blank means not played. Result is like `3&2`, `2 UP` or `Halved`. Singles leave the "2" columns blank. Rows with the same round and tee time form one group. |
| Schedule | Round, Format, Date, Course, Course URL, Address, Tees, Yardage, Par, Rating, Slope, Notes | Format is Matched, Mixed or Singles, one per day. Date is `yyyy-mm-dd`. Address may contain a line break. |
| Prizes | Round, Hole, Prize, Winner | Hole prizes. Winner stays blank until awarded. |
| Settings | Edition, Red Team, Blue Team, Lower %, Higher %, Timezone, Round Minutes, MVP, Handicap | **One header row and one value row**, not key/value pairs (see gotchas). Handicap is `Index` or `Course`. |

**gviz gotchas:**
- **Missing tabs:** asking for a tab that doesn't exist silently returns the *first* tab. `fetchTab(name, requiredHeaders)` treats a tab without its required headers as missing.
- **Mixed-type columns:** gviz drops minority-type values in a column that mixes numbers and text. That's why Settings is one row with typed columns.
- **Formatted values:** dates and times arrive in their display format. `parseDate` and `parseTime` accept several formats.

**Apps Script gotchas:**
- **Inserted columns copy validation:** `insertColumnAfter` copies the left neighbour's data validation and formatting, so `ensureColumn` clears both.
- **No UI outside the open sheet:** `SpreadsheetApp.getUi()` throws when the script isn't run from the open sheet, so `getUi()` returns null and the script logs instead.

## Tournament rules (as implemented)

**Event structure**
- **Format:** 3 days, 16 matches, 1 point each (½ for a halve). 8½ wins.
  - **Matched:** 2v2 with AA and BB pairs, 4 matches.
  - **Mixed:** 2v2 with AB pairs, 4 matches.
  - **Singles:** 1v1, 8 matches, any player against any player.
- **Day for each format:** set by the Schedule `Format` column, not fixed in code. Matchups finds the course for a format by matching the day's Format.

**Handicaps**
- **2v2 team handicap:** `lowerPct × lower + higherPct × higher` (35% / 15%, from Settings).
- **Strokes:** `Math.round(|a − b|)` of the side handicaps.
- **Rounding:** `round1()` rounds to 3 places first, to avoid float misses like 4.1499999 → 4.1.
- **Course handicap mode** (Settings `Handicap = Course`):
  - Formula: `round(Index × Slope / 113 + (Rating − Par))`, using that day's Schedule row.
  - It's used by Scoreboard strokes, awards and the Matchups preview.
  - A day missing slope, rating or par falls back to index, and the page says so.
  - The Teams page always shows index.

**Margins and standings**
- **Margin parsing** (`parseMargin`): `4&3` → 4, `2 UP` → 2, `Halved`/`AS` → 0. Anything unrecognised is null; it still counts for points but is excluded from Net.
- **When standings appear:** only once a day is complete, meaning every expected match has a Winner.
- **Ranking:** points, then Net, the sum of a player's margins. Partners share a 2v2 result.

**Awards**
- **Points leader:** top rank; ties are listed.
- **Locked in:** won every match played, with at least 2 wins.
- **Biggest win:** the widest winning margin.
- **Toughest loss:** the other side of the Biggest win match.
- **Stroke killer:** won while *giving* the most strokes. If nobody did, the card becomes **Against the odds**, the win that *received* the most strokes.
- **Tournament MVP:** the commissioner's pick from Settings `MVP`. It's shown as its own card only when set; it isn't highlighted in the table.

**End of tournament**
- A team reaching 8½ gets the gold "Ryder" trophy SVG on its hero card.
- When all 16 matches are final, the day cards collapse into `<details>`.

## Design system

- **Tokens:** defined in `css/theme.css`, ported from `Theme.swift`.
  - navy `#0d1c38`, cream `#f5f0e6`, gold `#cca65c`, ink `#121a2e`
  - team red `#b01230`, team blue `#0d3d94`
- **Type:** serif headings (`ui-serif`/New York), system sans for body text, and uppercase letter-spaced "eyebrow" labels.
- **Dark mode:** always follows the system, via `prefers-color-scheme`; there's no toggle. Theme-dependent tokens (`--bg`, `--surface`, `--cream`, `--ink`, `--fg-red/blue`, …) flip in dark mode; brand colours don't.
- **iOS safe areas:** `viewport-fit=cover`. `html` and `body` are **navy** because iOS Safari tints the status bar and home-indicator areas from the body background. `main` carries the page colour, with full-bleed padding.
- **Alignment details** that were deliberately tuned (don't regress them):
  - Tee-sheet player chips have equal widths, and "VS" is optically centred: its padding offsets the trailing letter-spacing, and a singles card sits next to "VS".
  - Day scores sit in fixed-width columns.
  - The countdown labels never wrap.
- **Icons:** the trophy is a custom single-tone SVG chosen from mockups, not a stock icon.
- **Copy:** sentence-case UI text and short labels.

## Deployment notes

- **GitHub Pages caching:** Pages serves with `max-age=600`, so phones can show stale CSS/JS for up to 10 minutes after a push; suggest a private tab to check. Assets have no cache-busting.
- **Custom domain DNS:** Squarespace DNS has apex A/AAAA records pointing to GitHub Pages, `www` as a CNAME to `engineeric.github.io`, and a `_github-pages-challenge-engineeric` TXT verification record.
