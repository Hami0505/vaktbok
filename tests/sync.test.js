// Testene forutsetter norsk tid (sommertid, helligdager). Settes her så det virker på Windows også.
process.env.TZ = 'Europe/Oslo';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coalesce, orderOps, mergeRemote, threeWay, settingsPaths, applyPaths, rebase } from '../js/sync-core.js';

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

test('tre-veis: hver enhet får sine felt, samme felt gir kollisjon og serveren vinner', () => {
  const prev = { id: 1, note: '', end: '16:00', start: '08:00' };
  const r = threeWay(prev, { ...prev, note: 'lokal', start: '09:00' }, { ...prev, end: '17:00', start: '07:00' });
  assert.deepEqual(r.row, { id: 1, note: 'lokal', end: '17:00', start: '07:00' });
  assert.deepEqual(r.clashes, ['start']);
  assert.deepEqual(threeWay(prev, { ...prev, note: 'x' }, { ...prev, note: 'x' }).clashes, [], 'lik endring er ingen kollisjon');
});

test('utboksen beholder utgangspunktet fra første endring', () => {
  let o = coalesce([], { table: 'shifts', op: 'upsert', id: 'a', row: { v: 1 }, base: 't1', prev: { v: 0 } });
  o = coalesce(o, { table: 'shifts', op: 'upsert', id: 'a', row: { v: 2 }, base: 't9', prev: { v: 1 } });
  assert.equal(o[0].base, 't1'); assert.deepEqual(o[0].prev, { v: 0 }); assert.equal(o[0].row.v, 2);
  o = rebase(o, 'shifts', 'a', { v: 2 }, 't2');
  assert.equal(o[0].base, 't2'); assert.deepEqual(o[0].prev, { v: 2 });
});

test('innstillinger: endrede deler finnes ett nivå ned og legges oppå serverens', () => {
  const before = { a: 1, payslips: { '2026-09': 1 }, links: [1] };
  const after = { a: 1, payslips: { '2026-09': 1, '2026-10': 2 }, links: [1, 2] };
  const paths = settingsPaths(before, after);
  assert.deepEqual(paths, [['payslips', '2026-10'], ['links']]);
  const merged = applyPaths({ a: 5, payslips: { '2026-08': 3 }, links: [] }, after, paths);
  assert.deepEqual(merged, { a: 5, payslips: { '2026-08': 3, '2026-10': 2 }, links: [1, 2] });
  // sletting av en serie fjernes også på serveren
  const del = settingsPaths({ series: { x: 1, y: 2 } }, { series: { y: 2 } });
  assert.deepEqual(applyPaths({ series: { x: 1, y: 2, z: 3 } }, { series: { y: 2 } }, del), { series: { y: 2, z: 3 } });
});

test('eldre innstillingsendring uten liste betyr fortsatt «alt herfra»', () => {
  let o = coalesce([], { table: 'settings', op: 'upsert', id: 'settings', row: {} });
  o = coalesce(o, { table: 'settings', op: 'upsert', id: 'settings', row: {}, paths: [['a']] });
  assert.equal(o[0].paths, undefined);
});
