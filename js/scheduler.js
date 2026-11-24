// Pure scheduling logic. No DOM access, so it runs in the browser and in Node tests.

const pad = (n) => String(n).padStart(2, '0');
export const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export function normTime(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2})[:.](\d{2})\s*([ap]m)?$/i);
  if (!m) return '';
  let h = +m[1]; const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h > 23 || +m[2] > 59 ? '' : `${pad(h)}:${m[2]}`;
}

export function normDate(v) {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); // day-first
  if (dmy) return `${dmy[3]}-${pad(dmy[2])}-${pad(dmy[1])}`;
  const d = new Date(s);
  return isNaN(d) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const splitList = (s) => String(s ?? '').split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
const TIME = '\\d{1,2}[:.]\\d{2}\\s*(?:[ap]m)?';
const CONF = new RegExp(`^(\\S+?)\\s*\\|?\\s*(${TIME})\\s*(?:-|–|to)\\s*(${TIME})$`, 'i');

/** "2026-12-10 | 09:00-11:00; 2026-12-12 14:00-16:00" -> [{date,s,e,label}] */
export function parseConflicts(str, warn = [], who = 'TA') {
  return String(str ?? '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean).flatMap((s) => {
    const m = s.match(CONF);
    const d = m && normDate(m[1]), a = m && normTime(m[2]), b = m && normTime(m[3]);
    if (!d || !a || !b) { warn.push(`${who}: could not read personal exam "${s}" (use YYYY-MM-DD HH:MM-HH:MM)`); return []; }
    return [{ date: d, s: toMin(a), e: toMin(b), label: `${d} ${a}-${b}` }];
  });
}

const clash = (a, b, buf = 0) => a.date === b.date && a.s < b.e + buf && b.s < a.e + buf;

function prepSection(s, i) {
  const date = normDate(s.date), start = normTime(s.start), end = normTime(s.end);
  const n = parseInt(s.students, 10) || 0;
  const faculty = String(s.faculty ?? '').trim();
  return {
    id: i, course: String(s.course ?? '').trim(), section: String(s.section ?? '').trim(),
    faculty, fk: faculty.toLowerCase(), days: String(s.days ?? '').trim().toUpperCase(), date, start, end,
    s: start ? toMin(start) : NaN, e: end ? toMin(end) : NaN,
    room: String(s.room ?? '').trim(), students: n, need: n > 50 ? 2 : 1,
    valid: !!(date && start && end && toMin(end) > toMin(start)),
  };
}
export const secLabel = (s) => `${s.course} - Section ${s.section}`;
const byLoad = (a, b) => a.load - b.load || a.name.localeCompare(b.name);

/**
 * Builds the roster.
 * 1. Attached-faculty sections go to the TA's own faculty first (lowest load, under a fair cap).
 * 2. Sections whose attached TAs have a personal exam clash are swapped to the least-loaded free TA.
 * 3. Remaining slots (incl. 2nd proctors) are filled most-constrained-first, lowest load first.
 * 4. A balancing pass moves duties from the busiest to the least busy TA until the spread is <= 1.
 */
export function generate(rawTAs, rawSecs, { buffer = 0 } = {}) {
  const warnings = [];
  const tas = rawTAs.filter((t) => String(t.name ?? '').trim()).map((t) => ({
    name: t.name.trim(), fac: splitList(t.faculty).map((f) => f.toLowerCase()), facRaw: splitList(t.faculty),
    busy: parseConflicts(t.conflicts, warnings, t.name.trim()), load: 0, jobs: [],
  }));
  const secs = rawSecs.map(prepSection).filter((s) => {
    if (!s.valid) warnings.push(`Skipped section row ${s.id + 1} (${s.course || '?'}): needs a valid date, start and end time.`);
    return s.valid;
  }).sort((a, b) => a.date.localeCompare(b.date) || a.s - b.s || a.e - b.e);

  // Validation: unknown faculty initials, and slots needing more proctors than free TAs.
  const known = new Set(secs.map((s) => s.fk));
  tas.forEach((t) => t.facRaw.forEach((f) => {
    if (!known.has(f.toLowerCase())) warnings.push(`${t.name}: faculty initial "${f}" does not appear in the master section list.`);
  }));
  const groups = new Map();
  secs.forEach((s) => { const k = `${s.date}|${s.start}|${s.end}`; groups.set(k, [...(groups.get(k) || []), s]); });
  for (const list of groups.values()) {
    const need = list.reduce((n, s) => n + s.need, 0), s0 = list[0];
    const avail = tas.filter((t) => !t.busy.some((b) => clash(b, s0, buffer))).length;
    if (need > avail) warnings.push(`${s0.date} ${s0.start}-${s0.end}: ${need} proctors required but only ${avail} TAs are free of personal exams.`);
  }

  const rows = secs.map((sec) => ({ sec, slots: [] }));
  const slots = [];
  rows.forEach((r) => { for (let k = 0; k < r.sec.need; k++) { const sl = { sec: r.sec, k, ta: null, tag: '', note: '' }; r.slots.push(sl); slots.push(sl); } });
  const cap = Math.ceil(slots.length / Math.max(tas.length, 1));

  const free = (t, sec) => !t.busy.some((b) => clash(b, sec, buffer)) && !t.jobs.some((j) => clash(j, sec, buffer));
  const give = (sl, t, tag, note) => { sl.ta = t.name; sl._t = t; t.load++; t.jobs.push(sl.sec); sl.tag = tag; sl.note = note; };

  // Phase 1: attached faculty TAs.
  for (const sl of slots) {
    sl.att = tas.filter((t) => t.fac.includes(sl.sec.fk));
    sl.blocked = sl.att.filter((t) => t.busy.some((b) => clash(b, sl.sec, buffer)))
      .map((t) => `${t.name} (${t.busy.find((b) => clash(b, sl.sec, buffer)).label})`);
    const ok = sl.att.filter((t) => free(t, sl.sec) && t.load < cap).sort(byLoad);
    if (ok.length) give(sl, ok[0], 'attached', `Attached to faculty ${sl.sec.faculty}`);
  }

  // Phase 2: swaps and open slots, most constrained first.
  const rest = slots.filter((s) => !s.ta);
  while (rest.length) {
    let best = null, bestEl = null;
    for (const sl of rest) {
      const el = tas.filter((t) => free(t, sl.sec));
      if (!best || el.length < bestEl.length) { best = sl; bestEl = el; if (!el.length) break; }
    }
    rest.splice(rest.indexOf(best), 1);
    if (!bestEl.length) {
      best.tag = 'unresolved'; best.note = 'No conflict-free TA available';
      warnings.push(`${secLabel(best.sec)} (${best.sec.date} ${best.sec.start}-${best.sec.end}): no conflict-free TA left for proctor ${best.k + 1}.`);
      continue;
    }
    bestEl.sort((a, b) => byLoad(a, b) || b.fac.includes(best.sec.fk) - a.fac.includes(best.sec.fk));
    const t = bestEl[0];
    if (best.blocked.length) give(best, t, 'swapped', `Reassigned from ${best.blocked.join('; ')} due to personal exam conflict`);
    else give(best, t, 'balanced', best.att.length ? 'Attached TAs were at their workload cap or already booked' : 'No TA attached to this faculty: assigned by lowest workload');
  }

  // Phase 3: balance. Move duties from the busiest to the least busy TA while the spread is > 1.
  for (let it = 0; it < 5000; it++) {
    const sorted = [...tas].sort(byLoad);
    let moved = false;
    outer: for (let h = sorted.length - 1; h > 0; h--) for (let l = 0; l < h; l++) {
      const hi = sorted[h], lo = sorted[l];
      if (hi.load - lo.load <= 1) break;
      const sl = slots.filter((s) => s._t === hi).sort((a, b) => (a.tag === 'attached') - (b.tag === 'attached'))
        .find((s) => free(lo, s.sec));
      if (!sl) continue;
      hi.load--; hi.jobs.splice(hi.jobs.indexOf(sl.sec), 1);
      lo.load++; lo.jobs.push(sl.sec); sl._t = lo; sl.ta = lo.name;
      if (sl.tag !== 'swapped') { sl.tag = 'balanced'; sl.note = `Moved from ${hi.name} to even out workload`; }
      moved = true; break outer;
    }
    if (!moved) break;
  }

  return {
    warnings,
    rows: rows.map((r) => ({ sec: r.sec, slots: r.slots.map(({ ta, tag, note }) => ({ ta, tag, note })) })),
  };
}

/** Re-validates a roster (used after manual edits). Returns { "secId:slot": message }. */
export function checkConflicts(rows, rawTAs, buffer = 0) {
  const busy = new Map(rawTAs.map((t) => [String(t.name).trim(), parseConflicts(t.conflicts)]));
  const out = {}, by = new Map();
  rows.forEach((r) => r.slots.forEach((sl, k) => {
    if (!sl.ta) return;
    const key = `${r.sec.id}:${k}`;
    if ((busy.get(sl.ta) || []).some((b) => clash(b, r.sec, buffer))) out[key] = 'Overlaps this TA\u2019s own exam';
    if (!by.has(sl.ta)) by.set(sl.ta, []);
    by.get(sl.ta).push({ key, sec: r.sec });
  }));
  for (const list of by.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (clash(list[i].sec, list[j].sec, buffer)) { out[list[i].key] ??= 'Double-booked'; out[list[j].key] ??= 'Double-booked'; }
  }
  return out;
}

export function workload(rows, rawTAs) {
  const m = new Map(rawTAs.filter((t) => String(t.name).trim()).map((t) => [t.name.trim(), { name: t.name.trim(), id: t.id || '', faculty: t.faculty || '', count: 0, mins: 0 }]));
  rows.forEach((r) => r.slots.forEach((sl) => { const w = m.get(sl.ta); if (w) { w.count++; w.mins += r.sec.e - r.sec.s; } }));
  return [...m.values()].map((w) => ({ ...w, hours: Math.round(w.mins / 6) / 10 }));
}
