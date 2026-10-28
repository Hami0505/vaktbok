import * as L from '../logic.js';
import { newId } from '../store.js';
import { $, CHIPS, D, DAY_LONG, confirmBox, describeRule, empById, esc, kr, num, safeColor, store, taxPct, toast, ui } from './core.js';

// ---------- Arbeidsgivere ----------
export const payLabel = e => L.payType(e) === 'fee' ? (e.pay?.feeDefault ? `${kr(e.pay.feeDefault)}/oppdrag` : 'Honorar')
  : L.payType(e) === 'volunteer' ? 'Frivillig' : `${num(e.rate, 0)} kr/t`;

export function renderEmployers() {
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
      <span class="num">${payLabel(e)}</span>
      <span class="meta">${e.pay?.tax ? `<span class="small">${esc({ pct: `Prosenttrekk ${num(e.pay.tax.pct, 1)} %`, table: `Tabelltrekk, ca. ${num(L.taxPctFor(e), 1)} %`, freeOrg: 'Skattefri organisasjon (inntil 10 000 kr/år)' }[e.pay.tax.mode] || '')}</span><br>` : ''}${L.payType(e) === 'hourly' ? (rules.length ? rules.map(esc).join('<br>') : 'Ingen tillegg') : esc(L.payType(e) === 'fee' ? `Honorar per oppdrag${L.givesHolidayPay(e) ? ', gir feriepenger' : ''}` : `Frivillig arbeid${e.pay?.inWarnings === false ? ', utenfor varsler om hviletid' : ''}`)}${L.payType(e) === 'hourly' && !(Number(e.rate) > 0) ? '<br><span class="flag missing">Mangler timelønn, trykk for å legge inn</span>' : ''}</span>
      <span class="meta num">${n} ${n === 1 ? 'vakt' : 'vakter'}</span></button></div>`;
  }).join('');
}

export function openEmp(e = null) {
  ui.emp = e;
  $('empDialogTitle').textContent = e ? 'Endre arbeidsgiver' : 'Ny arbeidsgiver';
  $('eName').value = e?.name || '';
  $('eRate').value = e ? e.rate : '';
  $('eColor').value = safeColor(e?.color || ['#1F6F6B', '#7A4FB3', '#B3572C', '#2C6FB3', '#2E7D32', '#A8326E'][D().employers.length % 6]);
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
  ui.payType = L.payType(e);
  $('eFee').value = e?.pay?.feeDefault ?? '';
  $('eHoliday').checked = e ? L.givesHolidayPay(e) : false;
  $('eWarn').checked = e?.pay?.inWarnings !== false;
  const tx = e?.pay?.tax || { mode: 'default' };
  $('eTaxMode').value = tx.mode || 'default';
  $('eTaxPct').value = tx.pct ?? ''; $('eSlipGross').value = tx.slipGross ?? ''; $('eSlipTax').value = tx.slipTax ?? '';
  renderRules(); toggleOt(); togglePayType(); toggleTax();
  // «Flere valg» er lukket, med mindre arbeidsgiveren allerede har noe valgt der.
  $('empMore').open = !!(e?.overtime || (e?.pay?.tax && e.pay.tax.mode !== 'default') || e?.archived);
  $('empErrors').innerHTML = '';
  $('empDialog').showModal();
}

export const newRule = (p = {}) => ({ id: newId(), label: '', kind: 'kr', value: 0, days: [1, 2, 3, 4, 5], from: '17:00', to: '21:00', holiday: false, ...p });

export function renderRules() {
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

export function onRuleInput(ev) {
  const row = ev.target.closest('.rule'); if (!row) return;
  const r = ui.rules[Number(row.dataset.i)], t = ev.target;
  if (t.dataset.day) {
    const d = Number(t.dataset.day);
    r.days = t.checked ? [...new Set([...(r.days || []), d])] : (r.days || []).filter(x => x !== d);
  } else if (t.dataset.f === 'holiday') { r.holiday = t.checked; renderRules(); }
  else if (t.dataset.f) r[t.dataset.f] = t.dataset.f === 'value' ? Number(t.value) : t.value;
}

export function toggleOt() { $('otFields').hidden = !$('eOtOn').checked; }

export const PAY_HELP = {
  hourly: 'Lønn per time, med tillegg for kveld, natt, helg og overtid.',
  fee: 'Et avtalt beløp per oppdrag, for eksempel foredrag, kurs eller frilansjobber. Beløpet føres på hver vakt.',
  volunteer: 'Ubetalt arbeid. Timene føres, så du har oversikt og kan lage timelister til attester.',
};

export function togglePayType() {
  const t = ui.payType || 'hourly';
  document.querySelectorAll('[data-paytype]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.paytype === t)));
  $('payHelp').textContent = PAY_HELP[t];
  $('eRateL').hidden = t !== 'hourly';
  $('eFeeL').hidden = t !== 'fee';
  $('eHolidayL').hidden = t !== 'fee';
  $('eWarnL').hidden = t !== 'volunteer';
  $('rulesBox').hidden = $('otBox').hidden = t !== 'hourly';
  $('taxBox').hidden = t === 'volunteer';
}

export function toggleTax() {
  const m = $('eTaxMode').value;
  $('eTaxPctBox').hidden = m !== 'pct';
  $('eTaxTableBox').hidden = m !== 'table';
  const g = Number($('eSlipGross').value), t = Number($('eSlipTax').value);
  $('eTaxHelp').textContent = {
    default: `Standard fra Konto (${num(taxPct(), 1)} %)${D().settings.frikort?.on ? ', eller frikort så lenge det rekker' : ''}.`,
    pct: 'Står på skattekortet. Vanlig for bijobber.',
    table: g > 0 && t >= 0 && t < g ? `Ca. ${num(t / g * 100, 1)} % trekk. Ingen trekk i juni og halvt i desember.` : 'Vanlig hos hovedarbeidsgiveren. Bruk tall fra en vanlig lønnsslipp.',
    freeOrg: 'Skattefritt opp til 10 000 kr i året. Over det blir hele beløpet skattepliktig.',
  }[m];
}

export function saveEmp(ev) {
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
  const t = ui.payType || 'hourly';
  const m = $('eTaxMode').value;
  const tax = t === 'volunteer' || m === 'default' ? null
    : m === 'pct' ? { mode: 'pct', pct: Number($('eTaxPct').value) }
    : m === 'table' ? { mode: 'table', slipGross: Number($('eSlipGross').value), slipTax: Number($('eSlipTax').value) }
    : { mode: 'freeOrg' };
  e.pay = t === 'fee' ? { type: 'fee', feeDefault: $('eFee').value === '' ? null : Number($('eFee').value), holidayPay: $('eHoliday').checked, ...(tax ? { tax } : {}) }
    : t === 'volunteer' ? { type: 'volunteer', inWarnings: $('eWarn').checked }
    : tax ? { type: 'hourly', tax } : null;
  if (t !== 'hourly') e.rate = 0;
  else if ($('eRate').value === '') e.rate = NaN;
  const errs = L.validateEmployer(e);
  if (errs.length) { $('empErrors').innerHTML = errs.map(x => `<li>${esc(x)}</li>`).join(''); return; }
  store.upsertEmployer(e);
  $('empDialog').close();
  toast(ui.emp ? 'Arbeidsgiver oppdatert' : 'Arbeidsgiver lagt til');
}

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

for (const id of ['eTaxMode', 'eSlipGross', 'eSlipTax']) $(id).addEventListener('input', toggleTax);

document.querySelectorAll('[data-paytype]').forEach(b => b.addEventListener('click', () => {
  ui.payType = b.dataset.paytype;
  if (ui.payType === 'fee' && !ui.emp) $('eHoliday').checked = false;
  togglePayType();
}));

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

$('copyRulesFrom').addEventListener('change', ev => {
  const src = empById(ev.target.value); ev.target.value = ''; if (!src) return;
  ui.rules.push(...(src.rules || []).map(r => ({ ...structuredClone(r), id: newId() })));
  if (src.overtime && !$('eOtOn').checked) {
    $('eOtOn').checked = true; $('eOtAfter').value = src.overtime.afterH ?? ''; $('eOtWeek').value = src.overtime.weekH ?? ''; $('eOtPct').value = src.overtime.pct; toggleOt();
  }
  renderRules(); toast(`Tillegg kopiert fra ${src.name}`);
});
