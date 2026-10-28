import * as L from '../logic.js';
import { config } from '../config.js';
import { Store } from '../store.js';

export const $ = id => document.getElementById(id);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const krFmt = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });

export const kr = n => `${krFmt.format(Math.round(n))} kr`;

export const num = (n, d = 1) => Number(n).toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d });

export const hrs = n => `${num(n)} t`;

export const DAY = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];

export const DAY_LONG = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

export const MONTH = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];

export const CHIPS = [[1, 'M'], [2, 'T'], [3, 'O'], [4, 'T'], [5, 'F'], [6, 'L'], [0, 'S']];

export const V1_KEY = 'vaktbok-v1', V1_DONE = 'vaktbok:v1-handled';

export const ym = d => `${d.getFullYear()}-${L.pad(d.getMonth() + 1)}`;

export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const safeColor = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#1F6F6B';

// Sørger for at tekst på fargen kan nå 4,5 : 1. Mellomtoner der verken svart eller hvit holder,
// gjøres litt mørkere til hvit tekst holder. Brukes på stolper og andre flater med tekst.
export function readableBg(hex) {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  let [r, g, b] = [1, 3, 5].map(i => parseInt(safeColor(hex).slice(i, i + 2), 16));
  const best = () => { const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); return Math.max(1.05 / (L + 0.05), (L + 0.05) / (0.0068 + 0.05)); };
  for (let i = 0; i < 20 && best() < 4.6; i++) { r = Math.round(r * 0.94); g = Math.round(g * 0.94); b = Math.round(b * 0.94); }
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export const fgFor = hex => {
  // Regn kontrast mot de faktiske tekstfargene, og velg den som gir mest. Mørk tekst er nesten svart,
  // så mellomtoner (grønn, oransje) også når 4,5 : 1.
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lumOf = h => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
  const bg = lumOf(safeColor(hex)), dark = '#0B1215', light = '#FFFFFF';
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(bg, lumOf(dark)) >= ratio(bg, lumOf(light)) ? dark : light;
};

export const fmtDay = str => { const d = L.parseDate(str); return `${DAY[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };

export const store = new Store(config);

// Brutto eller netto i visningene. Netto krever at skattetrekk er lagt inn.
export const taxPct = () => Number(D().settings.taxPct) || 0;

export const showNet = () => D().settings.showNet === true;

// Har brukeren lagt inn noe som gir skattetrekk? Ellers er netto lik brutto, og vi sier fra.
export const hasTaxSetup = () => taxPct() > 0 || D().settings.frikort?.on || D().employers.some(e => e.pay?.tax && e.pay.tax.mode !== 'default');

export const money = o => showNet() ? (o.net ?? o.pay) : o.pay;

export const payWord = () => showNet() ? 'ca. utbetalt' : 'estimert brutto';

// Gjør tekniske feilmeldinger (ofte på engelsk fra serveren) om til noe brukeren forstår.
export function friendlyError(e) {
  const m = String(e?.message || e || '');
  if (e instanceof TypeError || /fetch|network|load failed|offline/i.test(m)) return 'Får ikke kontakt med serveren. Sjekk at du er på nett, og prøv igjen.';
  if (/rate limit|too many|seconds/i.test(m)) return 'Du har prøvd mange ganger på kort tid. Vent et minutt og prøv igjen.';
  if (/expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(m)) return 'Koden er feil eller har utløpt. Be om en ny kode og bruk den nyeste e-posten.';
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(m)) return 'E-postadressen ser ikke riktig ut. Sjekk at den er skrevet riktig.';
  if (/jwt|not authenticated|ikke innlogget/i.test(m)) return 'Innloggingen har gått ut. Logg inn på nytt.';
  if (/permission denied|row-level security|42501/i.test(m)) return 'Serveren nektet tilgang. Logg ut og inn igjen. Vedvarer det, ta kontakt.';
  return `Serveren svarte med en feil (${m.slice(0, 80)}). Prøv igjen litt senere.`;
}

export const ui = { tab: 'uke', weekStart: L.mondayOf(new Date()), month: ym(new Date()), shift: null, emp: null, rules: [], codeSentTo: '', updateReg: null };

export const D = () => store.data;

export const empById = id => D().employers.find(e => e.id === id);

// ---------- Små hjelpere ----------
export function toast(msg, undo = null) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('has-action', !!undo);
  if (undo) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Angre' });
    b.addEventListener('click', () => { undo(); t.classList.remove('show', 'has-action'); clearTimeout(t._h); });
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show', 'has-action'), undo ? 7000 : 2600);
}

export function confirmBox(title, text, okLabel, danger = false) {
  return new Promise(resolve => {
    const d = $('confirmDialog');
    $('confirmTitle').textContent = title; $('confirmText').textContent = text;
    const ok = $('confirmOk'); ok.textContent = okLabel; ok.className = `btn ${danger ? 'danger' : 'primary'}`;
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function describeRule(r) {
  const val = r.kind === 'pct' ? `${num(r.value, 0)} %` : `${num(r.value, 0)} kr/t`;
  const time = r.from === r.to ? 'hele døgnet' : `${r.from}–${r.to}`;
  let days;
  const ds = [...(r.days || [])].sort().join('');
  if (r.holiday) days = 'helligdager';
  else if (ds === '0123456') days = 'alle dager';
  else if (ds === '12345') days = 'man–fre';
  else if (ds === '06') days = 'lør–søn';
  else days = CHIPS.filter(([d]) => r.days.includes(d)).map(([d]) => DAY[d]).join(', ');
  return `${r.label || 'Tillegg'} ${val}, ${days} ${time}`;
}

export function warningText(w) {
  const other = D().shifts.find(s => s.id === w.with);
  const emp = other && empById(other.employerId);
  const where = other ? `${emp ? emp.name : 'en vakt'} ${fmtDay(other.date)} ${other.start}–${other.end}` : 'en annen vakt';
  if (w.type === 'overlap') return `Overlapper med ${where}.`;
  const law = w.sameEmployer
    ? `Arbeidsmiljøloven krever normalt minst ${num(D().settings.minRestH, 0)} timer hvile hos samme arbeidsgiver.`
    : 'Ulike arbeidsgivere, så loven gjelder ikke samlet, men kort hvile sliter uansett.';
  if (w.gap < 0.05) return `Starter rett etter ${where}, uten hvile. ${law}`;
  return `Bare ${num(w.gap)} timer hvile etter ${where}. ${law}`;
}

export function choiceBox(title, text, options) {
  return new Promise(resolve => {
    const d = $('choiceDialog');
    $('choiceTitle').textContent = title; $('choiceText').textContent = text;
    $('choiceList').innerHTML = options.map(([v, label, danger]) => `<button class="btn${danger ? ' danger' : ''}" value="${v}">${esc(label)}</button>`).join('');
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue && d.returnValue !== 'cancel' ? d.returnValue : null), { once: true });
    d.showModal();
  });
}

// ---------- Oppstart ----------
export const contact = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(config.contactEmail || '') ? config.contactEmail : '';

if (contact) Object.assign($('contactLink'), { href: `mailto:${contact}`, textContent: 'Kontakt', hidden: false });

// Lås siden bak mens et vindu er åpent. Ellers tar iPhone over og scroller bakgrunnen
// når du når slutten av vinduet, særlig i appen på hjemskjermen.
export let openModals = 0, savedScroll = 0;

export const nativeShowModal = HTMLDialogElement.prototype.showModal;

HTMLDialogElement.prototype.showModal = function () {
  nativeShowModal.call(this);
  if (openModals++ === 0) {
    savedScroll = window.scrollY;
    Object.assign(document.body.style, { position: 'fixed', top: `-${savedScroll}px`, left: '0', right: '0', width: '100%' });
  }
  this.addEventListener('close', () => {
    if (--openModals > 0) return;
    openModals = 0;
    Object.assign(document.body.style, { position: '', top: '', left: '', right: '', width: '' });
    window.scrollTo(0, savedScroll);
  }, { once: true });
};

// Lukkeknapp (×) øverst i alle vinduer.
for (const d of document.querySelectorAll('dialog')) {
  const form = d.querySelector('form') || d;
  form.insertAdjacentHTML('afterbegin', '<button type="button" class="dlg-x" data-close aria-label="Lukk">×</button>');
}
