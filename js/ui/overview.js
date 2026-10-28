import * as L from '../logic.js';
import { $, D, DAY, MONTH, download, empById, esc, hasTaxSetup, hrs, kr, money, num, payWord, safeColor, showNet, store, toast, ui, ym } from './core.js';
import { shiftItem } from './week.js';

// ---------- Oversikt: måned og år ----------
export function renderMonth() {
  const [y, m] = ui.month.split('-').map(Number);
  $('monthTitle').textContent = `${MONTH[m - 1][0].toUpperCase()}${MONTH[m - 1].slice(1)} ${y}`;
  const { byEmp, total } = L.monthSummary(D().shifts, D().employers, ui.month, D().settings);
  $('totals').innerHTML = `
    <div class="lead"><b>${kr(money(total))}</b><span>${payWord()[0].toUpperCase() + payWord().slice(1)}</span></div>
    <div><b>${hrs(total.hours)}</b><span>${total.count} vakter</span></div>
    <div><b>${kr(total.holidayPay)}</b><span>Feriepenger opptjent${showNet() ? ' (brutto)' : ''}</span></div>`;
  renderPaySeg();
  const bk = total.byKind, parts = [];
  if (bk.fee.count || bk.volunteer.count) {
    if (bk.hourly.count) parts.push(`Timelønn: ${hrs(bk.hourly.hours)}, ${kr(money(bk.hourly))}`);
    if (bk.fee.count) parts.push(`Honorar og faste beløp: ${bk.fee.count} ${bk.fee.count === 1 ? 'oppdrag' : 'oppdrag'}, ${kr(money(bk.fee))}`);
    if (bk.volunteer.count) parts.push(`Frivillig: ${hrs(bk.volunteer.hours)}`);
  }
  $('kindSplit').textContent = parts.join('. ');
  $('kindSplit').hidden = !parts.length;
  const ids = Object.keys(byEmp);
  if (!ids.length) {
    $('empTable').innerHTML = '<tbody><tr><td class="empty" colspan="6">Ingen vakter denne måneden.</td></tr></tbody>';
  } else {
    $('empTable').innerHTML = `<thead><tr><th>Arbeidsgiver</th><th>Vakter</th><th>Timer</th><th>Tillegg</th><th>Overtid</th><th>${showNet() ? 'Ca. utbetalt' : 'Estimert'}</th></tr></thead><tbody>`
      + ids.map(id => {
        const e = empById(id), o = byEmp[id];
        const subs = Object.values(o.supplements).filter(x => x.hours > 0).map(x => `${esc(x.label)} ${hrs(x.hours)}`).join(', ');
        return `<tr><td><span class="cell-who"><span class="dot" style="background:${safeColor(e?.color)}"></span>${esc(e?.name || 'Ukjent')}</span>${subs ? `<span class="sub">${subs}</span>` : ''}</td>
          <td>${o.count}</td><td>${hrs(o.hours)}</td><td>${kr(o.supplementPay)}</td><td>${o.overtimePay ? kr(o.overtimePay) : '–'}</td><td>${o.kind === 'volunteer' && !o.pay ? 'Frivillig' : kr(money(o))}</td></tr>`;
      }).join('')
      + `</tbody><tfoot><tr><td>Sum</td><td>${total.count}</td><td>${hrs(total.hours)}</td><td>${kr(total.supplementPay)}</td><td>${total.overtimePay ? kr(total.overtimePay) : '–'}</td><td>${kr(money(total))}</td></tr></tfoot>`;
  }
  const chosen = $('sheetEmp').value;
  $('sheetEmp').innerHTML = ids.map(id => `<option value="${id}">${esc(empById(id)?.name)}</option>`).join('')
    + (ids.length > 1 ? '<option value="all">Alle arbeidsgivere</option>' : '');
  if ([...$('sheetEmp').options].some(o => o.value === chosen)) $('sheetEmp').value = chosen;
  $('sheetEmp').hidden = ids.length < 2;
  $('exportMonthBtn').disabled = $('sheetBtn').disabled = !ids.length;
  renderPayslips(byEmp, ids);
  renderYear(y);
  const fkWarn = renderFrikort(y);
  // Frikort er for hele året: vises alltid under År, og under Måned bare når det er noe å varsle om.
  if (ui.ovView !== 'year' && !fkWarn) $('frikortPanel').hidden = true;
  const yv = ui.ovView === 'year';
  $('ovMonth').hidden = yv; $('ovYear').hidden = !yv;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-checked', String((b.dataset.view === 'year') === yv)));
  $('pdfBtn').disabled = !ids.length;

  const warns = L.restWarnings(D().shifts, D().employers, D().settings.minRestH);
  const list = L.shiftsInMonth(D().shifts, ui.month).filter(s => warns[s.id]);
  const weeks = L.weeklyOverLimit(D().shifts, D().employers, D().settings.weekLimitH)
    .filter(w => L.shiftsInMonth(D().shifts, ui.month).some(s => { const k = L.isoWeek(L.parseDate(s.date)); return `${k.year}-U${L.pad(k.week)}` === w.week; }));
  $('warnList').innerHTML = (weeks.map(w => `<div class="flag weekly">Uke ${Number(w.week.slice(-2))}: ${hrs(w.hours)}, over grensen på ${num(D().settings.weekLimitH, 0)} timer.</div>`).join(''))
    + (list.length ? list.map(s => shiftItem(s, warns[s.id], false)).join('') : (weeks.length ? '' : '<p class="muted">Ingen varsler. Alle vakter har nok hvile mellom seg.</p>'));
}

export function renderPaySeg() {
  const net = D().settings.showNet === true;
  document.querySelectorAll('.seg [data-pay]').forEach(b => b.setAttribute('aria-checked', String((b.dataset.pay === 'net') === net)));
  $('netHelp').hidden = !(net && !hasTaxSetup());
  $('netNote').hidden = !(net && hasTaxSetup());
}

export function yearInfoText(m, i) {
  return m.count
    ? `<b>${MONTH[i][0].toUpperCase() + MONTH[i].slice(1)}:</b> ${hrs(m.hours)}, ${kr(money(m))} ${payWord()}, ${m.count} ${m.count === 1 ? 'vakt' : 'vakter'}`
    : `<b>${MONTH[i][0].toUpperCase() + MONTH[i].slice(1)}:</b> ingen vakter`;
}

export function renderFrikort(year) {
  const st = L.frikortStatus(D().shifts, D().employers, D().settings, String(year), L.isoDate(new Date()));
  $('frikortPanel').hidden = !st;
  if (!st) return false;
  $('fkTitle').textContent = `Frikort ${year}`;
  const used = Math.min(1, st.earned / st.limit) * 100, all = Math.min(1, st.total / st.limit) * 100;
  const bar = $('fkBar');
  bar.querySelector('.fk-used').style.width = `${used}%`;
  Object.assign(bar.querySelector('.fk-planned').style, { left: `${used}%`, width: `${Math.max(0, all - used)}%` });
  bar.classList.toggle('over', st.earned > st.limit);
  bar.setAttribute('aria-label', `${kr(st.earned)} av ${kr(st.limit)} brukt`);
  $('fkText').innerHTML = `<b>${kr(st.earned)}</b> av ${kr(st.limit)} brukt. ${st.planned ? `Planlagte vakter resten av året: ${kr(st.planned)}.` : ''} ${st.left ? `Igjen: <b>${kr(st.left)}</b>.` : ''}`;
  const w = $('fkWarn');
  let msg = '', cls = 'rest';
  const newCard = D().settings.frikort?.newCardPct != null;
  if (st.earned > st.limit) {
    msg = newCard ? `Du har passert grensen med ${kr(st.earned - st.limit)}. Arbeidsgiverne trekker nå etter det nye skattekortet ditt.`
      : `Du har passert grensen med ${kr(st.earned - st.limit)}. Uten nytt skattekort trekkes 50 % av det som er over, men for mye trukket får du tilbake. Bestill skattekort på skatteetaten.no.`;
    cls = newCard ? 'rest' : 'overlap';
  }
  else if (st.overBy > 0) msg = newCard ? `Med vaktene du har planlagt, går du over grensen med ca. ${kr(st.overBy)}. Det nye skattekortet ditt brukes da.`
    : `Med planlagte vakter går du over grensen med ca. ${kr(st.overBy)}. Bestill skattekort på skatteetaten.no i tide, så slipper du 50 % trekk.`;
  else if (st.earned >= st.limit * 0.8) msg = 'Over 80 % av frikortet er brukt.';
  w.hidden = !msg; w.className = `flag block ${cls}`; w.textContent = msg;
  return !!msg;
}

export function renderYear(y) {
  const { months, byEmp, total } = L.yearSummary(D().shifts, D().employers, y, D().settings);
  ui.yearMonths = months;
  $('yearTitle').textContent = String(y);
  $('yearTotals').innerHTML = `
    <div class="lead"><b>${kr(money(total))}</b><span>${payWord()[0].toUpperCase() + payWord().slice(1)}</span></div>
    <div><b>${hrs(total.hours)}</b><span>${total.count} vakter</span></div>
    <div><b>${kr(total.holidayPay)}</b><span>Feriepenger opptjent${showNet() ? ' (brutto)' : ''}</span></div>`;
  const max = Math.max(...months.map(m => m.pay), 1);
  // Hver søyle er en knapp: hold over eller fokuser for å se tallene, trykk for å åpne måneden.
  $('yearChart').removeAttribute('role');
  $('yearChart').innerHTML = months.map((m, i) =>
    `<button type="button" class="col${m.ym === ui.month ? ' now' : ''}" data-ym="${m.ym}" data-i="${i}"
      aria-label="${MONTH[i]}: ${m.count ? `${hrs(m.hours)}, ${kr(money(m))}` : 'ingen vakter'}. Trykk for å vise måneden."${m.ym === ui.month ? ' aria-current="true"' : ''}>
      <span class="stack" style="height:${Math.round(m.pay / max * 100)}%">${Object.entries(m.byEmp).filter(([, v]) => v.pay > 0).map(([id, v]) => `<span style="flex:${v.pay};background:${safeColor(empById(id)?.color)}"></span>`).join('')}</span><span class="m">${MONTH[i].slice(0, 1).toUpperCase()}</span></button>`).join('');
  const cur = months.findIndex(m => m.ym === ui.month);
  $('yearInfo').innerHTML = cur >= 0 ? yearInfoText(months[cur], cur) : '';
  const ids = Object.keys(byEmp);
  $('yearTable').innerHTML = ids.length ? `<thead><tr><th>Arbeidsgiver</th><th>Vakter</th><th>Timer</th><th>${showNet() ? 'Ca. utbetalt' : 'Estimert'}</th></tr></thead><tbody>`
    + ids.map(id => { const e = empById(id), o = byEmp[id];
      return `<tr><td><span class="cell-who"><span class="dot" style="background:${safeColor(e?.color)}"></span>${esc(e?.name || 'Ukjent')}</span></td><td>${o.count}</td><td>${hrs(o.hours)}</td><td>${L.payType(e) === 'volunteer' && !o.pay ? 'Frivillig' : kr(money(o))}</td></tr>`; }).join('')
    + '</tbody>' : '';
}

// Samler timelista for valgt arbeidsgiver (eller alle) i måneden som vises.
export function timesheetData() {
  const choice = $('sheetEmp').value || Object.keys(L.monthSummary(D().shifts, D().employers, ui.month).byEmp)[0];
  if (!choice) return null;
  const all = L.calcAll(D().shifts, D().employers);
  const month = L.shiftsInMonth(D().shifts, ui.month);
  const ids = choice === 'all' ? [...new Set(month.map(s => s.employerId))] : [choice];
  const [y, m] = ui.month.split('-').map(Number);
  let grand = 0, count = 0;
  const groups = ids.map(id => {
    const list = month.filter(s => s.employerId === id);
    let sum = 0;
    const rows = list.map(s => { const c = all.get(s.id); sum += c.hours; const d = L.parseDate(s.date);
      return { day: `${DAY[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`, start: s.start, end: s.end, brk: `${s.breakMin || 0} min`, hours: num(c.hours, 2) }; });
    grand += sum; count += list.length;
    return { name: empById(id)?.name || '', rows, sum: num(sum, 2), count: list.length };
  });
  const single = ids.length === 1;
  return { single, employer: single ? empById(ids[0])?.name || '' : 'Alle arbeidsgivere', period: `${MONTH[m - 1]} ${y}`,
    groups, total: num(grand, 2), count, file: `timeliste-${ui.month}-${single ? (empById(ids[0])?.name || 'arbeidsgiver') : 'alle'}.pdf`.replace(/[^\wæøåÆØÅ.-]+/g, '-') };
}

export async function pdfTimesheet() {
  const data = timesheetData(); if (!data) return;
  const btn = $('pdfBtn'); btn.disabled = true; const label = btn.textContent; btn.textContent = 'Lager PDF …';
  // På PC åpnes PDF-en i en ny fane, så du ser den før du laster ned. Fanen må åpnes med en gang du trykker,
  // ellers blokkerer nettleseren den. På mobil brukes delingsarket, som har egen forhåndsvisning.
  const touch = matchMedia('(pointer: coarse)').matches;
  const win = touch ? null : window.open('', '_blank');
  try {
    const { loadJsPDF, buildTimesheetPdf, deliverFile } = await import('../pdf.js');
    const JsPDF = await loadJsPDF();
    const blob = buildTimesheetPdf(JsPDF, data);
    if (win) {
      const url = URL.createObjectURL(new File([blob], data.file, { type: 'application/pdf' }));
      win.opener = null; win.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      toast('Timelista er åpnet i en ny fane. Last den ned eller skriv den ut derfra.');
    } else {
      const res = await deliverFile(blob, data.file);
      if (res === 'downloaded') toast('Timelista er lastet ned som PDF');
    }
  } catch (e) {
    console.warn(e);
    win?.close();
    printTimesheet(data); // reserve: nettleserens utskrift, hvis PDF-biblioteket ikke kan lastes
  } finally { btn.disabled = false; btn.textContent = label; }
}

export function printTimesheet(data) {
  const tables = data.groups.map(g => `${data.single ? '' : `<h2>${esc(g.name)}</h2>`}
    <table><thead><tr><th>Dato</th><th>Start</th><th>Slutt</th><th>Pause</th><th>Timer</th></tr></thead>
    <tbody>${g.rows.map(r => `<tr><td>${r.day}</td><td>${r.start}</td><td>${r.end}</td><td>${r.brk}</td><td>${r.hours}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4"><b>Sum (${g.count} vakter)</b></td><td><b>${g.sum}</b></td></tr></tfoot></table>`).join('');
  $('printArea').innerHTML = `<h1>Timeliste</h1>
    <p><b>Arbeidsgiver:</b> ${esc(data.employer)}<br><b>Periode:</b> ${data.period}<br><b>Navn:</b> ______________________________</p>
    ${tables}${data.single ? '' : `<p><b>Totalt: ${data.total} timer (${data.count} vakter)</b></p>`}
    <div class="sign"><div>Dato og signatur, arbeidstaker</div>${data.single ? '<div>Dato og signatur, arbeidsgiver</div>' : ''}</div>`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  try { print(); } catch { done(); toast('Utskrift er ikke tilgjengelig her. Prøv igjen når du er på nett.'); }
}

export function renderPayslips(byEmp, allIds) {
  const ids = allIds.filter(id => L.payType(empById(id)) !== 'volunteer');
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

export const shiftMonth = n => { const [y, m] = ui.month.split('-').map(Number); ui.month = ym(new Date(y, m - 1 + n, 1)); renderMonth(); };

$('prevMonth').addEventListener('click', () => shiftMonth(-1));

$('prevYear').addEventListener('click', () => shiftMonth(-12));

$('nextYear').addEventListener('click', () => shiftMonth(12));

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { ui.ovView = b.dataset.view; renderMonth(); }));

$('nextMonth').addEventListener('click', () => shiftMonth(1));


$('payslipList').addEventListener('change', ev => {
  const id = ev.target.dataset.paid; if (!id) return;
  const v = ev.target.value === '' ? null : Number(ev.target.value);
  if (v != null && !(v >= 0 && v < 1e7)) { toast('Skriv beløpet som et tall i hele kroner, for eksempel 18500, uten «kr» eller mellomrom.'); return; }
  const payslips = structuredClone(D().settings.payslips || {});
  const month = payslips[ui.month] ||= {};
  if (v == null) delete month[id]; else month[id] = v;
  store.updateSettings({ payslips });
});

document.querySelectorAll('.seg [data-pay]').forEach(b => b.addEventListener('click', () => {
  store.updateSettings({ showNet: b.dataset.pay === 'net' });
}));

$('yearChart').addEventListener('click', ev => {
  const col = ev.target.closest('[data-ym]'); if (!col) return;
  ui.month = col.dataset.ym; ui.ovView = 'month'; renderMonth();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

export const showYearInfo = ev => {
  const col = ev.target.closest('[data-i]'); if (!col || !ui.yearMonths) return;
  const i = Number(col.dataset.i); $('yearInfo').innerHTML = yearInfoText(ui.yearMonths[i], i);
};

$('yearChart').addEventListener('mouseover', showYearInfo);

$('yearChart').addEventListener('focusin', showYearInfo);

$('yearChart').addEventListener('mouseleave', () => {
  const i = (ui.yearMonths || []).findIndex(m => m.ym === ui.month);
  $('yearInfo').innerHTML = i >= 0 ? yearInfoText(ui.yearMonths[i], i) : '';
});


$('sheetBtn').addEventListener('click', async () => {
  const text = L.toTimesheet(D().shifts, D().employers, ui.month, $('sheetEmp').value);
  try { await navigator.clipboard.writeText(text); toast('Timelista er kopiert'); }
  catch { download(`timeliste-${ui.month}.txt`, text, 'text/plain;charset=utf-8'); toast('Nettleseren tillot ikke kopiering, så timelista er lastet ned som tekstfil i stedet.'); }
});
