// Tester serverfunksjonene calendar og feedback i supabase/functions/ uten Supabase: Deno og fetch simuleres.
// Krever Node 22.6+ med --experimental-strip-types (satt i package.json).
import test from 'node:test';
import assert from 'node:assert/strict';

const handlers = {};
let loading = '';
globalThis.Deno = {
  serve: h => { handlers[loading] = h; },
  env: { get: k => ({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', BREVO_API_KEY: 'bk', FEEDBACK_TO: 'eier@example.no' })[k] },
};
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const db = {
  calendar_feeds: [{ user_id: 'u1', token: 'a'.repeat(48) }],
  shifts: [
    { id: 's1', employer_id: 'e1', date: day(1), start_time: '22:00:00', end_time: '07:30:00', status: null },
    { id: 's2', employer_id: 'e1', date: day(2), start_time: '08:00:00', end_time: '16:00:00', status: 'offered' },
  ],
  employers: [{ id: 'e1', name: 'Bofellesskap, avd 2' }], feedback: [],
};
const sent = { brevo: [] };
globalThis.fetch = async (u, o = {}) => {
  u = String(u);
  if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1' }), { status: (o.headers?.Authorization || '') === 'Bearer ok' ? 200 : 401 });
  if (u.includes('/rest/v1/calendar_feeds')) { const t = u.match(/token=eq\.(\w+)/)[1]; return Response.json(db.calendar_feeds.filter(f => f.token === t)); }
  if (u.includes('/rest/v1/shifts')) return Response.json(db.shifts);
  if (u.includes('/rest/v1/employers')) return Response.json(db.employers);
  if (u.includes('/rest/v1/feedback')) { db.feedback.push(JSON.parse(o.body)); return new Response(null, { status: 201 }); }
  if (u.includes('api.brevo.com')) { sent.brevo.push(JSON.parse(o.body)); return Response.json({ messageId: 'x' }); }
  throw new Error('uventet kall: ' + u);
};
for (const f of ['calendar', 'feedback']) { loading = f; await import(`../supabase/functions/${f}/index.ts`); }

const H = { 'content-type': 'application/json', origin: 'https://hami0505.github.io' };
const post = (path, body, headers = {}) => new Request(`https://p/${path}`, { method: 'POST', headers: { ...H, ...headers }, body: JSON.stringify(body) });

test('kalender: gyldig lenke gir kalender med riktige vakter', async () => {
  const r = await handlers.calendar(new Request('https://p/calendar?t=' + 'a'.repeat(48)));
  const txt = await r.text();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/calendar/);
  assert.equal((txt.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(txt.includes('Tilbudt: Vakt') && txt.includes('STATUS:TENTATIVE'), 'tilbudt vakt merkes');
  assert.match(txt, /DTEND;TZID=Europe\/Oslo:\d{8}T073000/, 'over midnatt');
  assert.ok(txt.includes('Bofellesskap\\, avd 2'), 'komma escapes');
  assert.ok(txt.includes('BEGIN:VTIMEZONE'), 'tidssone');
  assert.ok(!/DESCRIPTION/.test(txt), 'notater er aldri med');
});

test('kalender: ukjent og ugyldig lenke avvises', async () => {
  assert.equal((await handlers.calendar(new Request('https://p/c?t=' + 'b'.repeat(48)))).status, 404);
  assert.equal((await handlers.calendar(new Request('https://p/c?t=../../etc'))).status, 400);
});

test('tilbakemelding: lagres og sendes på e-post, med svar-til', async () => {
  const r = await handlers.feedback(post('f', { kind: 'feil', message: 'Knappen virker ikke', email: 'a@b.no' }));
  assert.equal(r.status, 200);
  assert.equal(db.feedback.at(-1).message, 'Knappen virker ikke');
  assert.equal(sent.brevo.at(-1).replyTo.email, 'a@b.no');
  assert.equal(sent.brevo.at(-1).to[0].email, 'eier@example.no');
});

test('tilbakemelding: robotfelle, for kort melding og grense per IP', async () => {
  const before = db.feedback.length;
  assert.equal((await handlers.feedback(post('f', { message: 'spam spam', website: 'x' }))).status, 200);
  assert.equal(db.feedback.length, before, 'robotfelle lagrer ingenting');
  assert.equal((await handlers.feedback(post('f', { message: 'x' }))).status, 400);
  for (let i = 0; i < 5; i++) await handlers.feedback(post('f', { message: 'hei hei' }, { 'x-forwarded-for': '9.9.9.9' }));
  assert.equal((await handlers.feedback(post('f', { message: 'hei hei' }, { 'x-forwarded-for': '9.9.9.9' }))).status, 429);
});

