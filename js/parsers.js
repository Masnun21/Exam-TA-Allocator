// Pure parsing helpers (no DOM): course-list lines, exam-routine layout, time normalisation and matching.
// Works on "items" = [{ str, x, w, y, h, page }] taken from pdf.js text or from OCR word boxes.

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ---------- times ---------- */
const T = '(\\d{1,2})\\s*[:.]\\s*(\\d{2})\\s*([AaPp])\\.?\\s*[Mm]\\.?';
const RANGE_SRC = `${T}\\s*(?:-|–|—|to|~)?\\s*${T}`; // hyphen optional: "01:00 PM 02:30 PM"
const STAR = '([*＊•°†‡"”\'’´]+)?'; // OCR often turns the footnote asterisk into one of these

const mins = (h, m, ap) => {
  h = +h; m = +m;
  if (h < 1 || h > 12 || m > 59) return null;
  return (h % 12) * 60 + m + (/p/i.test(ap) ? 720 : 0);
};
const hhmm = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

export function parseRange(str) {
  const m = String(str ?? '').match(new RegExp(RANGE_SRC, 'i'));
  if (!m) return null;
  const a = mins(m[1], m[2], m[3]), b = mins(m[4], m[5], m[6]);
  return a == null || b == null || b <= a ? null : { start: hhmm(a), end: hhmm(b) };
}
export function findRanges(str) {
  return [...fixOcr(str).matchAll(new RegExp(`${RANGE_SRC}\\s*${STAR}`, 'gi'))].flatMap((m) => {
    const a = mins(m[1], m[2], m[3]), b = mins(m[4], m[5], m[6]);
    return a == null || b == null || b <= a ? [] : [{ start: hhmm(a), end: hhmm(b), stars: (m[7] || '').length }];
  });
}
/**
 * Forgiving range parser for hand-typed slots: "8.00-9.30 AM", "11.20-12.50 PM", "14:40-16:10",
 * "2.40 - 4.10 PM", "08:00 AM - 09:30 AM". A missing AM/PM is inferred (class slots run 8 AM to 7:30 PM).
 */
export function parseRangeLoose(str) {
  const strict = parseRange(fixOcr(str));
  if (strict) return strict;
  const TL = '(\\d{1,2})\\s*[:.]\\s*(\\d{2})\\s*([AaPp]\\.?\\s*[Mm]\\.?)?';
  const m = String(str ?? '').match(new RegExp(`${TL}(?:\\s*(?:-|–|—|to|~)\\s*|\\s+)${TL}`, 'i'));
  if (!m) return null;
  const h1 = +m[1], n1 = +m[2], h2 = +m[4], n2 = +m[5];
  if (h1 > 23 || h2 > 23 || n1 > 59 || n2 > 59) return null;
  const ap = (x) => (x ? (/p/i.test(x) ? 'p' : 'a') : '');
  let a1 = ap(m[3]), a2 = ap(m[6]);
  const at = (h, n, a) => (h > 12 || h === 0 ? h * 60 + n : (h % 12) * 60 + n + (a === 'p' ? 720 : 0));
  const flip = (a) => (a === 'p' ? 'a' : 'p');
  if (h1 > 12 || h2 > 12 || h1 === 0) { // 24-hour
    const a = h1 * 60 + n1, b = h2 * 60 + n2;
    return b > a ? { start: hhmm(a), end: hhmm(b) } : null;
  }
  if (!a1 && !a2) a1 = h1 >= 7 && h1 <= 11 ? 'a' : 'p';
  if (a1 && !a2) { a2 = a1; if (at(h2, n2, a2) <= at(h1, n1, a1)) a2 = flip(a2); }
  else if (!a1 && a2) { a1 = a2; if (at(h1, n1, a1) >= at(h2, n2, a2)) a1 = flip(a1); }
  const a = at(h1, n1, a1), b = at(h2, n2, a2);
  return b > a ? { start: hhmm(a), end: hhmm(b) } : null;
}
/** Canonical "08:00 AM - 09:30 AM", or '' when the text is not a time range. */
export const normRange = (str) => { const r = parseRangeLoose(str); return r ? fmtRange(r) : ''; };
export const STANDARD_SLOTS = ['08:00 AM - 09:30 AM', '09:40 AM - 11:10 AM', '11:20 AM - 12:50 PM', '01:00 PM - 02:30 PM', '02:40 PM - 04:10 PM', '04:20 PM - 05:50 PM', '06:00 PM - 07:30 PM'];

/** Repairs typical OCR slips inside time/date text: O->0 in digits, stray table borders, ';' for ':'. */
export function fixOcr(str) {
  return String(str ?? '')
    .replace(/[|¦]/g, ' ')
    .replace(/(^|[^A-Za-z0-9])([0-9OoIl]{1,2})\s*[:;.]\s*([0-9OoIl]{2})(?=\s*[AaPp]\.?\s*[Mm])/g,
      (_, pre, h, m) => `${pre}${h.replace(/[Oo]/g, '0').replace(/[Il]/g, '1')}:${m.replace(/[Oo]/g, '0').replace(/[Il]/g, '1')}`)
    .replace(/(\d)[Oo](?=\d)/g, '$10');
}

export const to12 = (t) => { const [h, m] = t.split(':').map(Number); return `${pad(h % 12 || 12)}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
export const fmtRange = (r) => `${to12(r.start)} - ${to12(r.end)}`;

/** "ST 09:40AM-11:10 AM", "RA 01:00 PM 02:30 PM" -> { days:'ST', start:'09:40', end:'11:10' } */
export function parseClassTime(str) {
  const m = String(str ?? '').trim().match(/^([A-Za-z]{1,4})(?![A-Za-z])\s*(.*)$/);
  const r = m && parseRange(m[2]);
  return r ? { days: m[1].toUpperCase(), ...r } : null;
}

/* ---------- dates ---------- */
/** First date in the text as { date:'YYYY-MM-DD', index, length }, or null. Handles "19Dec 2026", "22 Dec 2026", 2026-12-22, 22/12/2026. */
export function dateMatch(str) {
  const s = fixOcr(str);
  const found = [];
  let m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-\/]*([A-Za-z]{3,9})\.?,?[\s\-\/]*(\d{4})/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) found.push({ date: `${m[3]}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(m[1])}`, index: m.index, length: m[0].length });
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) found.push({ date: m[0], index: m.index, length: m[0].length });
  m = s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); // day-first
  if (m) found.push({ date: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, index: m.index, length: m[0].length });
  return found.sort((a, b) => a.index - b.index)[0] || null;
}
export const findDate = (str) => dateMatch(str)?.date || '';
export function weekday(d) {
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? DAYNAMES[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] : '';
}
export function fmtDate(d) {
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]} ${MON[+m[2] - 1]} ${m[1]} (${weekday(d)})` : '';
}

/* ---------- text items -> lines / runs ---------- */
export async function itemsFromPdf(pdf) {
  const items = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [, , , d, e, f] = it.transform;
      items.push({ str: it.str, x: e, w: it.width, y: -f, h: it.height || Math.abs(d) || 10, page: p });
    }
  }
  return items;
}

// Standalone table-border / punctuation junk that OCR emits ("|", "[", quotes...). Hyphens and asterisks are kept.
const NOISE = /^[|¦!_\[\]{}()\\'"“”‘’`´~^<>•·]+$/;
const cleanItems = (items) => items.filter((i) => i.str && i.str.trim() && !NOISE.test(i.str.trim()));

function groupLines(items) {
  // Tolerance uses the TALLER of the two words: a hyphen's box is only a few pixels high and sits a little
  // off-centre, so the smaller height used to push it onto a line of its own and split every time range.
  const sorted = cleanItems(items).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines = [];
  let cur = null;
  for (const it of sorted) {
    if (cur && cur.page === it.page && Math.abs(it.y - cur.y) <= Math.max(2, 0.5 * Math.max(cur.h, it.h || 0))) cur.items.push(it);
    else { cur = { page: it.page, y: it.y, h: it.h || 10, items: [it] }; lines.push(cur); }
  }
  lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
  return lines;
}
export const itemsToLines = (items) => groupLines(items).map((l) => l.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim());

/** Joins neighbouring words of one table cell line into a "run"; column gaps keep runs apart. */
export function mergeRuns(items) {
  const runs = [];
  for (const line of groupLines(items)) {
    let cur = null;
    for (const it of line.items) {
      const h = it.h || 10, gap = cur ? it.x - (cur.x + cur.w) : 0;
      if (cur && gap < 1.0 * Math.max(h, cur.h)) {
        cur.str += (gap > 0.12 * h ? ' ' : '') + it.str;
        cur.w = it.x + it.w - cur.x; cur.h = Math.max(cur.h, h);
      } else { cur = { str: it.str, x: it.x, w: it.w, y: it.y + it.page * 1e5, h, page: it.page }; runs.push(cur); }
    }
  }
  return runs;
}

/* ---------- course list ---------- */
const COURSE_LINE = /^(?:(\d+)\s*\.?\s+)?([A-Za-z]{2,5}\s?\d{3}[A-Za-z]?)\s+(\w+)\s+(\S+)\s+(.+?)\s+(\S+)\s+(\d+)\s*(?:\(\s*(\d+)\s*\))?\s*$/;
const LOOKS_LIKE_ROW = /^\d+\s*\.\s*[A-Za-z]{2,5}\s?\d{3}/;

/** Only the FIRST number of "26 (37)" is the enrolled count; the bracket is room capacity. */
export function parseCourseLines(lines) {
  const courses = [], bad = [];
  for (const line of lines) {
    const m = line.match(COURSE_LINE), ct = m && parseClassTime(m[5]);
    if (m && ct) {
      courses.push({ sl: m[1] || '', course: m[2].replace(/\s/g, '').toUpperCase(), section: m[3], faculty: m[4], days: ct.days, start: ct.start, end: ct.end, classTime: `${ct.days} ${fmtRange(ct)}`, room: m[6], students: +m[7], capacity: m[8] ? +m[8] : null });
    } else if (LOOKS_LIKE_ROW.test(line)) bad.push(line);
  }
  const warnings = [];
  if (bad.length) warnings.push(`${bad.length} row(s) looked like courses but could not be read, e.g. "${bad.slice(0, 3).join('" / "')}"`);
  if (!courses.length) warnings.push('No course rows were recognised. Check that this is the course list PDF.');
  return { courses, warnings };
}

/* ---------- exam routine ---------- */
/**
 * runs -> { rows:[{days,date,regular,exam}], rules:[{regular,exam}], warnings }
 * Rows come from the table geometry: the time lines of one routine row sit close together, and the
 * (vertically centred) class-days and date cells fall inside that cluster. The latest date in a row
 * is the final exam date, so a "Last Day of Class" column is ignored automatically.
 * An asterisk on a time ("05:00 PM - 06:30 PM*") plus the footnote "*Regular class slot ..." gives a shift rule.
 */
export function parseSchedule(runs) {
  const warnings = [], foot = {}, times = [], days = [], dates = [];
  const strip = new RegExp(`${RANGE_SRC}\\s*${STAR}`, 'gi');
  for (const r of runs) {
    let s = fixOcr(r.str).trim();
    if (!s) continue;
    const found = findRanges(s);
    if (found.length && /regular/i.test(s)) { foot[((s.match(/^\s*(\*+)/) || [])[1] || '*').length] = found[0]; continue; }
    // A run may hold a time range AND neighbouring text (OCR glued two cells together): pull each part out.
    found.forEach((f) => times.push({ ...f, y: r.y, x: r.x, h: r.h }));
    s = s.replace(strip, ' ');
    for (let dm; (dm = dateMatch(s)); ) { dates.push({ d: dm.date, y: r.y, x: r.x }); s = `${s.slice(0, dm.index)} ${s.slice(dm.index + dm.length)}`; }
    s = s.replace(/[^A-Za-z0-9]+/g, ' ').trim();
    if (/^[A-Z]{2,3}$/.test(s) && s !== 'AM' && s !== 'PM') days.push({ s, y: r.y, x: r.x });
  }
  if (!times.length) return { rows: [], rules: [], warnings: ['No exam time slots were recognised. Add the exam days manually below.'] };

  const rows = [], rules = [], seen = new Set();
  const mk = (ctx, t) => {
    let reg = t;
    if (t.stars) {
      reg = foot[t.stars] || foot[1];
      if (!reg) { warnings.push(`Time ${fmtRange(t)}* has an asterisk but no "*Regular class slot …" footnote was found.`); reg = t; }
      else if (!seen.has(`${fmtRange(reg)}>${fmtRange(t)}`)) { seen.add(`${fmtRange(reg)}>${fmtRange(t)}`); rules.push({ regular: fmtRange(reg), exam: fmtRange(t) }); }
    }
    if (!ctx.days || !ctx.date) warnings.push(`Slot ${fmtRange(t)} is missing ${!ctx.days ? 'class days' : 'an exam date'}; please fill it in.`);
    rows.push({ days: ctx.days || '', date: ctx.date || '', regular: fmtRange(reg), exam: fmtRange(t) });
  };

  times.sort((a, b) => a.y - b.y || a.x - b.x);
  const hs = times.map((t) => t.h).sort((a, b) => a - b), h = hs[Math.floor(hs.length / 2)] || 12;
  const same = (arr, t) => arr.filter((o) => Math.abs(o.y - t.y) <= 0.6 * h);
  const latest = (arr) => arr.map((o) => o.d).sort().pop() || '';

  if (times.filter((t) => same(days, t).length && same(dates, t).length).length >= 0.8 * times.length) {
    for (const t of times) { // flat layout: one routine row per line
      const dd = same(days, t)[0];
      if (dd) mk({ days: dd.s, date: latest(same(dates, t)) }, t);
    }
  } else {
    const gaps = [];
    for (let i = 1; i < times.length; i++) { const g = times[i].y - times[i - 1].y; if (g > 0.3 * h) gaps.push(g); }
    const pitch = gaps.length ? Math.min(...gaps) : 3 * h, groups = [];
    times.forEach((t, i) => { if (!i || t.y - times[i - 1].y > pitch * 1.6) groups.push({ times: [], days: [], dates: [] }); groups[groups.length - 1].times.push(t); });
    const dist = (g, y) => { const a = g.times[0].y, b = g.times[g.times.length - 1].y; return y < a ? a - y : y > b ? y - b : 0; };
    const place = (list, key) => list.forEach((o) => {
      let best = null, bd = Infinity;
      for (const g of groups) { const d = dist(g, o.y); if (d < bd) { bd = d; best = g; } }
      if (best && bd <= Math.max(pitch * 2.5, 3 * h)) best[key].push(o);
    });
    place(days, 'days'); place(dates, 'dates');
    for (const g of groups) {
      const ds = [...new Set(g.days.map((o) => o.s))];
      if (ds.length > 1) warnings.push(`A routine row near ${fmtRange(g.times[0])} has several class-day labels (${ds.join(', ')}); check it.`);
      for (const t of g.times) mk({ days: ds[0], date: latest(g.dates) }, t);
    }
  }
  const dup = new Set();
  rows.forEach((r) => { const k = `${r.days}|${r.regular}`; if (dup.has(k)) warnings.push(`${r.days} ${r.regular} appears more than once; the first row wins when matching.`); dup.add(k); });
  return { rows, rules, warnings };
}

/** Sets exam time for every schedule row whose regular slot equals a rule's regular slot. */
export function applyRules(sched, rules) {
  let n = 0;
  for (const rule of rules) {
    const a = parseRangeLoose(rule.regular), b = parseRangeLoose(rule.exam);
    if (!a || !b) continue;
    for (const row of sched) {
      const r = parseRangeLoose(row.regular);
      if (r && r.start === a.start && r.end === a.end) { row.exam = fmtRange(b); n++; }
    }
  }
  return n;
}

/** The exam time of a routine row: its own exam slot if filled in, else a matching time-shift rule, else the class slot. */
export function effectiveExam(row, rules = []) {
  const own = parseRangeLoose(row.exam);
  if (own) return own;
  const r = parseRangeLoose(row.regular);
  if (!r) return null;
  for (const rule of rules) {
    const a = parseRangeLoose(rule.regular), b = parseRangeLoose(rule.exam);
    if (a && b && a.start === r.start && a.end === r.end) return b;
  }
  return r;
}

/** Cross-references each course's class days + regular slot with the routine. */
export function matchCourses(courses, sched, rules = []) {
  const map = new Map();
  for (const row of sched) {
    const r = parseRangeLoose(row.regular), e = effectiveExam(row, rules), date = findDate(row.date);
    const days = String(row.days || '').trim().toUpperCase();
    if (!r || !e || !date || !days) continue;
    const k = `${days}|${r.start}-${r.end}`;
    if (!map.has(k)) map.set(k, { date, start: e.start, end: e.end, days });
  }
  return courses.map((c) => ({ ...c, match: map.get(`${c.days}|${c.start}-${c.end}`) || null }));
}

/** Why a routine row is not usable yet (used to flag rows in the editor), or ''. */
export function rowProblem(row) {
  if (!String(row.days || '').trim()) return 'Class days missing';
  if (!findDate(row.date)) return 'Exam date missing';
  if (!parseRangeLoose(row.regular)) return 'Class time not understood';
  if (String(row.exam || '').trim() && !parseRangeLoose(row.exam)) return 'Exam time not understood';
  return '';
}

/** Rows in the shape the allocator expects. */
export const toSections = (mapped) => mapped.filter((m) => m.match).map((m) => ({
  course: m.course, section: m.section, faculty: m.faculty, days: m.match.days, date: m.match.date,
  start: m.match.start, end: m.match.end, room: m.room, students: String(m.students),
}));
