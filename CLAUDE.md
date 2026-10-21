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
| `countdown` | Tee sheets posted, round 1 in 10 days ("10 days to go") |
| `teeoff` | Day 1 live: two matches with scores, two still showing tee times |
| `day1` | Day 1 complete (standings and awards appear), day 2 tee sheet |
| `midway` | Two days complete, day 3 tee sheet, prizes for days 1–2 (shows "Live" once day 3's first tee time has passed) |
| `live` | Day 3 live: finals, a halve, live leads and AS, Projected line showing |
| `final` | All 16 matches, Team Eric wins (trophy), MVP = JD, day cards collapse |
| `tied` | All 16 matches, 8–8, no tiebreak winner yet ("Final · Tied", rule shown) |
| `tiebreak` | 8–8, Tiebreak Winner = Garrett with a note (trophy on red) |
| `holes` | Like `live`, but every score comes from the Scores tab (Hole Entry On); Keep score button shows |
| `tiedholes` | 8–8 with every hole entered: the computed tiebreak shows as "pending verification" |

- Add `&hcp=index` to use handicap index; demos default to course handicaps.
- Fixture data lives in `demo/data.js` and uses the real nicknames. The live scenarios shift that day's tee times to just before now.
- `withDemo()` in `js/ui.js` carries the query string across nav links.
- **Score page demo** (`score.html?demo=holes`): sign in with `<nickname>@anything` (e.g. `taylor@demo`); Eric is admin. Entries are saved in `localStorage` (`demo.scores.<scenario>`) and show on the demo Scoreboard. Set `localStorage['demo.offline'] = '1'` to simulate no signal.
- For one-off fixtures, temporary `_stub.js` + `_test-*.html` files that override `window.fetch` also work. Delete them before committing.

## Files

| File | Role |
|---|---|
| `index.html` + `js/scoreboard.js` | Scoreboard: banner, hero score, Tournament MVP card, day cards with match rows, strokes and hole prizes, then player standings and awards |
| `schedule.html` + `js/schedule.js` | Per-day course info, map embed, directions, prize holes, tee sheet, "Find me", calendar export |
| `teams.html` + `js/teams.js` | Rosters by flight, captains, average handicap index |
| `matchups.html` + `js/matchups.js` | Lineup preview for Matched / Mixed / Singles, with team handicaps and strokes. The default view, on every screen, is one round at a time: a format toggle, a totals card and a card per match with drop-downs. From 1100px wide, a "One round / All rounds" toggle offers an optional board of all three rounds as columns in schedule order, where players are cards (choosing a slot opens a tray of that team's players in that flight, and picking one moves on to the next empty slot). The board is kept in the URL hash as `v=all` and ignored on narrower screens. Official matchups from the Matches tab are locked in; the rest is editable. Opponents already met in another round are disabled, and the fill buttons retry until they find a lineup with no rematches. All three lineups are kept in the URL hash. |
| `score.html` + `js/score.js` | Keep score: sign-in by emailed link, the player's match as a scorecard (+ won, − lost, 0 halved, gold stroke dots, running Up row), result buttons, offline queue. Admins get a match picker. Not in the nav; reached from the Scoreboard's Keep score button. |
| `sw.js` | Service worker, scope `score.html` only: network first, cached copy when offline (6s timeout) |
| `js/sheet.js` | Fetches and normalizes the sheet tabs, and handles demo mode |
| `js/golf.js` | Pure rules: formats, handicaps, scoring, standings, awards, `buildDays` |
| `js/ui.js` | Header/footer chrome, `esc`, chips, icons (trophy, star, flag), `applyEdition`, `withDemo` |
| `js/calendar.js` | `.ics` generation with an America/Chicago VTIMEZONE, and Google Calendar links |
| `css/theme.css` | Design tokens, light/dark mode, shared components |
| `tools/setup-sheet.gs` | Apps Script that sets up or migrates the sheet |
| `tools/score-app.gs` | Apps Script web app (same project): emails sign-in links, saves hole results. Also `setupPrivateSheet` and `sendTestLink`. |
| `tools/serve.py` | Local server with caching disabled |
| `CNAME` | Custom domain file, committed by GitHub. Don't delete it. |

## Google Sheet (the only data source)

- **Sheet ID:** `1e_PIxZAjMYLLzAvzeEaWkSR-L7PKB_KzsxhkDPi71oQ`, in `js/sheet.js`. It is shared as "anyone with the link can view".
- **How it's read:** the site fetches `gviz/tq?tqx=out:csv&headers=1&sheet=<Tab>` (CORS works) and matches columns by **normalized header name**, so column order doesn't matter.

| Tab | Columns | Notes |
|---|---|---|
| Players | Nickname, Handicap Index, Team, Flight, Captain | Flight is A or B. Captain is a checkbox. |
| Matches | Round, Tee Time, Red 1, Red 2, Blue 1, Blue 2, Leader, Up, Thru, Match | Match is 1..N per round (setupSheet fills blanks in tee order) and keys the Scores tab. Leader/Up/Thru is Eric's manual score: Leader is a team name or AS, Up is holes up (blank for AS), Thru is holes played. When Thru is filled it overrides hole entries; blank means use Scores. The final result is derived (see Live scoring); there are no Winner/Result columns. Singles leave the "2" columns blank. Rows with the same round and tee time form one group. |
| Course Holes | Round, Hole, Par, Stroke Index | 18 rows per round, from each course's official card (men's handicap row). Drives stroke dots on score.html. |
| Scores | Round, Match, Hole, Result, Updated, By | Written by the web app: Result is a team name, Halved, or blank (cleared). Updated is ms since 1970 from the entering phone; the newest entry per hole wins. Eric corrects results here directly. Ignored while Hole Entry is Off. |
| Updates | Time, By, Round, Match, Hole, Result | Log of every web-app entry |
| Schedule | Round, Format, Date, Course, Course URL, Address, Coordinates, Tees, Yardage, Par, Rating, Slope, Notes | Format is Matched, Mixed or Singles, one per day. Date is `yyyy-mm-dd`. Address may contain a line break. Coordinates is `lat, long` text (optional); it pins the course in Apple Calendar events. |
| Prizes | Round, Hole, Prize, Winner | Hole prizes. Winner stays blank until awarded. |
| Settings | Edition, Red Team, Blue Team, Lower %, Higher %, Timezone, Round Minutes, MVP, Handicap, Tiebreak Winner, Tiebreak Note, Hole Entry, Score App URL | **One header row and one value row**, not key/value pairs (see gotchas). Handicap is `Index` or `Course`. |

**gviz gotchas:**
- **Missing tabs:** asking for a tab that doesn't exist silently returns the *first* tab. `fetchTab(name, requiredHeaders)` treats a tab without its required headers as missing.
- **Mixed-type columns:** gviz drops minority-type values in a column that mixes numbers and text. That's why Settings is one row with typed columns.
- **Formatted values:** dates and times arrive in their display format. `parseDate` and `parseTime` accept several formats.

**Private spreadsheet** ("Daddy Invitational – private (emails)", made by `setupPrivateSheet`, shared with no one): Nickname, Email, Key, Admin. Keys are generated when blank; clearing a Key revokes that player's link. Only the web app reads it. Its ID and the optional `RESEND_API_KEY`, `MAIL_FROM` and `SITE_URL` are Script Properties, never in the repo.

**Apps Script gotchas:**
- **Inserted columns copy validation:** `insertColumnAfter` copies the left neighbour's data validation and formatting, so `ensureColumn` clears both.
- **No UI outside the open sheet:** `SpreadsheetApp.getUi()` throws when the script isn't run from the open sheet, so `getUi()` returns null and the script logs instead.

## Tournament rules (as implemented)

**Event structure**
- **Format:** 3 days, 16 matches, 1 point each (½ for a halve). 8½ wins.
  - **Matched:** 2v2 with AA and BB pairs, 4 matches.
  - **Mixed:** 2v2 with AB pairs, 4 matches.
  - **Singles:** 1v1, 8 matches, flight-matched: four A v A, then four B v B.
- **No rematches** (commissioner's rule): a player can face any given opponent only once across all three rounds, so the 2v2 matchups largely decide the singles draw. The Matchups preview enforces it in every format: each round is checked against the other two. Nothing validates the Matches tab itself, but an official matchup that breaks the rule shows a red "Rematch" message in the preview.
- **The Matches tab is the official, locked-in matchups.** Whatever is posted there for a day is copied into that format's preview, tagged "Official" and not editable; only unposted matches can be previewed. Locking is per side: a row with only one team's players posted locks that side and leaves the other editable (the "Official" tag appears once both sides are posted).
- **Day for each format:** set by the Schedule `Format` column, not fixed in code. Matchups finds the course for a format by matching the day's Format. The Matchups format buttons are ordered by that schedule and open on the first format played.

**Live scoring**
- **Final is derived** in `matchState()` (`js/sheet.js`): final when Up > 18 − Thru (`4&3`), or at Thru 18 (`2 UP`, or AS = `Halved`). Otherwise a row with Thru ≥ 1 and a Leader is live. Fixing a typo in Thru/Up reverts it; nothing is stored.
- **Live day** (`isDayLive`): on its calendar date, from the first tee time (or first posted score) until every match is final. The banner reads "Day N · Live" with a pulsing dot and that day's card moves to the top.
- **Rows:** no score shows the tee time. Live shows an outlined pill in the leader's colour (AS has a gold ring like Halved, with gold text in dark mode) over "• Thru N", and the leading side is tinted without an edge bar. Final shows the solid pill over "Final", with the winner's tint and edge bar (halves get gold bars on both sides). Once a day is complete, "Final" is dropped and only the pill remains.
- **Projected** (`projectedPoints`): a line under the hero, only on the last day, once every match has a score and at least half are through 9. Leaders get 1, AS ½ each, added to official points. It hides again if a correction breaks a condition.
- **Refresh:** the Scoreboard re-fetches every 60s while visible. gviz can lag a minute or two behind sheet edits.

**Hole-by-hole entry** (Settings `Hole Entry = On`; Off is the kill switch: the site ignores Scores, score.html says entry is off, and the web app refuses entries)
- **Source of a match's score:** Leader/Up/Thru if Thru is filled, else hole results from Scores (`holeState` in `golf.js`), else scheduled.
- **holeState:** final once a side leads by more than the holes left, counting only holes entered in order from 1 (a gap blocks the close). Holes after a close-out are still played and entered, for the tiebreak, and don't change the result. While live, Up counts all entered holes and Thru is the last one entered.
- **Strokes:** the receiving side (existing `matchStrokes`) gets one on holes with stroke index ≤ N, two on ≤ N − 18 (`strokeHoles`). Players enter who won the hole, net; nobody enters gross scores.
- **Who can enter:** any player in a match, for today's round only; admins (Admin ticked in the private sheet) any match, any day. Enforced by the web app.
- **Sign-in:** the player enters their email on score.html; the web app emails `score.html#k=<key>` (via Resend from no-reply@daddyinvitational.com, falling back to Eric's Gmail) only if the address is listed, and answers the same either way. The page stores the key in `localStorage` and strips it from the URL. iOS Home Screen shortcuts have separate storage, so players should use Safari.
- **Offline:** taps save to a `localStorage` queue first and send in batches (retry every 5s, on `online` and on visibility). Each entry carries its tap time; the server keeps the newest per hole, so resends and out-of-order arrivals are safe. Tapping the selected result again clears the hole.
- **Keep score button:** on the Scoreboard on tournament days (from midnight) while Hole Entry is On and Score App URL is set.

**Handicaps**
- **2v2 team handicap:** `lowerPct × lower + higherPct × higher` (35% / 15%, from Settings).
- **Strokes:** `Math.round(|a − b|)` of the side handicaps.
- **Rounding:** `round1()` rounds to 3 places first, to avoid float misses like 4.1499999 → 4.1.
- **Course handicap mode** (Settings `Handicap = Course`):
  - Formula: `round(Index × Slope / 113 + (Rating − Par))`, using that day's Schedule row.
  - It's used by Scoreboard strokes, awards and the Matchups preview.
  - A day missing slope, rating or par falls back to index. Only the Matchups page says which is in use; Scoreboard day headers deliberately don't mention handicaps.
  - The Teams page always shows index.

**Margins and standings**
- **Margin parsing** (`parseMargin`): `4&3` → 4, `2 UP` → 2, `Halved`/`AS` → 0. Anything unrecognised is null; it still counts for points but is excluded from Net.
- **When standings appear:** only once a day is complete, meaning every expected match is final.
- **Ranking:** points, then Net, the sum of a player's margins. Partners share a 2v2 result.

**Awards**
- **Points leader:** top rank; ties are listed.
- **Locked in:** won every match played, with at least 2 wins.
- **Biggest win:** the widest winning margin.
- **Toughest loss:** the other side of the Biggest win match.
- **Stroke killer:** won while *giving* the most strokes. If nobody did, the card becomes **Against the odds**, the win that *received* the most strokes.
- **Display:** award names are always ink, never team colours. Tied entries each get their own line.
- **Tournament MVP:** the commissioner's pick from Settings `MVP`. It's shown as its own card only when set; it isn't highlighted in the table.

**Scoreboard banner** (one line, always navy; by calendar day in the Settings timezone, not tee times)
- Before day 1: "N days to go".
- From midnight on each day: "Day N".
- While a day is live: "Day N · Live".
- Once all 16 matches have results: "Final" ("Final · Tied" at 8–8 until a Tiebreak Winner is set).

**End of tournament**
- A team reaching 8½ gets the gold "Ryder" trophy SVG on its hero card.
- **8–8 tie** (commissioner's rule: team net holes won on Sunday's back 9, then each previous 9). With hole data, `tiebreakLead` computes it (every match's holes in that nine must be entered) and the strip shows the winner as "pending verification" with an outlined pill; Settings `Tiebreak Winner` makes it official. Settings `Tiebreak Winner` (a team name) and `Tiebreak Note` (free text). With all 16 final at 8–8 and no winner, the banner reads "Final · Tied" and a strip under the hero states the rule; once a winner is set, that team gets the trophy and the strip shows the note. A Tiebreak Winner is ignored unless the score is actually 8–8.
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
  - Scoreboard 2v2 pairs (match rows and award cards) sit on one line as "JD / Eric" with a muted slash. If any pair in a group is too wide, `fitPairs()` stacks every pair in that group, so the group never mixes. Match rows and award cards are separate groups. It re-checks on resize and when a day card opens.
- **Icons:** the trophy is a custom single-tone SVG chosen from mockups, not a stock icon.
- **Loading states:** the Scoreboard shows a pulsing skeleton (banner bar, red/navy/blue hero, day cards) in static HTML; the other pages show the "team chase" crest loader (red and blue quarter arcs circling the edition crest, `.loader` in `theme.css`). Both stop animating under `prefers-reduced-motion`.
- **Copy:** sentence-case UI text and short labels.

## Deployment notes

- **GitHub Pages caching:** Pages serves with `max-age=600`, so phones can show stale CSS/JS for up to 10 minutes after a push; suggest a private tab to check. Assets have no cache-busting.
- **Custom domain DNS:** Squarespace DNS has apex A/AAAA records pointing to GitHub Pages, `www` as a CNAME to `engineeric.github.io`, and a `_github-pages-challenge-engineeric` TXT verification record.
