/** Conversion des dates et des lignes d'export VMI+/tableur. */
import { DAY, pad, num } from './date-utils.js';
export function parseCell(value, spreadsheet = window.XLSX) {
  if (typeof value === 'number' && value > 30000 && spreadsheet) {
    const c = spreadsheet.SSF.parse_date_code(value);
    if (!c) return null;
    const year = c.y, month = c.m, day = c.d, second = Math.round(c.S);
    return { t: new Date(year, month-1, day, c.H, c.M, second).getTime(),
      rk: `${pad(day)}/${pad(month)}/${year} ${pad(c.H)}:${pad(c.M)}:${pad(second)}` };
  }
  if (typeof value === 'string') {
    const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return { t: new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +(m[6]||0)).getTime(),
      rk: `${pad(+m[1])}/${pad(+m[2])}/${m[3]} ${pad(+m[4])}:${m[5]}:${pad(+(m[6]||0))}` };
  }
  return null;
}
const normHead = value => String(value ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export function detectColumns(rows) {
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = (rows[i] || []).map(normHead);
    if (cells.includes('date') && cells.includes('vitesse') && cells.some(x => x.startsWith('debit'))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) throw new Error('En-têtes introuvables : les colonnes Date, Vitesse et Débit sont nécessaires.');
  const header = rows[headerRow] || [], groups = rows[headerRow - 1] || [];
  const find = fn => {
    for (let i = 0; i < header.length; i++) if (fn(normHead(header[i]), i)) return i;
    return null;
  };
  const groupStart = name => {
    for (let i = 0; i < groups.length; i++) if (normHead(groups[i]).includes(name)) return i;
    return null;
  };
  const fieldIn = (group, field) => {
    if (group == null) return null;
    for (let i = group; i < Math.min(group + 4, header.length); i++) {
      const x = normHead(header[i]);
      if (field === 'temp' && x.startsWith('temp')) return i;
      if (field === 'rh' && (x.startsWith('humrel') || x === 'hr')) return i;
    }
    return null;
  };
  const salon = groupStart('salon');
  const preheat = groupStart('p0sortieresitance') ?? groupStart('p0sortieresistance');
  const outside = groupStart('p1entreeair');
  return {
    headerRow,
    date: find(x => x === 'date'),
    days: find(x => x.includes('dureefonc')),
    vitCode: find(x => x === 'vitesse'),
    debit: find(x => x.startsWith('debit')),
    rpm: find(x => x.includes('tachy')),
    pwm: find(x => x.startsWith('pwm')),
    pressure: find(x => x.includes('pression')),
    filter: find(x => x.includes('etatfiltre')),
    mode: find(x => x === 'mode'),
    season: find(x => x === 'saison'),
    salonT: fieldIn(salon, 'temp'),
    salonH: fieldIn(salon, 'rh'),
    preheatT: fieldIn(preheat, 'temp'),
    preheatH: fieldIn(preheat, 'rh'),
    outsideT: fieldIn(outside, 'temp'),
    outsideH: fieldIn(outside, 'rh')
  };
}
export function recFrom(row, spreadsheet = window.XLSX, columns = null) {
  const c = columns;
  const parsed = parseCell(row[c ? c.date : 0], spreadsheet);
  if (!parsed) return null;
  const at = i => i == null ? null : num(row[i]);
  const record = {
    t: parsed.t, rk: parsed.rk, d: at(c ? c.days : 11),
    st: at(c ? c.salonT : 117), sh: at(c ? c.salonH : 118),
    t1: at(c ? c.preheatT : 40), h1: at(c ? c.preheatH : 41),
    te: at(c ? c.outsideT : 43), he: at(c ? c.outsideH : 44),
    rpm: at(c ? c.rpm : 25), fil: at(c ? c.filter : 20),
    vit: null, vitCode: at(c ? c.vitCode : 22),
    debit: at(c ? c.debit : 23), pwm: at(c ? c.pwm : 26),
    pressure: at(c ? c.pressure : 19), mode: at(c ? c.mode : 3),
    season: at(c ? c.season : 12), boost: null, hol: null
  };
  return ['st','sh','te','he','t1','h1','rpm','fil','vitCode','debit'].some(key => record[key] != null) ? record : null;
}
export const dayNumber = timestamp => {
  const d = new Date(timestamp);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
};
