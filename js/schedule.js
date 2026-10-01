import { loadData } from './sheet.js';
import { buildDays, dayTitle, formatDate, formatTime, teeGroups } from './golf.js';
import { buildEvent, downloadICS, googleCalendarUrl } from './calendar.js';
import { applyEdition, ICONS, esc, holeBadge, playerChip, renderChrome, showError } from './ui.js';

renderChrome('schedule');
const app = document.getElementById('app');
const dialog = document.getElementById('qr');

const ME_KEY = 'daddy.me';
const canShare = typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches;

let data;
let days = [];
let me = '';
try { me = localStorage.getItem(ME_KEY) ?? ''; } catch { /* storage unavailable */ }

// ---------- Links ----------

const placeQuery = (day) => day.address || day.course;
const googleDirections = (q) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
const appleDirections = (q) => `https://maps.apple.com/?daddr=${encodeURIComponent(q)}`;
const mapEmbed = (q) => `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;

const groupHas = (group, name) => group.matches.some((m) => m.red.includes(name) || m.blue.includes(name));

/**
 * "Street, City, ST 12345" → street on the first line, the rest on the second.
 * Line breaks typed in the cell win; addresses with fewer than two commas stay on one line.
 */
function formatAddress(address) {
  const commas = (address.match(/,/g) ?? []).length;
  const lines = address.includes('\n') ? address.split('\n')
    : commas >= 2 ? address.replace(/^([^,]+),\s*/, '$1\n').split('\n')
      : [address];
  return lines.map((l) => esc(l.trim())).filter(Boolean).join('<br>');
}

// ---------- Calendar ----------

function ratingSuffix(day) {
  const parts = [day.rating && `Rating ${day.rating}`, day.slope && `Slope ${day.slope}`].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function eventFor(day) {
  const groups = teeGroups(day);
  const mine = me && groups.find((g) => groupHas(g, me));
  const teeTime = mine?.teeTime ?? groups.find((g) => g.teeTime)?.teeTime ?? null;
  const lines = [
    day.formatInfo ? `${day.formatInfo.title} (${day.formatInfo.sub})` : null,
    day.course ? `Course: ${day.course}` : null,
    day.tees ? `Tees: ${day.tees}${ratingSuffix(day)}` : null,
    day.prizes.length ? `Hole prizes: ${day.prizes.map((p) => `#${p.hole ?? '?'} ${p.prize}`).join(', ')}` : null,
    mine?.teeTime ? `${me}'s tee time: ${formatTime(mine.teeTime)}` : null,
    groups.some((g) => g.teeTime) ? '' : null,
    ...groups.filter((g) => g.teeTime).map((g) =>
      `${formatTime(g.teeTime)}: ${g.matches.map((m) => `${m.red.join(' & ') || 'TBD'} vs ${m.blue.join(' & ') || 'TBD'}`).join(' | ')}`),
    '',
    `${location.origin}${location.pathname}#day-${day.round}`,
  ].filter((l) => l != null);
  return buildEvent({
    uid: `daddy-${data.settings.edition.toLowerCase()}-day-${day.round}@daddyinvitational`,
    title: `Daddy Invitational · Day ${day.round}${day.formatInfo ? `: ${day.formatInfo.title}` : ''}`,
    date: day.date,
    teeTime,
    minutes: data.settings.roundMinutes,
    location: [day.course, day.address].filter(Boolean).join(', '),
    description: lines.join('\n'),
    url: `${location.origin}${location.pathname}#day-${day.round}`,
  });
}

// ---------- Rendering ----------

function renderFindMe() {
  const options = [...data.players]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `<option value="${esc(p.name)}"${p.name === me ? ' selected' : ''}>${esc(p.name)}</option>`)
    .join('');
  const anyDates = days.some((d) => d.date);
  return `
    <section class="card findme">
      <label>
        <span class="eyebrow">Find me</span>
        <select class="select" id="me"><option value="">Select your name…</option>${options}</select>
      </label>
      ${anyDates ? `<button class="btn btn--solid" data-action="ics-all">${ICONS.calendar} Add All Days</button>` : ''}
    </section>`;
}

function renderTeeSheet(day) {
  const groups = teeGroups(day);
  if (!groups.length) return '<div class="empty tba">Tee times TBA</div>';
  return groups.map((g) => {
    const mine = me && groupHas(g, me);
    return `
      <div class="tee${mine ? ' mine' : ''}">
        <div class="tee__time num">${g.teeTime ? formatTime(g.teeTime) : '<span class="tba">TBA</span>'}${mine ? '<small class="eyebrow">Your group</small>' : ''}</div>
        <div class="tee__matches">
          ${g.matches.map((m) => `
            <div class="tee__match">
              <span class="label eyebrow">Match ${m.number}</span>
              <span class="tee__side tee__side--red">${m.red.map((n) => playerChip(n, 'red', { me })).join('') || '<span class="tba">TBD</span>'}</span>
              <span class="vs eyebrow">vs</span>
              <span class="tee__side tee__side--blue">${m.blue.map((n) => playerChip(n, 'blue', { me })).join('') || '<span class="tba">TBD</span>'}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');
}

function renderDay(day) {
  const q = placeQuery(day);
  const dateLabel = day.date ? formatDate(day.date) : 'Date TBA';
  const stat = (label, value) => `<div><span class="eyebrow">${label}</span><strong class="num">${value ? esc(value) : '<span class="tba">TBA</span>'}</strong></div>`;
  const courseName = day.course
    ? day.url ? `<a href="${esc(day.url)}" target="_blank" rel="noopener">${esc(day.course)} ${ICONS.link}</a>` : esc(day.course)
    : '<span class="tba">Course TBA</span>';
  const event = eventFor(day);
  const groupCount = teeGroups(day).length;

  return `
    <section class="card day" id="day-${day.round}">
      <header class="day__head">
        <div>
          <span class="eyebrow">Day ${day.round} · ${esc(dateLabel)}</span>
          <h2>${esc(dayTitle(day))}</h2>
          ${day.formatInfo ? `<span class="sub">${esc(day.formatInfo.sub)}</span>` : ''}
        </div>
        ${event ? `
          <div class="btn-row">
            <button class="btn btn--gold" data-action="ics" data-round="${day.round}">${ICONS.calendar} Add to Calendar</button>
            <a class="btn" href="${esc(googleCalendarUrl(event, data.settings.timezone))}" target="_blank" rel="noopener">Google Calendar</a>
          </div>` : ''}
      </header>
      <div class="day__body">
        <div class="course">
          <div>
            <span class="eyebrow">Course</span>
            <h3>${courseName}</h3>
          </div>
          <div class="stats">${stat('Tees', day.tees)}${stat('Yardage', day.yardage)}${stat('Par', day.par)}${stat('Rating', day.rating)}${stat('Slope', day.slope)}</div>
          ${day.address ? `<address class="address">${formatAddress(day.address)}</address>` : ''}
          ${day.notes ? `<p class="notes">${esc(day.notes)}</p>` : ''}
          ${q ? `
            <div class="btn-row">
              <a class="btn btn--solid" href="${esc(googleDirections(q))}" target="_blank" rel="noopener">${ICONS.pin} Google Maps</a>
              <a class="btn btn--solid" href="${esc(appleDirections(q))}" target="_blank" rel="noopener">${ICONS.pin} Apple Maps</a>
              <button class="btn" data-action="${canShare ? 'share' : 'qr'}" data-round="${day.round}">${ICONS.phone} ${canShare ? 'Share' : 'Send to Phone'}</button>
            </div>` : ''}
        </div>
        <div class="map">
          ${q
            ? `<iframe title="Map of ${esc(day.course || day.address)}" src="${esc(mapEmbed(q))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`
            : '<span class="tba">Map available once the course is set</span>'}
        </div>
      </div>
      ${renderPrizeHoles(day)}
      <div class="teesheet">
        <div class="teesheet__head">
          <span class="eyebrow">Tee Sheet</span>
          ${groupCount ? `<span class="eyebrow">${groupCount} group${groupCount === 1 ? '' : 's'}</span>` : ''}
        </div>
        ${renderTeeSheet(day)}
      </div>
    </section>`;
}

/** The day's prize holes, so players know where to go for it. Winners are results, so they live on the Scoreboard. */
function renderPrizeHoles(day) {
  if (!day.prizes.length) return '';
  return `
    <div class="prize-holes">
      <span class="eyebrow">Hole prizes</span>
      ${day.prizes.map((p) => `
        <span class="prize-hole">${holeBadge(p.hole)}<span>${esc(p.prize)}</span></span>`).join('')}
    </div>`;
}

function render() {
  app.innerHTML = `${renderFindMe()}<div class="stack">${days.map(renderDay).join('')}</div>`;
}

// ---------- Send to phone ----------

function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function openQr(day) {
  const q = placeQuery(day);
  dialog.querySelector('#qr-title').textContent = day.course || 'Directions';
  dialog.querySelector('.qr__body').innerHTML = `
    <div>${qrSvg(appleDirections(q))}<p class="eyebrow">Apple Maps</p></div>
    <div>${qrSvg(googleDirections(q))}<p class="eyebrow">Google Maps</p></div>`;
  dialog.querySelector('.qr__foot .muted').textContent = `Day ${day.round}${day.date ? ` · ${formatDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}`;
  dialog.showModal();
}

dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
});

// ---------- Events ----------

app.addEventListener('change', (e) => {
  if (e.target.id !== 'me') return;
  me = e.target.value;
  try { me ? localStorage.setItem(ME_KEY, me) : localStorage.removeItem(ME_KEY); } catch { /* storage unavailable */ }
  render();
  const mine = document.querySelector('.tee.mine');
  mine?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

app.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const day = days.find((d) => d.round === +btn.dataset.round);
  const tz = data.settings.timezone;
  switch (btn.dataset.action) {
    case 'ics':
      downloadICS([eventFor(day)], tz, `daddy-invitational-day-${day.round}.ics`);
      break;
    case 'ics-all':
      downloadICS(days.map(eventFor).filter(Boolean), tz, 'daddy-invitational.ics');
      break;
    case 'qr':
      openQr(day);
      break;
    case 'share':
      try {
        await navigator.share({ title: day.course || `Day ${day.round}`, text: [day.course, day.address].filter(Boolean).join('\n'), url: googleDirections(placeQuery(day)) });
      } catch { /* dismissed */ }
      break;
  }
});

try {
  data = await loadData();
  applyEdition(data.settings.edition);
  days = buildDays(data);
  if (me && !data.players.some((p) => p.name === me)) me = '';
  render();
  if (/^#day-\d$/.test(location.hash)) document.querySelector(location.hash)?.scrollIntoView();
} catch (err) {
  showError(app, err);
}
