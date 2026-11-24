import { generate, checkConflicts, workload, normDate, normTime, secLabel } from './scheduler.js';
import { sampleTAs, sampleSections } from './sample.js';
import { initImport } from './import.js';
import { initPicker, countExams } from './picker.js';
import { routineCtx, orderRows, groupBySlot } from './order.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const KEY = 'ta-proctor-v1';

const COLS = {
  tas: [['id', 'TA ID'], ['name', 'TA name'], ['faculty', 'Attached faculty initials'], ['conflicts', 'Personal exams (date | start-end; …)']],
  secs: [['course', 'Course'], ['section', 'Section'], ['faculty', 'Faculty'], ['date', 'Date'], ['start', 'Start'], ['end', 'End'], ['room', 'Room'], ['students', 'Students']],
};
const ALIAS = {
  id: ['id', 'taid'], name: ['name', 'taname', 'ta'], faculty: ['faculty', 'facultyinitial', 'facultyinitials', 'attachedfaculty', 'attachedfacultyinitials', 'initials'],
  conflicts: ['conflicts', 'personalexams', 'personalexamschedule', 'exams', 'conflict'],
  course: ['course', 'coursecode'], section: ['section', 'sec', 'sectionnumber'], date: ['date', 'examdate'],
  start: ['start', 'starttime', 'from'], end: ['end', 'endtime', 'to'], room: ['room', 'roomno', 'roomnumber'],
  students: ['students', 'totalstudents', 'enrolled', 'totalenrolled', 'totalenrolledstudents'],
};
const BLANK = { tas: { id: '', name: '', faculty: '', conflicts: '' }, secs: { course: '', section: '', faculty: '', date: '', start: '', end: '', room: '', students: '' } };
const LABEL = { attached: 'Faculty match', swapped: 'Auto-swapped', balanced: 'Balanced', manual: 'Manual', unresolved: 'Unresolved' };

let state;
try { state = JSON.parse(localStorage.getItem(KEY)); } catch { /* ignore */ }
state ||= { tas: clone(sampleTAs), secs: clone(sampleSections), rows: null, buffer: 0, warnings: [] };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ } };

/* ---------- tabs ---------- */
function show(tab) {
  $('#notice').hidden = true;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== `tab-${tab}`; });
}

/* ---------- data tables ---------- */
const pickLabel = (n) => (n ? `Pick <span class="cnt">${n}</span>` : 'Pick');
function cellHtml(kind, c, r, i) {
  const inp = `<input data-k="${kind}" data-i="${i}" data-c="${c[0]}" value="${esc(r[c[0]])}" aria-label="${c[1]}">`;
  return kind === 'tas' && c[0] === 'conflicts'
    ? `<div class="pe">${inp}<button class="pick" data-pick="${i}" title="Choose exam days and time slots with one tap" aria-label="Pick personal exams for ${esc(r.name || 'this TA')}">${pickLabel(countExams(r.conflicts))}</button></div>`
    : inp;
}
function renderData(kind) {
  const cols = COLS[kind], data = state[kind];
  $(`#${kind}-table`).innerHTML = `<table><thead><tr>${cols.map((c) => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead><tbody>` +
    data.map((r, i) => `<tr>${cols.map((c) => `<td>${cellHtml(kind, c, r, i)}</td>`).join('')}<td><button class="x" data-del="${kind}:${i}" aria-label="Delete row">✕</button></td></tr>`).join('') +
    '</tbody></table>';
  $(`#${kind}-count`).textContent = `(${data.length})`;
}

const norm = (h) => String(h).toLowerCase().replace(/[^a-z]/g, '');
function mapRows(json, kind) {
  let out = json.map((r) => {
    const keys = Object.entries(r).map(([k, v]) => [norm(k), v]);
    const o = {};
    for (const [f] of COLS[kind]) { const hit = keys.find(([k]) => ALIAS[f].includes(k)); o[f] = hit ? String(hit[1]).trim() : ''; }
    if (kind === 'secs') { o.date = normDate(o.date) || o.date; o.start = normTime(o.start) || o.start; o.end = normTime(o.end) || o.end; }
    return o;
  }).filter((o) => Object.values(o).some(Boolean));
  if (kind === 'tas') { // a TA may span several rows (one exam per row)
    const m = new Map();
    out.forEach((o) => {
      const p = m.get(o.name);
      if (!p) m.set(o.name, o);
      else { p.faculty = [p.faculty, o.faculty].filter(Boolean).join(', '); p.conflicts = [p.conflicts, o.conflicts].filter(Boolean).join('; '); }
    });
    out = [...m.values()];
  }
  return out;
}

async function upload(kind, file) {
  if (!file) return;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
    const rows = mapRows(json, kind);
    if (!rows.length) { alert('No rows found. Check the column headers against the template.'); return; }
    state[kind] = rows; save(); renderData(kind);
  } catch (err) { alert(`Could not read that file: ${err.message}`); }
}

function template(kind) {
  const cols = COLS[kind], sample = (kind === 'tas' ? sampleTAs : sampleSections).slice(0, 3);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.map((c) => q(c[0])).join(','), ...sample.map((r) => cols.map((c) => q(r[c[0]])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${kind === 'tas' ? 'ta-roster' : 'exam-sections'}-template.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- schedule ---------- */
function renderSchedule() {
  const box = $('#schedule');
  const names = state.tas.map((t) => t.name.trim()).filter(Boolean);
  const keep = { d: $('#f-date').value, t: $('#f-ta').value };
  $('#f-ta').innerHTML = '<option value="">All TAs</option>' + names.map((n) => `<option${n === keep.t ? ' selected' : ''}>${esc(n)}</option>`).join('');

  if (!state.rows) {
    box.innerHTML = '<p class="muted">No schedule yet. Click <b>Generate schedule</b>.</p>';
    $('#stats').innerHTML = ''; $('#warnings').innerHTML = '';
    $('#f-date').innerHTML = '<option value="">All dates</option>';
    return;
  }
  const dates = [...new Set(state.rows.map((r) => r.sec.date))].sort();
  $('#f-date').innerHTML = '<option value="">All dates</option>' + dates.map((d) => `<option${d === keep.d ? ' selected' : ''}>${d}</option>`).join('');

  const issues = checkConflicts(state.rows, state.tas, state.buffer);
  const cell = (r, k) => {
    const sl = r.slots[k];
    if (!sl) return '<td></td>';
    const key = `${r.sec.id}:${k}`, bad = issues[key];
    const sel = `<select data-s="${key}" aria-label="Proctor ${k + 1}"><option value="">— unassigned —</option>${names.map((n) => `<option${n === sl.ta ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    const note = bad ? `⚠ ${bad}` : (sl.tag === 'swapped' || sl.tag === 'unresolved' ? sl.note : '');
    return `<td class="slot ${bad ? 'bad' : ''}">${sel}<div>${sl.tag ? `<span class="badge ${sl.tag}" title="${esc(sl.note)}">${LABEL[sl.tag]}</span>` : ''}${k === 1 ? '<span class="badge second" title="Second proctor: more than 50 students">2nd proctor</span>' : ''}</div>${note ? `<small>${esc(note)}</small>` : ''}</td>`;
  };
  const ctx = routineCtx(state.imp?.sched, state.cal);
  const line = (r) => `<tr><td>${r.sec.date}</td><td>${r.sec.start}–${r.sec.end}</td><td>${esc(r.sec.course)}</td><td>${esc(r.sec.section)}</td><td>${esc(r.sec.room)}</td><td>${r.sec.students}</td><td>${esc(r.sec.faculty)}</td>${cell(r, 0)}${cell(r, 1)}</tr>`;
  box.innerHTML = '<table><thead><tr><th>Date</th><th>Time</th><th>Course</th><th>Sec</th><th>Room</th><th>Students</th><th>Faculty</th><th>Proctor 1</th><th>Proctor 2</th></tr></thead><tbody>' +
    groupBySlot(state.rows, ctx).map((g) => `<tr class="gh"><td colspan="9"><b>${esc(g.title)}</b> <span>${g.time}</span> <small>${g.rows.length} section${g.rows.length > 1 ? 's' : ''}</small></td></tr>` + g.rows.map(line).join('')).join('') +
    '</tbody></table>';

  const all = state.rows.flatMap((r) => r.slots);
  const n = (t) => all.filter((s) => s.tag === t).length;
  const stat = (v, l) => `<span class="stat"><b>${v}</b>${l}</span>`;
  $('#stats').innerHTML = stat(state.rows.length, 'sections') + stat(all.length, 'proctor slots') + stat(n('attached'), 'faculty matches') + stat(n('swapped'), 'auto-swapped') +
    stat(n('balanced') + n('manual'), 'balanced / manual') + stat(Object.keys(issues).length, 'conflicts') + stat(all.filter((s) => !s.ta).length, 'unassigned');
  const warns = state.warnings || [];
  $('#warnings').innerHTML = warns.length ? `<div class="warn"><b>${warns.length} warning${warns.length > 1 ? 's' : ''}</b><ul>${warns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
}

function renderWorkload() {
  if (!state.rows) { $('#workload').innerHTML = '<p class="muted">Generate a schedule first.</p>'; $('#wl-summary').innerHTML = ''; return; }
  const w = workload(state.rows, state.tas);
  const counts = w.map((x) => x.count), max = Math.max(...counts, 1), min = Math.min(...counts);
  $('#wl-summary').innerHTML = `<span class="stat"><b>${Math.max(...counts)}</b>most sections</span><span class="stat"><b>${min}</b>fewest sections</span><span class="stat"><b>${Math.max(...counts) - min}</b>spread</span>`;
  $('#workload').innerHTML = '<table><thead><tr><th>ID</th><th>TA</th><th>Attached faculty</th><th>Sections</th><th>Hours</th><th class="bar-cell"></th></tr></thead><tbody>' +
    w.map((x) => `<tr><td>${esc(x.id)}</td><td>${esc(x.name)}</td><td>${esc(x.faculty)}</td><td>${x.count}</td><td>${x.hours}</td><td><div class="meter"><i style="width:${(x.count / max) * 100}%"></i></div></td></tr>`).join('') + '</tbody></table>';
}

function runGenerate() {
  state.buffer = Math.max(0, parseInt($('#buffer').value, 10) || 0);
  const res = generate(state.tas, state.secs, { buffer: state.buffer });
  state.rows = res.rows; state.warnings = res.warnings; save();
  renderSchedule(); renderWorkload();
}

/* ---------- PDF ---------- */
function masterPDF(doc) {
  const d = $('#f-date').value;
  const groups = groupBySlot(state.rows.filter((r) => !d || r.sec.date === d), routineCtx(state.imp?.sched, state.cal));
  if (!groups.length) { alert('No exams to export for this selection.'); return false; }
  doc.setFontSize(16); doc.text('Master Exam Roster', 40, 40);
  doc.setFontSize(10); doc.text(d ? `Date: ${d}` : 'All exam dates, in exam routine order', 40, 56);
  let y = 68;
  const span = (content, fill, extra = {}) => ({ content, colSpan: 7, styles: { fillColor: fill, textColor: 20, fontStyle: 'bold', fontSize: 10, ...extra } });
  for (const g of groups) { // one table per exam slot; a slot is kept on one page whenever it fits
    doc.autoTable({
      startY: y, pageBreak: 'avoid', styles: { fontSize: 9 }, margin: { left: 40, right: 40, bottom: 30 },
      head: [
        [span(`${g.title}     ${g.time}     (${g.rows.length} section${g.rows.length > 1 ? 's' : ''})`, [15, 118, 110], { textColor: 255 })],
        ['Course', 'Section', 'Room', 'Students', 'Faculty', 'Proctor 1', 'Proctor 2'].map((h) => ({ content: h, styles: { fillColor: [221, 238, 235], textColor: 20 } })),
      ],
      body: g.rows.map((r) => [r.sec.course, r.sec.section, r.sec.room, r.sec.students, r.sec.faculty, r.slots[0]?.ta || '—', r.slots[1] ? r.slots[1].ta || '—' : '']),
    });
    y = doc.lastAutoTable.finalY + 14;
  }
  return true;
}

function slipsPDF(doc) {
  const only = $('#f-ta').value;
  const names = only ? [only] : state.tas.map((t) => t.name.trim()).filter(Boolean);
  let first = true;
  for (const n of names) {
    const duty = orderRows(state.rows, routineCtx(state.imp?.sched, state.cal)).flatMap((r) => r.slots.map((s, k) => (s.ta === n ? { r, k } : null)).filter(Boolean));
    if (!duty.length) continue;
    if (!first) doc.addPage();
    first = false;
    const ta = state.tas.find((t) => t.name.trim() === n) || {};
    doc.setFontSize(16); doc.text('Proctoring Duty Slip', 40, 40);
    doc.setFontSize(11); doc.text(`${n}${ta.id ? `   (ID ${ta.id})` : ''}`, 40, 62); doc.text(`Attached faculty: ${ta.faculty || '—'}`, 40, 78);
    doc.autoTable({
      startY: 92, head: [['Date', 'Time', 'Course', 'Section', 'Room', 'Students', 'Faculty', 'Role']],
      body: duty.map(({ r, k }) => [r.sec.date, `${r.sec.start} – ${r.sec.end}`, r.sec.course, r.sec.section, r.sec.room, r.sec.students, r.sec.faculty, k ? '2nd proctor' : 'Proctor']),
      styles: { fontSize: 10 }, headStyles: { fillColor: [15, 118, 110] }, margin: { left: 40, right: 40 },
    });
    const mins = duty.reduce((a, { r }) => a + r.sec.e - r.sec.s, 0), y = doc.lastAutoTable.finalY + 24;
    doc.setFontSize(11); doc.text(`Total: ${duty.length} sections, ${Math.round(mins / 6) / 10} hours`, 40, y);
    doc.text('Signature: ______________________', 540, y);
  }
  if (first) alert('No duties to export for this selection.');
  return !first;
}

function exportPDF() {
  if (!state.rows) { alert('Generate a schedule first.'); return; }
  if (!window.jspdf) { alert('PDF library failed to load. Check your internet connection.'); return; }
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const master = $('#pdf-mode').value === 'master';
  if (master ? masterPDF(doc) : slipsPDF(doc)) doc.save(master ? 'master-exam-roster.pdf' : 'ta-duty-slips.pdf');
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tab) show(b.dataset.tab);
  if (b.dataset.del) { const [k, i] = b.dataset.del.split(':'); state[k].splice(+i, 1); save(); renderData(k); }
  if (b.dataset.add) { state[b.dataset.add].push({ ...BLANK[b.dataset.add] }); save(); renderData(b.dataset.add); }
  if (b.dataset.tpl) template(b.dataset.tpl);
  if (b.dataset.pick) picker.open(+b.dataset.pick);
  if (b.id === 'gen') runGenerate();
  if (b.id === 'pdf') exportPDF();
  if (b.id === 'sample') { state = { tas: clone(sampleTAs), secs: clone(sampleSections), rows: null, buffer: 0, warnings: [], imp: state.imp, cal: state.cal }; save(); init(); }
  if (b.id === 'clear' && confirm('Remove all TAs, sections and the generated schedule?')) { state = { tas: [], secs: [], rows: null, buffer: 0, warnings: [], imp: state.imp, cal: state.cal }; save(); init(); }
});

document.addEventListener('input', (e) => {
  const d = e.target.dataset;
  if (d.k) {
    state[d.k][+d.i][d.c] = e.target.value; save();
    if (d.k === 'tas' && d.c === 'conflicts') refreshPick(+d.i);
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.upload) { await upload(el.dataset.upload, el.files[0]); el.value = ''; }
  if (el.dataset.s) { // manual override
    const [id, k] = el.dataset.s.split(':').map(Number);
    const slot = state.rows.find((r) => r.sec.id === id).slots[k];
    slot.ta = el.value || null;
    slot.tag = el.value ? 'manual' : 'unresolved';
    slot.note = el.value ? 'Manually assigned' : 'Left unassigned';
    save(); renderSchedule(); renderWorkload();
  }
});

/** Updates one TA's text box and Pick button after the dialog (or typing) changed their exams. */
function refreshPick(i) {
  const inp = document.querySelector(`input[data-k="tas"][data-i="${i}"][data-c="conflicts"]`);
  if (!inp) return;
  const t = state.tas[i];
  if (inp.value !== t.conflicts) inp.value = t.conflicts;
  const btn = inp.parentElement.querySelector('.pick');
  if (btn) btn.innerHTML = pickLabel(countExams(t.conflicts));
}
const picker = initPicker({ get: () => state, save, onChange: refreshPick });

function handoff(secs) {
  state.secs = secs; state.rows = null; state.warnings = []; save();
  picker.autofill(true); // a fresh routine means fresh dates for the exam calendar
  renderData('secs'); renderSchedule(); renderWorkload();
  show('data');
  $('#notice').textContent = `${secs.length} sections were loaded from the import. Make sure the TA roster below is correct, then open Schedule and click Generate.`;
  $('#notice').hidden = false;
}
const importUI = initImport({ get: () => state, save, handoff });

function init() {
  state.imp ||= { sched: [], rules: [], courses: [], info: {} };
  $('#buffer').value = state.buffer || 0;
  renderData('tas'); renderData('secs'); renderSchedule(); renderWorkload(); importUI.render();
  picker.autofill(); picker.renderCal();
}
init();
