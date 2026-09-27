import { loadData } from './sheet.js';
import {
  TOTAL_POINTS, TO_WIN, buildDays, dayTitle, formatDate, formatHcp, formatPts, formatTime, points, teamHcp,
  tournamentStart,
} from './golf.js';
import { esc, renderChrome, showError } from './ui.js';

const REFRESH_MS = 60_000;

renderChrome('scoreboard');
const app = document.getElementById('app');
const banner = document.getElementById('banner');

const DAY_MS = 86_400_000;
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
  const lead = pts.Garrett > pts.Eric ? 'Garrett' : pts.Eric > pts.Garrett ? 'Eric' : null;
  const winner = pts.Garrett >= TO_WIN ? 'Garrett' : pts.Eric >= TO_WIN ? 'Eric' : null;
  const score = `${formatPts(pts.Garrett)}–${formatPts(pts.Eric)}`;
  let title;
  let tint = null;
  start = null;
  if (winner) title = `Team ${winner} Wins the Cup`;
  else if (played === TOTAL_POINTS) title = `Halved ${score}`;
  else if (!played) {
    const next = tournamentStart(days, settings.timezone);
    if (!next) title = 'The Daddy Invitational IV';
    else if (next.at > Date.now()) {
      start = next;
      title = `Tees Off ${formatDate(next.day.date)}${next.teeTime ? ` · ${formatTime(next.teeTime)}` : ''}`;
    } else title = `Day ${next.day.round} Underway`;
  } else if (lead) {
    title = `Team ${lead} Leads ${lead === 'Garrett' ? score : `${formatPts(pts.Eric)}–${formatPts(pts.Garrett)}`}`;
    tint = lead;
  } else title = `All Square ${score}`;
  banner.className = `banner${tint ? ` bg-${tint.toLowerCase()}` : ''}`;
  banner.innerHTML = `<h1>${esc(title)}</h1>${start ? '<div class="countdown" id="countdown" role="timer"></div>' : ''}`;
  renderCountdown();
}

function heroStatus(pts, played) {
  if (pts.Garrett >= TO_WIN) return 'Team Garrett has clinched';
  if (pts.Eric >= TO_WIN) return 'Team Eric has clinched';
  if (played === TOTAL_POINTS) return 'All matches complete';
  if (!played) return `${TOTAL_POINTS} matches · ${TOTAL_POINTS} points`;
  return `${played} of ${TOTAL_POINTS} matches complete`;
}

function renderHero(pts, played) {
  const pct = (n) => `${(n / TOTAL_POINTS) * 100}%`;
  return `
    <section class="card" aria-label="Overall score">
      <div class="hero">
        <div class="hero__team bg-garrett">
          <span class="eyebrow">Team</span>
          <h2>Garrett</h2>
          <span class="hero__pts">${formatPts(pts.Garrett)}</span>
        </div>
        <div class="hero__mid">
          <span class="eyebrow">Points to win</span>
          <strong>${formatPts(TO_WIN)}</strong>
          <span class="hero__status">${esc(heroStatus(pts, played))}</span>
        </div>
        <div class="hero__team hero__team--eric bg-eric">
          <span class="eyebrow">Team</span>
          <h2>Eric</h2>
          <span class="hero__pts">${formatPts(pts.Eric)}</span>
        </div>
      </div>
      <div class="pointsbar" aria-hidden="true">
        <span class="g" style="width:${pct(pts.Garrett)}"></span>
        <span class="e" style="width:${pct(pts.Eric)}"></span>
      </div>
    </section>`;
}

function sideHcp(names, players, settings) {
  const hcps = names.map((n) => players.get(n)?.hcp).filter((h) => h != null);
  if (hcps.length !== names.length || !names.length) return '';
  if (hcps.length === 1) return `HCP ${formatHcp(hcps[0])}`;
  return `Team HCP ${formatHcp(teamHcp(hcps[0], hcps[1], settings))}`;
}

function renderSide(team, names, match, players, settings) {
  const state = match.winner === team ? `won--${team.toLowerCase()}` : match.winner && match.winner !== 'Halved' ? 'lost' : '';
  const label = names.length ? names.map(esc).join('<br>') : '<span class="tba">TBD</span>';
  return `
    <div class="side side--${team.toLowerCase()} ${state}">
      <span class="side__names">${label}</span>
      <span class="side__hcp num">${sideHcp(names, players, settings)}</span>
    </div>`;
}

function renderResult(m) {
  if (m.winner === 'Halved') {
    return `<span class="pill pill--halved">${esc(m.result || 'Halved')}</span>`;
  }
  if (m.winner) {
    return `<span class="eyebrow">${esc(m.winner)}</span><span class="pill bg-${m.winner.toLowerCase()}">${esc(m.result || 'Won')}</span>`;
  }
  return `<span class="eyebrow">Match ${m.number}</span><span class="pill pill--upcoming">${m.teeTime ? formatTime(m.teeTime) : 'Upcoming'}</span>`;
}

function renderDay(day, players, settings) {
  const pts = points(day.matches);
  const played = day.matches.some((m) => m.winner);
  const expected = day.formatInfo?.slots.length;
  const course = day.course
    ? day.url ? `<a href="${esc(day.url)}" target="_blank" rel="noopener">${esc(day.course)}</a>` : esc(day.course)
    : '<span class="tba">Course TBA</span>';
  const rows = day.matches.length
    ? day.matches.map((m) => `
        <li class="match">
          ${renderSide('Garrett', m.garrett, m, players, settings)}
          <div class="result">${renderResult(m)}</div>
          ${renderSide('Eric', m.eric, m, players, settings)}
        </li>`).join('')
    : `<li class="empty-row tba">Matchups TBA${expected ? ` · ${expected} matches` : ''}</li>`;

  return `
    <section class="card" id="day-${day.round}">
      <header class="round__head">
        <div>
          <span class="eyebrow">Day ${day.round}${day.date ? ` · ${esc(formatDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' }))}` : ''}${day.formatInfo ? ` · ${esc(day.formatInfo.sub)}` : ''}</span>
          <h2>${esc(dayTitle(day))}</h2>
          <div class="round__course">${course} · <a href="schedule.html#day-${day.round}">Schedule →</a></div>
        </div>
        ${played ? `
          <div class="round__score num" aria-label="Day ${day.round} score">
            <span class="fg-garrett">${formatPts(pts.Garrett)}</span><span class="dash">|</span><span class="fg-eric">${formatPts(pts.Eric)}</span>
          </div>` : ''}
      </header>
      <ol class="matches">${rows}</ol>
    </section>`;
}

async function refresh() {
  try {
    const data = await loadData();
    const players = new Map(data.players.map((p) => [p.name, p]));
    const days = buildDays(data);
    const all = days.flatMap((d) => d.matches);
    const pts = points(all);
    const played = all.filter((m) => m.winner).length;
    renderBanner(pts, played, days, data.settings);
    app.innerHTML = `
      ${renderHero(pts, played)}
      <div class="rounds">${days.map((d) => renderDay(d, players, data.settings)).join('')}</div>`;
  } catch (err) {
    showError(app, err);
  }
}

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
setInterval(renderCountdown, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
