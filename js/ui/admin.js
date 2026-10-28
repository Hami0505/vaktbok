// Statistikkside for administrator. Tallene hentes fra admin_stats() i databasen, som gir avslag til alle andre.
// «Inne nå» kommer fra sanntidskanalen der hver åpen app er påmeldt med en tilfeldig ID.
import { $, DAY, esc, store, toast } from './core.js';

let data = null, loading = false, triedFor = null;

const dato = d => { if (!d) return '–'; const x = new Date(d); return `${x.getDate()}.${x.getMonth() + 1}.${String(x.getFullYear()).slice(2)}`; };
const tid = d => { const x = new Date(d); return `${dato(d)} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };

export async function loadAdmin() {
  if (loading) return;
  if (!store.user) { $('admUpdated').textContent = 'Logg inn som administrator for å se statistikken.'; return; }
  loading = true; triedFor = store.user.id;
  $('admUpdated').textContent = 'Henter …';
  try {
    if (!(await store.isAdmin())) { data = null; $('admUpdated').textContent = 'Du har ikke tilgang til statistikken.'; $('admTotals').innerHTML = ''; return; }
    data = await store.adminStats(); renderAdmin();
  }
  catch (e) { $('admUpdated').textContent = /tilgang|42501|admin_stats/i.test(e.message) ? 'Du har ikke tilgang, eller statistikk-SQL-en er ikke kjørt.' : 'Fikk ikke hentet statistikken.'; }
  finally { loading = false; }
}

export function renderAdmin() {
  // Åpnet direkte fra adressen, eller innloggingen kom etterpå: hent data én gang per bruker.
  if (!data && store.user && triedFor !== store.user.id) { loadAdmin(); return; }
  if (!data) return;
  const online = store.online ?? 0;
  const t = data?.totals || {};
  $('admTotals').innerHTML = `
    <div class="lead"><b>${online}</b><span>${online === 1 ? 'Enhet' : 'Enheter'} inne nå${online ? `, ${store.onlineIn ?? 0} innlogget` : ''}</span></div>
    <div><b>${t.users ?? '–'}</b><span>Brukere</span></div>
    <div><b>${t.active1 ?? '–'}</b><span>Aktive siste døgn</span></div>
    <div><b>${t.active7 ?? '–'}</b><span>Aktive siste 7 dager</span></div>
    <div><b>${t.active30 ?? '–'}</b><span>Aktive siste 30 dager</span></div>
    <div><b>${t.new30 ?? '–'}</b><span>Nye siste 30 dager</span></div>
    <div><b>${t.shifts ?? '–'}</b><span>Vakter</span></div>`;
  $('admUpdated').textContent = `Oppdatert ${tid(Date.now())}. «Inne nå» teller enheter med appen åpen, og oppdateres av seg selv.`;
  const weeks = data.weeks || [], max = Math.max(1, ...weeks.map(w => w.n));
  $('admWeeks').innerHTML = weeks.length ? weeks.map(w => `<div title="Uke fra ${dato(w.week)}: ${w.n}"><b>${w.n}</b><span style="height:${Math.round(w.n / max * 100)}%"></span>${dato(w.week).slice(0, -3)}</div>`).join('') : '<p class="small muted">Ingen aktivitet ennå.</p>';
  $('admUsers').innerHTML = `<thead><tr><th>Navn</th><th>E-post</th><th>Registrert</th><th>Sist aktiv</th><th>Vakter</th></tr></thead><tbody>${
    (data.users || []).map(u => `<tr><td>${esc(u.name || '–')}</td><td>${esc(u.email)}</td><td>${dato(u.registered)}</td><td>${dato(u.last_seen)}</td><td>${u.shifts}</td></tr>`).join('')}</tbody>`;
  $('admErrors').innerHTML = (data.errors || []).length ? data.errors.map(e => `<div class="adm-item"><b>${esc(e.message)}</b>
    <div class="meta">${esc(e.source || 'ukjent fil')}${e.line ? `, linje ${e.line}` : ''} · ${e.n} ${e.n === 1 ? 'gang' : 'ganger'} · sist ${tid(e.last)}</div></div>`).join('') : '<p class="small muted">Ingen feil siste 30 dager.</p>';
  $('admFeedback').innerHTML = (data.feedback || []).length ? data.feedback.map(f => `<div class="adm-item"><b>${esc({ feil: 'Feil', forslag: 'Forslag', annet: 'Annet' }[f.kind] || f.kind)}</b> ${esc(f.message)}
    <div class="meta">${tid(f.created_at)}${f.email ? ` · <a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : ''}</div></div>`).join('') : '<p class="small muted">Ingen tilbakemeldinger ennå.</p>';
}

$('admRefresh').addEventListener('click', () => loadAdmin().then(() => toast('Statistikken er oppdatert')));
store.addEventListener('presence', () => { if (!$('v-statistikk').hidden) renderAdmin(); });
