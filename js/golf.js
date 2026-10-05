// Tournament rules: team handicaps, formats and scoring.

/** Display order and colours; team names for each side come from Settings. */
export const SIDES = ['red', 'blue'];
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
  const pts = { red: 0, blue: 0 };
  for (const m of matches) {
    if (m.winner === 'Halved') { pts.red += 0.5; pts.blue += 0.5; }
    else if (m.winner) pts[m.winner] += 1;
  }
  return pts;
}

/** Holes won by, from a match-play Result: "4&3" → 4, "2 UP" → 2, "Halved"/"AS" → 0, else null. */
export function parseMargin(result) {
  const s = String(result ?? '').trim();
  const closed = s.match(/^(\d+)\s*(?:&|and)\s*\d+$/i);
  if (closed) return +closed[1];
  const up = s.match(/^(\d+)\s*up$/i);
  if (up) return +up[1];
  if (/^(halved?|as|all square)$/i.test(s)) return 0;
  return null;
}

/** A result from the losing side's view: "2 UP" becomes "2 DOWN"; "3&2" reads the same both ways. */
export const loserResult = (result) => String(result ?? '').replace(/^(\s*\d+\s*)up(\s*)$/i, '$1DOWN$2');

const other = (side) => (side === 'red' ? 'blue' : 'red');

/** A day counts as complete once every expected match has a winner. */
export function isDayComplete(day) {
  const expected = day.formatInfo?.slots.length ?? 0;
  return day.matches.length > 0 && day.matches.length >= expected && day.matches.every((m) => m.winner);
}

/** Per-player points, record and net holes, ranked by points then net. */
export function playerStandings(days, players) {
  const rows = new Map();
  const row = (name, side) => {
    if (!rows.has(name)) rows.set(name, { name, side, points: 0, w: 0, l: 0, h: 0, net: 0, best: null, prizes: 0, log: [] });
    return rows.get(name);
  };
  for (const p of players) row(p.name, p.side);

  for (const day of days) {
    for (const m of day.matches) {
      if (!m.winner) continue;
      const margin = m.winner === 'Halved' ? 0 : parseMargin(m.result);
      for (const side of SIDES) {
        const outcome = m.winner === 'Halved' ? 'H' : m.winner === side ? 'W' : 'L';
        const signed = margin == null ? null : outcome === 'L' ? -margin : margin;
        for (const name of m[side]) {
          const r = row(name, side);
          r.points += outcome === 'W' ? 1 : outcome === 'H' ? 0.5 : 0;
          r[outcome.toLowerCase()] += 1;
          if (signed != null) r.net += signed;
          if (outcome === 'W' && margin != null && (!r.best || margin > r.best.margin)) r.best = { margin, text: m.result };
          r.log.push({
            round: day.round,
            title: dayTitle(day),
            partners: m[side].filter((n) => n !== name),
            opponents: m[other(side)],
            opponentSide: other(side),
            outcome,
            result: m.result,
          });
        }
      }
    }
    for (const prize of day.prizes ?? []) {
      const r = prize.winner && rows.get(prize.winner);
      if (!r) continue;
      r.prizes += 1;
      r.log.push({ type: 'prize', round: day.round, hole: prize.hole, prize: prize.prize });
    }
  }

  const ranked = [...rows.values()].sort((a, b) => b.points - a.points || b.net - a.net || a.name.localeCompare(b.name));
  ranked.forEach((r, i) => {
    const prev = ranked[i - 1];
    r.rank = prev && prev.points === r.points && prev.net === r.net ? prev.rank : i + 1;
  });
  return ranked;
}

const numeric = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Slope, rating and par for a day's course, or null if any is missing. */
export function courseData(day) {
  if (!day) return null;
  const slope = numeric(day.slope);
  const rating = numeric(day.rating);
  const par = numeric(day.par);
  return slope && rating && par ? { slope, rating, par } : null;
}

/** Course handicaps apply when the Settings tab asks for them and the day's course is fully rated. */
export const usesCourseHandicap = (settings, day) => settings.handicapMode === 'course' && !!courseData(day);

/** WHS course handicap: Index × Slope / 113 + (Rating − Par), rounded to a whole number. */
export function courseHandicap(index, day) {
  const c = courseData(day);
  return c ? Math.round(index * (c.slope / 113) + (c.rating - c.par)) : null;
}

/** The handicap a player plays off on a given day (course or index, per Settings). */
export const playingHandicap = (player, settings, day) =>
  (usesCourseHandicap(settings, day) ? courseHandicap(player.hcp, day) : player.hcp);

/** Shows course handicaps as whole numbers, indexes (and weighted team values) to one decimal. */
export const formatPlaying = (n) => (n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Individual handicap for one player, weighted team handicap for two; null if any is unknown. */
export function sideHandicap(names, byName, settings, day) {
  const hcps = names.map((n) => {
    const p = byName.get(n);
    return p ? playingHandicap(p, settings, day) : null;
  });
  if (!hcps.length || hcps.some((h) => h == null)) return null;
  return hcps.length === 1 ? hcps[0] : teamHcp(hcps[0], hcps[1], settings);
}

/** Stat awards; each is { names, side, label } or null. */
export function awards(standings, days, players, settings) {
  const played = days.flatMap((d) => d.matches.map((m) => ({ ...m, round: d.round, day: d }))).filter((m) => m.winner);
  const decided = played.filter((m) => m.winner !== 'Halved');
  const byName = new Map(players.map((p) => [p.name, p]));
  const joinSides = (ms, pick) => ms.map((m) => pick(m).join(' + ')).join(' / ');

  const top = standings[0];
  const leaders = top && played.length ? standings.filter((r) => r.rank === 1) : [];
  const pointsLeader = leaders.length ? {
    names: leaders.map((r) => r.name).join(' / '),
    side: leaders.every((r) => r.side === top.side) ? top.side : null,
    label: `${formatPts(top.points)} pts · ${top.net > 0 ? '+' : ''}${top.net}`,
  } : null;

  const margins = decided.map((m) => ({ m, margin: parseMargin(m.result) })).filter((x) => x.margin > 0);
  const widest = Math.max(0, ...margins.map((x) => x.margin));
  const widestMatches = margins.filter((x) => x.margin === widest).map((x) => x.m);
  const biggestWin = widest ? {
    names: joinSides(widestMatches, (m) => m[m.winner]),
    side: widestMatches[0].winner,
    label: `${widestMatches[0].result} · Day ${widestMatches[0].round}`,
  } : null;
  const toughestLoss = widest ? {
    names: joinSides(widestMatches, (m) => m[other(m.winner)]),
    side: other(widestMatches[0].winner),
    label: `Lost ${loserResult(widestMatches[0].result)}`,
  } : null;

  // Strokes between the sides: positive when the winner gave strokes, negative when they received them.
  const spreads = decided.map((m) => {
    const w = sideHandicap(m[m.winner], byName, settings, m.day);
    const l = sideHandicap(m[other(m.winner)], byName, settings, m.day);
    return { m, spread: w == null || l == null ? 0 : Math.sign(l - w) * strokes(w, l) };
  });
  const extreme = (pick, title, label) => {
    const best = Math.max(0, ...spreads.map((x) => pick(x.spread)));
    if (!best) return null;
    const ms = spreads.filter((x) => pick(x.spread) === best).map((x) => x.m);
    return { title, names: joinSides(ms, (m) => m[m.winner]), side: ms[0].winner, label: label(best) };
  };
  const plural = (n) => `${n} stroke${n === 1 ? '' : 's'}`;
  // Stroke killer: won while giving the most strokes. Fallback: biggest underdog win.
  const strokeKiller = extreme((s) => s, 'Stroke killer', (n) => `Won giving ${plural(n)}`)
    ?? extreme((s) => -s, 'Against the odds', (n) => `Won receiving ${plural(n)}`);

  // Locked in: won every match played, with at least two played (one win isn't a streak).
  const perfect = standings.filter((r) => r.w >= 2 && r.l === 0 && r.h === 0);
  const maxWins = Math.max(0, ...perfect.map((r) => r.w));
  const unbeaten = perfect.filter((r) => r.w === maxWins);
  const lockedIn = unbeaten.length ? {
    names: unbeaten.map((r) => r.name).join(' / '),
    side: unbeaten.every((r) => r.side === unbeaten[0].side) ? unbeaten[0].side : null,
    label: `Perfect ${maxWins}-0-0`,
  } : null;

  return { pointsLeader, lockedIn, biggestWin, toughestLoss, strokeKiller };
}

/** Infers a format from entered matches when the Schedule row doesn't say. */
function inferFormat(matches) {
  if (!matches.length) return null;
  return matches.every((m) => m.red.length <= 1 && m.blue.length <= 1) ? 'Singles' : null;
}

/** Merges Schedule rows and Matches into one entry per day, always DAYS long. */
export function buildDays({ schedule, matches, prizes = [] }) {
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
      prizes: prizes.filter((p) => p.round === round).sort((a, b) => (a.hole ?? 99) - (b.hole ?? 99) || a.row - b.row),
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

/** Today's calendar date in `timeZone`. */
export function todayIn(timeZone, now = Date.now()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(now).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day };
}

const dayNumber = (date) => Date.UTC(date.y, date.m - 1, date.d) / 86_400_000;

/** Whole calendar days from today (in `timeZone`) until `date`: 0 on the day, negative afterwards. */
export const daysUntil = (date, timeZone, now = Date.now()) => dayNumber(date) - dayNumber(todayIn(timeZone, now));

/** Dated days in calendar order. */
export const datedDays = (days) => days.filter((d) => d.date).sort((a, b) => dayNumber(a.date) - dayNumber(b.date));

/** The most recent day whose date has arrived (midnight in `timeZone`), or null before day 1. */
export const currentDay = (days, timeZone, now = Date.now()) =>
  datedDays(days).filter((d) => daysUntil(d.date, timeZone, now) <= 0).at(-1) ?? null;

export const formatHcp =(n) => (n == null ? '—' : n.toFixed(1));

export function formatPts(n) {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (!half) return String(whole);
  return whole ? `${whole}½` : '½';
}
