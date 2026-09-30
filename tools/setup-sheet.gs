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
  };
  Object.keys(defaults).forEach((header) => {
    const col = ensureColumn(settings, header, log);
    const cell = settings.getRange(2, col.index);
    if (cell.isBlank()) cell.setValue(defaults[header]);
    if (header.endsWith('%')) cell.setNumberFormat('0.0%');
    if (header === 'Edition' || header === 'Timezone' || header.endsWith('Team')) cell.setNumberFormat('@');
  });
  const red = valueUnder(settings, 'Red Team');
  const blue = valueUnder(settings, 'Blue Team');
  // MVP: the commissioner's pick, left blank until decided.
  const mvpCol = ensureColumn(settings, 'MVP', log);
  settings.getRange(2, mvpCol.index).setDataValidation(fromRange(playerNames));

  // ---------- Matches ----------
  const matches = createTab(ss, 'Matches', ['Round', 'Tee Time', 'Red 1', 'Red 2', 'Blue 1', 'Blue 2', 'Winner', 'Result'], log);
  // Legacy headers named after teams ("Garrett 1") become "Red 1" / "Blue 1".
  renameHeaders(matches, { [red + ' 1']: 'Red 1', [red + ' 2']: 'Red 2', [blue + ' 1']: 'Blue 1', [blue + ' 2']: 'Blue 2' }, log);
  const rows = 40;
  const col = (h) => ensureColumn(matches, h, log).index;
  matches.getRange(2, col('Round'), rows).setDataValidation(list(['1', '2', '3'])).setHorizontalAlignment('center');
  matches.getRange(2, col('Tee Time'), rows).setNumberFormat('h:mm AM/PM');
  ['Red 1', 'Red 2', 'Blue 1', 'Blue 2'].forEach((h) => matches.getRange(2, col(h), rows).setDataValidation(fromRange(playerNames)));
  matches.getRange(2, col('Winner'), rows).setDataValidation(list([red, blue, 'Halved']));
  // Warn (don't block) on results the site can't read a margin from: 3&2, 2 UP, Halved, AS.
  const resultCol = col('Result');
  const resultCell = matches.getRange(2, resultCol).getA1Notation();
  const resultRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=OR(' + resultCell + '="", REGEXMATCH(TO_TEXT(' + resultCell + '), "(?i)^\\s*(\\d+\\s*&\\s*\\d+|\\d+\\s*UP|HALVED?|AS|ALL SQUARE)\\s*$"))')
    .setAllowInvalid(true)
    .setHelpText('Use match-play results like 3&2, 2 UP, or Halved so the site can compute margins.')
    .build();
  matches.getRange(2, resultCol, rows).setNumberFormat('@').setDataValidation(resultRule);
  log.push('Matches: Result validation (warning only) applied');

  // ---------- Schedule ----------
  const schedule = createTab(ss, 'Schedule',
    ['Round', 'Format', 'Date', 'Course', 'Course URL', 'Address', 'Tees', 'Yardage', 'Par', 'Rating', 'Slope', 'Notes'], log);
  const sched = (h) => ensureColumn(schedule, h, log).index;
  if (schedule.getRange('A2').isBlank()) schedule.getRange('A2:A4').setValues([[1], [2], [3]]).setHorizontalAlignment('center');
  schedule.getRange(2, sched('Format'), 3).setDataValidation(list(['Matched', 'Mixed', 'Singles']));
  schedule.getRange(2, sched('Date'), 3).setNumberFormat('yyyy-mm-dd')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  schedule.getRange(2, sched('Yardage'), 3).setNumberFormat('#,##0');
  schedule.getRange(2, sched('Par'), 3).setNumberFormat('0');
  schedule.getRange(2, sched('Rating'), 3).setNumberFormat('0.0');
  schedule.getRange(2, sched('Slope'), 3).setNumberFormat('0');

  SpreadsheetApp.getUi().alert(log.length ? log.join('\n') : 'Everything is already set up.');
}

// ---------- Helpers ----------

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

function askRedTeam(teamNames) {
  if (teamNames.length < 2) return teamNames[0] || 'Red';
  const ui = SpreadsheetApp.getUi();
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
