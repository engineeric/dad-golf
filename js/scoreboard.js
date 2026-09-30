import { loadData } from './sheet.js';
import {
  SIDES, TOTAL_POINTS, TO_WIN, awards, buildDays, dayTitle, formatDate, formatHcp, formatPts, formatTime, isDayComplete,
  playerStandings, points, teamHcp, tournamentStart,
} from './golf.js';
import { ICONS, applyEdition, esc, playerChip, renderChrome, showError, withDemo } from './ui.js';

const REFRESH_MS = 60_000;

renderChrome('scoreboard');
const app = document.getElementById('app');
const banner = document.getElementById('banner');

const DAY_MS = 86_400_000;
// Expanded <details> survive the auto-refresh re-render.
const openPlayers = new Set();
const openDays = new Set();
let start = null; // { day, teeTime, at } until play begins

function countdownParts(ms) {
  if (!start.teeTime) {
    const days = Math.ceil(ms / DAY_MS);
    return [[String(days), days === 1 ? 'Day to go' : 'Days to go']];
  }
  const s = Math.floor(ms / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return [
    [String(Math.floor(s / 86400)), 'Days'],
    [pad(Math.floor(s / 3600) % 24), 'Hrs'],
    [pad(Math.floor(s / 60) % 60), 'Min'],
    [pad(s % 60), 'Sec'],
  ];
}

function renderCountdown() {
  const el = document.getElementById('countdown');
  if (!el || !start) return;
  const ms = start.at - Date.now();
  if (ms <= 0) { start = null; refresh(); return; }
  el.innerHTML = countdownParts(ms)
    .map(([n, label]) => `<div><strong>${n}</strong><span class="eyebrow">${label}</span></div>`)
    .join('');
}

function renderBanner(pts, played, days, settings) {
  const { teams } = settings;
  const lead = pts.red > pts.blue ? 'red' : pts.blue > pts.red ? 'blue' : null;
  const winner = pts.red >= TO_WIN ? 'red' : pts.blue >= TO_WIN ? 'blue' : null;
  const score = `${formatPts(pts.red)}–${formatPts(pts.blue)}`;
  let title;
  let tint = null;
  start = null;
  if (winner) title = `Team ${teams[winner]} Wins the Cup`;
  else if (played === TOTAL_POINTS) title = `Halved ${score}`;
  else if (!played) {
    const next = tournamentStart(days, settings.timezone);
    if (!next) title = `The Daddy Invitational ${settings.edition}`;
    else if (next.at > Date.now()) {
      start = next;
      title = `Tees Off ${formatDate(next.day.date)}${next.teeTime ? ` · ${formatTime(next.teeTime)}` : ''}`;
    } else title = `Day ${next.day.round} Underway`;
  } else if (lead) {
    const other = lead === 'red' ? 'blue' : 'red';
    title = `Team ${teams[lead]} Leads ${formatPts(pts[lead])}–${formatPts(pts[other])}`;
    tint = lead;
  } else title = `All Square ${score}`;
  banner.className = `banner${tint ? ` bg-${tint}` : ''}`;
  banner.innerHTML = `<h1>${esc(title)}</h1>${start ? '<div class="countdown" id="countdown" role="timer"></div>' : ''}`;
  renderCountdown();
}

function heroStatus(pts, played, teams) {
  const clinched = SIDES.find((side) => pts[side] >= TO_WIN);
  if (clinched) return `Team ${teams[clinched]} has clinched`;
  if (played === TOTAL_POINTS) return 'All matches complete';
  if (!played) return `${TOTAL_POINTS} matches · ${TOTAL_POINTS} points`;
  return `${played} of ${TOTAL_POINTS} matches complete`;
}

function renderHero(pts, played, teams) {
  const pct = (n) => `${(n / TOTAL_POINTS) * 100}%`;
  const champion = SIDES.find((side) => pts[side] >= TO_WIN);
  const team = (side) => `
    <div class="hero__team hero__team--${side} bg-${side}">
      ${side === champion ? `<span class="hero__trophy" role="img" aria-label="Cup winner">${ICONS.trophy}</span>` : ''}
      <div class="hero__text">
        <span class="eyebrow">Team</span>
        <h2>${esc(teams[side])}</h2>
        <span class="hero__pts">${formatPts(pts[side])}</span>
      </div>
    </div>`;
  return `
    <section class="card" aria-label="Overall score">
      <div class="hero">
        ${team('red')}
        <div class="hero__mid">
          <span class="eyebrow">Points to win</span>
          <strong>${formatPts(TO_WIN)}</strong>
          <span class="hero__status">${esc(heroStatus(pts, played, teams))}</span>
        </div>
        ${team('blue')}
      </div>
      <div class="pointsbar" aria-hidden="true">
        <span class="g" style="width:${pct(pts.red)}"></span>
        <span class="e" style="width:${pct(pts.blue)}"></span>
      </div>
    </section>`;
}

function sideHcp(names, players, settings) {
  const hcps = names.map((n) => players.get(n)?.hcp).filter((h) => h != null);
  if (hcps.length !== names.length || !names.length) return '';
  if (hcps.length === 1) return `HCP ${formatHcp(hcps[0])}`;
  return `Team HCP ${formatHcp(teamHcp(hcps[0], hcps[1], settings))}`;
}

function renderSide(side, names, match, players, settings) {
  const state = match.winner === side ? `won--${side}` : match.winner && match.winner !== 'Halved' ? 'lost' : '';
  const label = names.length ? names.map(esc).join('<br>') : '<span class="tba">TBD</span>';
  return `
    <div class="side side--${side} ${state}">
      <span class="side__names">${label}</span>
      <span class="side__hcp num">${sideHcp(names, players, settings)}</span>
    </div>`;
}

function renderResult(m, teams) {
  if (m.winner === 'Halved') {
    return `<span class="pill pill--halved">${esc(m.result || 'Halved')}</span>`;
  }
  if (m.winner) {
    return `<span class="eyebrow">${esc(teams[m.winner])}</span><span class="pill bg-${m.winner}">${esc(m.result || 'Won')}</span>`;
  }
  return `<span class="eyebrow">Match ${m.number}</span><span class="pill pill--upcoming">${m.teeTime ? formatTime(m.teeTime) : 'Upcoming'}</span>`;
}

function renderDay(day, players, settings, collapsible) {
  const pts = points(day.matches);
  const played = day.matches.some((m) => m.winner);
  const expected = day.formatInfo?.slots.length;
  const course = day.course
    ? day.url ? `<a href="${esc(day.url)}" target="_blank" rel="noopener">${esc(day.course)}</a>` : esc(day.course)
    : '<span class="tba">Course TBA</span>';
  const rows = day.matches.length
    ? day.matches.map((m) => `
        <li class="match">
          ${renderSide('red', m.red, m, players, settings)}
          <div class="result">${renderResult(m, settings.teams)}</div>
          ${renderSide('blue', m.blue, m, players, settings)}
        </li>`).join('')
    : `<li class="empty-row tba">Matchups TBA${expected ? ` · ${expected} matches` : ''}</li>`;

  const head = `
      <header class="round__head">
        <div>
          <span class="eyebrow">Day ${day.round}${day.date ? ` · ${esc(formatDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' }))}` : ''}${day.formatInfo ? ` · ${esc(day.formatInfo.sub)}` : ''}</span>
          <h2>${esc(dayTitle(day))}</h2>
          <div class="round__course">${course} · <a href="${withDemo(`schedule.html#day-${day.round}`)}">Schedule →</a></div>
        </div>
        ${played ? `
          <div class="round__score num" aria-label="Day ${day.round} score">
            <span class="fg-red">${formatPts(pts.red)}</span><span class="dash">|</span><span class="fg-blue">${formatPts(pts.blue)}</span>
          </div>` : ''}
      </header>`;
  if (collapsible) {
    return `
      <details class="card day-card" id="day-${day.round}" data-day="${day.round}"${openDays.has(day.round) ? ' open' : ''}>
        <summary>${head}</summary>
        <ol class="matches">${rows}</ol>
      </details>`;
  }
  return `
    <section class="card" id="day-${day.round}">
      ${head}
      <ol class="matches">${rows}</ol>
    </section>`;
}

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const record = (r) => `${r.w}-${r.l}-${r.h}`;

function renderMvp(settings, standings) {
  const r = settings.mvp && standings.find((x) => x.name === settings.mvp);
  if (!r) return '';
  return `
    <section class="card mvp" aria-label="Tournament MVP">
      <span class="mvp__icon">${ICONS.star}</span>
      <div class="mvp__body">
        <span class="eyebrow">Tournament MVP</span>
        <strong>${esc(r.name)}</strong>
        <span class="muted num">${formatPts(r.points)} pts · ${record(r)} · ${signed(r.net)} holes</span>
      </div>
      <span class="pill bg-${r.side}">Team ${esc(settings.teams[r.side])}</span>
    </section>`;
}

function renderAward(title, award) {
  if (!award) return '';
  return `
    <div class="card award">
      <span class="eyebrow">${esc(award.title ?? title)}</span>
      <strong${award.side ? ` class="fg-${award.side}"` : ''}>${esc(award.names)}</strong>
      <span class="muted">${esc(award.label)}</span>
    </div>`;
}

function renderLog(entry) {
  const res = entry.outcome === 'H' ? 'Halved' : `${entry.outcome} ${entry.result}`.trim();
  return `
    <li class="log__row">
      <span class="eyebrow">Day ${entry.round}</span>
      <span class="log__who">
        ${entry.partners.length ? `<span class="muted">w/ ${entry.partners.map(esc).join(' & ')}</span>` : ''}
        <span class="muted">vs</span>
        ${entry.opponents.map((n) => playerChip(n, entry.opponentSide)).join('')}
      </span>
      <span class="log__res res--${entry.outcome}">${esc(res)}</span>
    </li>`;
}

function renderStandings(standings, stats, settings) {
  const rows = standings.map((r) => `
    <details class="player${r.name === settings.mvp ? ' is-mvp' : ''}" data-player="${esc(r.name)}"${openPlayers.has(r.name) ? ' open' : ''}>
      <summary class="lb__row">
        <span class="muted">${r.rank}</span>
        <span class="lb__name"><i class="dot bg-${r.side}"></i>${esc(r.name)}</span>
        <span class="num lb__pts">${formatPts(r.points)}</span>
        <span class="num">${record(r)}</span>
        <span class="num ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}">${signed(r.net)}</span>
        <span class="num lb__best">${r.best ? esc(r.best.text) : '—'}</span>
      </summary>
      <ol class="log">${r.log.length ? r.log.map(renderLog).join('') : '<li class="log__row muted">No matches yet</li>'}</ol>
    </details>`).join('');
  return `
    <section class="standings" aria-label="Player standings">
      <div class="awards">
        ${renderAward('Points leader', stats.pointsLeader)}
        ${renderAward('Locked in', stats.lockedIn)}
        ${renderAward('Biggest win', stats.biggestWin)}
        ${renderAward('Toughest loss', stats.toughestLoss)}
        ${renderAward('Stroke killer', stats.strokeKiller)}
      </div>
      <div class="card">
        <header class="lb__title"><h2>Player standings</h2><span class="eyebrow">Tap a player for match log</span></header>
        <div class="lb__row lb__head eyebrow"><span>#</span><span>Player</span><span class="num">Pts</span><span class="num">W-L-H</span><span class="num">Net</span><span class="num lb__best">Best</span></div>
        ${rows}
      </div>
    </section>`;
}

async function refresh() {
  try {
    const data = await loadData();
    applyEdition(data.settings.edition);
    const players = new Map(data.players.map((p) => [p.name, p]));
    const days = buildDays(data);
    const all = days.flatMap((d) => d.matches);
    const pts = points(all);
    const played = all.filter((m) => m.winner).length;
    renderBanner(pts, played, days, data.settings);
    const standings = playerStandings(days, data.players);
    const final = played === TOTAL_POINTS;
    app.innerHTML = `
      ${renderHero(pts, played, data.settings.teams)}
      ${renderMvp(data.settings, standings)}
      <div class="rounds">${days.map((d) => renderDay(d, players, data.settings, final)).join('')}</div>
      ${days.some(isDayComplete) ? renderStandings(standings, awards(standings, days, data.players, data.settings), data.settings) : ''}`;
  } catch (err) {
    showError(app, err);
  }
}

// toggle doesn't bubble, so listen in the capture phase.
app.addEventListener('toggle', (e) => {
  const el = e.target;
  const [set, id] = el.dataset.player != null ? [openPlayers, el.dataset.player]
    : el.dataset.day != null ? [openDays, +el.dataset.day] : [];
  if (!set) return;
  if (el.open) set.add(id); else set.delete(id);
}, true);

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
setInterval(renderCountdown, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
