-- =============================================================================
-- Old entries belong to the authorised editor.
--
-- Staff enter tyre, km and fuel readings for today only. An entry that was missed
-- on its day is filled in by the authorised editor, like any other change to the
-- past (20261031000000_fleet_record_edits.sql). This replaces that migration's
-- "typed in today" allowance: an old-dated entry can no longer be typed by staff,
-- so the only same-day correction left is of an entry dated today.
--
-- Adding a missing reason to an older entry stays open to everyone.
-- =============================================================================

create or replace function public.fleet_guard_new_entry() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- auth.uid() is null only for a direct database session, never through the API
  if auth.uid() is not null and (new.recorded_on = public.fleet_today() or public.fleet_can_edit_all()) is not true then
    raise exception 'Only today''s date can be entered here. The authorised editor fills in missing entries for earlier dates.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.fleet_guard_new_entry() from public, anon, authenticated;

create or replace trigger odometer_readings_new_guard before insert on public.odometer_readings
  for each row execute function public.fleet_guard_new_entry();
create or replace trigger fuel_logs_new_guard before insert on public.fuel_logs
  for each row execute function public.fleet_guard_new_entry();
create or replace trigger tyre_readings_new_guard before insert on public.tyre_readings
  for each row execute function public.fleet_guard_new_entry();

create or replace function public.fleet_guard_log_edit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb; n jsonb; changed jsonb; allowed boolean;
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

  -- Worked out as "allowed" and refused unless it is plainly true, so that a NULL
  -- anywhere in here denies rather than lets the edit through. The date is held
  -- fixed for staff: otherwise today's entry could be re-dated into the past.
  allowed := public.fleet_can_edit_all()
    or (old.recorded_on = today and new.recorded_on = old.recorded_on)
    or (changed - 'reason' = '{}'::jsonb and coalesce(btrim(o ->> 'reason'), '') = '');
  -- auth.uid() is null only for a direct database session, never through the API
  if auth.uid() is not null and allowed is not true then
    raise exception 'This entry can only be changed on its own day. After that, ask the authorised editor.'
      using errcode = '42501';
  end if;

  insert into public.fleet_edit_log (table_name, row_id, vehicle_id, recorded_on, changes, edited_by_email)
  values (tg_table_name, (o ->> 'id')::bigint, (o ->> 'vehicle_id')::int, old.recorded_on, changed, auth.jwt() ->> 'email');
  return new;
end $$;
revoke all on function public.fleet_guard_log_edit() from public, anon, authenticated;
