// Vaktbok – kalenderabonnement. Kalenderapper henter vaktene fra functions/v1/calendar?t=<hemmelig nøkkel>.
// Kalenderapper kan ikke logge inn, så nøkkelen i lenken er det som gir tilgang. Brukeren kan lage ny nøkkel
// (og dermed stenge den gamle lenken) under Konto i appen. Notater tas aldri med.
// Slå AV «Verify JWT» for denne funksjonen i Supabase.

const URL_ = Deno.env.get('SUPABASE_URL')!;
// Tjenestenøkkel: nye prosjekter har SUPABASE_SECRET_KEYS (sb_secret_…), eldre har SUPABASE_SERVICE_ROLE_KEY (JWT).
// De nye nøklene sendes bare som apikey, de gamle også som Authorization.
function serviceHeaders(): Record<string, string> {
  let key = '';
  try { const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); key = keys.default || Object.values(keys)[0] || ''; } catch { /* ikke satt */ }
  key = key || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

const rest = async (path: string) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: serviceHeaders() });
  if (!r.ok) { console.error('Databasefeil:', r.status, await r.text()); throw new Error(`rest ${r.status}`); }
  return r.json();
};
const pad = (n: number) => String(n).padStart(2, '0');
const esc = (t: string) => String(t).replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
const fold = (line: string) => { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); };
const local = (date: string, time: string, addDay = 0) => {
  const [y, m, d] = date.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d + addDay));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${time.slice(0, 2)}${time.slice(3, 5)}00`;
};
const VTIMEZONE = ['BEGIN:VTIMEZONE', 'TZID:Europe/Oslo',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE'];

export function buildFeed(shifts: any[], employers: any[], now = new Date()) {
  const name = (id: string) => employers.find(e => e.id === id)?.name || 'Vaktbok';
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vaktbok//NB', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Vaktbok', 'X-WR-TIMEZONE:Europe/Oslo', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...VTIMEZONE];
  for (const s of shifts) {
    const start = s.start_time.slice(0, 5), end = s.end_time.slice(0, 5);
    const over = end <= start ? 1 : 0;
    const title = `${s.status === 'offered' ? 'Tilbudt: ' : ''}Vakt – ${name(s.employer_id)}`;
    lines.push('BEGIN:VEVENT', `UID:${s.id}@vaktbok`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Oslo:${local(s.date, start)}`, `DTEND;TZID=Europe/Oslo:${local(s.date, end, over)}`,
      fold(`SUMMARY:${esc(title)}`), s.status === 'offered' ? 'STATUS:TENTATIVE' : 'STATUS:CONFIRMED', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get('t') || '';
  if (!/^[0-9a-f]{48}$/.test(t)) return new Response('Ugyldig lenke', { status: 400 });
  try {
    const feed = await rest(`calendar_feeds?token=eq.${t}&select=user_id`);
    if (!feed.length) return new Response('Lenken er ikke lenger i bruk. Lag en ny under Konto i Vaktbok.', { status: 404 });
    const uid = feed[0].user_id;
    const from = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
    const [shifts, employers] = await Promise.all([
      rest(`shifts?user_id=eq.${uid}&date=gte.${from}&date=lte.${to}&select=id,employer_id,date,start_time,end_time,status&order=date`),
      rest(`employers?user_id=eq.${uid}&select=id,name`),
    ]);
    return new Response(buildFeed(shifts, employers), {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline; filename="vaktbok.ics"' },
    });
  } catch {
    return new Response('Kalenderen er midlertidig utilgjengelig', { status: 503 });
  }
});
