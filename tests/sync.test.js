// Testene forutsetter norsk tid (sommertid, helligdager). Settes her så det virker på Windows også.
process.env.TZ = 'Europe/Oslo';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coalesce, orderOps, mergeRemote } from '../js/sync-core.js';

test('utboksen beholder bare siste endring per rad', () => {
  let o = [];
  o = coalesce(o, { table: 'shifts', op: 'upsert', id: 'a', row: { v: 1 } });
  o = coalesce(o, { table: 'shifts', op: 'upsert', id: 'b', row: {} });
  o = coalesce(o, { table: 'shifts', op: 'upsert', id: 'a', row: { v: 2 } });
  o = coalesce(o, { table: 'employers', op: 'upsert', id: 'a', row: {} }); // annen tabell, samme id
  assert.equal(o.length, 3);
  assert.equal(o.find(x => x.table === 'shifts' && x.id === 'a').row.v, 2);
});

test('rekkefølge respekterer fremmednøkler', () => {
  const ops = [
    { table: 'employers', op: 'delete' }, { table: 'shifts', op: 'upsert' }, { table: 'shifts', op: 'delete' },
    { table: 'employers', op: 'upsert' }, { table: 'settings', op: 'upsert' },
  ];
  assert.deepEqual(orderOps(ops).map(o => `${o.table}:${o.op}`),
    ['employers:upsert', 'shifts:upsert', 'settings:upsert', 'shifts:delete', 'employers:delete']);
});

test('serverdata vinner, unntatt ventende endringer', () => {
  const local = { employers: [], shifts: [], settings: { minRestH: 11 } };
  const remote = {
    employers: [{ id: 'e1' }, { id: 'e2' }],
    shifts: [{ id: 's1', employerId: 'e1', v: 'server' }, { id: 's2', employerId: 'e1' }, { id: 's3', employerId: 'e2' }],
    settings: { minRestH: 9 },
  };
  const outbox = [
    { table: 'shifts', op: 'upsert', id: 's1', row: { id: 's1', employerId: 'e1', v: 'lokal' } },
    { table: 'shifts', op: 'delete', id: 's2' },
    { table: 'employers', op: 'delete', id: 'e2' },
    { table: 'shifts', op: 'upsert', id: 's9', row: { id: 's9', employerId: 'e1' } },
  ];
  const m = mergeRemote(local, remote, outbox);
  assert.deepEqual(m.employers.map(e => e.id), ['e1']);
  assert.deepEqual(m.shifts.map(s => s.id).sort(), ['s1', 's9']);
  assert.equal(m.shifts.find(s => s.id === 's1').v, 'lokal');
  assert.equal(m.settings.minRestH, 9);
});

test('ventende innstillinger beholdes lokalt', () => {
  const m = mergeRemote({ settings: { minRestH: 11 } }, { employers: [], shifts: [], settings: { minRestH: 9 } },
    [{ table: 'settings', op: 'upsert', id: 'settings', row: {} }]);
  assert.equal(m.settings.minRestH, 11);
});
