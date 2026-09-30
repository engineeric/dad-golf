// Shared page chrome and small DOM helpers.

const PAGES = [
  { id: 'scoreboard', label: 'Scoreboard', href: 'index.html' },
  { id: 'schedule', label: 'Schedule', href: 'schedule.html' },
  { id: 'teams', label: 'Teams', href: 'teams.html' },
  { id: 'matchups', label: 'Matchups', href: 'matchups.html' },
];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EDITION_KEY = 'daddy.edition';

function cachedEdition() {
  try { return localStorage.getItem(EDITION_KEY) || 'IV'; } catch { return 'IV'; }
}

export function renderChrome(pageId) {
  const edition = cachedEdition();
  const page = PAGES.find((p) => p.id === pageId);
  document.querySelector('.site-header').innerHTML = `
    <div class="site-header__inner">
      <a class="brand" href="index.html">
        <span class="brand__mark" aria-hidden="true">${esc(edition)}</span>
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
      <span class="eyebrow">The Daddy Invitational · <span class="edition">${esc(edition)}</span></span>
    </div>`;
}

/** Updates the edition numeral (e.g. "IV") everywhere it appears, including the favicon. */
export function applyEdition(edition) {
  try { localStorage.setItem(EDITION_KEY, edition); } catch { /* storage unavailable */ }
  document.querySelectorAll('.brand__mark, .site-footer .edition').forEach((el) => { el.textContent = edition; });
  const size = edition.length <= 2 ? 24 : Math.max(12, 48 / edition.length);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="none" stroke="#cca65c" stroke-width="3.5"/><text x="32" y="32" dy="0.35em" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="${size}" fill="#cca65c">${esc(edition)}</text></svg>`;
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) icon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function showError(target, err) {
  console.error(err);
  target.innerHTML = `<div class="notice notice--error"><strong>Couldn't load tournament data.</strong><br>${esc(err.message)}</div>`;
}

export function playerChip(name, side, { me, label } = {}) {
  return `<span class="chip chip--${side}${me && name === me ? ' chip--me' : ''}">
    ${label ? `<small>${esc(label)}</small>` : ''}${esc(name)}
  </span>`;
}

export const ICONS = {
  trophy: '<svg viewBox="12 2 40 69" fill="currentColor"><circle cx="32" cy="6" r="2.6"/><path d="M24 14 Q32 7 40 14 Z"/><rect x="22" y="14" width="20" height="2.5" rx="1"/><path d="M23 18 H41 C41 32 38 40 32 42 C26 40 23 32 23 18 Z"/><path d="M23 21 C14 21 14 34 26 36 M41 21 C50 21 50 34 38 36" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="30.6" y="42" width="2.8" height="12"/><ellipse cx="32" cy="48" rx="3.4" ry="1.6"/><path d="M25 55 H39 L41 64 H23 Z"/><rect x="19" y="65.5" width="26" height="4" rx="1"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};
