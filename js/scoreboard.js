import { loadData } from './sheet.js';
import {
  SIDES, TOTAL_POINTS, TO_WIN, awards, buildDays, currentDay, datedDays, dayTitle, daysUntil, formatDate, formatHcp, formatPts,
  formatTime, isDayComplete, isDayLive, loserResult, projectedPoints, formatPlaying, playerStandings, points, sideHandicap, strokes,
} from './golf.js';
import { ICONS, applyEdition, esc, holeBadge, playerChip, renderChrome, showError, withDemo } from './ui.js';

const REFRESH_MS = 60_000;

renderChrome('scoreboard');
const app = document.getElementById('app');
const banner = document.getElementById('banner');

// Expanded <details> survive the auto-refresh re-render.
const openPlayers = new Set();
const openDays = new Set();
/** One line: days to go before day 1, "Day N" on each day ("· Live" while it's on), "Final" once every match has a result. */
function renderBanner(played, days, settings, liveDay) {
  const tz = settings.timezone;
  const today = currentDay(days, tz);
  const first = datedDays(days)[0];
  let title;
  if (played === TOTAL_POINTS) title = 'Final';
  else if (today) title = `Day ${today.round}`;
  else if (first) {
    const n = daysUntil(first.date, tz);
    title = `${n} day${n === 1 ? '' : 's'} to go`;
  } else title = `The Daddy Invitational ${settings.edition}`;
  banner.innerHTML = liveDay
    ? `<h1><span class="live-dot live-dot--banner" aria-hidden="true"></span>Day ${liveDay.round} · Live</h1>`
    : `<h1>${esc(title)}</h1>`;
}

function heroStatus(pts, played, teams) {
  const clinched = SIDES.find((side) => pts[side] >= TO_WIN);
  if (clinched) return `Team ${teams[clinched]} has clinched`;
  if (played === TOTAL_POINTS) return 'All matches complete';
  if (!played) return `${TOTAL_POINTS} matches · ${TOTAL_POINTS} points`;
  return `${played} of ${TOTAL_POINTS} matches complete`;
}

function renderHero(pts, played, teams, projected) {
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
      ${projected ? `
        <div class="projected" aria-label="Projected score if every match ended now">
          <span class="fg-red num">${formatPts(projected.red)}</span>
          <span class="eyebrow">Projected</span>
          <span class="fg-blue num">${formatPts(projected.blue)}</span>
        </div>` : ''}
    </section>`;
}

/** Handicaps for both sides and the strokes the higher side receives. */
function matchStrokes(match, players, settings, day) {
  const hcp = Object.fromEntries(SIDES.map((side) => [side, match[side].length ? sideHandicap(match[side], players, settings, day) : null]));
  const n = hcp.red != null && hcp.blue != null ? strokes(hcp.red, hcp.blue) : 0;
  return { hcp, n, receiver: n ? (hcp.red > hcp.blue ? 'red' : 'blue') : null };
}

function renderSide(side, names, match, info) {
  const state = match.winner === side ? `won--${side}` : match.winner && match.winner !== 'Halved' ? 'lost'
    : match.status === 'live' && match.leader === side ? `lead--${side}` : '';
  const label = names.length ? names.map(esc).join('<br>') : '<span class="tba">TBD</span>';
  const hcp = info.hcp[side];
  const gets = info.receiver === side ? `<span class="gets">+${info.n} stroke${info.n === 1 ? '' : 's'}</span>` : '';
  return `
    <div class="side side--${side} ${state}">
      <span class="side__names">${label}</span>
      ${hcp != null ? `<span class="side__hcp num">${side === 'blue' ? gets : ''}${names.length > 1 ? `Team HCP ${formatHcp(hcp)}` : `HCP ${formatPlaying(hcp)}`}${side === 'red' ? gets : ''}</span>` : ''}
    </div>`;
}

/** Pill plus a "Thru N" / "Final" line; once the whole day is final, the pill alone. */
function renderResult(m, teams, dayComplete) {
  const final = dayComplete ? '' : '<span class="eyebrow">Final</span>';
  if (m.winner === 'Halved') {
    return `<span class="pill pill--halved">${esc(m.result || 'Halved')}</span>${final}`;
  }
  if (m.winner) {
    return `<span class="pill bg-${m.winner}" aria-label="Team ${esc(teams[m.winner])} won ${esc(m.result)}">${esc(m.result || 'Won')}</span>${final}`;
  }
  if (m.status === 'live') {
    const square = m.leader === 'AS';
    const label = square ? 'All square' : `Team ${teams[m.leader]} ${m.up} up`;
    return `
      <span class="pill pill--live ${square ? 'pill--square' : `fg-${m.leader}`}" aria-label="${esc(label)}">${square ? 'AS' : `${m.up} UP`}</span>
      <span class="eyebrow"><span class="live-dot" aria-hidden="true"></span>Thru ${m.thru}</span>`;
  }
  return `<span class="eyebrow">Match ${m.number}</span><span class="pill pill--upcoming">${m.teeTime ? formatTime(m.teeTime) : 'Upcoming'}</span>`;
}

function renderDay(day, players, settings, collapsible) {
  const pts = points(day.matches);
  const played = day.matches.some((m) => m.winner);
  const complete = isDayComplete(day);
  const expected = day.formatInfo?.slots.length;
  const course = day.course
    ? day.url ? `<a href="${esc(day.url)}" target="_blank" rel="noopener">${esc(day.course)}</a>` : esc(day.course)
    : '<span class="tba">Course TBA</span>';
  const rows = day.matches.length
    ? day.matches.map((m) => `
        <li class="match${m.winner === 'Halved' ? ' match--halved' : ''}">
          ${renderSide('red', m.red, m, matchStrokes(m, players, settings, day))}
          <div class="result">${renderResult(m, settings.teams, complete)}</div>
          ${renderSide('blue', m.blue, m, matchStrokes(m, players, settings, day))}
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
  const prizes = renderPrizes(day, players);
  if (collapsible) {
    return `
      <details class="card day-card" id="day-${day.round}" data-day="${day.round}"${openDays.has(day.round) ? ' open' : ''}>
        <summary>${head}</summary>
        <ol class="matches">${rows}</ol>
        ${prizes}
      </details>`;
  }
  return `
    <section class="card" id="day-${day.round}">
      ${head}
      <ol class="matches">${rows}</ol>
      ${prizes}
    </section>`;
}

/** The day's hole prizes as tiles: hole, prize and winner once awarded. */
function renderPrizes(day, players) {
  if (!day.prizes.length) return '';
  const tiles = day.prizes.map((p) => {
    const side = players.get(p.winner)?.side;
    return `
      <div class="prize">
        <div class="prize__title">${holeBadge(p.hole)}<span class="eyebrow">${esc(p.prize)}</span></div>
        ${p.winner ? (side ? playerChip(p.winner, side) : `<strong>${esc(p.winner)}</strong>`) : '<span class="tba">Not awarded yet</span>'}
      </div>`;
  }).join('');
  return `<div class="prizes"><span class="eyebrow prizes__label">Hole prizes</span><div class="prizes__grid">${tiles}</div></div>`;
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
  if (entry.type === 'prize') {
    return `
      <li class="log__row">
        <span class="eyebrow">Day ${entry.round}</span>
        <span class="log__who">${holeBadge(entry.hole)}<span>${esc(entry.prize)}</span></span>
        <span class="log__res res--P">Prize</span>
      </li>`;
  }
  const result = entry.outcome === 'L' ? loserResult(entry.result) : entry.result;
  const res = entry.outcome === 'H' ? 'Halved' : `${entry.outcome} ${result}`.trim();
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

function renderStandings(standings, stats) {
  const rows = standings.map((r) => `
    <details class="player" data-player="${esc(r.name)}"${openPlayers.has(r.name) ? ' open' : ''}>
      <summary class="lb__row">
        <span class="muted">${r.rank}</span>
        <span class="lb__name"><i class="dot bg-${r.side}"></i>${esc(r.name)}</span>
        <span class="num lb__pts">${formatPts(r.points)}</span>
        <span class="num">${record(r)}</span>
        <span class="num ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}">${signed(r.net)}</span>
        <span class="num${r.prizes ? '' : ' muted'}">${r.prizes || '—'}</span>
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
        <div class="lb__row lb__head eyebrow"><span>#</span><span>Player</span><span class="num">Pts</span><span class="num">W-L-H</span><span class="num">Net</span><span class="num lb__prz" title="Hole prizes won">${ICONS.flag}<span class="visually-hidden">Hole prizes</span></span><span class="num lb__best">Best</span></div>
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
    const liveDay = days.find((d) => isDayLive(d, data.settings.timezone)) ?? null;
    renderBanner(played, days, data.settings, liveDay);
    const standings = playerStandings(days, data.players);
    const final = played === TOTAL_POINTS;
    // The live day's card goes first; the rest keep their order.
    const ordered = liveDay ? [liveDay, ...days.filter((d) => d !== liveDay)] : days;
    app.innerHTML = `
      ${renderHero(pts, played, data.settings.teams, projectedPoints(days, liveDay))}
      ${renderMvp(data.settings, standings)}
      <div class="rounds">${ordered.map((d) => renderDay(d, players, data.settings, final)).join('')}</div>
      ${days.some(isDayComplete) ? renderStandings(standings, awards(standings, days, data.players, data.settings)) : ''}`;
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
