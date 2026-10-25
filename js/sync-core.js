// Ren synk-logikk (ingen nettverk, ingen DOM) – testes i tests/sync.test.js.

// Legger en endring i utboksen. Bare siste endring per rad beholdes.
export function coalesce(outbox, op) {
  return [...outbox.filter(o => !(o.table === op.table && o.id === op.id)), op];
}

// Sikker rekkefølge mot fremmednøkler: arbeidsgivere før vakter ved lagring, motsatt ved sletting.
const ORDER = { 'employers:upsert': 0, 'shifts:upsert': 1, 'settings:upsert': 2, 'shifts:delete': 3, 'employers:delete': 4 };
export function orderOps(ops) {
  return ops.slice().sort((a, b) => ORDER[`${a.table}:${a.op}`] - ORDER[`${b.table}:${b.op}`]);
}

// Serveren er fasit, unntatt for rader med endringer som ennå ikke er sendt.
export function mergeRemote(local, remote, outbox) {
  const pending = table => new Map(outbox.filter(o => o.table === table).map(o => [o.id, o]));
  const mergeTable = table => {
    const p = pending(table);
    const out = remote[table].filter(r => !p.has(r.id));
    for (const o of p.values()) if (o.op === 'upsert') out.push(o.row);
    return out;
  };
  const employers = mergeTable('employers');
  const empIds = new Set(employers.map(e => e.id));
  const shifts = mergeTable('shifts').filter(s => empIds.has(s.employerId));
  const settingsPending = outbox.some(o => o.table === 'settings');
  const settings = settingsPending || !remote.settings ? local.settings : remote.settings;
  return { employers, shifts, settings };
}
