/**
 * One-time setup for the "Daddy IV" sheet: creates the Matches, Schedule and
 * Settings tabs the website reads. Existing tabs are left untouched.
 *
 * Run: Extensions → Apps Script → paste this file → select setupDaddyIV → Run.
 */
function setupDaddyIV() {
  const ss = SpreadsheetApp.getActive();
  const players = ss.getSheetByName('Players');
  if (!players) throw new Error('Players tab not found.');
  const playerNames = players.getRange('A2:A' + Math.max(players.getLastRow(), 2));

  const list = (values) => SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  const fromRange = (range) => SpreadsheetApp.newDataValidation().requireValueInRange(range, true).setAllowInvalid(false).build();
  const created = [];

  // ---------- Matches ----------
  const matches = createTab(ss, 'Matches',
    ['Round', 'Tee Time', 'Eric 1', 'Eric 2', 'Garrett 1', 'Garrett 2', 'Winner', 'Result']);
  if (matches) {
    const rows = 40;
    matches.getRange(2, 1, rows).setDataValidation(list(['1', '2', '3'])).setHorizontalAlignment('center');
    matches.getRange(2, 2, rows).setNumberFormat('h:mm AM/PM');
    matches.getRange(2, 3, rows, 4).setDataValidation(fromRange(playerNames));
    matches.getRange(2, 7, rows).setDataValidation(list(['Eric', 'Garrett', 'Halved']));
    matches.getRange(2, 8, rows).setNumberFormat('@');
    matches.setColumnWidths(3, 4, 170);
    created.push('Matches');
  }

  // ---------- Schedule ----------
  const schedule = createTab(ss, 'Schedule',
    ['Round', 'Format', 'Date', 'Course', 'Course URL', 'Address', 'Tees', 'Yardage', 'Par', 'Notes']);
  if (schedule) {
    schedule.getRange('A2:A4').setValues([[1], [2], [3]]).setHorizontalAlignment('center');
    schedule.getRange('B2:B4').setDataValidation(list(['Matched', 'Mixed', 'Singles']));
    schedule.getRange('C2:C4').setNumberFormat('yyyy-mm-dd')
      .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
    schedule.getRange('H2:I4').setNumberFormat('#,##0');
    schedule.setColumnWidth(4, 200);
    schedule.setColumnWidth(5, 200);
    schedule.setColumnWidth(6, 280);
    schedule.setColumnWidth(10, 280);
    created.push('Schedule');
  }

  // ---------- Settings (one header row + one value row) ----------
  const settings = createTab(ss, 'Settings', ['Lower %', 'Higher %', 'Timezone', 'Round Minutes']);
  if (settings) {
    settings.getRange('A2:D2').setValues([[0.35, 0.15, 'America/Chicago', 300]]);
    settings.getRange('A2:B2').setNumberFormat('0.0%');
    settings.getRange('C2').setNumberFormat('@');
    created.push('Settings');
  }

  SpreadsheetApp.getUi().alert(created.length
    ? 'Created: ' + created.join(', ')
    : 'Nothing to do — Matches, Schedule and Settings already exist.');
}

/** Creates a tab with a styled, frozen header row, or returns null if it already exists. */
function createTab(ss, name, headers) {
  if (ss.getSheetByName(name)) return null;
  const sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#0d1c38');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, headers.length, 120);
  // Drop the default extra columns so the tab stays tidy.
  if (sheet.getMaxColumns() > headers.length) sheet.deleteColumns(headers.length + 1, sheet.getMaxColumns() - headers.length);
  return sheet;
}
