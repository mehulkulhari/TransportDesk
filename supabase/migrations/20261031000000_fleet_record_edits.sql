-- =============================================================================
-- Correcting tyre, km and fuel entries, and who may do it.
--
--   Anyone signed in   can correct an entry on the day it was typed in. That
--                      covers today's reading, and a late entry typed today for
--                      an earlier date.
--   Authorised editor  can correct or remove any entry, of any date.
--   Anyone signed in   can still add a missing reason to an older entry, because
--                      an unexplained day stays on the dashboard until it has one.
--
-- The rule is a trigger rather than a hidden button: the screens call the API
-- with a key that is public by design, so only the database can enforce it.
-- Every change is written to fleet_edit_log with old and new values, because
-- these readings feed cost figures. A changed odometer reading also changes the
-- next day's kilometres, which odometer_daily works out from the pair.
--
-- The editor is held by login id in fleet_record_editors. This repository is
-- public, so the person is added by hand and never named here. See
-- docs/OPERATIONS.md, "Correcting entries", for how to add or change them.
-- =============================================================================

create table if not exists public.fleet_record_editors (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now()
);
-- No policies on purpose: nobody can read or change this list through the API.
alter table public.fleet_record_editors enable row level security;
revoke all on public.fleet_record_editors from anon, authenticated;

create table if not exists public.fleet_edit_log (
  id               bigserial primary key,
  table_name       text not null,
  row_id           bigint not null,
  vehicle_id       int,
  recorded_on      date,
  changes          jsonb not null,      -- {"reading_km": {"from": 100, "to": 120}}
  edited_by_email  text,                -- null when changed from the database directly
  edited_at        timestamptz not null default now()
);
create index if not exists fleet_edit_log_row_idx on public.fleet_edit_log (table_name, row_id, edited_at desc);
alter table public.fleet_edit_log enable row level security;
-- Read-only through the API; only the trigger below writes to it.
revoke all on public.fleet_edit_log from anon, authenticated;
grant select on public.fleet_edit_log to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'fleet_edit_log' and policyname = 'fleet_edit_log_read') then
    create policy fleet_edit_log_read on public.fleet_edit_log for select to authenticated using (true);
  end if;
end $$;

-- Is the signed-in person the authorised editor? Runs with the owner's rights
-- because the list itself is closed to the API.
create or replace function public.fleet_can_edit_all() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.fleet_record_editors e where e.user_id = auth.uid())
$$;
revoke all on function public.fleet_can_edit_all() from public, anon;
grant execute on function public.fleet_can_edit_all() to authenticated;

create or replace function public.fleet_guard_log_edit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb; n jsonb; changed jsonb;
  today date := public.fleet_today();
begin
  -- who typed it and when is the record itself, not something an edit can change
  new.entered_at := old.entered_at;
  new.entered_by_email := old.entered_by_email;

  o := to_jsonb(old); n := to_jsonb(new);
  select jsonb_object_agg(nv.key, jsonb_build_object('from', ov.value, 'to', nv.value)) into changed
  from jsonb_each(n) nv join jsonb_each(o) ov on ov.key = nv.key
  where nv.value is distinct from ov.value;
  if changed is null then return new; end if;

  -- auth.uid() is null only for a direct database session, never through the API
  if auth.uid() is not null
     and old.recorded_on <> today
     and (old.entered_at at time zone 'Asia/Kolkata')::date <> today
     and not public.fleet_can_edit_all()
     and not (changed - 'reason' = '{}'::jsonb and coalesce(btrim(o ->> 'reason'), '') = '') then
    raise exception 'This entry can only be changed on the day it was entered. After that, ask the authorised editor.'
      using errcode = '42501';
  end if;

  insert into public.fleet_edit_log (table_name, row_id, vehicle_id, recorded_on, changes, edited_by_email)
  values (tg_table_name, (o ->> 'id')::bigint, (o ->> 'vehicle_id')::int, old.recorded_on, changed, auth.jwt() ->> 'email');
  return new;
end $$;
revoke all on function public.fleet_guard_log_edit() from public, anon, authenticated;

create or replace trigger odometer_readings_guard before update on public.odometer_readings
  for each row execute function public.fleet_guard_log_edit();
create or replace trigger fuel_logs_guard before update on public.fuel_logs
  for each row execute function public.fleet_guard_log_edit();
create or replace trigger tyre_readings_guard before update on public.tyre_readings
  for each row execute function public.fleet_guard_log_edit();
