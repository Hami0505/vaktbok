// Vaktbok – service worker: gjør appen tilgjengelig offline.
// Øk VERSION ved hver utgivelse, så får brukerne beskjed om ny versjon.
const VERSION = 'vaktbok-2026-10-29-3';
const SHELL = [
  './', 'index.html', 'personvern.html', 'css/app.css',
  'js/app.js', 'js/ui/core.js', 'js/ui/week.js', 'js/ui/shift.js', 'js/ui/employers.js', 'js/ui/overview.js', 'js/ui/account.js', 'js/ui/feedback.js', 'js/ui/export.js', 'js/ui/errors.js', 'js/ui/admin.js', 'js/logic.js', 'js/store.js', 'js/sync-core.js', 'js/demo.js', 'js/personvern.js', 'js/importer.js', 'js/pdf.js', 'js/config.js',
  'manifest.webmanifest',
  'fonts/schibsted-grotesk-latin-400-normal.woff2', 'fonts/schibsted-grotesk-latin-500-normal.woff2',
  'fonts/schibsted-grotesk-latin-700-normal.woff2', 'fonts/schibsted-grotesk-latin-800-normal.woff2', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Aldri mellomlagre API-kall eller innlogging.
  if (url.hostname.endsWith('supabase.co')) return;

  const sameOrigin = url.origin === self.location.origin;
  const isStatic = sameOrigin || url.hostname === 'cdn.jsdelivr.net';
  if (!isStatic) return;

  // Nettverk først for alt: på nett får brukeren alltid nyeste filer (også nye nøkler i config.js).
  // Uten nett brukes de lagrede filene, så appen fortsatt virker offline.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      // no-cache: spør serveren om filen er endret (billig sjekk), i stedet for å stole på nettleserens mellomlager.
      const res = await fetch(req, sameOrigin ? { cache: 'no-cache' } : undefined);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      return hit || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }
  })());
});
