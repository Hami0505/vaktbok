// Testene forutsetter norsk tid (sommertid, helligdager). Settes her så det virker på Windows også.
process.env.TZ = 'Europe/Oslo';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const ALL = [0, 1, 2, 3, 4, 5, 6];
const emp = {
  id: 'e1', name: 'A', rate: 200,
  rules: [
    { id: 'kv', label: 'Kveld/natt', kind: 'kr', value: 50, days: ALL, from: '17:00', to: '06:00' },
    { id: 'hg', label: 'Helg', kind: 'kr', value: 40, days: [6, 0], from: '00:00', to: '00:00' },
    { id: 'hd', label: 'Helligdag', kind: 'pct', value: 100, holiday: true, days: [], from: '00:00', to: '00:00' },
  ],
};
const emp2 = { id: 'e2', name: 'B', rate: 180, rules: [] };
const S = (o) => ({ id: Math.random().toString(36), employerId: 'e1', breakMin: 0, note: '', ...o });

test('dagvakt med pause', () => {
  const c = L.calcShift(S({ date: '2026-10-21', start: '08:00', end: '16:00', breakMin: 30 }), emp); // onsdag
  close(c.hours, 7.5, 'timer'); close(c.pay, 1500, 'lønn');
  close(c.supplements[0].hours, 0, 'kveld');
});

test('kveldstimer trekker pause forholdsmessig', () => {
  const c = L.calcShift(S({ date: '2026-10-21', start: '15:00', end: '21:00', breakMin: 60 }), emp);
  close(c.hours, 5, 'timer');
  close(c.supplements[0].hours, 4 * 5 / 6, 'kveld');
});

test('nattevakt over midnatt inn i lørdag', () => {
  const c = L.calcShift(S({ date: '2026-10-23', start: '22:00', end: '07:00' }), emp); // fre -> lør
  close(c.hours, 9, 'timer');
  close(c.supplements[0].hours, 8, 'kveld/natt 22–06');
  close(c.supplements[1].hours, 7, 'helg fra midnatt');
  close(c.pay, 9 * 200 + 8 * 50 + 7 * 40, 'lønn');
});

test('helligdag gir prosenttillegg (17. mai)', () => {
  const c = L.calcShift(S({ date: '2027-05-17', start: '08:00', end: '16:00' }), emp); // mandag
  close(c.supplements[2].hours, 8, 'helligdagstimer');
  close(c.supplements[2].amount, 8 * 200, 'helligdagsbeløp');
});

test('norske helligdager, bevegelige', () => {
  const h = L.norwegianHolidays(2026);
  assert.equal(h.get('2026-04-05'), '1. påskedag');
  assert.equal(h.get('2026-04-03'), 'Langfredag');
  assert.equal(h.get('2026-05-14'), 'Kristi himmelfartsdag');
  assert.equal(h.get('2026-05-25'), '2. pinsedag');
  assert.equal(h.size, 12);
  assert.equal(L.holidayName('2025-04-20'), '1. påskedag');
});

test('pause lengre enn vakta gir ikke negative timer', () => {
  const c = L.calcShift(S({ date: '2026-10-21', start: '08:00', end: '09:00', breakMin: 120 }), emp);
  close(c.hours, 0, 'timer'); close(c.pay, 0, 'lønn');
});

test('overtid etter grense', () => {
  const e = { ...emp2, overtime: { afterH: 9, pct: 40 } };
  const c = L.calcShift(S({ employerId: 'e2', date: '2026-10-21', start: '07:00', end: '19:00' }), e);
  close(c.overtimeH, 3, 'overtid');
  close(c.overtimePay, 3 * 180 * 0.4, 'overtidsbeløp');
});

test('regel over midnatt og hele døgnet', () => {
  const night = { days: ALL, from: '21:00', to: '06:00' };
  assert.ok(L.ruleMatches(night, new Date(2026, 9, 21, 23, 0)));
  assert.ok(L.ruleMatches(night, new Date(2026, 9, 21, 5, 59)));
  assert.ok(!L.ruleMatches(night, new Date(2026, 9, 21, 6, 0)));
  assert.ok(L.ruleMatches({ days: [6], from: '00:00', to: '00:00' }, new Date(2026, 9, 24, 12, 0)));
  assert.ok(!L.ruleMatches({ days: [6], from: '00:00', to: '00:00' }, new Date(2026, 9, 25, 0, 0)));
});

test('sommertid: natt til 25. oktober 2026 har én time ekstra', () => {
  const c = L.calcShift(S({ employerId: 'e2', date: '2026-10-24', start: '22:00', end: '07:00' }), emp2);
  close(c.hours, 10, 'faktiske timer');
});

test('hviletidsvarsel ved 8 timers mellomrom', () => {
  const a = S({ id: 'a', date: '2026-10-20', start: '14:00', end: '22:00' });
  const b = S({ id: 'b', date: '2026-10-21', start: '06:00', end: '14:00', employerId: 'e2' });
  const w = L.checkRest([a, b], 11);
  assert.equal(w.b.type, 'rest'); close(w.b.gap, 8, 'gap');
});

test('ingen falsk varsel med 16 timers mellomrom', () => {
  const a = S({ id: 'a', date: '2026-10-20', start: '08:00', end: '16:00' });
  const b = S({ id: 'b', date: '2026-10-21', start: '08:00', end: '16:00' });
  assert.deepEqual(L.checkRest([a, b], 11), {});
});

test('overlapp mot lengste tidligere vakt', () => {
  const a = S({ id: 'a', date: '2026-10-20', start: '08:00', end: '20:00' });
  const b = S({ id: 'b', date: '2026-10-20', start: '09:00', end: '10:00' });
  const c = S({ id: 'c', date: '2026-10-20', start: '12:00', end: '14:00', employerId: 'e2' });
  const w = L.checkRest([a, b, c], 11);
  assert.equal(w.b.type, 'overlap'); assert.equal(w.c.type, 'overlap'); assert.equal(w.c.with, 'a');
});

test('ukegrense på tvers av arbeidsgivere', () => {
  const shifts = [19, 20, 21, 22, 23, 24].map((d, i) => S({ date: `2026-10-${d}`, start: '07:00', end: '16:00', employerId: i % 2 ? 'e2' : 'e1' }));
  const over = L.weeklyOverLimit(shifts, [emp, emp2], 48);
  assert.equal(over.length, 1); assert.equal(over[0].week, '2026-U43'); close(over[0].hours, 54, 'timer');
});

test('månedsoppsummering og feriepenger', () => {
  const shifts = [
    S({ date: '2026-10-21', start: '08:00', end: '16:00' }),
    S({ date: '2026-11-02', start: '08:00', end: '16:00' }),
    S({ employerId: 'e2', date: '2026-10-22', start: '08:00', end: '12:00' }),
  ];
  const m = L.monthSummary(shifts, [emp, emp2], '2026-10', { holidayPayPct: 10.2 });
  assert.equal(m.total.count, 2); close(m.total.hours, 12, 'timer');
  close(m.total.pay, 1600 + 720, 'lønn'); close(m.total.holidayPay, 2320 * 0.102, 'feriepenger');
  assert.equal(m.byEmp.e2.count, 1);
});

test('validering av vakt', () => {
  assert.deepEqual(L.validateShift(S({ date: '2026-10-21', start: '08:00', end: '16:00' }), [emp]), []);
  assert.ok(L.validateShift(S({ date: '2026-10-21', start: '8', end: '16:00' }), [emp]).length);
  assert.ok(L.validateShift(S({ employerId: 'x', date: '2026-10-21', start: '08:00', end: '16:00' }), [emp]).length);
  assert.ok(L.validateShift(S({ date: '2026-10-21', start: '08:00', end: '09:00', breakMin: 60 }), [emp]).length);
});

test('validering av arbeidsgiver', () => {
  assert.deepEqual(L.validateEmployer(emp), []);
  assert.ok(L.validateEmployer({ ...emp, name: ' ' }).length);
  assert.ok(L.validateEmployer({ ...emp, rate: -1 }).length);
  assert.ok(L.validateEmployer({ ...emp, rules: [{ label: 'X', days: [], from: '17:00', to: '21:00', value: 1 }] }).length);
});

test('CSV: BOM, escaping og formelvern', () => {
  const csv = L.toCSV([S({ date: '2026-10-21', start: '08:00', end: '16:00', note: '=HYPERLINK("x") "sitat"' })], [emp], '2026-10');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"") ""sitat"""`));
  assert.ok(csv.includes('"8,00"'));
});

test('timeliste for én arbeidsgiver', () => {
  const t = L.toTimesheet([S({ date: '2026-10-21', start: '08:00', end: '16:00', breakMin: 30 })], [emp], '2026-10', 'e1');
  assert.match(t, /21\.10 {2}08:00–16:00/); assert.match(t, /Sum: 7,50 timer \(1 vakter\)/);
});

// Lager et syntetisk, gyldig nummer fra de ni første sifrene (ingen ekte person).
function withControl(nine) {
  const n = [...nine].map(Number);
  const c = (w) => { const r = 11 - (w.reduce((a, x, i) => a + x * n[i], 0) % 11); return r === 11 ? 0 : r; };
  const k1 = c([3, 7, 6, 1, 8, 9, 4, 5, 2]); if (k1 === 10) return null; n.push(k1);
  const k2 = c([5, 4, 3, 2, 7, 6, 5, 4, 3, 2]); if (k2 === 10) return null; n.push(k2);
  return n.join('');
}
const validIds = (prefix) => { for (let i = 100; i < 1000; i++) { const id = withControl(prefix + i); if (id) return id; } };

test('fødselsnummer i notat oppdages med kontrollsifre', () => {
  const fnr = validIds('150390'), dnr = validIds('550390'), hnr = validIds('154390');
  assert.ok(L.isNorwegianId(fnr) && L.isNorwegianId(dnr) && L.isNorwegianId(hnr));
  assert.ok(L.noteLooksSensitive(`bruker ${fnr}`));
  assert.ok(L.noteLooksSensitive(`${fnr.slice(0, 6)} ${fnr.slice(6)}`));
  assert.ok(L.noteLooksSensitive(`${fnr.slice(0, 6)}.${fnr.slice(6)}`));
  const wrong = fnr.slice(0, 10) + ((Number(fnr[10]) + 1) % 10);
  assert.ok(!L.noteLooksSensitive(wrong), 'feil kontrollsiffer');
  assert.ok(!L.isNorwegianId('31029012345'), 'ugyldig dato');
  assert.ok(!L.noteLooksSensitive('ref 12345678901'));
  assert.ok(!L.noteLooksSensitive('avd 3, vaktkode N2, tlf 98765432'));
  assert.ok(!L.noteLooksSensitive(`x${fnr}1`), 'del av lengre tall');
});

test('migrering fra prototypen', () => {
  let n = 0; const id = () => `id-${++n}`;
  const out = L.migrateV1({
    employers: [{ id: 'x', name: 'Byrå', rate: 250, eveAdd: 50, wkdAdd: 30, color: '#123456' }],
    shifts: [{ id: 's', employerId: 'x', date: '2026-10-23', start: '22:00', end: '07:00', breakMin: 0 }, { id: 't', employerId: 'borte', date: '2026-10-23', start: '08:00', end: '09:00' }],
  }, id);
  assert.equal(out.employers.length, 1); assert.equal(out.shifts.length, 1);
  assert.equal(out.shifts[0].employerId, out.employers[0].id);
  const c = L.calcShift(out.shifts[0], out.employers[0]);
  close(c.pay, 9 * 250 + 8 * 50 + 7 * 30, 'samme lønn som prototypen');
});

test('ukeovertid over 40 t per arbeidsgiver, uten dobbelttelling', () => {
  const e = { id: 'o', rate: 100, rules: [], overtime: { afterH: 9, weekH: 40, pct: 40 } };
  const shifts = [19, 20, 21, 22, 23].map(d => S({ id: `d${d}`, employerId: 'o', date: `2026-10-${d}`, start: '07:00', end: '17:00' }));
  const all = L.calcAll(shifts, [e]);
  close(all.get('d22').overtimeH, 1, 'bare dagovertid før grensen');
  close(all.get('d23').overtimeH, 6, '1 t dag + 5 t uke');
  close(all.get('d23').weekOvertimeH, 5, 'ukeovertid');
  close(all.get('d23').pay, 10 * 100 + 6 * 40, 'lønn');
});

test('ukeovertid teller ikke timer hos en annen arbeidsgiver', () => {
  const e = { id: 'o', rate: 100, rules: [], overtime: { weekH: 40, pct: 40 } };
  const shifts = [
    ...[19, 20, 21, 22].map(d => S({ employerId: 'o', date: `2026-10-${d}`, start: '06:00', end: '16:00' })),
    S({ id: 'annen', employerId: 'e2', date: '2026-10-23', start: '06:00', end: '16:00' }),
  ];
  const all = L.calcAll(shifts, [e, emp2]);
  for (const c of all.values()) close(c.overtimeH, 0, 'ingen overtid');
});

test('månedsoppsummering bruker ukeovertid og netto', () => {
  const e = { id: 'o', rate: 100, rules: [], overtime: { weekH: 40, pct: 50 } };
  const shifts = [26, 27, 28, 29, 30].map(d => S({ employerId: 'o', date: `2026-10-${d}`, start: '07:00', end: '16:00' }));
  const m = L.monthSummary(shifts, [e], '2026-10', { holidayPayPct: 10.2, taxPct: 30 });
  close(m.total.overtimePay, 5 * 50, 'overtid');
  close(m.total.net, (4500 + 250) * 0.7, 'netto');
  assert.equal(L.monthSummary(shifts, [e], '2026-10', { taxPct: 0 }).total.net, null);
});

test('sammenligning med lønnsslipp', () => {
  const sum = { byEmp: { a: { pay: 10000 }, b: { pay: 5000 } } };
  const d = L.payslipDiff(sum, { a: 10100, b: 4000, c: 1, x: '' });
  assert.equal(d.length, 2);
  assert.ok(d.find(x => x.employerId === 'a').ok);
  const b = d.find(x => x.employerId === 'b'); assert.ok(!b.ok); close(b.diff, -1000, 'avvik');
});

test('kalenderfil (.ics) uten notater, med escaping', () => {
  const ics = L.toICS([S({ id: 'abc', date: '2026-10-23', start: '22:00', end: '07:00', note: 'hemmelig' })], [{ id: 'e1', name: 'Byrå, avd; 2' }]);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.match(ics, /UID:abc@vaktbok/);
  assert.match(ics, /DTSTART:20261023T200000Z/); // 22:00 i Oslo = 20:00 UTC (sommertid)
  assert.match(ics, /DTEND:20261024T050000Z/);
  assert.match(ics, /SUMMARY:Vakt – Byrå\\, avd\\; 2/);
  assert.ok(!ics.includes('hemmelig'));
});

test('validering av overtid', () => {
  assert.deepEqual(L.validateEmployer({ ...emp2, overtime: { weekH: 40, pct: 40 } }), []);
  assert.ok(L.validateEmployer({ ...emp2, overtime: { afterH: null, weekH: null, pct: 40 } }).length);
  assert.ok(L.validateEmployer({ ...emp2, overtime: { afterH: 9, pct: 500 } }).length);
});

test('eksempeldata er tilfeldige, gyldige og uten overlapp', async () => {
  const { makeDemo } = await import('../js/demo.js');
  const seeded = seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  let i = 0; const id = () => `id-${++i}`;
  const runs = Array.from({ length: 200 }, (_, n) => n + 1).map(n => makeDemo({ rand: seeded(n), newId: id, today: new Date(2026, 9, 26) }));
  for (const { employers, shifts } of runs) {
    assert.ok(employers.length >= 2 && employers.length <= 3);
    for (const e of employers) assert.deepEqual(L.validateEmployer(e), []);
    for (const s of shifts) assert.deepEqual(L.validateShift(s, employers), []);
    const w = L.checkRest(shifts, 11);
    assert.ok(!Object.values(w).some(x => x.type === 'overlap'), 'ingen overlapp');
    assert.ok(shifts.some(s => s.date >= '2026-10-26' && s.date <= '2026-11-01'), 'minst én vakt denne uka');
    for (const e of employers) assert.ok(shifts.filter(s => s.employerId === e.id).length >= 2, `${e.name} har minst to vakter`);
  }
  const sig = r => r.employers.map(e => e.name + e.rate).join() + r.shifts.length;
  assert.ok(new Set(runs.map(sig)).size > 1, 'ulike data hver gang');
});

test('gjentakende vakter: ukentlig, annenhver uke og maksgrense', () => {
  assert.deepEqual(L.repeatDates('2026-10-27', '2026-11-24', 7), ['2026-10-27', '2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
  assert.deepEqual(L.repeatDates('2026-10-27', '2026-11-24', 14), ['2026-10-27', '2026-11-10', '2026-11-24']);
  assert.equal(L.repeatDates('2026-01-01', '2027-12-31', 7, 60).length, 60);
  assert.deepEqual(L.repeatDates('2026-03-23', '2026-04-06', 7), ['2026-03-23', '2026-03-30', '2026-04-06'], 'over sommertid');
});

test('årsoversikt per måned og arbeidsgiver', () => {
  const shifts = [
    S({ date: '2026-01-05', start: '08:00', end: '16:00' }),
    S({ date: '2026-10-21', start: '08:00', end: '16:00' }),
    S({ employerId: 'e2', date: '2026-10-22', start: '08:00', end: '12:00' }),
    S({ date: '2025-12-31', start: '08:00', end: '16:00' }),
  ];
  const y = L.yearSummary(shifts, [emp, emp2], 2026, { holidayPayPct: 10.2 });
  assert.equal(y.total.count, 3);
  close(y.months[0].hours, 8, 'januar'); close(y.months[9].hours, 12, 'oktober'); close(y.months[11].hours, 0, 'desember');
  close(y.byEmp.e1.pay, 3200, 'arbeidsgiver 1'); close(y.byEmp.e2.pay, 720, 'arbeidsgiver 2');
  close(y.total.holidayPay, 3920 * 0.102, 'feriepenger');
});

test('fødselsnummer oppdages også rett etter bokstaver (uten lookbehind)', () => {
  const fnr = validIds('150390');
  assert.ok(L.noteLooksSensitive(`nr:${fnr}`));
  assert.ok(L.noteLooksSensitive(`a${fnr}`));
  assert.ok(L.noteLooksSensitive(`${fnr} og ${fnr}`));
});

test('timeliste for alle arbeidsgivere, gruppert med summer', () => {
  const shifts = [
    S({ date: '2026-10-21', start: '08:00', end: '16:00', breakMin: 30 }),
    S({ employerId: 'e2', date: '2026-10-22', start: '08:00', end: '12:00' }),
    S({ date: '2026-10-23', start: '08:00', end: '12:00' }),
  ];
  const t = L.toTimesheet(shifts, [emp, emp2], '2026-10', 'all');
  assert.match(t, /alle arbeidsgivere/);
  assert.match(t, /Sum A: 11,50 timer \(2 vakter\)/);
  assert.match(t, /Sum B: 4,00 timer \(1 vakter\)/);
  assert.match(t, /Totalt: 15,50 timer \(3 vakter\)/);
  assert.ok(!/Totalt/.test(L.toTimesheet(shifts, [emp, emp2], '2026-10', 'e1')), 'én arbeidsgiver har ingen totallinje');
});

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//NB',
  'BEGIN:VEVENT', 'UID:a1', 'DTSTART:20261023T200000Z', 'DTEND:20261024T053000Z', 'SUMMARY:Natt Bemannings', ' byrå', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a2', 'DTSTART;TZID=Europe/Oslo:20261021T080000', 'DTEND;TZID=Europe/Oslo:20261021T160000', 'SUMMARY:Vakt\\, Kafé', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a3', 'DTSTART;VALUE=DATE:20261025', 'DTEND;VALUE=DATE:20261026', 'SUMMARY:Bursdag', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a4', 'DTSTART:20261028T080000', 'DTEND:20261028T160000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Fast vakt', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a5', 'DTSTART:20261029T080000', 'DTEND:20261029T160000', 'STATUS:CANCELLED', 'SUMMARY:Avlyst', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a6', 'DTSTART:20261201T080000', 'DTEND:20261201T160000', 'SUMMARY:Langt frem', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('kalenderfil: tolker tider, sammenbrettede linjer og escaping', () => {
  const ev = L.parseICS(ICS);
  assert.equal(ev.length, 6);
  assert.equal(ev[0].summary, 'Natt Bemanningsbyrå');
  assert.equal(L.isoDate(ev[0].start), '2026-10-23');
  assert.equal(ev[0].start.getHours(), 22, '20:00 UTC = 22:00 norsk sommertid');
  assert.equal(ev[1].summary, 'Vakt, Kafé');
  assert.equal(ev[1].start.getHours(), 8, 'TZID tolkes som lokal tid');
  assert.ok(ev[2].allDay); assert.equal(ev[3].rrule, 'FREQ=WEEKLY'); assert.ok(ev[4].cancelled);
  assert.throws(() => L.parseICS('ikke en kalender'));
});

test('kalenderfil blir vakter, med filtre og uten dubletter', () => {
  let n = 0; const id = () => `k${++n}`;
  const byName = sum => /bemanning/i.test(sum) ? 'e1' : /kafé/i.test(sum) ? 'e2' : null;
  const r = L.icsToShifts(L.parseICS(ICS), { employerFor: byName, from: '2026-10-01', to: '2026-10-31', newId: id });
  assert.equal(r.shifts.length, 2);
  const natt = r.shifts.find(s => s.employerId === 'e1');
  assert.deepEqual([natt.date, natt.start, natt.end], ['2026-10-23', '22:00', '07:30']);
  assert.deepEqual(r.skipped, { allDay: 1, unsupported: 0, cancelled: 1, invalid: 0, outside: 1, filtered: 0, noEmployer: 1, duplicate: 0 });
  const again = L.icsToShifts(L.parseICS(ICS), { employerFor: byName, from: '2026-10-01', to: '2026-10-31', existing: r.shifts, newId: id });
  assert.equal(again.shifts.length, 0); assert.equal(again.skipped.duplicate, 2);
  const filtered = L.icsToShifts(L.parseICS(ICS), { employerFor: () => 'e1', from: '2026-10-01', to: '2026-10-31', contains: 'natt', newId: id });
  assert.equal(filtered.shifts.length, 1); assert.equal(filtered.skipped.filtered, 2, "Kafé og den gjentakende Fast vakt");
  for (const s of r.shifts) assert.deepEqual(L.validateShift(s, [emp, emp2]), []);
});


const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap(e => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

test('gjentakende vakter i kalenderen blir enkeltvakter', () => {
  let n = 0; const id = () => `r${++n}`;
  const ics = cal(
    ['UID:w', 'DTSTART;TZID=Europe/Oslo:20261006T150000', 'DTEND;TZID=Europe/Oslo:20261006T220000', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH', 'EXDATE;TZID=Europe/Oslo:20261015T150000', 'SUMMARY:Kveld'],
    ['UID:w', 'RECURRENCE-ID;TZID=Europe/Oslo:20261020T150000', 'DTSTART;TZID=Europe/Oslo:20261020T160000', 'DTEND;TZID=Europe/Oslo:20261020T230000', 'SUMMARY:Kveld (flyttet)'],
    ['UID:c', 'DTSTART:20261001T080000', 'DTEND:20261001T160000', 'RRULE:FREQ=DAILY;INTERVAL=7;COUNT=3', 'SUMMARY:Dag'],
    ['UID:m', 'DTSTART:20261002T080000', 'DTEND:20261002T160000', 'RRULE:FREQ=MONTHLY', 'SUMMARY:Månedlig'],
  );
  const r = L.icsToShifts(L.parseICS(ics), { employerFor: () => 'e1', from: '2026-10-01', to: '2026-10-31', newId: id, breakMin: 30 });
  const list = r.shifts.map(s => `${s.date} ${s.start}`);
  // tir/tor fra 6.10: 6, 8, 13, (15 unntatt), 20 flyttet til 16:00, 22, 27, 29
  for (const d of ['2026-10-06 15:00', '2026-10-08 15:00', '2026-10-13 15:00', '2026-10-20 16:00', '2026-10-22 15:00', '2026-10-27 15:00', '2026-10-29 15:00']) assert.ok(list.includes(d), d);
  assert.ok(!list.includes('2026-10-15 15:00'), 'EXDATE');
  assert.ok(!list.includes('2026-10-20 15:00'), 'erstattet av flyttet forekomst');
  // daglig hver 7. dag, 3 ganger: 1., 8., 15.
  for (const d of ['2026-10-01 08:00', '2026-10-08 08:00', '2026-10-15 08:00']) assert.ok(list.includes(d), d);
  assert.ok(!list.includes('2026-10-22 08:00'), 'COUNT=3');
  assert.equal(r.skipped.unsupported, 1);
  assert.ok(r.shifts.every(s => s.breakMin === 30), 'standardpause');
  assert.ok(r.shifts.find(s => s.date === '2026-10-26') === undefined);
  // vintertid etter 25.10: fortsatt 15:00 lokal tid
  assert.equal(r.shifts.find(s => s.date === '2026-10-27').start, '15:00');
});

test('gjentakelse med UNTIL stopper riktig', () => {
  let n = 0; const id = () => `u${++n}`;
  const ics = cal(['UID:x', 'DTSTART:20261005T080000', 'DTEND:20261005T120000', 'RRULE:FREQ=WEEKLY;UNTIL=20261019T235959Z', 'SUMMARY:Morgen']);
  const r = L.icsToShifts(L.parseICS(ics), { employerFor: () => 'e1', from: '2026-10-01', to: '2026-12-31', newId: id });
  assert.deepEqual(r.shifts.map(s => s.date), ['2026-10-05', '2026-10-12', '2026-10-19']);
});

test('regneark: Vaktboks egen eksport kan leses inn igjen', () => {
  const shifts = [S({ date: '2026-10-21', start: '08:00', end: '16:00', breakMin: 30, note: 'Avd 2' }), S({ employerId: 'e2', date: '2026-10-23', start: '22:00', end: '07:00' })];
  const rows = L.parseCSV(L.toCSV(shifts, [emp, emp2], '2026-10'));
  const cols = L.guessColumns(rows[0]);
  assert.deepEqual([cols.date, cols.start, cols.end, cols.breakMin, cols.employer], [0, 2, 3, 4, 1]);
  let n = 0;
  const r = L.csvToShifts(rows.slice(1), cols, { employerFor: name => ({ A: 'e1', B: 'e2' })[name] || null, newId: () => `c${++n}` });
  assert.equal(r.shifts.length, 2);
  assert.deepEqual([r.shifts[0].date, r.shifts[0].start, r.shifts[0].end, r.shifts[0].breakMin, r.shifts[0].note], ['2026-10-21', '08:00', '16:00', 30, 'Avd 2']);
  assert.equal(r.shifts[1].employerId, 'e2');
  const again = L.csvToShifts(rows.slice(1), cols, { employerFor: name => ({ A: 'e1', B: 'e2' })[name] || null, existing: r.shifts, newId: () => `d${++n}` });
  assert.equal(again.skipped.duplicate, 2);
});

test('regneark: norske datoer, komma som skilletegn og ugyldige rader', () => {
  const rows = L.parseCSV('Dato,Fra,Til,Pause\n27.10.2026,8.00,16:00,30\n28/10/26,15:00,22:30,\n"ikke dato",x,y,\n');
  const cols = L.guessColumns(rows[0]);
  const r = L.csvToShifts(rows.slice(1), cols, { employerFor: () => null, defaultEmployerId: 'e1', newId: () => Math.random().toString(36), breakMin: 15 });
  assert.deepEqual(r.shifts.map(s => [s.date, s.start, s.end, s.breakMin]), [['2026-10-27', '08:00', '16:00', 30], ['2026-10-28', '15:00', '22:30', 15]]);
  assert.equal(r.skipped.invalid, 1);
  assert.equal(L.normTime('24:00'), '00:00'); assert.equal(L.normDate('1.2.2027'), '2027-02-01'); assert.equal(L.normTime('25:00'), null);
});

test('serier: ukedager, intervall, antall og sluttdato', () => {
  const tueThu = { freq: 'week', interval: 1, days: [2, 4], end: { type: 'never' } };
  assert.deepEqual(L.seriesDates(tueThu, '2026-11-03', '2026-11-03', '2026-11-13'), ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12']);
  const every3 = { freq: 'week', interval: 3, days: [1], end: { type: 'count', count: 3 } };
  assert.deepEqual(L.seriesDates(every3, '2026-11-02'), ['2026-11-02', '2026-11-23', '2026-12-14']);
  const daily = { freq: 'day', interval: 2, end: { type: 'until', until: '2026-11-08' } };
  assert.deepEqual(L.seriesDates(daily, '2026-11-02'), ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08']);
  // påfylling: antall teller fra start, også når vi henter et senere vindu
  const five = { freq: 'week', interval: 1, days: [2, 4], end: { type: 'count', count: 5 } };
  assert.deepEqual(L.seriesDates(five, '2026-11-03', '2026-11-10'), ['2026-11-10', '2026-11-12', '2026-11-17']);
  // startdato midt i uka: bare dager fra og med start
  assert.deepEqual(L.seriesDates({ freq: 'week', interval: 1, days: [1, 5], end: { type: 'count', count: 3 } }, '2026-11-04'), ['2026-11-06', '2026-11-09', '2026-11-13']);
  // over sommertid/vintertid
  assert.deepEqual(L.seriesDates({ freq: 'day', interval: 1, end: { type: 'count', count: 3 } }, '2026-10-24'), ['2026-10-24', '2026-10-25', '2026-10-26']);
});

test('serier: beskrivelse og validering', () => {
  assert.equal(L.describeRepeat({ freq: 'week', interval: 1, days: [4, 2], end: { type: 'never' } }), 'Hver uke på tirsdag og torsdag, slutter aldri');
  assert.equal(L.describeRepeat({ freq: 'week', interval: 2, days: [6], end: { type: 'count', count: 4 } }), 'Annenhver uke på lørdag, 4 ganger');
  assert.equal(L.describeRepeat({ freq: 'week', interval: 1, days: [1, 2, 3, 4, 5], end: { type: 'until', until: '2026-12-31' } }), 'Hver ukedag (mandag–fredag), til og med 31.12.2026');
  assert.equal(L.describeRepeat({ freq: 'day', interval: 3, end: { type: 'never' } }), 'Hver 3. dag, slutter aldri');
  assert.deepEqual(L.validateRepeat({ freq: 'week', interval: 1, days: [2], end: { type: 'never' } }, '2026-11-03'), []);
  assert.ok(L.validateRepeat({ freq: 'week', interval: 1, days: [], end: { type: 'never' } }, '2026-11-03').length, 'ingen ukedager');
  assert.ok(L.validateRepeat({ freq: 'week', interval: 0, days: [2], end: { type: 'never' } }, '2026-11-03').length, 'intervall 0');
  assert.ok(L.validateRepeat({ freq: 'day', interval: 1, end: { type: 'until', until: '2026-11-01' } }, '2026-11-03').length, 'slutt før start');
  assert.ok(L.validateRepeat({ freq: 'day', interval: 1, end: { type: 'count', count: 0 } }, '2026-11-03').length, 'antall 0');
});
