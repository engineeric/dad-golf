/**
 * Sets up a Daddy Invitational sheet for the website. Safe to run any time:
 * it creates missing tabs, adds missing columns and renames legacy headers,
 * but never overwrites data you've entered.
 *
 * Run: Extensions → Apps Script → paste this file → select setupSheet → Run.
 *
 * Next year: copy the sheet, update Players (incl. Captain checkboxes) and
 * Settings (Edition, Red Team, Blue Team), clear Matches and Schedule, run this.
 */
function setupSheet() {
  const ss = SpreadsheetApp.getActive();
  const players = ss.getSheetByName('Players');
  if (!players) throw new Error('Players tab not found.');
  const log = [];

  // ---------- Players: Captain checkbox column ----------
  const lastPlayerRow = Math.max(players.getLastRow(), 2);
  const captainCol = ensureColumn(players, 'Captain', log);
  if (captainCol.added) {
    players.getRange(2, captainCol.index, lastPlayerRow - 1).insertCheckboxes();
    log.push('Players: tick one Captain per team');
  }
  // Optional scorecard label (score.html), up to 3 characters; blank uses an automatic one.
  const abbrCol = ensureColumn(players, 'Abbreviation', log);
  const abbrCell = players.getRange(2, abbrCol.index).getA1Notation();
  players.getRange(2, abbrCol.index, lastPlayerRow - 1).setNumberFormat('@').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=LEN(' + abbrCell + ')<=3').setAllowInvalid(false)
    .setHelpText('Up to 3 characters, shown on the scorecard (e.g. JD). Leave blank for automatic.').build());
  // Matches dropdowns list nicknames (the Players Name column is optional and best removed).
  const nameCol = headers(players).indexOf('Nickname') >= 0 ? headers(players).indexOf('Nickname') + 1 : headers(players).indexOf('Name') + 1;
  if (!nameCol) throw new Error('Players needs a Nickname column.');
  const playerNames = players.getRange(2, nameCol, lastPlayerRow - 1);

  // ---------- Settings (one header row + one value row) ----------
  const teamNames = uniqueTeams(players);
  const settings = createTab(ss, 'Settings', ['Edition', 'Red Team', 'Blue Team', 'Lower %', 'Higher %', 'Timezone', 'Round Minutes'], log);
  const redTeam = headers(settings).indexOf('Red Team') >= 0 ? valueUnder(settings, 'Red Team') : '';
  const pickedRed = redTeam || askRedTeam(teamNames);
  const defaults = {
    'Edition': 'IV',
    'Red Team': pickedRed,
    'Blue Team': teamNames.find((t) => t !== pickedRed) || 'Blue',
    'Lower %': 0.35,
    'Higher %': 0.15,
    'Timezone': 'America/Chicago',
    'Round Minutes': 300,
    'Handicap': 'Index',
    // Hole-by-hole entry on the site (score.html). Off: the site ignores Scores and the web app refuses entries.
    'Hole Entry': 'Off',
    // The score web app's URL (Deploy → Manage deployments → Web app URL).
    'Score App URL': '',
  };
  // Dropdowns go on before defaults are written, so a value never lands under a stale rule.
  const settingRules = { 'Handicap': list(['Index', 'Course']), 'Hole Entry': list(['On', 'Off']) };
  Object.keys(defaults).forEach((header) => {
    const col = ensureColumn(settings, header, log);
    const cell = settings.getRange(2, col.index);
    cell.setDataValidation(settingRules[header] ?? null);
    if (cell.isBlank()) cell.setValue(defaults[header]);
    if (header.endsWith('%')) cell.setNumberFormat('0.0%');
    if (['Edition', 'Timezone', 'Handicap', 'Hole Entry', 'Score App URL'].indexOf(header) >= 0 || header.endsWith('Team')) cell.setNumberFormat('@');
  });
  const red = valueUnder(settings, 'Red Team');
  const blue = valueUnder(settings, 'Blue Team');
  // MVP: the commissioner's pick, left blank until decided.
  const mvpCol = ensureColumn(settings, 'MVP', log);
  settings.getRange(2, mvpCol.index).setDataValidation(fromRange(playerNames));
  // Tiebreak: only used at 8–8. Winner is a team name; Note is free text shown on the Scoreboard.
  const tiebreakCol = ensureColumn(settings, 'Tiebreak Winner', log);
  settings.getRange(2, tiebreakCol.index).setDataValidation(list([red, blue])).setNumberFormat('@');
  settings.getRange(2, ensureColumn(settings, 'Tiebreak Note', log).index).setNumberFormat('@');

  // ---------- Matches ----------
  const matches = createTab(ss, 'Matches', ['Round', 'Tee Time', 'Red 1', 'Red 2', 'Blue 1', 'Blue 2', 'Leader', 'Up', 'Thru'], log);
  // Legacy headers named after teams ("Garrett 1") become "Red 1" / "Blue 1".
  renameHeaders(matches, { [red + ' 1']: 'Red 1', [red + ' 2']: 'Red 2', [blue + ' 1']: 'Blue 1', [blue + ' 2']: 'Blue 2' }, log);
  const rows = 40;
  const col = (h) => ensureColumn(matches, h, log).index;
  matches.getRange(2, col('Round'), rows).setDataValidation(list(['1', '2', '3'])).setHorizontalAlignment('center');
  matches.getRange(2, col('Tee Time'), rows).setNumberFormat('h:mm AM/PM');
  ['Red 1', 'Red 2', 'Blue 1', 'Blue 2'].forEach((h) => matches.getRange(2, col(h), rows).setDataValidation(fromRange(playerNames)));
  // Live score: who's up (or AS), by how many, through how many holes. The site
  // derives the final result (4&3, 2 UP, Halved) once the match can't be caught.
  matches.getRange(2, col('Leader'), rows).setDataValidation(list([red, blue, 'AS']));
  const holes = (max) => SpreadsheetApp.newDataValidation().requireNumberBetween(0, max).setAllowInvalid(false).build();
  const thruCol = col('Thru');
  const upCol = col('Up');
  matches.getRange(2, thruCol, rows).setNumberFormat('0').setHorizontalAlignment('center').setDataValidation(holes(18));
  // Warn (don't block) on a lead the match would already have ended before: more than one past the holes left.
  const upCell = matches.getRange(2, upCol).getA1Notation();
  const thruCell = matches.getRange(2, thruCol).getA1Notation();
  const upRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(' + upCell + '="", AND(ISNUMBER(' + upCell + '), ' + upCell + '>=0, ' + upCell + '<=19-N(' + thruCell + ')))')
    .setAllowInvalid(true)
    .setHelpText('Holes up. Leave blank for AS. The match ends once Up is more than the holes left.')
    .build();
  matches.getRange(2, upCol, rows).setNumberFormat('0').setHorizontalAlignment('center').setDataValidation(upRule);
  numberMatches(matches, col('Match'), col('Round'), col('Tee Time'), log);
  if (headers(matches).some((h) => h === 'Winner' || h === 'Result')) {
    log.push('Matches: Winner and Result are no longer used; delete those columns by hand');
  }

  // ---------- Schedule ----------
  const schedule = createTab(ss, 'Schedule',
    ['Round', 'Format', 'Date', 'Course', 'Course URL', 'Address', 'Coordinates', 'Tees', 'Yardage', 'Par', 'Rating', 'Slope', 'Notes'], log);
  const sched = (h) => ensureColumn(schedule, h, log).index;
  if (schedule.getRange('A2').isBlank()) schedule.getRange('A2:A4').setValues([[1], [2], [3]]).setHorizontalAlignment('center');
  schedule.getRange(2, sched('Format'), 3).setDataValidation(list(['Matched', 'Mixed', 'Singles']));
  schedule.getRange(2, sched('Date'), 3).setNumberFormat('yyyy-mm-dd')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  schedule.getRange(2, sched('Yardage'), 3).setNumberFormat('#,##0');
  schedule.getRange(2, sched('Par'), 3).setNumberFormat('0');
  schedule.getRange(2, sched('Rating'), 3).setNumberFormat('0.0');
  schedule.getRange(2, sched('Slope'), 3).setNumberFormat('0');
  // "lat, long" as copied from a maps app; kept as text so it stays one cell.
  schedule.getRange(2, sched('Coordinates'), 3).setNumberFormat('@');

  // ---------- Prizes (hole prizes; Winner left blank until awarded) ----------
  const prizes = createTab(ss, 'Prizes', ['Round', 'Hole', 'Prize', 'Winner'], log);
  const prize = (h) => ensureColumn(prizes, h, log).index;
  prizes.getRange(2, prize('Round'), rows).setDataValidation(list(['1', '2', '3'])).setHorizontalAlignment('center');
  prizes.getRange(2, prize('Hole'), rows).setHorizontalAlignment('center')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 18).setAllowInvalid(false).build());
  // Suggestions only: other prize names can be typed in.
  prizes.getRange(2, prize('Prize'), rows).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Closest to the Pin', 'Longest Drive', 'Longest Putt'], true).setAllowInvalid(true).build());
  prizes.getRange(2, prize('Winner'), rows).setDataValidation(fromRange(playerNames));

  // ---------- Course Holes (par and stroke index per hole, for stroke dots on score.html) ----------
  const courseHoles = createTab(ss, 'Course Holes', ['Round', 'Hole', 'Par', 'Stroke Index'], log);
  const ch = (h) => ensureColumn(courseHoles, h, log).index;
  if (courseHoles.getLastRow() < 2) seedCourseHoles(courseHoles, schedule, log);
  courseHoles.getRange(2, ch('Round'), 54).setDataValidation(list(['1', '2', '3'])).setHorizontalAlignment('center');
  courseHoles.getRange(2, ch('Hole'), 54).setHorizontalAlignment('center');
  courseHoles.getRange(2, ch('Par'), 54).setHorizontalAlignment('center')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(3, 5).setAllowInvalid(false).build());
  courseHoles.getRange(2, ch('Stroke Index'), 54).setHorizontalAlignment('center')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 18).setAllowInvalid(false).build());

  // ---------- Scores (one row per hole per match, written by the score web app) ----------
  const scores = createTab(ss, 'Scores', ['Round', 'Match', 'Hole', 'Result', 'Updated', 'By'], log);
  const sc = (h) => ensureColumn(scores, h, log).index;
  const scoreRows = 400;
  // Result: the team that won the hole, or Halved. Blank means not entered.
  scores.getRange(2, sc('Result'), scoreRows).setDataValidation(list([red, blue, 'Halved']));
  // Updated is milliseconds since 1970 (the entering phone's clock), so newer entries win.
  scores.getRange(2, sc('Updated'), scoreRows).setNumberFormat('0');

  // ---------- Updates (log of every entry from the web app) ----------
  createTab(ss, 'Updates', ['Time', 'By', 'Round', 'Match', 'Hole', 'Result'], log);

  const summary = log.length ? log.join('\n') : 'Everything is already set up.';
  console.log(summary);
  const ui = getUi();
  if (ui) ui.alert(summary);
}

// ---------- Helpers ----------

/** Fills blank Match numbers 1..N per round, in tee-time order, skipping numbers already used. Never changes a filled cell. */
function numberMatches(sheet, matchCol, roundCol, teeCol, log) {
  const last = sheet.getLastRow();
  if (last < 2) return;
  const width = sheet.getLastColumn();
  const values = sheet.getRange(2, 1, last - 1, width).getValues();
  const minutes = (v) => (v instanceof Date ? v.getHours() * 60 + v.getMinutes() : 9999);
  let filled = 0;
  ['1', '2', '3'].forEach((round) => {
    const rows = values.map((r, i) => ({ r: r, i: i })).filter((x) => String(x.r[roundCol - 1]) === round);
    const used = rows.map((x) => Number(x.r[matchCol - 1])).filter((n) => n > 0);
    let next = 1;
    rows.filter((x) => x.r[matchCol - 1] === '')
      .sort((a, b) => minutes(a.r[teeCol - 1]) - minutes(b.r[teeCol - 1]) || a.i - b.i)
      .forEach((x) => {
        while (used.indexOf(next) >= 0) next++;
        sheet.getRange(x.i + 2, matchCol).setValue(next);
        used.push(next);
        filled++;
      });
  });
  sheet.getRange(2, matchCol, last - 1).setHorizontalAlignment('center');
  if (filled) log.push('Matches: numbered ' + filled + ' match' + (filled === 1 ? '' : 'es'));
}

// Par and men's stroke index from each course's official scorecard.
const COURSE_CARDS = {
  swope: {
    par: [4, 4, 4, 3, 5, 4, 3, 4, 4, 4, 4, 5, 3, 4, 4, 3, 5, 4],
    si: [3, 13, 15, 7, 9, 1, 11, 17, 5, 6, 12, 10, 16, 2, 14, 18, 8, 4],
  },
  shoal: {
    par: [4, 4, 3, 4, 3, 4, 5, 4, 5, 4, 3, 4, 5, 4, 4, 4, 3, 4],
    si: [3, 15, 13, 7, 11, 17, 1, 5, 9, 10, 14, 16, 4, 6, 8, 18, 12, 2],
  },
};

/** 18 rows per round; Par and Stroke Index filled where the Schedule's course has a known card, blank otherwise. */
function seedCourseHoles(sheet, schedule, log) {
  const sh = headers(schedule);
  const roundCol = sh.indexOf('Round');
  const courseCol = sh.indexOf('Course');
  const courses = {};
  if (schedule.getLastRow() >= 2 && roundCol >= 0 && courseCol >= 0) {
    schedule.getRange(2, 1, schedule.getLastRow() - 1, schedule.getLastColumn()).getValues()
      .forEach((r) => { courses[String(r[roundCol])] = String(r[courseCol]).toLowerCase(); });
  }
  const rows = [];
  const blank = [];
  [1, 2, 3].forEach((round) => {
    const name = courses[String(round)] || '';
    const card = Object.keys(COURSE_CARDS).filter((k) => name.indexOf(k) >= 0).map((k) => COURSE_CARDS[k])[0];
    if (!card) blank.push(round);
    for (let h = 1; h <= 18; h++) rows.push([round, h, card ? card.par[h - 1] : '', card ? card.si[h - 1] : '']);
  });
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  log.push('Course Holes: added holes for rounds 1–3' + (blank.length ? '; fill in Par and Stroke Index for round ' + blank.join(', ') : ''));
}

function list(values) {
  return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
}

function fromRange(range) {
  return SpreadsheetApp.newDataValidation().requireValueInRange(range, true).setAllowInvalid(false).build();
}

/** Creates a tab with a styled, frozen header row if it doesn't exist. */
function createTab(ss, name, headers, log) {
  const existing = ss.getSheetByName(name);
  if (existing) return existing;
  const sheet = ss.insertSheet(name);
  styleHeader(sheet.getRange(1, 1, 1, headers.length).setValues([headers]));
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, headers.length, 130);
  if (sheet.getMaxColumns() > headers.length) sheet.deleteColumns(headers.length + 1, sheet.getMaxColumns() - headers.length);
  log.push('Created tab: ' + name);
  return sheet;
}

function headers(sheet) {
  const width = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
}

/** Returns the 1-based column of `header`, appending it if missing. */
function ensureColumn(sheet, header, log) {
  const idx = headers(sheet).indexOf(header);
  if (idx >= 0) return { index: idx + 1, added: false };
  const index = sheet.getLastColumn() + 1;
  if (sheet.getMaxColumns() < index) sheet.insertColumnAfter(sheet.getMaxColumns());
  // Inserted columns inherit the left neighbour's validation and formats; start clean.
  sheet.getRange(1, index, sheet.getMaxRows()).clearDataValidations().clearFormat();
  styleHeader(sheet.getRange(1, index).setValue(header));
  log.push(sheet.getName() + ': added column ' + header);
  return { index: index, added: true };
}

function renameHeaders(sheet, renames, log) {
  headers(sheet).forEach((h, i) => {
    if (renames[h] && renames[h] !== h) {
      sheet.getRange(1, i + 1).setValue(renames[h]);
      log.push(sheet.getName() + ': renamed ' + h + ' → ' + renames[h]);
    }
  });
}

function valueUnder(sheet, header) {
  return String(sheet.getRange(2, headers(sheet).indexOf(header) + 1).getValue());
}

/** The sheet's UI, or null when run without the spreadsheet open (e.g. from the editor or a trigger). */
function getUi() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
}

function askRedTeam(teamNames) {
  if (teamNames.length < 2) return teamNames[0] || 'Red';
  const ui = getUi();
  if (!ui) {
    console.log('No sheet UI to ask which team is red; using ' + teamNames[0] + '. Change Settings > Red Team if needed.');
    return teamNames[0];
  }
  const answer = ui.prompt('Team colours', 'Which team plays in red? (' + teamNames.join(' or ') + ')', ui.ButtonSet.OK);
  const typed = answer.getResponseText().trim().toLowerCase();
  return teamNames.find((t) => t.toLowerCase() === typed) || teamNames[0];
}

/** Team names in Players, in order of first appearance. */
function uniqueTeams(players) {
  const teamCol = headers(players).indexOf('Team') + 1;
  if (!teamCol || players.getLastRow() < 2) return [];
  const values = players.getRange(2, teamCol, players.getLastRow() - 1).getValues().map((r) => String(r[0])).filter(String);
  return values.filter((v, i) => values.indexOf(v) === i);
}

function styleHeader(range) {
  range.setFontWeight('bold').setFontColor('#ffffff').setBackground('#0d1c38');
}
