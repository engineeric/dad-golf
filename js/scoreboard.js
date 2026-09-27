import { loadData } from './sheet.js';
import {
  TOTAL_POINTS, TO_WIN, buildDays, dayTitle, formatDate, formatHcp, formatPts, formatTime, points, teamHcp,
} from './golf.js';
import { esc, renderChrome, showError } from './ui.js';

const REFRESH_MS = 60_000;

renderChrome('scoreboard');
const app = document.getElementById('app');
const banner = document.getElementById('banner');

function renderBanner(pts, played, days) {
  const lead = pts.Garrett > pts.Eric ? 'Garrett' : pts.Eric > pts.Garrett ? 'Eric' : null;
  const winner = pts.Garrett >= TO_WIN ? 'Garrett' : pts.Eric >= TO_WIN ? 'Eric' : null;
  const score = `${formatPts(pts.Garrett)}–${formatPts(pts.Eric)}`;
  let title;
  let tint = null;
  if (winner) title = `Team ${winner} Wins the Cup`;
  else if (played === TOTAL_POINTS) title = `Halved ${score}`;
  else if (!played) {
    const first = days.find((d) => d.date);
    title = first ? `First Tee · ${formatDate(first.date)}` : 'The Daddy Invitational IV';
  } else if (lead) {
    title = `Team ${lead} Leads ${lead === 'Garrett' ? score : `${formatPts(pts.Eric)}–${formatPts(pts.Garrett)}`}`;
    tint = lead;
  } else title = `All Square ${score}`;
  banner.className = `banner${tint ? ` bg-${tint.toLowerCase()}` : ''}`;
  banner.innerHTML = `<h1>${esc(title)}</h1>`;
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
    renderBanner(pts, played, days);
    app.innerHTML = `
      ${renderHero(pts, played)}
      <div class="rounds">${days.map((d) => renderDay(d, players, data.settings)).join('')}</div>`;
  } catch (err) {
    showError(app, err);
  }
}

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
