// Vaktbok – henter en kalender (.ics) fra en lenke på vegne av innloggede brukere.
// Nettlesere får ikke hente kalenderfiler fra andre nettsteder direkte (CORS), derfor går det via denne.
// Krever innlogging: funksjonen sjekker selv at brukeren er logget inn i Vaktbok,
// så den virker med både gamle og nye nøkkeltyper i Supabase.

const ALLOWED_ORIGINS = ['https://hami0505.github.io', 'http://localhost:5173'];
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // Bare innloggede brukere: spør Supabase Auth om tokenet er gyldig.
  const auth = req.headers.get('authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey } }).catch(() => null);
  if (!who || !who.ok) return json({ error: 'login-required' }, 401);

  let url: URL;
  try {
    const body = await req.json();
    url = new URL(String(body.url ?? '').trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return json({ error: 'invalid-url' }, 400);
  }
  if (url.protocol !== 'https:') return json({ error: 'https-only' }, 400);
  // Ikke la funksjonen brukes til å nå interne adresser.
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[.*\])$/i.test(url.hostname) || /\.(local|internal|localhost)$/i.test(url.hostname)) {
    return json({ error: 'host-not-allowed' }, 400);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Vaktbok-kalenderimport/1.0', 'Accept': 'text/calendar, text/plain, */*' },
    });
    if (!res.ok || !res.body) return json({ error: 'upstream', status: res.status }, 502);

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { ctrl.abort(); return json({ error: 'too-large' }, 413); }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    const text = new TextDecoder().decode(all);
    if (!text.includes('BEGIN:VCALENDAR')) return json({ error: 'not-calendar' }, 422);
    return json({ text });
  } catch (e) {
    return json({ error: (e as Error).name === 'AbortError' ? 'timeout' : 'failed' }, 502);
  } finally {
    clearTimeout(timer);
  }
});
