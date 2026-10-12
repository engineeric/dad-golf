import { loadData } from './sheet.js';
import {
  FORMATS, SIDES, buildDays, courseData, formatPlaying, playingHandicap, round1, sideHandicap, strokes,
} from './golf.js';
import { applyEdition, esc, renderChrome, showError } from './ui.js';

renderChrome('matchups');
const app = document.getElementById('app');

const MODES = ['Matched', 'Mixed', 'Singles'];
/** Formats in the order they're played per the Schedule tab; unscheduled ones keep their default order, last. */
function scheduledModes() {
  const day = (m) => days.find((d) => d.format === m)?.round ?? Infinity;
  return [...MODES].sort((a, b) => day(a) - day(b) || MODES.indexOf(a) - MODES.indexOf(b));
}
const size = (mode) => (mode === 'Singles' ? 1 : 2); // players per side
const matchCount = (mode) => FORMATS[mode].slots.length;
const emptyPicks = (mode) => Array.from({ length: matchCount(mode) }, () => ({
  red: Array(size(mode)).fill(''),
  blue: Array(size(mode)).fill(''),
}));
const allEmpty = () => Object.fromEntries(MODES.map((m) => [m, emptyPicks(m)]));

let players = [];
let playerMap = new Map();
let settings;
let days = [];
const state = { mode: 'Matched', picks: allEmpty() };
let helpOpen = false; // survives re-renders

const byName = (n) => playerMap.get(n);
const picks = () => state.picks[state.mode];
/** Required flight for a slot: slots are 'AA', 'AB', … for pairs and 'A' / 'B' for singles. */
const slotFlight = (match, pos, mode = state.mode) => FORMATS[mode].slots[match][pos] ?? '';
const otherSide = (side) => (side === 'red' ? 'blue' : 'red');
const fits = (p, side, flight) => p.side === side && (!flight || p.flight === flight);

// ---------- URL hash: #f=singles&matched=R1a~R1b~B1a~B1b~…&mixed=…&singles=… ----------
// Every format's lineup is in the link, because the singles options depend on the 2v2 lineups.

function writeHash() {
  const params = new URLSearchParams({ f: state.mode.toLowerCase() });
  for (const mode of MODES) {
    const flat = state.picks[mode].flatMap((m) => [...m.red, ...m.blue]);
    if (flat.some(Boolean)) params.set(mode.toLowerCase(), flat.join('~'));
  }
  history.replaceState(null, '', `#${params}`);
}

function decodeLineup(mode, text) {
  const flat = (text ?? '').split('~');
  const per = size(mode) * 2;
  if (flat.length !== matchCount(mode) * per) return;
  const used = new Set();
  flat.forEach((name, i) => {
    const match = Math.floor(i / per);
    const side = SIDES[Math.floor((i % per) / size(mode))];
    const pos = i % size(mode);
    const p = byName(name);
    const valid = p && fits(p, side, slotFlight(match, pos, mode)) && !used.has(name);
    if (valid) used.add(name);
    state.picks[mode][match][side][pos] = valid ? name : '';
  });
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  // No format in the link: open on the first one played.
  state.mode = MODES.find((m) => m.toLowerCase() === params.get('f')) ?? scheduledModes()[0];
  for (const mode of MODES) {
    // `p` is the old single-lineup link format.
    decodeLineup(mode, params.get(mode.toLowerCase()) ?? (mode === state.mode ? params.get('p') : null));
  }
}

// ---------- Official matchups (Matches tab) are locked into the preview ----------

/** Per format, which match slots hold an official matchup and so can't be edited. */
const locked = Object.fromEntries(MODES.map((m) => [m, []]));
const isLocked = (match, mode = state.mode) => !!locked[mode][match];

const byFlight = (names) => [...names].sort((a, b) => (byName(a)?.flight ?? '').localeCompare(byName(b)?.flight ?? ''));

/** Copies each day's posted Matches rows into the matching slots of that format's lineup and locks them. */
function applyOfficial() {
  for (const mode of MODES) {
    const slots = FORMATS[mode].slots;
    locked[mode] = slots.map(() => false);
    const day = days.find((d) => d.format === mode);
    const official = (day?.matches ?? []).filter((m) => m.red.length || m.blue.length);
    const lineup = state.picks[mode];
    for (const m of official) {
      const label = byFlight(m.red.length ? m.red : m.blue).map((n) => byName(n)?.flight ?? '').join('');
      let i = slots.findIndex((slot, idx) => !locked[mode][idx] && slot === label);
      if (i < 0) i = locked[mode].indexOf(false);
      if (i < 0) break;
      locked[mode][i] = true;
      const fill = (names) => Array.from({ length: size(mode) }, (_, pos) => byFlight(names)[pos] ?? '');
      lineup[i] = { red: fill(m.red), blue: fill(m.blue) };
    }
    // Anyone in an official match can't also sit in an editable one.
    const taken = new Set(lineup.flatMap((m, i) => (locked[mode][i] ? [...m.red, ...m.blue] : [])).filter(Boolean));
    lineup.forEach((m, i) => {
      if (locked[mode][i]) return;
      for (const side of SIDES) m[side] = m[side].map((n) => (taken.has(n) ? '' : n));
    });
  }
}

// ---------- No rematches: a player meets each opponent at most once ----------

const TWO_V_TWO = ['Matched', 'Mixed'];
/** The other rounds a format's matchups must not repeat: singles checks both 2v2 rounds, each 2v2 round the other. */
const rivalRounds = (mode) => TWO_V_TWO.filter((m) => m !== mode);

/** player → Map(opponent → format they met in), from the rounds `mode` is checked against. */
function buildFaced(mode = state.mode) {
  const faced = new Map();
  const add = (a, b, where) => {
    if (!faced.has(a)) faced.set(a, new Map());
    faced.get(a).set(b, where);
  };
  for (const rival of rivalRounds(mode)) {
    for (const m of state.picks[rival]) {
      for (const r of m.red.filter(Boolean)) for (const b of m.blue.filter(Boolean)) { add(r, b, rival); add(b, r, rival); }
    }
  }
  return faced;
}

let faced = new Map();
/** The format two players already met in, or undefined if they haven't. */
const metIn = (a, b) => (a && b ? faced.get(a)?.get(b) : undefined);
/** The first red/blue pair in a match who have already met: [red, blue, format], or null. */
function rematchIn(m) {
  for (const r of m.red) for (const b of m.blue) if (metIn(r, b)) return [r, b, metIn(r, b)];
  return null;
}
const isSingles = () => state.mode === 'Singles';

// ---------- Actions ----------

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Fills the editable matches at random, keeping official ones, and retries until it finds
 * a lineup with no rematches (or settles for the fewest if none turns up).
 */
function randomFill() {
  const mode = state.mode;
  faced = buildFaced(mode);
  const lineup = state.picks[mode];
  const official = new Set(lineup.flatMap((m, i) => (isLocked(i) ? [...m.red, ...m.blue] : [])).filter(Boolean));
  const free = (side, flight) => players.filter((p) => fits(p, side, flight) && !official.has(p.name));
  const rematches = (cand) => cand.reduce((n, m, i) => (isLocked(i) ? n
    : n + m.red.reduce((k, r) => k + m.blue.filter((b) => metIn(r, b)).length, 0)), 0);

  let best = lineup;
  let fewest = Infinity;
  for (let attempt = 0; attempt < 4000 && fewest > 0; attempt++) {
    const cand = lineup.map((m, i) => (isLocked(i) ? m : { red: m.red.map(() => ''), blue: m.blue.map(() => '') }));
    for (const side of SIDES) {
      const pools = { A: shuffle(free(side, 'A')), B: shuffle(free(side, 'B')) };
      cand.forEach((m, i) => {
        if (!isLocked(i)) m[side] = m[side].map((_, pos) => pools[slotFlight(i, pos, mode)]?.shift()?.name ?? '');
      });
    }
    const count = rematches(cand);
    if (count < fewest) { best = cand; fewest = count; }
  }
  state.picks[mode] = best;
}

function clearEditable() {
  state.picks[state.mode] = picks().map((m, i) => (isLocked(i) ? m : { red: m.red.map(() => ''), blue: m.blue.map(() => '') }));
}

// ---------- Rendering ----------

// ---------- Handicap basis (course handicaps only when Settings asks for them) ----------

const courseMode = () => settings.handicapMode === 'course';

/** Each format is played on exactly one day, so the preview uses that day's course. */
const formatDay = () => days.find((d) => d.format === state.mode) ?? null;

/** The day whose course handicaps apply, or null to use handicap index. */
const previewDay = () => (courseMode() && courseData(formatDay()) ? formatDay() : null);

const playing = (p) => playingHandicap(p, settings, previewDay());
const sideHcp = (names) => (names.every(Boolean) ? sideHandicap(names, playerMap, settings, previewDay()) : null);

/** Says which handicaps the preview is using; nothing to say when Settings uses index. */
function renderBasis() {
  if (!courseMode()) return '';
  const day = previewDay();
  const text = day
    ? `Course handicaps · Day ${day.round} · ${esc(day.course)}${day.tees ? ` (${esc(day.tees)} tees)` : ''}`
    : `Handicap index · ${formatDay() ? `Day ${formatDay().round} course not rated yet` : 'no day scheduled for this format'}`;
  return `<p class="basis eyebrow">${text}</p>`;
}

function renderSelect(match, side, pos, used) {
  const flight = slotFlight(match, pos);
  const current = picks()[match][side][pos];
  const options = players
    .filter((p) => fits(p, side, flight))
    .sort((a, b) => a.hcp - b.hcp)
    .map((p) => {
      const taken = p.name !== current && used.has(p.name);
      // Can't be drawn against an opponent already chosen in this match if they've met in another round.
      const met = p.name !== current
        ? picks()[match][otherSide(side)].map((opp) => metIn(p.name, opp)).find(Boolean) : undefined;
      const note = taken ? ' · taken' : met ? ` · played in ${met}` : '';
      return `<option value="${esc(p.name)}"${p.name === current ? ' selected' : ''}${taken || met ? ' disabled' : ''}>${esc(p.name)} (${formatPlaying(playing(p))})${note}</option>`;
    }).join('');
  return `
    <label class="visually-hidden" for="s-${match}-${side}-${pos}">Team ${esc(settings.teams[side])} match ${match + 1} player ${pos + 1}${flight ? ` (Flight ${flight})` : ''}</label>
    <select class="select" id="s-${match}-${side}-${pos}" data-match="${match}" data-side="${side}" data-pos="${pos}"${isLocked(match) ? ' disabled' : ''}>
      <option value="">${flight ? `Flight ${flight} player…` : 'Select player…'}</option>${options}
    </select>`;
}

function renderMatch(match, used) {
  const m = picks()[match];
  const singles = size(state.mode) === 1;
  const hcp = { red: sideHcp(m.red), blue: sideHcp(m.blue) };
  const complete = hcp.red != null && hcp.blue != null;
  const diff = complete ? strokes(hcp.red, hcp.blue) : 0;
  const receiver = complete && diff ? (hcp.red > hcp.blue ? 'red' : 'blue') : null;
  const who = receiver && (singles ? esc(m[receiver][0]) : `Team ${esc(settings.teams[receiver])}`);
  const rematch = rematchIn(m);
  const verdict = rematch
    ? `<div class="mcard__foot bad">Rematch: ${esc(rematch[0])} and ${esc(rematch[1])} already played in ${FORMATS[rematch[2]].title}.</div>`
    : !complete
    ? `<div class="mcard__foot tba">Select ${singles ? 'both' : 'all four'} players</div>`
    : receiver
      ? `<div class="mcard__foot">${who} gets <span class="num">${diff}</span> stroke${diff === 1 ? '' : 's'}</div>`
      : '<div class="mcard__foot">Even match · no strokes</div>';
  const label = FORMATS[state.mode].slots[match];

  return `
    <section class="card">
      <header class="mcard__head">
        <h2>Match ${match + 1}</h2>
        <span class="mcard__tags">
          ${isLocked(match) ? '<span class="official eyebrow">Official</span>' : ''}
          ${label ? `<span class="flight">${label}</span>` : ''}
        </span>
      </header>
      <div class="mcard__body">
        ${SIDES.map((side) => `
          <div class="pair pair--${side}">
            <span class="pair__label eyebrow fg-${side}">Team ${esc(settings.teams[side])}</span>
            ${m[side].map((_, pos) => renderSelect(match, side, pos, used)).join('')}
            <div class="pair__hcp">
              <span><span class="eyebrow">${singles ? 'HCP' : 'Team HCP'}</span><br><strong>${formatPlaying(hcp[side])}</strong></span>
              ${receiver === side ? `<span class="gets">+${diff}</span>` : ''}
            </div>
          </div>`).join('')}
      </div>
      ${verdict}
    </section>`;
}

function render() {
  faced = buildFaced();
  const used = new Set(picks().flatMap((m) => [...m.red, ...m.blue]).filter(Boolean));
  const totals = { red: 0, blue: 0 };
  let complete = 0;
  for (const m of picks()) {
    const r = sideHcp(m.red);
    const b = sideHcp(m.blue);
    if (rematchIn(m)) continue;
    if (r != null && b != null) { totals.red += r; totals.blue += b; complete++; }
  }
  const pct = (n) => `${Math.round(n * 100)}%`;
  const allLocked = locked[state.mode].every(Boolean);

  app.innerHTML = `
    <details class="help"${helpOpen ? ' open' : ''}>
      <summary class="eyebrow">How it works</summary>
      <p>Build a lineup for any round to see handicaps and strokes. In 2v2, team handicap is ${pct(settings.lowerPct)} of the lower handicap plus ${pct(settings.higherPct)} of the higher; in singles, strokes are the difference between the two players' handicaps. Singles are flight-matched (A v A, B v B). Nobody plays the same opponent twice across the three rounds, so opponents a player has already met are unavailable. Matchups marked Official come from the posted tee sheet and can't be changed here.${courseMode() ? ' Handicaps are course handicaps (Index × Slope ÷ 113 + Rating − Par) for the course where this format is played.' : ''} This is a preview only; official matchups are posted on the Schedule.</p>
    </details>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Format">
        ${scheduledModes().map((m) => `<button class="eyebrow" data-mode="${m}" aria-pressed="${m === state.mode}">${FORMATS[m].title}</button>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn" data-action="random"${allLocked ? ' disabled' : ''}>${isSingles() ? 'Auto Fill' : 'Random Fill'}</button>
        <button class="btn" data-action="clear"${allLocked ? ' disabled' : ''}>Clear</button>
        <button class="btn btn--solid" data-action="share">Copy Link</button>
      </div>
    </div>
    ${renderBasis()}
    <section class="card summary" aria-label="Lineup totals">
      <div class="g bg-red"><span class="eyebrow">${esc(settings.teams.red)} total</span><strong>${complete ? formatPlaying(round1(totals.red)) : '—'}</strong></div>
      <div class="mid"><span class="eyebrow">${FORMATS[state.mode].sub}</span><br><span class="num">${complete} of ${matchCount(state.mode)}</span> matches set</div>
      <div class="e bg-blue"><span class="eyebrow">${esc(settings.teams.blue)} total</span><strong>${complete ? formatPlaying(round1(totals.blue)) : '—'}</strong></div>
    </section>
    <div class="grid">${picks().map((_, i) => renderMatch(i, used)).join('')}</div>`;
}

// ---------- Events ----------

// toggle doesn't bubble, so listen in the capture phase.
app.addEventListener('toggle', (e) => {
  if (e.target.matches('details.help')) helpOpen = e.target.open;
}, true);

app.addEventListener('change', (e) => {
  const s = e.target.closest('select[data-match]');
  if (!s || isLocked(+s.dataset.match)) return;
  picks()[+s.dataset.match][s.dataset.side][+s.dataset.pos] = s.value;
  writeHash();
  render();
  document.getElementById(s.id)?.focus();
});

app.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.mode) state.mode = btn.dataset.mode;
  else if (btn.dataset.action === 'random') randomFill();
  else if (btn.dataset.action === 'clear') clearEditable();
  else if (btn.dataset.action === 'share') {
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'Copied!';
    } catch {
      prompt('Copy this link:', location.href);
    }
    setTimeout(() => { btn.textContent = 'Copy Link'; }, 1500);
    return;
  }
  writeHash();
  render();
});

// replaceState doesn't fire this, so it only runs for pasted/edited links.
window.addEventListener('hashchange', () => {
  state.picks = allEmpty();
  readHash();
  applyOfficial();
  render();
});

try {
  const data = await loadData();
  ({ players, settings } = data);
  days = buildDays(data);
  playerMap = new Map(players.map((p) => [p.name, p]));
  applyEdition(settings.edition);
  readHash();
  applyOfficial();
  writeHash();
  render();
} catch (err) {
  showError(app, err);
}
