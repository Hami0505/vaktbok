// Vaktbok – brukergrensesnitt.
import { config } from './config.js';
import * as L from './logic.js';
import { Store, newId } from './store.js';
import { makeDemo } from './demo.js';
import { setupImporter } from './importer.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const krFmt = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });
const kr = n => `${krFmt.format(Math.round(n))} kr`;
const num = (n, d = 1) => Number(n).toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d });
const hrs = n => `${num(n)} t`;
const DAY = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
const DAY_LONG = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MONTH = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const CHIPS = [[1, 'M'], [2, 'T'], [3, 'O'], [4, 'T'], [5, 'F'], [6, 'L'], [0, 'S']];
const V1_KEY = 'vaktbok-v1', V1_DONE = 'vaktbok:v1-handled';

const ym = d => `${d.getFullYear()}-${L.pad(d.getMonth() + 1)}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const safeColor = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#1F6F6B';
const fgFor = hex => {
  const n = parseInt(safeColor(hex).slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#17252E' : '#FFFFFF';
};
const fmtDay = str => { const d = L.parseDate(str); return `${DAY[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };

const store = new Store(config);

// Brutto eller netto i visningene. Netto krever at skattetrekk er lagt inn.
const taxPct = () => Number(D().settings.taxPct) || 0;
const showNet = () => D().settings.showNet === true && taxPct() > 0;
const shown = gross => showNet() ? gross * (1 - taxPct() / 100) : gross;
const payWord = () => showNet() ? `ca. netto (${num(taxPct(), 1)} % skatt)` : 'estimert brutto';

// Gjør tekniske feilmeldinger (ofte på engelsk fra serveren) om til noe brukeren forstår.
function friendlyError(e) {
  const m = String(e?.message || e || '');
  if (e instanceof TypeError || /fetch|network|load failed|offline/i.test(m)) return 'Får ikke kontakt med serveren. Sjekk at du er på nett, og prøv igjen.';
  if (/rate limit|too many|seconds/i.test(m)) return 'Du har prøvd mange ganger på kort tid. Vent et minutt og prøv igjen.';
  if (/expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(m)) return 'Koden er feil eller har utløpt. Be om en ny kode og bruk den nyeste e-posten.';
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(m)) return 'E-postadressen ser ikke riktig ut. Sjekk at den er skrevet riktig.';
  if (/jwt|not authenticated|ikke innlogget/i.test(m)) return 'Innloggingen har gått ut. Logg inn på nytt.';
  if (/permission denied|row-level security|42501/i.test(m)) return 'Serveren nektet tilgang. Logg ut og inn igjen. Vedvarer det, ta kontakt.';
  return `Serveren svarte med en feil (${m.slice(0, 80)}). Prøv igjen litt senere.`;
}
const ui = { tab: 'uke', weekStart: L.mondayOf(new Date()), month: ym(new Date()), shift: null, emp: null, rules: [], codeSentTo: '', updateReg: null };

const D = () => store.data;
const empById = id => D().employers.find(e => e.id === id);

// ---------- Små hjelpere ----------

function toast(msg, undo = null) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('has-action', !!undo);
  if (undo) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Angre' });
    b.addEventListener('click', () => { undo(); t.classList.remove('show', 'has-action'); clearTimeout(t._h); });
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show', 'has-action'), undo ? 7000 : 2600);
}

function confirmBox(title, text, okLabel, danger = false) {
  return new Promise(resolve => {
    const d = $('confirmDialog');
    $('confirmTitle').textContent = title; $('confirmText').textContent = text;
    const ok = $('confirmOk'); ok.textContent = okLabel; ok.className = `btn ${danger ? 'danger' : 'primary'}`;
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function describeRule(r) {
  const val = r.kind === 'pct' ? `${num(r.value, 0)} %` : `${num(r.value, 0)} kr/t`;
  const time = r.from === r.to ? 'hele døgnet' : `${r.from}–${r.to}`;
  let days;
  const ds = [...(r.days || [])].sort().join('');
  if (r.holiday) days = 'helligdager';
  else if (ds === '0123456') days = 'alle dager';
  else if (ds === '12345') days = 'man–fre';
  else if (ds === '06') days = 'lør–søn';
  else days = CHIPS.filter(([d]) => r.days.includes(d)).map(([d]) => DAY[d]).join(', ');
  return `${r.label || 'Tillegg'} ${val}, ${days} ${time}`;
}

function warningText(w) {
  const other = D().shifts.find(s => s.id === w.with);
  const emp = other && empById(other.employerId);
  const where = other ? `${emp ? emp.name : 'en vakt'} ${fmtDay(other.date)} ${other.start}–${other.end}` : 'en annen vakt';
  if (w.type === 'overlap') return `Overlapper med ${where}.`;
  if (w.gap < 0.05) return `Starter rett etter ${where}, uten hvile. Arbeidsmiljøloven krever normalt minst ${num(D().settings.minRestH, 0)} timer.`;
  return `Bare ${num(w.gap)} timer hvile etter ${where}. Arbeidsmiljøloven krever normalt minst ${num(D().settings.minRestH, 0)} timer.`;
}

// ---------- Faner ----------

function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tabs [role="tab"]').forEach(b => {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  for (const t of ['uke', 'oversikt', 'arbeidsgivere', 'konto']) $(`v-${t}`).hidden = t !== tab;
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  render();
}

// ---------- Synkstatus og bannere ----------

function renderSync() {
  const p = $('syncPill'), n = store.pending;
  const text = {
    local: 'Lagres på denne enheten',
    guest: 'Ikke logget inn',
    syncing: 'Synker …',
    synced: 'Synkronisert',
    offline: n ? `Frakoblet, ${n} ${n === 1 ? 'endring venter' : 'endringer venter'}` : 'Frakoblet',
    error: 'Synk feilet, prøver igjen',
  }[store.status];
  p.dataset.state = store.status;
  $('syncText').textContent = text;
  p.title = store.lastError || text;
}

function renderBanners() {
  const out = [];
  let v1 = null;
  try { v1 = !localStorage.getItem(V1_DONE) && JSON.parse(localStorage.getItem(V1_KEY) || 'null'); } catch { }
  if (v1 && (v1.shifts?.length || v1.employers?.length)) {
    out.push(`<div class="banner"><p>Fant ${v1.shifts?.length || 0} vakter fra prototypen av Vaktbok på denne enheten.</p>
      <button class="btn primary" data-action="import-v1">Importer</button><button class="btn link" data-action="dismiss-v1">Ikke nå</button></div>`);
  }
  if (ui.updateReg) out.push(`<div class="banner"><p>En ny versjon av Vaktbok er klar.</p><button class="btn primary" data-action="update-app">Oppdater</button></div>`);
  $('banners').innerHTML = out.join('');
}

// ---------- Uke ----------

function segment(s, day) {
  const { start, end } = L.parseShift(s);
  const d0 = day.getTime(), d1 = addDays(day, 1).getTime();
  const a = Math.max(start, d0), b = Math.min(end, d1);
  if (b <= a) return null;
  return { left: (a - d0) / (d1 - d0) * 100, width: (b - a) / (d1 - d0) * 100 };
}

function renderWeek() {
  const ws = ui.weekStart, we = addDays(ws, 6), today = L.isoDate(new Date());
  const { week } = L.isoWeek(ws);
  const range = ws.getMonth() === we.getMonth()
    ? `${ws.getDate()}.–${we.getDate()}. ${MONTH[we.getMonth()]}`
    : `${ws.getDate()}. ${MONTH[ws.getMonth()]} – ${we.getDate()}. ${MONTH[we.getMonth()]}`;
  $('weekTitle').innerHTML = `Uke ${week}<span class="range">${esc(range)}</span>`;
  $('todayBtn').hidden = L.isoDate(L.mondayOf(new Date())) === L.isoDate(ws);

  const warns = L.checkRest(D().shifts, D().settings.minRestH);
  ui.calc = L.calcAll(D().shifts, D().employers);
  const from = L.isoDate(addDays(ws, -1)), to = L.isoDate(we);
  const near = D().shifts.filter(s => s.date >= from && s.date <= to);
  let html = '';
  for (let i = 0; i < 7; i++) {
    const day = addDays(ws, i), ds = L.isoDate(day), hol = L.holidayName(ds);
    const bars = near.map(s => {
      const seg = segment(s, day); if (!seg) return '';
      const emp = empById(s.employerId), c = safeColor(emp?.color), name = emp ? emp.name : '?';
      return `<button class="bar${warns[s.id] ? ' warn' : ''}" data-action="edit-shift" data-id="${s.id}"
        style="left:${seg.left}%;width:${seg.width}%;background:${c};color:${fgFor(c)}"
        aria-label="${esc(name)}, ${DAY_LONG[day.getDay()]} ${s.start}–${s.end}${warns[s.id] ? ', har varsel' : ''}">${seg.width > 14 ? esc(name) : ''}</button>`;
    }).join('');
    html += `<div class="d${ds === today ? ' today' : ''}${hol ? ' holiday' : ''}">${DAY[day.getDay()]} ${day.getDate()}.<small>${esc(hol || MONTH[day.getMonth()].slice(0, 3))}</small></div>
      <div class="track">${bars}</div>`;
  }
  html += '<div></div><div class="ticks" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>';
  $('week').innerHTML = html;

  const inWeek = D().shifts.filter(s => s.date >= L.isoDate(ws) && s.date <= to)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  let h = 0, pay = 0;
  for (const s of inWeek) { const c = ui.calc.get(s.id); h += c.hours; pay += c.pay; }
  $('weekSum').innerHTML = inWeek.length ? `<b>${hrs(h)}</b> og <b>${kr(shown(pay))}</b> ${payWord()} denne uka` : '';

  if (!D().employers.length) {
    $('weekList').innerHTML = `<div class="empty"><p>Legg inn arbeidsgiverne dine først, med timelønn og tillegg.</p>
      <button class="btn primary" data-action="new-emp">Legg til arbeidsgiver</button></div>`;
    return;
  }
  const over = L.weeklyOverLimit(D().shifts, D().employers, D().settings.weekLimitH)
    .find(x => x.week === `${L.isoWeek(ws).year}-U${L.pad(week)}`);
  $('weekList').innerHTML = (over ? `<div class="flag weekly">Du har ${hrs(over.hours)} denne uka, over grensen på ${num(D().settings.weekLimitH, 0)} timer.</div>` : '')
    + (inWeek.length ? inWeek.map(s => shiftItem(s, warns[s.id], true)).join('') : '<div class="empty"><p>Ingen vakter denne uka.</p></div>');
}

function shiftItem(s, warn, actions) {
  const emp = empById(s.employerId), c = ui.calc?.get(s.id) || L.calcShift(s, emp);
  return `<div class="item">
    <button class="open" data-action="edit-shift" data-id="${s.id}" aria-label="Endre vakt ${esc(emp?.name)} ${fmtDay(s.date)}">
      <span class="who"><span class="dot" style="background:${safeColor(emp?.color)}"></span>${esc(emp ? emp.name : 'Ukjent')}</span>
      <span class="num">${hrs(c.hours)}</span>
      <span class="meta">${fmtDay(s.date)} ${s.start}–${s.end}${s.breakMin ? `, pause ${s.breakMin} min` : ''}${s.note ? `, ${esc(s.note)}` : ''}</span>
      <span class="meta num">${kr(shown(c.pay))}${c.overtimeH > 0 ? `, ${hrs(c.overtimeH)} overtid` : ''}</span>
    </button>
    ${warn ? `<div class="flag ${warn.type}">${esc(warningText(warn))}</div>` : ''}
    ${actions ? `<div class="acts"><button class="btn link" data-action="copy-shift" data-id="${s.id}" data-days="1">Kopier til neste dag</button><button class="btn link" data-action="copy-shift" data-id="${s.id}" data-days="7">Kopier til neste uke</button></div>` : ''}
  </div>`;
}

// ---------- Vakt-dialog ----------

function readShiftForm() {
  return {
    id: ui.shift?.id, employerId: $('fEmp').value, date: $('fDate').value, start: $('fStart').value, end: $('fEnd').value,
    breakMin: Number($('fBreak').value || 0), note: $('fNote').value.trim(),
  };
}

function openShift(s = null) {
  const emps = D().employers.filter(e => !e.archived || (s && e.id === s.employerId));
  if (!emps.length) { toast('Du trenger minst én arbeidsgiver før du kan legge inn vakter. Legg til den første her.'); openEmp(); return; }
  ui.shift = s;
  $('shiftDialogTitle').textContent = s ? 'Endre vakt' : 'Ny vakt';
  $('fEmp').innerHTML = emps.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  $('deleteShiftBtn').hidden = !s;
  if (s) {
    setFields({ emp: s.employerId, date: s.date, start: s.start, end: s.end, brk: s.breakMin, note: s.note });
  } else {
    const empId = emps[0].id, last = lastShiftFor(empId);
    const today = new Date(), inView = today >= ui.weekStart && today < addDays(ui.weekStart, 7);
    setFields({
      emp: empId, date: L.isoDate(inView ? today : ui.weekStart),
      start: last?.start || '08:00', end: last?.end || '16:00', brk: last?.breakMin ?? 0, note: '',
    });
  }
  $('repeatFields').hidden = !!s; // gjentakelse bare for nye vakter
  $('fRepeat').value = '0';
  $('repeatUntilLabel').hidden = true;
  $('fRepeatUntil').value = L.isoDate(addDays(L.parseDate($('fDate').value), 28));
  $('shiftErrors').innerHTML = '';
  updatePreview();
  $('shiftDialog').showModal();
}

function setFields(v) {
  const map = { emp: 'fEmp', date: 'fDate', start: 'fStart', end: 'fEnd', brk: 'fBreak', note: 'fNote' };
  for (const [k, val] of Object.entries(v)) $(map[k]).value = val ?? '';
}

function lastShiftFor(empId) {
  return D().shifts.filter(s => s.employerId === empId).sort((a, b) => b.date.localeCompare(a.date))[0];
}

function updatePreview() {
  const s = readShiftForm();
  const errs = L.validateShift(s, D().employers);
  if (errs.length) { $('preview').innerHTML = ''; return; }
  const tmpId = s.id || '__ny__';
  const others = D().shifts.filter(x => x.id !== s.id);
  const c = L.calcAll([...others, { ...s, id: tmpId }], D().employers).get(tmpId);
  const lines = [`<b>${hrs(c.hours)}</b>, estimert <b>${kr(c.pay)}</b>`];
  for (const x of c.supplements) if (x.hours > 0) lines.push(`${esc(x.label)}: ${hrs(x.hours)}, ${kr(x.amount)}`);
  if (c.overtimeH > 0) lines.push(`Overtid: ${hrs(c.overtimeH)}, ${kr(c.overtimePay)}${c.weekOvertimeH ? ` (${hrs(c.weekOvertimeH)} fordi uka passerer grensen)` : ''}`);
  const hol = L.holidayName(s.date); if (hol) lines.push(`${esc(hol)}`);
  const w = L.checkRest([...others, { ...s, id: tmpId }], D().settings.minRestH)[tmpId];
  if (w) lines.push(`<span class="flag block ${w.type}">${esc(warningText(w))}</span>`);
  if (L.noteLooksSensitive(s.note)) lines.push(`<span class="flag block overlap">Notatet inneholder det som ser ut som et fødselsnummer eller D-nummer. Fjern det før du lagrer.</span>`);
  $('preview').innerHTML = lines.join('<br>');
}

function saveShift(e) {
  e.preventDefault();
  const s = readShiftForm();
  const errs = L.validateShift(s, D().employers);
  if (L.noteLooksSensitive(s.note)) errs.push('Notatet inneholder et fødselsnummer eller D-nummer. Slike opplysninger skal ikke lagres i Vaktbok.');
  const step = s.id ? 0 : Number($('fRepeat').value);
  let dates = [s.date];
  if (step) {
    const until = $('fRepeatUntil').value;
    if (!until || until < s.date) errs.push('«Til og med» må være samme dag som vakta eller senere.');
    else if (L.parseDate(until) - L.parseDate(s.date) > 366 * 86400000) errs.push('Gjentakelse kan gå maks ett år frem.');
    else dates = L.repeatDates(s.date, until, step, 60);
  }
  if (errs.length) { $('shiftErrors').innerHTML = errs.map(x => `<li>${esc(x)}</li>`).join(''); return; }
  if (dates.length > 1) {
    store.addAll({ shifts: dates.map(date => ({ ...s, id: newId(), date })) });
    toast(`Lagret ${dates.length} vakter`);
  } else {
    store.upsertShift(s);
    toast(s.id ? 'Vakt oppdatert' : 'Vakt lagret');
  }
  $('shiftDialog').close();
  ui.weekStart = L.mondayOf(L.parseDate(s.date));
  renderWeek();
}

// ---------- Arbeidsgivere ----------

function renderEmployers() {
  const emps = [...D().employers].sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name, 'nb'));
  if (!emps.length) {
    $('empList').innerHTML = `<div class="empty"><p>Ingen arbeidsgivere ennå. Legg til den første med timelønn og tillegg, så regner Vaktbok ut resten.</p></div>`;
    return;
  }
  $('empList').innerHTML = emps.map(e => {
    const n = D().shifts.filter(s => s.employerId === e.id).length;
    const rules = (e.rules || []).map(describeRule);
    if (e.overtime) {
      const lim = [e.overtime.afterH > 0 && `${num(e.overtime.afterH)} t per dag`, e.overtime.weekH > 0 && `${num(e.overtime.weekH)} t per uke`].filter(Boolean).join(' eller ');
      rules.push(`Overtid ${num(e.overtime.pct, 0)} % etter ${lim}`);
    }
    return `<div class="item"><button class="open" data-action="edit-emp" data-id="${e.id}" aria-label="Endre ${esc(e.name)}">
      <span class="who"><span class="dot" style="background:${safeColor(e.color)}"></span>${esc(e.name)}${e.archived ? ' <span class="small muted">(skjult)</span>' : ''}</span>
      <span class="num">${num(e.rate, 0)} kr/t</span>
      <span class="meta">${rules.length ? rules.map(esc).join('<br>') : 'Ingen tillegg'}${!(Number(e.rate) > 0) ? '<br><span class="flag missing">Mangler timelønn, trykk for å legge inn</span>' : ''}</span>
      <span class="meta num">${n} ${n === 1 ? 'vakt' : 'vakter'}</span></button></div>`;
  }).join('');
}

function openEmp(e = null) {
  ui.emp = e;
  $('empDialogTitle').textContent = e ? 'Endre arbeidsgiver' : 'Ny arbeidsgiver';
  $('eName').value = e?.name || '';
  $('eRate').value = e ? e.rate : '';
  $('eColor').value = safeColor(e?.color || ['#1F6F6B', '#7A4FB3', '#B3572C', '#2C6FB3', '#3D8B3D', '#A8326E'][D().employers.length % 6]);
  $('eOtOn').checked = !!e?.overtime;
  $('eOtAfter').value = e ? (e.overtime?.afterH ?? '') : 9;
  $('eOtWeek').value = e ? (e.overtime?.weekH ?? '') : 40;
  if (e?.overtime && !e.overtime.afterH && !e.overtime.weekH) $('eOtAfter').value = 9;
  $('eOtPct').value = e?.overtime?.pct ?? 40;
  const others = D().employers.filter(x => x.id !== e?.id && ((x.rules || []).length || x.overtime));
  $('copyRulesFrom').innerHTML = '<option value="">Kopier tillegg fra …</option>' + others.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  $('copyRulesFrom').hidden = !others.length;
  $('eArchived').checked = !!e?.archived;
  $('deleteEmpBtn').hidden = !e;
  ui.rules = structuredClone(e?.rules || []);
  renderRules(); toggleOt();
  $('empErrors').innerHTML = '';
  $('empDialog').showModal();
}

const newRule = (p = {}) => ({ id: newId(), label: '', kind: 'kr', value: 0, days: [1, 2, 3, 4, 5], from: '17:00', to: '21:00', holiday: false, ...p });

function renderRules() {
  $('ruleList').innerHTML = ui.rules.length ? ui.rules.map((r, i) => `
    <div class="rule" data-i="${i}">
      <label>Navn<input data-f="label" value="${esc(r.label)}" maxlength="30" placeholder="F.eks. Kveld"></label>
      <label>Type<select data-f="kind"><option value="kr"${r.kind === 'kr' ? ' selected' : ''}>kr per time</option><option value="pct"${r.kind === 'pct' ? ' selected' : ''}>% av timelønn</option></select></label>
      <label>Verdi<input type="number" data-f="value" min="0" step="0.01" value="${esc(r.value)}" inputmode="decimal"></label>
      <button class="btn link remove" type="button" data-remove="${i}" aria-label="Fjern ${esc(r.label || 'tillegg')}">Fjern</button>
      <div class="times"><label>Fra<input type="time" data-f="from" value="${esc(r.from)}"></label><label>Til<input type="time" data-f="to" value="${esc(r.to)}"></label></div>
      <div class="days" role="group" aria-label="Gjelder dager">
        ${CHIPS.map(([d, l]) => `<label class="chip"><input type="checkbox" data-day="${d}" aria-label="${DAY_LONG[d]}"${r.days?.includes(d) ? ' checked' : ''}${r.holiday ? ' disabled' : ''}><span>${l}</span></label>`).join('')}
        <label class="chip wide"><input type="checkbox" data-f="holiday"${r.holiday ? ' checked' : ''}><span>Helligdager</span></label>
      </div>
    </div>`).join('') + '<p class="help">Lik fra- og til-tid betyr hele døgnet. Når fra er senere enn til, går tillegget over midnatt.</p>'
    : '<p class="help">Ingen tillegg lagt inn.</p>';
}

function onRuleInput(ev) {
  const row = ev.target.closest('.rule'); if (!row) return;
  const r = ui.rules[Number(row.dataset.i)], t = ev.target;
  if (t.dataset.day) {
    const d = Number(t.dataset.day);
    r.days = t.checked ? [...new Set([...(r.days || []), d])] : (r.days || []).filter(x => x !== d);
  } else if (t.dataset.f === 'holiday') { r.holiday = t.checked; renderRules(); }
  else if (t.dataset.f) r[t.dataset.f] = t.dataset.f === 'value' ? Number(t.value) : t.value;
}

function toggleOt() { $('otFields').hidden = !$('eOtOn').checked; }

function saveEmp(ev) {
  ev.preventDefault();
  const e = {
    id: ui.emp?.id, name: $('eName').value.trim(), rate: Number($('eRate').value), color: safeColor($('eColor').value),
    rules: ui.rules.map(r => ({ ...r, label: (r.label || '').trim() || 'Tillegg' })),
    overtime: $('eOtOn').checked ? {
      afterH: $('eOtAfter').value === '' ? null : Number($('eOtAfter').value),
      weekH: $('eOtWeek').value === '' ? null : Number($('eOtWeek').value),
      pct: Number($('eOtPct').value),
    } : null,
    archived: $('eArchived').checked,
  };
  if ($('eRate').value === '') e.rate = NaN;
  const errs = L.validateEmployer(e);
  if (errs.length) { $('empErrors').innerHTML = errs.map(x => `<li>${esc(x)}</li>`).join(''); return; }
  store.upsertEmployer(e);
  $('empDialog').close();
  toast(ui.emp ? 'Arbeidsgiver oppdatert' : 'Arbeidsgiver lagt til');
}

// ---------- Oversikt: måned og år ----------

function renderMonth() {
  const [y, m] = ui.month.split('-').map(Number);
  $('monthTitle').textContent = `${MONTH[m - 1][0].toUpperCase()}${MONTH[m - 1].slice(1)} ${y}`;
  const { byEmp, total } = L.monthSummary(D().shifts, D().employers, ui.month, D().settings);
  $('totals').innerHTML = `
    <div><b>${hrs(total.hours)}</b><span>${total.count} vakter</span></div>
    <div><b>${kr(shown(total.pay))}</b><span>${payWord()[0].toUpperCase() + payWord().slice(1)}</span></div>
    <div><b>${kr(total.holidayPay)}</b><span>Feriepenger opptjent${showNet() ? ' (brutto)' : ''}</span></div>`;
  renderPaySeg();
  const ids = Object.keys(byEmp);
  if (!ids.length) {
    $('empTable').innerHTML = '<tbody><tr><td class="empty" colspan="6">Ingen vakter denne måneden.</td></tr></tbody>';
  } else {
    $('empTable').innerHTML = `<thead><tr><th>Arbeidsgiver</th><th>Vakter</th><th>Timer</th><th>Tillegg</th><th>Overtid</th><th>${showNet() ? 'Ca. netto' : 'Estimert'}</th></tr></thead><tbody>`
      + ids.map(id => {
        const e = empById(id), o = byEmp[id];
        const subs = Object.values(o.supplements).filter(x => x.hours > 0).map(x => `${esc(x.label)} ${hrs(x.hours)}`).join(', ');
        return `<tr><td><span class="cell-who"><span class="dot" style="background:${safeColor(e?.color)}"></span>${esc(e?.name || 'Ukjent')}</span>${subs ? `<span class="sub">${subs}</span>` : ''}</td>
          <td>${o.count}</td><td>${hrs(o.hours)}</td><td>${kr(o.supplementPay)}</td><td>${o.overtimePay ? kr(o.overtimePay) : '–'}</td><td>${kr(shown(o.pay))}</td></tr>`;
      }).join('')
      + `</tbody><tfoot><tr><td>Sum</td><td>${total.count}</td><td>${hrs(total.hours)}</td><td>${kr(total.supplementPay)}</td><td>${total.overtimePay ? kr(total.overtimePay) : '–'}</td><td>${kr(shown(total.pay))}</td></tr></tfoot>`;
  }
  const chosen = $('sheetEmp').value;
  $('sheetEmp').innerHTML = ids.map(id => `<option value="${id}">${esc(empById(id)?.name)}</option>`).join('')
    + (ids.length > 1 ? '<option value="all">Alle arbeidsgivere</option>' : '');
  if ([...$('sheetEmp').options].some(o => o.value === chosen)) $('sheetEmp').value = chosen;
  $('sheetEmp').hidden = ids.length < 2;
  $('csvBtn').disabled = $('sheetBtn').disabled = $('icsBtn').disabled = !ids.length;
  renderPayslips(byEmp, ids);
  renderYear(y);
  $('pdfBtn').disabled = !ids.length;

  const warns = L.checkRest(D().shifts, D().settings.minRestH);
  const list = L.shiftsInMonth(D().shifts, ui.month).filter(s => warns[s.id]);
  const weeks = L.weeklyOverLimit(D().shifts, D().employers, D().settings.weekLimitH)
    .filter(w => L.shiftsInMonth(D().shifts, ui.month).some(s => { const k = L.isoWeek(L.parseDate(s.date)); return `${k.year}-U${L.pad(k.week)}` === w.week; }));
  $('warnList').innerHTML = (weeks.map(w => `<div class="flag weekly">Uke ${Number(w.week.slice(-2))}: ${hrs(w.hours)}, over grensen på ${num(D().settings.weekLimitH, 0)} timer.</div>`).join(''))
    + (list.length ? list.map(s => shiftItem(s, warns[s.id], false)).join('') : (weeks.length ? '' : '<p class="muted">Ingen varsler. Alle vakter har nok hvile mellom seg.</p>'));
}

function renderPaySeg() {
  const net = D().settings.showNet === true;
  document.querySelectorAll('.seg [data-pay]').forEach(b => b.setAttribute('aria-checked', String((b.dataset.pay === 'net') === net)));
  $('netHelp').hidden = !(net && !taxPct());
}

function yearInfoText(m, i) {
  return m.count
    ? `<b>${MONTH[i][0].toUpperCase() + MONTH[i].slice(1)}:</b> ${hrs(m.hours)}, ${kr(shown(m.pay))} ${payWord()}, ${m.count} ${m.count === 1 ? 'vakt' : 'vakter'}`
    : `<b>${MONTH[i][0].toUpperCase() + MONTH[i].slice(1)}:</b> ingen vakter`;
}

function renderYear(y) {
  const { months, byEmp, total } = L.yearSummary(D().shifts, D().employers, y, D().settings);
  ui.yearMonths = months;
  $('yearTitle').textContent = `Hele ${y}`;
  $('yearTotals').innerHTML = `
    <div><b>${hrs(total.hours)}</b><span>${total.count} vakter</span></div>
    <div><b>${kr(shown(total.pay))}</b><span>${payWord()[0].toUpperCase() + payWord().slice(1)}</span></div>
    <div><b>${kr(total.holidayPay)}</b><span>Feriepenger opptjent${showNet() ? ' (brutto)' : ''}</span></div>`;
  const max = Math.max(...months.map(m => m.pay), 1);
  // Hver søyle er en knapp: hold over eller fokuser for å se tallene, trykk for å åpne måneden.
  $('yearChart').removeAttribute('role');
  $('yearChart').innerHTML = months.map((m, i) =>
    `<button type="button" class="col${m.ym === ui.month ? ' now' : ''}" data-ym="${m.ym}" data-i="${i}"
      aria-label="${MONTH[i]}: ${m.count ? `${hrs(m.hours)}, ${kr(shown(m.pay))}` : 'ingen vakter'}. Trykk for å vise måneden."${m.ym === ui.month ? ' aria-current="true"' : ''}>
      <span class="bar" style="height:${Math.round(m.pay / max * 100)}%"></span><span class="m">${MONTH[i].slice(0, 1).toUpperCase()}</span></button>`).join('');
  const cur = months.findIndex(m => m.ym === ui.month);
  $('yearInfo').innerHTML = cur >= 0 ? yearInfoText(months[cur], cur) : '';
  const ids = Object.keys(byEmp);
  $('yearTable').innerHTML = ids.length ? `<thead><tr><th>Arbeidsgiver</th><th>Vakter</th><th>Timer</th><th>${showNet() ? 'Ca. netto' : 'Estimert'}</th></tr></thead><tbody>`
    + ids.map(id => { const e = empById(id), o = byEmp[id];
      return `<tr><td><span class="cell-who"><span class="dot" style="background:${safeColor(e?.color)}"></span>${esc(e?.name || 'Ukjent')}</span></td><td>${o.count}</td><td>${hrs(o.hours)}</td><td>${kr(shown(o.pay))}</td></tr>`; }).join('')
    + '</tbody>' : '';
}

function printTimesheet() {
  const choice = $('sheetEmp').value || Object.keys(L.monthSummary(D().shifts, D().employers, ui.month).byEmp)[0];
  if (!choice) return;
  const all = L.calcAll(D().shifts, D().employers);
  const month = L.shiftsInMonth(D().shifts, ui.month);
  const ids = choice === 'all' ? [...new Set(month.map(s => s.employerId))] : [choice];
  const [y, m] = ui.month.split('-').map(Number);
  let grand = 0, count = 0;
  const tables = ids.map(id => {
    const emp = empById(id), list = month.filter(s => s.employerId === id);
    let sum = 0;
    const rows = list.map(s => { const c = all.get(s.id); sum += c.hours; const d = L.parseDate(s.date);
      return `<tr><td>${DAY[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.</td><td>${s.start}</td><td>${s.end}</td><td>${s.breakMin || 0} min</td><td>${num(c.hours, 2)}</td></tr>`; }).join('');
    grand += sum; count += list.length;
    return `${ids.length > 1 ? `<h2>${esc(emp?.name || '')}</h2>` : ''}
      <table><thead><tr><th>Dato</th><th>Start</th><th>Slutt</th><th>Pause</th><th>Timer</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td colspan="4"><b>Sum (${list.length} vakter)</b></td><td><b>${num(sum, 2)}</b></td></tr></tfoot></table>`;
  }).join('');
  const single = ids.length === 1 ? empById(ids[0]) : null;
  $('printArea').innerHTML = `
    <h1>Timeliste</h1>
    <p><b>Arbeidsgiver:</b> ${single ? esc(single.name) : 'Alle arbeidsgivere'}<br><b>Periode:</b> ${MONTH[m - 1]} ${y}<br><b>Navn:</b> ______________________________</p>
    ${tables}
    ${ids.length > 1 ? `<p><b>Totalt: ${num(grand, 2)} timer (${count} vakter)</b></p>` : ''}
    <div class="sign"><div>Dato og signatur, arbeidstaker</div>${single ? '<div>Dato og signatur, arbeidsgiver</div>' : ''}</div>
    <p style="font-size:8pt;color:#555">Laget med Vaktbok. Timer er etter ubetalt pause.</p>`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  print();
}

function renderPayslips(byEmp, ids) {
  const paid = D().settings.payslips?.[ui.month] || {};
  if (!ids.length) { $('payslipList').innerHTML = '<p class="muted">Ingen vakter å sammenligne denne måneden.</p>'; return; }
  const diffs = new Map(L.payslipDiff({ byEmp }, paid).map(d => [d.employerId, d]));
  $('payslipList').innerHTML = ids.map(id => {
    const e = empById(id), d = diffs.get(id);
    const res = !d ? '' : d.ok
      ? `<span class="res ok">Stemmer med estimatet.</span>`
      : `<span class="res off">${d.diff < 0 ? `${kr(-d.diff)} mindre` : `${kr(d.diff)} mer`} enn estimert. Sjekk timer og tillegg med arbeidsgiveren.</span>`;
    return `<div class="slip"><div><span class="cell-who"><span class="dot" style="background:${safeColor(e?.color)}"></span><b>${esc(e?.name || 'Ukjent')}</b></span>
      <div class="est">Estimert ${kr(byEmp[id].pay)}</div></div>
      <input type="number" min="0" step="1" inputmode="decimal" data-paid="${id}" value="${esc(paid[id] ?? '')}" placeholder="Utbetalt brutto" aria-label="Utbetalt brutto fra ${esc(e?.name)}">${res}</div>`;
  }).join('');
}

// ---------- Konto ----------

function renderAccount() {
  const p = $('accountPanel');
  if (!store.configured) {
    p.innerHTML = `<h2>Konto</h2><p class="muted">Denne versjonen er satt opp uten server. Alt lagres bare i denne nettleseren, så last ned en kopi av dataene jevnlig.</p>`;
  } else if (!store.user) {
    p.innerHTML = ui.codeSentTo ? `
      <h2>Skriv inn koden</h2>
      <p>Vi har sendt en engangskode til <b>${esc(ui.codeSentTo)}</b>. Du kan også trykke på lenken i e-posten.</p>
      <form id="codeForm" class="form-row">
        <label>Kode<input id="codeInput" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" required></label>
        <button class="btn primary" type="submit">Logg inn</button>
      </form>
      <p class="small"><button class="btn link" data-action="restart-login">Bruk en annen e-post</button></p>`
      : `
      <h2>Logg inn eller opprett konto</h2>
      <p class="muted">Med konto lagres vaktene trygt og synkes mellom mobil og PC. Du får en engangskode på e-post, så du trenger ikke passord. Uten konto lagres alt bare på denne enheten.</p>
      <form id="loginForm" class="form-row">
        <label>E-post<input type="email" id="emailInput" autocomplete="email" required></label>
        <button class="btn primary" type="submit">Send kode</button>
      </form>`;
  } else {
    const n = store.pending;
    p.innerHTML = `<h2>Konto</h2>
      <p>Logget inn som <b>${esc(store.user.email)}</b></p>
      <p class="small muted">${n ? `${n} ${n === 1 ? 'endring' : 'endringer'} venter på å bli synket.` : 'Alle endringer er synket.'}${store.lastError ? ` ${esc(friendlyError(store.lastError))}${contact ? ` Vedvarer feilen, kontakt <a href="mailto:${esc(contact)}">${esc(contact)}</a>.` : ''}` : ''}</p>
      <div class="row"><button class="btn" data-action="sync-now">Synk nå</button><button class="btn" data-action="sign-out">Logg ut</button></div>`;
  }
  const s = D().settings;
  $('sHoliday').value = String(s.holidayPayPct);
  $('sRest').value = s.minRestH;
  $('sWeek').value = s.weekLimitH;
  $('sTax').value = s.taxPct || '';
  $('dataNote').textContent = store.user
    ? 'Dataene dine lagres på server i EU og synkes til enhetene der du er logget inn. Du kan laste ned eller slette alt når som helst.'
    : 'Alt lagres i denne nettleseren. Sletter du nettleserdata, forsvinner vaktene. Last ned en kopi jevnlig.';
  $('deleteAccountBtn').hidden = !store.user;
  $('demoBtn').hidden = !!store.user || !onlyDemo();
  $('demoBtn').textContent = D().employers.length ? 'Lag nye eksempeldata' : 'Prøv med eksempeldata';
}

// ---------- Import og eksempeldata ----------

const DEMO_KEY = 'vaktbok:demo';
const demoIds = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch { return []; } };
// Eksempeldata kan lages på nytt så lenge alt som finnes, er eksempeldata.
const onlyDemo = () => { const ids = new Set(demoIds()); return D().employers.every(e => ids.has(e.id)); };

function loadDemo() {
  const old = new Set(demoIds());
  for (const e of D().employers.filter(e => old.has(e.id))) store.deleteEmployer(e.id);
  const { employers, shifts } = makeDemo({ newId });
  store.addAll({ employers, shifts });
  localStorage.setItem(DEMO_KEY, JSON.stringify(employers.map(e => e.id)));
  toast(old.size ? 'Nye eksempeldata laget' : 'Eksempeldata lagt inn');
  ui.weekStart = L.mondayOf(new Date());
  setTab('uke');
}

// ---------- Hendelser ----------

const WELCOME_KEY = 'vaktbok:welcomed';
function showLanding(on) {
  ui.landing = on;
  document.body.classList.toggle('show-landing', on);
  $('landing').hidden = !on;
  if (on) window.scrollTo(0, 0);
}
function leaveLanding(tab) {
  localStorage.setItem(WELCOME_KEY, '1');
  showLanding(false);
  if (location.hash === '#om') history.replaceState(null, '', '#uke');
  setTab(tab);
}

function render() {
  renderSync(); renderBanners();
  if (ui.landing) return;
  if (ui.tab === 'uke') renderWeek();
  else if (ui.tab === 'oversikt') renderMonth();
  else if (ui.tab === 'arbeidsgivere') renderEmployers();
  else renderAccount();
}

const actions = {
  'go-login': () => { $('importDialog').close(); setTab('konto'); $('emailInput')?.focus(); },
  'go-settings': () => { setTab('konto'); $('sTax').focus(); },
  'landing-demo': () => { leaveLanding('uke'); loadDemo(); },
  'landing-start': () => { leaveLanding('arbeidsgivere'); openEmp(); },
  'landing-login': () => leaveLanding('konto'),
  'show-landing': () => { showLanding(true); history.replaceState(null, '', '#om'); },
  'edit-shift': el => openShift(D().shifts.find(s => s.id === el.dataset.id)),
  'edit-emp': el => openEmp(empById(el.dataset.id)),
  'new-emp': () => openEmp(),
  'copy-shift': el => {
    const s = D().shifts.find(x => x.id === el.dataset.id); if (!s) return;
    const date = L.isoDate(addDays(L.parseDate(s.date), Number(el.dataset.days)));
    store.upsertShift({ ...s, id: undefined, date });
    toast(`Kopiert til ${fmtDay(date)}`);
  },
  'import-v1': async () => {
    const v1 = JSON.parse(localStorage.getItem(V1_KEY) || '{}');
    if (await importer.importJson(v1, 'Fra prototypen')) localStorage.setItem(V1_DONE, '1');
    render();
  },
  'dismiss-v1': () => { localStorage.setItem(V1_DONE, '1'); render(); },
  'update-app': () => { ui.updating = true; ui.updateReg?.waiting?.postMessage('skip-waiting'); },
  'restart-login': () => { ui.codeSentTo = ''; render(); },
  'sync-now': () => store.sync(),
  'sign-out': async () => {
    if (!(await store.signOut())) {
      const ok = await confirmBox('Logge ut likevel?', `${store.pending} endringer er ikke synket ennå. Logger du ut nå, går de tapt.`, 'Logg ut', true);
      if (ok) await store.signOut({ force: true }); else return;
    }
    toast('Logget ut');
  },
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) { ev.preventDefault(); actions[el.dataset.action](el); return; }
  const close = ev.target.closest('[data-close]');
  if (close) close.closest('dialog').close();
});

const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
tabs.forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
document.querySelector('.tabs').addEventListener('keydown', ev => { // ARIA-fanemønster: piltaster, Home og End
  const i = tabs.indexOf(document.activeElement); if (i < 0) return;
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[ev.key];
  if (next === undefined) return;
  ev.preventDefault();
  const t = tabs[(next + tabs.length) % tabs.length];
  setTab(t.dataset.tab); t.focus();
});
$('syncPill').addEventListener('click', () => { if (ui.landing) leaveLanding('konto'); else setTab('konto'); });
$('homeLink').addEventListener('click', ev => {
  ev.preventDefault();
  if (ui.landing) { leaveLanding('uke'); return; }
  ui.weekStart = L.mondayOf(new Date());
  ui.month = ym(new Date());
  setTab('uke');
  window.scrollTo(0, 0);
});
$('fRepeat').addEventListener('change', () => { $('repeatUntilLabel').hidden = $('fRepeat').value === '0'; });
$('pdfBtn').addEventListener('click', printTimesheet);
$('prevWeek').addEventListener('click', () => { ui.weekStart = addDays(ui.weekStart, -7); renderWeek(); });
$('nextWeek').addEventListener('click', () => { ui.weekStart = addDays(ui.weekStart, 7); renderWeek(); });
$('todayBtn').addEventListener('click', () => { ui.weekStart = L.mondayOf(new Date()); renderWeek(); });
const shiftMonth = n => { const [y, m] = ui.month.split('-').map(Number); ui.month = ym(new Date(y, m - 1 + n, 1)); renderMonth(); };
$('prevMonth').addEventListener('click', () => shiftMonth(-1));
$('nextMonth').addEventListener('click', () => shiftMonth(1));

$('newShiftBtn').addEventListener('click', () => openShift());
$('shiftForm').addEventListener('submit', saveShift);
$('shiftForm').addEventListener('input', updatePreview);
$('fEmp').addEventListener('change', () => {
  if (ui.shift) return;
  const last = lastShiftFor($('fEmp').value);
  if (last) setFields({ start: last.start, end: last.end, brk: last.breakMin });
  updatePreview();
});
$('deleteShiftBtn').addEventListener('click', async () => {
  if (!ui.shift) return;
  $('shiftDialog').close();
  if (await confirmBox('Slette vakta?', `${empById(ui.shift.employerId)?.name || ''}, ${fmtDay(ui.shift.date)} ${ui.shift.start}–${ui.shift.end}.`, 'Slett vakt', true)) {
    const gone = { ...ui.shift };
    store.deleteShift(gone.id);
    toast('Vakt slettet', () => { store.upsertShift(gone); toast('Vakta er tilbake'); });
  }
});

$('newEmpBtn').addEventListener('click', () => openEmp());
$('empForm').addEventListener('submit', saveEmp);
$('ruleList').addEventListener('input', onRuleInput);
$('ruleList').addEventListener('change', onRuleInput);
$('ruleList').addEventListener('click', ev => {
  const i = ev.target.dataset.remove; if (i === undefined) return;
  ui.rules.splice(Number(i), 1); renderRules();
});
$('addRuleBtn').addEventListener('click', () => { ui.rules.push(newRule()); renderRules(); $('ruleList').querySelector('.rule:last-of-type input')?.focus(); });
$('presetBtn').addEventListener('click', () => {
  ui.rules.push(
    newRule({ label: 'Kveld', from: '17:00', to: '21:00' }),
    newRule({ label: 'Natt', days: [0, 1, 2, 3, 4, 5, 6], from: '21:00', to: '06:00' }),
    newRule({ label: 'Lørdag', days: [6], from: '00:00', to: '00:00' }),
    newRule({ label: 'Søndag', days: [0], from: '00:00', to: '00:00' }),
    newRule({ label: 'Helligdag', kind: 'pct', holiday: true, days: [], from: '00:00', to: '00:00' }),
  );
  renderRules(); toast('Fyll inn beløpene fra avtalen din');
});
$('eOtOn').addEventListener('change', toggleOt);
$('deleteEmpBtn').addEventListener('click', async () => {
  const e = ui.emp; if (!e) return;
  const n = D().shifts.filter(s => s.employerId === e.id).length;
  $('empDialog').close();
  const msg = n ? `Dette sletter også ${n} ${n === 1 ? 'vakt' : 'vakter'}. Vil du heller beholde historikken, kan du skjule arbeidsgiveren i stedet.` : 'Arbeidsgiveren har ingen vakter.';
  if (await confirmBox(`Slette ${e.name}?`, msg, 'Slett arbeidsgiver', true)) {
    const shifts = D().shifts.filter(s => s.employerId === e.id).map(s => ({ ...s }));
    store.deleteEmployer(e.id);
    toast('Arbeidsgiver slettet', () => { store.addAll({ employers: [e], shifts }); toast('Arbeidsgiveren er tilbake'); });
  }
});

$('icsBtn').addEventListener('click', () => download(`vaktbok-${ui.month}.ics`, L.toICS(L.shiftsInMonth(D().shifts, ui.month), D().employers), 'text/calendar;charset=utf-8'));
$('payslipList').addEventListener('change', ev => {
  const id = ev.target.dataset.paid; if (!id) return;
  const v = ev.target.value === '' ? null : Number(ev.target.value);
  if (v != null && !(v >= 0 && v < 1e7)) { toast('Skriv beløpet som et tall i hele kroner, for eksempel 18500, uten «kr» eller mellomrom.'); return; }
  const payslips = structuredClone(D().settings.payslips || {});
  const month = payslips[ui.month] ||= {};
  if (v == null) delete month[id]; else month[id] = v;
  store.updateSettings({ payslips });
});
$('copyRulesFrom').addEventListener('change', ev => {
  const src = empById(ev.target.value); ev.target.value = ''; if (!src) return;
  ui.rules.push(...(src.rules || []).map(r => ({ ...structuredClone(r), id: newId() })));
  if (src.overtime && !$('eOtOn').checked) {
    $('eOtOn').checked = true; $('eOtAfter').value = src.overtime.afterH ?? ''; $('eOtWeek').value = src.overtime.weekH ?? ''; $('eOtPct').value = src.overtime.pct; toggleOt();
  }
  renderRules(); toast(`Tillegg kopiert fra ${src.name}`);
});
document.querySelectorAll('.seg [data-pay]').forEach(b => b.addEventListener('click', () => {
  store.updateSettings({ showNet: b.dataset.pay === 'net' });
}));
$('yearChart').addEventListener('click', ev => {
  const col = ev.target.closest('[data-ym]'); if (!col) return;
  ui.month = col.dataset.ym; renderMonth();
  $('monthTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
const showYearInfo = ev => {
  const col = ev.target.closest('[data-i]'); if (!col || !ui.yearMonths) return;
  const i = Number(col.dataset.i); $('yearInfo').innerHTML = yearInfoText(ui.yearMonths[i], i);
};
$('yearChart').addEventListener('mouseover', showYearInfo);
$('yearChart').addEventListener('focusin', showYearInfo);
$('yearChart').addEventListener('mouseleave', () => {
  const i = (ui.yearMonths || []).findIndex(m => m.ym === ui.month);
  $('yearInfo').innerHTML = i >= 0 ? yearInfoText(ui.yearMonths[i], i) : '';
});
$('csvBtn').addEventListener('click', () => download(`vaktbok-${ui.month}.csv`, L.toCSV(D().shifts, D().employers, ui.month), 'text/csv;charset=utf-8'));
$('sheetBtn').addEventListener('click', async () => {
  const text = L.toTimesheet(D().shifts, D().employers, ui.month, $('sheetEmp').value);
  try { await navigator.clipboard.writeText(text); toast('Timelista er kopiert'); }
  catch { download(`timeliste-${ui.month}.txt`, text, 'text/plain;charset=utf-8'); toast('Nettleseren tillot ikke kopiering, så timelista er lastet ned som tekstfil i stedet.'); }
});

$('settingsForm').addEventListener('change', () => {
  const f = { rest: $('sRest'), week: $('sWeek'), tax: $('sTax') };
  const rest = Number(f.rest.value), week = Number(f.week.value), tax = f.tax.value === '' ? 0 : Number(f.tax.value);
  const errs = [];
  const check = (el, ok, msg) => { el.setAttribute('aria-invalid', String(!ok)); if (!ok) errs.push(msg); };
  check(f.rest, f.rest.value !== '' && rest >= 0 && rest <= 24, 'Minste hviletid må være mellom 0 og 24 timer. Arbeidsmiljøloven bruker 11 timer som hovedregel.');
  check(f.week, f.week.value !== '' && week >= 1 && week <= 168, 'Ukegrensen må være mellom 1 og 168 timer. 48 timer er vanlig.');
  check(f.tax, tax >= 0 && tax <= 60, 'Skattetrekket må være mellom 0 og 60 prosent. Du finner det på skattekortet ditt.');
  $('settingsErrors').innerHTML = errs.map(x => `<li>${esc(x)}</li>`).join('');
  if (errs.length) return;
  store.updateSettings({ holidayPayPct: Number($('sHoliday').value), minRestH: rest, weekLimitH: week, taxPct: tax });
  toast('Innstillingene er lagret');
});

$('exportBtn').addEventListener('click', () => download(`vaktbok-data-${L.isoDate(new Date())}.json`, JSON.stringify(store.exportAll(), null, 2), 'application/json'));
$('demoBtn').addEventListener('click', loadDemo);
$('wipeBtn').addEventListener('click', async () => {
  if (!(await confirmBox('Slette alt?', 'Alle vakter og arbeidsgivere slettes for godt. Last ned en kopi først hvis du vil beholde dem.', 'Slett alt', true))) return;
  try { await store.deleteEverything(); toast('Alle data er slettet'); } catch (e) { toast(`Kunne ikke slette dataene. ${friendlyError(e)}`); }
});
$('deleteAccountBtn').addEventListener('click', async () => {
  if (!(await confirmBox('Slette kontoen?', 'Kontoen og alle vakter, arbeidsgivere og innstillinger slettes for godt fra serveren og denne enheten.', 'Slett kontoen', true))) return;
  try { await store.deleteAccount(); toast('Kontoen er slettet'); } catch (e) { toast(`Kunne ikke slette kontoen. ${friendlyError(e)}`); }
});

$('accountPanel').addEventListener('submit', async ev => {
  ev.preventDefault();
  const btn = ev.target.querySelector('button[type="submit"]'); btn.disabled = true;
  try {
    if (ev.target.id === 'loginForm') {
      const email = $('emailInput').value.trim();
      await store.sendCode(email); ui.codeSentTo = email; renderAccount(); $('codeInput')?.focus();
    } else if (ev.target.id === 'codeForm') {
      await store.verifyCode(ui.codeSentTo, $('codeInput').value.trim()); ui.codeSentTo = ''; toast('Du er logget inn');
    }
  } catch (e) {
    toast(friendlyError(e));
  } finally { btn.disabled = false; }
});

store.addEventListener('change', render);
store.addEventListener('status', () => { renderSync(); if (ui.tab === 'konto') renderAccount(); });
store.addEventListener('guest-data', async ({ detail }) => {
  const n = detail.shifts?.length || 0;
  const ok = await confirmBox('Ta med vaktene fra denne enheten?', `Du har ${n} vakter lagret her fra før du logget inn. Vil du legge dem til i kontoen din?`, 'Legg til i kontoen');
  if (ok) { store.addAll({ employers: detail.employers || [], shifts: detail.shifts || [] }); store.clearGuestData(); toast('Vaktene er lagt til i kontoen'); }
});

// ---------- Import ----------
const importer = setupImporter({
  store, D, $, esc, toast, fmtDay, setTab, openEmp, newId, confirmBox, friendlyError,
  goToWeek: date => { ui.weekStart = L.mondayOf(L.parseDate(date)); setTab('uke'); },
});
$('importBtn').addEventListener('click', () => importer.open());
$('importBtn2').addEventListener('click', () => importer.open());

// ---------- Oppstart ----------

const contact = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(config.contactEmail || '') ? config.contactEmail : '';
if (contact) Object.assign($('contactLink'), { href: `mailto:${contact}`, textContent: 'Kontakt', hidden: false });

async function registerSW() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const check = () => { if (reg.waiting && navigator.serviceWorker.controller) { ui.updateReg = reg; renderBanners(); } };
    check();
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', check));
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (ui.updating && !reloaded) { reloaded = true; location.reload(); } });
  } catch (e) { console.warn('Service worker feilet', e); }
}

const initialHash = location.hash;
const hashTab = location.hash.slice(1) === 'maned' ? 'oversikt' : location.hash.slice(1); // gamle lenker til #maned virker fortsatt
const start = ['uke', 'oversikt', 'arbeidsgivere', 'konto'].includes(hashTab) ? hashTab : 'uke';
setTab(start);
if (initialHash === '#om') showLanding(true);
store.init().then(() => {
  // Nye besøkende uten konto og uten data ser landingssiden først.
  if (!ui.landing && !store.user && !D().employers.length && !localStorage.getItem(WELCOME_KEY) && !initialHash) showLanding(true);
  render();
});
registerSW();
