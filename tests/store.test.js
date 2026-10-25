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
  let offline = false;
  const res = (data = null) => offline ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ data, error: null });
  const from = table => ({
    upsert(rows) {
      calls.push(`${table}:upsert`);
      for (const r of [].concat(rows)) {
        if (table === 'shifts' && !db.employers.has(r.employer_id)) return Promise.resolve({ error: { code: '23503', message: 'fk' } });
        db[table].set(r.id ?? r.user_id, r);
      }
      return res();
    },
    delete() {
      return {
        in: (_, ids) => { calls.push(`${table}:delete`); ids.forEach(i => { db[table].delete(i); if (table === 'employers') for (const [k, s] of db.shifts) if (s.employer_id === i) db.shifts.delete(k); }); return res(); },
        eq: () => { db[table].clear(); return res(); },
      };
    },
    select() {
      return {
        order: () => ({ range: (a, b) => res([...db[table].values()].slice(a, b + 1)) }),
        maybeSingle: () => res(db.settings.size ? { data: [...db.settings.values()][0].data } : null),
      };
    },
  });
  return { db, calls, from, setOffline: v => { offline = v; } };
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
