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
   * Players can only enter today's round, for a match they're in; admins can enter anything.
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
    sheet.getRange(1, 1, 1, 4).setValues([['Nickname', 'Email', 'Key', 'Admin']])
      .setFontWeight('bold').setFontColor('#ffffff').setBackground('#0d1c38');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 4, 200);
  }
  const sheet = ss.getSheetByName('Players');
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

/** Rows of the private sheet; generates a key for any row with an email but no key. */
function scorePrivateRows() {
  const id = PropertiesService.getScriptProperties().getProperty('PRIVATE_SHEET_ID');
  if (!id) throw new Error('Run setupPrivateSheet first.');
  const sheet = SpreadsheetApp.openById(id).getSheetByName('Players');
  if (sheet.getLastRow() < 2) return [];
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4);
  const values = range.getValues();
  let changed = false;
  const rows = values.map((r) => {
    if (r[1] && !r[2]) { r[2] = Utilities.getUuid().replace(/-/g, ''); changed = true; }
    return { nickname: String(r[0]).trim(), email: String(r[1]).trim().toLowerCase(), key: String(r[2]).trim(), admin: r[3] === true };
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
  const edition = scoreSettings().edition;
  const url = site.replace(/\/$/, '') + '/score.html#k=' + player.key;
  const subject = 'Your scoring link · The Daddy Invitational ' + edition;
  const text = 'Hi ' + player.nickname + ',\n\nOpen this link on your phone to enter hole scores for your matches:\n' + url +
    '\n\nIt works for all three days. Keep it to yourself: anyone with it can enter scores as you.';
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;color:#121a2e;line-height:1.5">' +
    '<p>Hi ' + scoreEsc(player.nickname) + ',</p>' +
    '<p>Open this link on your phone to enter hole scores for your matches:</p>' +
    '<p><a href="' + url + '" style="display:inline-block;background:#0d1c38;color:#cca65c;padding:12px 18px;border-radius:4px;text-decoration:none;font-weight:600">Open my scorecard</a></p>' +
    '<p style="color:#5f5e5a;font-size:14px">It works for all three days. Keep it to yourself: anyone with it can enter scores as you.</p></div>';

  const apiKey = props.getProperty('RESEND_API_KEY');
  if (apiKey) {
    try {
      const res = UrlFetchApp.fetch('https://api.resend.com/emails', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + apiKey },
        payload: JSON.stringify({ from: props.getProperty('MAIL_FROM') || SCORE_MAIL_FROM, to: [player.email], subject: subject, html: html, text: text }),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() < 300) return 'resend';
      console.warn('Resend failed (' + res.getResponseCode() + '): ' + res.getContentText());
    } catch (err) {
      console.warn('Resend failed: ' + err);
    }
  }
  MailApp.sendEmail({ to: player.email, subject: subject, body: text, htmlBody: html, name: 'The Daddy Invitational' });
  return 'gmail';
}

/** Sends the scoring link to every admin in the private sheet, and logs which route it took. Run from the editor to test email. */
function sendTestLink() {
  const admins = scorePrivateRows().filter((p) => p.admin && p.email);
  if (!admins.length) throw new Error('Tick Admin next to your row (with your email) in the private spreadsheet first.');
  admins.forEach((p) => console.log('Sent to ' + p.email + ' via ' + scoreSendLink(p)));
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
