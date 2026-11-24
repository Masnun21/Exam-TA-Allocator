// Exam calendar (dates per semester) + the one-click "Pick exams" dialog for a TA's personal exams.
import { weekday } from './parsers.js';
import { normDate, normTime } from './scheduler.js';
import {
  DEFAULT_SETS, DEFAULT_CAL, migrateCal, parseSlot, parseSlotList, parseEntries, hasEntry, toggleEntry,
  addEntries, removeEntries, removeAt, calFromRoutine, chipLabel,
} from './examslots.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d) => { const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${weekday(d).slice(0, 3)} ${+m[3]} ${MON[+m[2] - 1]} ${m[1]}` : d; };

export function initPicker({ get, save, onChange }) {
  /* ----- state (kept inside the app's saved state, so it survives reloads) ----- */
  const ensure = () => {
    const s = get();
    s.cal ||= clone(DEFAULT_CAL);
    migrateCal(s.cal, s.calSets); // calendars saved by an older version
    return s;
  };
  const slotsOf = (row) => (row.slots || []).map(parseSlot).filter(Boolean);
  const days = () => ensure().cal.filter((r) => normDate(r.date)).sort((a, b) => a.date.localeCompare(b.date));
  /** "Day 1", "Day 2" … among the exam days that share a class-days code (only shown when a code has several days). */
  const tagOf = (r) => {
    const same = days().filter((x) => x.days === r.days);
    return `${r.days || 'Exam'}${same.length > 1 ? ` · Day ${same.indexOf(r) + 1}` : ''}`;
  };

  /* ----- exam calendar card ----- */
  function renderCal() {
    const s = ensure(), box = $('#cal-box');
    if (!box) return;
    box.innerHTML = '<div class="calhead"><span>Class days</span><span>Exam date</span><span></span><span>Time slots (24-hour, comma separated)</span><span></span></div>' +
      s.cal.map((r, i) => {
        const wd = weekday(r.date);
        return `<div class="calrow"><input class="cdays" data-cd="${i}" value="${esc(r.days)}" maxlength="6" placeholder="RA" aria-label="Class days code" autocomplete="off">` +
          `<input type="date" data-cal="${i}" value="${esc(r.date)}" aria-label="Exam date">` +
          `<span class="dayname ${wd ? '' : 'none'}">${wd || 'pick a date'}</span>` +
          `<input class="cslots" data-cs="${i}" value="${esc((r.slots || []).join(', '))}" aria-label="Time slots of this exam day" autocomplete="off">` +
          `<button class="x" data-cdel="${i}" aria-label="Remove this exam day">✕</button></div>`;
      }).join('') || '<p class="muted">No exam days yet. Import the exam routine, or add a day.</p>';
  }

  /** Rebuilds the calendar from the imported routine (any class-days codes). Returns how many exam days it found. */
  function autofill(force = false) {
    const s = ensure();
    if (!force && s.cal.some((r) => r.date)) return 0;
    const rows = calFromRoutine(s.imp?.sched || [], s.imp?.rules || []);
    if (rows.length) { s.cal = rows; save(); renderCal(); }
    return rows.length;
  }

  const calBox = $('#cal-box');
  calBox?.addEventListener('change', (e) => {
    const t = e.target, s = ensure();
    if (t.dataset.cal !== undefined) { s.cal[+t.dataset.cal].date = normDate(t.value) || ''; save(); renderCal(); }
    else if (t.dataset.cd !== undefined) { const v = t.value.toUpperCase().replace(/[^A-Z]/g, ''); t.value = v; s.cal[+t.dataset.cd].days = v; save(); }
    else if (t.dataset.cs !== undefined) {
      const list = parseSlotList(t.value);
      t.classList.toggle('invalid', !list);
      if (list) { s.cal[+t.dataset.cs].slots = list; t.value = list.join(', '); save(); }
    }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const s = ensure();
    if (b.dataset.act === 'cal-fill') {
      const n = autofill(true);
      $('#cal-msg').textContent = n ? `Read ${n} exam day(s), with their class days and time slots, from the imported routine.` : 'Nothing to read. Import the exam routine first (Import tab), or add the days here.';
    }
    if (b.dataset.act === 'cal-add') { s.cal.push({ days: '', date: '', slots: [...DEFAULT_SETS.A] }); save(); renderCal(); }
    if (b.dataset.act === 'cal-clear') { s.cal.forEach((r) => { r.date = ''; }); save(); renderCal(); $('#cal-msg').textContent = 'Dates cleared. Pick the new semester dates above.'; }
    if (b.dataset.cdel !== undefined) { s.cal.splice(+b.dataset.cdel, 1); save(); renderCal(); }
  });

  /* ----- pick dialog ----- */
  const dlg = document.createElement('dialog');
  dlg.className = 'picker'; dlg.setAttribute('aria-labelledby', 'pk-title');
  document.body.append(dlg);
  let idx = -1;
  const ta = () => get().tas[idx];

  function set(text) { ta().conflicts = text; save(); onChange(idx); render(); }

  function render() {
    const t = ta(); if (!t) return;
    const text = t.conflicts || '', list = parseEntries(text), cal = days();
    const undated = ensure().cal.filter((r) => !normDate(r.date)).length;
    const dayHtml = cal.map((r, di) => {
      const slots = slotsOf(r), picked = slots.filter((sl) => hasEntry(text, { date: r.date, ...sl })).length;
      return `<div class="pday"><div class="pdh"><b>${shortDate(r.date)}</b><span class="ptag">${esc(tagOf(r))}</span><span class="grow"></span>` +
        `<button type="button" class="mini" data-pk="all:${di}">${picked === slots.length ? 'Unselect all' : 'Select all'}</button></div>` +
        `<div class="chips">${slots.map((sl, si) => `<button type="button" class="chip" aria-pressed="${hasEntry(text, { date: r.date, ...sl })}" data-pk="slot:${di}:${si}">${chipLabel(sl)}</button>`).join('')}</div></div>`;
    }).join('');
    const selHtml = list.length
      ? list.map((e, i) => e.raw
        ? `<span class="sel bad" title="Could not be read. Remove or fix it in the text box.">${esc(e.raw)}<button type="button" data-pk="rm:${i}" aria-label="Remove ${esc(e.raw)}">✕</button></span>`
        : `<span class="sel"><b>${shortDate(e.date)}</b> ${chipLabel(e)}<button type="button" data-pk="rm:${i}" aria-label="Remove exam ${esc(e.date)} ${e.start}">✕</button></span>`).join('')
      : '<span class="muted">No personal exams yet. Tap the time slots above. You can choose several, also on the same day.</span>';

    dlg.innerHTML = `<div class="pk-head"><h2 id="pk-title">Personal exams <small>${esc(t.name || 'TA')}</small></h2><span class="grow"></span><button type="button" class="ghost" data-pk="close" aria-label="Close">✕</button></div>` +
      '<div class="pk-body">' +
      (cal.length ? `<p class="muted">Tap a time slot to add or remove that exam. Every exam you tap is saved straight away.</p>${dayHtml}` : '<p class="notice">No exam dates are set yet. Close this window and fill in the <b>Exam calendar</b> above the TA table (or import the exam routine), then come back.</p>') +
      (cal.length && undated ? `<p class="muted">${undated} exam day(s) have no date yet and are hidden. Set them in the Exam calendar.</p>` : '') +
      '<h3>Custom exam <small>for anything outside the standard slots</small></h3>' +
      '<div class="custom"><label>Date <input type="date" id="pk-date"></label><label>From <input type="time" id="pk-from"></label><label>To <input type="time" id="pk-to"></label><button type="button" data-pk="custom">Add exam</button></div>' +
      '<div id="pk-err" class="pk-err" role="alert"></div>' +
      `<h3>Selected <small>${list.length} exam${list.length === 1 ? '' : 's'}</small></h3><div class="sels">${selHtml}</div></div>` +
      '<div class="pk-foot"><button type="button" class="ghost" data-pk="clear">Clear all</button><span class="grow"></span><button type="button" class="primary" data-pk="close">Done</button></div>';
  }

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) return dlg.close(); // click on the backdrop
    const b = e.target.closest('[data-pk]'); if (!b) return;
    const [act, a, c] = b.dataset.pk.split(':'), cal = days();
    if (act === 'close') return dlg.close();
    if (act === 'slot') { const r = cal[+a]; return set(toggleEntry(ta().conflicts, { date: r.date, ...slotsOf(r)[+c] })); }
    if (act === 'all') {
      const r = cal[+a], es = slotsOf(r).map((sl) => ({ date: r.date, ...sl }));
      return set(es.every((x) => hasEntry(ta().conflicts, x)) ? removeEntries(ta().conflicts, es) : addEntries(ta().conflicts, es));
    }
    if (act === 'rm') return set(removeAt(ta().conflicts, +a));
    if (act === 'clear') { if (!parseEntries(ta().conflicts).length || confirm(`Remove all personal exams of ${ta().name || 'this TA'}?`)) set(''); return; }
    if (act === 'custom') {
      const date = normDate($('#pk-date').value), start = normTime($('#pk-from').value), end = normTime($('#pk-to').value), err = $('#pk-err');
      if (!date || !start || !end) { err.textContent = 'Fill in the date, the start time and the end time.'; return; }
      if (start >= end) { err.textContent = 'The end time must be after the start time.'; return; }
      set(addEntries(ta().conflicts, [{ date, start, end }]));
    }
  });

  return {
    renderCal, autofill,
    open(i) { idx = i; render(); dlg.showModal(); dlg.querySelector('.chip, [data-pk="close"]')?.focus(); },
  };
}

export const countExams = (text) => parseEntries(text).length;
