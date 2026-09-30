// Demo scenarios for local testing: http://localhost:8765/?demo=final
// Each scenario returns CSV text per sheet tab, in the same shape the live sheet exports.

const PLAYERS = `"Nickname","Handicap Index","Team","Flight","Captain"
"JD","2.3","Eric","A","FALSE"
"Eric","7.1","Eric","A","TRUE"
"Cody","14.0","Eric","A","FALSE"
"Cole","15.0","Eric","A","FALSE"
"Jbone","15.3","Eric","B","FALSE"
"Landon","15.8","Eric","B","FALSE"
"Brad","17.3","Eric","B","FALSE"
"Drew","23.8","Eric","B","FALSE"
"Brandon","7.7","Garrett","A","FALSE"
"JK","9.7","Garrett","A","FALSE"
"Taylor","14.0","Garrett","A","FALSE"
"Braden","14.3","Garrett","A","FALSE"
"Nate","17.0","Garrett","B","FALSE"
"Rikky","17.6","Garrett","B","FALSE"
"Garrett","19.1","Garrett","B","TRUE"
"Jeff","20.2","Garrett","B","FALSE"`;

// [round, tee time, red 1, red 2, blue 1, blue 2, winner, result]
const MATCHES = [
  [1, '8:00 AM', 'Brandon', 'JK', 'JD', 'Eric', 'Eric', '4&3'],
  [1, '8:10 AM', 'Taylor', 'Braden', 'Cody', 'Cole', 'Garrett', '1 UP'],
  [1, '8:20 AM', 'Nate', 'Rikky', 'Jbone', 'Landon', 'Halved', ''],
  [1, '8:30 AM', 'Garrett', 'Jeff', 'Brad', 'Drew', 'Garrett', '2&1'],
  [2, '9:00 AM', 'Brandon', 'Nate', 'JD', 'Jbone', 'Halved', ''],
  [2, '9:10 AM', 'JK', 'Rikky', 'Eric', 'Landon', 'Eric', '3&2'],
  [2, '9:20 AM', 'Taylor', 'Garrett', 'Cody', 'Brad', 'Garrett', '2 UP'],
  [2, '9:30 AM', 'Braden', 'Jeff', 'Cole', 'Drew', 'Eric', '5&4'],
  [3, '10:00 AM', 'Brandon', '', 'JD', '', 'Eric', '3&2'],
  [3, '10:00 AM', 'JK', '', 'Eric', '', 'Garrett', '1 UP'],
  [3, '10:10 AM', 'Taylor', '', 'Cody', '', 'Eric', '2&1'],
  [3, '10:10 AM', 'Braden', '', 'Cole', '', 'Eric', '2&1'],
  [3, '10:20 AM', 'Nate', '', 'Drew', '', 'Garrett', '6&5'],
  [3, '10:20 AM', 'Rikky', '', 'Jbone', '', 'Eric', '1 UP'],
  [3, '10:30 AM', 'Garrett', '', 'Brad', '', 'Halved', ''],
  [3, '10:30 AM', 'Jeff', '', 'Landon', '', 'Eric', '2 UP'],
];

const csvRow = (cells) => cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');

/** Days until round 1, and which rounds have results posted. */
const SCENARIOS = {
  countdown: { startIn: 10, played: 0 },
  day1: { startIn: -1, played: 1 },
  midway: { startIn: -2, played: 2 },
  final: { startIn: -3, played: 3, mvp: 'JD' },
};

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
    .filter(([round]) => round <= posted)
    .map((m) => (m[0] <= s.played ? m : [...m.slice(0, 6), '', '']));

  return {
    Players: PLAYERS,
    Matches: [csvRow(['Round', 'Tee Time', 'Red 1', 'Red 2', 'Blue 1', 'Blue 2', 'Winner', 'Result']), ...matches.map(csvRow)].join('\n'),
    Schedule: [
      csvRow(['Round', 'Format', 'Date', 'Course', 'Course URL', 'Address', 'Tees', 'Yardage', 'Par', 'Rating', 'Slope', 'Notes']),
      csvRow([1, 'Matched', isoDate(s.startIn), 'Swope Memorial Golf Course', 'https://www.swopememorialgolfcourse.com',
        '6900 Swope Memorial Drive\nKansas City, MO 64132', 'Bronze', '6,079', '71', '70.2', '122', '']),
      csvRow([2, 'Mixed', isoDate(s.startIn + 1), 'Shoal Creek Golf Course', 'https://www.shoalcreekgolf.com',
        '8905 North Shoal Creek Parkway\nKansas City, MO 64157', 'Blue', '6,266', '71', '70.5', '128', '']),
      csvRow([3, 'Singles', isoDate(s.startIn + 2), 'Falcon Lakes Golf Club', 'https://falconlakesgolf.com',
        '4605 Clubhouse Drive\nBasehor, KS 66007', 'White', '6,040', '71', '70.2', '122', '']),
    ].join('\n'),
    Settings: [
      csvRow(['Edition', 'Red Team', 'Blue Team', 'Lower %', 'Higher %', 'Timezone', 'Round Minutes', 'MVP', 'Handicap']),
      csvRow(['IV', 'Garrett', 'Eric', '35.0%', '15.0%', 'America/Chicago', '300', s.mvp ?? '', handicap]),
    ].join('\n'),
  };
}
