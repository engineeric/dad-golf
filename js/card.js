// The match scorecard grid, shared by score.html (editable) and the Scoreboard (compact, read-only).

import { HOLES } from './golf.js';
import { esc } from './ui.js';

export const CARD_KEY = '+ won · − lost · 0 halved · <i></i> stroke';

/**
 * Short labels for the scorecard rows. A player's Abbreviation from the Players tab wins;
 * otherwise a pair is the first letters of each ("BR/JK", longer where partners would
 * collide, e.g. "COD/COL") and a single player is the nickname up to 6 letters.
 */
export function cardLabel(names, players) {
  const set = names.map((n) => players.get(n)?.abbr || '');
  if (names.length < 2) return set[0] || (names[0] ?? '').slice(0, 6).toUpperCase();
  let n = 2;
  while (n < 6 && names[0].slice(0, n).toUpperCase() === names[1].slice(0, n).toUpperCase()) n++;
  return names.map((x, i) => set[i] || x.slice(0, n).toUpperCase()).join('/');
}

/**
 * Front and back nine as two tables. `holes` is 18 × { result, pending }; `strokes` is the
 * receiving side's strokes per hole. The editable card adds the Hcp row, a selected hole and
 * data-hole targets; the compact one is read-only.
 */
export function renderCard({ holes, strokes, receiver, card, labels, sel = null, compact = false }) {
  const edit = !compact;
  let net = 0;
  const running = holes.map((h) => (net += h.result === 'red' ? 1 : h.result === 'blue' ? -1 : 0));
  const at = (i) => (edit ? ` data-hole="${i}"` : '');
  const cell = (i, side) => {
    const r = holes[i].result;
    const cls = [];
    let mark = '';
    if (r === side) { cls.push(`won-${side}`); mark = '+'; } else if (r === 'halved') { cls.push('halved'); mark = '0'; } else if (r) { cls.push('lost'); mark = '−'; }
    if (i === sel) cls.push('cur');
    if (holes[i].pending) cls.push('pending');
    const dots = side === receiver && strokes[i] ? `<span class="stroke">${'<i></i>'.repeat(strokes[i])}</span>` : '';
    return `<td${at(i)} class="${cls.join(' ')}">${mark}${dots}</td>`;
  };
  const upCell = (i) => {
    if (!holes[i].result) return `<td${at(i)}></td>`;
    const v = running[i];
    return v === 0 ? `<td${at(i)} class="up-as">AS</td>` : `<td${at(i)} class="up-${v > 0 ? 'red' : 'blue'}">${Math.abs(v)}</td>`;
  };
  const nine = (k) => {
    const idx = Array.from({ length: HOLES / 2 }, (_, i) => i + k * 9);
    return `
      <table aria-label="Holes ${k ? '10–18' : '1–9'}">
        <tr><th class="l">Hole</th>${idx.map((i) => `<th${at(i)}>${i + 1}</th>`).join('')}</tr>
        <tr class="par"><td class="l">Par</td>${idx.map((i) => `<td${at(i)}>${card[i]?.par ?? ''}</td>`).join('')}</tr>
        ${edit ? `<tr class="hcp"><td class="l">Hcp</td>${idx.map((i) => `<td${at(i)}>${card[i]?.si ?? ''}</td>`).join('')}</tr>` : ''}
        <tr class="red"><td class="l">${esc(labels.red)}</td>${idx.map((i) => cell(i, 'red')).join('')}</tr>
        <tr class="blue"><td class="l">${esc(labels.blue)}</td>${idx.map((i) => cell(i, 'blue')).join('')}</tr>
        <tr class="up"><td class="l">Up</td>${idx.map(upCell).join('')}</tr>
      </table>`;
  };
  // The editable card is two separate panels (front and back); the compact one is one block.
  return edit
    ? `<div class="sc sc--edit">${nine(0)}</div><div class="sc sc--edit">${nine(1)}</div>`
    : `<div class="sc sc--compact">${nine(0)}${nine(1)}</div>`;
}
