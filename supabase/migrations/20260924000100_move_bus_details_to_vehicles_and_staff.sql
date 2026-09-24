-- =============================================================================
-- Move vehicle and staff attributes out of bus_details.
--
-- bus_details held the vehicle, the driver and the conductor as plain columns on
-- the ROUTE row. That cannot record a tenure (changing the driver overwrote the
-- old name), cannot follow a vehicle that moves to another route, and has no
-- place for a spare bus. The data now lives in vehicles, staff and
-- staff_assignments; bus_details keeps only what genuinely describes the route.
--
-- The moved columns are copied into the archive schema before being dropped,
-- so nothing is lost. Reads from the table - no personal data is written here.
-- =============================================================================

create schema if not exists archive;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'bus_details' and column_name = 'driver_name') then

    create table if not exists archive.bus_details_moved_20260924 as
      select * from public.bus_details;

    -- vehicles: one per route, carrying the registration, make, year and the
    -- declared annual maintenance figure
    insert into public.vehicles (reg_no, bus_id, make, model_year, annual_maintenance_declared,
                                 provided_by, entered_by_email)
    select d.vehicle_no, d.bus_id, d.company, d.model_year, d.maintenance_cost,
           'Staff & vehicle sheet', 'system: initial load'
    from public.bus_details d
    where nullif(btrim(d.vehicle_no), '') is not null
    on conflict do nothing;

    -- staff and their current tenure. Start dates were never recorded, so each
    -- tenure opens with from_date null: "began before records were kept".
    declare r record; sid int;
    begin
      for r in select * from public.bus_details order by bus_id loop
        if nullif(btrim(r.driver_name), '') is not null then
          insert into public.staff (name, role, phone, monthly_salary, provided_by, entered_by_email)
          values (btrim(r.driver_name), 'driver', r.driver_phone, r.driver_salary,
                  'Staff & vehicle sheet', 'system: initial load')
          returning id into sid;
          insert into public.staff_assignments (staff_id, bus_id, role, provided_by, entered_by_email)
          values (sid, r.bus_id, 'driver', 'Staff & vehicle sheet', 'system: initial load');
        end if;
        -- a salary with no name is still a real cost, so it is kept
        if nullif(btrim(r.conductor_name), '') is not null or coalesce(r.conductor_salary, 0) > 0 then
          insert into public.staff (name, role, phone, monthly_salary, provided_by, notes, entered_by_email)
          values (coalesce(nullif(btrim(r.conductor_name), ''), '(name not recorded)'), 'conductor',
                  r.conductor_phone, r.conductor_salary, 'Staff & vehicle sheet',
                  case when nullif(btrim(r.conductor_name), '') is null
                       then 'Salary recorded on the sheet without a name.' end,
                  'system: initial load')
          returning id into sid;
          insert into public.staff_assignments (staff_id, bus_id, role, provided_by, entered_by_email)
          values (sid, r.bus_id, 'conductor', 'Staff & vehicle sheet', 'system: initial load');
        end if;
      end loop;
    end;

    alter table public.bus_details
      drop column if exists vehicle_no,       drop column if exists company,
      drop column if exists model_year,       drop column if exists model,
      drop column if exists maintenance_cost,
      drop column if exists driver_name,      drop column if exists driver_phone,
      drop column if exists driver_salary,
      drop column if exists conductor_name,   drop column if exists conductor_phone,
      drop column if exists conductor_salary;
  end if;
end $$;

comment on table public.bus_details is
  'Route-level description only. The vehicle is in vehicles, the people in staff and staff_assignments.';

-- The current driver, conductor and vehicle on each route, in one row - what the
-- Bus page and the tenure-aware screens read.
create or replace view public.route_crew with (security_invoker = on) as
select b.bus_id,
  d.route_name,
  v.id vehicle_id, v.reg_no, v.make, v.model_year, v.seats, v.annual_maintenance_declared,
  dr.id driver_id, dr.name driver_name, dr.phone driver_phone, dr.monthly_salary driver_salary,
  da.from_date driver_since,
  co.id conductor_id, co.name conductor_name, co.phone conductor_phone, co.monthly_salary conductor_salary,
  ca.from_date conductor_since
from public.buses b
left join public.bus_details d on d.bus_id = b.bus_id
left join public.vehicles v on v.bus_id = b.bus_id and v.active
left join public.staff_assignments da on da.bus_id = b.bus_id and da.role = 'driver' and da.to_date is null
left join public.staff dr on dr.id = da.staff_id
left join public.staff_assignments ca on ca.bus_id = b.bus_id and ca.role = 'conductor' and ca.to_date is null
left join public.staff co on co.id = ca.staff_id;
