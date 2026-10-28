-- Vaktbok – statistikk for deg som eier prosjektet. Kjør i Supabase SQL Editor.
-- Disse spørringene kan bare kjøres i dashbordet, ikke fra appen.

-- 1. Nøkkeltall
select
  (select count(*) from auth.users)                                                    as brukere_totalt,
  (select count(*) from public.profiles where last_seen >= current_date - 1)           as aktive_siste_dogn,
  (select count(*) from public.profiles where last_seen >= current_date - 7)           as aktive_siste_7_dager,
  (select count(*) from public.profiles where last_seen >= current_date - 30)          as aktive_siste_30_dager,
  (select count(*) from auth.users where created_at >= now() - interval '30 days')     as nye_siste_30_dager,
  (select count(*) from public.shifts)                                                 as vakter_totalt;

-- 2. Brukere med navn, når de registrerte seg og sist var aktive
-- (viser bare antall vakter, ikke innholdet – se ikke på brukeres data uten grunn)
select
  u.email,
  p.display_name                                        as navn,
  u.created_at::date                                    as registrert,
  p.last_seen                                           as sist_aktiv,
  (select count(*) from public.shifts s where s.user_id = u.id)     as vakter,
  (select count(*) from public.employers e where e.user_id = u.id)  as arbeidsgivere
from auth.users u
left join public.profiles p on p.user_id = u.id
order by p.last_seen desc nulls last;

-- 3. Aktive brukere per uke (siste 12 uker), basert på datoen de sist åpnet appen
select date_trunc('week', last_seen)::date as uke, count(*) as sist_aktive_denne_uka
from public.profiles
where last_seen >= current_date - 84
group by 1 order by 1;

-- 4. Feil hos brukerne siste 30 dager, de vanligste først
select message, source, line, count(*) as antall, count(distinct coalesce(user_id::text, browser)) as brukere, max(created_at) as sist
from public.client_errors
where created_at > now() - interval '30 days'
group by message, source, line
order by antall desc;

-- 5. Siste tilbakemeldinger
select created_at, kind, message, email from public.feedback order by created_at desc limit 50;

-- 6. Rydd: slett feillogg eldre enn seks måneder
-- delete from public.client_errors where created_at < now() - interval '6 months';
