import { loadData } from './sheet.js';
import { CAPTAINS, TEAMS, formatHcp, round1 } from './golf.js';
import { esc, renderChrome, showError } from './ui.js';

renderChrome('teams');
const app = document.getElementById('app');

const avg = (ps) => (ps.length ? round1(ps.reduce((s, p) => s + p.hcp, 0) / ps.length) : null);

function renderPanel(team, roster) {
  const flights = [...new Set(roster.map((p) => p.flight))].sort();
  let slot = 0;
  const rows = flights.map((f) => {
    const ps = roster.filter((p) => p.flight === f).sort((a, b) => a.hcp - b.hcp);
    return `
      <li class="roster__group eyebrow"><span>Flight ${esc(f)}</span><span class="roster__hcp num">Avg ${formatHcp(avg(ps))}</span></li>
      ${ps.map((p) => `
        <li>
          <span class="roster__slot num">${String(++slot).padStart(2, '0')}</span>
          <span class="roster__name">${esc(p.name)}</span>
          ${CAPTAINS[team] === p.name ? '<span class="roster__tag eyebrow">Captain</span>' : ''}
          <span class="roster__hcp num">${formatHcp(p.hcp)}</span>
        </li>`).join('')}`;
  }).join('');

  return `
    <section class="card">
      <div class="team-head bg-${team.toLowerCase()}">
        <div>
          <span class="eyebrow">${roster.length} Players</span>
          <h2>Team ${esc(team)}</h2>
        </div>
        <div class="team-head__stat">
          <strong>${formatHcp(avg(roster))}</strong>
          <span class="eyebrow">Avg HCP</span>
        </div>
      </div>
      <ul class="roster">${rows}</ul>
    </section>`;
}

try {
  const { players } = await loadData();
  const byTeam = Object.fromEntries(TEAMS.map((t) => [t, players.filter((p) => p.team === t)]));
  app.innerHTML = `<div class="teams">${TEAMS.map((t) => renderPanel(t, byTeam[t])).join('')}</div>`;
} catch (err) {
  showError(app, err);
}
