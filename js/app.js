// Vaktbok – brukergrensesnitt.
import { config } from './config.js';
import * as L from './logic.js';
import { Store, newId } from './store.js';
import { makeDemo } from './demo.js';

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
  for (const t of ['uke', 'maned', 'arbeidsgivere', 'konto']) $(`v-${t}`).hidden = t !== tab;
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
  $('weekSum').innerHTML = inWeek.length ? `<b>${hrs(h)}</b> og <b>${kr(pay)}</b> estimert denne uka` : '';

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
      <span class="meta num">${kr(c.pay)}${c.overtimeH > 0 ? `, ${hrs(c.overtimeH)} overtid` : ''}</span>
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
  if (!emps.length) { toast('Legg til en arbeidsgiver først.'); openEmp(); return; }
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
  if (errs.length) { $('shiftErrors').innerHTML = errs.map(x => `<li>${esc(x)}</li>`).join(''); return; }
  const saved = store.upsertShift(s);
  $('shiftDialog').close();
  ui.weekStart = L.mondayOf(L.parseDate(saved.date));
  toast(s.id ? 'Vakt oppdatert' : 'Vakt lagret');
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
      <span class="meta">${rules.length ? rules.map(esc).join('<br>') : 'Ingen tillegg'}</span>
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

// ---------- Måned ----------

function renderMonth() {
  const [y, m] = ui.month.split('-').map(Number);
  $('monthTitle').textContent = `${MONTH[m - 1][0].toUpperCase()}${MONTH[m - 1].slice(1)} ${y}`;
  const { byEmp, total } = L.monthSummary(D().shifts, D().employers, ui.month, D().settings);
  $('totals').innerHTML = `
    <div><b>${hrs(total.hours)}</b><span>${total.count} vakter</span></div>
    <div><b>${kr(total.pay)}</b><span>Estimert brutto</span></div>
    ${total.net != null ? `<div><b>${kr(total.net)}</b><span>Ca. etter ${num(D().settings.taxPct, 1)} % skatt</span></div>` : ''}
    <div><b>${kr(total.holidayPay)}</b><span>Feriepenger opptjent</span></div>`;
  const ids = Object.keys(byEmp);
  if (!ids.length) {
    $('empTable').innerHTML = '<tbody><tr><td class="empty" colspan="6">Ingen vakter denne måneden.</td></tr></tbody>';
  } else {
    $('empTable').innerHTML = `<thead><tr><th>Arbeidsgiver</th><th>Vakter</th><th>Timer</th><th>Tillegg</th><th>Overtid</th><th>Estimert</th></tr></thead><tbody>`
      + ids.map(id => {
        const e = empById(id), o = byEmp[id];
        const subs = Object.values(o.supplements).filter(x => x.hours > 0).map(x => `${esc(x.label)} ${hrs(x.hours)}`).join(', ');
        return `<tr><td><span class="cell-who"><span class="dot" style="background:${safeColor(e?.color)}"></span>${esc(e?.name || 'Ukjent')}</span>${subs ? `<span class="sub">${subs}</span>` : ''}</td>
          <td>${o.count}</td><td>${hrs(o.hours)}</td><td>${kr(o.supplementPay)}</td><td>${o.overtimePay ? kr(o.overtimePay) : '–'}</td><td>${kr(o.pay)}</td></tr>`;
      }).join('')
      + `</tbody><tfoot><tr><td>Sum</td><td>${total.count}</td><td>${hrs(total.hours)}</td><td>${kr(total.supplementPay)}</td><td>${total.overtimePay ? kr(total.overtimePay) : '–'}</td><td>${kr(total.pay)}</td></tr></tfoot>`;
  }
  $('sheetEmp').innerHTML = ids.map(id => `<option value="${id}">${esc(empById(id)?.name)}</option>`).join('');
  $('sheetEmp').hidden = ids.length < 2;
  $('csvBtn').disabled = $('sheetBtn').disabled = $('icsBtn').disabled = !ids.length;
  renderPayslips(byEmp, ids);

  const warns = L.checkRest(D().shifts, D().settings.minRestH);
  const list = L.shiftsInMonth(D().shifts, ui.month).filter(s => warns[s.id]);
  const weeks = L.weeklyOverLimit(D().shifts, D().employers, D().settings.weekLimitH)
    .filter(w => L.shiftsInMonth(D().shifts, ui.month).some(s => { const k = L.isoWeek(L.parseDate(s.date)); return `${k.year}-U${L.pad(k.week)}` === w.week; }));
  $('warnList').innerHTML = (weeks.map(w => `<div class="flag weekly">Uke ${Number(w.week.slice(-2))}: ${hrs(w.hours)}, over grensen på ${num(D().settings.weekLimitH, 0)} timer.</div>`).join(''))
    + (list.length ? list.map(s => shiftItem(s, warns[s.id], false)).join('') : (weeks.length ? '' : '<p class="muted">Ingen varsler. Alle vakter har nok hvile mellom seg.</p>'));
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
      <p class="small muted">${n ? `${n} ${n === 1 ? 'endring' : 'endringer'} venter på å bli synket.` : 'Alle endringer er synket.'}${store.lastError ? ` Siste feil: ${esc(store.lastError)}` : ''}</p>
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

function remapImport(data) {
  if (data.app !== 'Vaktbok' || data.format !== 2) return L.migrateV1(data, newId); // prototypeformat
  const idMap = new Map();
  const employers = (data.employers || []).map(e => { const id = newId(); idMap.set(e.id, id); return { ...e, id, rules: (e.rules || []).map(r => ({ ...r, id: newId() })) }; })
    .filter(e => !L.validateEmployer(e).length);
  const shifts = (data.shifts || []).filter(s => idMap.has(s.employerId)).map(s => ({ ...s, id: newId(), employerId: idMap.get(s.employerId) }))
    .filter(s => !L.validateShift(s, employers).length);
  return { employers, shifts };
}

async function importData(data, label) {
  const { employers, shifts } = remapImport(data);
  if (!employers.length && !shifts.length) { toast('Fant ingen gyldige data i fila.'); return false; }
  const ok = await confirmBox('Importere data?', `${label}: ${employers.length} arbeidsgivere og ${shifts.length} vakter legges til ved siden av det du har fra før.`, 'Importer');
  if (!ok) return false;
  store.addAll({ employers, shifts });
  toast(`Importerte ${shifts.length} vakter`);
  return true;
}

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

function render() {
  renderSync(); renderBanners();
  if (ui.tab === 'uke') renderWeek();
  else if (ui.tab === 'maned') renderMonth();
  else if (ui.tab === 'arbeidsgivere') renderEmployers();
  else renderAccount();
}

const actions = {
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
    if (await importData(v1, 'Fra prototypen')) localStorage.setItem(V1_DONE, '1');
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
$('syncPill').addEventListener('click', () => setTab('konto'));
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
  if (v != null && !(v >= 0 && v < 1e7)) { toast('Skriv inn et gyldig beløp.'); return; }
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
$('csvBtn').addEventListener('click', () => download(`vaktbok-${ui.month}.csv`, L.toCSV(D().shifts, D().employers, ui.month), 'text/csv;charset=utf-8'));
$('sheetBtn').addEventListener('click', async () => {
  const text = L.toTimesheet(D().shifts, D().employers, ui.month, $('sheetEmp').value);
  try { await navigator.clipboard.writeText(text); toast('Timelista er kopiert'); }
  catch { download(`timeliste-${ui.month}.txt`, text, 'text/plain;charset=utf-8'); }
});

$('settingsForm').addEventListener('change', () => {
  const rest = Number($('sRest').value), week = Number($('sWeek').value), tax = Number($('sTax').value || 0);
  if (!(rest >= 0 && rest <= 24) || !(week >= 1 && week <= 168) || !(tax >= 0 && tax <= 60)) { toast('Sjekk verdiene i innstillingene.'); return; }
  store.updateSettings({ holidayPayPct: Number($('sHoliday').value), minRestH: rest, weekLimitH: week, taxPct: tax });
  toast('Innstillinger lagret');
});

$('exportBtn').addEventListener('click', () => download(`vaktbok-data-${L.isoDate(new Date())}.json`, JSON.stringify(store.exportAll(), null, 2), 'application/json'));
$('importFile').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  if (f.size > 5e6) { toast('Fila er for stor.'); return; }
  try { await importData(JSON.parse(await f.text()), f.name); }
  catch { toast('Fila kunne ikke leses. Bruk en fil lastet ned fra Vaktbok.'); }
});
$('demoBtn').addEventListener('click', loadDemo);
$('wipeBtn').addEventListener('click', async () => {
  if (!(await confirmBox('Slette alt?', 'Alle vakter og arbeidsgivere slettes for godt. Last ned en kopi først hvis du vil beholde dem.', 'Slett alt', true))) return;
  try { await store.deleteEverything(); toast('Alle data er slettet'); } catch (e) { toast(`Kunne ikke slette: ${e.message}`); }
});
$('deleteAccountBtn').addEventListener('click', async () => {
  if (!(await confirmBox('Slette kontoen?', 'Kontoen og alle vakter, arbeidsgivere og innstillinger slettes for godt fra serveren og denne enheten.', 'Slett kontoen', true))) return;
  try { await store.deleteAccount(); toast('Kontoen er slettet'); } catch (e) { toast(`Kunne ikke slette kontoen: ${e.message}`); }
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
    toast(/rate|seconds/i.test(e.message) ? 'Vent litt før du ber om en ny kode.' : /expired|invalid/i.test(e.message) ? 'Koden er feil eller utløpt.' : `Noe gikk galt: ${e.message}`);
  } finally { btn.disabled = false; }
});

store.addEventListener('change', render);
store.addEventListener('status', () => { renderSync(); if (ui.tab === 'konto') renderAccount(); });
store.addEventListener('guest-data', async ({ detail }) => {
  const n = detail.shifts?.length || 0;
  const ok = await confirmBox('Ta med vaktene fra denne enheten?', `Du har ${n} vakter lagret her fra før du logget inn. Vil du legge dem til i kontoen din?`, 'Legg til i kontoen');
  if (ok) { store.addAll({ employers: detail.employers || [], shifts: detail.shifts || [] }); store.clearGuestData(); toast('Vaktene er lagt til i kontoen'); }
});

// ---------- Oppstart ----------

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

const start = ['uke', 'maned', 'arbeidsgivere', 'konto'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'uke';
setTab(start);
store.init().then(render);
registerSW();
