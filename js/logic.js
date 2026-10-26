// Vaktbok – ren logikk uten DOM. Brukes av appen og av testene (node --test).
// All tid regnes i lokal tid (Europe/Oslo i praksis), minutt for minutt.

export const MIN = 60000;
export const HOUR = 3600000;

export const DEFAULT_SETTINGS = Object.freeze({
  holidayPayPct: 10.2, // feriepenger: 10,2 % (12 % ved 5 ukers ferie)
  minRestH: 11,        // arbeidsmiljøloven § 10-8 (1): 11 timer sammenhengende fri per 24 timer
  weekLimitH: 48,      // varsel når samlet arbeidstid i en uke passerer dette
  taxPct: 0,           // valgfritt prosenttrekk fra skattekortet, 0 = ikke vis netto
  payslips: {},        // { 'YYYY-MM': { employerId: utbetalt brutto } }
});

// ---------- Dato og tid ----------

export const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toMinutes = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function parseShift(s) {
  const [y, m, d] = s.date.split('-').map(Number);
  const [sh, sm] = s.start.split(':').map(Number);
  const [eh, em] = s.end.split(':').map(Number);
  const start = new Date(y, m - 1, d, sh, sm);
  let end = new Date(y, m - 1, d, eh, em);
  if (end <= start) end = new Date(y, m - 1, d + 1, eh, em); // over midnatt (start = slutt betyr 24 t)
  return { start, end };
}

export function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
}

// ---------- Norske helligdager ----------

function easterSunday(year) { // anonym gregoriansk algoritme
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const holidayCache = new Map();
export function norwegianHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const e = easterSunday(year);
  const rel = (n, name) => { const d = new Date(e); d.setDate(d.getDate() + n); return [isoDate(d), name]; };
  const map = new Map([
    [`${year}-01-01`, '1. nyttårsdag'],
    rel(-3, 'Skjærtorsdag'), rel(-2, 'Langfredag'), rel(0, '1. påskedag'), rel(1, '2. påskedag'),
    [`${year}-05-01`, 'Arbeidernes dag'], [`${year}-05-17`, 'Grunnlovsdagen'],
    rel(39, 'Kristi himmelfartsdag'), rel(49, '1. pinsedag'), rel(50, '2. pinsedag'),
    [`${year}-12-25`, '1. juledag'], [`${year}-12-26`, '2. juledag'],
  ]);
  holidayCache.set(year, map);
  return map;
}
export const holidayName = dateStr => norwegianHolidays(Number(dateStr.slice(0, 4))).get(dateStr) || null;

// ---------- Tilleggsregler ----------
// Regel: { id, label, kind: 'kr' | 'pct', value, days: [0..6] (0 = søndag), from: 'HH:MM', to: 'HH:MM', holiday: bool }
// from === to betyr hele døgnet. from > to krysser midnatt (f.eks. 21:00–06:00).
// Dager og helligdag gjelder kalenderdagen minuttet faller på.

export function ruleMatches(rule, dt) {
  if (rule.holiday) {
    if (!holidayName(isoDate(dt))) return false;
  } else if (!Array.isArray(rule.days) || !rule.days.includes(dt.getDay())) return false;
  const m = dt.getHours() * 60 + dt.getMinutes();
  const f = toMinutes(rule.from || '00:00'), t = toMinutes(rule.to || '00:00');
  if (f === t) return true;
  return f < t ? m >= f && m < t : m >= f || m < t;
}

export function calcShift(s, emp = {}) {
  const { start, end } = parseShift(s);
  const gross = (end - start) / MIN;
  const brk = Math.min(Math.max(Number(s.breakMin) || 0, 0), gross);
  const worked = gross - brk;
  const f = gross ? worked / gross : 0; // pausen trekkes forholdsmessig fra alle tidsrom
  const rate = Number(emp.rate) || 0;
  const rules = Array.isArray(emp.rules) ? emp.rules : [];
  const counts = new Array(rules.length).fill(0);
  if (rules.length) {
    for (let t = start.getTime(); t < end.getTime(); t += MIN) {
      const dt = new Date(t);
      for (let i = 0; i < rules.length; i++) if (ruleMatches(rules[i], dt)) counts[i]++;
    }
  }
  const hours = worked / 60;
  const base = hours * rate;
  const supplements = rules.map((r, i) => {
    const h = (counts[i] * f) / 60;
    const perHour = r.kind === 'pct' ? (rate * (Number(r.value) || 0)) / 100 : Number(r.value) || 0;
    return { id: r.id, label: r.label || 'Tillegg', hours: h, amount: h * perHour };
  });
  const ot = emp.overtime && Number(emp.overtime.afterH) > 0 ? emp.overtime : null;
  const overtimeH = ot ? Math.max(0, hours - Number(ot.afterH)) : 0;
  const otRate = rate * (Number(emp.overtime?.pct) || 0) / 100;
  const overtimePay = overtimeH * otRate;
  const pay = base + supplements.reduce((a, x) => a + x.amount, 0) + overtimePay;
  return { start, end, hours, base, supplements, overtimeH, overtimePay, otRate, pay };
}

// Regner ut alle vakter samlet, slik at overtid per uke blir riktig.
// Ukeovertid (arbeidsmiljøloven: over 40 t i uka) regnes per arbeidsgiver og per ISO-uke,
// i tidsrekkefølge. Timer som allerede er dagovertid telles ikke dobbelt.
export function calcAll(shifts, employers) {
  const out = new Map();
  const byEmpWeek = new Map();
  for (const s of shifts) {
    const emp = employers.find(e => e.id === s.employerId);
    const c = calcShift(s, emp);
    out.set(s.id, c);
    const weekH = Number(emp?.overtime?.weekH);
    if (weekH > 0) {
      const { year, week } = isoWeek(c.start);
      const k = `${s.employerId}|${year}-${week}`;
      if (!byEmpWeek.has(k)) byEmpWeek.set(k, { limit: weekH, list: [] });
      byEmpWeek.get(k).list.push({ s, c });
    }
  }
  for (const { limit, list } of byEmpWeek.values()) {
    list.sort((a, b) => a.c.start - b.c.start);
    let normal = 0;
    for (const { c } of list) {
      const ordinary = c.hours - c.overtimeH;
      const extra = Math.max(0, Math.min(ordinary, normal + ordinary - limit));
      normal += ordinary - extra;
      if (extra > 0) {
        c.weekOvertimeH = extra;
        c.overtimeH += extra;
        c.overtimePay += extra * c.otRate;
        c.pay += extra * c.otRate;
      }
    }
  }
  return out;
}

// ---------- Varsler ----------

export function checkRest(shifts, minRestH = DEFAULT_SETTINGS.minRestH) {
  const list = shifts.map(s => ({ s, ...parseShift(s) })).sort((a, b) => a.start - b.start);
  const warn = {};
  let prev = null;
  for (const cur of list) {
    if (prev) {
      const gap = (cur.start - prev.end) / HOUR;
      if (gap < 0) warn[cur.s.id] = { type: 'overlap', with: prev.s.id, gap };
      else if (gap < minRestH) warn[cur.s.id] = { type: 'rest', with: prev.s.id, gap };
    }
    if (!prev || cur.end > prev.end) prev = cur;
  }
  return warn;
}

// Samlet arbeidstid per ISO-uke på tvers av arbeidsgivere. Returnerer uker over grensen.
export function weeklyOverLimit(shifts, employers, limitH = DEFAULT_SETTINGS.weekLimitH) {
  const byWeek = {};
  for (const s of shifts) {
    const emp = employers.find(e => e.id === s.employerId);
    const { year, week } = isoWeek(parseDate(s.date));
    const k = `${year}-U${pad(week)}`;
    byWeek[k] = (byWeek[k] || 0) + calcShift(s, emp).hours;
  }
  return Object.entries(byWeek).filter(([, h]) => h > limitH).map(([week, hours]) => ({ week, hours }));
}

// Sjekker om et 11-sifret tall er et gyldig norsk fødselsnummer, D-nummer eller H-nummer:
// gyldig dato (D: dag + 40, H: måned + 40) og riktige kontrollsifre (modulus 11).
export function isNorwegianId(digits) {
  if (!/^\d{11}$/.test(digits)) return false;
  const n = [...digits].map(Number);
  let day = n[0] * 10 + n[1], month = n[2] * 10 + n[3];
  if (day > 40) day -= 40;        // D-nummer
  if (month > 40) month -= 40;    // H-nummer
  if (day < 1 || day > 31 || month < 1 || month > 12) return false;
  const yy = n[4] * 10 + n[5];
  const dt = new Date(2000 + yy, month - 1, day); // år spiller bare inn for 29. februar
  if (dt.getMonth() !== month - 1 || (dt.getDate() !== day && !(day === 29 && month === 2))) return false;
  const control = (w, len) => { const r = 11 - (w.reduce((a, x, i) => a + x * n[i], 0) % 11); return r === 11 ? 0 : r; };
  const k1 = control([3, 7, 6, 1, 8, 9, 4, 5, 2], 9);
  const k2 = control([5, 4, 3, 2, 7, 6, 5, 4, 3, 2], 10);
  return k1 !== 10 && k2 !== 10 && k1 === n[9] && k2 === n[10];
}

// Stopper fødselsnummer i notater. Tåler mellomrom eller punktum etter de seks første sifrene.
export function noteLooksSensitive(note) {
  const text = String(note || '');
  // Uten lookbehind, så det virker også i eldre Safari (før iOS 16.4).
  for (const m of text.matchAll(/(^|\D)(\d{6})[\s.]?(\d{5})(?!\d)/g)) {
    if (isNorwegianId(m[2] + m[3])) return true;
  }
  return false;
}

// ---------- Validering ----------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateShift(s, employers = []) {
  const errors = [];
  if (!employers.some(e => e.id === s.employerId)) errors.push('Velg en arbeidsgiver.');
  if (!DATE_RE.test(s.date || '') || isNaN(parseDate(s.date))) errors.push('Skriv inn en gyldig dato.');
  if (!TIME_RE.test(s.start || '')) errors.push('Skriv inn starttid som TT:MM.');
  if (!TIME_RE.test(s.end || '')) errors.push('Skriv inn sluttid som TT:MM.');
  const b = Number(s.breakMin);
  if (!Number.isFinite(b) || b < 0 || b > 600) errors.push('Pausen må være mellom 0 og 600 minutter.');
  if (String(s.note || '').length > 200) errors.push('Notatet kan ha maks 200 tegn.');
  if (!errors.length) {
    const { start, end } = parseShift(s);
    if (b >= (end - start) / MIN) errors.push('Pausen er like lang som eller lengre enn vakta.');
  }
  return errors;
}

export function validateEmployer(e) {
  const errors = [];
  const name = String(e.name || '').trim();
  if (!name || name.length > 60) errors.push('Navnet må ha 1–60 tegn.');
  const r = Number(e.rate);
  if (!Number.isFinite(r) || r < 0 || r > 10000) errors.push('Timelønn må være mellom 0 og 10 000 kr.');
  for (const rule of e.rules || []) {
    if (!rule.holiday && !(rule.days || []).length) errors.push(`«${rule.label || 'Tillegg'}» må gjelde minst én dag.`);
    if (!TIME_RE.test(rule.from || '') || !TIME_RE.test(rule.to || '')) errors.push(`«${rule.label || 'Tillegg'}» trenger gyldige klokkeslett.`);
    const v = Number(rule.value);
    if (!Number.isFinite(v) || v < 0) errors.push(`«${rule.label || 'Tillegg'}» må ha en verdi på 0 eller mer.`);
  }
  if (e.overtime) {
    const d = e.overtime.afterH, w = e.overtime.weekH;
    if (!(Number(d) > 0) && !(Number(w) > 0)) errors.push('Overtid trenger en grense per dag eller per uke.');
    if (d != null && d !== '' && !(Number(d) >= 1 && Number(d) <= 24)) errors.push('Overtid per dag må starte etter 1–24 timer.');
    if (w != null && w !== '' && !(Number(w) >= 1 && Number(w) <= 100)) errors.push('Overtid per uke må starte etter 1–100 timer.');
    const p = Number(e.overtime.pct);
    if (!Number.isFinite(p) || p < 0 || p > 300) errors.push('Overtidstillegget må være mellom 0 og 300 %.');
  }
  return errors;
}

// ---------- Gjentakende vakter ----------

// Datoer fra og med start til og med until, med stepDays mellom. Maks max datoer.
export function repeatDates(start, until, stepDays, max = 60) {
  const out = [];
  const end = parseDate(until);
  for (let d = parseDate(start); d <= end && out.length < max; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + stepDays)) {
    out.push(isoDate(d));
  }
  return out;
}

// ---------- Oppsummering og eksport ----------

export function shiftsInMonth(shifts, ym) {
  return shifts.filter(s => s.date.startsWith(ym))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export function monthSummary(shifts, employers, ym, settings = DEFAULT_SETTINGS) {
  const byEmp = {};
  const total = { hours: 0, supplementPay: 0, overtimePay: 0, pay: 0, count: 0 };
  const all = calcAll(shifts, employers);
  for (const s of shiftsInMonth(shifts, ym)) {
    const c = all.get(s.id);
    const o = byEmp[s.employerId] ||= { hours: 0, supplementPay: 0, overtimePay: 0, pay: 0, count: 0, supplements: {} };
    const sup = c.supplements.reduce((a, x) => a + x.amount, 0);
    for (const t of [o, total]) {
      t.hours += c.hours; t.supplementPay += sup; t.overtimePay += c.overtimePay; t.pay += c.pay; t.count++;
    }
    for (const x of c.supplements) {
      const k = o.supplements[x.id] ||= { label: x.label, hours: 0, amount: 0 };
      k.hours += x.hours; k.amount += x.amount;
    }
  }
  total.holidayPay = total.pay * (Number(settings.holidayPayPct) || 0) / 100;
  const tax = Number(settings.taxPct) || 0;
  total.net = tax > 0 ? total.pay * (1 - tax / 100) : null;
  return { byEmp, total };
}

// Hele året: per måned, per arbeidsgiver og totalt. Regner alle vakter én gang.
export function yearSummary(shifts, employers, year, settings = DEFAULT_SETTINGS) {
  const all = calcAll(shifts, employers);
  const months = Array.from({ length: 12 }, (_, i) => ({ ym: `${year}-${pad(i + 1)}`, hours: 0, pay: 0, count: 0 }));
  const byEmp = {};
  const total = { hours: 0, pay: 0, count: 0 };
  for (const s of shifts) {
    if (!s.date.startsWith(`${year}-`)) continue;
    const c = all.get(s.id), m = months[Number(s.date.slice(5, 7)) - 1];
    const e = byEmp[s.employerId] ||= { hours: 0, pay: 0, count: 0 };
    for (const t of [m, e, total]) { t.hours += c.hours; t.pay += c.pay; t.count++; }
  }
  total.holidayPay = total.pay * (Number(settings.holidayPayPct) || 0) / 100;
  return { months, byEmp, total };
}

// Sammenligner estimat med det som faktisk ble utbetalt (brutto) per arbeidsgiver.
export function payslipDiff(summary, paid = {}) {
  return Object.entries(paid)
    .filter(([id, v]) => v !== '' && v != null && Number.isFinite(Number(v)) && summary.byEmp[id])
    .map(([id, v]) => {
      const estimate = summary.byEmp[id].pay, actual = Number(v), diff = actual - estimate;
      return { employerId: id, estimate, actual, diff, ok: Math.abs(diff) <= Math.max(50, estimate * 0.02) };
    });
}

const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // hindrer formel-injeksjon i Excel
  return '"' + s.replace(/"/g, '""') + '"';
};
const nok = n => n.toFixed(2).replace('.', ',');

export function toCSV(shifts, employers, ym) {
  const rows = [['Dato', 'Arbeidsgiver', 'Start', 'Slutt', 'Pause (min)', 'Timer', 'Tillegg (kr)', 'Overtid (t)', 'Estimert lønn (kr)', 'Notat']];
  const all = calcAll(shifts, employers);
  for (const s of shiftsInMonth(shifts, ym)) {
    const emp = employers.find(e => e.id === s.employerId);
    const c = all.get(s.id);
    rows.push([s.date, emp ? emp.name : '', s.start, s.end, s.breakMin || 0, nok(c.hours),
      nok(c.supplements.reduce((a, x) => a + x.amount, 0)), nok(c.overtimeH), nok(c.pay), s.note || '']);
  }
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
}

// Timeliste for én arbeidsgiver, eller employerId = 'all' for alle, gruppert per arbeidsgiver.
export function toTimesheet(shifts, employers, ym, employerId) {
  const month = shiftsInMonth(shifts, ym);
  const ids = employerId === 'all' ? [...new Set(month.map(s => s.employerId))] : [employerId];
  let grand = 0, count = 0;
  const blocks = ids.map(id => {
    const emp = employers.find(e => e.id === id);
    const list = month.filter(s => s.employerId === id);
    let total = 0;
    const lines = list.map(s => {
      const c = calcShift(s, emp); total += c.hours;
      const d = parseDate(s.date);
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}  ${s.start}–${s.end}  pause ${s.breakMin || 0} min  ${nok(c.hours)} t`;
    });
    grand += total; count += list.length;
    return { name: emp ? emp.name : '', lines, total, n: list.length };
  });
  if (employerId !== 'all') {
    const [x] = blocks;
    return [`Timeliste ${ym} – ${x.name}`, '', ...x.lines, '', `Sum: ${nok(x.total)} timer (${x.n} vakter)`].join('\n');
  }
  const out = [`Timeliste ${ym} – alle arbeidsgivere`];
  for (const x of blocks) out.push('', x.name, ...x.lines, `Sum ${x.name}: ${nok(x.total)} timer (${x.n} vakter)`);
  out.push('', `Totalt: ${nok(grand)} timer (${count} vakter)`);
  return out.join('\n');
}

// ---------- Kalender (.ics) ----------
// Notater tas ikke med, siden kalendere ofte deles eller synkes til andre tjenester.

const icsTime = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = t => String(t).replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
const fold = line => { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); };

export function toICS(shifts, employers, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vaktbok//NB', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Vaktbok'];
  for (const s of shifts) {
    const emp = employers.find(e => e.id === s.employerId);
    const { start, end } = parseShift(s);
    lines.push('BEGIN:VEVENT', `UID:${s.id}@vaktbok`, `DTSTAMP:${icsTime(now)}`, `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`,
      fold(`SUMMARY:${icsText(`Vakt – ${emp ? emp.name : 'Vaktbok'}`)}`), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ---------- Import fra prototypen (localStorage 'vaktbok-v1') ----------

export function migrateV1(old, newId) {
  const idMap = new Map();
  const employers = (old.employers || []).map(e => {
    const id = newId(); idMap.set(e.id, id);
    const rules = [];
    if (Number(e.eveAdd) > 0) rules.push({ id: newId(), label: 'Kveld/natt', kind: 'kr', value: Number(e.eveAdd), days: [0, 1, 2, 3, 4, 5, 6], from: '17:00', to: '06:00', holiday: false });
    if (Number(e.wkdAdd) > 0) rules.push({ id: newId(), label: 'Helg', kind: 'kr', value: Number(e.wkdAdd), days: [6, 0], from: '00:00', to: '00:00', holiday: false });
    return { id, name: String(e.name || 'Arbeidsgiver').slice(0, 60), color: e.color || '#1F6F6B', rate: Number(e.rate) || 0, rules, overtime: null, archived: false };
  });
  const shifts = (old.shifts || []).filter(s => idMap.has(s.employerId)).map(s => ({
    id: newId(), employerId: idMap.get(s.employerId), date: s.date, start: s.start, end: s.end,
    breakMin: Number(s.breakMin) || 0, note: String(s.note || '').slice(0, 200),
  }));
  return { employers, shifts };
}
