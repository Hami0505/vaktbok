import * as L from '../logic.js';
import { newId } from '../store.js';
import { config } from '../config.js';
import { $, D, confirmBox, contact, download, esc, friendlyError, store, toast, ui } from './core.js';
import { setTab } from '../app.js';

// ---------- Konto ----------
// ---------- Kalenderabonnement ----------
let feedCache = { user: null, token: undefined };
async function renderFeed() {
  const panel = $('feedPanel');
  panel.hidden = !store.user;
  if (!store.user) return;
  const body = $('feedBody');
  try {
    if (feedCache.user !== store.user.id) feedCache = { user: store.user.id, token: await store.getFeed() };
    const token = feedCache.token;
    body.innerHTML = token ? `
      <div class="feed-link"><input type="text" id="feedUrl" readonly value="${esc(store.feedUrl(token))}" aria-label="Kalenderlenke">
        <button class="btn primary" type="button" data-feed="copy">Kopier</button></div>
      <div class="row"><button class="btn link" type="button" data-feed="new">Lag ny lenke</button><button class="btn link" type="button" data-feed="off">Slå av</button></div>`
      : '<div class="row"><button class="btn primary" type="button" data-feed="new">Lag kalenderlenke</button></div>';
  } catch (e) {
    body.innerHTML = /calendar_feeds|42P01|PGRST205/i.test(e.message)
      ? '<p class="flag block rest">Databasen mangler tabellen for kalenderlenker. Kjør oppdatert SQL fra README i Supabase.</p>'
      : `<p class="flag block rest">${esc(friendlyError(e))}</p>`;
  }
}

$('feedBody').addEventListener('click', async ev => {
  const a = ev.target.closest('[data-feed]')?.dataset.feed; if (!a) return;
  try {
    if (a === 'copy') {
      const url = $('feedUrl').value;
      try { await navigator.clipboard.writeText(url); toast('Lenken er kopiert. Lim den inn i kalenderappen.'); }
      catch { $('feedUrl').select(); toast('Merk lenken og kopier den.'); }
      return;
    }
    if (a === 'new') {
      if (ev.target.textContent.includes('ny') && !(await confirmBox('Lage ny lenke?', 'Den gamle lenken slutter å virke, så du må legge inn den nye i kalenderen.', 'Lag ny lenke'))) return;
      await store.newFeed(); toast('Kalenderlenken er klar');
    }
    if (a === 'off') {
      if (!(await confirmBox('Slå av kalenderlenken?', 'Vaktene forsvinner fra kalenderen ved neste oppdatering.', 'Slå av', true))) return;
      await store.deleteFeed(); toast('Kalenderlenken er slått av');
    }
    feedCache.user = null; renderFeed();
  } catch (e) { toast(friendlyError(e)); }
});

// Statistikk-knappen vises bare for administrator. Svaret huskes per bruker.
let adminCache = { user: null, yes: false };
async function renderAdminButton() {
  const box = $('adminBtnBox'); if (!box) return;
  if (!store.user) { box.hidden = true; return; }
  if (adminCache.user !== store.user.id) adminCache = { user: store.user.id, yes: await store.isAdmin() };
  box.hidden = !adminCache.yes;
}

export function renderAccount() {
  renderFeed();
  renderAdminButton();
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
      ${(config.providers || []).includes('google') ? `<button class="btn google-btn" type="button" data-action="login-google"><span aria-hidden="true">G</span> Fortsett med Google</button>
      <p class="or small muted">eller få en kode på e-post</p>` : ''}
      <form id="loginForm" class="form-row">
        <label>E-post<input type="email" id="emailInput" autocomplete="email" required></label>
        <button class="btn primary" type="submit">Send kode</button>
      </form>`;
  } else {
    const n = store.pending;
    p.innerHTML = `<h2>Konto</h2>
      ${store.profile?.display_name ? `<p class="hello">Hei, ${esc(store.profile.display_name)}</p>` : ''}
      <p>Du er logget inn med <b>${esc(store.user.email)}</b></p>
      ${store.missingCols?.size ? `<p class="flag block rest">Databasen mangler ${[...store.missingCols].map(c => ({ series_id: 'gjentakende vakter', fee: 'beløp per vakt', pay: 'honorar og frivillig' })[c]).join(' og ')}. Vaktene lagres, men dette synkes ikke mellom enheter før du kjører oppdatert SQL fra README i Supabase.</p>` : ''}
      <p class="small muted">${n ? `${n} ${n === 1 ? 'endring' : 'endringer'} venter på å bli synket.` : 'Alle endringer er synket.'}${store.lastError ? ` ${esc(friendlyError(store.lastError))}${contact ? ` Vedvarer feilen, kontakt <a href="mailto:${esc(contact)}">${esc(contact)}</a>.` : ''}` : ''}</p>
      ${store.noProfiles ? '<p class="flag block rest">Databasen mangler tabellen for navn og aktivitet. Kjør oppdatert SQL fra README i Supabase.</p>' : ''}
      <div class="row"><button class="btn" data-action="sync-now">Synk nå</button>${store.noProfiles ? '' : '<button class="btn" data-action="edit-name">Endre navn</button>'}<button class="btn" data-action="sign-out">Logg ut</button></div>`;
  }
  const s = D().settings;
  $('sHoliday').value = String(s.holidayPayPct);
  $('sRest').value = s.minRestH;
  $('sWeek').value = s.weekLimitH;
  $('sTax').value = s.taxPct || '';
  $('sFkOn').checked = !!s.frikort?.on;
  $('sFkFields').hidden = !s.frikort?.on;
  $('sFkLimit').value = s.frikort?.limit ?? L.FRIKORT_DEFAULT;
  $('sFkOther').value = s.frikort?.otherIncome || '';
  $('sFkNew').checked = s.frikort?.newCardPct != null;
  $('sFkNewPct').value = s.frikort?.newCardPct ?? '';
  $('sFkNewBox').hidden = !$('sFkNew').checked;
  $('dataNote').textContent = store.user
    ? 'Lagret på server i EU og synket mellom enhetene dine. Du kan laste ned eller slette alt når som helst.'
    : 'Alt lagres i denne nettleseren. Sletter du nettleserdata, forsvinner vaktene. Last ned en kopi jevnlig.';
  $('deleteAccountBtn').hidden = !store.user;
  $('demoBtn').hidden = !!store.user || !onlyDemo();
  $('demoBtn').textContent = D().employers.length ? 'Lag nye eksempeldata' : 'Prøv med eksempeldata';
}

// ---------- Import og eksempeldata ----------
export const DEMO_KEY = 'vaktbok:demo';

export const demoIds = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch { return []; } };

// Eksempeldata kan lages på nytt så lenge alt som finnes, er eksempeldata.
export const onlyDemo = () => { const ids = new Set(demoIds()); return D().employers.every(e => ids.has(e.id)); };

export async function loadDemo() {
  const { makeDemo } = await import('../demo.js');
  const old = new Set(demoIds());
  for (const e of D().employers.filter(e => old.has(e.id))) store.deleteEmployer(e.id);
  const { employers, shifts } = makeDemo({ newId });
  store.addAll({ employers, shifts });
  localStorage.setItem(DEMO_KEY, JSON.stringify(employers.map(e => e.id)));
  toast(old.size ? 'Nye eksempeldata laget' : 'Eksempeldata lagt inn');
  ui.weekStart = L.mondayOf(new Date());
  setTab('uke');
}

$('settingsForm').addEventListener('change', () => {
  $('sFkFields').hidden = !$('sFkOn').checked;
  $('sFkNewBox').hidden = !$('sFkNew').checked;
  const f = { rest: $('sRest'), week: $('sWeek'), tax: $('sTax'), fkLimit: $('sFkLimit'), fkOther: $('sFkOther'), fkNewPct: $('sFkNewPct') };
  const rest = Number(f.rest.value), week = Number(f.week.value), tax = f.tax.value === '' ? 0 : Number(f.tax.value);
  const errs = [];
  const check = (el, ok, msg) => { el.setAttribute('aria-invalid', String(!ok)); if (!ok) errs.push(msg); };
  check(f.rest, f.rest.value !== '' && rest >= 0 && rest <= 24, 'Minste hviletid må være mellom 0 og 24 timer. Arbeidsmiljøloven bruker 11 timer som hovedregel.');
  check(f.week, f.week.value !== '' && week >= 1 && week <= 168, 'Ukegrensen må være mellom 1 og 168 timer. 48 timer er vanlig.');
  check(f.tax, tax >= 0 && tax <= 60, 'Skattetrekket må være mellom 0 og 60 prosent. Du finner det på skattekortet ditt.');
  const fkOn = $('sFkOn').checked, fkLimit = f.fkLimit.value === '' ? L.FRIKORT_DEFAULT : Number(f.fkLimit.value), fkOther = f.fkOther.value === '' ? 0 : Number(f.fkOther.value);
  if (fkOn) {
    check(f.fkLimit, fkLimit >= 1000 && fkLimit <= 1000000, 'Frikortgrensen må være mellom 1 000 og 1 000 000 kr. For 2026 er den 100 000 kr.');
    check(f.fkOther, fkOther >= 0 && fkOther <= 10000000, 'Inntekt utenfor Vaktbok må være 0 kr eller mer.');
    if ($('sFkNew').checked) check(f.fkNewPct, f.fkNewPct.value !== '' && Number(f.fkNewPct.value) >= 0 && Number(f.fkNewPct.value) <= 60, 'Skriv inn prosenten fra det nye skattekortet (0–60 %).');
  }
  const fkNewPct = fkOn && $('sFkNew').checked && f.fkNewPct.value !== '' ? Number(f.fkNewPct.value) : null;
  $('settingsErrors').innerHTML = errs.map(x => `<li>${esc(x)}</li>`).join('');
  if (errs.length) return;
  store.updateSettings({ holidayPayPct: Number($('sHoliday').value), minRestH: rest, weekLimitH: week, taxPct: tax,
    frikort: fkOn ? { on: true, limit: fkLimit, otherIncome: fkOther, newCardPct: fkNewPct } : (D().settings.frikort ? { ...D().settings.frikort, on: false } : null) });
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

// ---------- Navn ----------
export function openNameDialog(required) {
  const d = $('nameDialog');
  if (d.open) return;
  $('nameTitle').textContent = required ? 'Hva vil du kalles?' : 'Endre navn';
  $('nameInput').value = store.profile?.display_name || store.user?.name || '';
  $('nameErrors').innerHTML = '';
  $('nameCancel').hidden = required;
  $('nameDialog').querySelector('.dlg-x').hidden = required;
  d.dataset.required = required ? '1' : '';
  d.showModal();
  $('nameInput').focus();
}

// Navnet må fylles inn: Escape lukker ikke vinduet første gang.
$('nameDialog').addEventListener('cancel', ev => { if ($('nameDialog').dataset.required) ev.preventDefault(); });

$('nameCancel').addEventListener('click', () => $('nameDialog').close());

$('nameForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const v = $('nameInput').value.trim();
  if (v.length < 2) { $('nameErrors').innerHTML = '<li>Skriv minst 2 tegn.</li>'; return; }
  try {
    const n = await store.setDisplayName(v);
    $('nameDialog').close();
    toast(`Hei, ${n}!`);
    renderAccount();
  } catch (e) { $('nameErrors').innerHTML = `<li>${esc(friendlyError(e))}</li>`; }
});

store.addEventListener('profile', () => {
  if (ui.tab === 'konto') renderAccount();
  if (store.user && store.profile && !store.profile.display_name && !store.noProfiles) openNameDialog(true);
});
