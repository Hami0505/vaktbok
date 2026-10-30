// Vaktbok – datalag.
// Lokalt først: alle endringer lagres umiddelbart i nettleseren og legges i en utboks.
// Når brukeren er logget inn og på nett, sendes utboksen til Supabase, og serverdata hentes inn.
import { DEFAULT_SETTINGS } from './logic.js';
import { mergeRemote, coalesce, orderOps, threeWay, settingsPaths, applyPaths, rebase } from './sync-core.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const K = {
  data: scope => `vaktbok:data:${scope}`,
  outbox: uid => `vaktbok:outbox:${uid}`,
  lastUser: 'vaktbok:lastUser',
};

export const newId = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

const read = (key, fallback) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Kunne ikke lagre lokalt', e); } };
const stripV = ({ _v, ...rest }) => rest;
const emptyData = () => ({ employers: [], shifts: [], settings: { ...DEFAULT_SETTINGS } });

// Radkonvertering app <-> database
const toRow = {
  employers: (e, uid) => ({ id: e.id, user_id: uid, name: e.name, color: e.color, rate: e.rate, rules: e.rules || [], overtime: e.overtime || null, archived: !!e.archived, pay: e.pay || null }),
  shifts: (s, uid) => ({ id: s.id, user_id: uid, employer_id: s.employerId, date: s.date, start_time: s.start, end_time: s.end, break_min: s.breakMin || 0, note: s.note || '', series_id: s.seriesId || null, fee: s.fee === '' || s.fee == null ? null : Number(s.fee), status: s.status === 'offered' ? 'offered' : null }),
};
const fromRow = {
  employers: r => ({ id: r.id, _v: r.updated_at, name: r.name, color: r.color, rate: Number(r.rate), rules: r.rules || [], overtime: r.overtime, archived: r.archived, pay: r.pay || null }),
  shifts: r => ({ id: r.id, _v: r.updated_at, employerId: r.employer_id, date: r.date, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5), breakMin: r.break_min, note: r.note || '', seriesId: r.series_id || null, fee: r.fee == null ? null : Number(r.fee), status: r.status || null }),
};

export class Store extends EventTarget {
  constructor(config) {
    super();
    this.config = config;
    this.sb = null;
    this.user = null;
    this.status = 'local';   // local | guest | syncing | synced | offline | error
    this.lastError = '';
    this.data = emptyData();
    this.outbox = [];
    this.retryMs = 2000;
    // Start med sist innloggede bruker og vaktene som allerede ligger lokalt, så første bilde er riktig.
    // Innloggingen sjekkes når Supabase-biblioteket er lastet, og byttes bare hvis den er en annen.
    this.useScope(this.configured ? read(K.lastUser, null) : null);
  }

  get configured() { return !!(this.config.supabaseUrl && this.config.supabaseAnonKey); }
  get scope() { return this.user ? this.user.id : 'guest'; }
  get pending() { return this.outbox.length; }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  setStatus(s, err = '') { this.status = s; this.lastError = err; this.emit('status'); }

  async init() {
    if (this.configured) {
      try {
        const { createClient } = await import(SUPABASE_JS);
        this.sb = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
        });
        this.joinPresence();
        const { data } = await this.sb.auth.getSession();
        this.useScope(data.session?.user || null);
        this.sb.auth.onAuthStateChange((event, session) => {
          const u = session?.user || null;
          if ((u && u.id) !== (this.user && this.user.id)) this.onUserChanged(u);
        });
      } catch (e) {
        // Biblioteket kunne ikke lastes (typisk offline før første besøk): bruk sist kjente bruker lokalt.
        console.warn('Supabase utilgjengelig', e);
        const last = read(K.lastUser, null);
        this.useScope(last);
        this.setStatus('offline');
      }
    } else {
      this.useScope(null);
    }
    addEventListener('online', () => this.sync());
    addEventListener('offline', () => this.user && this.setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.sync(); });
    if (this.user) this.sync();
  }

  // Sanntid: når en annen enhet endrer noe, hentes data på nytt (samlet, med kort forsinkelse).
  subscribe() {
    this.unsubscribe();
    if (!this.sb || !this.user) return;
    const uid = this.user.id;
    const ch = this.sb.channel(`vaktbok-${uid}`);
    for (const table of ['employers', 'shifts', 'settings']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` }, () => {
        clearTimeout(this.pullT);
        this.pullT = setTimeout(() => this.sync(), 600);
      });
    }
    this.channel = ch.subscribe();
  }

  unsubscribe() {
    if (this.channel && this.sb) { try { this.sb.removeChannel(this.channel); } catch { } }
    this.channel = null;
  }

  useScope(user) {
    if ((user && user.id) !== (this.user && this.user.id)) this.profile = null;
    this.user = user ? { id: user.id, email: user.email, name: user.user_metadata?.full_name || user.user_metadata?.name || user.name || '' } : null;
    if (this.sb) this.user ? this.subscribe() : this.unsubscribe();
    this.data = { ...emptyData(), ...read(K.data(this.scope), {}) };
    this.data.settings = { ...DEFAULT_SETTINGS, ...this.data.settings };
    this.outbox = this.user ? read(K.outbox(this.user.id), []) : [];
    if (this.user) write(K.lastUser, this.user);
    this.setStatus(!this.configured ? 'local' : this.user ? (navigator.onLine ? 'syncing' : 'offline') : 'guest');
    this.emit('change');
  }

  async onUserChanged(user) {
    this.useScope(user);
    this.trackPresence();
    if (user) {
      const guest = read(K.data('guest'), null);
      if (guest && (guest.shifts?.length || guest.employers?.length)) this.emit('guest-data', guest);
      await this.sync();
      this.loadProfile();
    }
  }

  persist() {
    write(K.data(this.scope), this.data);
    if (this.user) write(K.outbox(this.user.id), this.outbox);
    this.emit('change');
  }

  queue(op) {
    if (!this.user) return;
    this.outbox = coalesce(this.outbox, op);
  }

  // ---------- Endringer ----------

  // Lagrer en rad lokalt og legger den i utboksen sammen med serverversjonen (_v) den bygger på,
  // så synken kan oppdage om en annen enhet har endret samme rad i mellomtiden.
  put(table, input) {
    const list = this.data[table];
    const i = list.findIndex(x => x.id === input.id);
    const old = i >= 0 ? list[i] : null;
    const item = { ...input, _v: old?._v };
    if (!item._v) delete item._v;
    if (i >= 0) list[i] = item; else list.push(item);
    const op = { table, op: 'upsert', id: item.id, row: item };
    if (old?._v) { op.base = old._v; op.prev = old; }
    this.queue(op);
    return item;
  }

  upsertEmployer(e) {
    const item = this.put('employers', { ...e, id: e.id || newId() });
    this.persist(); this.sync();
    return item;
  }

  deleteEmployer(id) {
    for (const s of this.data.shifts.filter(s => s.employerId === id)) {
      this.outbox = this.outbox.filter(o => !(o.table === 'shifts' && o.id === s.id)); // databasen sletter vaktene via cascade
    }
    this.data.shifts = this.data.shifts.filter(s => s.employerId !== id);
    this.data.employers = this.data.employers.filter(e => e.id !== id);
    this.queue({ table: 'employers', op: 'delete', id });
    this.persist(); this.sync();
  }

  upsertShift(s) {
    const item = this.put('shifts', { ...s, id: s.id || newId() });
    this.persist(); this.sync();
    return item;
  }

  deleteShift(id) {
    this.data.shifts = this.data.shifts.filter(s => s.id !== id);
    this.queue({ table: 'shifts', op: 'delete', id });
    this.persist(); this.sync();
  }

  updateSettings(patch) {
    const before = this.data.settings;
    this.data.settings = { ...this.data.settings, ...patch };
    // Bare delene som faktisk endret seg, sendes som endring. Resten tas fra serveren ved synk.
    this.queue({ table: 'settings', op: 'upsert', id: 'settings', row: this.data.settings, paths: settingsPaths(before, this.data.settings) });
    this.persist(); this.sync();
  }

  // Legger til data (import, gjestedata eller prototype) uten å overskrive eksisterende. Lagres samlet.
  addAll({ employers = [], shifts = [] }) {
    for (const e of employers) this.put('employers', e);
    for (const s of shifts) this.put('shifts', s);
    this.persist(); this.sync();
  }

  clearGuestData() { localStorage.removeItem(K.data('guest')); }

  exportAll() {
    return {
      app: 'Vaktbok', format: 2, exportedAt: new Date().toISOString(),
      account: this.user ? this.user.email : null,
      employers: this.data.employers.map(stripV), shifts: this.data.shifts.map(stripV), settings: this.data.settings,
    };
  }

  // ---------- Synk ----------

  async sync() {
    if (!this.sb || !this.user) return;
    if (!navigator.onLine) { this.setStatus('offline'); return; }
    if (this.syncing) { this.again = true; return; }
    this.syncing = true;
    this.setStatus('syncing');
    try {
      await this.flush();
      await this.pull();
      this.retryMs = 2000;
      this.setStatus(this.pending ? 'syncing' : 'synced');
    } catch (e) {
      const offline = !navigator.onLine || e instanceof TypeError;
      this.setStatus(offline ? 'offline' : 'error', offline ? '' : (e.message || String(e)));
      clearTimeout(this.retryT);
      this.retryT = setTimeout(() => this.sync(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 60000);
    } finally {
      this.syncing = false;
      if (this.again) { this.again = false; this.sync(); }
    }
  }

  async flush() {
    const uid = this.user.id;
    const snapshot = orderOps(this.outbox.slice());
    const groups = [
      ['employers', 'upsert'], ['shifts', 'upsert'], ['settings', 'upsert'], ['shifts', 'delete'], ['employers', 'delete'],
    ];
    const done = list => { this.outbox = this.outbox.filter(o => !list.includes(o)); write(K.outbox(uid), this.outbox); };
    for (const [table, op] of groups) {
      const ops = snapshot.filter(o => o.table === table && o.op === op);
      if (!ops.length) continue;
      if (table === 'settings') { await this.pushSettings(ops); done(ops); continue; }
      if (op === 'upsert') {
        // Endringer av rader serveren har sett før, sendes betinget (se pushChecked). Nye rader sendes samlet.
        const checked = ops.filter(o => o.base), plain = ops.filter(o => !o.base);
        for (const o of checked) { await this.pushChecked(table, o); done([o]); }
        for (let i = 0; i < plain.length; i += 500) {
          const chunk = plain.slice(i, i + 500);
          const rows = chunk.map(o => toRow[table](o.row, uid));
          const res = await this.withColumns(rows, () => this.sb.from(table).upsert(rows));
          this.check(res, chunk);
          for (const o of chunk) this.outbox = rebase(this.outbox, table, o.id, o.row, undefined, o);
          done(chunk);
        }
        continue;
      }
      for (let i = 0; i < ops.length; i += 500) {
        const chunk = ops.slice(i, i + 500);
        this.check(await this.sb.from(table).delete().in('id', chunk.map(o => o.id)), chunk);
        done(chunk);
      }
    }
  }

  // Integritets-/tilgangsfeil løses ikke ved å prøve igjen: forkast, så retter neste henting opp lokalt.
  check(res, ops) {
    if (!res.error) return;
    if (/^(23|42501)/.test(res.error.code || '')) console.warn('Forkastet endringer som serveren avviste', res.error, ops);
    else throw new Error(res.error.message);
  }

  // Nye kolonner (series_id, fee, pay, status) som databasen ikke har ennå, sendes ikke. Appen sier fra under Konto.
  async withColumns(rows, call) {
    this.missingCols ||= new Set();
    const strip = () => rows.forEach(r => this.missingCols.forEach(c => delete r[c]));
    strip();
    let res = await call();
    for (let tries = 0; res.error && tries < 3; tries++) {
      const col = ['series_id', 'fee', 'pay', 'status'].find(c => new RegExp(`\\b${c}\\b`).test(res.error.message || ''));
      if (!col || this.missingCols.has(col)) break;
      this.missingCols.add(col); this.emit('status'); strip();
      res = await call();
    }
    return res;
  }

  // Oppdaterer bare hvis raden fortsatt har versjonen endringen bygde på. Har en annen enhet
  // endret den i mellomtiden, slås endringene sammen felt for felt, og det prøves på nytt.
  async pushChecked(table, o) {
    const uid = this.user.id;
    let base = o.base, row = toRow[table](o.row, uid);
    const prev = o.prev ? toRow[table](o.prev, uid) : null;
    const clashes = new Set();
    for (let tries = 0; tries < 4; tries++) {
      const send = { ...row };
      const res = await this.withColumns([send], () => this.sb.from(table).update(send).eq('id', o.id).eq('updated_at', base).select('updated_at'));
      this.check(res, [o]);
      if (res.error) return;
      if (res.data?.length) {
        this.outbox = rebase(this.outbox, table, o.id, o.row, res.data[0].updated_at, o);
        if (clashes.size) this.emit('conflict', { table, id: o.id, row: o.row, fields: [...clashes] });
        return;
      }
      const cur = await this.sb.from(table).select('*').eq('id', o.id).maybeSingle();
      if (cur.error) throw new Error(cur.error.message);
      if (!cur.data) { this.emit('conflict', { table, id: o.id, row: o.row, deleted: true }); return; } // slettet på en annen enhet
      const merged = threeWay(prev, row, toRow[table](fromRow[table](cur.data), uid));
      merged.clashes.forEach(c => clashes.add(c));
      row = merged.row; base = cur.data.updated_at;
    }
    throw new Error('Raden endres stadig på en annen enhet. Prøver igjen.');
  }

  // Innstillinger: hent serverens versjon, legg på bare det som er endret her, og lagre betinget.
  async pushSettings(ops) {
    const uid = this.user.id, last = ops[ops.length - 1];
    for (let tries = 0; tries < 4; tries++) {
      const cur = await this.sb.from('settings').select('data,updated_at').maybeSingle();
      if (cur.error) throw new Error(cur.error.message);
      if (!cur.data) { this.check(await this.sb.from('settings').upsert({ user_id: uid, data: this.data.settings }), ops); return; }
      const data = applyPaths(cur.data.data || {}, this.data.settings, last.paths);
      const res = await this.sb.from('settings').update({ data }).eq('user_id', uid).eq('updated_at', cur.data.updated_at).select('updated_at');
      this.check(res, ops);
      if (res.error || res.data?.length) return;
    }
    throw new Error('Innstillingene endres stadig på en annen enhet. Prøver igjen.');
  }

  async fetchAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.sb.from(table).select('*').order('id').range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }

  async pull() {
    const [emps, shifts, settings] = await Promise.all([
      this.fetchAll('employers'), this.fetchAll('shifts'),
      this.sb.from('settings').select('data').maybeSingle(),
    ]);
    if (settings.error) throw new Error(settings.error.message);
    this.data = mergeRemote(this.data, {
      employers: emps.map(fromRow.employers),
      shifts: shifts.map(fromRow.shifts),
      settings: settings.data ? { ...DEFAULT_SETTINGS, ...settings.data.data } : null,
    }, this.outbox);
    this.persist();
  }

  // ---------- Konto ----------

  // ---------- Profil: navn og sist aktiv ----------
  // Tabellen profiles finnes bare når oppdatert SQL er kjørt. Uten den virker alt annet som før.
  async loadProfile() {
    if (!this.sb || !this.user) return null;
    const { data, error } = await this.sb.from('profiles').select('display_name,last_seen').maybeSingle();
    if (error) { this.noProfiles = /profiles|42P01|PGRST205/i.test(`${error.code} ${error.message}`); return null; }
    this.noProfiles = false;
    this.profile = data || { display_name: null, last_seen: null };
    const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (this.profile.last_seen !== iso) {
      const r = await this.sb.from('profiles').upsert({ user_id: this.user.id, last_seen: iso });
      if (!r.error) this.profile.last_seen = iso;
    }
    this.emit('profile');
    return this.profile;
  }

  async setDisplayName(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 40) throw new Error('name-length');
    const { error } = await this.sb.from('profiles').upsert({ user_id: this.user.id, display_name: clean });
    if (error) throw new Error(error.message);
    // Vises også som «Display name» under Authentication → Users i Supabase.
    try { await this.sb.auth.updateUser({ data: { display_name: clean } }); } catch { }
    this.profile = { ...(this.profile || {}), display_name: clean };
    this.emit('profile');
    return clean;
  }

  // ---------- «Inne nå»: hver åpen app melder seg på med en tilfeldig ID, uten navn eller e-post ----------
  // Nøkkelen er en fast, tilfeldig ID for enheten (lagret lokalt), så flere faner på samme enhet teller som én.
  // Det eneste som sendes, er om enheten er innlogget eller ikke. Aldri hvem.
  joinPresence() {
    try {
      let key = localStorage.getItem('vaktbok:device');
      if (!key) { key = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2); localStorage.setItem('vaktbok:device', key); }
      const ch = this.sb.channel('vaktbok-online', { config: { presence: { key } } });
      this.presence = ch;
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        this.online = Object.keys(state).length;
        this.onlineIn = Object.values(state).filter(metas => metas.some(m => m.in)).length;
        this.emit('presence');
      }).subscribe(st => { if (st === 'SUBSCRIBED') { this.presenceReady = true; this.trackPresence(); } });
    } catch { /* sanntid er en bonus, ikke nødvendig */ }
  }
  trackPresence() {
    if (this.presence && this.presenceReady) Promise.resolve(this.presence.track({ in: !!this.user })).catch(() => { });
  }

  // ---------- Statistikk for administrator (supabase/migrations/2026-10-28-statistikk.sql) ----------
  // true/false når serveren har svart, null når den ikke kunne spørres (ikke lastet ennå, uten nett, feil).
  async isAdmin() {
    if (!this.sb || !this.user) return null;
    try {
      const { data, error } = await this.sb.rpc('is_admin');
      return error ? null : data === true;
    } catch { return null; }
  }
  async adminStats() {
    const { data, error } = await this.sb.rpc('admin_stats');
    if (error) throw new Error(error.message);
    return data;
  }

  // ---------- Kalenderabonnement (supabase/functions/calendar) ----------
  async getFeed() {
    const { data, error } = await this.sb.from('calendar_feeds').select('token').maybeSingle();
    if (error) throw new Error(error.message);
    return data?.token || null;
  }
  async newFeed() {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    const { error } = await this.sb.from('calendar_feeds').upsert({ user_id: this.user.id, token });
    if (error) throw new Error(error.message);
    return token;
  }
  async deleteFeed() {
    const { error } = await this.sb.from('calendar_feeds').delete().eq('user_id', this.user.id);
    if (error) throw new Error(error.message);
  }
  feedUrl(token) {
    return `${this.config.supabaseUrl.replace(/^https:/, 'webcal:')}/functions/v1/calendar?t=${token}`;
  }

  // ---------- Tilbakemelding (supabase/functions/feedback) ----------
  async sendFeedback(payload) {
    if (!this.sb) throw new Error('no-server');
    const { error } = await this.sb.functions.invoke('feedback', { body: payload });
    if (error) {
      let code = 'failed';
      try { code = (await error.context.json()).error || code; } catch { }
      if (error.context && error.context.status === 404) code = 'no-function';
      throw new Error(code);
    }
  }

  // Henter en kalender via serverfunksjonen ics-proxy (supabase/functions/ics-proxy). Krever innlogging.
  async fetchCalendar(url) {
    if (!this.sb || !this.user) throw new Error('login-required');
    const { data, error } = await this.sb.functions.invoke('ics-proxy', { body: { url } });
    if (error) {
      let code = 'failed';
      try { code = (await error.context.json()).error || code; } catch { if (/not found|404/i.test(error.message)) code = 'no-function'; }
      if (error.context && error.context.status === 404) code = 'no-function';
      throw new Error(code);
    }
    if (!data || typeof data.text !== 'string') throw new Error('failed');
    return data.text;
  }

  // Innlogging med Google (eller annen leverandør satt opp i Supabase → Authentication → Providers).
  async signInWithProvider(provider) {
    if (!this.sb) throw new Error('no-server');
    const { error } = await this.sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
    if (error) throw new Error(error.message);
  }

  // Innlogging med Googles egen knapp (Google Identity Services). Google viser appens adresse i stedet for Supabase sin.
  // rawNonce er den uhashede verdien; Google fikk SHA-256 av den.
  async signInWithIdToken(token, rawNonce) {
    if (!this.sb) throw new Error('no-server');
    const { error } = await this.sb.auth.signInWithIdToken({ provider: 'google', token, nonce: rawNonce });
    if (error) throw new Error(error.message);
  }

  async sendCode(email) {
    const redirect = location.origin + location.pathname;
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
    if (error) throw new Error(error.message);
  }

  async verifyCode(email, token) {
    const { error } = await this.sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw new Error(error.message);
  }

  async signOut({ force = false } = {}) {
    if (this.pending && !force) return false;
    const uid = this.user?.id;
    try { await this.sb.auth.signOut(); } catch (e) { console.warn(e); }
    if (uid) { localStorage.removeItem(K.data(uid)); localStorage.removeItem(K.outbox(uid)); }
    localStorage.removeItem(K.lastUser);
    this.useScope(null);
    return true;
  }

  async deleteEverything() {
    if (this.user) {
      const a = await this.sb.from('shifts').delete().eq('user_id', this.user.id);
      const b = await this.sb.from('employers').delete().eq('user_id', this.user.id);
      if (a.error || b.error) throw new Error((a.error || b.error).message);
      this.outbox = [];
    }
    this.data = { ...emptyData(), settings: this.data.settings };
    this.persist();
  }

  async deleteAccount() {
    const { error } = await this.sb.rpc('delete_my_account');
    if (error) throw new Error(error.message);
    this.outbox = [];
    await this.signOut({ force: true });
  }
}
