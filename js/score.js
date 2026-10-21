// Hole-by-hole score entry (score.html). Players sign in once with an emailed link, then
// tap who won each hole. Entries save on the phone first and send when there's signal.

import { DEMO, loadData } from './sheet.js';
import { HOLES, buildDays, daysUntil, formatTime, holeState, matchStrokes, strokeHoles } from './golf.js';
import { applyEdition, esc, renderChrome, showError, withDemo } from './ui.js';

renderChrome('score', { label: 'Keep score', nav: false });
const app = document.getElementById('app');

const REFRESH_MS = 30_000;
const RETRY_MS = 5_000;
// A sent entry keeps showing until the sheet (which can lag a minute or two) has caught up.
const SENT_GRACE_MS = 10 * 60_000;

// Demo mode keeps its own sign-in and queue, so testing never touches a real one.
const PREFIX = DEMO ? `demo.${DEMO}.` : '';
const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(PREFIX + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(PREFIX + k); } catch { /* storage unavailable */ } },
};
const K = { key: 'daddy.score.key', me: 'daddy.score.me', queue: 'daddy.score.queue', sent: 'daddy.score.sent', pick: 'daddy.score.pick' };

const state = {
  data: null,
  days: [],
  players: new Map(),
  me: null, // { name, admin }
  pick: null, // { round, match } for admins
  hole: null, // 0-based selected hole
  holeFor: null, // which match `hole` belongs to
  errors: [], // rejected entries to explain
  sending: false,
  off: false,
};

// ---------- Sign-in key ----------

// The emailed link carries the key after "#", which never reaches a server; store it and tidy the URL.
const fromLink = location.hash.match(/k=([A-Za-z0-9-]{16,})/);
if (fromLink) {
  store.set(K.key, fromLink[1]);
  store.del(K.me);
  history.replaceState(null, '', location.pathname + location.search);
}

function signOut() {
  [K.key, K.me, K.queue, K.sent, K.pick].forEach((k) => store.del(k));
  state.me = null;
  renderSignIn();
}

// ---------- Web app ----------

async function api(body) {
  if (DEMO) return demoApi(body);
  const res = await fetch(state.data.settings.scoreAppUrl, {
    method: 'POST',
    // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Stand-in for the web app in demo mode: "name@anything" signs in as that player; Eric is admin. */
function demoApi(body) {
  // localStorage "demo.offline" = "1" simulates no signal, to test the queue.
  if (localStorage.getItem('demo.offline')) throw new TypeError('Failed to fetch');
  const nameFrom = (s) => [...state.players.keys()].find((n) => n.toLowerCase() === String(s).toLowerCase());
  if (body.action === 'link') {
    const name = nameFrom(String(body.email).split('@')[0]);
    return { ok: true, demoLink: name ? `${location.pathname}${location.search}#k=demo-key-${name}-0000` : null };
  }
  const name = nameFrom(String(body.key).replace(/^demo-key-|-0000$/g, ''));
  if (!name) return { error: 'This link is no longer valid. Request a new one.', code: 'badkey' };
  if (body.action === 'me') return { name, admin: name === 'Eric', holeEntry: true };
  const today = todayDay()?.round;
  const locked = today != null && dayLocked(state.days.find((d) => d.round === today));
  const saved = [];
  const rejected = [];
  const all = JSON.parse(localStorage.getItem(`demo.scores.${DEMO}`) || '[]');
  const teams = state.data.settings.teams;
  for (const e of body.entries) {
    const id = entryId(e);
    const m = findMatch(e.round, e.match);
    if (name !== 'Eric' && (e.round !== today || ![...m.red, ...m.blue].includes(name))) { rejected.push({ id, why: 'not your match' }); continue; }
    if (name !== 'Eric' && locked) { rejected.push({ id, why: 'locked' }); continue; }
    all.push({ ...e, result: e.result === 'halved' ? 'Halved' : teams[e.result] ?? '', by: name });
    saved.push(id);
  }
  localStorage.setItem(`demo.scores.${DEMO}`, JSON.stringify(all));
  return { ok: true, saved, rejected };
}

// ---------- Queue ----------

const entryId = (e) => `${e.round}-${e.match}-${e.hole}`;

/** Saves on the phone first; the queue is sent in the background. */
function enter(round, match, hole, result) {
  const entry = { round, match, hole, result, at: Date.now() };
  const queue = store.get(K.queue, []).filter((e) => entryId(e) !== entryId(entry));
  store.set(K.queue, [...queue, entry]);
  state.errors = state.errors.filter((x) => x.id !== entryId(entry));
  flush();
}

async function flush() {
  const queue = store.get(K.queue, []);
  if (!queue.length || state.sending || state.off) return;
  state.sending = true;
  renderSync();
  try {
    const res = await api({ action: 'post', key: store.get(K.key), entries: queue });
    if (res.code === 'badkey') return signOut();
    if (res.code === 'off') { state.off = true; return render(); }
    if (res.error) throw new Error(res.error);
    const saved = new Set(res.saved);
    const rejected = new Map(res.rejected.map((x) => [x.id, x.why]));
    // Only drop exactly what was sent: a newer tap on the same hole stays queued.
    const sentNow = queue.filter((e) => saved.has(entryId(e)));
    const done = new Set(queue.filter((e) => saved.has(entryId(e)) || rejected.has(entryId(e))).map((e) => `${entryId(e)}@${e.at}`));
    store.set(K.queue, store.get(K.queue, []).filter((e) => !done.has(`${entryId(e)}@${e.at}`)));
    store.set(K.sent, [...store.get(K.sent, []).filter((e) => !sentNow.some((s) => entryId(s) === entryId(e))), ...sentNow.map((e) => ({ ...e, sentAt: Date.now() }))]);
    state.errors = [...state.errors.filter((x) => !rejected.has(x.id)), ...[...rejected].map(([id, why]) => ({ id, why }))];
  } catch {
    // No signal or the web app didn't answer: keep the queue and try again shortly.
  } finally {
    state.sending = false;
    render();
  }
}

setInterval(() => { if (store.get(K.queue, []).length) flush(); }, RETRY_MS);
addEventListener('online', flush);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { flush(); refresh(); } });

// ---------- Data ----------

const todayDay = () => state.days.find((d) => d.date && daysUntil(d.date, state.data.settings.timezone) === 0) ?? null;
const findMatch = (round, match) => state.days.find((d) => d.round === round)?.matches.find((m) => m.number === match) ?? null;

/** The match on screen: the player's own today, or the admin's pick. */
function currentMatch() {
  if (state.me?.admin) {
    const pick = state.pick && findMatch(state.pick.round, state.pick.match);
    if (pick) return { day: state.days.find((d) => d.round === state.pick.round), match: pick };
    const day = todayDay() ?? state.days.find((d) => d.matches.length);
    return day?.matches[0] ? { day, match: day.matches[0] } : null;
  }
  const day = todayDay();
  const match = day?.matches.find((m) => [...m.red, ...m.blue].includes(state.me?.name));
  return match ? { day, match } : null;
}

/** Each hole's result, newest wins between the sheet and this phone's queued or recently sent entries. */
function holesFor(round, match) {
  const best = Array.from({ length: HOLES }, () => ({ result: null, at: -Infinity, pending: false }));
  for (const x of state.data.scores) {
    if (x.round === round && x.match === match && x.at >= best[x.hole - 1].at) best[x.hole - 1] = { result: x.result, at: x.at, pending: false };
  }
  const local = [...store.get(K.sent, []).map((e) => ({ ...e, pending: false })), ...store.get(K.queue, []).map((e) => ({ ...e, pending: true }))];
  for (const e of local) {
    if (e.round !== round || e.match !== match) continue;
    const slot = best[e.hole - 1];
    if (e.at >= slot.at) best[e.hole - 1] = { result: e.result || null, at: e.at, pending: e.pending };
  }
  return best;
}

/** A day locks for players once every match has a result on all 18 holes (the web app enforces it too). */
const dayLocked = (day) => day.matches.length > 0 && day.matches.every((m) => holesFor(day.round, m.number).every((h) => h.result));

/** Drops sent entries once the sheet shows them (or after the grace period). */
function pruneSent() {
  const now = Date.now();
  store.set(K.sent, store.get(K.sent, []).filter((e) => {
    if (now - e.sentAt > SENT_GRACE_MS) return false;
    return !state.data.scores.some((x) => x.round === e.round && x.match === e.match && x.hole === e.hole && x.at >= e.at);
  }));
}

async function refresh() {
  if (!state.me) return;
  try {
    await load();
    render();
  } catch {
    // Offline: keep showing what we have.
  }
}

async function load() {
  state.data = await loadData();
  applyEdition(state.data.settings.edition);
  state.days = buildDays(state.data);
  state.players = new Map(state.data.players.map((p) => [p.name, p]));
  pruneSent();
}

// ---------- Rendering ----------

/**
 * Short labels for the scorecard rows: "BR/JK" for a pair (longer where partners would
 * collide, e.g. "COD/COL"), the nickname up to 6 letters for singles.
 */
function abbr(names) {
  if (names.length < 2) return (names[0] ?? '').slice(0, 6).toUpperCase();
  let n = 2;
  while (n < 6 && names[0].slice(0, n).toUpperCase() === names[1].slice(0, n).toUpperCase()) n++;
  return names.map((x) => x.slice(0, n)).join('/').toUpperCase();
}
const pair = (names) => names.map(esc).join(' / ');

function statusPill(s, teams) {
  if (s.status === 'final') {
    const pill = s.winner === 'Halved' ? '<span class="pill pill--halved">Halved</span>' : `<span class="pill bg-${s.winner}">${esc(s.result)}</span>`;
    return `${pill}<span class="eyebrow">Final</span>`;
  }
  if (s.status === 'live') {
    const pill = s.leader === 'AS' ? '<span class="pill pill--live pill--square">AS</span>'
      : `<span class="pill pill--live fg-${s.leader}" aria-label="Team ${esc(teams[s.leader])} ${s.up} up">${s.up} UP</span>`;
    return `${pill}<span class="eyebrow">Thru ${s.thru}</span>`;
  }
  return '<span class="pill pill--none">Not started</span>';
}

function scorecard(nine, holes, strokesFor, receiver, card, labels, sel) {
  const idx = Array.from({ length: 9 }, (_, i) => i + nine * 9);
  let net = 0;
  const running = holes.map((h) => (net += h.result === 'red' ? 1 : h.result === 'blue' ? -1 : 0));
  const cell = (i, side) => {
    const r = holes[i].result;
    const cls = [];
    let mark = '';
    if (r === side) { cls.push(`won-${side}`); mark = '+'; } else if (r === 'halved') { cls.push('halved'); mark = '0'; } else if (r) { cls.push('lost'); mark = '−'; }
    if (i === sel) cls.push('cur');
    if (holes[i].pending) cls.push('pending');
    const dots = side === receiver && strokesFor[i] ? `<span class="stroke">${'<i></i>'.repeat(strokesFor[i])}</span>` : '';
    return `<td data-hole="${i}" class="${cls.join(' ')}">${mark}${dots}</td>`;
  };
  const upCell = (i) => {
    if (!holes[i].result) return `<td data-hole="${i}"></td>`;
    const v = running[i];
    return v === 0 ? `<td data-hole="${i}" class="up-as">AS</td>` : `<td data-hole="${i}" class="up-${v > 0 ? 'red' : 'blue'}">${Math.abs(v)}</td>`;
  };
  return `
    <div class="sc"><table aria-label="Holes ${nine ? '10–18' : '1–9'}">
      <tr><th class="l">Hole</th>${idx.map((i) => `<th data-hole="${i}">${i + 1}</th>`).join('')}</tr>
      <tr class="par"><td class="l">Par</td>${idx.map((i) => `<td data-hole="${i}">${card[i]?.par ?? ''}</td>`).join('')}</tr>
      <tr class="hcp"><td class="l">Hcp</td>${idx.map((i) => `<td data-hole="${i}">${card[i]?.si ?? ''}</td>`).join('')}</tr>
      <tr class="red"><td class="l">${esc(labels.red)}</td>${idx.map((i) => cell(i, 'red')).join('')}</tr>
      <tr class="blue"><td class="l">${esc(labels.blue)}</td>${idx.map((i) => cell(i, 'blue')).join('')}</tr>
      <tr class="up"><td class="l">Up</td>${idx.map(upCell).join('')}</tr>
    </table></div>`;
}

const WHY = {
  'not today': 'Scores for that day are closed.',
  locked: 'Every match is in, so the day is locked. Ask Eric to fix anything.',
  'not your match': 'You can only enter scores for your own match.',
  'no match': "That match isn't in the sheet.",
  invalid: "That entry wasn't valid.",
};

function renderSync() {
  const el = app.querySelector('.sync');
  if (!el) return;
  const n = store.get(K.queue, []).length;
  const holes = `${n} hole${n === 1 ? '' : 's'}`;
  if (state.errors.length) {
    const e = state.errors[0];
    el.className = 'sync sync--error';
    el.textContent = `Hole ${e.id.split('-')[2]} wasn't saved. ${WHY[e.why] ?? e.why}`;
  } else if (n) {
    el.className = 'sync sync--warn';
    el.textContent = navigator.onLine === false ? `No signal · ${holes} waiting to send` : state.sending ? `Sending ${holes}…` : `${holes} waiting to send`;
  } else {
    el.className = 'sync';
    el.textContent = 'All holes saved';
  }
}

function renderPicker(current) {
  const options = state.days.flatMap((d) => d.matches.map((m) => {
    const value = `${d.round}-${m.number}`;
    const sel = current && current.day.round === d.round && current.match.number === m.number ? ' selected' : '';
    return `<option value="${value}"${sel}>Day ${d.round} · Match ${m.number} · ${esc(m.red.join(' / ') || 'TBD')} v ${esc(m.blue.join(' / ') || 'TBD')}</option>`;
  }));
  return `<select class="select" id="pick" aria-label="Match">${options.join('')}</select>`;
}

function render() {
  if (!state.me) return;
  const { settings } = state.data;
  if (state.off || !settings.holeEntry) return renderMessage('Score entry is off', 'Eric will post scores on the Scoreboard instead.');
  const current = currentMatch();
  const picker = state.me.admin ? renderPicker(current) : '';
  if (!current) {
    const next = state.days.find((d) => d.date && daysUntil(d.date, settings.timezone) > 0);
    return renderMessage('No match today', next ? `Scoring opens on tournament days. Your next round is day ${next.round}.` : 'Scoring opens on tournament days.', picker);
  }
  const { day, match } = current;
  const holes = holesFor(day.round, match.number);
  const key = `${day.round}-${match.number}`;
  if (state.holeFor !== key) {
    // Start on the first hole without a result.
    const first = holes.findIndex((h) => !h.result);
    state.hole = first < 0 ? HOLES - 1 : first;
    state.holeFor = key;
  }
  const i = state.hole;
  const info = matchStrokes(match, state.players, settings, day);
  const strokesFor = strokeHoles(info.n, day.card);
  const s = match.override ? match : holeState(holes.map((h) => h.result));
  const labels = { red: abbr(match.red), blue: abbr(match.blue) };
  const names = { red: pair(match.red), blue: pair(match.blue) };
  const got = strokesFor[i] && info.receiver;
  const res = holes[i].result;
  // After a close-out the remaining holes are still played, for the tiebreak.
  const missing = s.status === 'final' ? holes.slice(s.thru).findIndex((h) => !h.result) : -1;
  const closedNote = missing >= 0
    ? `<div class="note">Match final. Keep entering holes ${s.thru + missing + 1}–18; they count toward the tiebreak.</div>` : '';
  const overrideNote = match.override ? '<div class="note">Eric has posted this result by hand, so it overrides the holes below.</div>' : '';
  // Players get a read-only card once the day is locked; admins can always edit.
  const readOnly = !state.me.admin && dayLocked(day);
  const lockedNote = readOnly ? `<div class="note">Day ${day.round} is final. Scores are locked; ask Eric to fix anything.</div>` : '';

  app.innerHTML = `
    <div class="score">
      ${picker}
      <section class="mh" aria-label="Match">
        <span class="eyebrow">Day ${day.round} · ${esc(day.course || 'Course TBA')} · Match ${match.number}${match.teeTime ? ` · ${formatTime(match.teeTime)}` : ''}</span>
        <div class="mh__vs">
          <div class="mh__side mh__side--red">${names.red}<span class="mh__abbr">${esc(labels.red)}</span></div>
          <div class="mh__status">${statusPill(s, settings.teams)}</div>
          <div class="mh__side mh__side--blue">${names.blue}<span class="mh__abbr">${esc(labels.blue)}</span></div>
        </div>
      </section>
      ${lockedNote || `${overrideNote}${closedNote}`}
      ${scorecard(0, holes, strokesFor, info.receiver, day.card, labels, i)}
      ${scorecard(1, holes, strokesFor, info.receiver, day.card, labels, i)}
      <div class="key">+ won · − lost · 0 halved · <i></i> stroke</div>
      ${readOnly ? '' : `<section class="hole" aria-label="Hole ${i + 1}">
        <div class="hole__nav">
          <button type="button" data-go="-1"${i === 0 ? ' disabled' : ''}>‹ ${i || ''}</button>
          <div class="hole__title"><strong>Hole ${i + 1}</strong><span class="eyebrow">${day.card[i] ? `Par ${day.card[i].par ?? '—'} · Hcp ${day.card[i].si ?? '—'}` : ''}</span></div>
          <button type="button" data-go="1"${i === HOLES - 1 ? ' disabled' : ''}>${i < HOLES - 1 ? i + 2 : ''} ›</button>
        </div>
        ${got ? `<span class="gets">${names[info.receiver]} get${match[info.receiver].length > 1 ? '' : 's'} ${strokesFor[i] === 2 ? 'two strokes' : 'a stroke'}</span>` : ''}
        <div class="pick">
          <button type="button" class="r" data-result="red" aria-pressed="${res === 'red'}">${names.red}</button>
          <button type="button" class="h" data-result="halved" aria-pressed="${res === 'halved'}">Halved</button>
          <button type="button" class="b" data-result="blue" aria-pressed="${res === 'blue'}">${names.blue}</button>
        </div>
        ${res ? '<div class="pick__hint">Tap the selected result again to clear this hole.</div>' : ''}
      </section>`}
      <div class="sync"></div>
      <div class="who"><span>Signed in as ${esc(state.me.name)}${state.me.admin ? ' (admin)' : ''}</span><button type="button" id="signout">Sign out</button></div>
      <a class="who" href="${withDemo('index.html')}">‹ Scoreboard</a>
    </div>`;
  renderSync();
}

function renderMessage(title, text, extra = '') {
  app.innerHTML = `
    <div class="score">
      ${extra}
      <section class="panel"><h2>${esc(title)}</h2><p>${esc(text)}</p></section>
      ${state.me ? `<div class="who"><span>Signed in as ${esc(state.me.name)}</span><button type="button" id="signout">Sign out</button></div>` : ''}
      <a class="who" href="${withDemo('index.html')}">‹ Scoreboard</a>
    </div>`;
}

function renderSignIn(message = '') {
  app.innerHTML = `
    <div class="score">
      <form class="panel" id="signin" novalidate>
        <h2>Keep score</h2>
        <p>Enter your email and we'll send you a link that signs this phone in for the whole tournament.</p>
        <input type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" aria-label="Email" required>
        <button class="btn btn--solid" type="submit">Email me a link</button>
        <div class="error" role="alert">${esc(message)}</div>
      </form>
      <a class="who" href="${withDemo('index.html')}">‹ Scoreboard</a>
    </div>`;
}

// ---------- Events ----------

app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-hole], [data-go], [data-result], #signout');
  if (!t) return;
  if (t.id === 'signout') return signOut();
  const current = currentMatch();
  if (!current) return;
  if (t.dataset.hole != null) state.hole = +t.dataset.hole;
  else if (t.dataset.go) state.hole = Math.min(HOLES - 1, Math.max(0, state.hole + +t.dataset.go));
  else if (t.dataset.result && (state.me.admin || !dayLocked(current.day))) {
    const { day, match } = current;
    const holes = holesFor(day.round, match.number);
    const was = holes[state.hole].result;
    const result = was === t.dataset.result ? '' : t.dataset.result;
    enter(day.round, match.number, state.hole + 1, result);
    // A first entry moves on to the next hole; a correction stays put.
    if (!was && result && state.hole < HOLES - 1) state.hole += 1;
  }
  render();
});

app.addEventListener('change', (e) => {
  if (e.target.id !== 'pick') return;
  const [round, match] = e.target.value.split('-').map(Number);
  state.pick = { round, match };
  store.set(K.pick, state.pick);
  render();
});

app.addEventListener('submit', async (e) => {
  if (e.target.id !== 'signin') return;
  e.preventDefault();
  const form = e.target;
  const email = form.email.value.trim();
  const error = form.querySelector('.error');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !(DEMO && email.includes('@'))) {
    error.textContent = 'Enter your email address.';
    return;
  }
  const button = form.querySelector('button');
  button.disabled = true;
  error.textContent = '';
  try {
    const res = await api({ action: 'link', email });
    if (res.error) throw new Error(res.error);
    form.innerHTML = `
      <h2>Check your email</h2>
      <p>If ${esc(email)} is on the list, a link is on its way. Open it on this phone. It can take a minute, so check spam too.</p>
      ${res.demoLink ? `<a class="btn btn--gold" href="${esc(res.demoLink)}">Open demo link</a>` : ''}`;
  } catch {
    button.disabled = false;
    error.textContent = "Couldn't reach the score server. Check your signal and try again.";
  }
});

// The emailed link opens this page again with a new key; pick it up without a reload.
addEventListener('hashchange', () => {
  const m = location.hash.match(/k=([A-Za-z0-9-]{16,})/);
  if (!m) return;
  store.set(K.key, m[1]);
  store.del(K.me);
  history.replaceState(null, '', location.pathname + location.search);
  start();
});

// ---------- Start ----------

async function start() {
  try {
    await load();
  } catch (err) {
    return showError(app, err);
  }
  const { settings } = state.data;
  if (!settings.holeEntry || !settings.scoreAppUrl) {
    state.me = store.get(K.me, null);
    return renderMessage('Score entry is off', 'Eric will post scores on the Scoreboard instead.');
  }
  const key = store.get(K.key, null);
  if (!key) return renderSignIn();
  state.me = store.get(K.me, null);
  state.pick = store.get(K.pick, null);
  try {
    const res = await api({ action: 'me', key });
    if (res.code === 'badkey') { signOut(); return renderSignIn(res.error); }
    if (res.name) { state.me = { name: res.name, admin: !!res.admin }; store.set(K.me, state.me); }
  } catch {
    // Offline: carry on with the name from last time.
  }
  if (!state.me) return renderMessage("Can't reach the score server", 'Check your signal and reload this page.');
  render();
  flush();
}

if ('serviceWorker' in navigator) {
  // Only controls this page, so the rest of the site is never served from its cache.
  navigator.serviceWorker.register('sw.js', { scope: './score.html' }).catch(() => {});
}

start();
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
