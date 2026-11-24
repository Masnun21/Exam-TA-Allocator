// Orders the final schedule the way the imported exam routine runs, for ANY class-days codes (RA, ST, MW, FR, …):
// by exam date, then (if two codes share a date) in routine order, then by time slot. Pure logic (no DOM).
import { to12, weekday, fmtDate } from './parsers.js';
import { normDate } from './scheduler.js';

/** Context used to order and label sections: which class-days code sits each date, and the routine's position of each exam day. */
export function routineCtx(sched = [], cal = []) {
  const src = (sched || []).filter((r) => r.days && normDate(r.date)).length
    ? sched.map((r) => ({ days: r.days, date: normDate(r.date) })) : (cal || []).map((r) => ({ days: r.days, date: normDate(r.date) }));
  const first = new Map(); // "CODE|date" -> first position in the routine
  src.forEach((r, i) => { const k = `${String(r.days).toUpperCase()}|${r.date}`; if (r.days && r.date && !first.has(k)) first.set(k, i); });
  const rank = new Map([...first].sort((a, b) => a[0].split('|')[1].localeCompare(b[0].split('|')[1]) || a[1] - b[1]).map(([k], i) => [k, i]));
  const byDate = new Map();
  for (const k of rank.keys()) { const [code, date] = k.split('|'); if (!byDate.has(date)) byDate.set(date, code); }
  return { rank, byDate };
}

const codeOf = (sec, ctx) => String(sec.days || '').toUpperCase() || ctx.byDate.get(sec.date) || '';
const pos = (sec, ctx) => ctx.rank.get(`${codeOf(sec, ctx)}|${sec.date}`) ?? 0;
const slotKey = (r, ctx) => `${r.sec.date} ${String(pos(r.sec, ctx)).padStart(4, '0')} ${r.sec.start} ${r.sec.end}`;
const empty = { rank: new Map(), byDate: new Map() };

/** Rows sorted by date, routine position, start, end, then course and section. Returns a new array. */
export function orderRows(rows, ctx = empty) {
  return [...rows].sort((a, b) => slotKey(a, ctx).localeCompare(slotKey(b, ctx)) ||
    a.sec.course.localeCompare(b.sec.course, undefined, { numeric: true }) ||
    String(a.sec.section).localeCompare(String(b.sec.section), undefined, { numeric: true }));
}

/** [{ date, start, end, days, title, time, rows }] in routine order, one entry per exam slot. */
export function groupBySlot(rows, ctx = empty) {
  const out = [];
  for (const r of orderRows(rows, ctx)) {
    const key = slotKey(r, ctx), last = out[out.length - 1];
    if (last && last.key === key) { last.rows.push(r); continue; }
    const { date, start, end } = r.sec, days = codeOf(r.sec, ctx);
    out.push({
      key, date, start, end, days, rows: [r],
      title: `${days ? `${days}  ·  ` : ''}${weekday(date)}, ${fmtDate(date).replace(/ \(\w+\)$/, '')}`,
      time: `${to12(start)} - ${to12(end)}`,
    });
  }
  return out;
}
