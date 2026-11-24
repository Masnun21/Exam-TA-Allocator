# TA Final Exam Proctoring Scheduler

Automatically assigns Teaching Assistants to final exam sections, balances the workload, swaps around personal exam clashes, and exports a PDF roster. It is a static site: no server, no build step, and your data never leaves the browser.

## Go live on GitHub Pages

1. Create a GitHub repo and push these files to the `main` branch.
2. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push again (or run the workflow from the Actions tab). The site appears at `https://<your-username>.github.io/<repo-name>/`.

The workflow in `.github/workflows/pages.yml` runs the tests first and only deploys if they pass.

## Run locally

```bash
npm start        # serves on http://localhost:8080 (needs python3)
npm test         # runs the algorithm tests (Node 18+)
```

## Import tab (new): no more hand-made Excel files

Each semester, open **1. Import** and upload two files:

1. **Final exam schedule** (PDF, PNG or JPG). Text PDFs are read directly; images and scanned PDFs use OCR (Tesseract.js, downloaded on first use). If the first OCR pass finds nothing, the image is cleaned (table borders removed) and read again with other settings. "Show what was read from the file" displays the raw OCR text. The routine is read from the table layout: class days, final exam date and exam slots. A "Last Day of Class" column is ignored automatically (the latest date in a row is the exam date).
2. **Course list PDF** (Sl no., Course, Section, Faculty Initial, Class Time, Class Room, Students Number). `26 (37)` becomes 26 students; class times such as `ST 09:40AM-11:10 AM` or `RA 01:00 PM 02:30 PM` are normalised.

Then:

- **Verify the routine** in the editor. It has one block per exam day: **class days** (for example `ST`), the **exam date** (the weekday fills in by itself) and as many **time slots** as sit that day. Add slots one by one, or use the two preset buttons. Times can be typed loosely (`8.00-9.30 AM`, `2.40-4.10 PM`, `14:40-16:10`) and are tidied up when you leave the field.
- **Why a class time?** The course list gives each section's class days and class time; the routine says which date those classes sit their final. The app joins the two on *class days + class time*. The exam time is the same as the class time unless you fill in the second box (or a time-shift rule applies).
- **Time-shift rules** (`06:00 PM - 07:30 PM → 05:00 PM - 06:30 PM`) are detected from an asterisk and its footnote, and can be added or edited in the UI. They apply automatically to every slot whose exam time is left empty.
- **Preview** every course with its mapped final date and time. Unmatched courses are red, with a list of the missing class slots.
- **Send to allocator** loads the mapped sections into the Data tab. Or download them as CSV / Excel for backup (the file can be re-uploaded in the Data tab).

Nothing is hardcoded to a semester. OCR output can contain mistakes, so always glance at the routine table before sending.

## Input formats

**TA roster** (`ta-roster-template.csv`)

| id | name | faculty | conflicts |
|---|---|---|---|
| TA01 | Anika Rahman | ABC, XYZ | 2026-12-14 \| 09:00-11:00; 2026-12-16 \| 15:00-17:00 |

**Exam sections** (`exam-sections-template.csv`): `course, section, faculty, date, start, end, room, students`

Dates are `YYYY-MM-DD` or `DD/MM/YYYY`; times are 24-hour or `9:00 AM`. A TA can also be split over several rows (one exam per row); they are merged by name.

## How scheduling works

1. **Capacity:** more than 50 students needs 2 proctors, otherwise 1.
2. **Faculty match:** each section is offered first to TAs whose attached initials match the section's faculty, lowest workload first (up to a fair share).
3. **Swaps:** if every attached TA has a personal exam clash, the slot goes to the free TA with the lowest workload. The badge tooltip names the original TA and the conflict time.
4. **Open slots:** the rest, including second proctors, are filled most-constrained-first by lowest workload.
5. **Balancing:** duties move from the busiest TA to the least busy one until the spread is at most 1 (when conflicts allow).
6. **Validation:** warns about faculty initials missing from the master list, time slots needing more proctors than free TAs, and unreadable rows. Manual overrides are re-checked live for personal-exam clashes and double-booking.

The optional "gap between exams" setting treats exams closer than N minutes as clashing (for travel between rooms).

## PDF export

- **Master exam roster:** grouped by date and time slot, optionally filtered to one date.
- **Individual TA duty slips:** one page per TA (or pick one TA), with totals and a signature line.

## Files

```
index.html            UI
css/style.css         styles
js/scheduler.js       algorithm (pure functions, tested)
js/app.js             UI, CSV/Excel import, PDF export
js/import.js          Import tab: routine + course list upload, preview, hand-off
js/parsers.js         PDF/OCR parsing, loose time parsing and course-to-exam matching (tested)
js/imgprep.js         image clean-up for OCR (thresholding, table-line removal)
js/sample.js          14 TAs, 56 sections
test/                 Node tests
```

Libraries (pdf.js, SheetJS, jsPDF, jsPDF-AutoTable) load from cdnjs, and Tesseract.js from jsDelivr when OCR is needed, so the page needs internet on first load.

## Everything follows the imported exam routine

Nothing is tied to particular class-day codes (RA, ST, MW, …). After you import the routine and press **Send to allocator**:

- **Final schedule and master PDF** are ordered the way the routine runs: by exam date, then (if two codes share a date) in routine order, then by time slot. Each slot has a heading such as `RA · Thursday, 24 Dec 2026   08:00 AM - 09:30 AM` with all its courses under it. If your routine puts ST before RA, or adds a new code, the schedule follows. Duty slips list each TA's duties in the same order.
- **Exam calendar** (Data tab) is rebuilt from the routine: one row per class-days code and date, holding that day's real exam slots (time-shift rules such as 6:00 PM → 5:00 PM included). You can edit the code, date and slots, add or remove days, or press *Read days and times from imported routine* again after changing the routine. Without a routine, the calendar starts with ST/RA/MW rows and the standard slots as a convenience.

## Entering TA personal exams quickly

1. Open **Pick** in a TA's row. It shows one-tap time-slot chips for every day in the exam calendar. Several exams on the same day are fine, *Select all* takes a whole day, and *Custom exam* handles anything outside the slots.
2. The text box still works. Anything typed there shows up as selected in the dialog, and the dialog writes the same `date | start-end; …` format the scheduler reads.
