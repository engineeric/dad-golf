// Tournament rules: team handicaps, formats and scoring.

export const TEAMS = ['Garrett', 'Eric'];
export const CAPTAINS = { Garrett: 'Garrett', Eric: 'Eric' };
export const TOTAL_POINTS = 16;
export const TO_WIN = TOTAL_POINTS / 2 + 0.5;
export const DAYS = 3;

export const FORMATS = {
  Matched: { title: 'Matched Flights', sub: '2v2 · AA & BB', slots: ['AA', 'AA', 'BB', 'BB'] },
  Mixed: { title: 'Mixed Flights', sub: '2v2 · AB', slots: ['AB', 'AB', 'AB', 'AB'] },
  Singles: { title: 'Singles', sub: '1v1', slots: Array(8).fill('') },
};

// Rounds to 3 places first so float noise (4.1499999…) doesn't flip a half-up rounding.
export const round1 = (n) => Math.round(Math.round(n * 1000) / 100) / 10;

/** Weighted two-player team handicap: lower% of the better player + higher% of the other. */
export function teamHcp(a, b, settings) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return round1(settings.lowerPct * lo + settings.higherPct * hi);
}

/** Strokes the higher-handicap side receives. */
export const strokes = (a, b) => Math.round(Math.abs(round1(a) - round1(b)));

export function points(matches) {
  const pts = { Garrett: 0, Eric: 0 };
  for (const m of matches) {
    if (m.winner === 'Halved') { pts.Garrett += 0.5; pts.Eric += 0.5; }
    else if (m.winner) pts[m.winner] += 1;
  }
  return pts;
}

/** Infers a format from entered matches when the Schedule row doesn't say. */
function inferFormat(matches) {
  if (!matches.length) return null;
  return matches.every((m) => m.eric.length <= 1 && m.garrett.length <= 1) ? 'Singles' : null;
}

/** Merges Schedule rows and Matches into one entry per day, always DAYS long. */
export function buildDays({ schedule, matches }) {
  return Array.from({ length: DAYS }, (_, i) => {
    const round = i + 1;
    const info = schedule.find((d) => d.round === round) ?? {};
    const dayMatches = matches
      .filter((m) => m.round === round)
      .sort((a, b) => (a.teeTime?.minutes ?? Infinity) - (b.teeTime?.minutes ?? Infinity) || a.row - b.row)
      .map((m, idx) => ({ ...m, number: idx + 1 }));
    const format = info.format ?? inferFormat(dayMatches);
    return {
      round,
      format,
      formatInfo: format ? FORMATS[format] : null,
      date: info.date ?? null,
      course: info.course ?? '',
      url: info.url ?? '',
      address: info.address ?? '',
      tees: info.tees ?? '',
      yardage: info.yardage ?? '',
      par: info.par ?? '',
      rating: info.rating ?? '',
      slope: info.slope ?? '',
      notes: info.notes ?? '',
      matches: dayMatches,
    };
  });
}

/** Matches sharing a tee time form one group; matches without a time stand alone. */
export function teeGroups(day) {
  const groups = [];
  for (const m of day.matches) {
    const g = m.teeTime && groups.find((x) => x.teeTime?.minutes === m.teeTime.minutes);
    if (g) g.matches.push(m);
    else groups.push({ teeTime: m.teeTime, matches: [m] });
  }
  return groups;
}

export const dayTitle = (day) => day.formatInfo?.title ?? 'Format TBA';

export function formatDate(date, opts = { weekday: 'long', month: 'long', day: 'numeric' }) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' })
    .format(new Date(Date.UTC(date.y, date.m - 1, date.d)));
}

export function formatTime(t) {
  if (!t) return '';
  const h12 = t.h % 12 || 12;
  return `${h12}:${String(t.m).padStart(2, '0')} ${t.h < 12 ? 'AM' : 'PM'}`;
}

/** Offset (ms) of `timeZone` from UTC at instant `t`. */
function zoneOffset(t, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(t).map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - t;
}

/** Converts a wall-clock date/time in `timeZone` to an epoch timestamp. */
export function zonedTime(date, time, timeZone) {
  const wall = Date.UTC(date.y, date.m - 1, date.d, time?.h ?? 0, time?.m ?? 0);
  const guess = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(guess, timeZone); // second pass settles DST boundaries
}

/** When play begins: the earliest dated day and its first tee time (if posted). */
export function tournamentStart(days, timeZone) {
  const first = days.filter((d) => d.date)
    .sort((a, b) => Date.UTC(a.date.y, a.date.m - 1, a.date.d) - Date.UTC(b.date.y, b.date.m - 1, b.date.d))[0];
  if (!first) return null;
  const teeTime = first.matches.find((m) => m.teeTime)?.teeTime ?? null;
  return { day: first, teeTime, at: zonedTime(first.date, teeTime, timeZone) };
}

export const formatHcp =(n) => (n == null ? '—' : n.toFixed(1));

export function formatPts(n) {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (!half) return String(whole);
  return whole ? `${whole}½` : '½';
}
