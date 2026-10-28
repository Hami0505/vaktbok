// Eksport av vakter: samme tankegang som importen. Velg format, periode og arbeidsgiver, se hvor mange som blir med.
import * as L from '../logic.js';
import { $, D, MONTH, download, esc, store, toast, ui } from './core.js';

let fmt = 'ics';
const HELP = {
  ics: 'Åpnes i iPhone-, Google- eller Outlook-kalenderen. Notater er ikke med.',
  csv: 'Åpnes i Excel, Numbers eller Google Regneark, med timer og estimert lønn.',
};

function chosen() {
  const period = $('expPeriod').value;
  return L.selectForExport(D().shifts, {
    period, ym: ui.month, from: $('expFrom').value || null, to: $('expTo').value || null,
    employerId: $('expEmp').value || 'all', today: L.isoDate(new Date()),
  });
}

function update() {
  document.querySelectorAll('[data-fmt]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.fmt === fmt)));
  $('expFmtHelp').textContent = HELP[fmt];
  $('expRange').hidden = $('expPeriod').value !== 'range';
  const [y, m] = ui.month.split('-').map(Number);
  $('expPeriod').querySelector('[value="month"]').textContent = `${MONTH[m - 1][0].toUpperCase() + MONTH[m - 1].slice(1)} ${y}`;
  const n = chosen().length;
  $('expCount').textContent = n ? `${n} ${n === 1 ? 'vakt' : 'vakter'} blir med.` : 'Ingen vakter i perioden.';
  $('expGo').disabled = !n;
}

export function openExport(el) {
  const emps = D().employers.filter(e => D().shifts.some(s => s.employerId === e.id));
  $('expEmp').innerHTML = '<option value="all">Alle arbeidsgivere</option>' + emps.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  $('expPeriod').value = el?.dataset?.period || 'future';
  update();
  $('exportDialog').showModal();
}

document.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => { fmt = b.dataset.fmt; update(); }));
for (const id of ['expPeriod', 'expFrom', 'expTo', 'expEmp']) $(id).addEventListener('input', update);

$('expForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const list = chosen(); if (!list.length) return;
  const emp = $('expEmp').value !== 'all' ? D().employers.find(e => e.id === $('expEmp').value)?.name : '';
  const name = `vaktbok-${{ future: 'fremover', month: ui.month, range: `${$('expFrom').value || 'start'}-til-${$('expTo').value || 'slutt'}`, all: 'alle' }[$('expPeriod').value]}${emp ? '-' + emp : ''}`.replace(/[^\wæøåÆØÅ.-]+/g, '-');
  if (fmt === 'ics') download(`${name}.ics`, L.toICS(list, D().employers), 'text/calendar;charset=utf-8');
  else download(`${name}.csv`, L.toCSV(D().shifts, D().employers, list), 'text/csv;charset=utf-8');
  $('exportDialog').close();
  toast(`${list.length} ${list.length === 1 ? 'vakt' : 'vakter'} lastet ned`);
});

store.addEventListener('change', () => { if ($('exportDialog').open) update(); });
