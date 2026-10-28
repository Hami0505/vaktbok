// Tilbakemeldingsskjema. Sendes til serverfunksjonen feedback (lagres og sendes på e-post).
// Er ikke serveren satt opp, åpnes e-postprogrammet med meldingen ferdig utfylt i stedet.
import { config } from '../config.js';
import { $, esc, store, toast } from './core.js';

const VERSION = 'web-' + (document.querySelector('meta[name="vaktbok-version"]')?.content || '1');
let kind = 'feil';

function meta() {
  return {
    versjon: VERSION, adresse: location.pathname + location.hash, nettleser: navigator.userAgent,
    skjerm: `${screen.width}×${screen.height}, vindu ${innerWidth}×${innerHeight}`,
    installert: matchMedia('(display-mode: standalone)').matches, innlogget: !!store.user, tid: new Date().toISOString(),
  };
}

function setKind(k) {
  kind = k;
  document.querySelectorAll('[data-fb]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.fb === k)));
  $('fbMessage').placeholder = { feil: 'Hva skjedde, og hva gjorde du rett før? Skjedde det på mobil eller PC?', forslag: 'Hva savner du, eller hva kunne vært enklere?', annet: 'Skriv det du vil si.' }[k];
}

export function openFeedback() {
  $('fbMessage').value = ''; $('fbErrors').innerHTML = ''; $('fbWebsite').value = '';
  $('fbEmail').value = store.user?.email || '';
  setKind('feil');
  $('feedbackDialog').showModal();
  $('fbMessage').focus();
}

document.querySelectorAll('[data-fb]').forEach(b => b.addEventListener('click', () => setKind(b.dataset.fb)));

$('fbForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const message = $('fbMessage').value.trim(), email = $('fbEmail').value.trim();
  const errs = [];
  if (message.length < 3) errs.push('Skriv litt mer, minst noen ord.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push('E-postadressen ser ikke riktig ut.');
  $('fbErrors').innerHTML = errs.map(x => `<li>${esc(x)}</li>`).join('');
  if (errs.length) return;
  const payload = { kind, message, email: email || null, meta: $('fbMeta').checked ? meta() : null, website: $('fbWebsite').value };
  const btn = $('fbSend'); btn.disabled = true; btn.textContent = 'Sender …';
  try {
    await store.sendFeedback(payload);
    $('feedbackDialog').close();
    toast('Takk! Meldingen er sendt.');
  } catch (e) {
    if (e.message === 'rate-limit') { $('fbErrors').innerHTML = '<li>Du har sendt flere meldinger på kort tid. Prøv igjen om noen minutter.</li>'; return; }
    // Reserve: e-postprogrammet med meldingen ferdig utfylt
    const to = config.contactEmail || 'vaktbok.app@gmail.com';
    const body = `${message}\n\n---\n${payload.meta ? JSON.stringify(payload.meta, null, 2) : ''}`;
    location.href = `mailto:${to}?subject=${encodeURIComponent(`Vaktbok: ${kind}`)}&body=${encodeURIComponent(body)}`;
    $('feedbackDialog').close();
    toast('Fikk ikke sendt direkte, så e-postprogrammet ditt åpnes med meldingen.');
  } finally { btn.disabled = false; btn.textContent = 'Send'; }
});
