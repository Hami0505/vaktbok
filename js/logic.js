// Vaktbok – ren logikk uten DOM. Brukes av appen og av testene (node --test).
// All tid regnes i lokal tid (Europe/Oslo i praksis), minutt for minutt.

export const MIN = 60000;
export const HOUR = 3600000;

export const DEFAULT_SETTINGS = Object.freeze({
  holidayPayPct: 10.2, // feriepenger: 10,2 % (12 % ved 5 ukers ferie)
  minRestH: 11,        // arbeidsmiljøloven § 10-8 (1): 11 timer sammenhengende fri per 24 timer
  weekLimitH: 48,      // varsel når samlet arbeidstid i en uke passerer dette
  taxPct: 0,           // standard skattetrekk i prosent for arbeidsgivere uten eget valg
  frikort: null,       // { on: true, limit: 100000, otherIncome: 0 } – inntekt i år utenfor Vaktbok, f.eks. feriepenger
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

// Lønnsform per arbeidsgiver: emp.pay = { type: 'hourly' | 'fee' | 'volunteer', feeDefault, holidayPay, inWarnings }.
// Uten pay er det timelønn som før. s.fee er et avtalt beløp for akkurat denne vakta og overstyrer alt.
export const payType = emp => emp?.pay?.type || 'hourly';
export const givesHolidayPay = emp => payType(emp) === 'volunteer' ? false : (emp?.pay?.holidayPay ?? payType(emp) === 'hourly');
export const hasFixedFee = s => s.fee !== null && s.fee !== undefined && s.fee !== '' && Number.isFinite(Number(s.fee));

export function calcShift(s, emp = {}) {
  emp = emp || {};
  const { start, end } = parseShift(s);
  const type = payType(emp);
  if (type !== 'hourly' || hasFixedFee(s)) {
    const gross0 = (end - start) / MIN;
    const hours = (gross0 - Math.min(Math.max(Number(s.breakMin) || 0, 0), gross0)) / 60;
    const pay = type === 'volunteer' && !hasFixedFee(s) ? 0
      : hasFixedFee(s) ? Number(s.fee) : Number(emp.pay?.feeDefault) || 0;
    return {
      start, end, hours, base: pay, supplements: [], overtimeH: 0, overtimePay: 0, otRate: 0, pay,
      kind: type, fixed: true, effectiveRate: hours > 0 && pay > 0 ? pay / hours : null,
      holidayBase: givesHolidayPay(emp) ? pay : 0,
    };
  }
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
  return { start, end, hours, base, supplements, overtimeH, overtimePay, otRate, pay, kind: 'hourly', fixed: false, effectiveRate: null, holidayBase: givesHolidayPay(emp) ? pay : 0 };
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
    if (weekH > 0 && !isOffered(s)) {
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
        if (c.holidayBase) c.holidayBase += extra * c.otRate;
      }
    }
  }
  return out;
}

// ---------- Status på vakter ----------
// status: 'offered' (tilbudt, ikke tatt ennå) eller tom/'confirmed' (bekreftet). Tilbudte vakter vises,
// men telles ikke i timer, lønn, frikort, eksport eller varsler før de er tatt.
export const isOffered = s => s?.status === 'offered';
export const counted = s => !isOffered(s);

// ---------- Skatt og netto ----------
// emp.pay.tax = { mode: 'default' | 'pct' | 'table' | 'freeOrg', pct, slipGross, slipTax }
//  default: standard skattetrekk fra innstillingene
//  pct:     prosenttrekk fra skattekortet
//  table:   tabelltrekk, anslått ut fra brutto og trekk på en lønnsslipp
//  freeOrg: skattefri organisasjon – skattefritt inntil 10 000 kr per år fra denne, ellers skattepliktig fra første krone
// settings.frikort = { on, limit, otherIncome, newCardPct }: ingen trekk til grensen er nådd, deretter 50 %
// (som når frikortet er brukt opp), eller prosenten på et nytt skattekort hvis brukeren har bestilt det.
// Tabelltrekk: ingen trekk i juni og halvt trekk i desember. Dette er trekk (forskudd), ikke endelig skatt.

export const FREE_ORG_LIMIT = 10000;
export const FRIKORT_DEFAULT = 100000;

export function taxPctFor(emp, settings = DEFAULT_SETTINGS) {
  const t = emp?.pay?.tax || { mode: 'default' };
  if (t.mode === 'pct') return Number(t.pct) || 0;
  if (t.mode === 'table') return Number(t.slipGross) > 0 ? Math.min(100, Math.max(0, (Number(t.slipTax) || 0) / Number(t.slipGross) * 100)) : 0;
  return Number(settings.taxPct) || 0;
}

// Legger tax og net på hver vakt i all (fra calcAll). Regner per kalenderår, i tidsrekkefølge.
export function applyTax(all, shifts, employers, settings = DEFAULT_SETTINGS) {
  const fk = settings.frikort?.on ? settings.frikort : null;
  const limit = fk ? Number(fk.limit) || FRIKORT_DEFAULT : 0;
  const empOf = id => employers.find(e => e.id === id);
  // Årssum per skattefri organisasjon: over grensen blir alt skattepliktig.
  const orgYear = new Map();
  for (const s of shifts) {
    const e = empOf(s.employerId);
    if (e?.pay?.tax?.mode !== 'freeOrg' || isOffered(s)) continue;
    const k = `${s.employerId}|${s.date.slice(0, 4)}`;
    orgYear.set(k, (orgYear.get(k) || 0) + (all.get(s.id)?.pay || 0));
  }
  const used = new Map(); // frikort brukt per år
  const sorted = [...shifts].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  for (const s of sorted) {
    const c = all.get(s.id); if (!c) continue;
    if (isOffered(s)) { c.tax = 0; c.net = c.pay; continue; }
    const e = empOf(s.employerId), y = s.date.slice(0, 4);
    const freeOrg = e?.pay?.tax?.mode === 'freeOrg' && (orgYear.get(`${s.employerId}|${y}`) || 0) <= FREE_ORG_LIMIT;
    let tax = 0;
    if (!c.pay || freeOrg) tax = 0;
    else if (fk) {
      const before = used.has(y) ? used.get(y) : Number(fk.otherIncome) || 0;
      const after = before + c.pay;
      used.set(y, after);
      const overRate = fk.newCardPct != null && fk.newCardPct !== '' ? Number(fk.newCardPct) / 100 : 0.5;
      tax = Math.max(0, after - Math.max(limit, before)) * overRate;
    } else {
      let pct = taxPctFor(e, settings);
      if (e?.pay?.tax?.mode === 'table') { const mo = s.date.slice(5, 7); if (mo === '06') pct = 0; else if (mo === '12') pct /= 2; }
      tax = c.pay * pct / 100;
    }
    c.tax = tax; c.net = c.pay - tax; c.taxFree = freeOrg;
  }
  return all;
}

export function calcAllNet(shifts, employers, settings = DEFAULT_SETTINGS) {
  return applyTax(calcAll(shifts, employers), shifts, employers, settings);
}

// Frikort for et år: hvor mye som er brukt til og med en dato, og hva planlagte vakter gir resten av året.
export function frikortStatus(shifts, employers, settings, year, todayIso) {
  const fk = settings.frikort; if (!fk?.on) return null;
  const all = calcAllNet(shifts, employers, settings);
  const limit = Number(fk.limit) || FRIKORT_DEFAULT;
  let earned = Number(fk.otherIncome) || 0, planned = 0;
  for (const s of shifts) {
    if (!s.date.startsWith(`${year}-`) || isOffered(s)) continue;
    const c = all.get(s.id); if (!c || c.taxFree) continue;
    if (s.date <= todayIso) earned += c.pay; else planned += c.pay;
  }
  return { limit, earned, planned, total: earned + planned, left: Math.max(0, limit - earned), overBy: Math.max(0, earned + planned - limit) };
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

// Frivillige arbeidsgivere kan velge å holde seg utenfor varsler om hviletid og ukegrense.
export function countsForWarnings(s, employers) {
  const emp = employers.find(e => e.id === s.employerId);
  return !(payType(emp) === 'volunteer' && emp.pay?.inWarnings === false);
}
export function restWarnings(shifts, employers, minRestH, alsoInclude = null) {
  const list = shifts.filter(s => counted(s) || (alsoInclude && s.id === alsoInclude));
  const w = checkRest(list, minRestH);
  const byId = new Map(list.map(s => [s.id, s]));
  for (const [id, x] of Object.entries(w)) {
    if (x.type === 'rest' && (!countsForWarnings(byId.get(id), employers) || !countsForWarnings(byId.get(x.with), employers))) { delete w[id]; continue; }
    x.sameEmployer = byId.get(id)?.employerId === byId.get(x.with)?.employerId;
  }
  return w;
}

// Samlet arbeidstid per ISO-uke på tvers av arbeidsgivere. Returnerer uker over grensen.
export function weeklyOverLimit(shifts, employers, limitH = DEFAULT_SETTINGS.weekLimitH) {
  const byWeek = {};
  for (const s of shifts) {
    if (!countsForWarnings(s, employers) || isOffered(s)) continue;
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
  if (hasFixedFee(s) && !(Number(s.fee) >= 0 && Number(s.fee) <= 1000000)) errors.push('Beløpet må være mellom 0 og 1 000 000 kr.');
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
  if (payType(e) === 'hourly' && (!Number.isFinite(r) || r < 0 || r > 10000)) errors.push('Timelønn må være mellom 0 og 10 000 kr.');
  const t = e.pay?.tax;
  if (t?.mode === 'pct' && !(Number(t.pct) >= 0 && Number(t.pct) <= 60)) errors.push('Prosenttrekket må være mellom 0 og 60 %. Du finner det på skattekortet.');
  if (t?.mode === 'table' && !(Number(t.slipGross) > 0 && Number(t.slipTax) >= 0 && Number(t.slipTax) < Number(t.slipGross))) errors.push('Skriv inn brutto lønn og skattetrekk fra en lønnsslipp. Trekket må være mindre enn brutto.');
  if (payType(e) === 'fee' && e.pay.feeDefault != null && e.pay.feeDefault !== '' && !(Number(e.pay.feeDefault) >= 0 && Number(e.pay.feeDefault) <= 1000000)) errors.push('Standardhonoraret må være mellom 0 og 1 000 000 kr.');
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

// ---------- Gjentakende vakter (serier) ----------
// Regel: { freq: 'day' | 'week', interval: n, days: [0..6] (for uker), end: { type: 'never' | 'until' | 'count', until, count } }
// Første forekomst er startdatoen (for uker: første valgte ukedag fra og med startdatoen).

export const SERIES_HORIZON_DAYS = 366; // «slutter aldri» lages ett år frem og fylles på løpende

export function seriesDates(rule, start, from = start, to = null, max = 1000) {
  const out = [];
  const s0 = parseDate(start);
  const last = rule.end?.type === 'until' && rule.end.until ? rule.end.until : null;
  const stop = [to, last].filter(Boolean).sort()[0] || null;
  const maxCount = rule.end?.type === 'count' ? Math.max(1, Number(rule.end.count) || 1) : Infinity;
  const interval = Math.max(1, Number(rule.interval) || 1);
  let n = 0;
  const take = d => {
    const iso = isoDate(d);
    if (stop && iso > stop) return false;
    n++;
    if (iso >= from) out.push(iso);
    return n < maxCount && out.length < max;
  };
  if (rule.freq === 'day') {
    for (let i = 0; i < 20000; i++) if (!take(new Date(s0.getFullYear(), s0.getMonth(), s0.getDate() + i * interval))) break;
  } else {
    const days = [...new Set(rule.days && rule.days.length ? rule.days : [s0.getDay()])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const mon = mondayOf(s0);
    outer: for (let w = 0; w < 5000; w++) {
      for (const d of days) {
        const dt = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + w * 7 * interval + ((d + 6) % 7));
        if (dt < s0) continue;
        if (!take(dt)) break outer;
      }
    }
  }
  return out;
}

const DAYS_FULL = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const joinNo = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} og ${a.at(-1)}`;

export function describeRepeat(rule) {
  if (!rule) return '';
  const n = Math.max(1, Number(rule.interval) || 1);
  let base;
  if (rule.freq === 'day') base = n === 1 ? 'Hver dag' : `Hver ${n}. dag`;
  else {
    const days = [...(rule.days || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const isWeekdays = n === 1 && days.join() === '1,2,3,4,5';
    const every = n === 1 ? 'Hver uke' : n === 2 ? 'Annenhver uke' : `Hver ${n}. uke`;
    base = isWeekdays ? 'Hver ukedag (mandag–fredag)' : `${every} på ${joinNo(days.map(d => DAYS_FULL[d]))}`;
  }
  const e = rule.end || { type: 'never' };
  const end = e.type === 'until' && e.until ? `, til og med ${Number(e.until.slice(8))}.${Number(e.until.slice(5, 7))}.${e.until.slice(0, 4)}`
    : e.type === 'count' ? `, ${e.count} ${Number(e.count) === 1 ? 'gang' : 'ganger'}` : ', slutter aldri';
  return base + end;
}

export function validateRepeat(rule, start) {
  const errors = [];
  const n = Number(rule.interval);
  if (!Number.isInteger(n) || n < 1 || n > 52) errors.push('Gjentakelsen må være hver 1. til hver 52. dag eller uke.');
  if (rule.freq === 'week' && !(rule.days || []).length) errors.push('Velg minst én ukedag vakta skal gjentas på.');
  const e = rule.end || {};
  if (e.type === 'until' && (!e.until || e.until < start)) errors.push('Sluttdatoen må være samme dag som vakta eller senere.');
  if (e.type === 'until' && e.until && parseDate(e.until) - parseDate(start) > 3 * 366 * 86400000) errors.push('Sluttdatoen kan være maks tre år frem. Velg «Aldri» for faste vakter uten slutt.');
  if (e.type === 'count' && !(Number(e.count) >= 1 && Number(e.count) <= 400)) errors.push('Antall ganger må være mellom 1 og 400.');
  return errors;
}

// ---------- Oppsummering og eksport ----------

export function shiftsInMonth(shifts, ym, { includeOffered = false } = {}) {
  return shifts.filter(s => s.date.startsWith(ym) && (includeOffered || counted(s)))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export function monthSummary(shifts, employers, ym, settings = DEFAULT_SETTINGS) {
  const byEmp = {};
  const total = { hours: 0, supplementPay: 0, overtimePay: 0, pay: 0, count: 0, holidayBase: 0,
    byKind: { hourly: { hours: 0, pay: 0, count: 0 }, fee: { hours: 0, pay: 0, count: 0 }, volunteer: { hours: 0, pay: 0, count: 0 } } };
  const all = calcAllNet(shifts, employers, settings);
  total.net = 0;
  for (const kk of Object.values(total.byKind)) kk.net = 0;
  for (const s of shiftsInMonth(shifts, ym)) {
    const c = all.get(s.id);
    const emp = employers.find(e => e.id === s.employerId);
    const o = byEmp[s.employerId] ||= { hours: 0, supplementPay: 0, overtimePay: 0, pay: 0, net: 0, count: 0, supplements: {}, kind: payType(emp) };
    o.net += c.net; total.net += c.net;
    total.holidayBase += c.holidayBase || 0;
    const k = total.byKind[c.fixed && payType(emp) === 'hourly' ? 'fee' : payType(emp)];
    k.hours += c.hours; k.pay += c.pay; k.net += c.net; k.count++;
    const sup = c.supplements.reduce((a, x) => a + x.amount, 0);
    for (const t of [o, total]) {
      t.hours += c.hours; t.supplementPay += sup; t.overtimePay += c.overtimePay; t.pay += c.pay; t.count++;
    }
    for (const x of c.supplements) {
      const k = o.supplements[x.id] ||= { label: x.label, hours: 0, amount: 0 };
      k.hours += x.hours; k.amount += x.amount;
    }
  }
  total.holidayPay = total.holidayBase * (Number(settings.holidayPayPct) || 0) / 100;
  return { byEmp, total };
}

// Hele året: per måned, per arbeidsgiver og totalt. Regner alle vakter én gang.
export function yearSummary(shifts, employers, year, settings = DEFAULT_SETTINGS) {
  const all = calcAllNet(shifts, employers, settings);
  const months = Array.from({ length: 12 }, (_, i) => ({ ym: `${year}-${pad(i + 1)}`, hours: 0, pay: 0, net: 0, count: 0, byEmp: {} }));
  const byEmp = {};
  const total = { hours: 0, pay: 0, net: 0, count: 0, holidayBase: 0 };
  for (const s of shifts) {
    if (!s.date.startsWith(`${year}-`) || isOffered(s)) continue;
    const c = all.get(s.id), m = months[Number(s.date.slice(5, 7)) - 1];
    total.holidayBase += c.holidayBase || 0;
    const e = byEmp[s.employerId] ||= { hours: 0, pay: 0, net: 0, count: 0 };
    for (const t of [m, e, total]) { t.hours += c.hours; t.pay += c.pay; t.net += c.net; t.count++; }
    const me = m.byEmp[s.employerId] ||= { pay: 0, net: 0, hours: 0 };
    me.pay += c.pay; me.net += c.net; me.hours += c.hours;
  }
  total.holidayPay = total.holidayBase * (Number(settings.holidayPayPct) || 0) / 100;
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

// Velg vakter til eksport: periode ('month' + ym, 'future', 'all' eller 'range' + from/to) og arbeidsgiver ('all' eller id).
// Tilbudte vakter er aldri med.
export function selectForExport(shifts, { period = 'all', ym, from, to, employerId = 'all', today = isoDate(new Date()) } = {}) {
  return shifts.filter(s => counted(s)
    && (employerId === 'all' || s.employerId === employerId)
    && (period === 'all'
      || (period === 'month' && s.date.startsWith(ym))
      || (period === 'future' && s.date >= today)
      || (period === 'range' && (!from || s.date >= from) && (!to || s.date <= to))))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

// Regneark for en måned (ym) eller en ferdig utvalgt liste med vakter. Lønn regnes med alle vaktene,
// så ukeovertid blir riktig selv om bare noen av dem eksporteres.
export function toCSV(shifts, employers, ymOrList) {
  const rows = [['Dato', 'Arbeidsgiver', 'Start', 'Slutt', 'Pause (min)', 'Timer', 'Tillegg (kr)', 'Overtid (t)', 'Estimert lønn (kr)', 'Notat']];
  const all = calcAll(shifts, employers);
  const list = Array.isArray(ymOrList) ? ymOrList : shiftsInMonth(shifts, ymOrList);
  for (const s of list) {
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

// ---------- Import fra kalender (.ics) ----------
// Leser hendelser fra en kalenderfil eller -lenke (iPhone/iCloud, Google, Outlook, vaktplansystemer).
// Tider med Z tolkes som UTC, tider med TZID eller uten sone som lokal tid (norsk tid i praksis).

function icsDateValue(value, params) {
  if (/VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(value)) return { allDay: true };
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = '0', z] = m;
  const date = z ? new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +sec)) : new Date(+y, mo - 1, +d, +h, +mi, +sec);
  return { date };
}
const icsUnescape = t => t.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

export function parseICS(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  if (!lines.some(l => l.trim() === 'BEGIN:VCALENDAR')) throw new Error('not-ics');
  const raw = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (ev) raw.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const head = line.slice(0, i), value = line.slice(i + 1).trim();
    const [name, ...params] = head.split(';');
    const key = name.toUpperCase(), par = params.join(';');
    if (key === 'DTSTART' || key === 'DTEND' || key === 'RECURRENCE-ID') ev[key] = icsDateValue(value, par);
    else if (key === 'EXDATE') for (const v of value.split(',')) { const d = icsDateValue(v.trim(), par); if (d && d.date) ev.exdates.push(d.date.getTime()); }
    else if (key === 'SUMMARY') ev.summary = icsUnescape(value);
    else if (key === 'UID') ev.uid = value;
    else if (key === 'RRULE') ev.rrule = value;
    else if (key === 'STATUS') ev.cancelled = /CANCELLED/i.test(value);
  }
  return raw.map(e => ({
    uid: e.uid || '', summary: e.summary || '', rrule: e.rrule || '', exdates: e.exdates,
    recurrenceId: e['RECURRENCE-ID'] && e['RECURRENCE-ID'].date ? e['RECURRENCE-ID'].date.getTime() : null,
    cancelled: !!e.cancelled, allDay: !!(e.DTSTART && e.DTSTART.allDay),
    start: e.DTSTART && e.DTSTART.date || null, end: e.DTEND && e.DTEND.date || null,
  }));
}

// Gjør gjentakende hendelser (RRULE) om til enkeltforekomster innenfor perioden.
// Støtter FREQ=DAILY og WEEKLY med INTERVAL, BYDAY, COUNT, UNTIL og EXDATE, og endrede enkeltforekomster
// (RECURRENCE-ID). Andre regler markeres som ikke støttet.
const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
export function expandEvents(events, from, to) {
  const out = [];
  const overrides = new Set(events.filter(e => e.recurrenceId).map(e => `${e.uid}|${e.recurrenceId}`));
  const fromT = from ? parseDate(from).getTime() : -Infinity;
  const toT = to ? parseDate(to).getTime() + 86400000 : Infinity;
  for (const e of events) {
    if (!e.rrule || e.recurrenceId || e.allDay || !e.start || !e.end) { out.push(e); continue; }
    const r = Object.fromEntries(e.rrule.split(';').map(p => p.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
    if (!['DAILY', 'WEEKLY'].includes(r.FREQ)) { out.push({ ...e, unsupported: true }); continue; }
    const interval = Math.max(1, Number(r.INTERVAL) || 1);
    const count = r.COUNT ? Number(r.COUNT) : Infinity;
    const until = r.UNTIL ? (icsDateValue(r.UNTIL, '').date || (/^\d{8}$/.test(r.UNTIL) ? new Date(+r.UNTIL.slice(0, 4), r.UNTIL.slice(4, 6) - 1, +r.UNTIL.slice(6), 23, 59) : null)) : null;
    const days = r.FREQ === 'WEEKLY' && r.BYDAY ? r.BYDAY.split(',').map(d => BYDAY[d.slice(-2)]).filter(d => d !== undefined) : [e.start.getDay()];
    const dur = e.end - e.start, exd = new Set(e.exdates || []);
    const h = e.start.getHours(), mi = e.start.getMinutes();
    let n = 0;
    const weekStart = mondayOf(e.start);
    for (let step = 0; step < 3000 && n < count; step++) {
      const candidates = r.FREQ === 'DAILY'
        ? [new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate() + step * interval, h, mi)]
        : days.map(d => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + step * 7 * interval + ((d + 6) % 7), h, mi))
          .sort((a, b) => a - b);
      let past = false;
      for (const st of candidates) {
        if (st < e.start) continue;
        if ((until && st > until) || st.getTime() >= toT) { past = true; break; }
        if (n >= count) break;
        n++;
        const t = st.getTime();
        if (exd.has(t) || overrides.has(`${e.uid}|${t}`) || t < fromT) continue;
        out.push({ ...e, rrule: '', start: st, end: new Date(t + dur), fromRule: true });
      }
      if (past) break;
    }
  }
  return out;
}

export const shiftKey = s => `${s.employerId}|${s.date}|${s.start}|${s.end}`;

// Gjør kalenderhendelser om til forslag til vakter. employerFor(summary) returnerer arbeidsgiver-id eller null.
// Returnerer kandidater (med tittel, så brukeren kan velge) og hvorfor resten hoppes over.
export function icsToShifts(events, { employerFor, from, to, contains = '', existing = [], newId, breakMin = 0 }) {
  const skipped = { allDay: 0, unsupported: 0, cancelled: 0, invalid: 0, outside: 0, filtered: 0, noEmployer: 0, duplicate: 0 };
  const seen = new Set(existing.map(shiftKey));
  const shifts = [];
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  for (const e of expandEvents(events, from, to)) {
    if (e.cancelled) { skipped.cancelled++; continue; }
    if (e.allDay) { skipped.allDay++; continue; }
    if (e.unsupported) { skipped.unsupported++; continue; }
    if (!e.start || !e.end || e.end <= e.start || e.end - e.start > 24 * HOUR) { skipped.invalid++; continue; }
    const date = isoDate(e.start);
    if ((from && date < from) || (to && date > to)) { skipped.outside++; continue; }
    if (contains && !e.summary.toLowerCase().includes(contains.toLowerCase())) { skipped.filtered++; continue; }
    const employerId = employerFor(e.summary);
    if (!employerId) { skipped.noEmployer++; continue; }
    const brk = Math.min(Number(breakMin) || 0, Math.max(0, (e.end - e.start) / MIN - 1));
    const s = { id: newId(), employerId, date, start: hhmm(e.start), end: hhmm(e.end), breakMin: brk, note: '', title: e.summary };
    if (seen.has(shiftKey(s))) { skipped.duplicate++; continue; }
    seen.add(shiftKey(s));
    shifts.push(s);
  }
  shifts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { shifts, skipped };
}

// ---------- Import fra regneark (CSV) ----------
// Godtar Vaktboks egen eksport og vanlige timelister: ; eller , som skilletegn, datoer som
// 2026-10-27, 27.10.2026, 27.10.26 eller 27/10/2026, og klokkeslett som 08:00, 8:00 eller 08.00.

export function parseCSV(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(x => x.trim().replace(/^'(?=[=+\-@])/, ''))).filter(r => r.some(x => x));
}

export function normDate(v) {
  v = String(v || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(v);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  return null;
}
export function normTime(v) {
  const m = /^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?$/.exec(String(v || '').trim());
  if (!m || +m[1] > 24 || +m[2] > 59) return null;
  return `${pad(+m[1] % 24)}:${m[2]}`;
}

// Gjetter hvilke kolonner som er hva ut fra overskriftene.
// ---------- Finn vakter i innlimt tekst (SMS, e-post, vaktliste) ----------
// Kjører lokalt i appen: ingenting sendes noe sted. Forstår vanlige norske formater, for eksempel
// «12/11 22–07.30», «tirsdag 14.00–22.00», «12. nov kl 15-23», «2026-11-12 0800-1600» og «i morgen 16-22».
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, des: 12 };
const WEEKDAYS = { søn: 0, man: 1, tir: 2, ons: 3, tor: 4, fre: 5, lør: 6 };
const TIME_RANGE = /(?:\bkl\.?\s*)?\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|til)\s*(?:kl\.?\s*)?(\d{1,2})(?:[:.](\d{2}))?\b|\b(\d{2})(\d{2})\s*(?:-|–|—)\s*(\d{2})(\d{2})\b/gi;

function okTime(h, m) { return h >= 0 && h <= 24 && m >= 0 && m < 60 && m % 5 === 0 && !(h === 24 && m > 0); }
const hhmm = (h, m) => `${pad(h === 24 ? 0 : h)}:${pad(m)}`;

export function parseShiftText(text, { today = new Date(), employers = [] } = {}) {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const names = employers.filter(Boolean).map(n => ({ n, re: new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu') }));
  const findEmp = line => names.find(x => x.re.test(line))?.n || null;
  const wholeEmp = (() => { const hits = names.filter(x => x.re.test(text)); return hits.length === 1 ? hits[0].n : null; })();
  // Uten årstall: datoen i år, eller neste år hvis den er mer enn to måneder tilbake i tid.
  const withYear = (d, m, y) => {
    if (y) return new Date(y < 100 ? 2000 + y : y, m - 1, d);
    let dt = new Date(t0.getFullYear(), m - 1, d);
    if (dt < addDaysLocal(t0, -60)) dt = new Date(t0.getFullYear() + 1, m - 1, d);
    return dt;
  };
  const shifts = [];
  let lastDate = null;
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    // Datoer på formen 2026-11-12 tas ut først, ellers ser «11-12» ut som et tidsrom.
    let iso = null;
    line = line.replace(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/, (all, y, mo, d) => { iso = new Date(+y, +mo - 1, +d); return ' '; });
    // Så klokkeslett, så tall som 14.00 ikke tolkes som dato.
    const times = [];
    line = line.replace(TIME_RANGE, (all, h1, m1, h2, m2, a1, b1, a2, b2) => {
      const [sh, sm, eh, em] = h1 != null ? [+h1, +(m1 || 0), +h2, +(m2 || 0)] : [+a1, +b1, +a2, +b2];
      if (!okTime(sh, sm) || !okTime(eh, em) || (sh === eh && sm === em)) return all;
      times.push([hhmm(sh, sm), hhmm(eh, em)]);
      return ' ';
    });
    // Dato
    let date = null;
    let m;
    if (iso) date = iso;
    else if ((m = line.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/)) && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) date = withYear(+m[1], +m[2], m[3] ? +m[3] : null);
    else if ((m = lower.match(/\b(\d{1,2})\.?\s*(jan|feb|mar|apr|mai|jun|jul|aug|sep|okt|nov|des)[a-zæøå]*\.?(?:\s+(20\d{2}))?/))) date = withYear(+m[1], MONTHS[m[2]], m[3] ? +m[3] : null);
    else if (/\bi\s*morgen\b/.test(lower)) date = addDaysLocal(t0, 1);
    else if (/\bi\s*dag\b/.test(lower)) date = t0;
    else if ((m = lower.match(/\b(man|tir|ons|tor|fre|lør|søn)(?:dag|sdag)?\b/))) { const want = WEEKDAYS[m[1]]; date = addDaysLocal(t0, (want - t0.getDay() + 7) % 7); }
    if (date && !isNaN(date)) lastDate = date;
    if (!times.length) continue;
    const use = date || lastDate; // klokkeslett på linja under en dato
    if (!use) continue;
    const employer = findEmp(raw) || wholeEmp;
    for (const [start, end] of times) shifts.push({ date: isoDate(use), start, end, employer, note: '' });
  }
  const seen = new Set();
  const uniq = shifts.filter(x => { const k = `${x.date}|${x.start}|${x.end}|${x.employer}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { shifts: uniq, comment: uniq.length ? '' : 'Fant ingen vakter. Teksten må ha en dato (for eksempel 12/11, 12. nov eller tirsdag) og et tidsrom (for eksempel 22–07.30).' };
}
function addDaysLocal(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Gjør funnene om til rader i samme format som et regneark, så de går gjennom samme kontroll og forhåndsvisning.
export const TEXT_HEADER = ['Dato', 'Start', 'Slutt', 'Pause', 'Arbeidsgiver', 'Notat'];
export function textToRows(res) {
  return [TEXT_HEADER, ...(res?.shifts || []).map(x => [x.date, x.start, x.end, '', x.employer || '', x.note || ''])];
}

export function guessColumns(header) {
  const find = re => header.findIndex(h => re.test(h.toLowerCase()));
  return {
    date: find(/^(dato|date|dag)/), start: find(/^(start|fra|from|begin|inn)/), end: find(/^(slutt|til|to\b|end|ut)/),
    breakMin: find(/^(pause|break)/), employer: find(/^(arbeidsgiver|employer|firma|jobb|sted|kunde)/), note: find(/^(notat|note|kommentar|merknad)/),
  };
}

// Rader blir vakter. employerFor(navn) returnerer id, eller null (da brukes standard-arbeidsgiveren).
export function csvToShifts(rows, cols, { employerFor, defaultEmployerId, existing = [], newId, breakMin = 0 }) {
  const skipped = { invalid: 0, noEmployer: 0, duplicate: 0 };
  const seen = new Set(existing.map(shiftKey));
  const shifts = [];
  for (const r of rows) {
    const date = normDate(r[cols.date]), start = normTime(r[cols.start]), end = normTime(r[cols.end]);
    if (!date || !start || !end) { skipped.invalid++; continue; }
    const name = cols.employer >= 0 ? (r[cols.employer] || '').trim() : '';
    const employerId = (name && employerFor(name)) || defaultEmployerId;
    if (!employerId) { skipped.noEmployer++; continue; }
    const b = cols.breakMin >= 0 && r[cols.breakMin] !== '' ? Number(String(r[cols.breakMin]).replace(',', '.')) : Number(breakMin);
    const s = { id: newId(), employerId, date, start, end, breakMin: Number.isFinite(b) && b >= 0 ? Math.round(b) : 0,
      note: cols.note >= 0 ? String(r[cols.note] || '').slice(0, 200) : '', title: name };
    if (seen.has(shiftKey(s))) { skipped.duplicate++; continue; }
    seen.add(shiftKey(s));
    shifts.push(s);
  }
  shifts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { shifts, skipped };
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
