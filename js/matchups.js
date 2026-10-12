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

// ---------- No rematches: singles opponents must be new ----------

const TWO_V_TWO = ['Matched', 'Mixed'];

/**
 * The 2v2 matchups that count as already played for a format: the official Matches
 * rows for that day once posted, otherwise the lineup built in this preview.
 */
function priorMatches(mode) {
  const day = days.find((d) => d.format === mode);
  const official = (day?.matches ?? []).filter((m) => m.red.length && m.blue.length);
  if (official.length) return { official: true, matches: official };
  return {
    official: false,
    matches: state.picks[mode].map((m) => ({ red: m.red.filter(Boolean), blue: m.blue.filter(Boolean) })),
  };
}

/** player → Map(opponent → format they met in), across both 2v2 rounds. */
function buildFaced() {
  const faced = new Map();
  const add = (a, b, mode) => {
    if (!faced.has(a)) faced.set(a, new Map());
    faced.get(a).set(b, mode);
  };
  for (const mode of TWO_V_TWO) {
    for (const m of priorMatches(mode).matches) {
      for (const r of m.red) for (const b of m.blue) { add(r, b, mode); add(b, r, mode); }
    }
  }
  return faced;
}

let faced = new Map();
/** The 2v2 format two players already met in, or undefined if they haven't. */
const metIn = (a, b) => (a && b ? faced.get(a)?.get(b) : undefined);
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

/** All orderings of a small list. */
const permutations = (list) => (list.length <= 1 ? [list]
  : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest])));

/** Singles: pair each flight so nobody meets an opponent they've already played; unpairable slots stay blank. */
function fillSingles() {
  faced = buildFaced();
  const next = emptyPicks('Singles');
  for (const flight of ['A', 'B']) {
    const slots = next.map((_, i) => i).filter((i) => slotFlight(i, 0, 'Singles') === flight);
    const reds = shuffle(players.filter((p) => fits(p, 'red', flight))).slice(0, slots.length);
    const blues = shuffle(players.filter((p) => fits(p, 'blue', flight)));
    const score = (order) => reds.filter((r, i) => order[i] && !metIn(r.name, order[i].name)).length;
    const best = permutations(blues).reduce((a, b) => (score(b) > score(a) ? b : a));
    reds.forEach((r, i) => {
      next[slots[i]].red[0] = r.name;
      if (best[i] && !metIn(r.name, best[i].name)) next[slots[i]].blue[0] = best[i].name;
    });
  }
  state.picks.Singles = next;
}

function randomFill() {
  if (isSingles()) { fillSingles(); return; }
  const next = emptyPicks(state.mode);
  for (const side of SIDES) {
    const pools = { '': shuffle(players.filter((p) => p.side === side)) };
    for (const f of ['A', 'B']) pools[f] = shuffle(players.filter((p) => p.side === side && p.flight === f));
    const taken = new Set();
    next.forEach((m, match) => {
      m[side].forEach((_, pos) => {
        const pool = pools[slotFlight(match, pos)];
        let p = pool.shift();
        while (p && taken.has(p.name)) p = pool.shift();
        if (p) taken.add(p.name);
        m[side][pos] = p?.name ?? '';
      });
    });
  }
  state.picks[state.mode] = next;
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
      // Singles: can't be drawn against the opponent already chosen in this match if they've met.
      const met = isSingles() && p.name !== current ? metIn(p.name, picks()[match][otherSide(side)][0]) : undefined;
      const note = taken ? ' · taken' : met ? ` · played in ${met}` : '';
      return `<option value="${esc(p.name)}"${p.name === current ? ' selected' : ''}${taken || met ? ' disabled' : ''}>${esc(p.name)} (${formatPlaying(playing(p))})${note}</option>`;
    }).join('');
  return `
    <label class="visually-hidden" for="s-${match}-${side}-${pos}">Team ${esc(settings.teams[side])} match ${match + 1} player ${pos + 1}${flight ? ` (Flight ${flight})` : ''}</label>
    <select class="select" id="s-${match}-${side}-${pos}" data-match="${match}" data-side="${side}" data-pos="${pos}">
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
  const rematch = singles ? metIn(m.red[0], m.blue[0]) : undefined;
  const verdict = rematch
    ? `<div class="mcard__foot bad">Rematch: they already played in ${FORMATS[rematch].title}. Pick a different opponent.</div>`
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
        ${label ? `<span class="flight">${label}</span>` : ''}
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
    if (isSingles() && metIn(m.red[0], m.blue[0])) continue;
    if (r != null && b != null) { totals.red += r; totals.blue += b; complete++; }
  }
  const pct = (n) => `${Math.round(n * 100)}%`;

  app.innerHTML = `
    <details class="help"${helpOpen ? ' open' : ''}>
      <summary class="eyebrow">How it works</summary>
      <p>Build a lineup for any round to see handicaps and strokes. In 2v2, team handicap is ${pct(settings.lowerPct)} of the lower handicap plus ${pct(settings.higherPct)} of the higher; in singles, strokes are the difference between the two players' handicaps. Singles are flight-matched (A v A, B v B) and nobody plays the same opponent twice, so anyone a player met in a 2v2 round is unavailable.${courseMode() ? ' Handicaps are course handicaps (Index × Slope ÷ 113 + Rating − Par) for the course where this format is played.' : ''} This is a preview only; official matchups are posted on the Schedule.</p>
    </details>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Format">
        ${scheduledModes().map((m) => `<button class="eyebrow" data-mode="${m}" aria-pressed="${m === state.mode}">${FORMATS[m].title}</button>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn" data-action="random">${isSingles() ? 'Auto Fill' : 'Random Fill'}</button>
        <button class="btn" data-action="clear">Clear</button>
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
  if (!s) return;
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
  else if (btn.dataset.action === 'clear') state.picks[state.mode] = emptyPicks(state.mode);
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
  render();
});

try {
  const data = await loadData();
  ({ players, settings } = data);
  days = buildDays(data);
  playerMap = new Map(players.map((p) => [p.name, p]));
  applyEdition(settings.edition);
  readHash();
  writeHash();
  render();
} catch (err) {
  showError(app, err);
}
