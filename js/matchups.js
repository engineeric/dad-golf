import { loadData } from './sheet.js';
import { FORMATS, SIDES, formatHcp, round1, strokes, teamHcp } from './golf.js';
import { applyEdition, esc, renderChrome, showError } from './ui.js';

renderChrome('matchups');
const app = document.getElementById('app');

const MODES = ['Matched', 'Mixed'];
const MATCHES = 4;
const emptyPicks = () => Array.from({ length: MATCHES }, () => ({ red: ['', ''], blue: ['', ''] }));

let players = [];
let settings;
const state = { mode: 'Matched', picks: { Matched: emptyPicks(), Mixed: emptyPicks() } };

const byName = (n) => players.find((p) => p.name === n);
const picks = () => state.picks[state.mode];
const slotFlight = (match, pos) => FORMATS[state.mode].slots[match][pos];

// ---------- URL hash: #f=matched&p=R1a~R1b~B1a~B1b~R2a… ----------

function writeHash() {
  const flat = picks().flatMap((m) => [...m.red, ...m.blue]);
  const params = new URLSearchParams({ f: state.mode.toLowerCase() });
  if (flat.some(Boolean)) params.set('p', flat.join('~'));
  history.replaceState(null, '', `#${params}`);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const mode = MODES.find((m) => m.toLowerCase() === params.get('f'));
  if (mode) state.mode = mode;
  const flat = (params.get('p') ?? '').split('~');
  if (flat.length !== MATCHES * 4) return;
  const target = picks();
  const used = new Set();
  flat.forEach((name, i) => {
    const match = Math.floor(i / 4);
    const side = SIDES[Math.floor((i % 4) / 2)];
    const pos = i % 2;
    const p = byName(name);
    const valid = p && p.side === side && p.flight === slotFlight(match, pos) && !used.has(name);
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
  const next = emptyPicks();
  for (const side of SIDES) {
    const pools = {};
    for (const f of ['A', 'B']) pools[f] = shuffle(players.filter((p) => p.side === side && p.flight === f));
    next.forEach((m, match) => {
      for (const pos of [0, 1]) m[side][pos] = pools[slotFlight(match, pos)].shift()?.name ?? '';
    });
  }
  state.picks[state.mode] = next;
}

// ---------- Rendering ----------

function pairHcp(names) {
  const [a, b] = names.map(byName);
  return a && b ? teamHcp(a.hcp, b.hcp, settings) : null;
}

function renderSelect(match, side, pos, used) {
  const flight = slotFlight(match, pos);
  const current = picks()[match][side][pos];
  const options = players
    .filter((p) => p.side === side && p.flight === flight)
    .sort((a, b) => a.hcp - b.hcp)
    .map((p) => {
      const taken = p.name !== current && used.has(p.name);
      return `<option value="${esc(p.name)}"${p.name === current ? ' selected' : ''}${taken ? ' disabled' : ''}>${esc(p.name)} (${formatHcp(p.hcp)})${taken ? ' · taken' : ''}</option>`;
    }).join('');
  return `
    <label class="visually-hidden" for="s-${match}-${side}-${pos}">Team ${esc(settings.teams[side])} match ${match + 1} player ${pos + 1} (Flight ${flight})</label>
    <select class="select" id="s-${match}-${side}-${pos}" data-match="${match}" data-side="${side}" data-pos="${pos}">
      <option value="">Flight ${flight} player…</option>${options}
    </select>`;
}

function renderMatch(match, used) {
  const m = picks()[match];
  const hcp = { red: pairHcp(m.red), blue: pairHcp(m.blue) };
  const complete = hcp.red != null && hcp.blue != null;
  const diff = complete ? strokes(hcp.red, hcp.blue) : 0;
  const receiver = complete && diff ? (hcp.red > hcp.blue ? 'red' : 'blue') : null;
  const verdict = !complete
    ? '<div class="mcard__foot tba">Select all four players</div>'
    : receiver
      ? `<div class="mcard__foot">Team ${esc(settings.teams[receiver])} gets <span class="num">${diff}</span> stroke${diff === 1 ? '' : 's'}</div>`
      : '<div class="mcard__foot">Even match · no strokes</div>';

  return `
    <section class="card">
      <header class="mcard__head">
        <h2>Match ${match + 1}</h2>
        <span class="flight">${FORMATS[state.mode].slots[match]}</span>
      </header>
      <div class="mcard__body">
        ${SIDES.map((side) => `
          <div class="pair pair--${side}">
            <span class="pair__label eyebrow fg-${side}">Team ${esc(settings.teams[side])}</span>
            ${renderSelect(match, side, 0, used)}
            ${renderSelect(match, side, 1, used)}
            <div class="pair__hcp">
              <span><span class="eyebrow">Team HCP</span><br><strong>${formatHcp(hcp[side])}</strong></span>
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
    const r = pairHcp(m.red);
    const b = pairHcp(m.blue);
    if (r != null && b != null) { totals.red += r; totals.blue += b; complete++; }
  }
  const pct = (n) => `${Math.round(n * 100)}%`;

  app.innerHTML = `
    <p class="intro">Build a lineup for either 2v2 round to see team handicaps and strokes. Team handicap is ${pct(settings.lowerPct)} of the lower handicap plus ${pct(settings.higherPct)} of the higher. This is a preview only; official matchups are posted on the Schedule.</p>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Format">
        ${MODES.map((m) => `<button class="eyebrow" data-mode="${m}" aria-pressed="${m === state.mode}">${FORMATS[m].title}</button>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn" data-action="random">Random Fill</button>
        <button class="btn" data-action="clear">Clear</button>
        <button class="btn btn--solid" data-action="share">Copy Link</button>
      </div>
    </div>
    <section class="card summary" aria-label="Lineup totals">
      <div class="g bg-red"><span class="eyebrow">${esc(settings.teams.red)} total</span><strong>${complete ? formatHcp(round1(totals.red)) : '—'}</strong></div>
      <div class="mid"><span class="eyebrow">${FORMATS[state.mode].sub}</span><br><span class="num">${complete} of ${MATCHES}</span> matches set</div>
      <div class="e bg-blue"><span class="eyebrow">${esc(settings.teams.blue)} total</span><strong>${complete ? formatHcp(round1(totals.blue)) : '—'}</strong></div>
    </section>
    <div class="grid">${picks().map((_, i) => renderMatch(i, used)).join('')}</div>`;
}

// ---------- Events ----------

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
  else if (btn.dataset.action === 'clear') state.picks[state.mode] = emptyPicks();
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
  state.picks = { Matched: emptyPicks(), Mixed: emptyPicks() };
  readHash();
  render();
});

try {
  ({ players, settings } = await loadData());
  applyEdition(settings.edition);
  readHash();
  writeHash();
  render();
} catch (err) {
  showError(app, err);
}
