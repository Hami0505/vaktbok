// Vaktbok – datalag.
// Lokalt først: alle endringer lagres umiddelbart i nettleseren og legges i en utboks.
// Når brukeren er logget inn og på nett, sendes utboksen til Supabase, og serverdata hentes inn.
import { DEFAULT_SETTINGS } from './logic.js';
import { mergeRemote, coalesce, orderOps } from './sync-core.js';

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
const emptyData = () => ({ employers: [], shifts: [], settings: { ...DEFAULT_SETTINGS } });

// Radkonvertering app <-> database
const toRow = {
  employers: (e, uid) => ({ id: e.id, user_id: uid, name: e.name, color: e.color, rate: e.rate, rules: e.rules || [], overtime: e.overtime || null, archived: !!e.archived, pay: e.pay || null }),
  shifts: (s, uid) => ({ id: s.id, user_id: uid, employer_id: s.employerId, date: s.date, start_time: s.start, end_time: s.end, break_min: s.breakMin || 0, note: s.note || '', series_id: s.seriesId || null, fee: s.fee === '' || s.fee == null ? null : Number(s.fee) }),
};
const fromRow = {
  employers: r => ({ id: r.id, name: r.name, color: r.color, rate: Number(r.rate), rules: r.rules || [], overtime: r.overtime, archived: r.archived, pay: r.pay || null }),
  shifts: r => ({ id: r.id, employerId: r.employer_id, date: r.date, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5), breakMin: r.break_min, note: r.note || '', seriesId: r.series_id || null, fee: r.fee == null ? null : Number(r.fee) }),
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
    this.user = user ? { id: user.id, email: user.email } : null;
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
    if (user) {
      const guest = read(K.data('guest'), null);
      if (guest && (guest.shifts?.length || guest.employers?.length)) this.emit('guest-data', guest);
      await this.sync();
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

  upsertEmployer(e) {
    const item = { ...e, id: e.id || newId() };
    const i = this.data.employers.findIndex(x => x.id === item.id);
    if (i >= 0) this.data.employers[i] = item; else this.data.employers.push(item);
    this.queue({ table: 'employers', op: 'upsert', id: item.id, row: item });
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
    const item = { ...s, id: s.id || newId() };
    const i = this.data.shifts.findIndex(x => x.id === item.id);
    if (i >= 0) this.data.shifts[i] = item; else this.data.shifts.push(item);
    this.queue({ table: 'shifts', op: 'upsert', id: item.id, row: item });
    this.persist(); this.sync();
    return item;
  }

  deleteShift(id) {
    this.data.shifts = this.data.shifts.filter(s => s.id !== id);
    this.queue({ table: 'shifts', op: 'delete', id });
    this.persist(); this.sync();
  }

  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.queue({ table: 'settings', op: 'upsert', id: 'settings', row: this.data.settings });
    this.persist(); this.sync();
  }

  // Legger til data (import, gjestedata eller prototype) uten å overskrive eksisterende. Lagres samlet.
  addAll({ employers = [], shifts = [] }) {
    const put = (list, item) => { const i = list.findIndex(x => x.id === item.id); if (i >= 0) list[i] = item; else list.push(item); };
    for (const e of employers) { put(this.data.employers, e); this.queue({ table: 'employers', op: 'upsert', id: e.id, row: e }); }
    for (const s of shifts) { put(this.data.shifts, s); this.queue({ table: 'shifts', op: 'upsert', id: s.id, row: s }); }
    this.persist(); this.sync();
  }

  clearGuestData() { localStorage.removeItem(K.data('guest')); }

  exportAll() {
    return {
      app: 'Vaktbok', format: 2, exportedAt: new Date().toISOString(),
      account: this.user ? this.user.email : null,
      employers: this.data.employers, shifts: this.data.shifts, settings: this.data.settings,
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
    for (const [table, op] of groups) {
      const ops = snapshot.filter(o => o.table === table && o.op === op);
      if (!ops.length) continue;
      for (let i = 0; i < ops.length; i += 500) {
        const chunk = table === 'settings' ? ops.slice(-1) : ops.slice(i, i + 500);
        let res;
        if (table === 'settings') res = await this.sb.from('settings').upsert({ user_id: uid, data: chunk[0].row });
        else if (op === 'upsert') {
          const rows = chunk.map(o => toRow[table](o.row, uid));
          // Nye kolonner (series_id, fee, pay) som databasen ikke har ennå, sendes ikke. Appen sier fra under Konto.
          this.missingCols ||= new Set();
          const strip = () => rows.forEach(r => this.missingCols.forEach(c => delete r[c]));
          strip();
          res = await this.sb.from(table).upsert(rows);
          for (let tries = 0; res.error && tries < 3; tries++) {
            const col = ['series_id', 'fee', 'pay'].find(c => new RegExp(`\\b${c}\\b`).test(res.error.message || ''));
            if (!col || this.missingCols.has(col)) break;
            this.missingCols.add(col); this.emit('status'); strip();
            res = await this.sb.from(table).upsert(rows);
          }
        }
        else res = await this.sb.from(table).delete().in('id', chunk.map(o => o.id));
        if (res.error) {
          // Integritets-/tilgangsfeil løses ikke ved å prøve igjen: forkast, så retter neste henting opp lokalt.
          if (/^(23|42501)/.test(res.error.code || '')) console.warn('Forkastet endringer som serveren avviste', res.error, chunk);
          else throw new Error(res.error.message);
        }
        const done = table === 'settings' ? ops : chunk;
        this.outbox = this.outbox.filter(o => !done.includes(o));
        write(K.outbox(uid), this.outbox);
        if (table === 'settings') break;
      }
    }
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
