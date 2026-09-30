// Reads the "Daddy IV" Google Sheet via the public gviz CSV endpoint.

export const SHEET_ID = '1e_PIxZAjMYLLzAvzeEaWkSR-L7PKB_KzsxhkDPi71oQ';

const DEFAULT_SETTINGS = {
  edition: 'IV',
  lowerPct: 0.35,
  higherPct: 0.15,
  timezone: 'America/Chicago',
  roundMinutes: 300,
};

const tabUrl = (tab) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Fetches a tab as objects keyed by normalized header.
 * gviz silently returns the first tab when a tab doesn't exist, so a tab
 * lacking any of `required` columns is treated as missing.
 */
async function fetchTab(name, required) {
  const res = await fetch(tabUrl(name), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn't load the "${name}" tab (HTTP ${res.status}).`);
  const [header = [], ...body] = parseCSV(await res.text());
  const keys = header.map(key);
  if (!required.every((r) => keys.includes(r))) return null;
  return body
    .map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()])))
    .filter((r) => Object.values(r).some(Boolean));
}

const num = (v) => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const pct = (v) => {
  const n = num(v);
  if (n == null) return null;
  return String(v).includes('%') || n > 1 ? n / 100 : n;
};

const HALVED = new Set(['halved', 'halve', 'tie', 'tied', 'as']);
const truthy = (v) => /^(true|yes|y|x|1|✓|✔)$/i.test(String(v).trim());

/** Maps a team name (or "Red"/"Blue") to its side. */
const sideOf = (v, teams) => {
  const k = key(v);
  if (!k) return null;
  if (k === key(teams.red) || k === 'red') return 'red';
  if (k === key(teams.blue) || k === 'blue') return 'blue';
  return null;
};

const FORMATS = { matched: 'Matched', mixed: 'Mixed', singles: 'Singles' };

/** Accepts "8:10 AM", "8:10:00 AM", "08:10", "14:30". */
export function parseTime(v) {
  const m = String(v).match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?m?\.?/i);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  const ap = m[3]?.toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min, minutes: h * 60 + min };
}

/** Accepts ISO "2026-10-09", US "10/9/2026", or anything Date.parse understands. */
export function parseDate(v) {
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return { y: m[3].length === 2 ? 2000 + +m[3] : +m[3], m: +m[1], d: +m[2] };
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

/**
 * Players are identified by Nickname. A Name column is optional (and best left out
 * of the public sheet); when present it's only used to resolve Matches entries.
 * Returns the players plus a map from sheet name/nickname → display name.
 */
function normalizePlayers(rows, teams) {
  const players = rows
    .map((r) => ({
      fullName: r.name || '',
      name: r.nickname || r.name,
      hcp: num(r.handicapindex ?? r.handicap ?? r.hcp),
      side: sideOf(r.team, teams),
      flight: (r.flight || '').toUpperCase(),
      captain: truthy(r.captain),
    }))
    .filter((p) => p.name && p.side && p.hcp != null);

  // Disambiguate duplicate nicknames: last-name initial if known, else a number.
  const counts = players.reduce((c, p) => c.set(p.name, (c.get(p.name) ?? 0) + 1), new Map());
  const seen = new Map();
  for (const p of players) {
    if (counts.get(p.name) < 2) continue;
    const n = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, n);
    const initial = p.fullName.trim().split(/\s+/).pop()?.[0];
    p.name = initial ? `${p.name} ${initial}.` : `${p.name} ${n}`;
  }

  const aliases = new Map();
  for (const p of players) {
    if (p.fullName) aliases.set(key(p.fullName), p.name);
    aliases.set(key(p.name), p.name);
  }
  return { players: players.map(({ fullName, ...p }) => p), aliases };
}

function normalizeMatches(rows, teams, aliases) {
  const display = (n) => aliases.get(key(n)) ?? n;
  return (rows ?? [])
    .map((r, i) => {
      const time = parseTime(r.teetime);
      return {
        row: i,
        round: num(r.round),
        teeTime: time,
        red: [r.red1, r.red2].filter(Boolean).map(display),
        blue: [r.blue1, r.blue2].filter(Boolean).map(display),
        winner: HALVED.has(key(r.winner)) ? 'Halved' : sideOf(r.winner, teams),
        result: r.result || '',
      };
    })
    .filter((m) => m.round != null);
}

function normalizeSchedule(rows) {
  return (rows ?? [])
    .map((r) => ({
      round: num(r.round),
      format: FORMATS[key(r.format)] ?? null,
      date: parseDate(r.date),
      course: r.course || '',
      url: /^https?:\/\//i.test(r.courseurl) ? r.courseurl : r.courseurl ? `https://${r.courseurl}` : '',
      address: r.address || '',
      tees: r.tees || '',
      yardage: r.yardage || '',
      par: r.par || '',
      rating: r.rating || '',
      slope: r.slope || '',
      notes: r.notes || '',
    }))
    .filter((d) => d.round != null);
}

/**
 * Team names come from Settings ("Red Team" / "Blue Team"); without them, the
 * first two teams listed in Players are used, in order of appearance.
 */
function normalizeSettings(rows, playerRows) {
  const r = rows?.[0] ?? {};
  const listed = [...new Set(playerRows.map((p) => p.team).filter(Boolean))];
  return {
    edition: r.edition || DEFAULT_SETTINGS.edition,
    teams: { red: r.redteam || listed[0] || 'Red', blue: r.blueteam || listed[1] || 'Blue' },
    lowerPct: pct(r.lower ?? r.lowerpct ?? r.lowerhcp) ?? DEFAULT_SETTINGS.lowerPct,
    higherPct: pct(r.higher ?? r.higherpct ?? r.higherhcp) ?? DEFAULT_SETTINGS.higherPct,
    timezone: r.timezone || DEFAULT_SETTINGS.timezone,
    roundMinutes: num(r.roundminutes) ?? DEFAULT_SETTINGS.roundMinutes,
    mvp: r.mvp || '',
  };
}

export async function loadData() {
  const [players, matches, schedule, settings] = await Promise.all([
    fetchTab('Players', ['team', 'flight']),
    fetchTab('Matches', ['round', 'red1', 'blue1', 'winner']),
    fetchTab('Schedule', ['round', 'format', 'course']),
    fetchTab('Settings', ['timezone']),
  ]);
  if (!players) throw new Error('The "Players" tab is missing from the sheet.');
  const normalizedSettings = normalizeSettings(settings, players);
  const roster = normalizePlayers(players, normalizedSettings.teams);
  // The commissioner's MVP pick, as a display name (blank until chosen).
  normalizedSettings.mvp = normalizedSettings.mvp ? roster.aliases.get(key(normalizedSettings.mvp)) ?? '' : '';
  return {
    players: roster.players,
    matches: normalizeMatches(matches ?? [], normalizedSettings.teams, roster.aliases),
    schedule: normalizeSchedule(schedule),
    settings: normalizedSettings,
  };
}
