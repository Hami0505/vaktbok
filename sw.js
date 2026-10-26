// Vaktbok – service worker: gjør appen tilgjengelig offline.
// Øk VERSION ved hver utgivelse, så får brukerne beskjed om ny versjon.
const VERSION = 'vaktbok-2026-10-26-3';
const SHELL = [
  './', 'index.html', 'personvern.html', 'css/app.css',
  'js/app.js', 'js/logic.js', 'js/store.js', 'js/sync-core.js', 'js/demo.js', 'js/config.js',
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

  if (req.mode === 'navigate') {
    // Nettverk først for selve siden, så innloggingslenker og nye versjoner fungerer; reserve fra cache offline.
    e.respondWith(fetch(req).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('index.html')));
    return;
  }
  // Cache først for statiske filer; oppdateres i bakgrunnen.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })());
});
