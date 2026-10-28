-- Vaktbok – oppdatering 28. oktober 2026
-- Kjør HELE denne fila i Supabase → SQL Editor → New query → lim inn → Run.
-- Den kan trygt kjøres flere ganger: alt som allerede finnes, hoppes over.

-- ---------- Gjentakende vakter, honorar og frivillig ----------
alter table public.shifts add column if not exists series_id uuid;
create index if not exists shifts_series_idx on public.shifts (user_id, series_id) where series_id is not null;
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

-- ---------- Tilgang for serverfunksjonene ----------
-- Nyere Supabase-prosjekter gir ikke service_role tilgang til nye tabeller automatisk.
grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.feedback, public.client_errors, public.calendar_feeds,
  public.shifts, public.employers, public.profiles
  to service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
