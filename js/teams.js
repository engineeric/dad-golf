import { loadData } from './sheet.js';
import { SIDES, formatHcp, round1 } from './golf.js';
import { applyEdition, esc, renderChrome, showError } from './ui.js';

renderChrome('teams');
const app = document.getElementById('app');

const avg = (ps) => (ps.length ? round1(ps.reduce((s, p) => s + p.hcp, 0) / ps.length) : null);

function renderPanel(side, teamName, roster) {
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
          ${p.captain ? '<span class="roster__tag eyebrow">Captain</span>' : ''}
          <span class="roster__hcp num">${formatHcp(p.hcp)}</span>
        </li>`).join('')}`;
  }).join('');

  return `
    <section class="card">
      <div class="team-head bg-${side}">
        <div>
          <span class="eyebrow">${roster.length} Players</span>
          <h2>Team ${esc(teamName)}</h2>
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
  const { players, settings } = await loadData();
  applyEdition(settings.edition);
  app.innerHTML = `<div class="teams">${SIDES.map((side) =>
    renderPanel(side, settings.teams[side], players.filter((p) => p.side === side))).join('')}</div>`;
} catch (err) {
  showError(app, err);
}
