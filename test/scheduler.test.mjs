import assert from 'node:assert/strict';
import { generate, checkConflicts, workload } from '../js/scheduler.js';
import { sampleTAs, sampleSections } from '../js/sample.js';

// 1. Sample data: valid, complete, conflict-free and balanced.
const { rows, warnings } = generate(sampleTAs, sampleSections);
assert.deepEqual(warnings, []);
assert.deepEqual(checkConflicts(rows, sampleTAs), {});
for (const r of rows) {
  assert.equal(r.slots.length, r.sec.students > 50 ? 2 : 1);
  assert.ok(r.slots.every((s) => s.ta), `unassigned: ${r.sec.course}`);
  assert.equal(new Set(r.slots.map((s) => s.ta)).size, r.slots.length);
}
const counts = workload(rows, sampleTAs).map((w) => w.count);
const spread = Math.max(...counts) - Math.min(...counts);
console.log('sections:', rows.length, 'loads:', counts.join(','), 'spread:', spread);
assert.ok(spread <= 1, 'workload spread should be at most 1');
assert.ok(rows.flatMap((r) => r.slots).some((s) => s.tag === 'swapped'), 'sample should exercise swaps');

// 2. Swap reports the original TA and conflict time.
const tas = [{ name: 'A', faculty: 'X', conflicts: '2026-12-14 | 09:00-11:00' }, { name: 'B', faculty: 'Y', conflicts: '' }];
const sec = [{ course: 'C1', section: '1', faculty: 'X', date: '2026-12-14', start: '09:00', end: '11:00', room: '1', students: '30' }];
const sl = generate(tas, sec).rows[0].slots[0];
assert.equal(sl.ta, 'B'); assert.equal(sl.tag, 'swapped');
assert.match(sl.note, /A \(2026-12-14 09:00-11:00\)/);

// 3. Validation warnings.
const bad = generate([{ name: 'A', faculty: 'ZZZ', conflicts: '' }], [{ ...sec[0], students: '60' }]);
assert.ok(bad.warnings.some((w) => w.includes('"ZZZ"')), 'unknown initial warning');
assert.ok(bad.warnings.some((w) => w.includes('proctors required')), 'shortage warning');
assert.equal(bad.rows[0].slots.filter((s) => s.ta).length, 1);

// 4. Manual double-booking is detected.
const r2 = generate(tas, [...sec, { ...sec[0], course: 'C2' }]).rows;
r2[1].slots[0].ta = r2[0].slots[0].ta;
assert.ok(Object.keys(checkConflicts(r2, tas)).length >= 2);
console.log('all tests passed');
