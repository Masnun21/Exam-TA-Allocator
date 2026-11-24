// Sample data: 14 TAs (with overlapping personal exams) and 56 sections across 6 faculty initials.
const DATES = ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17'];
const SLOTS = [['09:00', '11:00'], ['12:00', '14:00'], ['15:00', '17:00']];
const FAC = ['ABC', 'XYZ', 'MRH', 'SKD', 'TNA', 'RJB'];
const COURSES = ['CSE115', 'CSE173', 'CSE225', 'MAT116', 'PHY107', 'ENG102', 'CSE311', 'CSE445'];

export const sampleSections = Array.from({ length: 56 }, (_, i) => ({
  course: COURSES[i % 8], section: String(1 + Math.floor(i / 8)), faculty: FAC[i % 6],
  date: DATES[i % 4], start: SLOTS[Math.floor(i / 4) % 3][0], end: SLOTS[Math.floor(i / 4) % 3][1],
  room: `NAC${301 + (i % 14)}`, students: String(26 + ((i * 11) % 40)),
}));

const T = (id, name, faculty, conflicts = '') => ({ id, name, faculty, conflicts });
export const sampleTAs = [
  T('TA01', 'Anika Rahman', 'ABC', '2026-12-14 | 09:00-11:00; 2026-12-16 | 15:00-17:00'),
  T('TA02', 'Tanvir Hasan', 'ABC, XYZ', '2026-12-15 | 12:00-14:00'),
  T('TA03', 'Mehnaz Chowdhury', 'XYZ', '2026-12-14 | 12:00-14:00; 2026-12-17 | 09:00-11:00'),
  T('TA04', 'Sabbir Ahmed', 'MRH', '2026-12-16 | 09:00-11:00'),
  T('TA05', 'Nusrat Jahan', 'MRH, SKD', '2026-12-14 | 15:00-17:00; 2026-12-15 | 09:00-11:00'),
  T('TA06', 'Imran Khan', 'SKD', '2026-12-17 | 12:00-14:00'),
  T('TA07', 'Farhana Islam', 'TNA', '2026-12-14 | 09:00-11:00; 2026-12-15 | 15:00-17:00'),
  T('TA08', 'Rafiul Karim', 'TNA, RJB', ''),
  T('TA09', 'Sadia Afrin', 'RJB', '2026-12-16 | 12:00-14:00'),
  T('TA10', 'Zubayer Alam', 'ABC', '2026-12-17 | 15:00-17:00'),
  T('TA11', 'Maliha Sultana', 'XYZ, MRH', '2026-12-14 | 09:00-11:00; 2026-12-16 | 09:00-11:00'),
  T('TA12', 'Shakil Mahmud', 'SKD', '2026-12-15 | 12:00-14:00'),
  T('TA13', 'Tasnim Akter', 'TNA', '2026-12-17 | 09:00-11:00'),
  T('TA14', 'Arif Hossain', 'RJB', '2026-12-14 | 12:00-14:00; 2026-12-16 | 15:00-17:00'),
];
