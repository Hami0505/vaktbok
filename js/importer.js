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
  function preparePreview(saved = null) {
    const emps = D().employers.filter(e => !e.archived);
    if (!emps.length && st.kind === 'ics') {
      dlg.close(); toast('Legg til arbeidsgiveren vaktene gjelder først. Deretter kan du importere.'); setTab('arbeidsgivere'); openEmp(); return;
    }
    const cols = st.kind === 'csv' ? columns() : null;
    const opts = emps.map(e => `<option value="${e.id}">${esc(e.name)}</option>`);
    if (st.kind === 'ics' && emps.length > 1) opts.push('<option value="auto">Finn ut fra navnet i hendelsen</option>');
    if (st.kind === 'csv') opts.unshift('<option value="col">Fra kolonnen Arbeidsgiver</option>');
    $('impEmp').innerHTML = opts.join('');
    if (st.kind === 'csv') $('impEmp').value = cols.employer >= 0 || !emps.length ? 'col' : emps[0].id;
    if (saved && [...$('impEmp').options].some(o => o.value === saved.employer)) $('impEmp').value = saved.employer;
    const ics = st.kind === 'ics';
    for (const id of ['impFromL', 'impToL', 'impContainsL']) $(id).hidden = !ics;
    const today = new Date();
    $('impFrom').value = L.isoDate(saved ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14) : new Date(today.getFullYear(), today.getMonth() - 1, 1));
    $('impTo').value = L.isoDate(new Date(today.getFullYear(), today.getMonth() + 3, 0));
    $('impContains').value = saved?.contains || '';
    $('impBreak').value = saved?.breakMin ?? 0;
    $('impSaveL').hidden = !st.link;
    $('impSave').checked = true;
    st.choice = new Map();
    show(st.kind === 'csv' ? ['impCols', 'impPreview'] : ['impPreview']);
    if (st.link) $('impNext').hidden = true;
    updatePreview();
  }

  const nameMatch = (name) => {
    const n = name.trim().toLowerCase(); if (!n) return null;
    const emps = D().employers;
    return (emps.find(e => e.name.toLowerCase() === n) || emps.find(e => n.includes(e.name.toLowerCase())) || {}).id || null;
  };

  function compute() {
    const choice = $('impEmp').value, breakMin = Number($('impBreak').value) || 0;
    if (st.kind === 'ics') {
      const employerFor = choice === 'auto' ? nameMatch : () => choice;
      return L.icsToShifts(st.events, { employerFor, from: $('impFrom').value, to: $('impTo').value, contains: $('impContains').value.trim(), existing: D().shifts, newId, breakMin });
    }
    const cols = columns();
    const rows = $('impHeader').checked ? st.rows.slice(1) : st.rows;
    // Ukjente navn fra kolonnen blir nye arbeidsgivere (opprettes ved import).
    const employerFor = choice === 'col' ? name => nameMatch(name) || `new:${name.trim()}` : () => choice;
    return L.csvToShifts(rows, cols, { employerFor, defaultEmployerId: choice === 'col' ? null : choice, existing: D().shifts, newId, breakMin });
  }

  const keyOf = s => `${s.date}|${s.start}|${s.end}|${s.title}`;

  function updatePreview() {
    if (st.kind === 'ics' && $('impFrom').value && $('impTo').value && $('impTo').value < $('impFrom').value) {
      st.result = { shifts: [], skipped: {} };
      $('impSummary').innerHTML = '<span class="flag block overlap">«Til og med» må være samme dag som «Fra og med» eller senere.</span>';
      $('impList').innerHTML = ''; setGo(); return;
    }
    st.result = compute();
    const { shifts, skipped } = st.result;
    for (const s of shifts) {
      const c = st.choice.get(keyOf(s));
      if (c) { s.checked = c.checked; if (c.employerId) s.employerId = c.employerId; } else s.checked = true;
    }
    const why = [
      [skipped.outside, 'utenfor perioden'], [skipped.filtered, 'uten teksten du søkte på'], [skipped.allDay, 'heldagshendelser'],
      [skipped.duplicate, 'finnes allerede i Vaktbok'], [skipped.noEmployer, 'uten kjent arbeidsgiver'],
      [skipped.unsupported, 'gjentas månedlig eller årlig (legg dem inn med «Gjenta»)'], [skipped.cancelled, 'avlyste'],
      [skipped.invalid, st.kind === 'csv' ? 'rader uten gyldig dato, start eller slutt' : 'uten gyldig start og slutt, eller lengre enn et døgn'],
    ].filter(([n]) => n).map(([n, t]) => `${n} ${t}`);
    const newNames = [...new Set(shifts.filter(s => s.checked && String(s.employerId).startsWith('new:')).map(s => s.employerId.slice(4)))];
    $('impSummary').innerHTML = (shifts.length ? '' : '<p><b>Ingen nye vakter å importere.</b></p>')
      + (why.length ? `<p class="small muted">Hoppes over: ${esc(why.join(', '))}.</p>` : '')
      + (newNames.length ? `<p class="small">Nye arbeidsgivere opprettes: <b>${esc(newNames.join(', '))}</b>. Timelønn settes til 0 kr, så legg den inn under Arbeidsgivere etterpå.</p>` : '');
    const emps = D().employers;
    const empOpts = (sel) => emps.map(e => `<option value="${e.id}"${e.id === sel ? ' selected' : ''}>${esc(e.name)}</option>`).join('')
      + (String(sel).startsWith('new:') ? `<option value="${esc(sel)}" selected>Ny: ${esc(sel.slice(4))}</option>` : '');
    const shown = shifts.slice(0, 400);
    $('impList').innerHTML = shown.map((s, i) => `
      <div class="imp-row${s.checked ? '' : ' off'}">
        <label class="check"><input type="checkbox" data-row="${i}"${s.checked ? ' checked' : ''}>
          <span><b>${fmtDay(s.date)} ${s.start}–${s.end}</b>${s.title ? `<span class="small muted"> ${esc(s.title)}</span>` : ''}</span></label>
        <select data-row-emp="${i}" aria-label="Arbeidsgiver for ${fmtDay(s.date)} ${s.start}">${empOpts(s.employerId)}</select>
      </div>`).join('') + (shifts.length > 400 ? `<p class="small muted">Viser de første 400 av ${shifts.length}. Snevre inn perioden for å se resten.</p>` : '');
    $('impAllNone').hidden = shifts.length < 2;
    setGo();
  }

  function setGo() {
    const n = (st.result?.shifts || []).filter(s => s.checked).length;
    $('impGo').textContent = n ? `Importer ${n} ${n === 1 ? 'vakt' : 'vakter'}` : 'Importer';
    $('impGo').disabled = !n;
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
        created.set(s.employerId, { id: newId(), name, color: COLORS[(D().employers.length + created.size) % COLORS.length], rate: 0, rules: [], overtime: null, archived: false });
      }
    }
    const shifts = chosen.map(({ checked, title, ...s }) => ({ ...s, employerId: created.get(s.employerId)?.id || s.employerId }));
    store.addAll({ employers: [...created.values()], shifts });
    if (st.link && $('impSave').checked) {
      const links = [...(D().settings.calendarLinks || [])];
      const entry = { url: st.link.url, name: st.link.name || 'Kalender', employer: $('impEmp').value, contains: $('impContains').value.trim(), breakMin: Number($('impBreak').value) || 0, lastSync: new Date().toISOString() };
      const i = links.findIndex(l => l.url === entry.url);
      if (i >= 0) links[i] = entry; else links.push(entry);
      store.updateSettings({ calendarLinks: links });
    }
    dlg.close();
    goToWeek(shifts[0].date);
    toast(`Importerte ${shifts.length} ${shifts.length === 1 ? 'vakt' : 'vakter'}` + (created.size ? `, og opprettet ${created.size} ${created.size === 1 ? 'arbeidsgiver' : 'arbeidsgivere'} med timelønn 0 kr` : ''));
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
      const shifts = (data.shifts || []).filter(s => idMap.has(s.employerId)).map(s => ({ ...s, id: newId(), employerId: idMap.get(s.employerId) }))
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
    if (ev.target.dataset.row !== undefined) { setRow(Number(ev.target.dataset.row), { checked: ev.target.checked }); ev.target.closest('.imp-row').classList.toggle('off', !ev.target.checked); setGo(); return; }
    if (ev.target.dataset.rowEmp !== undefined) { setRow(Number(ev.target.dataset.rowEmp), { employerId: ev.target.value }); updatePreview(); return; }
    if (ev.target.id === 'impSave') return;
    if (ev.target.id === 'impEmp') st.choice = new Map();
    updatePreview();
  });
  $('impAllNone').addEventListener('click', ev => {
    const all = ev.target.dataset.all; if (all === undefined) return;
    (st.result?.shifts || []).forEach((s, i) => setRow(i, { checked: all === '1' }));
    updatePreview();
  });
  $('impForm').addEventListener('submit', ev => { ev.preventDefault(); doImport(); });

  return { open, importJson };
}
