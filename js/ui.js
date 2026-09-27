// Shared page chrome and small DOM helpers.

import { SHEET_URL } from './sheet.js';

const PAGES = [
  { id: 'scoreboard', label: 'Scoreboard', href: 'index.html' },
  { id: 'schedule', label: 'Schedule', href: 'schedule.html' },
  { id: 'teams', label: 'Teams', href: 'teams.html' },
  { id: 'matchups', label: 'Matchups', href: 'matchups.html' },
];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderChrome(pageId) {
  const page = PAGES.find((p) => p.id === pageId);
  document.querySelector('.site-header').innerHTML = `
    <div class="site-header__inner">
      <a class="brand" href="index.html">
        <span class="brand__mark" aria-hidden="true">IV</span>
        <span>
          <span class="brand__title">The Daddy Invitational</span>
          <span class="brand__sub eyebrow">${esc(page.label)}</span>
        </span>
      </a>
      <nav class="nav" aria-label="Site">
        ${PAGES.map((p) => `<a class="eyebrow" href="${p.href}"${p.id === pageId ? ' aria-current="page"' : ''}>${p.label}</a>`).join('')}
      </nav>
    </div>`;
  document.querySelector('.site-footer').innerHTML = `
    <div class="site-footer__inner">
      <span class="eyebrow">The Daddy Invitational · IV</span>
      <a class="eyebrow" href="${SHEET_URL}" target="_blank" rel="noopener">Source Sheet ↗</a>
    </div>`;
}

export function showError(target, err) {
  console.error(err);
  target.innerHTML = `<div class="notice notice--error"><strong>Couldn't load tournament data.</strong><br>${esc(err.message)}</div>`;
}

export const teamClass = (team) => team.toLowerCase();

export function playerChip(name, team, { me, label } = {}) {
  return `<span class="chip chip--${teamClass(team)}${me && name === me ? ' chip--me' : ''}">
    ${label ? `<small>${esc(label)}</small>` : ''}${esc(name)}
  </span>`;
}

export const ICONS = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};
