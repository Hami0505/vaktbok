// Feillogg: når noe krasjer hos en bruker, sendes en kort rapport til tabellen client_errors i Supabase.
// Bare feilmelding, fil og linje, nettleser og versjon. Aldri innholdet i vaktene.
import * as L from '../logic.js';
import { store } from './core.js';

const VERSION = document.querySelector('meta[name="vaktbok-version"]')?.content || '';
const ORIGIN = location.origin + location.pathname.replace(/\/[^/]*$/, '');
const sent = new Set();
const queue = [];
let count = 0, tries = 0;

function report(raw) {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return; // ikke logg under utvikling
  const e = L.cleanError(raw, ORIGIN);
  if (!e) return;
  const key = `${e.message}|${e.source}|${e.line}`;
  if (sent.has(key) || count >= 10) return; // samme feil én gang, maks 10 per besøk
  sent.add(key); count++;
  queue.push({ ...e, version: VERSION.slice(0, 40), browser: navigator.userAgent.slice(0, 300), page: (location.pathname + location.hash).slice(0, 200) });
  flush();
}

async function flush() {
  if (!queue.length) return;
  if (!store.configured) { queue.length = 0; return; } // uten server er det ingen steder å sende
  if (!store.sb) { if (++tries < 20) setTimeout(flush, 3000); return; } // vent til innloggingsbiblioteket er lastet

  const batch = queue.splice(0);
  try { await store.sb.from('client_errors').insert(batch); } catch { /* feilloggen skal aldri lage nye feil */ }
}

addEventListener('error', ev => report({ message: ev.message, source: ev.filename, line: ev.lineno, stack: ev.error?.stack }));
addEventListener('unhandledrejection', ev => {
  const r = ev.reason;
  report({ message: r?.message || String(r), source: (r?.stack?.match(/(https?:\/\/[^\s)]+?):\d+:\d+/) || [])[1] || '', stack: r?.stack });
});
