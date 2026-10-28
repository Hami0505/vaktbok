import * as L from '../logic.js';
import { $, D, DAY, DAY_LONG, MONTH, addDays, empById, esc, fgFor, fmtDay, hrs, kr, money, num, payWord, readableBg, safeColor, ui, warningText } from './core.js';

// ---------- Uke ----------
export function segment(s, day) {
  const { start, end } = L.parseShift(s);
  const d0 = day.getTime(), d1 = addDays(day, 1).getTime();
  const a = Math.max(start, d0), b = Math.min(end, d1);
  if (b <= a) return null;
  return { left: (a - d0) / (d1 - d0) * 100, width: (b - a) / (d1 - d0) * 100 };
}

export function renderWeek() {
  const ws = ui.weekStart, we = addDays(ws, 6), today = L.isoDate(new Date());
  const { week } = L.isoWeek(ws);
  const range = ws.getMonth() === we.getMonth()
    ? `${ws.getDate()}.–${we.getDate()}. ${MONTH[we.getMonth()]}`
    : `${ws.getDate()}. ${MONTH[ws.getMonth()]} – ${we.getDate()}. ${MONTH[we.getMonth()]}`;
  $('weekTitle').innerHTML = `Uke ${week}<span class="range">${esc(range)}</span>`;
  $('todayBtn').hidden = L.isoDate(L.mondayOf(new Date())) === L.isoDate(ws);

  const warns = L.restWarnings(D().shifts, D().employers, D().settings.minRestH);
  ui.calc = L.calcAllNet(D().shifts, D().employers, D().settings);
  const from = L.isoDate(addDays(ws, -1)), to = L.isoDate(we);
  const near = D().shifts.filter(s => s.date >= from && s.date <= to);
  let html = '';
  for (let i = 0; i < 7; i++) {
    const day = addDays(ws, i), ds = L.isoDate(day), hol = L.holidayName(ds);
    // Vakter som overlapper samme dag, legges i hvert sitt spor i stedet for oppå hverandre.
    const segs = near.map(s => ({ s, seg: segment(s, day) })).filter(x => x.seg).sort((x, y) => x.seg.left - y.seg.left);
    const laneEnd = [];
    for (const x of segs) {
      let lane = laneEnd.findIndex(end => end <= x.seg.left + 0.01);
      if (lane < 0) lane = laneEnd.length;
      laneEnd[lane] = x.seg.left + x.seg.width; x.lane = lane;
    }
    const lanes = Math.max(1, laneEnd.length);
    const bars = segs.map(({ s, seg, lane }) => {
      const emp = empById(s.employerId), c = readableBg(emp?.color), name = emp ? emp.name : '?';
      const time = seg.left < 1 && s.end <= s.start ? `–${s.end}` : s.start;
      const off = L.isOffered(s);
      return `<button class="bar${warns[s.id] ? ' warn' : ''}${lanes > 1 ? ' laned' : ''}${off ? ' offered' : ''}" data-action="edit-shift" data-id="${s.id}"
        style="left:${seg.left}%;width:${seg.width}%;top:calc(${lane * 100 / lanes}% + 3px);height:calc(${100 / lanes}% - 6px);background:${c};color:${fgFor(c)};--emp-c:${c}"
        aria-label="${off ? 'Tilbudt: ' : ''}${esc(name)}, ${DAY_LONG[day.getDay()]} ${s.start}–${s.end}${warns[s.id] ? ', overlapper eller har kort hvile' : ''}" title="${esc(name)} ${s.start}–${s.end}">${seg.width > 6 ? `<span class="t">${time}</span><span class="n">${esc(name)}</span>` : ''}</button>`;
    }).join('');
    html += `<div class="d${ds === today ? ' today' : ''}${hol ? ' holiday' : ''}">${DAY[day.getDay()]} ${day.getDate()}.<small>${esc(hol || MONTH[day.getMonth()].slice(0, 3))}</small></div>
      <div class="track"${lanes > 1 ? ` style="height:${lanes * 26 + 6}px"` : ''}>${bars}</div>`;
  }
  html += '<div></div><div class="ticks" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>';
  $('week').innerHTML = html;

  const inWeek = D().shifts.filter(s => s.date >= L.isoDate(ws) && s.date <= to)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  let h = 0, pay = 0;
  let offN = 0, offH = 0;
  for (const s of inWeek) { const c = ui.calc.get(s.id); if (L.isOffered(s)) { offN++; offH += c.hours; continue; } h += c.hours; pay += money(c); }
  const confirmedN = inWeek.length - offN;
  $('weekSum').innerHTML = inWeek.length
    ? `<div><b>${hrs(h)}</b><span>${confirmedN} ${confirmedN === 1 ? 'vakt' : 'vakter'} denne uka</span></div><div><b>${kr(pay)}</b><span>${payWord()[0].toUpperCase() + payWord().slice(1)}</span></div>`
      + (offN ? `<p class="offered-note">I tillegg ${offN} ${offN === 1 ? 'tilbudt vakt' : 'tilbudte vakter'} (${hrs(offH)}) som ikke er tatt ennå.</p>` : '')
    : '';

  if (!D().employers.length) {
    $('weekList').innerHTML = `<div class="empty"><p>Legg inn arbeidsgiverne dine først, med timelønn og tillegg.</p>
      <button class="btn primary" data-action="new-emp">Legg til arbeidsgiver</button></div>`;
    return;
  }
  const over = L.weeklyOverLimit(D().shifts, D().employers, D().settings.weekLimitH)
    .find(x => x.week === `${L.isoWeek(ws).year}-U${L.pad(week)}`);
  $('weekList').innerHTML = (over ? `<div class="flag weekly">Du har ${hrs(over.hours)} denne uka til sammen, over grensen din på ${num(D().settings.weekLimitH, 0)} timer.</div>` : '')
    + (inWeek.length ? inWeek.map(s => shiftItem(s, warns[s.id], true)).join('') : '<div class="empty"><p>Ingen vakter denne uka.</p></div>');
}

// Liten døgnstripe per vakt, som gjenspeiler ukestripa: viser når på døgnet vakta ligger.
export function miniStrip(s, color) {
  const a = L.toMinutes(s.start), e = L.toMinutes(s.end);
  const segs = e > a ? [[a, e]] : [[a, 1440], [0, e || 1440]].filter(([x, y]) => y > x);
  return `<span class="mini" aria-hidden="true">${segs.map(([x, y]) => `<span style="left:${x / 14.4}%;width:${(y - x) / 14.4}%;background:${color}"></span>`).join('')}</span>`;
}

export function shiftItem(s, warn, actions) {
  const emp = empById(s.employerId), c = ui.calc?.get(s.id) || L.calcShift(s, emp);
  const color = safeColor(emp?.color);
  const off = L.isOffered(s);
  return `<div class="item shift${off ? ' offered' : ''}">
    <button class="open" data-action="edit-shift" data-id="${s.id}" aria-label="Endre vakt ${esc(emp?.name)} ${fmtDay(s.date)}">
      <span class="when"><b>${fmtDay(s.date)}</b> ${s.start}–${s.end}${L.isOffered(s) ? '<span class="badge">Tilbudt</span>' : ''}${s.seriesId ? '<span class="series-mark" title="Gjentakende vakt" aria-label="gjentakende"> ↻</span>' : ''}</span>
      <span class="num">${hrs(c.hours)}</span>
      <span class="who"><span class="dot" style="background:${color}"></span>${esc(emp ? emp.name : 'Ukjent')}${s.breakMin ? `<span class="muted">, pause ${s.breakMin} min</span>` : ''}${s.note ? `<span class="muted">, ${esc(s.note)}</span>` : ''}</span>
      <span class="meta num">${c.kind === 'volunteer' && !c.pay ? 'Frivillig' : kr(money(c))}${c.overtimeH > 0 ? `, ${hrs(c.overtimeH)} overtid` : ''}</span>
      ${miniStrip(s, color)}
    </button>
    ${warn ? `<div class="flag ${warn.type}">${esc(warningText(warn))}</div>` : ''}
    ${actions ? `<div class="acts">${off ? `<button class="btn primary small-btn" data-action="accept-offer" data-id="${s.id}">Ta vakta</button><button class="btn link" data-action="decline-offer" data-id="${s.id}">Avslå</button>` : ''}<button class="btn link" data-action="copy-menu" data-id="${s.id}">Kopier</button></div>` : ''}
  </div>`;
}

$('prevWeek').addEventListener('click', () => { ui.weekStart = addDays(ui.weekStart, -7); renderWeek(); });

$('nextWeek').addEventListener('click', () => { ui.weekStart = addDays(ui.weekStart, 7); renderWeek(); });

$('todayBtn').addEventListener('click', () => { ui.weekStart = L.mondayOf(new Date()); renderWeek(); });
