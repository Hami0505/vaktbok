import * as L from '../logic.js';
import { newId } from '../store.js';
import { $, D, DAY_LONG, addDays, choiceBox, confirmBox, empById, esc, fmtDay, hrs, kr, store, toast, ui, warningText } from './core.js';
import { renderWeek } from './week.js';
import { openEmp } from './employers.js';

// ---------- Vakt-dialog ----------
export function readShiftForm() {
  return {
    id: ui.shift?.id, employerId: $('fEmp').value, date: $('fDate').value, start: $('fStart').value, end: $('fEnd').value,
    breakMin: Number($('fBreak').value || 0), note: $('fNote').value.trim(), seriesId: ui.shift?.seriesId || null,
    status: $('fOffered').checked ? 'offered' : null,
    fee: shiftFeeFromForm(),
  };
}

// Beløp for vakta: honorar for oppdraget (honorar-arbeidsgivere) eller valgfritt fast beløp (timelønn).
export function shiftFeeFromForm() {
  const type = L.payType(empById($('fEmp').value));
  const v = type === 'fee' ? $('fFee').value : type === 'hourly' ? $('fFixed').value : '';
  return v === '' ? null : Number(v);
}

export function togglePayFields(shift = null, fresh = false) {
  const emp = empById($('fEmp').value), type = L.payType(emp);
  $('fFeeL').hidden = type !== 'fee';
  $('fFixedBox').hidden = type !== 'hourly';
  if (type === 'fee') {
    if (fresh) $('fFee').value = shift && L.hasFixedFee(shift) ? shift.fee : (emp.pay?.feeDefault ?? '');
    $('fFeeHelp').textContent = emp.pay?.feeDefault ? `Vanlig honorar hos ${emp.name}: ${kr(emp.pay.feeDefault)}.` : 'Beløpet du får for dette oppdraget.';
  }
  if (type === 'hourly' && fresh) {
    $('fFixed').value = shift && L.hasFixedFee(shift) ? shift.fee : '';
    $('fFixedBox').open = !!(shift && L.hasFixedFee(shift));
  }
}

// ---------- Gjentakende vakter (serier) ----------
export const REP_DAYS = [[1, 'M', 'mandag'], [2, 'T', 'tirsdag'], [3, 'O', 'onsdag'], [4, 'T', 'torsdag'], [5, 'F', 'fredag'], [6, 'L', 'lørdag'], [0, 'S', 'søndag']];

export const seriesOf = id => (D().settings.series || {})[id] || null;

// Samme serie og dato gir alltid samme id, så to enheter som fyller på samtidig ikke lager dubletter.
export function seriesShiftId(seriesId, date) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (const ch of `${seriesId}|${date}`) {
    const k = ch.charCodeAt(0);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  const hex = [h1, h2, h3, h4].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function fillRepeatOptions() {
  const d = $('fDate').value ? L.parseDate($('fDate').value) : new Date();
  const wd = DAY_LONG[d.getDay()], cur = $('fRepeat').value || 'none';
  $('fRepeat').innerHTML = [['none', 'Ikke gjenta'], ['daily', 'Hver dag'], ['weekly', `Hver uke på ${wd}`], ['biweekly', `Annenhver uke på ${wd}`],
    ['weekdays', 'Hver ukedag (mandag–fredag)'], ['custom', 'Egendefinert …']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('fRepeat').value = cur;
}

export function renderRepDays(days) {
  $('fRepDays').innerHTML = REP_DAYS.map(([d, l, full]) =>
    `<label class="chip"><input type="checkbox" data-rep-day="${d}" aria-label="${full}"${days.includes(d) ? ' checked' : ''}><span>${l}</span></label>`).join('');
}

export function readRepeat() {
  const v = $('fRepeat').value;
  if (!v || v === 'none' || !$('fDate').value) return null;
  const wd = L.parseDate($('fDate').value).getDay();
  const rule = {
    daily: { freq: 'day', interval: 1 }, weekly: { freq: 'week', interval: 1, days: [wd] },
    biweekly: { freq: 'week', interval: 2, days: [wd] }, weekdays: { freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] },
  }[v] || { freq: $('fRepUnit').value, interval: Number($('fRepN').value),
    days: [...$('fRepDays').querySelectorAll('input:checked')].map(i => Number(i.dataset.repDay)) };
  rule.end = { type: document.querySelector('input[name="repEnd"]:checked').value, until: $('fRepUntil').value, count: Number($('fRepCount').value) };
  return rule;
}

export const horizonIso = () => L.isoDate(addDays(new Date(), L.SERIES_HORIZON_DAYS));

export function updateRepeatUI() {
  const v = $('fRepeat').value;
  $('repeatCustom').hidden = v !== 'custom';
  $('fRepDays').hidden = $('fRepUnit').value !== 'week';
  $('repeatEnd').hidden = !v || v === 'none';
  const rule = readRepeat(), date = $('fDate').value;
  if (!rule) { $('repeatDesc').textContent = ''; return; }
  const errs = L.validateRepeat(rule, date);
  if (errs.length) { $('repeatDesc').textContent = errs[0]; return; }
  const dates = L.seriesDates(rule, date, date, horizonIso(), 1000);
  const more = rule.end.type === 'never' || (rule.end.type === 'until' && rule.end.until > horizonIso());
  $('repeatDesc').textContent = dates.length
    ? `${L.describeRepeat(rule)}. Lager ${dates.length} ${dates.length === 1 ? 'vakt' : 'vakter'}${more ? ' det neste året, og fyller på automatisk' : ''}, første ${fmtDay(dates[0])}`
    : 'Ingen datoer passer regelen. Sjekk ukedagene.';
}

export function createSeries(s, rule) {
  const seriesId = newId();
  const dates = L.seriesDates(rule, s.date, s.date, horizonIso(), 1000);
  const template = { employerId: s.employerId, start: s.start, end: s.end, breakMin: s.breakMin, note: s.note, fee: s.fee ?? null, status: s.status || null };
  const through = [horizonIso(), rule.end.type === 'until' ? rule.end.until : null].filter(Boolean).sort()[0];
  store.addAll({ shifts: dates.map(date => ({ ...template, id: seriesShiftId(seriesId, date), date, seriesId })) });
  store.updateSettings({ series: { ...(D().settings.series || {}), [seriesId]: { rule, start: s.date, template, through } } });
  return dates.length;
}

// Fyller på serier som går lenger enn det som er laget, slik at det alltid ligger vakter ett år frem.
export function extendSeries() {
  const all = D().settings.series || {};
  const horizon = horizonIso();
  const next = { ...all }, add = [];
  let changed = false;
  for (const [id, sr] of Object.entries(all)) {
    const stop = [horizon, sr.rule.end?.type === 'until' ? sr.rule.end.until : null].filter(Boolean).sort()[0];
    if (!sr.through || sr.through >= stop) continue;
    if (!empById(sr.template.employerId)) continue;
    const from = L.isoDate(addDays(L.parseDate(sr.through), 1));
    for (const date of L.seriesDates(sr.rule, sr.start, from, stop, 1000)) {
      const sid = seriesShiftId(id, date);
      if (!D().shifts.some(x => x.id === sid)) add.push({ ...sr.template, id: sid, date, seriesId: id });
    }
    next[id] = { ...sr, through: stop }; changed = true;
  }
  if (add.length) store.addAll({ shifts: add });
  if (changed) store.updateSettings({ series: next });
}

export function applySeriesEdit(orig, edited, scope) {
  if (scope === 'one') { store.upsertShift({ ...edited, seriesId: null }); return 'Vakta er endret og tatt ut av serien'; }
  const delta = Math.round((L.parseDate(edited.date) - L.parseDate(orig.date)) / 86400000);
  const patch = { employerId: edited.employerId, start: edited.start, end: edited.end, breakMin: edited.breakMin, note: edited.note, fee: edited.fee ?? null, status: edited.status || null };
  const targets = D().shifts.filter(x => x.seriesId === orig.seriesId && (scope === 'all' || x.date >= orig.date));
  store.addAll({ shifts: targets.map(x => ({ ...x, ...patch, date: delta ? L.isoDate(addDays(L.parseDate(x.date), delta)) : x.date })) });
  const sr = seriesOf(orig.seriesId);
  if (sr) {
    const shiftDays = d => (((d + delta) % 7) + 7) % 7;
    const rule = delta && sr.rule.freq === 'week' ? { ...sr.rule, days: (sr.rule.days || []).map(shiftDays) } : sr.rule;
    const moved = d => delta ? L.isoDate(addDays(L.parseDate(d), delta)) : d;
    store.updateSettings({ series: { ...D().settings.series, [orig.seriesId]: { ...sr, rule, template: patch, start: scope === 'all' ? moved(sr.start) : sr.start, through: moved(sr.through) } } });
  }
  return `Endret ${targets.length} ${targets.length === 1 ? 'vakt' : 'vakter'} i serien`;
}

export function openShift(s = null) {
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
  $('fOffered').checked = L.isOffered(s);
  togglePayFields(s, true);
  $('repeatFields').hidden = !!s; // gjentakelse velges når vakta lages
  if (!s) {
    $('fRepeat').innerHTML = ''; fillRepeatOptions(); $('fRepeat').value = 'none';
    $('fRepN').value = 1; $('fRepUnit').value = 'week'; renderRepDays([L.parseDate($('fDate').value).getDay()]); ui.repDaysTouched = false;
    document.querySelector('input[name="repEnd"][value="never"]').checked = true;
    $('fRepUntil').value = L.isoDate(addDays(L.parseDate($('fDate').value), 90)); $('fRepCount').value = 10;
    updateRepeatUI();
  }
  const sr = s?.seriesId && seriesOf(s.seriesId);
  $('seriesInfo').hidden = !sr;
  if (sr) $('seriesInfo').textContent = `↻ Gjentakende vakt: ${L.describeRepeat(sr.rule)}. Når du lagrer eller sletter, velger du om det gjelder bare denne eller flere.`;
  $('shiftErrors').innerHTML = '';
  updatePreview();
  $('shiftDialog').showModal();
}

export function setFields(v) {
  const map = { emp: 'fEmp', date: 'fDate', start: 'fStart', end: 'fEnd', brk: 'fBreak', note: 'fNote' };
  for (const [k, val] of Object.entries(v)) $(map[k]).value = val ?? '';
}

export function lastShiftFor(empId) {
  return D().shifts.filter(s => s.employerId === empId).sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function updatePreview() {
  const s = readShiftForm();
  const errs = L.validateShift(s, D().employers);
  if (errs.length) { $('preview').innerHTML = ''; return; }
  const tmpId = s.id || '__ny__';
  const others = D().shifts.filter(x => x.id !== s.id);
  const c = L.calcAll([...others, { ...s, id: tmpId }], D().employers).get(tmpId);
  const lines = [c.kind === 'volunteer' && !L.hasFixedFee(s) ? `<b>${hrs(c.hours)}</b> frivillig arbeid`
    : c.fixed ? `<b>${hrs(c.hours)}</b>, <b>${kr(c.pay)}</b>${c.effectiveRate ? ` (tilsvarer ${kr(c.effectiveRate)} per time)` : ''}`
    : `<b>${hrs(c.hours)}</b>, estimert <b>${kr(c.pay)}</b>`];
  if (L.isOffered(s)) lines.unshift('<span class="badge">Tilbudt</span> Teller ikke før du tar den. Tar du den:');
  if (c.kind === 'fee' && !c.pay) lines.push('<span class="flag block rest">Skriv inn honoraret for oppdraget.</span>');
  for (const x of c.supplements) if (x.hours > 0) lines.push(`${esc(x.label)}: ${hrs(x.hours)}, ${kr(x.amount)}`);
  if (c.overtimeH > 0) lines.push(`Overtid: ${hrs(c.overtimeH)}, ${kr(c.overtimePay)}${c.weekOvertimeH ? ` (${hrs(c.weekOvertimeH)} fordi uka passerer grensen)` : ''}`);
  const hol = L.holidayName(s.date); if (hol) lines.push(`${esc(hol)}`);
  const w = L.restWarnings([...others, { ...s, id: tmpId }], D().employers, D().settings.minRestH, tmpId)[tmpId];
  if (w) lines.push(`<span class="flag block ${w.type}">${esc(warningText(w))}</span>`);
  if (L.noteLooksSensitive(s.note)) lines.push(`<span class="flag block overlap">Notatet inneholder det som ser ut som et fødselsnummer eller D-nummer. Fjern det før du lagrer.</span>`);
  $('preview').innerHTML = lines.join('<br>');
}

export async function saveShift(e) {
  e.preventDefault();
  const s = readShiftForm();
  const errs = L.validateShift(s, D().employers);
  if (L.noteLooksSensitive(s.note)) errs.push('Notatet inneholder et fødselsnummer eller D-nummer. Slike opplysninger skal ikke lagres i Vaktbok.');
  const rule = s.id ? null : readRepeat();
  if (rule) errs.push(...L.validateRepeat(rule, s.date));
  if (errs.length) { $('shiftErrors').innerHTML = errs.map(x => `<li>${esc(x)}</li>`).join(''); return; }

  let msg;
  if (rule) {
    const n = createSeries(s, rule);
    if (!n) { $('shiftErrors').innerHTML = '<li>Ingen datoer passer regelen. Sjekk ukedagene og sluttdatoen.</li>'; return; }
    msg = `Lagret ${n} ${n === 1 ? 'vakt' : 'vakter'}. ${L.describeRepeat(rule)}`;
  } else if (s.id && s.seriesId && seriesOf(s.seriesId)) {
    const o = ui.shift;
    const changed = ['employerId', 'date', 'start', 'end', 'breakMin', 'note', 'fee', 'status'].some(k => String(o[k] ?? '') !== String(s[k] ?? ''));
    if (!changed) { $('shiftDialog').close(); return; }
    const scope = await choiceBox('Endre gjentakende vakt', 'Hvilke vakter skal endringen gjelde?',
      [['one', 'Bare denne vakta'], ['future', 'Denne og alle senere'], ['all', 'Alle vaktene i serien']]);
    if (!scope) return;
    msg = applySeriesEdit(o, s, scope);
  } else {
    store.upsertShift(s);
    msg = s.id ? 'Vakt oppdatert' : 'Vakt lagret';
  }
  $('shiftDialog').close();
  ui.weekStart = L.mondayOf(L.parseDate(s.date));
  renderWeek();
  toast(msg);
}

$('repeatFields').addEventListener('input', updateRepeatUI);

$('repeatFields').addEventListener('change', updateRepeatUI);

$('fDate').addEventListener('change', () => {
  if (ui.shift || !$('fDate').value) return;
  fillRepeatOptions();
  // Ukedagene i «Egendefinert» følger datoen til brukeren har valgt dager selv.
  if (!ui.repDaysTouched) renderRepDays([L.parseDate($('fDate').value).getDay()]);
  updateRepeatUI();
});

$('fRepDays').addEventListener('change', () => { ui.repDaysTouched = true; });

$('newShiftBtn').addEventListener('click', () => openShift());

$('shiftForm').addEventListener('submit', saveShift);

$('shiftForm').addEventListener('input', updatePreview);

$('fEmp').addEventListener('change', () => {
  togglePayFields(null, true);
  if (ui.shift) { updatePreview(); return; }
  const last = lastShiftFor($('fEmp').value);
  if (last) setFields({ start: last.start, end: last.end, brk: last.breakMin });
  updatePreview();
});

$('deleteShiftBtn').addEventListener('click', async () => {
  const o = ui.shift; if (!o) return;
  const sr = o.seriesId && seriesOf(o.seriesId);
  if (sr) {
    const scope = await choiceBox('Slette gjentakende vakt', `${empById(o.employerId)?.name || ''}, ${fmtDay(o.date)} ${o.start}–${o.end}. ${L.describeRepeat(sr.rule)}.`,
      [['one', 'Bare denne vakta', true], ['future', 'Denne og alle senere', true], ['all', 'Alle vaktene i serien', true]]);
    if (!scope) return;
    $('shiftDialog').close();
    const gone = D().shifts.filter(x => x.id === o.id || (x.seriesId === o.seriesId && (scope === 'all' || (scope === 'future' && x.date >= o.date))));
    const before = structuredClone(D().settings.series || {});
    for (const x of gone) store.deleteShift(x.id);
    if (scope !== 'one') {
      const next = { ...D().settings.series };
      const until = L.isoDate(addDays(L.parseDate(o.date), -1));
      if (scope === 'all' || until < sr.start) delete next[o.seriesId];
      else next[o.seriesId] = { ...sr, rule: { ...sr.rule, end: { type: 'until', until } }, through: [sr.through, until].sort()[0] };
      store.updateSettings({ series: next });
    }
    toast(`Slettet ${gone.length} ${gone.length === 1 ? 'vakt' : 'vakter'}`, () => {
      store.addAll({ shifts: gone }); store.updateSettings({ series: before }); toast('Vaktene er tilbake');
    });
    return;
  }
  $('shiftDialog').close();
  if (await confirmBox('Slette vakta?', `${empById(o.employerId)?.name || ''}, ${fmtDay(o.date)} ${o.start}–${o.end}.`, 'Slett vakt', true)) {
    const gone = { ...o };
    store.deleteShift(gone.id);
    toast('Vakt slettet', () => { store.upsertShift(gone); toast('Vakta er tilbake'); });
  }
});
