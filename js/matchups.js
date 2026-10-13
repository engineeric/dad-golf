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
// `mode` is the format shown on narrow screens; wide screens show all three side by side.
const state = { mode: 'Matched', picks: allEmpty() };
let sel = null; // the slot whose player tray is open: { mode, match, side, pos }
let helpOpen = false; // survives re-renders

const byName = (n) => playerMap.get(n);
const picks = (mode) => state.picks[mode];
/** Required flight for a slot: slots are 'AA', 'AB', … for pairs and 'A' / 'B' for singles. */
const slotFlight = (match, pos, mode) => FORMATS[mode].slots[match][pos] ?? '';
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
const isLocked = (match, mode) => !!locked[mode][match];

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

/** The other rounds a format's matchups must not repeat: every round is checked against the other two. */
const rivalRounds = (mode) => MODES.filter((m) => m !== mode);

/** player → Map(opponent → format they met in), from the rounds `mode` is checked against. */
function buildFaced(mode) {
  const met = new Map();
  const add = (a, b, where) => {
    if (!met.has(a)) met.set(a, new Map());
    met.get(a).set(b, where);
  };
  for (const rival of rivalRounds(mode)) {
    for (const m of state.picks[rival]) {
      for (const r of m.red.filter(Boolean)) for (const b of m.blue.filter(Boolean)) { add(r, b, rival); add(b, r, rival); }
    }
  }
  return met;
}

let faced = {}; // per format
/** The format two players already met in, other than `mode`, or undefined if they haven't. */
const metIn = (a, b, mode) => (a && b ? faced[mode].get(a)?.get(b) : undefined);
/** The first red/blue pair in a match who have already met: [red, blue, format], or null. */
function rematchIn(m, mode) {
  for (const r of m.red) for (const b of m.blue) if (metIn(r, b, mode)) return [r, b, metIn(r, b, mode)];
  return null;
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

const blank = (m) => ({ red: m.red.map(() => ''), blue: m.blue.map(() => '') });

/**
 * Fills a format's editable matches at random, keeping official ones, and retries until it finds
 * a lineup with no rematches (or settles for the fewest if none turns up). Returns the rematch count.
 */
function randomFill(mode) {
  faced[mode] = buildFaced(mode);
  const lineup = picks(mode);
  const official = new Set(lineup.flatMap((m, i) => (isLocked(i, mode) ? [...m.red, ...m.blue] : [])).filter(Boolean));
  const free = (side, flight) => players.filter((p) => fits(p, side, flight) && !official.has(p.name));
  const rematches = (cand) => cand.reduce((n, m, i) => (isLocked(i, mode) ? n
    : n + m.red.reduce((k, r) => k + m.blue.filter((b) => metIn(r, b, mode)).length, 0)), 0);

  let best = lineup;
  let fewest = Infinity;
  for (let attempt = 0; attempt < 4000 && fewest > 0; attempt++) {
    const cand = lineup.map((m, i) => (isLocked(i, mode) ? m : blank(m)));
    for (const side of SIDES) {
      const pools = { A: shuffle(free(side, 'A')), B: shuffle(free(side, 'B')) };
      cand.forEach((m, i) => {
        if (!isLocked(i, mode)) m[side] = m[side].map((_, pos) => pools[slotFlight(i, pos, mode)]?.shift()?.name ?? '');
      });
    }
    const count = rematches(cand);
    if (count < fewest) { best = cand; fewest = count; }
  }
  state.picks[mode] = best;
  return fewest;
}

function clearEditable(mode) {
  state.picks[mode] = picks(mode).map((m, i) => (isLocked(i, mode) ? m : blank(m)));
}

/** Refills every format in schedule order, starting over until the three rounds have no rematches between them. */
function fillAll() {
  let best = state.picks;
  let fewest = Infinity;
  for (let attempt = 0; attempt < 20 && fewest > 0; attempt++) {
    MODES.forEach(clearEditable);
    const count = scheduledModes().reduce((n, mode) => n + randomFill(mode), 0);
    if (count < fewest) { best = structuredClone(state.picks); fewest = count; }
  }
  state.picks = best;
}

/** The next empty editable slot in a format, looking from `from` onwards and wrapping round. */
function nextEmpty(mode, from) {
  const lineup = picks(mode);
  for (let n = 0; n < lineup.length; n++) {
    const match = (from + n) % lineup.length;
    if (isLocked(match, mode)) continue;
    for (const side of SIDES) {
      const pos = lineup[match][side].indexOf('');
      if (pos >= 0) return { mode, match, side, pos };
    }
  }
  return null;
}

/** Puts a player in the open slot, moving them out of any other slot in that format. */
function pick(name) {
  const { mode, match, side, pos } = sel;
  for (const m of picks(mode)) for (const s of SIDES) m[s] = m[s].map((n) => (n === name ? '' : n));
  picks(mode)[match][side][pos] = name;
  sel = nextEmpty(mode, match);
}

// ---------- Handicap basis (course handicaps only when Settings asks for them) ----------

const courseMode = () => settings.handicapMode === 'course';

/** Each format is played on exactly one day, so its preview uses that day's course. */
const formatDay = (mode) => days.find((d) => d.format === mode) ?? null;

/** The day whose course handicaps apply to a format, or null to use handicap index. */
const previewDay = (mode) => (courseMode() && courseData(formatDay(mode)) ? formatDay(mode) : null);

const playing = (p, mode) => playingHandicap(p, settings, previewDay(mode));
const sideHcp = (names, mode) => (names.every(Boolean) ? sideHandicap(names, playerMap, settings, previewDay(mode)) : null);

/** The course and tees a format is played on; says so when a column falls back to handicap index. */
function basisText(mode) {
  const day = formatDay(mode);
  const course = day?.course ? `${esc(day.course)}${day.tees ? `<br>${esc(day.tees)} tees` : ''}` : '';
  if (courseMode() && !previewDay(mode)) return `Handicap index · ${day ? 'course not rated yet' : 'not scheduled'}`;
  return course || FORMATS[mode].sub;
}

// ---------- Rendering ----------

const slotId = ({ mode, match, side, pos }) => `s-${mode}-${match}-${side}-${pos}`;
const sameSlot = (a, b) => !!a && !!b && slotId(a) === slotId(b);

function renderSlot(slot) {
  const { mode, match, side, pos } = slot;
  const name = picks(mode)[match][side][pos];
  const p = byName(name);
  const hcp = p ? formatPlaying(playing(p, mode)) : '';
  if (isLocked(match, mode)) {
    return `<span class="pc pc--${side}"><span class="pc__name">${esc(name) || '—'}</span><span class="num">${hcp}</span></span>`;
  }
  const flight = slotFlight(match, pos, mode);
  const label = `${FORMATS[mode].title}, Team ${settings.teams[side]} match ${match + 1} player ${pos + 1}${flight ? ` (Flight ${flight})` : ''}: ${name || 'empty'}`;
  return `
    <button class="pc ${name ? `pc--${side}` : 'pc--empty'}" id="${slotId(slot)}" aria-expanded="${sameSlot(sel, slot)}" aria-label="${esc(label)}"
      data-slot data-mode="${mode}" data-match="${match}" data-side="${side}" data-pos="${pos}">
      <span class="pc__name">${name ? esc(name) : flight ? `Flight ${flight}` : 'Select'}</span><span class="num">${name ? hcp : '+'}</span>
    </button>`;
}

/** The open slot's candidates: everyone on that team in that flight, with those who can't be picked disabled. */
function renderTray() {
  const { mode, match, side, pos } = sel;
  const flight = slotFlight(match, pos, mode);
  const lineup = picks(mode);
  const current = lineup[match][side][pos];
  const where = new Map();
  lineup.forEach((m, i) => [...m.red, ...m.blue].filter(Boolean).forEach((n) => where.set(n, i)));
  const cards = players
    .filter((p) => fits(p, side, flight))
    .sort((a, b) => a.hcp - b.hcp)
    .map((p) => {
      const at = p.name === current ? undefined : where.get(p.name);
      const official = at != null && isLocked(at, mode);
      // Can't be drawn against an opponent already chosen in this match if they've met in another round.
      const met = p.name !== current
        ? lineup[match][otherSide(side)].map((opp) => metIn(p.name, opp, mode)).find(Boolean) : undefined;
      // A player who can't be picked shows why in place of their handicap.
      const blocked = official ? 'Official' : met ? `Played in ${met}` : '';
      const look = p.name === current ? `pc--${side} is-current` : at != null ? 'pc--moved' : `pc--${side}`;
      return `
        <button class="pc ${look}" data-pick="${esc(p.name)}"${blocked ? ' disabled' : ''}>
          <span class="pc__name"><span class="pc__label">${esc(p.name)}</span>${!blocked && at != null ? `<small>Match ${at + 1}</small>` : ''}</span>
          ${blocked ? `<small>${blocked}</small>` : `<span class="num">${formatPlaying(playing(p, mode))}</span>`}
        </button>`;
    }).join('');
  return `
    <div class="tray">
      <div class="tray__head eyebrow">
        <span>${flight ? `Flight ${flight} · ` : ''}Team ${esc(settings.teams[side])}</span>
        <span>
          ${current ? '<button class="eyebrow" data-action="remove">Remove</button>' : ''}
          <button class="eyebrow" data-action="close">Close</button>
        </span>
      </div>
      <div class="tray__grid">${cards}</div>
    </div>`;
}

function renderMatch(mode, match) {
  const m = picks(mode)[match];
  const singles = size(mode) === 1;
  const hcp = { red: sideHcp(m.red, mode), blue: sideHcp(m.blue, mode) };
  const complete = hcp.red != null && hcp.blue != null;
  const diff = complete ? strokes(hcp.red, hcp.blue) : 0;
  const receiver = complete && diff ? (hcp.red > hcp.blue ? 'red' : 'blue') : null;
  const who = receiver && (singles ? esc(m[receiver][0]) : `Team ${esc(settings.teams[receiver])}`);
  const rematch = rematchIn(m, mode);
  // The gold pill points at the side getting strokes.
  const mid = rematch || !complete ? 'vs'
    : receiver
      ? `<span class="gets"><span aria-hidden="true">${receiver === 'red' ? `‹ +${diff}` : `+${diff} ›`}</span><span class="visually-hidden">${who} gets ${diff} stroke${diff === 1 ? '' : 's'}</span></span>`
      : 'Even';
  const label = FORMATS[mode].slots[match];
  const open = sel?.mode === mode && sel.match === match;

  return `
    <div class="match">
      <header class="match__head">
        <h3>Match ${match + 1}${label ? ` <span class="flight">${label}</span>` : ''}</h3>
        <span class="match__tags">
          ${!singles && complete ? `<span class="num" title="Team handicaps">${formatPlaying(hcp.red)} v ${formatPlaying(hcp.blue)}</span>` : ''}
          ${isLocked(match, mode) && !locked[mode].every(Boolean) ? '<span class="official eyebrow">Official</span>' : ''}
        </span>
      </header>
      <div class="match__row">
        ${SIDES.map((side) => `<div class="match__side">${m[side].map((_, pos) => renderSlot({ mode, match, side, pos })).join('')}</div>`)
          .join(`<div class="match__mid eyebrow">${mid}</div>`)}
      </div>
      ${rematch ? `<p class="match__bad">Rematch: ${esc(rematch[0])} and ${esc(rematch[1])} already played in ${FORMATS[rematch[2]].title}.</p>` : ''}
      ${open ? renderTray() : ''}
    </div>`;
}

function renderColumn(mode) {
  const totals = { red: 0, blue: 0 };
  let complete = 0;
  for (const m of picks(mode)) {
    const r = sideHcp(m.red, mode);
    const b = sideHcp(m.blue, mode);
    if (rematchIn(m, mode)) continue;
    if (r != null && b != null) { totals.red += r; totals.blue += b; complete++; }
  }
  const day = formatDay(mode);
  const total = (side) => `
    <div><span class="eyebrow fg-${side}">${esc(settings.teams[side])} total</span><strong>${complete ? formatPlaying(round1(totals[side])) : '—'}</strong></div>`;

  return `
    <section class="card col${mode === state.mode ? ' is-active' : ''}" aria-label="${FORMATS[mode].title}">
      <header class="col__head">
        <div>
          <h2 class="eyebrow">${day ? `Day ${day.round} · ` : ''}${FORMATS[mode].title}</h2>
          <span class="col__course">${basisText(mode)}</span>
        </div>
        ${locked[mode].every(Boolean) ? '<span class="official eyebrow">Official</span>' : `
        <div class="col__tools">
          <button class="col__btn eyebrow" data-action="random" data-for="${mode}">${mode === 'Singles' ? 'Auto fill' : 'Random'}</button>
          <button class="col__btn eyebrow" data-action="clear" data-for="${mode}">Clear</button>
        </div>`}
      </header>
      <div class="col__totals">
        ${total('red')}
        <div class="mid"><span class="eyebrow">${FORMATS[mode].sub}</span><br><span class="num">${complete} of ${matchCount(mode)}</span> set</div>
        ${total('blue')}
      </div>
      ${picks(mode).map((_, i) => renderMatch(mode, i)).join('')}
    </section>`;
}

function render() {
  faced = Object.fromEntries(MODES.map((m) => [m, buildFaced(m)]));
  const pct = (n) => `${Math.round(n * 100)}%`;
  const allLocked = MODES.every((m) => locked[m].every(Boolean));

  app.innerHTML = `
    <details class="help"${helpOpen ? ' open' : ''}>
      <summary class="eyebrow">How it works</summary>
      <p>Build a lineup for each round to see handicaps and strokes: choose a slot, then a player. In 2v2, team handicap is ${pct(settings.lowerPct)} of the lower handicap plus ${pct(settings.higherPct)} of the higher; in singles, strokes are the difference between the two players' handicaps. Singles are flight-matched (A v A, B v B). Nobody plays the same opponent twice across the three rounds, so opponents a player has already met are unavailable. Matchups marked Official come from the posted tee sheet and can't be changed here.${courseMode() ? ' Handicaps are course handicaps (Index × Slope ÷ 113 + Rating − Par) for the course where each format is played.' : ''} This is a preview only; official matchups are posted on the Schedule.</p>
    </details>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Format">
        ${scheduledModes().map((m) => `<button class="eyebrow" data-mode="${m}" aria-pressed="${m === state.mode}">${FORMATS[m].title}</button>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn" data-action="fill-all"${allLocked ? ' disabled' : ''}>Fill all</button>
        <button class="btn" data-action="clear-all"${allLocked ? ' disabled' : ''}>Clear all</button>
        <button class="btn btn--solid" data-action="share">Copy link</button>
      </div>
    </div>
    <div class="board">${scheduledModes().map(renderColumn).join('')}</div>`;
}

// ---------- Events ----------

// toggle doesn't bubble, so listen in the capture phase.
app.addEventListener('toggle', (e) => {
  if (e.target.matches('details.help')) helpOpen = e.target.open;
}, true);

/** Re-renders, keeping keyboard focus on the open slot (or the one just closed). */
function update(focus = sel) {
  writeHash();
  render();
  if (focus) document.getElementById(slotId(focus))?.focus();
}

app.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const was = sel;
  const { action } = btn.dataset;
  if ('slot' in btn.dataset) {
    const slot = { mode: btn.dataset.mode, match: +btn.dataset.match, side: btn.dataset.side, pos: +btn.dataset.pos };
    sel = sameSlot(sel, slot) ? null : slot;
    state.mode = slot.mode;
    return update(slot);
  }
  if (btn.dataset.mode) {
    state.mode = btn.dataset.mode;
    if (sel?.mode !== state.mode) sel = null;
    return update();
  }
  if ('pick' in btn.dataset) pick(btn.dataset.pick);
  else if (action === 'remove') picks(sel.mode)[sel.match][sel.side][sel.pos] = '';
  else if (action === 'close') sel = null;
  else if (action === 'random') { sel = null; randomFill(btn.dataset.for); }
  else if (action === 'clear') { sel = null; clearEditable(btn.dataset.for); }
  else if (action === 'fill-all') { sel = null; fillAll(); }
  else if (action === 'clear-all') { sel = null; MODES.forEach(clearEditable); }
  else if (action === 'share') {
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'Copied!';
    } catch {
      prompt('Copy this link:', location.href);
    }
    setTimeout(() => { btn.textContent = 'Copy link'; }, 1500);
    return;
  } else return;
  update(sel ?? was);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !sel) return;
  const was = sel;
  sel = null;
  update(was);
});

// replaceState doesn't fire this, so it only runs for pasted/edited links.
window.addEventListener('hashchange', () => {
  state.picks = allEmpty();
  sel = null;
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
