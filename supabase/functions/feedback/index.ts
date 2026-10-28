// Vaktbok – tilbakemelding fra appen. Lagrer i tabellen feedback og sender e-post via Brevo (valgfritt).
// Virker også for brukere uten konto. Slå AV «Verify JWT» for denne funksjonen i Supabase.
// Hemmeligheter (Edge Functions → Secrets): BREVO_API_KEY, FEEDBACK_TO (din e-post), FEEDBACK_FROM (bekreftet avsender i Brevo).

const ALLOWED_ORIGINS = ['https://hami0505.github.io', 'http://localhost:5173'];
const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const recent = new Map<string, number[]>(); // enkel grense: maks 5 per 10 minutter per IP (per instans)

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
  };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'ukjent';
  const now = Date.now(), list = (recent.get(ip) || []).filter(t => now - t < 600_000);
  if (list.length >= 5) return json({ error: 'rate-limit' }, 429);
  recent.set(ip, [...list, now]);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'invalid' }, 400); }
  if (body.website) return json({ ok: true }); // felle for roboter: feltet er skjult for mennesker
  const kind = ['feil', 'forslag', 'annet'].includes(body.kind) ? body.kind : 'annet';
  const message = String(body.message ?? '').trim();
  const email = String(body.email ?? '').trim().slice(0, 200) || null;
  if (message.length < 3 || message.length > 4000) return json({ error: 'length' }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'email' }, 400);
  const meta = typeof body.meta === 'object' && body.meta ? JSON.parse(JSON.stringify(body.meta).slice(0, 2000)) : null;

  // Innlogget bruker? Da kobles meldingen til kontoen.
  let userId: string | null = null;
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) {
    const who = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: auth, apikey: req.headers.get('apikey') ?? '' } }).catch(() => null);
    if (who?.ok) userId = (await who.json()).id ?? null;
  }

  const ins = await fetch(`${URL_}/rest/v1/feedback`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, email, kind, message, meta }),
  }).catch(() => null);
  if (!ins?.ok) return json({ error: 'store' }, 502);

  const apiKey = Deno.env.get('BREVO_API_KEY'), to = Deno.env.get('FEEDBACK_TO');
  if (apiKey && to) {
    const label = { feil: 'Feil', forslag: 'Forslag', annet: 'Tilbakemelding' }[kind as 'feil' | 'forslag' | 'annet'];
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: Deno.env.get('FEEDBACK_FROM') || to, name: 'Vaktbok' },
        to: [{ email: to }],
        ...(email ? { replyTo: { email } } : {}),
        subject: `Vaktbok: ${label}`,
        textContent: `${message}\n\n---\nFra: ${email || 'ikke oppgitt'}${userId ? ` (innlogget bruker ${userId})` : ' (ikke innlogget)'}\n${meta ? JSON.stringify(meta, null, 2) : ''}`,
      }),
    }).catch(() => null);
  }
  return json({ ok: true });
});
