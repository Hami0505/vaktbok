// Ren synk-logikk (ingen nettverk, ingen DOM) – testes i tests/sync.test.js.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Legger en endring i utboksen. Bare siste endring per rad beholdes.
// Utgangspunktet (base = serverversjonen, prev = raden før første endring) beholdes fra den
// første ventende endringen, siden serveren ennå ikke har sett noen av dem.
// For innstillinger slås listene over endrede felt (paths) sammen.
export function coalesce(outbox, op) {
  const old = outbox.find(o => o.table === op.table && o.id === op.id);
  let next = op;
  if (old && old.op === 'upsert' && op.op === 'upsert') {
    next = { ...op };
    if ('base' in old) { next.base = old.base; next.prev = old.prev; }
    // En eldre endring uten liste betyr «alt herfra», og det må den fortsatt bety.
    if (old.table === 'settings') next.paths = old.paths && op.paths ? mergePaths(old.paths, op.paths) : undefined;
  }
  return [...outbox.filter(o => o !== old), next];
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
  const settingsPending = outbox.find(o => o.table === 'settings');
  let settings = remote.settings || local.settings;
  if (settingsPending && remote.settings) settings = applyPaths(remote.settings, local.settings, settingsPending.paths);
  else if (settingsPending) settings = local.settings;
  return { employers, shifts, settings };
}

// ---------- Samtidige endringer på to enheter ----------

// Tre-veis sammenslåing av én rad (samme form på alle tre): felt bare denne enheten endret,
// tas herfra. Felt bare den andre enheten endret, tas fra serveren. Endret begge samme felt
// ulikt, vinner serveren (den endringen kom først), og feltet meldes som kollisjon.
export function threeWay(prev, local, remote, skip = ['id', 'user_id']) {
  const row = { ...remote }, clashes = [];
  for (const k of Object.keys(local)) {
    if (skip.includes(k)) continue;
    const mine = !same(local[k], prev?.[k]);
    if (!mine) continue;
    const theirs = !same(remote[k], prev?.[k]);
    if (!theirs || same(remote[k], local[k])) row[k] = local[k];
    else clashes.push(k);
  }
  return { row, clashes };
}

// Hvilke deler av innstillingene en endring rører. Objekter (serier, lønnsslipper) sammenlignes
// ett nivå ned, så to enheter kan legge inn hver sin lønnsslipp uten å overskrive hverandre.
export function settingsPaths(before, after) {
  const out = [];
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before?.[k], b = after?.[k];
    if (same(a, b)) continue;
    if (isObj(a) && isObj(b)) {
      for (const s of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[s], b[s])) out.push([k, s]);
    } else out.push([k]);
  }
  return out;
}

export function mergePaths(a, b) {
  const seen = new Set(), out = [];
  for (const p of [...a, ...b]) { const key = JSON.stringify(p); if (!seen.has(key)) { seen.add(key); out.push(p); } }
  return out;
}

// Legger denne enhetens endrede deler oppå serverens innstillinger. Uten liste: alt herfra (som før).
export function applyPaths(remote, local, paths) {
  if (!paths) return { ...local };
  const out = { ...remote };
  for (const [k, s] of paths) {
    if (s === undefined) { if (k in local) out[k] = local[k]; else delete out[k]; continue; }
    const base = isObj(out[k]) ? { ...out[k] } : {};
    if (isObj(local[k]) && s in local[k]) base[s] = local[k][s]; else delete base[s];
    out[k] = base;
  }
  return out;
}

// Etter at en rad er sendt: en endring som kom til mens den var underveis, bygger nå på den
// sendte versjonen, ikke den gamle.
// Endringen som nettopp ble sendt (sent), står urørt, så den kan fjernes fra utboksen etterpå.
export function rebase(outbox, table, id, sentRow, version, sent = null) {
  return outbox.map(o => o !== sent && o.table === table && o.id === id && o.op === 'upsert' && 'base' in o
    ? { ...o, prev: sentRow, base: version ?? o.base } : o);
}
