// Calendar events for schedule days: .ics files and Google Calendar links.

const CHICAGO_VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:America/Chicago',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0600', 'TZOFFSETTO:-0500', 'TZNAME:CDT',
  'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0600', 'TZNAME:CST',
  'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

const pad = (n) => String(n).padStart(2, '0');

/** Wall-clock arithmetic on {y,m,d,h,min}; UTC is used only as a neutral calendar. */
function addMinutes({ y, m, d, h = 0, min = 0 }, minutes) {
  const t = new Date(Date.UTC(y, m - 1, d, h, min + minutes));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), min: t.getUTCMinutes() };
}

const stampDate = (t) => `${t.y}${pad(t.m)}${pad(t.d)}`;
const stampLocal = (t) => `${stampDate(t)}T${pad(t.h)}${pad(t.min)}00`;

/**
 * Builds the event for a day. `teeTime` is the chosen start ({h, m}); without one
 * the event is all-day.
 */
export function buildEvent({ uid, title, date, teeTime, minutes, location, description, url }) {
  if (!date) return null;
  if (!teeTime) {
    return { uid, title, location, description, url, allDay: true, start: { ...date }, end: addMinutes(date, 24 * 60) };
  }
  const start = { ...date, h: teeTime.h, min: teeTime.m };
  return { uid, title, location, description, url, allDay: false, start, end: addMinutes(start, minutes) };
}

const escapeText = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** Folds content lines to 75 octets per RFC 5545. */
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function toICS(events, timezone) {
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Daddy Invitational//Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (timezone === 'America/Chicago' && events.some((e) => !e.allDay)) lines.push(...CHICAGO_VTIMEZONE);
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${dtstamp}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${stampDate(e.start)}`, `DTEND;VALUE=DATE:${stampDate(e.end)}`);
    else lines.push(`DTSTART;TZID=${timezone}:${stampLocal(e.start)}`, `DTEND;TZID=${timezone}:${stampLocal(e.end)}`);
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadICS(events, timezone, filename) {
  const blob = new Blob([toICS(events, timezone)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function googleCalendarUrl(e, timezone) {
  const dates = e.allDay
    ? `${stampDate(e.start)}/${stampDate(e.end)}`
    : `${stampLocal(e.start)}/${stampLocal(e.end)}`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: e.description ?? '', location: e.location ?? '' });
  if (!e.allDay) params.set('ctz', timezone);
  return `https://calendar.google.com/calendar/render?${params}`;
}
