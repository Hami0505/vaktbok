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
