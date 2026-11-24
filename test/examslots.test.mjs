import assert from 'node:assert/strict';
import { DEFAULT_SETS, DEFAULT_CAL, parseSlot, parseSlotList, parseEntries, serializeEntries, toggleEntry, addEntries, removeEntries, removeAt, hasEntry, calFromRoutine, chipLabel, migrateCal } from '../js/examslots.js';
import { parseConflicts } from '../js/scheduler.js';

// Built-in slots match the university routine.
assert.deepEqual(DEFAULT_SETS.A, ['08:00-09:30', '11:20-12:50', '14:40-16:10', '17:00-18:30']);
assert.deepEqual(DEFAULT_SETS.B, ['09:40-11:10', '13:00-14:30', '16:20-17:50']);
assert.equal(DEFAULT_CAL.length, 6);

// Slots parse from 24h and 12h text.
assert.deepEqual(parseSlot('8.00 AM - 9.30 AM'), { start: '08:00', end: '09:30' });
assert.deepEqual(parseSlot('14:40-16:10'), { start: '14:40', end: '16:10' });
assert.equal(parseSlot('nonsense'), null);
assert.deepEqual(parseSlotList('08:00-09:30, 11:20-12:50'), ['08:00-09:30', '11:20-12:50']);
assert.equal(parseSlotList('08:00-09:30, oops'), null);
assert.equal(parseSlotList(''), null);

// Several exams on one day, sorted, written in the format the scheduler reads.
let t = '';
t = toggleEntry(t, { date: '2026-12-22', start: '11:20', end: '12:50' });
t = toggleEntry(t, { date: '2026-12-22', start: '08:00', end: '09:30' });
t = toggleEntry(t, { date: '2026-12-23', start: '13:00', end: '14:30' });
assert.equal(t, '2026-12-22 | 08:00-09:30; 2026-12-22 | 11:20-12:50; 2026-12-23 | 13:00-14:30');
const parsed = parseConflicts(t);
assert.equal(parsed.length, 3, 'scheduler must read what the picker writes');
assert.equal(parsed[0].s, 8 * 60); assert.equal(parsed[1].s, 11 * 60 + 20);

// Toggle removes, no duplicates, existing hand-typed text is understood.
assert.equal(toggleEntry(t, { date: '2026-12-22', start: '08:00', end: '09:30' }), '2026-12-22 | 11:20-12:50; 2026-12-23 | 13:00-14:30');
assert.equal(addEntries(t, [{ date: '2026-12-22', start: '08:00', end: '09:30' }]), t);
const typed = '2026-12-22 | 8:00-9:30; 22/12/2026 11:20 - 12:50';
assert.ok(hasEntry(typed, { date: '2026-12-22', start: '08:00', end: '09:30' }));
assert.ok(hasEntry(typed, { date: '2026-12-22', start: '11:20', end: '12:50' }));

// Select-all / unselect-all style bulk operations.
const day = DEFAULT_SETS.A.map(parseSlot).map((s) => ({ date: '2026-12-22', ...s }));
const all = addEntries('', day);
assert.equal(parseEntries(all).length, 4);
assert.equal(removeEntries(all, day), '');

// Unreadable text is kept (never silently lost) until the user removes it.
const mixed = '2026-12-22 | 08:00-09:30; lunch with dean';
assert.equal(serializeEntries(parseEntries(mixed)), mixed);
assert.equal(toggleEntry(mixed, { date: '2026-12-22', start: '11:20', end: '12:50' }), '2026-12-22 | 08:00-09:30; 2026-12-22 | 11:20-12:50; lunch with dean');
assert.equal(removeAt(mixed, 1), '2026-12-22 | 08:00-09:30');

// Calendar is rebuilt from ANY routine: its own class-days codes, dates and (time-shifted) exam slots, in routine order.
const row = (days, date, regular, exam = '') => ({ days, date, regular, exam });
const sched = [
  row('FR', '2026-12-10', '08:00 AM - 09:30 AM'), row('FR', '2026-12-10', '06:00 PM - 07:30 PM'), row('FR', '2026-12-10', '11:20 AM - 12:50 PM'),
  row('XY', '2026-12-09', '09:40 AM - 11:10 AM'),
  row('SA', '2026-12-10', '01:00 PM - 02:30 PM'),
];
const rules = [{ regular: '06:00 PM - 07:30 PM', exam: '05:00 PM - 06:30 PM' }];
const built = calFromRoutine(sched, rules);
assert.deepEqual(built, [
  { days: 'XY', date: '2026-12-09', slots: ['09:40-11:10'] },
  { days: 'FR', date: '2026-12-10', slots: ['08:00-09:30', '11:20-12:50', '17:00-18:30'] },
  { days: 'SA', date: '2026-12-10', slots: ['13:00-14:30'] },
]);
assert.deepEqual(calFromRoutine([], []), []);
// old saved calendars (with set A/B) are upgraded in place
const old = migrateCal([{ days: 'ST', set: 'B', date: '2026-12-23' }]);
assert.deepEqual(old, [{ days: 'ST', date: '2026-12-23', slots: DEFAULT_SETS.B }]);
assert.ok(DEFAULT_CAL.every((r) => r.slots.length >= 3 && !('set' in r)));

assert.equal(chipLabel({ start: '08:00', end: '09:30' }), '8:00–9:30 AM');
assert.equal(chipLabel({ start: '11:20', end: '12:50' }), '11:20 AM–12:50 PM');
assert.equal(chipLabel({ start: '17:00', end: '18:30' }), '5:00–6:30 PM');
console.log('exam slot tests passed');
