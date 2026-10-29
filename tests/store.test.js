// Testene forutsetter norsk tid (sommertid, helligdager). Settes her så det virker på Windows også.
process.env.TZ = 'Europe/Oslo';
// Tester datalaget mot en falsk Supabase-klient i minnet.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimale nettlesergloballer
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
globalThis.addEventListener = () => {};

const { Store } = await import('../js/store.js');

function fakeSupabase() {
  const db = { employers: new Map(), shifts: new Map(), settings: new Map() };
  const calls = [];
  let offline = false, clock = 0;
  const stamp = () => `2026-10-30T10:00:00.${String(++clock).padStart(6, '0')}+00:00`; // som Postgres: unik per skriving
  const res = (data = null) => offline ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ data, error: null });
  const key = (table, r) => table === 'settings' ? r.user_id : r.id;
  const from = table => ({
    upsert(rows) {
      calls.push(`${table}:upsert`);
      for (const r of [].concat(rows)) {
        if (table === 'shifts' && !db.employers.has(r.employer_id)) return Promise.resolve({ error: { code: '23503', message: 'fk' } });
        db[table].set(key(table, r), { ...r, updated_at: stamp() });
      }
      return res();
    },
    // update(...).eq(...).eq(...).select(): oppdaterer radene som passer alle filtrene
    update(patch) {
      const filters = [];
      const q = {
        eq: (c, v) => { filters.push([c, v]); return q; },
        select: () => {
          calls.push(`${table}:update`);
          if (offline) return res();
          const hit = [...db[table].values()].filter(r => filters.every(([c, v]) => r[c] === v));
          for (const r of hit) Object.assign(r, patch, { updated_at: stamp() });
          return res(hit.map(r => ({ updated_at: r.updated_at })));
        },
      };
      return q;
    },
    delete() {
      return {
        in: (_, ids) => { calls.push(`${table}:delete`); ids.forEach(i => { db[table].delete(i); if (table === 'employers') for (const [k, s] of db.shifts) if (s.employer_id === i) db.shifts.delete(k); }); return res(); },
        eq: () => { db[table].clear(); return res(); },
      };
    },
    select() {
      return {
        order: () => ({ range: (a, b) => res([...db[table].values()].slice(a, b + 1).map(r => ({ ...r }))) }),
        eq: (_, id) => ({ maybeSingle: () => res(db[table].has(id) ? { ...db[table].get(id) } : null) }),
        maybeSingle: () => res(db.settings.size ? { ...[...db.settings.values()][0] } : null),
      };
    },
  });
  return { db, calls, from, stamp, setOffline: v => { offline = v; } };
}

let store, sb;
beforeEach(() => {
  mem.clear();
  store = new Store({ supabaseUrl: 'x', supabaseAnonKey: 'y' });
  sb = fakeSupabase();
  store.sb = sb; store.user = { id: 'u1', email: 'a@b.no' };
});

test('ny arbeidsgiver og vakt synkes i riktig rekkefølge', async () => {
  const e = store.upsertEmployer({ name: 'A', rate: 200, color: '#112233', rules: [] });
  store.upsertShift({ employerId: e.id, date: '2026-10-21', start: '08:00', end: '16:00', breakMin: 30, note: '' });
  store.upsertEmployer({ ...e, rate: 210 }); // endring etter vakta: må fortsatt sendes før vakta
  await new Promise(r => setTimeout(r, 20)); await store.sync();
  assert.equal(store.pending, 0);
  assert.equal(sb.db.employers.get(e.id).rate, 210);
  assert.equal(sb.db.shifts.size, 1);
  assert.equal([...sb.db.shifts.values()][0].start_time, '08:00');
  assert.equal(store.status, 'synced');
});

test('offline: endringer venter og sendes når nettet er tilbake', async () => {
  sb.setOffline(true);
  const e = store.upsertEmployer({ name: 'A', rate: 200, color: '#112233', rules: [] });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(store.pending, 1);
  assert.equal(store.status, 'offline');
  assert.equal(JSON.parse(mem.get('vaktbok:outbox:u1')).length, 1); // overlever omlasting
  sb.setOffline(false); clearTimeout(store.retryT);
  await store.sync();
  assert.equal(store.pending, 0);
  assert.ok(sb.db.employers.has(e.id));
});

test('henting tar inn endringer fra en annen enhet, men overskriver ikke ventende', async () => {
  sb.db.employers.set('e9', { id: 'e9', name: 'Fra mobilen', color: '#000000', rate: '199.50', rules: [], overtime: null, archived: false });
  sb.db.shifts.set('s9', { id: 's9', employer_id: 'e9', date: '2026-10-22', start_time: '22:00:00', end_time: '07:00:00', break_min: 0, note: '' });
  await store.sync();
  assert.equal(store.data.employers[0].rate, 199.5);
  assert.equal(store.data.shifts[0].start, '22:00');
  sb.setOffline(true);
  store.upsertShift({ ...store.data.shifts[0], note: 'lokal' });
  sb.db.shifts.get('s9').note = 'server';
  sb.setOffline(false); clearTimeout(store.retryT);
  store.syncing = false; await store.sync();
  assert.equal(sb.db.shifts.get('s9').note, 'lokal');
});

test('vakt som serveren avviser (fremmednøkkel) blokkerer ikke køen', async () => {
  store.queue({ table: 'shifts', op: 'upsert', id: 's1', row: { id: 's1', employerId: 'finnes-ikke', date: '2026-10-21', start: '08:00', end: '09:00', breakMin: 0, note: '' } });
  const e = store.upsertEmployer({ name: 'B', rate: 1, color: '#112233', rules: [] });
  await new Promise(r => setTimeout(r, 20)); await store.sync();
  assert.equal(store.pending, 0);
  assert.ok(sb.db.employers.has(e.id));
});

test('sletting av arbeidsgiver fjerner vakter lokalt og på server', async () => {
  const e = store.upsertEmployer({ name: 'A', rate: 200, color: '#112233', rules: [] });
  store.upsertShift({ employerId: e.id, date: '2026-10-21', start: '08:00', end: '16:00', breakMin: 0, note: '' });
  await new Promise(r => setTimeout(r, 20)); await store.sync();
  store.deleteEmployer(e.id);
  await new Promise(r => setTimeout(r, 20)); await store.sync();
  assert.equal(store.data.shifts.length, 0);
  assert.equal(sb.db.employers.size, 0); assert.equal(sb.db.shifts.size, 0);
});

test('kalenderlenke: krever innlogging og gir forståelige feilkoder', async () => {
  const s2 = new Store({ supabaseUrl: 'x', supabaseAnonKey: 'y' });
  await assert.rejects(() => s2.fetchCalendar('https://a.no/k.ics'), /login-required/);
  s2.user = { id: 'u1' };
  const reply = (data, error) => ({ functions: { invoke: async () => ({ data, error }) } });
  s2.sb = reply({ text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' }, null);
  assert.match(await s2.fetchCalendar('webcal://a.no/k.ics'), /VCALENDAR/);
  s2.sb = reply(null, { message: 'Edge Function returned a non-2xx status code', context: { status: 422, json: async () => ({ error: 'not-calendar' }) } });
  await assert.rejects(() => s2.fetchCalendar('https://a.no'), /not-calendar/);
  s2.sb = reply(null, { message: 'Function not found', context: { status: 404, json: async () => { throw new Error(); } } });
  await assert.rejects(() => s2.fetchCalendar('https://a.no'), /no-function/);
});

test('synk virker også når databasen mangler nye kolonner (fee, series_id, pay)', async () => {
  const s3 = new Store({ supabaseUrl: 'x', supabaseAnonKey: 'y' });
  s3.user = { id: 'u1' };
  const saved = { employers: [], shifts: [] };
  const missing = new Set(['fee', 'series_id', 'pay']);
  s3.sb = { from: table => ({
    upsert: async rows => {
      for (const r of rows) for (const c of Object.keys(r)) if (missing.has(c)) return { error: { code: 'PGRST204', message: `Could not find the '${c}' column of '${table}' in the schema cache` } };
      saved[table].push(...rows); return { error: null };
    },
    select: () => ({ order: () => ({ range: async () => ({ data: saved[table], error: null }) }), maybeSingle: async () => ({ data: null, error: null }) }),
  }) };
  const e = s3.upsertEmployer({ name: 'Foredrag', rate: 0, color: '#112233', rules: [], pay: { type: 'fee', feeDefault: 1000 } });
  s3.upsertShift({ employerId: e.id, date: '2026-11-03', start: '18:00', end: '20:00', breakMin: 0, note: '', fee: 1500, seriesId: 'abc' });
  await new Promise(r => setTimeout(r, 20)); s3.syncing = false; await s3.sync();
  assert.equal(s3.pending, 0, 'utboksen tømmes');
  assert.deepEqual([...s3.missingCols].sort(), ['fee', 'pay', 'series_id']);
  assert.equal(saved.shifts.length, 1);
  assert.ok(!('fee' in saved.shifts[0]) && !('series_id' in saved.shifts[0]));
});

test('profil: henter, markerer sist aktiv én gang per dag og lagrer navn', async () => {
  const s4 = new Store({ supabaseUrl: 'x', supabaseAnonKey: 'y' });
  s4.user = { id: 'u1' };
  let row = null, upserts = 0, meta = null;
  s4.sb = {
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      upsert: async r => { upserts++; row = { ...(row || {}), ...r }; return { error: null }; },
    }),
    auth: { updateUser: async ({ data }) => { meta = data; return {}; } },
  };
  const p = await s4.loadProfile();
  assert.equal(p.display_name, null);
  assert.ok(row.last_seen, 'sist aktiv lagret');
  await s4.loadProfile();
  assert.equal(upserts, 1, 'bare én oppdatering per dag');
  await assert.rejects(() => s4.setDisplayName(' a '), /name-length/);
  assert.equal(await s4.setDisplayName('  Hamza   Aziz '), 'Hamza Aziz');
  assert.equal(row.display_name, 'Hamza Aziz'); assert.deepEqual(meta, { display_name: 'Hamza Aziz' });
  const s5 = new Store({ supabaseUrl: 'x', supabaseAnonKey: 'y' }); s5.user = { id: 'u2' };
  s5.sb = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.profiles'" } }) }) }) };
  assert.equal(await s5.loadProfile(), null); assert.ok(s5.noProfiles, 'manglende tabell oppdages');
});

test('Google-knappen: sender token og uhashet nonce til Supabase', async () => {
  const s6 = new Store({ supabaseUrl: 'x', supabaseAnonKey: 'y' });
  let got = null;
  s6.sb = { auth: { signInWithIdToken: async a => { got = a; return { error: null }; } } };
  await s6.signInWithIdToken('tok', 'raw');
  assert.deepEqual(got, { provider: 'google', token: 'tok', nonce: 'raw' });
  s6.sb = { auth: { signInWithIdToken: async () => ({ error: { message: 'Passed nonce and nonce in id_token should either both exist or not.' } }) } };
  await assert.rejects(() => s6.signInWithIdToken('tok', 'raw'), /nonce/);
  const s7 = new Store({}); s7.sb = null;
  await assert.rejects(() => s7.signInWithIdToken('tok', 'raw'), /no-server/);
});

// ---------- Samtidige endringer på to enheter ----------
const tick = () => new Promise(r => setTimeout(r, 20));

async function twoDevices() {
  const e = store.upsertEmployer({ name: 'A', rate: 200, color: '#112233', rules: [] });
  store.upsertShift({ employerId: e.id, date: '2026-10-21', start: '08:00', end: '16:00', breakMin: 30, note: '' });
  await tick(); await store.sync();
  const shift = store.data.shifts[0];
  assert.ok(shift._v, 'versjonen fra serveren lagres lokalt');
  return { e, shift };
}

test('offline-endring og endring fra annen enhet i ulike felt: begge beholdes', async () => {
  const { shift } = await twoDevices();
  sb.setOffline(true);
  store.upsertShift({ ...shift, note: 'Avd 2' });               // denne enheten: notat
  await tick();
  Object.assign(sb.db.shifts.get(shift.id), { end_time: '17:00', updated_at: sb.stamp() }); // annen enhet: sluttid
  const seen = []; store.addEventListener('conflict', e => seen.push(e.detail));
  sb.setOffline(false); clearTimeout(store.retryT); store.syncing = false;
  await store.sync();
  const row = sb.db.shifts.get(shift.id);
  assert.equal(row.note, 'Avd 2');
  assert.equal(row.end_time, '17:00');
  assert.equal(store.data.shifts[0].end, '17:00', 'lokalt får også den andre enhetens endring');
  assert.equal(seen.length, 0, 'ingen beskjed når alt kunne slås sammen');
});

test('samme felt endret på begge: den første vinner, og brukeren får beskjed', async () => {
  const { shift } = await twoDevices();
  sb.setOffline(true);
  store.upsertShift({ ...shift, end: '18:00' });
  await tick();
  Object.assign(sb.db.shifts.get(shift.id), { end_time: '17:00', updated_at: sb.stamp() });
  const seen = []; store.addEventListener('conflict', e => seen.push(e.detail));
  sb.setOffline(false); clearTimeout(store.retryT); store.syncing = false;
  await store.sync();
  assert.equal(sb.db.shifts.get(shift.id).end_time, '17:00');
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].fields, ['end_time']);
  assert.equal(store.pending, 0);
});

test('vakt slettet på en annen enhet: endringen her gjenoppretter den ikke', async () => {
  const { shift } = await twoDevices();
  sb.setOffline(true);
  store.upsertShift({ ...shift, note: 'sent endring' });
  await tick();
  sb.db.shifts.delete(shift.id);
  const seen = []; store.addEventListener('conflict', e => seen.push(e.detail));
  sb.setOffline(false); clearTimeout(store.retryT); store.syncing = false;
  await store.sync();
  assert.equal(sb.db.shifts.size, 0);
  assert.equal(store.data.shifts.length, 0);
  assert.ok(seen[0].deleted);
});

test('flere endringer på rad uten nett gir ingen falsk kollisjon', async () => {
  const { shift } = await twoDevices();
  sb.setOffline(true);
  store.upsertShift({ ...shift, note: 'én' });
  store.upsertShift({ ...store.data.shifts[0], note: 'to', end: '15:00' });
  await tick();
  const seen = []; store.addEventListener('conflict', e => seen.push(e.detail));
  sb.setOffline(false); clearTimeout(store.retryT); store.syncing = false;
  await store.sync();
  assert.equal(sb.db.shifts.get(shift.id).note, 'to');
  assert.equal(sb.db.shifts.get(shift.id).end_time, '15:00');
  assert.equal(seen.length, 0);
  // og neste endring etter synk går rett igjennom
  store.upsertShift({ ...store.data.shifts[0], note: 'tre' });
  await tick(); await store.sync();
  assert.equal(sb.db.shifts.get(shift.id).note, 'tre');
  assert.equal(seen.length, 0);
});

test('innstillinger: lønnsslipper for ulike måneder fra to enheter beholdes begge', async () => {
  store.updateSettings({ minRestH: 11 });
  await tick(); await store.sync();
  sb.setOffline(true);
  store.updateSettings({ payslips: { '2026-09': { e1: 20000 } } });
  await tick();
  const srv = [...sb.db.settings.values()][0];
  srv.data = { ...srv.data, payslips: { '2026-10': { e1: 25000 } }, weekLimitH: 40 }; srv.updated_at = sb.stamp();
  sb.setOffline(false); clearTimeout(store.retryT); store.syncing = false;
  await store.sync();
  const data = [...sb.db.settings.values()][0].data;
  assert.deepEqual(Object.keys(data.payslips).sort(), ['2026-09', '2026-10']);
  assert.equal(data.weekLimitH, 40, 'endring fra den andre enheten beholdes');
  assert.equal(store.data.settings.weekLimitH, 40);
  assert.equal(store.data.settings.payslips['2026-09'].e1, 20000);
});

test('eksport tar ikke med interne versjonsfelt', async () => {
  await twoDevices();
  assert.ok(!('_v' in store.exportAll().shifts[0]));
});
