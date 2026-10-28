// Vaktbok – tilfeldige eksempeldata. Ren funksjon: tilfeldighet og id-er sendes inn, så den kan testes.
import { isoDate, parseShift, mondayOf, HOUR } from './logic.js';

const NAMES = ['Bemanningsbyrå', 'Vikarbyrå', 'Sykehjem', 'Bofellesskap', 'Hjemmetjenesten', 'Kafé',
  'Restaurant', 'Butikk', 'Lager', 'Hotell', 'Kino', 'Treningssenter'];
const COLORS = ['#1F6F6B', '#B3572C', '#7A4FB3', '#2C6FB3', '#2E7D32', '#A8326E'];
const TYPES = [
  ['07:30', '15:30', 30], ['08:00', '16:00', 30], ['07:00', '15:00', 30], // dag
  ['15:00', '22:30', 30], ['14:30', '22:00', 30],                           // kveld
  ['22:00', '07:30', 0], ['21:30', '07:30', 0],                             // natt
  ['09:00', '21:00', 45], ['10:00', '18:00', 30],                           // lang- og helgevakt
];
const NOTES = ['', '', '', '', 'Avd 2', 'Vaktkode N1', 'Ekstravakt', 'Opplæring', 'Avd 3'];
const ALL = [0, 1, 2, 3, 4, 5, 6];

export function makeDemo({ rand = Math.random, newId, today = new Date() }) {
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const pick = list => list[Math.floor(rand() * list.length)];
  const round5 = n => Math.round(n / 5) * 5;
  const rule = (label, p) => ({ id: newId(), label, kind: 'kr', holiday: false, ...p });

  const names = [...NAMES].sort(() => rand() - 0.5).slice(0, int(2, 3));
  const colors = [...COLORS].sort(() => rand() - 0.5);
  const employers = names.map((name, i) => {
    const rules = [];
    if (rand() < 0.8) rules.push(rule('Kveld', { value: round5(int(40, 65)), days: [1, 2, 3, 4, 5], from: '17:00', to: '21:00' }));
    if (rand() < 0.8) rules.push(rule('Natt', { value: round5(int(55, 85)), days: ALL, from: '21:00', to: '06:00' }));
    if (rand() < 0.85) rules.push(rule('Helg', { value: round5(int(45, 70)), days: [6, 0], from: '00:00', to: '00:00' }));
    if (rand() < 0.5) rules.push(rule('Helligdag', { kind: 'pct', value: pick([50, 100]), holiday: true, days: [], from: '00:00', to: '00:00' }));
    return {
      id: newId(), name, color: colors[i % colors.length], rate: int(230, 320), archived: false, rules,
      overtime: rand() < 0.5 ? { afterH: 9, weekH: 40, pct: 40 } : null,
    };
  });

  // Vakter fra to uker tilbake til to uker frem. Unngår overlapp, men lar av og til
  // en vakt få for kort hviletid, så varslene vises.
  const ws = mondayOf(today);
  const shifts = [];
  let lastEnd = 0;
  // Hver arbeidsgiver brukes to ganger i tilfeldig rekkefølge før resten fordeles fritt,
  // så alle får minst to vakter.
  const deck = [...employers, ...employers].sort(() => rand() - 0.5);
  const nextEmployer = () => (deck.length ? deck.pop() : pick(employers)).id;
  for (let n = -14; n < 14; n++) {
    const inThisWeek = n >= 0 && n < 7;
    if (rand() > (inThisWeek ? 0.6 : 0.45)) continue;
    const day = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + n);
    const [start, end, breakMin] = pick(TYPES);
    const s = { id: newId(), employerId: '', date: isoDate(day), start, end, breakMin, note: pick(NOTES) };
    const t = parseShift(s);
    const gapH = (t.start - lastEnd) / HOUR;
    if (gapH < 0) continue;
    if (gapH < 11 && rand() > 0.25) continue;
    s.employerId = nextEmployer();
    shifts.push(s);
    lastEnd = t.end.getTime();
  }
  if (!shifts.some(s => s.date >= isoDate(ws) && s.date < isoDate(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 7)))) {
    const day = isoDate(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 2));
    if (!shifts.some(s => s.date === day)) shifts.push({ id: newId(), employerId: employers[0].id, date: day, start: '08:00', end: '16:00', breakMin: 30, note: '' });
  }
  // Reserve (sjelden): legg dagvakter på ledige dager til alle har minst to.
  const used = new Set(shifts.map(s => s.date));
  for (const e of employers) {
    let have = shifts.filter(s => s.employerId === e.id).length;
    for (let n = 0; have < 2 && n < 21; n++) {
      const date = isoDate(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + n));
      const prev = isoDate(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + n - 1));
      if (used.has(date) || used.has(prev)) continue; // unngå natt fra dagen før
      shifts.push({ id: newId(), employerId: e.id, date, start: '08:00', end: '16:00', breakMin: 30, note: '' });
      used.add(date); have++;
    }
  }
  shifts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { employers, shifts };
}
