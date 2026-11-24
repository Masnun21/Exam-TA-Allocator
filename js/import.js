// Import tab: upload the exam routine + course list, verify the mapping, hand off to the allocator.
// Import tab: upload the exam routine + course list, verify the mapping, hand off to the allocator.
import { itemsFromPdf, itemsToLines, mergeRuns, parseSchedule, parseCourseLines, matchCourses, applyRules, effectiveExam, toSections, fmtRange, normRange, STANDARD_SLOTS, fmtDate, weekday } from './parsers.js';
import { cleanForOcr, toGray } from './imgprep.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const loaded = {};
const loadScript = (src) => (loaded[src] ||= new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Could not load the OCR engine. Check your internet connection.'));
  document.head.appendChild(s);
}));
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/* ---------- OCR ---------- */
// Tesseract.js versions differ in where they put words: data.words, data.blocks[].paragraphs[].lines[].words, or only TSV text.
function wordsOf(data) {
  if (data.words?.length) return data.words;
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push(w);
  if (out.length) return out;
  return String(data.tsv || '').split('\n').map((l) => l.split('\t')).filter((c) => c.length >= 12 && c[0] === '5' && c[11].trim())
    .map((c) => ({ text: c.slice(11).join('\t'), bbox: { x0: +c[6], y0: +c[7], x1: +c[6] + +c[8], y1: +c[7] + +c[9] } }));
}

async function toCanvas(src) { // File/Blob or canvas -> canvas of a size Tesseract likes (about 2000 px wide)
  let w, h, draw;
  if (src instanceof HTMLCanvasElement) { w = src.width; h = src.height; draw = (ctx, W, H) => ctx.drawImage(src, 0, 0, W, H); }
  else { const bmp = await createImageBitmap(src); w = bmp.width; h = bmp.height; draw = (ctx, W, H) => ctx.drawImage(bmp, 0, 0, W, H); }
  const k = w < 2000 ? Math.min(3, 2000 / w) : w > 2800 ? 2800 / w : 1;
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  draw(ctx, c.width, c.height);
  return c;
}
async function cleanCanvas(src) { // black-on-white, uneven lighting evened out, table borders erased
  const c = await toCanvas(src), { width: w, height: h } = c, ctx = c.getContext('2d');
  const bin = cleanForOcr(toGray(ctx.getImageData(0, 0, w, h).data, w, h), w, h);
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const oc = out.getContext('2d'), img = oc.createImageData(w, h);
  for (let i = 0, j = 0; i < bin.length; i++, j += 4) { img.data[j] = img.data[j + 1] = img.data[j + 2] = bin[i]; img.data[j + 3] = 255; }
  oc.putImageData(img, 0, 0);
  return out;
}

/**
 * Reads text boxes from images, trying several settings until `judge(items)` is happy:
 * the image as it is, then a cleaned copy (borders removed) in three page-segmentation modes.
 */
async function ocr(sources, judge, say) {
  await loadScript(TESS);
  const worker = await window.Tesseract.createWorker('eng', 1);
  const attempts = [['orig', '3'], ['clean', '6'], ['clean', '3'], ['clean', '11']];
  let best = null, cleaned = null;
  try {
    for (const [k, [kind, psm]] of attempts.entries()) {
      say(`Reading text from the image… (pass ${k + 1} of ${attempts.length})`);
      if (kind === 'clean' && !cleaned) cleaned = await Promise.all(sources.map(cleanCanvas));
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const items = [];
      for (const [i, src] of (kind === 'clean' ? cleaned : sources).entries()) {
        const { data } = await worker.recognize(src, {}, { blocks: true, text: true, tsv: true });
        for (const w of wordsOf(data)) if (w.text && w.text.trim()) items.push({ str: w.text, x: w.bbox.x0, w: w.bbox.x1 - w.bbox.x0, y: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0, page: i + 1 });
      }
      const v = judge(items);
      if (!best || v.score > best.score) best = { items, score: v.score, pass: k + 1 };
      if (v.ok) break;
    }
  } finally { await worker.terminate(); }
  return best;
}

async function readItems(file, judge, say) {
  if (!isPdf(file)) { say('Running OCR on the image (the first run downloads the OCR engine)…'); const r = await ocr([file], judge, say); return { items: r.items, source: `OCR from image, pass ${r.pass}` }; }
  if (!window.pdfjsLib) throw new Error('The PDF library failed to load. Check your internet connection.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER;
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const items = await itemsFromPdf(pdf);
  if (items.map((i) => i.str).join('').replace(/\s/g, '').length >= 30) return { items, source: 'PDF text' };
  say('No text layer found, running OCR on the scanned PDF…');
  const canvases = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p), vp = page.getViewport({ scale: 2.5 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    canvases.push(c);
  }
  const r = await ocr(canvases, judge, say);
  return { items: r.items, source: `OCR from scanned PDF, pass ${r.pass}` };
}

const judgeSched = (items) => { const r = parseSchedule(mergeRuns(items)); return { ok: r.rows.length > 0 && !r.warnings.length, score: r.rows.length - 3 * r.warnings.length }; };
const judgeCourses = (items) => { const r = parseCourseLines(itemsToLines(items)); return { ok: r.courses.length > 0 && !r.warnings.length, score: r.courses.length - 3 * r.warnings.length }; };

let gidSeq = 0;
const newGid = () => `g${Date.now().toString(36)}${(gidSeq++).toString(36)}`;
const EVENING = STANDARD_SLOTS[6];

export function initImport({ get, save, handoff }) {
  const imp = () => {
    const d = (get().imp ||= { sched: [], rules: [], courses: [], info: {} });
    const keys = new Map(); // rows saved by an older version (or parsed from a file) get a group id: same class days + date = one exam day
    for (const r of d.sched) if (!r.gid) { const k = `${r.days}|${r.date}`; if (!keys.has(k)) keys.set(k, newGid()); r.gid = keys.get(k); }
    return d;
  };
  const mapped = () => matchCourses(imp().courses, imp().sched, imp().rules);
  const groups = () => { const m = new Map(); imp().sched.forEach((r, i) => { if (!m.has(r.gid)) m.set(r.gid, []); m.get(r.gid).push(i); }); return m; };

  /* ----- upload ----- */
  async function handleFile(kind, file) {
    const say = (t) => { $(`#${kind}-status`).innerHTML = `<p class="muted">${esc(t)}</p>`; };
    try {
      say('Reading file…');
      const { items, source } = await readItems(file, kind === 'sched' ? judgeSched : judgeCourses, say);
      const d = imp();
      if (kind === 'sched') {
        const r = parseSchedule(mergeRuns(items));
        d.sched = r.rows; d.rules = r.rules; imp();
        d.info.sched = { name: file.name, source, warnings: r.warnings, note: `${r.rows.length} exam slots, ${r.rules.length} time-shift rule(s) found`, text: itemsToLines(items).join('\n').slice(0, 6000) };
        if (!r.rows.length) addDay(false);
      } else {
        const r = parseCourseLines(itemsToLines(items));
        d.courses = r.courses;
        d.info.courses = { name: file.name, source, warnings: r.warnings, note: `${r.courses.length} course sections found`, text: itemsToLines(items).join('\n').slice(0, 6000) };
      }
      save(); render();
    } catch (err) { $(`#${kind}-status`).innerHTML = `<div class="warn">${esc(err.message || err)}</div>`; }
  }

  /* ----- rendering ----- */
  function renderStatus(kind) {
    const i = imp().info[kind];
    const seen = i && (i.text ? `<details class="ocr"><summary>Show what was read from the file</summary><pre>${esc(i.text)}</pre></details>` : '');
    $(`#${kind}-status`).innerHTML = i ? `<p class="ok">✓ ${esc(i.name)}: ${esc(i.note)} <span class="muted">(${esc(i.source)})</span></p>` +
      (i.warnings.length ? `<div class="warn"><ul>${i.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '') + seen : '';
  }

  function slotRow(r, i) {
    const eff = effectiveExam(r, imp().rules), reg = r.regular && normRange(r.regular), shifted = eff && reg && fmtRange(eff) !== reg;
    const ph = eff ? `${fmtRange(eff)}${shifted ? ' (shift rule)' : ' (same)'}` : 'same as class time';
    const badReg = r.regular && !normRange(r.regular), badEx = r.exam && !normRange(r.exam);
    return `<tr data-row="${i}"><td><input data-imp="sched:${i}:regular" list="dl-slots" value="${esc(r.regular)}" class="${badReg ? 'invalid' : ''}" placeholder="e.g. 08:00 AM - 09:30 AM" aria-label="Class time" autocomplete="off"></td>` +
      `<td><input data-imp="sched:${i}:exam" list="dl-slots" value="${esc(r.exam)}" class="${badEx ? 'invalid' : ''}" placeholder="${esc(ph)}" aria-label="Exam time (leave empty if the same)" autocomplete="off"></td>` +
      `<td><button class="x" data-act="del-slot" data-i="${i}" aria-label="Remove time slot" title="Remove this time slot">✕</button></td></tr>`;
  }

  function renderSched() {
    const d = imp(), g = groups();
    const days = [...new Set(['ST', 'RA', 'MW', ...d.sched.map((r) => r.days).filter(Boolean)])];
    $('#dl-days').innerHTML = days.map((x) => `<option value="${esc(x)}">`).join('');
    $('#dl-slots').innerHTML = STANDARD_SLOTS.map((x) => `<option value="${esc(x)}">`).join('');
    $('#sched-table').innerHTML = g.size ? [...g].map(([gid, idx]) => {
      const f = d.sched[idx[0]], wd = weekday(f.date);
      return `<div class="egroup" data-g="${gid}"><div class="ghead">` +
        `<label>Class days <input data-gf="days" data-g="${gid}" list="dl-days" value="${esc(f.days)}" size="5" maxlength="6" class="${f.days ? '' : 'invalid'}" placeholder="ST" autocomplete="off"></label>` +
        `<label>Exam date <input type="date" data-gf="date" data-g="${gid}" value="${esc(f.date)}" class="${f.date ? '' : 'invalid'}"></label>` +
        `<span class="dayname ${wd ? '' : 'none'}" data-dayname="${gid}">${wd || 'Day appears here'}</span><span class="grow"></span>` +
        `<button class="x" data-act="del-day" data-g="${gid}" title="Remove this exam day and all its time slots">Remove day ✕</button></div>` +
        `<table class="slots"><thead><tr><th>Class time <small>(of the courses sitting this exam)</small></th><th>Exam time <small>(leave empty if the same)</small></th><th></th></tr></thead><tbody>` +
        idx.map((i) => slotRow(d.sched[i], i)).join('') + '</tbody></table>' +
        `<div class="bar"><button data-act="add-slot" data-g="${gid}">+ Add time slot</button>` +
        `<button data-act="preset" data-g="${gid}" data-p="a" title="08:00, 11:20, 02:40 and 06:00 PM class slots">+ 8:00 · 11:20 · 2:40 · 6:00</button>` +
        `<button data-act="preset" data-g="${gid}" data-p="b" title="09:40, 01:00 and 04:20 PM class slots">+ 9:40 · 1:00 · 4:20</button></div></div>`;
    }).join('') : '<p class="muted">Upload the routine above, or click <b>Add exam day</b> to enter it by hand.</p>';
  }

  function renderRules() {
    const d = imp();
    $('#rules-table').innerHTML = d.rules.length ? '<table><thead><tr><th>Regular class slot</th><th></th><th>Final exam slot</th><th></th></tr></thead><tbody>' +
      d.rules.map((r, i) => `<tr><td><input data-imp="rules:${i}:regular" value="${esc(r.regular)}" aria-label="Regular slot"></td><td>→</td>` +
        `<td><input data-imp="rules:${i}:exam" value="${esc(r.exam)}" aria-label="Exam slot"></td>` +
        `<td><button class="x" data-act="del-rule" data-i="${i}" aria-label="Delete rule">✕</button></td></tr>`).join('') + '</tbody></table>'
      : '<p class="muted">No time-shift rules. Add one if a class slot sits its exam at a different time (for example 06:00 PM classes sitting at 05:00 PM).</p>';
  }

  function renderPreview() {
    const all = mapped(), q = ($('#imp-q').value || '').toLowerCase().trim();
    const bad = all.filter((m) => !m.match), stat = (v, l) => `<span class="stat"><b>${v}</b>${l}</span>`;
    $('#imp-stats').innerHTML = stat(all.length, 'courses') + stat(all.length - bad.length, 'mapped') + stat(bad.length, 'unmatched') + stat(all.filter((m) => m.students > 50).length, 'need 2 proctors');
    const groupsBad = {};
    bad.forEach((m) => { const k = `${m.days} ${m.classTime.slice(m.days.length + 1)}`; groupsBad[k] = (groupsBad[k] || 0) + 1; });
    $('#imp-unmatched').innerHTML = bad.length ? `<div class="warn"><b>${bad.length} course(s) have no exam slot.</b> These class times are not in the routine yet: ${Object.entries(groupsBad).map(([k, n]) => `${esc(k)} (×${n})`).join(', ')}. Add each one under the matching exam day in Step 1 (same class days, same class time).</div>` : '';
    const view = all.filter((m) => !q || [m.course, m.section, m.faculty, m.room, m.classTime, m.match && fmtDate(m.match.date)].join(' ').toLowerCase().includes(q));
    $('#imp-table').innerHTML = all.length ? '<table><thead><tr><th>Course</th><th>Sec</th><th>Faculty</th><th>Students</th><th>Room</th><th>Class slot</th><th>Final date</th><th>Final time</th></tr></thead><tbody>' +
      view.slice(0, 1500).map((m) => `<tr class="${m.match ? '' : 'bad'}"><td>${esc(m.course)}</td><td>${esc(m.section)}</td><td>${esc(m.faculty)}</td><td>${m.students}</td><td>${esc(m.room)}</td><td>${esc(m.classTime)}</td>` +
        (m.match ? `<td>${fmtDate(m.match.date)}</td><td>${fmtRange(m.match)}</td>` : '<td colspan="2">No matching exam slot</td>') + '</tr>').join('') + '</tbody></table>'
      : '<p class="muted">Upload the course list to see the mapping.</p>';
  }

  function render() { renderStatus('sched'); renderStatus('courses'); renderSched(); renderRules(); renderPreview(); }

  /* ----- editing helpers ----- */
  function addDay(focus) {
    const d = imp(), last = d.sched[d.sched.length - 1];
    d.sched.push({ gid: newGid(), days: last?.days || '', date: '', regular: '', exam: '' });
    save(); renderSched(); renderPreview();
    if (focus) { const g = $('#sched-table').querySelector('.egroup:last-child [data-gf="date"]'); g?.scrollIntoView({ block: 'nearest' }); g?.focus(); }
  }
  function addSlots(gid, slots) {
    const d = imp(), idx = groups().get(gid) || [], f = d.sched[idx[0]];
    const have = new Set(idx.map((i) => normRange(d.sched[i].regular)));
    const blank = idx.filter((i) => !d.sched[i].regular && !d.sched[i].exam);
    let insertAt = idx[idx.length - 1] + 1, firstNew = -1;
    for (const t of slots) {
      if (t && have.has(t)) continue;
      have.add(t);
      if (blank.length) { d.sched[blank.shift()].regular = t; continue; } // reuse the empty row
      d.sched.splice(insertAt, 0, { gid, days: f.days, date: f.date, regular: t, exam: '' });
      if (firstNew < 0) firstNew = insertAt;
      insertAt++;
    }
    save(); renderSched(); renderPreview();
    const target = firstNew >= 0 ? firstNew : (groups().get(gid) || []).find((i) => !d.sched[i].regular);
    if (target != null) $(`#sched-table [data-imp="sched:${target}:regular"]`)?.focus();
  }

  /* ----- export ----- */
  const exportRows = () => mapped().map((m) => ({
    course: m.course, section: m.section, faculty: m.faculty, date: m.match?.date || '', start: m.match?.start || '', end: m.match?.end || '',
    room: m.room, students: m.students, class_time: m.classTime, status: m.match ? 'mapped' : 'unmatched',
  }));
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
  function exportCSV() {
    const rows = exportRows(); if (!rows.length) return;
    const cols = Object.keys(rows[0]), q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    download(new Blob(['\ufeff' + [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n')], { type: 'text/csv' }), 'mapped-exam-sections.csv');
  }
  function exportXLSX() {
    const rows = exportRows(); if (!rows.length) return;
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(rows), 'Mapped sections');
    window.XLSX.writeFile(wb, 'mapped-exam-sections.xlsx');
  }

  /* ----- events ----- */
  const root = $('#tab-import');
  // Typing updates the data live (no re-render, so focus is never lost); the row is tidied on "change" (blur / pick).
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'imp-q') return renderPreview();
    const d = imp();
    if (t.dataset.gf) { // exam-day fields apply to every time slot of that day
      const v = t.dataset.gf === 'days' ? t.value.toUpperCase().replace(/[^A-Z]/g, '') : t.value;
      d.sched.forEach((r) => { if (r.gid === t.dataset.g) r[t.dataset.gf] = v; });
      if (t.dataset.gf === 'date') {
        const name = root.querySelector(`[data-dayname="${t.dataset.g}"]`), wd = weekday(v);
        if (name) { name.textContent = wd || 'Day appears here'; name.classList.toggle('none', !wd); }
      }
      t.classList.toggle('invalid', !v); save(); return renderPreview();
    }
    const spec = t.dataset.imp; if (!spec) return;
    const [list, i, field] = spec.split(':');
    d[list][+i][field] = t.value; save();
    if (list === 'sched') renderPreview();
  });
  root.addEventListener('change', (e) => {
    const t = e.target, spec = t.dataset.imp; if (!spec) { if (t.dataset.gf === 'days') t.value = t.value.toUpperCase().replace(/[^A-Z]/g, ''); return; }
    const d = imp(), [list, i, field] = spec.split(':'), row = d[list][+i];
    const n = normRange(t.value);
    if (n) { row[field] = n; t.value = n; } // "8.00-9.30 AM" -> "08:00 AM - 09:30 AM"
    t.classList.toggle('invalid', !!t.value.trim() && !n);
    save();
    if (list === 'sched') { // refresh the "exam time" hint of this row without rebuilding (keeps Tab navigation working)
      const ex = t.closest('tr').querySelector('[data-imp$=":exam"]'), eff = effectiveExam(row, d.rules);
      if (ex) ex.placeholder = eff ? `${fmtRange(eff)}${normRange(row.regular) && fmtRange(eff) !== normRange(row.regular) ? ' (shift rule)' : ' (same)'}` : 'same as class time';
      renderPreview();
    }
  });
  root.addEventListener('click', (e) => {
    const drop = e.target.closest('.drop'); if (drop) return drop.querySelector('input').click();
    const b = e.target.closest('button'); if (!b) return;
    const d = imp(), i = +b.dataset.i, gid = b.dataset.g;
    switch (b.dataset.act) {
      case 'add-day': addDay(true); break;
      case 'del-day': d.sched = d.sched.filter((r) => r.gid !== gid); save(); renderSched(); renderPreview(); break;
      case 'add-slot': addSlots(gid, ['']); break;
      case 'preset': addSlots(gid, b.dataset.p === 'a' ? [STANDARD_SLOTS[0], STANDARD_SLOTS[2], STANDARD_SLOTS[4], EVENING] : [STANDARD_SLOTS[1], STANDARD_SLOTS[3], STANDARD_SLOTS[5]]); break;
      case 'del-slot': {
        const mates = groups().get(d.sched[i].gid) || [];
        if (mates.length === 1) { d.sched[i].regular = ''; d.sched[i].exam = ''; } else d.sched.splice(i, 1); // an exam day always keeps one slot row
        save(); renderSched(); renderPreview(); break;
      }
      case 'add-rule': d.rules.push({ regular: '', exam: '' }); save(); renderRules(); break;
      case 'del-rule': d.rules.splice(i, 1); save(); renderRules(); renderSched(); renderPreview(); break;
      case 'apply-rules': {
        const n = applyRules(d.sched, d.rules); save(); renderSched(); renderPreview();
        $('#rules-msg').textContent = n ? `Wrote the shifted exam time into ${n} time slot(s).` : 'No time slot has a matching regular class time. Check the rule, or type the exam time in the slot directly.';
        break;
      }
      case 'clear-sched': d.sched = []; d.rules = []; delete d.info.sched; save(); render(); break;
      case 'clear-courses': d.courses = []; delete d.info.courses; save(); render(); break;
      case 'csv': exportCSV(); break;
      case 'xlsx': exportXLSX(); break;
      case 'handoff': {
        const all = mapped(), ok = toSections(all), bad = all.length - ok.length;
        if (!ok.length) { alert('Nothing is mapped yet. Upload both files and fix any unmatched rows first.'); break; }
        if (bad && !confirm(`${bad} unmatched course(s) will be left out. Continue with ${ok.length} mapped sections?`)) break;
        handoff(ok); break;
      }
    }
  });
  root.querySelectorAll('.drop').forEach((zone) => {
    const kind = zone.dataset.drop, input = zone.querySelector('input');
    input.addEventListener('change', () => { if (input.files[0]) handleFile(kind, input.files[0]); input.value = ''; });
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files[0]) handleFile(kind, e.dataTransfer.files[0]); });
  });
  return { render };
}
