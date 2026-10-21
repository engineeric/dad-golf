/**
 * Score web app for hole-by-hole entry on score.html. Lives in the same Apps Script
 * project as setup-sheet.gs (Extensions → Apps Script in the main sheet).
 *
 * Deploy: Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 * Updating code later: Deploy → Manage deployments → edit → Version: New version
 * (a new deployment would change the URL).
 *
 * Players sign in with a personal key, emailed on request to the address in the
 * private spreadsheet (created by setupPrivateSheet). Keys never appear in the
 * public sheet; the Scores and Updates tabs only hold nicknames.
 *
 * Script Properties (Project Settings → Script Properties):
 *   PRIVATE_SHEET_ID  set by setupPrivateSheet
 *   RESEND_API_KEY    optional; without it, links are sent from your Gmail
 *   MAIL_FROM         optional; default "The Daddy Invitational <no-reply@daddyinvitational.com>"
 *   SITE_URL          optional; default https://daddyinvitational.com
 */

const SCORE_SITE_URL = 'https://daddyinvitational.com';
const SCORE_MAIL_FROM = 'The Daddy Invitational <no-reply@daddyinvitational.com>';
const SCORE_MAX_ENTRIES = 60;

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = SCORE_ACTIONS[req.action];
    out = action ? action(req) : { error: 'Unknown action.' };
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: 'score' })).setMimeType(ContentService.MimeType.JSON);
}

const SCORE_ACTIONS = {
  /** Emails the player their link if the address is on the list. Same answer either way. */
  link: function (req) {
    const email = String(req.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter an email address.' };
    const cache = CacheService.getScriptCache();
    if (cache.get('link:' + email)) return { ok: true };
    cache.put('link:' + email, '1', 60);
    const player = scorePrivateRows().filter((p) => p.email === email)[0];
    if (player) scoreSendLink(player);
    return { ok: true };
  },

  /** Who a key belongs to, and whether entry is open. */
  me: function (req) {
    const player = scorePlayerByKey(req.key);
    if (!player) return { error: 'This link is no longer valid. Request a new one.', code: 'badkey' };
    return { name: player.nickname, admin: player.admin, holeEntry: scoreSettings().holeEntry };
  },

  /**
   * Saves hole results: entries [{ round, match, hole, result: 'red'|'blue'|'halved'|'', at }].
   * Players can only enter today's round, for a match they're in, until the day is locked
   * (every match has all 18 holes entered); admins can enter anything.
   * Each hole keeps the entry with the newest `at`, so an older queued entry never overwrites a newer one.
   */
  post: function (req) {
    const player = scorePlayerByKey(req.key);
    if (!player) return { error: 'This link is no longer valid. Request a new one.', code: 'badkey' };
    const settings = scoreSettings();
    if (!settings.holeEntry) return { error: 'Score entry is turned off.', code: 'off' };
    const entries = (req.entries || []).slice(0, SCORE_MAX_ENTRIES);
    const today = scoreTodayRound(settings.timezone);
    const matches = scoreMatches();
    const names = { red: settings.red, blue: settings.blue, halved: 'Halved', '': '' };

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const ss = SpreadsheetApp.getActive();
      const scores = ss.getSheetByName('Scores');
      if (!scores) return { error: 'The Scores tab is missing. Run setupSheet.' };
      const h = scoreHeaderIndex(scores);
      const last = scores.getLastRow();
      const rows = last >= 2 ? scores.getRange(2, 1, last - 1, scores.getLastColumn()).getValues() : [];
      const log = [];
      const saved = [];
      const rejected = [];
      const locked = scoreDayLocked(rows, h, matches, today);
      entries.forEach((e) => {
        const round = Number(e.round);
        const match = Number(e.match);
        const hole = Number(e.hole);
        const at = Number(e.at) || Date.now();
        const result = String(e.result || '').toLowerCase();
        const id = round + '-' + match + '-' + hole;
        if (!(hole >= 1 && hole <= 18) || !(result in names)) return rejected.push({ id: id, why: 'invalid' });
        const m = matches.filter((x) => x.round === round && x.match === match)[0];
        if (!m) return rejected.push({ id: id, why: 'no match' });
        if (!player.admin) {
          if (round !== today) return rejected.push({ id: id, why: 'not today' });
          if (locked) return rejected.push({ id: id, why: 'locked' });
          if (m.players.indexOf(player.nickname.toLowerCase()) < 0) return rejected.push({ id: id, why: 'not your match' });
        }
        let row = rows.filter((r) => Number(r[h.Round]) === round && Number(r[h.Match]) === match && Number(r[h.Hole]) === hole)[0];
        if (row && Number(row[h.Updated]) > at) return saved.push(id); // a newer entry is already there
        if (!row) {
          row = new Array(scores.getLastColumn()).fill('');
          row[h.Round] = round;
          row[h.Match] = match;
          row[h.Hole] = hole;
          rows.push(row);
        }
        row[h.Result] = names[result];
        row[h.Updated] = at;
        row[h.By] = player.nickname;
        log.push([new Date(), player.nickname, round, match, hole, names[result] || '(cleared)']);
        saved.push(id);
      });
      if (rows.length) scores.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
      const updates = ss.getSheetByName('Updates');
      if (updates && log.length) updates.getRange(updates.getLastRow() + 1, 1, log.length, log[0].length).setValues(log);
      return { ok: true, saved: saved, rejected: rejected };
    } finally {
      lock.releaseLock();
    }
  },
};

/** A day locks for players once every one of its matches has a result on all 18 holes. */
function scoreDayLocked(rows, h, matches, round) {
  const dayMatches = matches.filter((m) => m.round === round);
  if (!dayMatches.length) return false;
  return dayMatches.every((m) => {
    const holes = {};
    rows.forEach((r) => {
      if (Number(r[h.Round]) === round && Number(r[h.Match]) === m.match && r[h.Result] !== '') holes[Number(r[h.Hole])] = true;
    });
    return Object.keys(holes).length === 18;
  });
}

// ---------- Private spreadsheet (emails and keys) ----------

/**
 * Creates the private spreadsheet (or reuses it) and adds any missing nicknames from Players.
 * Run once from the editor; it logs the spreadsheet's URL. Never shares it with anyone.
 */
function setupPrivateSheet() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('PRIVATE_SHEET_ID');
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('Daddy Invitational – private (emails)');
    props.setProperty('PRIVATE_SHEET_ID', ss.getId());
    const sheet = ss.getSheets()[0].setName('Players');
    sheet.getRange(1, 1, 1, 5).setValues([['Nickname', 'Email', 'Key', 'Admin', 'Link Sent']])
      .setFontWeight('bold').setFontColor('#ffffff').setBackground('#0d1c38');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 5, 200);
  }
  const sheet = ss.getSheetByName('Players');
  scoreEnsureLinkSent(sheet);
  const have = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map((r) => String(r[0])) : [];
  const main = SpreadsheetApp.getActive().getSheetByName('Players');
  const mh = scoreHeaderIndex(main);
  const nickCol = 'Nickname' in mh ? mh.Nickname : mh.Name;
  const nicknames = main.getRange(2, 1, main.getLastRow() - 1, main.getLastColumn()).getValues()
    .map((r) => String(r[nickCol]).trim()).filter(String);
  const missing = nicknames.filter((n) => have.indexOf(n) < 0);
  if (missing.length) {
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, missing.length, 1).setValues(missing.map((n) => [n]));
  }
  sheet.getRange(2, 4, Math.max(sheet.getLastRow() - 1, 1)).insertCheckboxes();
  console.log('Private spreadsheet: ' + ss.getUrl() + (missing.length ? '\nAdded: ' + missing.join(', ') : ''));
}

/** Adds the Link Sent column (when sendAllLinks emailed each player) to a private sheet made before it existed. */
function scoreEnsureLinkSent(sheet) {
  if (String(sheet.getRange(1, 5).getValue()) === 'Link Sent') return;
  sheet.getRange(1, 5).setValue('Link Sent').setFontWeight('bold').setFontColor('#ffffff').setBackground('#0d1c38');
  sheet.setColumnWidth(5, 200);
}

/** Rows of the private sheet; generates a key for any row with an email but no key. */
function scorePrivateRows() {
  const id = PropertiesService.getScriptProperties().getProperty('PRIVATE_SHEET_ID');
  if (!id) throw new Error('Run setupPrivateSheet first.');
  const sheet = SpreadsheetApp.openById(id).getSheetByName('Players');
  if (sheet.getLastRow() < 2) return [];
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4);
  const values = range.getValues();
  let changed = false;
  const rows = values.map((r, i) => {
    if (r[1] && !r[2]) { r[2] = Utilities.getUuid().replace(/-/g, ''); changed = true; }
    return { nickname: String(r[0]).trim(), email: String(r[1]).trim().toLowerCase(), key: String(r[2]).trim(), admin: r[3] === true, row: i + 2 };
  });
  if (changed) range.setValues(values);
  return rows.filter((p) => p.nickname);
}

function scorePlayerByKey(key) {
  const k = String(key || '').trim();
  if (k.length < 16) return null;
  return scorePrivateRows().filter((p) => p.key === k)[0] || null;
}

// ---------- Email ----------

function scoreSendLink(player) {
  const props = PropertiesService.getScriptProperties();
  const site = props.getProperty('SITE_URL') || SCORE_SITE_URL;
  const mail = scoreEmail(player.nickname, site.replace(/\/$/, '') + '/score.html#k=' + player.key, scoreSettings().edition);

  const apiKey = props.getProperty('RESEND_API_KEY');
  if (apiKey) {
    try {
      const res = UrlFetchApp.fetch('https://api.resend.com/emails', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + apiKey },
        payload: JSON.stringify({ from: props.getProperty('MAIL_FROM') || SCORE_MAIL_FROM, to: [player.email], subject: mail.subject, html: mail.html, text: mail.text }),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() < 300) return 'resend';
      console.warn('Resend failed (' + res.getResponseCode() + '): ' + res.getContentText());
    } catch (err) {
      console.warn('Resend failed: ' + err);
    }
  }
  MailApp.sendEmail({ to: player.email, subject: mail.subject, body: mail.text, htmlBody: mail.html, name: 'The Daddy Invitational' });
  return 'gmail';
}

const SCORE_TIPS = [
  'Open it in your browser, not a Home Screen shortcut.',
  'Any player in your match can enter holes, at any point in the round. Whoever has a free hand, take it; fixes are fine too.',
  "No signal? Keep tapping. Holes send when you're back in range.",
  'Keep a paper scorecard too, as a backup.',
  'To get back to your card later, tap <b>Keep score</b> on the Scoreboard.',
];

/**
 * The sign-in email, in the site's colours. Tables and inline styles because most mail apps
 * strip stylesheets; the <style> block only adds the site's dark palette for mail apps that
 * honour prefers-color-scheme (Apple Mail). Others darken it themselves.
 */
function scoreEmail(nickname, url, edition) {
  const serif = "Georgia,'Times New Roman',serif";
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const name = scoreEsc(nickname);
  const ed = scoreEsc(edition);
  const href = scoreEsc(url);
  const tips = SCORE_TIPS.map((t) =>
    '<tr><td valign="top" style="width:18px;padding:0 0 8px;color:#cca65c;font-size:18px;line-height:22px">&bull;</td>' +
    '<td class="dt" style="padding:0 0 8px;font-family:' + sans + ';font-size:14px;line-height:22px;color:#3a4152">' + t + '</td></tr>').join('');
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">' +
    '<style>@media (prefers-color-scheme: dark){' +
    '.dbg{background:#0a1222 !important}.dcard{background:#131e36 !important}' +
    '.dink{color:#ebe7de !important}.dt{color:#c9ccd3 !important}.dmuted{color:#8f98ab !important}' +
    '.drule{border-color:#26344f !important}.dbtn{background:#26395f !important}}</style></head>' +
    '<body class="dbg" style="margin:0;padding:0;background:#f5f0e6">' +
    '<table role="presentation" class="dbg" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e6"><tr><td align="center" style="padding:0">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">' +
    // Header: crest, title, eyebrow
    '<tr><td align="center" style="background:#0d1c38;padding:28px 24px 22px;border-bottom:3px solid #cca65c">' +
    '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="52" height="52" ' +
    'style="width:52px;height:52px;border:2px solid #cca65c;border-radius:50%;font-family:' + serif + ';font-weight:700;font-size:20px;color:#cca65c">' + ed + '</td></tr></table>' +
    '<div style="font-family:' + serif + ';font-size:24px;line-height:1.2;color:#ffffff;margin-top:12px">The Daddy Invitational</div>' +
    '<div style="font-family:' + sans + ';font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#cca65c;margin-top:6px">Keep score</div>' +
    '</td></tr>' +
    // Card
    '<tr><td style="padding:24px 16px">' +
    '<table role="presentation" class="dcard" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px"><tr><td style="padding:26px 24px">' +
    '<div class="dmuted" style="font-family:' + sans + ';font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8c919e">Hi ' + name + '</div>' +
    '<div class="dink" style="font-family:' + serif + ';font-size:28px;line-height:1.2;color:#121a2e;margin:6px 0 12px">Keep score from your phone</div>' +
    '<div class="dt" style="font-family:' + sans + ';font-size:16px;line-height:1.55;color:#3a4152;margin:0 0 22px">Tap who won each hole as you play, and everyone following along sees your match update live on the Scoreboard. This link signs your phone in for all three days.</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 24px"><tr><td class="dbtn" align="center" style="background:#0d1c38;border-radius:3px">' +
    '<a href="' + href + '" style="display:inline-block;padding:15px 30px;font-family:' + sans + ';font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#cca65c;text-decoration:none">Open my scorecard</a>' +
    '</td></tr></table>' +
    '<div class="drule" style="border-top:1px solid #e6e3db;padding-top:16px">' +
    '<div class="dink" style="font-family:' + serif + ';font-size:18px;color:#121a2e;margin:0 0 10px">Things to know</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + tips + '</table></div>' +
    '</td></tr></table>' +
    '<div class="dmuted" style="font-family:' + sans + ';font-size:12px;line-height:1.5;color:#8c919e;text-align:center;margin:16px 6px 0">This link is just for you: anyone with it can enter scores as you.</div>' +
    '</td></tr>' +
    // Footer
    '<tr><td align="center" style="background:#0d1c38;padding:16px 24px;font-family:' + sans + ';font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#b6bccb">' +
    'daddyinvitational.com &middot; <span style="color:#cca65c">' + ed + '</span></td></tr>' +
    '</table></td></tr></table></body></html>';
  const text = 'Hi ' + nickname + ',\n\nKeep score from your phone\n\n' +
    'Tap who won each hole as you play, and everyone following along sees your match update live on the Scoreboard. ' +
    'This link signs your phone in for all three days:\n\n' + url + '\n\nThings to know\n' +
    SCORE_TIPS.map((t) => '- ' + t.replace(/<[^>]+>/g, '')).join('\n') +
    '\n\nThis link is just for you: anyone with it can enter scores as you.\n\ndaddyinvitational.com';
  // The sender name already says The Daddy Invitational.
  return { subject: 'Your link to keep score', html: html, text: text };
}

/** Sends the scoring link to every admin in the private sheet, and logs which route it took. Run from the editor to test email. */
function sendTestLink() {
  const admins = scorePrivateRows().filter((p) => p.admin && p.email);
  if (!admins.length) throw new Error('Tick Admin next to your row (with your email) in the private spreadsheet first.');
  admins.forEach((p) => console.log('Sent to ' + p.email + ' via ' + scoreSendLink(p)));
}

/**
 * Emails every player with an address their link, skipping anyone already sent (Link Sent
 * filled; clear it to resend). Run by the trigger from scheduleLinks, or by hand.
 */
function sendAllLinks() {
  const id = PropertiesService.getScriptProperties().getProperty('PRIVATE_SHEET_ID');
  const sheet = SpreadsheetApp.openById(id).getSheetByName('Players');
  scoreEnsureLinkSent(sheet);
  const sent = [];
  scorePrivateRows().forEach((p) => {
    if (!p.email || sheet.getRange(p.row, 5).getValue() !== '') return;
    const route = scoreSendLink(p);
    sheet.getRange(p.row, 5).setValue(new Date());
    sent.push(p.nickname + ' (' + route + ')');
  });
  console.log(sent.length ? 'Sent: ' + sent.join(', ') : 'Nobody left to send to.');
}

/**
 * Schedules sendAllLinks for 7:00 AM (tournament timezone) on day 1's Schedule date.
 * Run once from the editor; running it again replaces the earlier schedule.
 */
function scheduleLinks() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'sendAllLinks')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  const tz = scoreSettings().timezone;
  const schedule = SpreadsheetApp.getActive().getSheetByName('Schedule');
  const h = scoreHeaderIndex(schedule);
  const row = schedule.getRange(2, 1, schedule.getLastRow() - 1, schedule.getLastColumn()).getValues()
    .filter((r) => Number(r[h.Round]) === 1)[0];
  if (!row) throw new Error('No round 1 in Schedule.');
  const d = row[h.Date];
  const day = d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d).trim();
  const at = Utilities.parseDate(day + ' 07:00', tz, 'yyyy-MM-dd HH:mm');
  if (at.getTime() < Date.now()) throw new Error('7:00 AM on ' + day + ' has already passed.');
  ScriptApp.newTrigger('sendAllLinks').timeBased().at(at).create();
  console.log('Links will go out at ' + Utilities.formatDate(at, tz, "EEEE MMMM d 'at' h:mm a z") + '.');
}

// ---------- Main sheet reads ----------

function scoreSettings() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Settings');
  const h = scoreHeaderIndex(sheet);
  const row = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const get = (name) => (name in h ? String(row[h[name]]).trim() : '');
  return {
    edition: get('Edition') || 'IV',
    red: get('Red Team') || 'Red',
    blue: get('Blue Team') || 'Blue',
    timezone: get('Timezone') || 'America/Chicago',
    holeEntry: /^on$/i.test(get('Hole Entry')),
  };
}

/** The round whose Schedule date is today in the tournament's timezone, or null. */
function scoreTodayRound(timezone) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Schedule');
  const h = scoreHeaderIndex(sheet);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const rows = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), sheet.getLastColumn()).getValues();
  const hit = rows.filter((r) => {
    const d = r[h.Date];
    const s = d instanceof Date ? Utilities.formatDate(d, timezone, 'yyyy-MM-dd') : String(d).trim();
    return s === today;
  })[0];
  return hit ? Number(hit[h.Round]) : null;
}

/** Matches with their number and lower-cased player nicknames. */
function scoreMatches() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Matches');
  const h = scoreHeaderIndex(sheet);
  if (sheet.getLastRow() < 2 || !('Match' in h)) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues().map((r) => ({
    round: Number(r[h.Round]),
    match: Number(r[h.Match]),
    players: ['Red 1', 'Red 2', 'Blue 1', 'Blue 2'].filter((c) => c in h).map((c) => String(r[h[c]]).trim().toLowerCase()).filter(String),
  })).filter((m) => m.round && m.match);
}

/** Header name → 0-based column index. */
function scoreHeaderIndex(sheet) {
  const out = {};
  sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .forEach((name, i) => { if (name !== '') out[String(name).trim()] = i; });
  return out;
}

function scoreEsc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
