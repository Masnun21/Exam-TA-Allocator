// Generic exam slots + exam calendar + helpers to read/write a TA's "personal exams" text.
// Pure logic (no DOM) so it can be tested in Node. The text format is the same one the scheduler reads:
//   "2026-12-22 | 08:00-09:30; 2026-12-22 | 11:20-12:50"
import { normDate, normTime } from './scheduler.js';
import { effectiveExam } from './parsers.js';

/** The university's fixed final-exam time slots (24h). Set A = first exam day (4 slots), set B = second exam day (3 slots). */
export const DEFAULT_SETS = {
  A: ['08:00-09:30', '11:20-12:50', '14:40-16:10', '17:00-18:30'],
  B: ['09:40-11:10', '13:00-14:30', '16:20-17:50'],
};

/** Starting point before a routine is imported: one row per exam day. Importing a routine replaces these with the routine's own days and times.
 *  Row = { days: class-days code, date, slots: ['08:00-09:30', …] } */
export const DEFAULT_CAL = [['ST', 'A'], ['ST', 'B'], ['RA', 'A'], ['RA', 'B'], ['MW', 'A'], ['MW', 'B']]
  .map(([days, k]) => ({ days, date: '', slots: [...DEFAULT_SETS[k]] }));

/** Calendars saved by an older version used { set: 'A' | 'B' } instead of their own slots. */
export function migrateCal(cal, sets = DEFAULT_SETS) {
  for (const r of cal) { if (!Array.isArray(r.slots)) r.slots = [...(sets[r.set] || DEFAULT_SETS.A)]; delete r.set; }
  return cal;
}

const T = '\\d{1,2}[:.]\\d{2}\\s*(?:[ap]m)?';
const ENTRY = new RegExp(`^(\\S+?)\\s*\\|?\\s*(${T})\\s*(?:-|–|to)\\s*(${T})$`, 'i');
const SLOT = new RegExp(`^(${T})\\s*(?:-|–|to)\\s*(${T})$`, 'i');

/** "08:00-09:30" (or "8.00 AM - 9.30 AM") -> { start:'08:00', end:'09:30' } or null. */
export function parseSlot(str) {
  const m = String(str ?? '').trim().match(SLOT);
  const start = m && normTime(m[1]), end = m && normTime(m[2]);
  return start && end ? { start, end } : null;
}
export const slotText = (s) => `${s.start}-${s.end}`;

/** Comma-separated slot text -> clean list, or null if any part is unreadable or the list is empty. */
export function parseSlotList(text) {
  const parts = String(text ?? '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const out = parts.map(parseSlot);
  return out.length && out.every(Boolean) ? out.map(slotText) : null;
}

/** Personal-exam text -> [{date,start,end}] plus {raw} for pieces that could not be read (kept so nothing is lost). */
export function parseEntries(str) {
  return String(str ?? '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(ENTRY);
    const date = m && normDate(m[1]), start = m && normTime(m[2]), end = m && normTime(m[3]);
    return date && start && end ? { date, start, end } : { raw: s };
  });
}

const cmp = (a, b) => (a.date + a.start + a.end).localeCompare(b.date + b.start + b.end);

/** [{date,start,end}|{raw}] -> "2026-12-22 | 08:00-09:30; …" (sorted, duplicates removed, unreadable text kept at the end). */
export function serializeEntries(list) {
  const seen = new Set(), good = [];
  for (const e of list) {
    if (e.raw) continue;
    const k = `${e.date}|${e.start}|${e.end}`;
    if (!seen.has(k)) { seen.add(k); good.push(e); }
  }
  good.sort(cmp);
  return [...good.map((e) => `${e.date} | ${e.start}-${e.end}`), ...list.filter((e) => e.raw).map((e) => e.raw)].join('; ');
}

export const sameEntry = (a, b) => !a.raw && !b.raw && a.date === b.date && a.start === b.start && a.end === b.end;
export const hasEntry = (str, e) => parseEntries(str).some((x) => sameEntry(x, e));

/** Adds the entry if the TA does not have it yet, removes it if they do. Returns the new text. */
export function toggleEntry(str, e) {
  const list = parseEntries(str);
  return serializeEntries(list.some((x) => sameEntry(x, e)) ? list.filter((x) => !sameEntry(x, e)) : [...list, e]);
}
/** Adds all entries (skipping ones already there). */
export function addEntries(str, entries) { return serializeEntries([...parseEntries(str), ...entries]); }
/** Removes all entries. */
export function removeEntries(str, entries) { return serializeEntries(parseEntries(str).filter((x) => !entries.some((e) => sameEntry(x, e)))); }
/** Removes the entry at position i of parseEntries(str) (used by the ✕ on the selected list; also drops unreadable text). */
export function removeAt(str, i) { const l = parseEntries(str); l.splice(i, 1); return serializeEntries(l); }

/** Builds the exam calendar from an imported routine, for ANY class-days codes: one row per (class days, date), in the order the
 *  routine runs (by date, ties by routine order), holding the real exam slots of that day (time-shift rules applied). */
export function calFromRoutine(sched = [], rules = []) {
  const days = new Map();
  (sched || []).forEach((r, i) => {
    const code = String(r.days || '').trim().toUpperCase(), date = normDate(r.date), ex = effectiveExam(r, rules);
    if (!code || !date || !ex) return;
    const k = `${code}|${date}`;
    if (!days.has(k)) days.set(k, { days: code, date, first: i, slots: new Set() });
    days.get(k).slots.add(`${ex.start}-${ex.end}`);
  });
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date) || a.first - b.first)
    .map((d) => ({ days: d.days, date: d.date, slots: [...d.slots].sort() }));
}

/** "08:00" + "09:30" -> "8:00–9:30 AM"; crossing noon -> "11:20 AM–12:50 PM". */
export function chipLabel(slot) {
  const f = (t) => { const [h, m] = t.split(':').map(Number); return { txt: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, ap: h >= 12 ? 'PM' : 'AM' }; };
  const a = f(slot.start), b = f(slot.end);
  return a.ap === b.ap ? `${a.txt}–${b.txt} ${b.ap}` : `${a.txt} ${a.ap}–${b.txt} ${b.ap}`;
}
