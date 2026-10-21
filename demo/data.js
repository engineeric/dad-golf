// Demo scenarios for local testing: http://localhost:8765/?demo=final
// Each scenario returns CSV text per sheet tab, in the same shape the live sheet exports.

const PLAYERS = `"Nickname","Handicap Index","Team","Flight","Captain","Abbreviation"
"JD","2.3","Eric","A","FALSE",""
"Eric","7.1","Eric","A","TRUE","ERC"
"Cody","14.0","Eric","A","FALSE","CDY"
"Cole","15.0","Eric","A","FALSE",""
"Jbone","15.3","Eric","B","FALSE",""
"Landon","15.8","Eric","B","FALSE",""
"Brad","17.3","Eric","B","FALSE",""
"Drew","23.8","Eric","B","FALSE",""
"Brandon","7.7","Garrett","A","FALSE",""
"JK","9.7","Garrett","A","FALSE",""
"Taylor","14.0","Garrett","A","FALSE","TAY"
"Braden","14.3","Garrett","A","FALSE",""
"Nate","17.0","Garrett","B","FALSE",""
"Rikky","17.6","Garrett","B","FALSE",""
"Garrett","19.1","Garrett","B","TRUE",""
"Jeff","20.2","Garrett","B","FALSE",""`;

// [round, tee time, red 1, red 2, blue 1, blue 2, leader, up, thru]; finals are derived (4 up thru 15 → 4&3).
const MATCHES = [
  [1, '8:00 AM', 'Brandon', 'JK', 'JD', 'Eric', 'Eric', 4, 15],
  [1, '8:10 AM', 'Taylor', 'Braden', 'Cody', 'Cole', 'Garrett', 1, 18],
  [1, '8:20 AM', 'Nate', 'Rikky', 'Jbone', 'Landon', 'AS', '', 18],
  [1, '8:30 AM', 'Garrett', 'Jeff', 'Brad', 'Drew', 'Garrett', 2, 17],
  // Day 2 pairs nobody with a day-1 opponent, which leaves exactly one legal singles draw.
  [2, '9:00 AM', 'Brandon', 'Nate', 'Cody', 'Brad', 'AS', '', 18],
  [2, '9:10 AM', 'JK', 'Rikky', 'Cole', 'Drew', 'Eric', 3, 16],
  [2, '9:20 AM', 'Taylor', 'Garrett', 'JD', 'Jbone', 'Garrett', 2, 18],
  [2, '9:30 AM', 'Braden', 'Jeff', 'Eric', 'Landon', 'Eric', 5, 14],
  // Singles: flight-matched (A v A, then B v B), no rematches.
  [3, '10:00 AM', 'Brandon', '', 'Cole', '', 'Eric', 3, 16],
  [3, '10:00 AM', 'JK', '', 'Cody', '', 'Garrett', 1, 18],
  [3, '10:10 AM', 'Taylor', '', 'Eric', '', 'Eric', 2, 17],
  [3, '10:10 AM', 'Braden', '', 'JD', '', 'Eric', 2, 17],
  [3, '10:20 AM', 'Nate', '', 'Drew', '', 'Garrett', 6, 13],
  [3, '10:20 AM', 'Rikky', '', 'Brad', '', 'Eric', 1, 18],
  [3, '10:30 AM', 'Garrett', '', 'Landon', '', 'AS', '', 18],
  [3, '10:30 AM', 'Jeff', '', 'Jbone', '', 'Eric', 2, 18],
];

// Mid-round scores for the live scenarios, in tee order: [leader, up, thru], or null for no update yet.
const LIVE = {
  1: [['Eric', 2, 5], ['AS', '', 3], null, null],
  3: [['Eric', 3, 16], ['AS', '', 18], ['Garrett', 2, 12], ['AS', '', 11],
    ['Eric', 1, 10], ['Garrett', 3, 9], ['Eric', 1, 4], ['Garrett', 1, 2]],
};

// [round, hole, prize, winner]; winners only show for rounds that have been played.
const PRIZES = [
  [1, 4, 'Closest to the Pin', 'JK'],
  [1, 12, 'Longest Drive', 'JD'],
  [1, 16, 'Closest to the Pin', 'Nate'],
  [1, 18, 'Longest Putt', 'Cole'],
  [2, 7, 'Closest to the Pin', 'Eric'],
  [2, 11, 'Longest Drive', 'Garrett'],
  [2, 17, 'Closest to the Pin', 'JK'],
  [3, 3, 'Closest to the Pin', 'Landon'],
  [3, 9, 'Longest Drive', 'Brandon'],
  [3, 15, 'Closest to the Pin', 'Jeff'],
];

// Par and men's stroke index per course (same as the real Course Holes tab).
const CARDS = {
  1: { par: [4, 4, 4, 3, 5, 4, 3, 4, 4, 4, 4, 5, 3, 4, 4, 3, 5, 4], si: [3, 13, 15, 7, 9, 1, 11, 17, 5, 6, 12, 10, 16, 2, 14, 18, 8, 4] },
  2: { par: [4, 4, 3, 4, 3, 4, 5, 4, 5, 4, 3, 4, 5, 4, 4, 4, 3, 4], si: [3, 15, 13, 7, 11, 17, 1, 5, 9, 10, 14, 16, 4, 6, 8, 18, 12, 2] },
  3: { par: [4, 4, 3, 4, 5, 4, 4, 3, 4, 4, 4, 4, 5, 4, 3, 5, 3, 4], si: [6, 10, 18, 8, 16, 2, 12, 14, 4, 3, 9, 1, 13, 5, 15, 17, 11, 7] },
};

const SIDE = { Garrett: 'Garrett', Eric: 'Eric' };
const PLAY_OUT = ['Halved', 'Garrett', 'Eric', 'Eric', 'Halved', 'Garrett'];

/**
 * Hole results that reproduce a [leader, up, thru] score: level holes first, then the
 * leader's winning run. Final matches are played out to 18 (for the tiebreak).
 */
function holesFor([leader, up, thru], seed) {
  if (!thru) return [];
  const n = Number(up) || 0;
  const winner = SIDE[leader] ?? (seed % 2 ? 'Garrett' : 'Eric');
  const other = winner === 'Garrett' ? 'Eric' : 'Garrett';
  const level = thru - n;
  const out = level % 2 ? ['Halved'] : [];
  for (let i = 0; i < Math.floor(level / 2); i++) out.push(...((i + seed) % 2 ? [winner, other] : [other, winner]));
  for (let i = 0; i < n; i++) out.push(winner);
  const final = n > 18 - thru || thru === 18;
  if (final) for (let h = thru; h < 18; h++) out.push(PLAY_OUT[(h + seed) % PLAY_OUT.length]);
  return out;
}

/** Entries the demo score page saved in this browser (the fake web app). */
function savedEntries(name) {
  try { return JSON.parse(localStorage.getItem(`demo.scores.${name}`) || '[]'); } catch { return []; }
}

const csvRow = (cells) => cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');

/**
 * Days until round 1, which rounds have results posted, and the round being played
 * right now (tee times shifted so it started `startedAgo` minutes ago).
 */
const SCENARIOS = {
  countdown: { startIn: 10, played: 0 },
  teeoff: { startIn: 0, played: 0, live: 1, startedAgo: 25 },
  day1: { startIn: -1, played: 1 },
  midway: { startIn: -2, played: 2 },
  live: { startIn: -2, played: 2, live: 3, startedAgo: 180 },
  final: { startIn: -3, played: 3, mvp: 'JD' },
  // Hole-by-hole: days 1–2 and day 3 so far come from the Scores tab, not Leader/Up/Thru.
  holes: { startIn: -2, played: 2, live: 3, startedAgo: 180, holes: true },
  // 8–8: Rikky beats Brad and Jeff halves with Jbone instead.
  tied: { startIn: -3, played: 3, scores: { 13: ['Garrett', 1, 18], 15: ['AS', '', 18] } },
  tiebreak: { startIn: -3, played: 3, scores: { 13: ['Garrett', 1, 18], 15: ['AS', '', 18] },
    tiebreak: ['Garrett', "Won Sunday's back 9 by 2 holes"] },
  // 8–8 with every hole entered: the computed tiebreak shows as pending verification.
  tiedholes: { startIn: -3, played: 3, scores: { 13: ['Garrett', 1, 18], 15: ['AS', '', 18] }, holes: true },
};

const parseClock = (t) => {
  const [, h, m, ap] = t.match(/(\d+):(\d+) (AM|PM)/);
  return ((+h % 12) + (ap === 'PM' ? 12 : 0)) * 60 + +m;
};
const formatClock = (mins) => `${Math.floor(mins / 60) % 12 || 12}:${String(mins % 60).padStart(2, '0')} ${mins < 720 ? 'AM' : 'PM'}`;

/** Minutes since midnight in the tournament's timezone. */
function nowInChicago() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(Date.now()).map((x) => [x.type, x.value]));
  return (+p.hour % 24) * 60 + +p.minute;
}

/** The live round's rows: tee times moved to around now, scores from LIVE. */
function liveRows(rows, s) {
  const first = Math.min(...rows.map((m) => parseClock(m[1])));
  const shift = Math.max(0, nowInChicago() - s.startedAgo) - first;
  return rows.map((m, i) => [...m.slice(0, 1), formatClock(Math.max(0, parseClock(m[1]) + shift)), ...m.slice(2, 6), ...(LIVE[s.live][i] ?? ['', '', ''])]);
}

function isoDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

/** `&hcp=index` switches the demo back to handicap index; demos default to course handicaps. */
export function demoTabs(name) {
  const s = SCENARIOS[name];
  if (!s) return null;
  const handicap = new URLSearchParams(location.search).get('hcp') === 'index' ? 'Index' : 'Course';

  // Matchups are posted one day ahead: results for played rounds, tee sheet for the next.
  const posted = Math.min(3, s.played + 1);
  const matches = MATCHES
    .map((m, i) => (s.scores?.[i] ? [...m.slice(0, 6), ...s.scores[i]] : m))
    .filter(([round]) => round <= posted)
    .map((m) => (m[0] <= s.played ? m : [...m.slice(0, 6), '', '', '']));
  if (s.live) {
    const idx = matches.flatMap((m, i) => (m[0] === s.live ? [i] : []));
    liveRows(idx.map((i) => matches[i]), s).forEach((row, j) => { matches[idx[j]] = row; });
  }
  // Match numbers 1..N per round, in tee order (as setupSheet fills them).
  const numbered = matches.map((m, i) => [...m, matches.slice(0, i).filter((x) => x[0] === m[0]).length + 1]);
  // Hole-by-hole scenarios move every score into Scores and leave Leader/Up/Thru blank.
  const scores = [];
  if (s.holes) {
    const start = Date.now() - 3 * 86_400_000;
    numbered.forEach((m, i) => {
      const holes = holesFor(m.slice(6, 9), i);
      // The live round's entries are recent (newest a few minutes ago) so "Updated N min ago" reads true.
      const at = (h) => (m[0] === s.live ? Date.now() - ((holes.length - 1 - h) * 12 + (i % 4) * 3 + 1) * 60_000 : start + i * 1000 + h);
      holes.forEach((result, h) => scores.push([m[0], m[9], h + 1, result, at(h), m[2]]));
      m.splice(6, 3, '', '', '');
    });
    for (const e of savedEntries(name)) scores.push([e.round, e.match, e.hole, e.result, e.at, e.by]);
  }

  return {
    Players: PLAYERS,
    Prizes: [csvRow(['Round', 'Hole', 'Prize', 'Winner']),
      ...PRIZES.map((p) => csvRow(p[0] <= s.played ? p : [...p.slice(0, 3), '']))].join('\n'),
    Matches: [csvRow(['Round', 'Tee Time', 'Red 1', 'Red 2', 'Blue 1', 'Blue 2', 'Leader', 'Up', 'Thru', 'Match']), ...numbered.map(csvRow)].join('\n'),
    'Course Holes': [csvRow(['Round', 'Hole', 'Par', 'Stroke Index']),
      ...[1, 2, 3].flatMap((r) => CARDS[r].par.map((par, h) => csvRow([r, h + 1, par, CARDS[r].si[h]])))].join('\n'),
    Scores: [csvRow(['Round', 'Match', 'Hole', 'Result', 'Updated', 'By']), ...scores.map(csvRow)].join('\n'),
    Schedule: [
      csvRow(['Round', 'Format', 'Date', 'Course', 'Course URL', 'Address', 'Coordinates', 'Tees', 'Yardage', 'Par', 'Rating', 'Slope', 'Notes']),
      csvRow([1, 'Matched', isoDate(s.startIn), 'Swope Memorial Golf Course', 'https://www.swopememorialgolfcourse.com',
        '6900 Swope Memorial Drive\nKansas City, MO 64132', '38.9990, -94.5020', 'Bronze', '6,079', '71', '70.2', '122', '']),
      csvRow([2, 'Mixed', isoDate(s.startIn + 1), 'Shoal Creek Golf Course', 'https://www.shoalcreekgolf.com',
        '8905 North Shoal Creek Parkway\nKansas City, MO 64157', '39.2540, -94.4930', 'Blue', '6,266', '71', '70.5', '128', '']),
      csvRow([3, 'Singles', isoDate(s.startIn + 2), 'Falcon Lakes Golf Club', 'https://falconlakesgolf.com',
        '4605 Clubhouse Drive\nBasehor, KS 66007', '39.1290, -94.9020', 'White', '6,040', '71', '70.2', '122', '']),
    ].join('\n'),
    Settings: [
      csvRow(['Edition', 'Red Team', 'Blue Team', 'Lower %', 'Higher %', 'Timezone', 'Round Minutes', 'MVP', 'Handicap', 'Tiebreak Winner', 'Tiebreak Note', 'Hole Entry', 'Score App URL']),
      csvRow(['IV', 'Garrett', 'Eric', '35.0%', '15.0%', 'America/Chicago', '300', s.mvp ?? '', handicap, ...(s.tiebreak ?? ['', '']),
        s.holes ? 'On' : 'Off', s.holes ? 'https://demo.invalid/score' : '']),
    ].join('\n'),
  };
}
