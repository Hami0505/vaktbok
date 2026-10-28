-- Vaktbok – statistikkside i appen. Kjør HELE fila i SQL Editor → New query → Run.
-- Trygg å kjøre flere ganger.

-- Hvem som er administrator (ser statistikksiden). Ingen kan lese tabellen via appen.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- All statistikk i ett kall. Gir avslag til alle som ikke er administrator.
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'Ikke tilgang' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'totals', jsonb_build_object(
      'users',     (select count(*) from auth.users),
      'active1',   (select count(*) from public.profiles where last_seen >= current_date - 1),
      'active7',   (select count(*) from public.profiles where last_seen >= current_date - 7),
      'active30',  (select count(*) from public.profiles where last_seen >= current_date - 30),
      'new30',     (select count(*) from auth.users where created_at >= now() - interval '30 days'),
      'shifts',    (select count(*) from public.shifts),
      'employers', (select count(*) from public.employers)
    ),
    'users', coalesce((
      select jsonb_agg(t.j order by t.seen desc nulls last, t.reg desc)
      from (
        select jsonb_build_object(
                 'email', u.email, 'name', p.display_name, 'registered', u.created_at::date, 'last_seen', p.last_seen,
                 'shifts', (select count(*) from public.shifts s where s.user_id = u.id),
                 'employers', (select count(*) from public.employers e where e.user_id = u.id)) as j,
               p.last_seen as seen, u.created_at as reg
        from auth.users u left join public.profiles p on p.user_id = u.id
      ) t), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('week', w, 'n', n) order by w)
      from (select date_trunc('week', last_seen)::date as w, count(*) as n
            from public.profiles where last_seen >= current_date - 84 group by 1) t), '[]'::jsonb),
    'errors', coalesce((
      select jsonb_agg(to_jsonb(e))
      from (select message, source, line, count(*) as n, count(distinct coalesce(user_id::text, browser)) as users, max(created_at) as last
            from public.client_errors where created_at > now() - interval '30 days'
            group by message, source, line order by n desc limit 30) e), '[]'::jsonb),
    'feedback', coalesce((
      select jsonb_agg(to_jsonb(f))
      from (select created_at, kind, message, email from public.feedback order by created_at desc limit 30) f), '[]'::jsonb)
  );
end $$;
revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

-- Gjør kontoen din til administrator.
insert into public.admins (user_id)
select id from auth.users where email = 'haaz2305@gmail.com'
on conflict do nothing;
