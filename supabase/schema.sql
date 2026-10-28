-- Vaktbok – databaseskjema for Supabase (Postgres).
-- Kjør hele filen i Supabase: SQL Editor → New query → Run. Filen kan kjøres flere ganger.

-- ---------- Arbeidsgivere ----------
create table if not exists public.employers (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  color       text not null default '#1F6F6B' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  rate        numeric(10,2) not null default 0 check (rate between 0 and 10000),
  rules       jsonb not null default '[]'::jsonb check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) <= 20),
  overtime    jsonb,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id)
);

-- ---------- Vakter ----------
create table if not exists public.shifts (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  employer_id  uuid not null,
  date         date not null,
  start_time   time not null,
  end_time     time not null,
  break_min    integer not null default 0 check (break_min between 0 and 600),
  note         text not null default '' check (char_length(note) <= 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Sammensatt nøkkel: en vakt kan bare peke på en arbeidsgiver som tilhører samme bruker.
  foreign key (employer_id, user_id) references public.employers (id, user_id) on delete cascade
);
create index if not exists shifts_user_date_idx on public.shifts (user_id, date);

-- ---------- Innstillinger ----------
create table if not exists public.settings (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------- updated_at ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists employers_touch on public.employers;
create trigger employers_touch before update on public.employers for each row execute function public.touch_updated_at();
drop trigger if exists shifts_touch on public.shifts;
create trigger shifts_touch before update on public.shifts for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- ---------- Row Level Security: hver bruker ser og endrer bare egne rader ----------
alter table public.employers enable row level security;
alter table public.shifts    enable row level security;
alter table public.settings  enable row level security;

drop policy if exists "egne arbeidsgivere" on public.employers;
create policy "egne arbeidsgivere" on public.employers for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "egne vakter" on public.shifts;
create policy "egne vakter" on public.shifts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "egne innstillinger" on public.settings;
create policy "egne innstillinger" on public.settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Tilgang gis eksplisitt, så skjemaet virker også når «Automatically expose new tables» er av.
-- Innloggede brukere får lese og skrive (RLS over begrenser det til egne rader); anonyme får ingenting.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.employers, public.shifts, public.settings to authenticated;
revoke all on public.employers, public.shifts, public.settings from anon;

-- ---------- Slett min konto (GDPR art. 17) ----------
-- Sletter innlogget bruker. Arbeidsgivere, vakter og innstillinger forsvinner via on delete cascade.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Ikke innlogget'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- Sanntid: varsle andre enheter om endringer ----------
-- RLS gjelder også her, så hver bruker får bare beskjed om egne rader.
do $$
declare t text;
begin
  foreach t in array array['employers', 'shifts', 'settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Holde gratisprosjektet aktivt ----------
-- Kalles av GitHub Actions (.github/workflows/keepalive.yml) hvert tredje døgn.
-- Gjør en ekte databasespørring, men leser ingen brukerdata.
create or replace function public.keepalive() returns timestamptz
language sql stable set search_path = '' as $$ select now() $$;
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- ---------- Gjentakende vakter ----------
-- Vakter i samme serie har samme series_id. Selve regelen ligger i settings.data.series.
alter table public.shifts add column if not exists series_id uuid;
create index if not exists shifts_series_idx on public.shifts (user_id, series_id) where series_id is not null;

-- ---------- Honorar og frivillig arbeid ----------
-- employers.pay: { type: 'hourly' | 'fee' | 'volunteer', feeDefault, holidayPay, inWarnings }
-- shifts.fee: avtalt beløp for akkurat denne vakta (honorar eller fast pris)
alter table public.employers add column if not exists pay jsonb;
alter table public.shifts add column if not exists fee numeric(10,2) check (fee is null or fee between 0 and 1000000);

-- ---------- Profil: navn og sist aktiv ----------
-- display_name: navnet brukeren vil kalles. last_seen: datoen appen sist ble åpnet (for å telle aktive brukere).
create table if not exists public.profiles (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 2 and 40),
  last_seen    date,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "egen profil" on public.profiles;
create policy "egen profil" on public.profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.profiles to authenticated;
revoke all on public.profiles from anon;

-- ---------- Status på vakter ----------
-- 'offered' = tilbudt, ikke tatt ennå. Tom = bekreftet.
alter table public.shifts add column if not exists status text check (status is null or status in ('offered', 'confirmed'));

-- ---------- Kalenderabonnement ----------
-- Hemmelig nøkkel per bruker. Kalenderapper henter vaktene fra functions/v1/calendar?t=<token>.
create table if not exists public.calendar_feeds (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token      text not null unique check (char_length(token) >= 32),
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
drop policy if exists "egen kalenderlenke" on public.calendar_feeds;
create policy "egen kalenderlenke" on public.calendar_feeds for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.calendar_feeds to authenticated;
revoke all on public.calendar_feeds from anon;

-- ---------- Tilbakemeldinger ----------
-- Skrives bare av serverfunksjonen (feedback). Les dem i Table Editor.
create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid references auth.users (id) on delete set null,
  email      text check (email is null or char_length(email) <= 200),
  kind       text not null check (kind in ('feil', 'forslag', 'annet')),
  message    text not null check (char_length(message) between 3 and 4000),
  meta       jsonb
);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- ---------- Feillogg fra appen ----------
-- Appen skriver hit når noe krasjer hos en bruker: feilmelding, hvor i koden, nettleser og versjon.
-- Aldri innholdet i vaktene. Alle kan skrive (også gjester), ingen kan lese via appen. Les i Table Editor.
create table if not exists public.client_errors (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid default auth.uid() references auth.users (id) on delete set null,
  message    text not null check (char_length(message) <= 500),
  source     text check (char_length(source) <= 300),
  line       integer,
  stack      text check (char_length(stack) <= 4000),
  version    text check (char_length(version) <= 40),
  browser    text check (char_length(browser) <= 300),
  page       text check (char_length(page) <= 200)
);
alter table public.client_errors enable row level security;
drop policy if exists "alle kan melde feil" on public.client_errors;
create policy "alle kan melde feil" on public.client_errors for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));
grant insert on public.client_errors to anon, authenticated;
