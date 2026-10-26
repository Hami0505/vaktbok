// Vaktbok – import av vakter fra kalenderlenke, kalenderfil (.ics), regneark (.csv) og sikkerhetskopi (.json).
// Flyt: velg kilde → (lenke eller kolonner) → forhåndsvisning med avkrysning → importer.
import * as L from './logic.js';

const LINK_ERRORS = {
  'login-required': 'Du må være logget inn for å hente kalendere fra lenke. Logg inn under Konto først.',
  'no-function': 'Serverfunksjonen for kalenderlenker er ikke satt opp ennå. Se «Kalenderlenker» i README for hvordan den legges inn i Supabase.',
  'invalid-url': 'Lenken ser ikke riktig ut. Den skal begynne med webcal:// eller https://.',
  'https-only': 'Lenken må begynne med webcal:// eller https://. Vanlige http-lenker er ikke sikre nok.',
  'host-not-allowed': 'Denne adressen kan ikke brukes. Bruk lenken du fikk fra kalendertjenesten.',
  'not-calendar': 'Lenken peker ikke til en kalender. Bruk iCal- eller webcal-lenken, ikke lenken til selve nettsiden.',
  'too-large': 'Kalenderen er for stor (over 3 MB). Lag gjerne en egen kalender bare for vakter.',
  'timeout': 'Kalenderen svarte ikke innen 10 sekunder. Prøv igjen om litt.',
};

export function setupImporter(ctx) {
  const { store, D, $, esc, toast, fmtDay, setTab, openEmp, newId, confirmBox, friendlyError, goToWeek } = ctx;
  const st = { kind: null, events: null, rows: null, link: null, choice: new Map(), result: null };
  const dlg = $('importDialog');

  // ---------- Visning av steg ----------
  function show(step) {
    for (const id of ['impSource', 'impLink', 'impCols', 'impPreview']) $(id).hidden = true;
    for (const id of step) $(id).hidden = false;
    $('impBack').hidden = step.includes('impSource');
    $('impNext').hidden = !step.includes('impLink') || step.includes('impPreview');
    $('impGo').hidden = !step.includes('impPreview');
    $('impErrors').innerHTML = '';
  }
  const error = msg => { $('impErrors').innerHTML = `<li>${esc(msg)}</li>`; };

  function open() {
    Object.assign(st, { kind: null, events: null, rows: null, link: null, choice: new Map(), result: null });
    renderSavedLinks();
    show(['impSource']);
    dlg.showModal();
  }

  function renderSavedLinks() {
    const links = D().settings.calendarLinks || [];
    $('savedLinks').innerHTML = links.length ? `<h3>Lagrede kalenderlenker</h3>` + links.map((l, i) => `
      <div class="saved-link"><div><b>${esc(l.name || 'Kalender')}</b><span class="small muted">${l.lastSync ? `Sist hentet ${fmtDay(l.lastSync.slice(0, 10))}` : 'Ikke hentet ennå'}</span></div>
      <button type="button" class="btn" data-refresh="${i}">Hent nye vakter</button>
      <button type="button" class="btn link" data-remove-link="${i}" aria-label="Fjern ${esc(l.name || 'kalenderen')}">Fjern</button></div>`).join('') : '';
  }

  // ---------- Kilde: lenke ----------
  function showLink() {
    show(['impLink']);
    const loggedIn = !!store.user;
    $('impLinkLogin').hidden = loggedIn;
    $('impNext').disabled = !loggedIn;
    $('impUrl').value = ''; $('impLinkName').value = '';
    if (loggedIn) $('impUrl').focus();
  }

  async function fetchLink(link, saved = null) {
    if (!store.user) { error(LINK_ERRORS['login-required']); return; }
    const btn = $('impNext'); btn.disabled = true; const label = btn.textContent; btn.textContent = 'Henter …';
    try {
      const text = await store.fetchCalendar(link.url);
      st.kind = 'ics'; st.events = L.parseICS(text); st.link = link;
      if (!st.events.length) { error('Kalenderen er tom. Sjekk at du delte riktig kalender.'); return; }
      preparePreview(saved);
    } catch (e) {
      error(LINK_ERRORS[e.message] || (e.message === 'upstream' ? 'Kalenderen svarte ikke. Sjekk at lenken er riktig og at kalenderen fortsatt er delt.' : friendlyError(e)));
    } finally { btn.disabled = false; btn.textContent = label; }
  }

  // ---------- Kilde: fil ----------
  async function readFile(f) {
    if (!f) return;
    if (f.size > 5e6) { error('Fila er større enn 5 MB. Kalender- og Vaktbok-filer er vanligvis mye mindre, så sjekk at du valgte riktig fil.'); return; }
    let text;
    try { text = await f.text(); } catch { error('Fila kunne ikke åpnes. Prøv å laste den ned på nytt.'); return; }
    if (/BEGIN:VCALENDAR/.test(text)) {
      try { st.events = L.parseICS(text); } catch { error('Kalenderfila kunne ikke leses. Prøv å eksportere den på nytt.'); return; }
      if (!st.events.length) { error('Kalenderfila inneholder ingen hendelser.'); return; }
      st.kind = 'ics'; st.link = null; preparePreview(); return;
    }
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      let data; try { data = JSON.parse(trimmed); } catch { error('Fila ser ut som en Vaktbok-fil, men er skadet. Last ned en ny sikkerhetskopi.'); return; }
      dlg.close(); await importJson(data, f.name); return;
    }
    const rows = L.parseCSV(text);
    if (rows.length < 1 || rows[0].length < 3) { error('Fila er verken en kalenderfil (.ics), et regneark (.csv) eller en Vaktbok-fil (.json). Lagre regneark som CSV før du importerer.'); return; }
    st.kind = 'csv'; st.rows = rows; st.link = null;
    setupColumns(); preparePreview();
  }

  // ---------- Regneark: kolonner ----------
  const COLS = [['date', 'Dato'], ['start', 'Start'], ['end', 'Slutt'], ['breakMin', 'Pause (min)'], ['employer', 'Arbeidsgiver'], ['note', 'Notat']];
  function setupColumns() {
    const header = st.rows[0];
    const guess = L.guessColumns(header);
    const hasHeader = guess.date >= 0 || guess.start >= 0;
    $('impHeader').checked = hasHeader;
    const labels = header.map((h, i) => hasHeader ? `${h || `Kolonne ${i + 1}`}` : `Kolonne ${i + 1} (${h})`);
    const fallback = { date: 0, start: 1, end: 2, breakMin: -1, employer: -1, note: -1 };
    $('impColGrid').innerHTML = COLS.map(([k, label]) => `<label>${label}<select data-col="${k}">
      ${['date', 'start', 'end'].includes(k) ? '' : '<option value="-1">Ingen</option>'}
      ${labels.map((l, i) => `<option value="${i}">${esc(l)}</option>`).join('')}</select></label>`).join('');
    for (const [k] of COLS) {
      const v = hasHeader && guess[k] >= 0 ? guess[k] : fallback[k];
      $('impColGrid').querySelector(`[data-col="${k}"]`).value = String(v);
    }
  }
  const columns = () => Object.fromEntries(COLS.map(([k]) => [k, Number($('impColGrid').querySelector(`[data-col="${k}"]`).value)]));

  // ---------- Forhåndsvisning ----------
  const WORK = /vakt|jobb|skift|turnus|natt|kveld|dagvakt|helg|arbeid|work|shift/i;
  const gkey = t => (t || '').trim().toLowerCase() || '(uten navn)';

  function preparePreview(saved = null) {
    const emps = D().employers.filter(e => !e.archived);
    const ics = st.kind === 'ics';
    if (!ics) {
      const cols = columns();
      const opts = emps.map(e => `<option value="${e.id}">${esc(e.name)}</option>`);
      opts.unshift('<option value="col">Fra kolonnen Arbeidsgiver</option>');
      $('impEmp').innerHTML = opts.join('');
      $('impEmp').value = cols.employer >= 0 || !emps.length ? 'col' : emps[0].id;
    }
    $('impEmpL').hidden = ics;
    $('impGroupsWrap').hidden = !ics;
    for (const id of ['impFromL', 'impToL']) $(id).hidden = !ics;
    const today = new Date();
    $('impFrom').value = L.isoDate(saved ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14) : new Date(today.getFullYear(), today.getMonth() - 1, 1));
    $('impTo').value = L.isoDate(new Date(today.getFullYear(), today.getMonth() + 3, 0));
    $('impBreak').value = saved?.breakMin ?? 0;
    $('impGroupSearch').value = '';
    $('impSaveL').hidden = !st.link;
    $('impSave').checked = true;
    $('impDetails').open = !ics;
    st.choice = new Map();
    st.groups = new Map();
    st.savedGroups = saved?.groups || {};
    show(ics ? ['impPreview'] : ['impCols', 'impPreview']);
    updatePreview();
  }

  const nameMatch = (name) => {
    const n = name.trim().toLowerCase(); if (!n) return null;
    const emps = D().employers;
    return (emps.find(e => e.name.toLowerCase() === n) || emps.find(e => n.includes(e.name.toLowerCase())) || {}).id || null;
  };

  // Kalender: samle hendelsene i perioden etter navn, og husk valgene per gruppe.
  function refreshGroups() {
    const all = L.icsToShifts(st.events, { employerFor: () => '_', from: $('impFrom').value, to: $('impTo').value, existing: [], newId });
    const counts = new Map();
    for (const s of all.shifts) {
      const k = gkey(s.title); const g = counts.get(k) || { title: s.title.trim() || '(uten navn)', count: 0, items: [] };
      g.count++; g.items.push(s); counts.set(k, g);
    }
    const emps = D().employers.filter(e => !e.archived);
    for (const [k, g] of counts) {
      const prev = st.groups.get(k), saved = st.savedGroups[k];
      const hint = groupHint(g.items);
      if (prev) { prev.count = g.count; prev.hint = hint; continue; }
      const match = nameMatch(g.title);
      const savedEmp = saved && (saved.emp?.startsWith('new:') || D().employers.some(e => e.id === saved.emp)) ? saved.emp : null;
      st.groups.set(k, {
        title: g.title, count: g.count, hint,
        on: saved ? saved.on : !!(match || WORK.test(g.title)),
        emp: savedEmp || match || (emps[0] ? emps[0].id : `new:${g.title}`),
      });
    }
    for (const k of [...st.groups.keys()]) if (!counts.has(k)) st.groups.get(k).count = 0;
    st.base = all;
  }

  // Kort beskrivelse av når hendelsene i en gruppe skjer, f.eks. «sep–des, oftest tir og ons 17:50–21:10».
  const MON = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
  const WD = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
  function groupHint(items) {
    const dates = items.map(s => s.date).sort();
    const m = d => MON[Number(d.slice(5, 7)) - 1];
    const span = m(dates[0]) === m(dates.at(-1)) ? m(dates[0]) : `${m(dates[0])}–${m(dates.at(-1))}`;
    if (items.length < 3) return items.length === 1 ? `${fmtDay(dates[0])} ${items[0].start}–${items[0].end}` : `${span}, ${items.map(s => `${s.start}–${s.end}`).filter((v, i, a) => a.indexOf(v) === i).join(' og ')}`;
    const tally = arr => [...arr.reduce((mp, v) => mp.set(v, (mp.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
    const days = tally(items.map(s => L.parseDate(s.date).getDay())).filter(([, n]) => n >= items.length * 0.2).slice(0, 3).map(([d]) => WD[d]);
    const [time] = tally(items.map(s => `${s.start}–${s.end}`));
    return `${span}, oftest ${days.join(' og ')}${time[1] >= items.length * 0.3 ? ` ${time[0]}` : ''}`;
  }

  function compute() {
    const breakMin = Number($('impBreak').value) || 0;
    if (st.kind === 'ics') {
      const employerFor = t => { const g = st.groups.get(gkey(t)); return g && g.on && g.emp !== '__custom' ? g.emp : null; };
      const r = L.icsToShifts(st.events, { employerFor, from: $('impFrom').value, to: $('impTo').value, existing: D().shifts, newId, breakMin });
      r.skipped.deselected = r.skipped.noEmployer; r.skipped.noEmployer = 0;
      return r;
    }
    const choice = $('impEmp').value;
    const cols = columns();
    const rows = $('impHeader').checked ? st.rows.slice(1) : st.rows;
    const employerFor = choice === 'col' ? name => nameMatch(name) || `new:${name.trim()}` : () => choice;
    return L.csvToShifts(rows, cols, { employerFor, defaultEmployerId: choice === 'col' ? null : choice, existing: D().shifts, newId, breakMin });
  }

  const keyOf = s => `${s.date}|${s.start}|${s.end}|${s.title}`;
  const empName = id => String(id).startsWith('new:') ? `Ny: ${id.slice(4)}` : (D().employers.find(e => e.id === id) || {}).name || '';
  // Nye arbeidsgivere som allerede er valgt i en gruppe, kan velges av andre grupper også.
  const pendingNew = () => [...new Set([...(st.groups?.values() || [])].filter(g => g.on && String(g.emp).startsWith('new:')).map(g => g.emp))];
  const empOptions = (sel, title, withCustom = false) => {
    const emps = D().employers.filter(e => !e.archived || e.id === sel);
    const newVal = `new:${title}`;
    const pending = pendingNew().filter(v => v !== newVal);
    if (String(sel).startsWith('new:') && sel !== newVal && !pending.includes(sel)) pending.push(sel);
    return emps.map(e => `<option value="${e.id}"${e.id === sel ? ' selected' : ''}>${esc(e.name)}</option>`).join('')
      + pending.map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>Ny: ${esc(v.slice(4))}</option>`).join('')
      + `<option value="${esc(newVal)}"${sel === newVal ? ' selected' : ''}>Ny arbeidsgiver: ${esc(title)}</option>`
      + (withCustom ? `<option value="__custom"${sel === '__custom' ? ' selected' : ''}>Ny arbeidsgiver med eget navn …</option>` : '');
  };

  function renderGroups() {
    const q = $('impGroupSearch').value.trim().toLowerCase();
    const groups = [...st.groups.entries()].filter(([, g]) => g.count > 0).sort((a, b) => (b[1].on - a[1].on) || b[1].count - a[1].count);
    const visible = groups.filter(([, g]) => !q || g.title.toLowerCase().includes(q));
    $('impGroupTools').hidden = groups.length < 2;
    $('impGroups').innerHTML = visible.map(([k, g]) => `
      <div class="imp-row imp-group${g.on ? '' : ' off'}">
        <label class="check"><input type="checkbox" data-group="${esc(k)}"${g.on ? ' checked' : ''}>
          <span><b>${esc(g.title)}</b> <span class="count">(${g.count})</span><span class="hint">${esc(g.hint || '')}</span></span></label>
        <div class="group-emp">
          <select data-group-emp="${esc(k)}" aria-label="Arbeidsgiver for ${esc(g.title)}"${g.on ? '' : ' disabled'}>${empOptions(g.custom ? '__custom' : g.emp, g.title, true)}</select>
          ${g.custom && g.on ? `<input type="text" data-group-name="${esc(k)}" value="${esc(g.customName || '')}" maxlength="60" placeholder="Navn på arbeidsgiver" aria-label="Navn på ny arbeidsgiver for ${esc(g.title)}">` : ''}
        </div>
      </div>`).join('') || `<p class="small muted" style="padding:10px">${groups.length ? 'Ingen navn passer søket.' : 'Ingen hendelser med klokkeslett i perioden.'}</p>`;
  }

  function updatePreview() {
    if (st.kind === 'ics' && $('impFrom').value && $('impTo').value && $('impTo').value < $('impFrom').value) {
      st.result = { shifts: [], skipped: {} };
      $('impSummary').innerHTML = '<span class="flag block overlap">«Til og med» må være samme dag som «Fra og med» eller senere.</span>';
      $('impList').innerHTML = ''; $('impGroups').innerHTML = ''; setGo(); return;
    }
    if (st.kind === 'ics') { refreshGroups(); renderGroups(); }
    st.result = compute();
    const { shifts, skipped } = st.result;
    for (const s of shifts) {
      const c = st.choice.get(keyOf(s));
      s.checked = c ? c.checked : true;
      if (c && c.employerId && st.kind === 'csv') s.employerId = c.employerId;
    }
    const why = [
      [skipped.deselected, 'hører til hendelser du ikke har krysset av'],
      [skipped.outside, 'utenfor perioden'], [skipped.allDay, 'heldagshendelser'],
      [skipped.duplicate, 'finnes allerede i Vaktbok'], [skipped.noEmployer, 'uten kjent arbeidsgiver'],
      [skipped.unsupported, 'gjentas månedlig eller årlig (legg dem inn med «Gjenta»)'], [skipped.cancelled, 'avlyste'],
      [skipped.invalid, st.kind === 'csv' ? 'rader uten gyldig dato, start eller slutt' : 'uten gyldig start og slutt, eller lengre enn et døgn'],
    ].filter(([n]) => n).map(([n, t]) => `${n} ${t}`);
    const newNames = [...new Set(shifts.filter(s => s.checked && String(s.employerId).startsWith('new:')).map(s => s.employerId.slice(4)))];
    const missing = st.kind === 'ics' ? [...st.groups.values()].filter(g => g.on && g.count && g.emp === '__custom').map(g => g.title) : [];
    st.missingNames = missing;
    $('impSummary').innerHTML = (missing.length ? `<p class="flag block rest">Skriv navn på den nye arbeidsgiveren for ${esc(missing.map(t => `«${t}»`).join(', '))}.</p>` : '')
      + (shifts.length ? '' : `<p><b>Ingen vakter valgt.</b>${st.kind === 'ics' ? ' Kryss av for hendelsene som er vakter.' : ''}</p>`)
      + (newNames.length ? `<p class="small">Nye arbeidsgivere opprettes: <b>${esc(newNames.join(', '))}</b>. Timelønn settes til 0 kr, så legg den inn under Arbeidsgivere etterpå.</p>` : '')
      + (why.length ? `<p class="small muted">Hoppes over: ${esc(why.join(', '))}.</p>` : '');
    const shown = shifts.slice(0, 400);
    $('impList').innerHTML = shown.map((s, i) => `
      <div class="imp-row${s.checked ? '' : ' off'}">
        <label class="check"><input type="checkbox" data-row="${i}"${s.checked ? ' checked' : ''}>
          <span><b>${fmtDay(s.date)} ${s.start}–${s.end}</b>${s.title ? `<span class="small muted"> ${esc(s.title)}</span>` : ''}</span></label>
        ${st.kind === 'csv'
          ? `<select data-row-emp="${i}" aria-label="Arbeidsgiver for ${fmtDay(s.date)} ${s.start}">${empOptions(s.employerId, s.title || 'Arbeidsgiver')}</select>`
          : `<span class="emp">${esc(empName(s.employerId))}</span>`}
      </div>`).join('') + (shifts.length > 400 ? `<p class="small muted">Viser de første 400 av ${shifts.length}. Snevre inn perioden for å se resten.</p>` : '');
    $('impDetailsSum').textContent = `Se og velg enkeltvakter (${shifts.length})`;
    $('impDetails').hidden = !shifts.length;
    $('impAllNone').hidden = shifts.length < 2;
    setGo();
  }

  function setGo() {
    const n = (st.result?.shifts || []).filter(s => s.checked).length;
    $('impGo').textContent = n ? `Importer ${n} ${n === 1 ? 'vakt' : 'vakter'}` : 'Importer';
    $('impGo').disabled = !n || !!(st.missingNames || []).length;
  }

  function setRow(i, patch) {
    const s = st.result.shifts[i]; if (!s) return;
    Object.assign(s, patch);
    st.choice.set(keyOf(s), { checked: s.checked, employerId: patch.employerId || st.choice.get(keyOf(s))?.employerId });
  }

  function doImport() {
    const chosen = (st.result?.shifts || []).filter(s => s.checked);
    if (!chosen.length) return;
    const created = new Map();
    const COLORS = ['#1F6F6B', '#7A4FB3', '#B3572C', '#2C6FB3', '#3D8B3D', '#A8326E'];
    for (const s of chosen) {
      if (String(s.employerId).startsWith('new:') && !created.has(s.employerId)) {
        const name = s.employerId.slice(4).slice(0, 60) || 'Arbeidsgiver';
        const same = D().employers.find(e => e.name.toLowerCase() === name.toLowerCase());
        created.set(s.employerId, same || { id: newId(), name, color: COLORS[(D().employers.length + created.size) % COLORS.length], rate: 0, rules: [], overtime: null, archived: false, isNew: true });
      }
    }
    const newEmps = [...created.values()].filter(e => e.isNew).map(({ isNew, ...e }) => e);
    const shifts = chosen.map(({ checked, title, ...s }) => ({ ...s, employerId: created.get(s.employerId)?.id || s.employerId }));
    store.addAll({ employers: newEmps, shifts });
    if (st.link && $('impSave').checked) {
      const groups = {};
      for (const [k, g] of st.groups) if (g.emp !== '__custom') groups[k] = { on: g.on, emp: created.get(g.emp)?.id || g.emp };
      const links = [...(D().settings.calendarLinks || [])];
      const entry = { url: st.link.url, name: st.link.name || 'Kalender', breakMin: Number($('impBreak').value) || 0, groups, lastSync: new Date().toISOString() };
      const i = links.findIndex(l => l.url === entry.url);
      if (i >= 0) links[i] = entry; else links.push(entry);
      store.updateSettings({ calendarLinks: links });
    }
    dlg.close();
    goToWeek(shifts[0].date);
    toast(`Importerte ${shifts.length} ${shifts.length === 1 ? 'vakt' : 'vakter'}` + (newEmps.length ? `, og opprettet ${newEmps.length} ${newEmps.length === 1 ? 'arbeidsgiver' : 'arbeidsgivere'} med timelønn 0 kr` : ''), () => {
      for (const sh of shifts) store.deleteShift(sh.id);
      for (const e of newEmps) store.deleteEmployer(e.id);
      toast('Importen er angret');
    });
  }

  // ---------- Sikkerhetskopi (.json) og prototype ----------
  // Arbeidsgivere med samme navn slås sammen, og vakter som finnes fra før hoppes over.
  async function importJson(data, label) {
    let parsed;
    if (data.app === 'Vaktbok' && data.format === 2) {
      const idMap = new Map();
      const employers = [];
      for (const e of data.employers || []) {
        const same = D().employers.find(x => x.name.trim().toLowerCase() === String(e.name || '').trim().toLowerCase());
        if (same) { idMap.set(e.id, same.id); continue; }
        const id = newId(); idMap.set(e.id, id);
        const emp = { ...e, id, rules: (e.rules || []).map(r => ({ ...r, id: newId() })) };
        if (!L.validateEmployer(emp).length) employers.push(emp);
      }
      const known = [...D().employers, ...employers];
      const shifts = (data.shifts || []).filter(s => idMap.has(s.employerId)).map(s => ({ ...s, id: newId(), employerId: idMap.get(s.employerId), seriesId: null }))
        .filter(s => !L.validateShift(s, known).length);
      parsed = { employers, shifts, merged: idMap.size - employers.length };
    } else {
      const m = L.migrateV1(data, newId);
      parsed = { ...m, merged: 0 };
    }
    const seen = new Set(D().shifts.map(L.shiftKey));
    const fresh = parsed.shifts.filter(s => { const k = L.shiftKey(s); if (seen.has(k)) return false; seen.add(k); return true; });
    const dup = parsed.shifts.length - fresh.length;
    if (!parsed.employers.length && !fresh.length) {
      toast(dup ? `Alle ${dup} vaktene i fila finnes allerede i Vaktbok.` : 'Fila inneholder ingen arbeidsgivere eller vakter som kunne leses.');
      return false;
    }
    const parts = [`${fresh.length} nye vakter`, `${parsed.employers.length} nye arbeidsgivere`];
    if (parsed.merged) parts.push(`${parsed.merged} arbeidsgivere finnes fra før og slås sammen`);
    if (dup) parts.push(`${dup} vakter finnes allerede og hoppes over`);
    const ok = await confirmBox('Importere data?', `${label}: ${parts.join(', ')}.`, 'Importer');
    if (!ok) return false;
    store.addAll({ employers: parsed.employers, shifts: fresh });
    toast(`Importerte ${fresh.length} vakter`);
    return true;
  }

  // ---------- Hendelser ----------
  $('impSource').addEventListener('click', async ev => {
    const src = ev.target.closest('[data-src]');
    if (src?.dataset.src === 'link') showLink();
    if (src?.dataset.src === 'file') $('impFile').click();
    const r = ev.target.closest('[data-refresh]');
    if (r) { const l = D().settings.calendarLinks[Number(r.dataset.refresh)]; if (l) { show(['impLink']); $('impUrl').value = l.url; $('impLinkName').value = l.name || ''; await fetchLink({ url: l.url, name: l.name }, l); } }
    const rm = ev.target.closest('[data-remove-link]');
    if (rm) {
      const links = [...(D().settings.calendarLinks || [])]; const [gone] = links.splice(Number(rm.dataset.removeLink), 1);
      store.updateSettings({ calendarLinks: links }); renderSavedLinks(); toast(`«${gone?.name || 'Kalenderen'}» er fjernet fra Vaktbok`);
    }
  });
  $('impFile').addEventListener('change', async ev => { const f = ev.target.files[0]; ev.target.value = ''; await readFile(f); });
  $('impNext').addEventListener('click', () => {
    const url = $('impUrl').value.trim();
    if (!url) { error('Lim inn lenken til kalenderen først.'); $('impUrl').focus(); return; }
    if (!/^(webcals?|https?):\/\//i.test(url)) { error(LINK_ERRORS['invalid-url']); return; }
    fetchLink({ url, name: $('impLinkName').value.trim() });
  });
  $('impBack').addEventListener('click', () => { renderSavedLinks(); show(['impSource']); });
  $('impCols').addEventListener('change', () => { st.choice = new Map(); updatePreview(); });
  $('impPreview').addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.row !== undefined) { setRow(Number(t.dataset.row), { checked: t.checked }); t.closest('.imp-row').classList.toggle('off', !t.checked); setGo(); return; }
    if (t.dataset.rowEmp !== undefined) { setRow(Number(t.dataset.rowEmp), { employerId: t.value }); updatePreview(); return; }
    if (t.dataset.group !== undefined) { st.groups.get(t.dataset.group).on = t.checked; st.choice = new Map(); updatePreview(); return; }
    if (t.dataset.groupEmp !== undefined) {
      const g = st.groups.get(t.dataset.groupEmp);
      g.custom = t.value === '__custom';
      g.emp = g.custom ? (g.customName ? `new:${g.customName}` : '__custom') : t.value;
      updatePreview();
      if (g.custom) $('impGroups').querySelector(`[data-group-name="${CSS.escape(t.dataset.groupEmp)}"]`)?.focus();
      return;
    }
    if (t.dataset.groupName !== undefined) {
      const g = st.groups.get(t.dataset.groupName);
      g.customName = t.value.trim();
      g.emp = g.customName ? `new:${g.customName}` : '__custom';
      clearTimeout(st.nameTimer); st.nameTimer = setTimeout(() => { const pos = t.selectionStart, k = t.dataset.groupName; updatePreview(); const el = $('impGroups').querySelector(`[data-group-name="${CSS.escape(k)}"]`); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 400);
      return;
    }
    if (t.id === 'impGroupSearch') { renderGroups(); return; }
    if (t.id === 'impSave') return;
    if (t.id === 'impEmp') st.choice = new Map();
    updatePreview();
  });
  $('impAllNone').addEventListener('click', ev => {
    const all = ev.target.dataset.all; if (all === undefined) return;
    (st.result?.shifts || []).forEach((s, i) => setRow(i, { checked: all === '1' }));
    updatePreview();
  });
  $('impGroupTools').addEventListener('click', ev => {
    const all = ev.target.dataset.gall; if (all === undefined) return;
    const q = $('impGroupSearch').value.trim().toLowerCase();
    for (const g of st.groups.values()) if (!q || g.title.toLowerCase().includes(q)) g.on = all === '1';
    st.choice = new Map(); updatePreview();
  });
  $('impForm').addEventListener('submit', ev => { ev.preventDefault(); doImport(); });

  return { open, importJson };
}
