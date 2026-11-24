import assert from 'node:assert/strict';
import { parseClassTime, parseCourseLines, mergeRuns, parseSchedule, matchCourses, applyRules, toSections, findDate } from '../js/parsers.js';

// Time / class-time normalisation
assert.deepEqual(parseClassTime('ST 09:40AM-11:10 AM'), { days: 'ST', start: '09:40', end: '11:10' });
assert.deepEqual(parseClassTime('RA 01:00 PM 02:30 PM'), { days: 'RA', start: '13:00', end: '14:30' });
assert.deepEqual(parseClassTime('MW 06:00 PM - 07:30 PM'), { days: 'MW', start: '18:00', end: '19:30' });
assert.equal(findDate('22 Dec 2026'), '2026-12-22');

// Course lines: only the first number of "26 (37)" counts
const lines = [
  'North South University', 'Sl no. Course Section Faculty',
  '1. ANT101 1 NJE ST 02:40 PM - 04:10 PM NAC202 26 (37)',
  '3. ANT101 3 RJS RA 09:40 AM - 11:10 AM NAC415 68 (71)',
  '22. PAD201 6 RZU RA 06:00 PM - 07:30 PM NAC304 24 (35)',
  '23. PAD201 7 SAE ST 06:00 PM - 07:30 PM NAC303 43 (44)',
  '24. SOC101 7 SuA2 ST 09:40AM-11:10 AM NAC512A 30 (35)',
  '25. SOC101 8 AAA RA 01:00 PM 02:30 PM NAC1078 28 (35)',
  '26. BROKEN LINE 12 (3)',
];
const { courses, warnings: cw } = parseCourseLines(lines);
assert.equal(courses.length, 6);
assert.equal(courses[0].students, 26); assert.equal(courses[0].capacity, 37);
assert.equal(courses[4].faculty, 'SuA2'); assert.equal(courses[4].room, 'NAC512A');
assert.equal(courses[5].start, '13:00');

// Routine laid out like the Fall-2026 sample (cells vertically centred, words as OCR would give them)
const items = [];
const put = (text, x, y) => { let cx = x; text.split(' ').forEach((w) => { items.push({ str: w, x: cx, w: w.length * 8, y, h: 16, page: 1 }); cx += w.length * 8 + 6; }); };
put('Class Days', 120, 258); put('Final Exam Date', 360, 258); put('Class Time Slot', 667, 258);
const AM = ['08:00 AM - 09:30 AM', '11:20 AM - 12:50 PM', '02:40 PM - 04:10 PM', '05:00 PM - 06:30 PM*'];
const PM = ['09:40 AM - 11:10 AM', '01:00 PM - 02:30 PM', '04:20 PM - 05:50 PM'];
[['ST', '15 Dec 2026', '22 Dec 2026', 'Tuesday', AM, 321], ['ST', '15 Dec 2026', '23 Dec 2026', 'Wednesday', PM, 472],
 ['RA', '19 Dec 2026', '24 Dec 2026', 'Thursday', AM, 581], ['RA', '19 Dec 2026', '26 Dec 2026', 'Saturday', PM, 744],
 ['MW', '20 Dec 2026', '27 Dec 2026', 'Sunday', AM, 864], ['MW', '20 Dec 2026', '28 Dec 2026', 'Monday', PM, 1026]].forEach(([d, last, exam, wd, ts, y0]) => {
  const yc = y0 + ((ts.length - 1) * 22) / 2;
  put(d, 130, yc); put(last, 207, yc - 11); put('Tuesday', 207, yc + 11); put(exam, 360, yc); put(wd, 530, yc);
  ts.forEach((t, i) => put(t, 667, y0 + i * 22));
});
put('*Regular class slot 06:00PM - 07:30PM', 118, 1150);

const sched = parseSchedule(mergeRuns(items));
assert.deepEqual(sched.warnings, []);
assert.equal(sched.rows.length, 21);
assert.deepEqual(sched.rules, [{ regular: '06:00 PM - 07:30 PM', exam: '05:00 PM - 06:30 PM' }]);

// Matching (the two examples from the brief)
const m = matchCourses(courses, sched.rows);
const pick = (c, s) => m.find((x) => x.course === c && x.section === s).match;
assert.deepEqual(pick('ANT101', '3'), { days: 'RA', date: '2026-12-26', start: '09:40', end: '11:10' });
assert.deepEqual(pick('PAD201', '7'), { days: 'ST', date: '2026-12-22', start: '17:00', end: '18:30' });
assert.deepEqual(pick('PAD201', '6'), { days: 'RA', date: '2026-12-24', start: '17:00', end: '18:30' });
assert.deepEqual(pick('SOC101', '7'), { days: 'ST', date: '2026-12-23', start: '09:40', end: '11:10' });
assert.equal(toSections(m).length, 6);

// Custom shift rule applied from the UI
const custom = [{ days: 'ST', date: '2026-12-22', regular: '06:00 PM - 07:30 PM', exam: '06:00 PM - 07:30 PM' }];
assert.equal(applyRules(custom, [{ regular: '6:00PM-7:30PM', exam: '05:00 PM - 06:30 PM' }]), 1);
assert.equal(custom[0].exam, '05:00 PM - 06:30 PM');
assert.equal(matchCourses([courses[3]], custom)[0].match.start, '17:00');

// Unmatched stays unmatched
assert.equal(matchCourses(courses, []).filter((c) => !c.match).length, 6);
console.log('parser tests passed');

/* ---------- regression: real Tesseract output quirks (Fall-2026 photo) ---------- */
import { parseRangeLoose, normRange, effectiveExam, rowProblem, dateMatch, fixOcr } from '../js/parsers.js';
{
  // The hyphen comes back as its own tiny, slightly lower box; table borders come back as "|"; "19Dec" has no space.
  const it = []; const word = (str, x, y, h = 14) => it.push({ str, x, w: str.length * 8, y, h, page: 1 });
  const time = (a, b, x, y, star = '') => { word(a.split(' ')[0], x, y); word(a.split(' ')[1], x + 48, y); word('-', x + 72, y + 3, 2); word(b.split(' ')[0], x + 88, y); word(b.split(' ')[1] + star, x + 136, y); };
  word('ST', 129, 367); word('15', 208, 363); word('Dec', 228, 363); word('2026', 262, 363); word('|', 330, 365, 30);
  word('22', 360, 363); word('Dec', 380, 363); word('2026', 415, 363); word('Tuesday', 531, 365); word('|', 640, 365, 30);
  time('08:00 AM', '09:30 AM', 667, 322); time('11:20 AM', '12:50 PM', 667, 344); time('02:40 PM', '04:10 PM', 667, 367); time('05:00 PM', '06:30 PM', 667, 388, '*');
  word('RA', 129, 621); word('19Dec', 205, 625); word('2026', 260, 625); word('24', 360, 621); word('Dec', 380, 621); word('2026', 415, 621);
  time('08:00 AM', '09:30 AM', 667, 581); time('11:20 AM', '12:50 PM', 667, 603); time('02:40 PM', '04:10 PM', 667, 625); time('05:00 PM', '06:30 PM', 667, 648, '*');
  word('“Regular', 118, 1150); word('class', 180, 1150); word('slot', 220, 1150); word('06:00PM', 260, 1150); word('-', 324, 1152, 2); word('07:30PM', 340, 1150);
  const r = parseSchedule(mergeRuns(it));
  assert.deepEqual(r.warnings, []);
  assert.equal(r.rows.length, 8);
  assert.deepEqual(r.rows[0], { days: 'ST', date: '2026-12-22', regular: '08:00 AM - 09:30 AM', exam: '08:00 AM - 09:30 AM' });
  assert.deepEqual(r.rows[3], { days: 'ST', date: '2026-12-22', regular: '06:00 PM - 07:30 PM', exam: '05:00 PM - 06:30 PM' });
  assert.equal(r.rows[4].days, 'RA'); assert.equal(r.rows[4].date, '2026-12-24');
  assert.deepEqual(r.rules, [{ regular: '06:00 PM - 07:30 PM', exam: '05:00 PM - 06:30 PM' }]);
}
assert.equal(dateMatch('19Dec 2026').date, '2026-12-19');
assert.equal(fixOcr('O8:OO AM'), '08:00 AM');

/* ---------- hand-typed times ---------- */
assert.deepEqual(parseRangeLoose('8.00-9.30 AM'), { start: '08:00', end: '09:30' });
assert.deepEqual(parseRangeLoose('11.20-12.50 PM'), { start: '11:20', end: '12:50' });
assert.deepEqual(parseRangeLoose('2.40-4.10 PM'), { start: '14:40', end: '16:10' });
assert.deepEqual(parseRangeLoose('6.00-7.30'), { start: '18:00', end: '19:30' });
assert.deepEqual(parseRangeLoose('9:40 - 11:10'), { start: '09:40', end: '11:10' });
assert.deepEqual(parseRangeLoose('14:40-16:10'), { start: '14:40', end: '16:10' });
assert.deepEqual(parseRangeLoose('01:00 PM 02:30 PM'), { start: '13:00', end: '14:30' });
assert.equal(parseRangeLoose('soon'), null);
assert.equal(normRange('5.00-6.30 PM'), '05:00 PM - 06:30 PM');

// A manual routine: ONE exam day with several time slots, exam time left blank, evening slot shifted by a rule
{
  const rules = [{ regular: '06:00 PM - 07:30 PM', exam: '05:00 PM - 06:30 PM' }];
  const sched = ['8.00-9.30 AM', '11.20-12.50 PM', '2.40-4.10 PM', '6.00-7.30 PM'].map((t) => ({ gid: 'g1', days: 'st', date: '2026-12-22', regular: t, exam: '' }));
  const cs = [
    { course: 'A', days: 'ST', start: '08:00', end: '09:30' }, { course: 'B', days: 'ST', start: '11:20', end: '12:50' },
    { course: 'C', days: 'ST', start: '14:40', end: '16:10' }, { course: 'D', days: 'ST', start: '18:00', end: '19:30' },
    { course: 'E', days: 'RA', start: '08:00', end: '09:30' },
  ];
  const got = matchCourses(cs, sched, rules).map((x) => x.match && `${x.match.date} ${x.match.start}-${x.match.end}`);
  assert.deepEqual(got, ['2026-12-22 08:00-09:30', '2026-12-22 11:20-12:50', '2026-12-22 14:40-16:10', '2026-12-22 17:00-18:30', null]);
  assert.deepEqual(effectiveExam({ regular: '06:00 PM - 07:30 PM', exam: '' }, rules), { start: '17:00', end: '18:30' });
  assert.deepEqual(effectiveExam({ regular: '06:00 PM - 07:30 PM', exam: '04.00-5.30 PM' }, rules), { start: '16:00', end: '17:30' }); // own value wins
}
assert.equal(rowProblem({ days: 'ST', date: '2026-12-22', regular: '8.00-9.30 AM', exam: '' }), '');
assert.equal(rowProblem({ days: '', date: '2026-12-22', regular: '8.00-9.30 AM', exam: '' }), 'Class days missing');
assert.equal(rowProblem({ days: 'ST', date: '', regular: '8.00-9.30 AM', exam: '' }), 'Exam date missing');
console.log('manual-entry + OCR regression tests passed');
// Sections handed to the allocator keep their class-days code (used to order and label the final schedule)
assert.ok(toSections(m).every((x) => /^[A-Z]+$/.test(x.days)));
