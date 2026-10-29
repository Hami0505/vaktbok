import './ui/errors.js';
import * as L from './logic.js';
import { newId } from './store.js';
import { $, D, V1_DONE, V1_KEY, addDays, choiceBox, confirmBox, empById, esc, fmtDay, friendlyError, store, toast, ui, ym } from './ui/core.js';
import { renderWeek } from './ui/week.js';
import { extendSeries, openShift } from './ui/shift.js';
import { openEmp, renderEmployers } from './ui/employers.js';
import { pdfTimesheet, renderMonth } from './ui/overview.js';
import { loadDemo, openNameDialog, renderAccount } from './ui/account.js';
// Sjeldent brukte deler lastes først når de åpnes, så oppstarten blir raskere.
const lazy = name => import(`./ui/${name}.js`);

// ---------- Faner ----------
export function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tabs [role="tab"]').forEach(b => {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  for (const t of ['uke', 'oversikt', 'arbeidsgivere', 'konto', 'statistikk']) $(`v-${t}`).hidden = t !== tab;
  if (tab === 'statistikk') lazy('admin').then(m => m.loadAdmin());
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  render();
}

// ---------- Synkstatus og bannere ----------
export function renderSync() {
  const p = $('syncPill'), n = store.pending;
  const text = {
    local: 'Lagres på denne enheten',
    guest: 'Ikke logget inn',
    syncing: 'Synkroniserer …',
    synced: 'Synkronisert',
    offline: n ? `Frakoblet, ${n} ${n === 1 ? 'endring venter' : 'endringer venter'}` : 'Frakoblet',
    error: 'Synk feilet, prøver igjen',
  }[store.status];
  p.dataset.state = store.status;
  $('syncText').textContent = text;
  p.title = store.lastError || text;
}

// Gjestebanneret kommer tilbake 30 dager etter «Skjønner», så lenge vaktene bare ligger lokalt.
const GUEST_WARNED = 'vaktbok:guest-warned';
const GUEST_REMIND_DAYS = 30;
function guestWarnDue() {
  const v = localStorage.getItem(GUEST_WARNED);
  if (!v) return true;
  const t = Date.parse(v);
  return Number.isNaN(t) || Date.now() - t > GUEST_REMIND_DAYS * 86400000; // gammel verdi «1» gir ny påminnelse
}
// Safari på iPhone/iPad når Vaktbok ikke er lagt til på Hjem-skjermen: der kan lokale data slettes etter sju dager uten bruk.
function iosNotInstalled() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !matchMedia('(display-mode: standalone)').matches && !navigator.standalone;
}

export function renderBanners() {
  const out = [];
  if (!store.user && D().shifts.length && guestWarnDue()) {
    out.push(`<div class="banner"><p>Uten konto ligger vaktene bare i denne nettleseren, og de kan bli slettet, for eksempel av Safari på iPhone etter sju dager uten bruk. ${store.configured ? 'Logg inn for å ta vare på dem.' : 'Last ned en kopi under Konto jevnlig.'}${iosNotInstalled() ? ' Eller legg Vaktbok til på Hjem-skjermen: trykk Del og så «Legg til på Hjem-skjerm».' : ''}</p>
      ${store.configured ? '<button class="btn primary" data-action="go-login-banner">Logg inn</button>' : ''}<button class="btn link" data-action="dismiss-guest">Skjønner</button></div>`);
  }
  let v1 = null;
  try { v1 = !localStorage.getItem(V1_DONE) && JSON.parse(localStorage.getItem(V1_KEY) || 'null'); } catch { }
  if (v1 && (v1.shifts?.length || v1.employers?.length)) {
    out.push(`<div class="banner"><p>Fant ${v1.shifts?.length || 0} vakter fra prototypen av Vaktbok på denne enheten.</p>
      <button class="btn primary" data-action="import-v1">Importer</button><button class="btn link" data-action="dismiss-v1">Ikke nå</button></div>`);
  }
  if (ui.updateReg) out.push(`<div class="banner"><p>En ny versjon av Vaktbok er klar.</p><button class="btn primary" data-action="update-app">Oppdater</button></div>`);
  $('banners').innerHTML = out.join('');
}

// ---------- Hendelser ----------
export const WELCOME_KEY = 'vaktbok:welcomed';

export function showLanding(on) {
  ui.landing = on;
  document.body.classList.toggle('show-landing', on);
  $('landing').hidden = !on;
  if (on) window.scrollTo(0, 0);
}

export function leaveLanding(tab) {
  localStorage.setItem(WELCOME_KEY, '1');
  showLanding(false);
  if (location.hash === '#om') history.replaceState(null, '', '#uke');
  setTab(tab);
}

export function render() {
  renderSync(); renderBanners();
  if (ui.landing) return;
  if (ui.tab === 'uke') renderWeek();
  else if (ui.tab === 'oversikt') renderMonth();
  else if (ui.tab === 'arbeidsgivere') renderEmployers();
  else if (ui.tab === 'statistikk') lazy('admin').then(m => m.renderAdmin());
  else renderAccount();
}

export const actions = {
  'open-feedback': async () => (await lazy('feedback')).openFeedback(),
  'open-export': async el => (await lazy('export')).openExport(el),
  'open-import': async () => (await getImporter()).open(),
  'open-admin': () => setTab('statistikk'),
  'tab-konto': () => setTab('konto'),
  'login-google': () => store.signInWithProvider('google').catch(e => toast(friendlyError(e))),
  'accept-offer': el => {
    const s = D().shifts.find(x => x.id === el.dataset.id); if (!s) return;
    store.upsertShift({ ...s, status: null });
    toast('Vakta er tatt og telles nå med', () => { store.upsertShift({ ...s }); toast('Angret'); });
  },
  'decline-offer': async el => {
    const s = D().shifts.find(x => x.id === el.dataset.id); if (!s) return;
    if (!(await confirmBox('Avslå vakta?', `${empById(s.employerId)?.name || ''}, ${fmtDay(s.date)} ${s.start}–${s.end} fjernes fra Vaktbok.`, 'Avslå', true))) return;
    store.deleteShift(s.id);
    toast('Vakta er avslått', () => { store.upsertShift({ ...s }); toast('Vakta er tilbake'); });
  },
  'go-login-banner': () => { setTab('konto'); $('emailInput')?.focus(); },
  'dismiss-guest': () => { localStorage.setItem(GUEST_WARNED, new Date().toISOString()); renderBanners(); },
  'edit-name': () => openNameDialog(false),
  'go-login': () => { $('importDialog').close(); setTab('konto'); $('emailInput')?.focus(); },
  'go-settings': () => { setTab('konto'); $('sTax').focus(); },
  'landing-demo': () => { leaveLanding('uke'); loadDemo(); },
  'landing-start': () => { leaveLanding('arbeidsgivere'); openEmp(); },
  'landing-login': () => leaveLanding('konto'),
  'show-landing': () => { showLanding(true); history.replaceState(null, '', '#om'); },
  'edit-shift': el => openShift(D().shifts.find(s => s.id === el.dataset.id)),
  'edit-emp': el => openEmp(empById(el.dataset.id)),
  'new-emp': () => openEmp(),
  'copy-menu': async el => {
    const s = D().shifts.find(x => x.id === el.dataset.id); if (!s) return;
    const days = await choiceBox('Kopier vakt', `${empById(s.employerId)?.name || ''}, ${fmtDay(s.date)} ${s.start}–${s.end}`,
      [['1', `Til neste dag (${fmtDay(L.isoDate(addDays(L.parseDate(s.date), 1)))})`], ['7', `Til samme dag neste uke (${fmtDay(L.isoDate(addDays(L.parseDate(s.date), 7)))})`]]);
    if (!days) return;
    const date = L.isoDate(addDays(L.parseDate(s.date), Number(days)));
    store.upsertShift({ ...s, id: undefined, date, seriesId: null });
    toast(`Kopiert til ${fmtDay(date)}`);
  },
  'import-v1': async () => {
    const v1 = JSON.parse(localStorage.getItem(V1_KEY) || '{}');
    if (await (await getImporter()).importJson(v1, 'Fra prototypen')) localStorage.setItem(V1_DONE, '1');
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

export const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];

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

$('pdfBtn').addEventListener('click', pdfTimesheet);

store.addEventListener('change', render);

store.addEventListener('status', () => { renderSync(); if (ui.tab === 'konto') renderAccount(); });
// Samtidige endringer på to enheter. Det meste slås sammen uten at brukeren merker det.
// Beskjed gis bare når noe herfra ikke kunne beholdes, og flere samles til én.
const FIELD = {
  date: 'dato', start_time: 'start', end_time: 'slutt', break_min: 'pause', note: 'notat', employer_id: 'arbeidsgiver',
  fee: 'beløp', status: 'tilbudt', series_id: 'gjentakelse', name: 'navn', rate: 'timelønn', color: 'farge',
  rules: 'tillegg', overtime: 'overtid', pay: 'lønnsform', archived: 'skjult',
};
let conflicts = [], conflictT;
store.addEventListener('conflict', ({ detail }) => {
  conflicts.push(detail);
  clearTimeout(conflictT);
  conflictT = setTimeout(() => {
    const list = conflicts; conflicts = [];
    if (list.length > 1) { toast(`${list.length} endringer kolliderte med endringer fra en annen enhet. Sjekk vaktene du endret uten nett.`, null, 9000); return; }
    const c = list[0];
    const what = c.table === 'shifts' ? `Vakta ${fmtDay(c.row.date)}` : `Arbeidsgiveren ${c.row.name}`;
    toast(c.deleted
      ? `${what} ble slettet på en annen enhet, så endringen herfra ble ikke lagret.`
      : `${what} ble endret på en annen enhet samtidig. For ${c.fields.map(f => FIELD[f] || f).join(', ')} gjelder endringen derfra. Sjekk at det stemmer.`, null, 9000);
  }, 300);
});


store.addEventListener('guest-data', async ({ detail }) => {
  const n = detail.shifts?.length || 0;
  const ok = await confirmBox('Ta med vaktene fra denne enheten?', `Du har ${n} vakter lagret her fra før du logget inn. Vil du legge dem til i kontoen din?`, 'Legg til i kontoen');
  if (ok) { store.addAll({ employers: detail.employers || [], shifts: detail.shifts || [] }); store.clearGuestData(); toast('Vaktene er lagt til i kontoen'); }
});

// ---------- Import ----------
// Importen lastes først når den trengs, så oppstarten blir raskere.
export let importerP = null;

export const getImporter = () => importerP ||= import('./importer.js').then(({ setupImporter }) => setupImporter({
  store, D, $, esc, toast, fmtDay, setTab, openEmp, newId, confirmBox, friendlyError,
  goToWeek: date => { ui.weekStart = L.mondayOf(L.parseDate(date)); setTab('uke'); },
}));

$('importBtn').addEventListener('click', async () => (await getImporter()).open());

$('importBtn2').addEventListener('click', async () => (await getImporter()).open());

export async function registerSW() {
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

export const initialHash = location.hash;

export const hashTab = location.hash.slice(1) === 'maned' ? 'oversikt' : location.hash.slice(1);

 // gamle lenker til #maned virker fortsatt
export const start = ['uke', 'oversikt', 'arbeidsgivere', 'konto', 'statistikk'].includes(hashTab) ? hashTab : 'uke';

setTab(start);
// Første tegning er ferdig: vis innholdet (se .booting i CSS).
document.documentElement.classList.remove('booting');

if (initialHash === '#om') showLanding(true);
// Ny besøkende: ingen lokale data, ingen innlogging lagret og aldri vært innom. Vis landingssiden med en gang,
// så siden ikke først tegner en tom uke og så hopper.
else if (!initialHash && !localStorage.getItem(WELCOME_KEY) && !Object.keys(localStorage).some(k => k.startsWith('sb-') || k.startsWith('vaktbok:data:'))) showLanding(true);

// Kommer brukeren tilbake fra en avbrutt eller utløpt innlogging, står feilen i adressen. Fjern den og si fra.
const authErr = (() => {
  const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.slice(1));
  const code = q.get('error_code') || q.get('error') || h.get('error_code') || h.get('error');
  if (!code) return null;
  history.replaceState(null, '', location.pathname);
  return code;
})();

store.init().then(() => {
  if (store.user && ui.landing && initialHash !== '#om') showLanding(false);
  if (store.user) {
    const once = () => { if (store.status === 'synced') { store.removeEventListener('status', once); extendSeries(); store.loadProfile(); } };
    store.addEventListener('status', once); once();
  } else extendSeries();
  // Nye besøkende uten konto og uten data ser landingssiden først.
  if (!ui.landing && !store.user && !D().employers.length && !localStorage.getItem(WELCOME_KEY) && !initialHash && !authErr) showLanding(true);
  render();
  if (authErr && !store.user) {
    if (ui.landing) showLanding(false);
    setTab('konto');
    toast(authErr === 'access_denied' ? 'Innloggingen ble avbrutt.' : 'Innloggingen gikk ut på tid. Prøv igjen.');
  }
});

registerSW();
// Be nettleseren om varig lagring, så lokale vakter ikke ryddes bort når det blir lite plass.
navigator.storage?.persist?.().catch(() => {});

// Be nettleseren om å ikke rydde bort lokale data (virker i de fleste nettlesere, særlig når appen er installert).
try { navigator.storage?.persist?.(); } catch { }
