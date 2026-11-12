/** Conversion des dates et des lignes d'export VMI+/tableur. */
import { DAY, pad, num } from './date-utils.js';
export function parseCell(value, spreadsheet = window.XLSX) {
  if (typeof value === 'number' && value > 30000 && spreadsheet) {
    const c = spreadsheet.SSF.parse_date_code(value);
    if (!c) return null;
    const swap = c.d <= 12, year = c.y, month = swap ? c.d : c.m, day = swap ? c.m : c.d, second = Math.round(c.S);
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
export function recFrom(row, spreadsheet = window.XLSX) {
  const parsed = parseCell(row[0], spreadsheet);
  if (!parsed) return null;
  const record = { t:parsed.t, rk:parsed.rk, d:num(row[11]), st:num(row[117]), sh:num(row[118]),
    t1:num(row[40]), h1:num(row[41]), te:num(row[43]), he:num(row[44]), rpm:num(row[25]),
    fil:num(row[20]), vit:null, boost:null, hol:null };
  return ['st','sh','t1','h1','te','he','rpm','fil'].some(key=>record[key]!=null) ? record : null;
}
export const dayNumber = timestamp => {
  const d = new Date(timestamp);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
};
