import { loadData } from './sheet.js';
import {
  FORMATS, SIDES, buildDays, courseData, dayTitle, formatPlaying, playingHandicap, round1, sideHandicap, strokes,
} from './golf.js';
import { applyEdition, esc, renderChrome, showError } from './ui.js';

renderChrome('matchups');
const app = document.getElementById('app');

const MODES = ['Matched', 'Mixed', 'Singles'];
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
// course: null = pick the day matching the format; a round number or 'index' once chosen.
const state = { mode: 'Matched', picks: allEmpty(), course: null };
let helpOpen = false; // survives re-renders

const byName = (n) => playerMap.get(n);
const picks = () => state.picks[state.mode];
/** Required flight for a slot; '' means any player (singles). */
const slotFlight = (match, pos) => FORMATS[state.mode].slots[match][pos] ?? '';
const fits = (p, side, flight) => p.side === side && (!flight || p.flight === flight);

// ---------- URL hash: #f=matched&p=R1a~R1b~B1a~B1b~R2a… ----------

function writeHash() {
  const flat = picks().flatMap((m) => [...m.red, ...m.blue]);
  const params = new URLSearchParams({ f: state.mode.toLowerCase() });
  if (flat.some(Boolean)) params.set('p', flat.join('~'));
  if (state.course != null) params.set('c', state.course);
  history.replaceState(null, '', `#${params}`);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const mode = MODES.find((m) => m.toLowerCase() === params.get('f'));
  const c = params.get('c');
  state.course = c === 'index' ? 'index' : c && Number.isFinite(+c) ? +c : null;
  if (mode) state.mode = mode;
  const flat = (params.get('p') ?? '').split('~');
  const per = size(state.mode) * 2;
  if (flat.length !== matchCount(state.mode) * per) return;
  const target = picks();
  const used = new Set();
  flat.forEach((name, i) => {
    const match = Math.floor(i / per);
    const side = SIDES[Math.floor((i % per) / size(state.mode))];
    const pos = i % size(state.mode);
    const p = byName(name);
    const valid = p && fits(p, side, slotFlight(match, pos)) && !used.has(name);
    if (valid) used.add(name);
    target[match][side][pos] = valid ? name : '';
  });
}

// ---------- Actions ----------

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function randomFill() {
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
const ratedDays = () => days.filter((d) => courseData(d));

/** The day whose course handicaps the preview uses, or null for handicap index. */
function previewDay() {
  if (!courseMode() || state.course === 'index') return null;
  if (state.course != null) return ratedDays().find((d) => d.round === state.course) ?? null;
  return ratedDays().find((d) => d.format === state.mode) ?? ratedDays()[0] ?? null;
}

const playing = (p) => playingHandicap(p, settings, previewDay());
const sideHcp = (names) => (names.every(Boolean) ? sideHandicap(names, playerMap, settings, previewDay()) : null);

function renderCoursePicker() {
  if (!courseMode()) return '';
  const day = previewDay();
  const options = ratedDays().map((d) =>
    `<option value="${d.round}"${day?.round === d.round ? ' selected' : ''}>Day ${d.round} · ${esc(d.course || dayTitle(d))}${d.tees ? ` (${esc(d.tees)})` : ''}</option>`).join('');
  return `
    <label class="basis">
      <span class="eyebrow">Handicaps</span>
      <select class="select" id="course">
        ${options}
        <option value="index"${day ? '' : ' selected'}>Handicap index</option>
      </select>
    </label>`;
}

function renderSelect(match, side, pos, used) {
  const flight = slotFlight(match, pos);
  const current = picks()[match][side][pos];
  const options = players
    .filter((p) => fits(p, side, flight))
    .sort((a, b) => a.hcp - b.hcp)
    .map((p) => {
      const taken = p.name !== current && used.has(p.name);
      return `<option value="${esc(p.name)}"${p.name === current ? ' selected' : ''}${taken ? ' disabled' : ''}>${esc(p.name)} (${formatPlaying(playing(p))})${taken ? ' · taken' : ''}</option>`;
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
  const verdict = !complete
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
  const used = new Set(picks().flatMap((m) => [...m.red, ...m.blue]).filter(Boolean));
  const totals = { red: 0, blue: 0 };
  let complete = 0;
  for (const m of picks()) {
    const r = sideHcp(m.red);
    const b = sideHcp(m.blue);
    if (r != null && b != null) { totals.red += r; totals.blue += b; complete++; }
  }
  const pct = (n) => `${Math.round(n * 100)}%`;

  app.innerHTML = `
    <details class="help"${helpOpen ? ' open' : ''}>
      <summary class="eyebrow">How it works</summary>
      <p>Build a lineup for any round to see handicaps and strokes. In 2v2, team handicap is ${pct(settings.lowerPct)} of the lower handicap plus ${pct(settings.higherPct)} of the higher; in singles, strokes are the difference between the two players' handicaps.${courseMode() ? ' Handicaps are course handicaps (Index × Slope ÷ 113 + Rating − Par) for the course picked below.' : ''} This is a preview only; official matchups are posted on the Schedule.</p>
    </details>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Format">
        ${MODES.map((m) => `<button class="eyebrow" data-mode="${m}" aria-pressed="${m === state.mode}">${FORMATS[m].title}</button>`).join('')}
      </div>
      ${renderCoursePicker()}
      <div class="btn-row">
        <button class="btn" data-action="random">Random Fill</button>
        <button class="btn" data-action="clear">Clear</button>
        <button class="btn btn--solid" data-action="share">Copy Link</button>
      </div>
    </div>
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
  if (e.target.id === 'course') {
    state.course = e.target.value === 'index' ? 'index' : +e.target.value;
    writeHash();
    render();
    return;
  }
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
