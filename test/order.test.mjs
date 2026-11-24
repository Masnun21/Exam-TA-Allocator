import assert from 'node:assert/strict';
import { routineCtx, orderRows, groupBySlot } from '../js/order.js';

const R = (course, section, date, start, end, days) => ({ sec: { course, section, date, start, end, ...(days ? { days } : {}) }, slots: [] });
const S = (days, date) => ({ days, date });
const names = (g) => g.map((x) => `${x.days} ${x.date} ${x.time}`);

// Any codes, any order: the routine runs FR first, then XY, then QQ. Sections lack codes, so they come from the routine's dates.
const rows = [
  R('C2', '1', '2026-12-26', '09:40', '11:10'), R('C9', '2', '2026-12-24', '17:00', '18:30'), R('C1', '10', '2026-12-24', '08:00', '09:30'),
  R('C1', '2', '2026-12-24', '08:00', '09:30'), R('C0', '1', '2026-12-22', '08:00', '09:30'), R('C5', '1', '2026-12-24', '11:20', '12:50'), R('C6', '1', '2026-12-24', '14:40', '16:10'),
];
const ctx = routineCtx([S('FR', '2026-12-22'), S('XY', '2026-12-24'), S('QQ', '2026-12-26')]);
assert.deepEqual(names(groupBySlot(rows, ctx)), [
  'FR 2026-12-22 08:00 AM - 09:30 AM', 'XY 2026-12-24 08:00 AM - 09:30 AM', 'XY 2026-12-24 11:20 AM - 12:50 PM',
  'XY 2026-12-24 02:40 PM - 04:10 PM', 'XY 2026-12-24 05:00 PM - 06:30 PM', 'QQ 2026-12-26 09:40 AM - 11:10 AM']);
assert.deepEqual(groupBySlot(rows, ctx)[1].rows.map((r) => `${r.sec.course}-${r.sec.section}`), ['C1-2', 'C1-10'], 'numeric section order');

// The routine decides which code is first: swap the dates and the order swaps with them.
const a = groupBySlot([R('A', '1', '2026-12-24', '08:00', '09:30'), R('B', '1', '2026-12-29', '08:00', '09:30')], routineCtx([S('RA', '2026-12-24'), S('ST', '2026-12-29')]));
const b = groupBySlot([R('A', '1', '2026-12-24', '08:00', '09:30'), R('B', '1', '2026-12-29', '08:00', '09:30')], routineCtx([S('ST', '2026-12-24'), S('RA', '2026-12-29')]));
assert.deepEqual(a.map((x) => x.days), ['RA', 'ST']); assert.deepEqual(b.map((x) => x.days), ['ST', 'RA']);

// Two codes on the SAME date: routine order breaks the tie (before the time of day), and sections keep their own code.
const same = routineCtx([S('MW', '2026-12-24'), S('ST', '2026-12-24')]);
const g = groupBySlot([R('S', '1', '2026-12-24', '08:00', '09:30', 'ST'), R('M', '1', '2026-12-24', '11:20', '12:50', 'MW'), R('M', '2', '2026-12-24', '08:00', '09:30', 'MW')], same);
assert.deepEqual(g.map((x) => `${x.days} ${x.start}`), ['MW 08:00', 'MW 11:20', 'ST 08:00']);

// A section's own code wins over the date lookup; no routine at all still orders by date and time.
assert.equal(groupBySlot([R('A', '1', '2026-12-24', '08:00', '09:30', 'ZZ')], ctx)[0].days, 'ZZ');
assert.equal(groupBySlot([R('B', '1', '2026-12-25', '09:00', '10:00'), R('A', '1', '2026-12-24', '15:00', '16:00')])[0].date, '2026-12-24');
// With no imported routine, the exam calendar supplies the codes.
assert.equal(groupBySlot([R('A', '1', '2026-12-24', '08:00', '09:30')], routineCtx([], [{ days: 'KK', date: '2026-12-24', slots: [] }]))[0].days, 'KK');
assert.equal(orderRows(rows).length, rows.length); assert.equal(rows[0].sec.course, 'C2', 'input not mutated');
console.log('schedule order tests passed');
