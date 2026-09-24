-- =============================================================================
-- Fleet operations: vehicles, staff, and the logs kept against them.
--
-- WHY VEHICLE-CENTRIC. Kilometres, fuel, tyres, documents, service and repair
-- bills all belong to the physical vehicle, not to the route number it happens
-- to run. Vehicles move between routes (in Sept 2026 routes 10/27/40 held each
-- other's vehicles and 58/59 had swapped), and spare buses have no route at all.
-- Keying these logs by route would attribute one vehicle's mileage to another.
-- So every log records the VEHICLE, plus the ROUTE it covered that day - which
-- is also exactly how a spare bus standing in for a broken-down one is recorded.
--
-- SHARED CONVENTIONS on every log table:
--   recorded_on       the date the data refers to (defaults to today)
--   provided_by       who gave the data - driver, mechanic, accounts (free text)
--   entered_by_email  who typed it in - filled automatically from the login
--   entered_at        when it was typed in - automatic
--   active            soft delete. There is deliberately NO delete policy:
--                     a wrong entry is deactivated, never erased, so the
--                     history that later analysis depends on survives.
--
-- Personal data (names, salaries, phone numbers) is never written into this
-- repository. It is loaded into the database separately.
-- =============================================================================

-- ---------- helpers ----------------------------------------------------------

-- "rj23ab1234", "RJ23 AB 1234" and "RJ23-AB-1234" are the same vehicle.
create or replace function public.norm_reg(p text) returns text
language sql immutable as $$
  select case
    when m is null then nullif(upper(btrim(regexp_replace(coalesce(p,''),'\s+',' ','g'))),'')
    else m[1]||m[2]||' '||m[3]||' '||lpad(m[4],4,'0')
  end
  from (select regexp_match(upper(regexp_replace(coalesce(p,''),'[^A-Za-z0-9]','','g')),
                            '^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{1,4})$') m) x
$$;

create or replace function public.fleet_touch() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- vehicles ----------------------------------------------------------

create table if not exists public.vehicles (
  id               serial primary key,
  reg_no           text not null,
  bus_id           int unique references public.buses(bus_id),   -- current route; null for spares
  is_spare         boolean not null default false,
  make             text,
  model_year       int check (model_year is null or model_year between 1990 and 2100),
  seats            int check (seats is null or seats between 1 and 100),
  tyre_size        text,
  annual_maintenance_declared numeric check (annual_maintenance_declared is null or annual_maintenance_declared >= 0),
  notes            text,
  active           boolean not null default true,
  provided_by      text,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now(),
  updated_at       timestamptz,
  check (not (is_spare and bus_id is not null))   -- a spare has no route of its own
);
create unique index if not exists vehicles_reg_uidx on public.vehicles (norm_reg(reg_no));
comment on column public.vehicles.annual_maintenance_declared is
  'Yearly maintenance as declared by accounts. Itemised spend lives in maintenance_bills.';

create or replace function public.vehicles_norm() returns trigger
language plpgsql as $$
begin new.reg_no := norm_reg(new.reg_no); return new; end $$;
drop trigger if exists vehicles_norm on public.vehicles;
create trigger vehicles_norm before insert or update of reg_no on public.vehicles
  for each row execute function public.vehicles_norm();
drop trigger if exists vehicles_touch on public.vehicles;
create trigger vehicles_touch before update on public.vehicles
  for each row execute function public.fleet_touch();

-- Which vehicle ran which route, and when. Written automatically, so a rotation
-- between routes is never lost the way it was before this table existed.
create table if not exists public.vehicle_route_history (
  id          bigserial primary key,
  vehicle_id  int not null references public.vehicles(id),
  bus_id      int references public.buses(bus_id),
  from_date   date not null default current_date,
  to_date     date,
  changed_by_email text default (auth.jwt() ->> 'email'),
  changed_at  timestamptz not null default now()
);

create or replace function public.vehicles_route_log() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.bus_id is not distinct from old.bus_id then return new; end if;
  update public.vehicle_route_history set to_date = current_date
    where vehicle_id = new.id and to_date is null;
  if new.bus_id is not null then
    insert into public.vehicle_route_history(vehicle_id, bus_id) values (new.id, new.bus_id);
  end if;
  return new;
end $$;
drop trigger if exists vehicles_route_log on public.vehicles;
create trigger vehicles_route_log after insert or update of bus_id on public.vehicles
  for each row execute function public.vehicles_route_log();

-- ---------- staff and tenure -------------------------------------------------

create table if not exists public.staff (
  id               serial primary key,
  name             text not null,
  role             text not null check (role in ('driver','conductor')),
  phone            text,
  monthly_salary   numeric check (monthly_salary is null or monthly_salary >= 0),
  licence_no       text,
  joined_on        date,
  left_on          date,
  notes            text,
  active           boolean not null default true,
  provided_by      text,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now(),
  updated_at       timestamptz
);
drop trigger if exists staff_touch on public.staff;
create trigger staff_touch before update on public.staff
  for each row execute function public.fleet_touch();

-- A tenure is one person on one route between two dates. Changing a driver
-- closes one tenure and opens the next - it never overwrites the old name.
create table if not exists public.staff_assignments (
  id               serial primary key,
  staff_id         int not null references public.staff(id),
  bus_id           int not null references public.buses(bus_id),
  role             text not null check (role in ('driver','conductor')),
  from_date        date,            -- null = began before records were kept
  to_date          date,            -- null = current
  provided_by      text,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now(),
  check (to_date is null or from_date is null or to_date >= from_date)
);
create unique index if not exists staff_assign_route_role_uidx
  on public.staff_assignments (bus_id, role) where to_date is null;
create unique index if not exists staff_assign_person_uidx
  on public.staff_assignments (staff_id) where to_date is null;

-- ---------- tyres ------------------------------------------------------------

create table if not exists public.tyre_specs (
  vehicle_id       int primary key references public.vehicles(id),
  rec_fl numeric check (rec_fl between 10 and 200),
  rec_fr numeric check (rec_fr between 10 and 200),
  rec_bl numeric check (rec_bl between 10 and 200),
  rec_br numeric check (rec_br between 10 and 200),
  -- 'placard' = read off the vehicle; 'inferred' = estimated from tyre size and
  -- model, NOT authoritative. Only placard figures should drive re-inflation.
  source           text not null default 'inferred' check (source in ('placard','manual','inferred')),
  recorded_on      date not null default current_date,
  provided_by      text,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now(),
  updated_at       timestamptz
);
drop trigger if exists tyre_specs_touch on public.tyre_specs;
create trigger tyre_specs_touch before update on public.tyre_specs
  for each row execute function public.fleet_touch();

create table if not exists public.tyre_readings (
  id               bigserial primary key,
  vehicle_id       int not null references public.vehicles(id),
  bus_id           int references public.buses(bus_id),
  fl numeric check (fl between 0 and 250),
  fr numeric check (fr between 0 and 250),
  bl numeric check (bl between 0 and 250),
  br numeric check (br between 0 and 250),
  recorded_on      date not null default current_date,
  provided_by      text,
  notes            text,
  active           boolean not null default true,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now(),
  check (coalesce(fl, fr, bl, br) is not null)
);
create index if not exists tyre_readings_v_idx on public.tyre_readings (vehicle_id, recorded_on desc);

-- ---------- daily kilometres -------------------------------------------------

create table if not exists public.odometer_readings (
  id               bigserial primary key,
  vehicle_id       int not null references public.vehicles(id),
  bus_id           int references public.buses(bus_id),   -- route run; a spare shows the route it covered
  reading_km       numeric not null check (reading_km >= 0),
  recorded_on      date not null default current_date,
  reason           text,    -- why the bus ran more than its normal day
  provided_by      text,
  notes            text,
  active           boolean not null default true,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now()
);
create unique index if not exists odometer_one_per_day
  on public.odometer_readings (vehicle_id, recorded_on) where active;

-- ---------- fuel -------------------------------------------------------------

create table if not exists public.fuel_logs (
  id               bigserial primary key,
  vehicle_id       int not null references public.vehicles(id),
  bus_id           int references public.buses(bus_id),
  recorded_on      date not null default current_date,
  litres           numeric not null check (litres > 0 and litres < 1000),
  price_per_litre  numeric check (price_per_litre is null or (price_per_litre > 0 and price_per_litre < 500)),
  cost             numeric check (cost is null or cost >= 0),   -- the bill amount; wins over litres x price
  odo_at_fill      numeric check (odo_at_fill is null or odo_at_fill >= 0),
  station          text,
  reason           text,    -- why mileage moved away from this vehicle's normal
  provided_by      text,
  notes            text,
  active           boolean not null default true,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now()
);
create index if not exists fuel_logs_v_idx on public.fuel_logs (vehicle_id, recorded_on desc);

-- ---------- service ----------------------------------------------------------

create table if not exists public.service_plans (
  vehicle_id       int primary key references public.vehicles(id),
  interval_km      int check (interval_km is null or interval_km > 0),
  interval_days    int check (interval_days is null or interval_days > 0),
  provided_by      text,
  notes            text,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now(),
  updated_at       timestamptz,
  check (interval_km is not null or interval_days is not null)
);
drop trigger if exists service_plans_touch on public.service_plans;
create trigger service_plans_touch before update on public.service_plans
  for each row execute function public.fleet_touch();

create table if not exists public.service_events (
  id               bigserial primary key,
  vehicle_id       int not null references public.vehicles(id),
  recorded_on      date,               -- service date; may be unknown for old records
  odo_km           numeric check (odo_km is null or odo_km >= 0),
  work_done        text,
  workshop         text,
  cost             numeric check (cost is null or cost >= 0),
  provided_by      text,
  notes            text,
  active           boolean not null default true,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now(),
  check (recorded_on is not null or odo_km is not null)
);

-- ---------- documents --------------------------------------------------------

create table if not exists public.documents (
  id               bigserial primary key,
  vehicle_id       int references public.vehicles(id),
  staff_id         int references public.staff(id),
  doc_type         text not null,
  doc_number       text,
  issued_on        date,
  expires_on       date,
  file_path        text,       -- object path in the 'fleet-documents' storage bucket
  file_name        text,
  recorded_on      date not null default current_date,
  provided_by      text,
  notes            text,
  active           boolean not null default true,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now(),
  -- a licence belongs to the driver; permit, fitness, insurance, PUC to the vehicle
  check ((vehicle_id is null) <> (staff_id is null)),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

-- ---------- maintenance checkup ----------------------------------------------

create table if not exists public.checkup_parts (
  id          serial primary key,
  name        text not null unique,
  category    text,
  sort_order  int not null default 100,
  active      boolean not null default true
);

create table if not exists public.checkups (
  id               bigserial primary key,
  vehicle_id       int not null references public.vehicles(id),
  recorded_on      date not null default current_date,
  provided_by      text,
  notes            text,
  active           boolean not null default true,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now()
);

create table if not exists public.checkup_items (
  checkup_id  bigint not null references public.checkups(id),
  part_id     int not null references public.checkup_parts(id),
  -- ordered by severity: perfect < able_to_run < requires_action
  status      text not null check (status in ('perfect','able_to_run','requires_action')),
  note        text,
  primary key (checkup_id, part_id)
);

-- ---------- maintenance bills ------------------------------------------------

create table if not exists public.maintenance_bills (
  id               bigserial primary key,
  vehicle_id       int references public.vehicles(id),  -- null = fleet-wide bill
  vehicle_ref      text,          -- registration as written on the bill, when it is not a fleet vehicle
  recorded_on      date not null default current_date,  -- bill date
  bill_no          text,
  party_name       text,
  amount           numeric not null check (amount >= 0),
  category         text not null default 'other'
                   check (category in ('tyres','parts_oil','repair','body_paint','electrical','documents','other')),
  description      text,
  file_path        text,
  file_name        text,
  provided_by      text,
  notes            text,
  active           boolean not null default true,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now()
);

-- ---------- complaints -------------------------------------------------------

create table if not exists public.complaints (
  id               bigserial primary key,
  recorded_on      date not null default current_date,
  raised_by_name   text not null,
  raised_by_role   text not null default 'parent'
                   check (raised_by_role in ('parent','student','teacher','driver','conductor','staff','other')),
  raised_by_phone  text,
  against_type     text not null check (against_type in ('driver','conductor','student','other')),
  against_staff_id int references public.staff(id),
  against_student_sr text,
  against_name     text,          -- name as given; kept even when matched to a record
  bus_id           int references public.buses(bus_id),
  category         text,
  description      text not null,
  status           text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution       text,
  resolved_on      date,
  provided_by      text,
  active           boolean not null default true,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now(),
  updated_at       timestamptz,
  check (status = 'open' or resolved_on is not null)
);
drop trigger if exists complaints_touch on public.complaints;
create trigger complaints_touch before update on public.complaints
  for each row execute function public.fleet_touch();

-- =============================================================================
-- Derived views. security_invoker so row-level security applies through them.
-- =============================================================================

-- Latest tyre reading per vehicle against its recommended pressure.
create or replace view public.tyre_status with (security_invoker = on) as
with last as (
  select distinct on (vehicle_id) *
  from public.tyre_readings where active
  order by vehicle_id, recorded_on desc, id desc
), j as (
  select v.id vehicle_id, v.reg_no, v.bus_id, v.is_spare, v.tyre_size,
         l.id reading_id, l.recorded_on, l.provided_by, l.fl, l.fr, l.bl, l.br,
         s.rec_fl, s.rec_fr, s.rec_bl, s.rec_br, s.source spec_source,
         (current_date - l.recorded_on) days_since
  from public.vehicles v
  left join last l on l.vehicle_id = v.id
  left join public.tyre_specs s on s.vehicle_id = v.id
  where v.active
), d as (
  select j.*,
    round(100.0*(fl-rec_fl)/nullif(rec_fl,0),1) dev_fl,
    round(100.0*(fr-rec_fr)/nullif(rec_fr,0),1) dev_fr,
    round(100.0*(bl-rec_bl)/nullif(rec_bl,0),1) dev_bl,
    round(100.0*(br-rec_br)/nullif(rec_br,0),1) dev_br,
    abs(fl-fr) gap_front, abs(bl-br) gap_rear
  from j
)
select d.*,
  least(dev_fl, dev_fr, dev_bl, dev_br)    worst_under_pct,
  greatest(dev_fl, dev_fr, dev_bl, dev_br) worst_over_pct,
  -- two tyres on one axle must match whatever the specification says
  (coalesce(gap_front,0) >= greatest(10, 0.15*coalesce((rec_fl+rec_fr)/2, 100))
   or coalesce(gap_rear,0) >= greatest(10, 0.15*coalesce((rec_bl+rec_br)/2, 100))) imbalanced,
  case
    when reading_id is null then 'no_reading'
    when least(dev_fl,dev_fr,dev_bl,dev_br) <= -30 then 'unsafe'
    when greatest(dev_fl,dev_fr,dev_bl,dev_br) >= 25 then 'unsafe'
    when rec_fl is null and rec_bl is null then 'no_spec'
    when least(dev_fl,dev_fr,dev_bl,dev_br) <= -10 then 'low'
    when greatest(dev_fl,dev_fr,dev_bl,dev_br) >= 10 then 'high'
    else 'ok'
  end status,
  coalesce(days_since > 15, true) stale     -- checks are due every fortnight
from d;

-- Kilometres run each day, against that vehicle's own normal day.
create or replace view public.odometer_daily with (security_invoker = on) as
with r as (
  select o.*,
    lag(reading_km)  over w prev_km,
    lag(recorded_on) over w prev_on
  from public.odometer_readings o
  where active
  window w as (partition by vehicle_id order by recorded_on, id)
), k as (
  select r.*, reading_km - prev_km km_run, recorded_on - prev_on gap_days
  from r
), b as (
  -- the baseline uses only consecutive-day intervals, so a weekend or holiday
  -- gap never inflates what a normal day looks like
  select k.*,
    avg(km_run) filter (where gap_days = 1 and km_run >= 0)
      over (partition by vehicle_id order by recorded_on, id
            rows between 30 preceding and 1 preceding) avg_km,
    count(*) filter (where gap_days = 1 and km_run >= 0)
      over (partition by vehicle_id order by recorded_on, id
            rows between 30 preceding and 1 preceding) baseline_days
  from k
)
select b.*,
  round(avg_km,1) avg_daily_km,
  (km_run < 0) went_backwards,
  -- flag once there are five normal days to compare against
  (baseline_days >= 5 and km_run > avg_km * 1.15 and km_run - avg_km > 5) above_average,
  round(km_run - avg_km, 1) extra_km
from b;

-- Mileage for each fill, measured tank to tank, against the vehicle's own normal.
create or replace view public.fuel_efficiency with (security_invoker = on) as
with f as (
  select l.*,
    lag(odo_at_fill) over w prev_odo,
    coalesce(cost, litres * price_per_litre) cost_effective
  from public.fuel_logs l
  where active
  window w as (partition by vehicle_id order by recorded_on, id)
), m as (
  select f.*,
    odo_at_fill - prev_odo km_since_fill,
    case when odo_at_fill > prev_odo then round((odo_at_fill - prev_odo) / litres, 2) end kmpl
  from f
), b as (
  select m.*,
    avg(kmpl) over (partition by vehicle_id order by recorded_on, id
                    rows between 10 preceding and 1 preceding) avg_kmpl,
    count(kmpl) over (partition by vehicle_id order by recorded_on, id
                      rows between 10 preceding and 1 preceding) baseline_fills
  from m
)
select b.*,
  round(avg_kmpl, 2) avg_kmpl_r,
  round(100.0 * (kmpl - avg_kmpl) / nullif(avg_kmpl, 0), 1) deviation_pct,
  -- either direction deserves a reason: worse can mean a fault or a leak,
  -- far better usually means a fill was never logged
  (baseline_fills >= 3 and kmpl is not null
     and abs(kmpl - avg_kmpl) / nullif(avg_kmpl, 0) > 0.15) deviated,
  bu.mileage reference_kmpl
from b
left join public.vehicles v on v.id = b.vehicle_id
left join public.buses bu on bu.bus_id = coalesce(b.bus_id, v.bus_id);

-- When each vehicle is next due for service, by distance and by date.
create or replace view public.service_status with (security_invoker = on) as
with last_svc as (
  select distinct on (vehicle_id) vehicle_id, recorded_on last_on, odo_km last_odo
  from public.service_events where active
  order by vehicle_id, odo_km desc nulls last, recorded_on desc nulls last, id desc
), cur as (
  select distinct on (vehicle_id) vehicle_id, reading_km current_odo, recorded_on odo_on
  from public.odometer_readings where active
  order by vehicle_id, recorded_on desc, id desc
)
select v.id vehicle_id, v.reg_no, v.bus_id, v.is_spare,
  p.interval_km, p.interval_days, s.last_on, s.last_odo, c.current_odo, c.odo_on,
  s.last_odo + p.interval_km next_due_km,
  s.last_on + p.interval_days next_due_on,
  (s.last_odo + p.interval_km) - c.current_odo km_remaining,
  (s.last_on + p.interval_days) - current_date days_remaining,
  case
    when p.vehicle_id is null then 'no_plan'
    when s.vehicle_id is null then 'no_record'
    when (c.current_odo is not null and c.current_odo >= s.last_odo + p.interval_km)
      or (s.last_on + p.interval_days) < current_date then 'overdue'
    when (c.current_odo is not null and (s.last_odo + p.interval_km) - c.current_odo <= 1000)
      or (s.last_on + p.interval_days) - current_date <= 15 then 'due_soon'
    when c.current_odo is null and p.interval_days is null then 'no_odometer'
    else 'ok'
  end status
from public.vehicles v
left join public.service_plans p on p.vehicle_id = v.id
left join last_svc s on s.vehicle_id = v.id
left join cur c on c.vehicle_id = v.id
where v.active;

-- The current document of each type for each vehicle and each person.
-- Renewing adds a new row; the latest expiry is the one that counts.
create or replace view public.document_status with (security_invoker = on) as
select distinct on (coalesce('v'||d.vehicle_id, 's'||d.staff_id), lower(d.doc_type))
  d.*, v.reg_no, v.bus_id, st.name staff_name, st.role staff_role,
  (d.expires_on - current_date) days_left,
  case
    when d.expires_on is null then 'no_expiry'
    when d.expires_on < current_date then 'expired'
    when d.expires_on - current_date <= 20 then 'expiring'
    else 'ok'
  end status
from public.documents d
left join public.vehicles v on v.id = d.vehicle_id
left join public.staff st on st.id = d.staff_id
where d.active
order by coalesce('v'||d.vehicle_id, 's'||d.staff_id), lower(d.doc_type),
         d.expires_on desc nulls last, d.id desc;

-- The most recent checkup per vehicle and how many parts sit at each level.
create or replace view public.checkup_status with (security_invoker = on) as
with last as (
  select distinct on (vehicle_id) * from public.checkups where active
  order by vehicle_id, recorded_on desc, id desc
)
select l.id checkup_id, l.vehicle_id, v.reg_no, v.bus_id, l.recorded_on, l.provided_by,
  count(*) filter (where i.status = 'perfect')         n_perfect,
  count(*) filter (where i.status = 'able_to_run')     n_able,
  count(*) filter (where i.status = 'requires_action') n_action,
  string_agg(p.name, ', ' order by p.sort_order) filter (where i.status = 'requires_action') action_parts,
  (current_date - l.recorded_on) days_since
from last l
join public.vehicles v on v.id = l.vehicle_id
left join public.checkup_items i on i.checkup_id = l.id
left join public.checkup_parts p on p.id = i.part_id
group by l.id, l.vehicle_id, v.reg_no, v.bus_id, l.recorded_on, l.provided_by;

-- Everything that needs attention, in the same shape as the student `alerts`
-- view so the dashboard can show both the same way.
create or replace view public.fleet_alerts with (security_invoker = on) as
  select 'tyre_unsafe' kind, reg_no subject,
    'Tyre '||case when worst_under_pct <= -30 then round(-worst_under_pct)||'% under'
                  else round(worst_over_pct)||'% over' end||' pressure'||
      -- an estimated spec can raise a false alarm, so say which kind it is
      case when spec_source = 'inferred' then ' (against an estimated spec - confirm the placard)' else '' end detail,
    3 severity, vehicle_id, bus_id
  from public.tyre_status where status = 'unsafe'
union all
  select 'tyre_pressure', reg_no,
    case when status = 'low' then round(-worst_under_pct)||'% under recommended'
         else round(worst_over_pct)||'% over recommended' end||
      case when spec_source = 'inferred' then ' (estimated spec)' else '' end, 2, vehicle_id, bus_id
  from public.tyre_status where status in ('low','high')
union all
  select 'tyre_imbalance', reg_no, 'left and right tyres on one axle do not match', 2, vehicle_id, bus_id
  from public.tyre_status where imbalanced and status not in ('unsafe')
union all
  select 'tyre_check_due', reg_no,
    case when reading_id is null then 'no pressure reading recorded yet'
         else 'last checked '||days_since||' days ago' end, 1, vehicle_id, bus_id
  from public.tyre_status where stale
union all
  select 'km_unexplained', v.reg_no,
    o.km_run||' km on '||to_char(o.recorded_on,'DD Mon')||' against a normal '||o.avg_daily_km||' km - reason needed',
    1, o.vehicle_id, o.bus_id
  from public.odometer_daily o join public.vehicles v on v.id = o.vehicle_id
  where o.above_average and coalesce(btrim(o.reason),'') = '' and o.recorded_on >= current_date - 30
union all
  select 'km_backwards', v.reg_no, 'odometer reading on '||to_char(o.recorded_on,'DD Mon')||' is lower than the day before',
    2, o.vehicle_id, o.bus_id
  from public.odometer_daily o join public.vehicles v on v.id = o.vehicle_id
  where o.went_backwards and o.recorded_on >= current_date - 30
union all
  select 'fuel_deviation', v.reg_no,
    f.kmpl||' km/L on '||to_char(f.recorded_on,'DD Mon')||' against a normal '||f.avg_kmpl_r||' ('||
      case when f.deviation_pct > 0 then '+' else '' end||f.deviation_pct||'%) - reason needed',
    2, f.vehicle_id, f.bus_id
  from public.fuel_efficiency f join public.vehicles v on v.id = f.vehicle_id
  where f.deviated and coalesce(btrim(f.reason),'') = '' and f.recorded_on >= current_date - 60
union all
  select case when status = 'expired' then 'doc_expired' else 'doc_expiring' end,
    coalesce(reg_no, staff_name),
    doc_type||case when status = 'expired' then ' expired '||to_char(expires_on,'DD Mon YYYY')
                   else ' expires in '||days_left||' days ('||to_char(expires_on,'DD Mon')||')' end,
    case when status = 'expired' then 3 else 2 end, vehicle_id, bus_id
  from public.document_status where status in ('expired','expiring')
union all
  select case when status = 'overdue' then 'service_overdue' else 'service_due' end, reg_no,
    case when status = 'overdue' then 'service overdue'
         else 'service due - '||coalesce(km_remaining||' km',days_remaining||' days')||' left' end,
    case when status = 'overdue' then 3 else 1 end, vehicle_id, bus_id
  from public.service_status where status in ('overdue','due_soon')
union all
  select 'checkup_action', reg_no, n_action||' part'||case when n_action = 1 then '' else 's' end||
    ' require action: '||action_parts, 2, vehicle_id, bus_id
  from public.checkup_status where n_action > 0
union all
  select 'complaint_open', coalesce(against_name, against_type),
    'raised by '||raised_by_name||' on '||to_char(recorded_on,'DD Mon')||': '||left(description, 80),
    case when current_date - recorded_on > 7 then 2 else 1 end, null::int, bus_id
  from public.complaints where active and status = 'open'
union all
  select 'spare_in_use', v.reg_no, 'covering route '||o.bus_id||' today', 0, v.id, o.bus_id
  from public.odometer_readings o join public.vehicles v on v.id = o.vehicle_id
  where o.active and v.is_spare and o.recorded_on = current_date and o.bus_id is not null;

-- One row per vehicle for the fleet overview grid.
create or replace view public.vehicle_overview with (security_invoker = on) as
with od as (
  select distinct on (vehicle_id) vehicle_id, reading_km, recorded_on, avg_daily_km
  from public.odometer_daily order by vehicle_id, recorded_on desc, id desc
), fe as (
  select distinct on (vehicle_id) vehicle_id, avg_kmpl_r, kmpl
  from public.fuel_efficiency where kmpl is not null order by vehicle_id, recorded_on desc, id desc
), dc as (
  select vehicle_id, min(expires_on) next_expiry,
         count(*) filter (where status in ('expired','expiring')) docs_attention
  from public.document_status where vehicle_id is not null group by vehicle_id
), al as (
  select vehicle_id, max(severity) max_severity, count(*) n_alerts
  from public.fleet_alerts where vehicle_id is not null group by vehicle_id
)
select v.id vehicle_id, v.reg_no, v.bus_id, v.is_spare, v.make, v.model_year, v.seats,
  ts.status tyre_status, ts.recorded_on tyre_checked_on, ts.stale tyre_stale,
  od.reading_km last_odo, od.recorded_on odo_on, od.avg_daily_km,
  fe.kmpl last_kmpl, fe.avg_kmpl_r avg_kmpl, bu.mileage reference_kmpl,
  ss.status service_status, ss.km_remaining,
  dc.next_expiry, coalesce(dc.docs_attention, 0) docs_attention,
  cs.recorded_on checkup_on, coalesce(cs.n_action, 0) checkup_action,
  coalesce(al.n_alerts, 0) n_alerts, coalesce(al.max_severity, 0) max_severity
from public.vehicles v
left join public.tyre_status ts on ts.vehicle_id = v.id
left join od on od.vehicle_id = v.id
left join fe on fe.vehicle_id = v.id
left join public.buses bu on bu.bus_id = v.bus_id
left join public.service_status ss on ss.vehicle_id = v.id
left join dc on dc.vehicle_id = v.id
left join public.checkup_status cs on cs.vehicle_id = v.id
left join al on al.vehicle_id = v.id
where v.active;

-- =============================================================================
-- Tenure report: what happened on a person's route while they were on it.
-- =============================================================================
create or replace function public.staff_tenure_report(p_staff int)
returns jsonb language sql stable security invoker as $$
  select jsonb_build_object(
    'staff', (select to_jsonb(s) - 'entered_by_email' from public.staff s where s.id = p_staff),
    'tenures', coalesce((
      select jsonb_agg(t order by t->>'from_date' nulls first)
      from (
        select jsonb_build_object(
          'assignment_id', a.id, 'bus_id', a.bus_id, 'role', a.role,
          'from_date', a.from_date, 'to_date', a.to_date,
          'days', coalesce(a.to_date, current_date) - a.from_date,
          'complaints', (select count(*) from public.complaints c
             where c.active and c.against_staff_id = p_staff
               and (a.from_date is null or c.recorded_on >= a.from_date)
               and (a.to_date   is null or c.recorded_on <= a.to_date)),
          'complaints_open', (select count(*) from public.complaints c
             where c.active and c.status = 'open' and c.against_staff_id = p_staff
               and (a.from_date is null or c.recorded_on >= a.from_date)
               and (a.to_date   is null or c.recorded_on <= a.to_date)),
          'km_run', (select sum(greatest(o.km_run,0)) from public.odometer_daily o
             where o.bus_id = a.bus_id
               and (a.from_date is null or o.recorded_on >= a.from_date)
               and (a.to_date   is null or o.recorded_on <= a.to_date)),
          'days_logged', (select count(*) from public.odometer_readings o
             where o.active and o.bus_id = a.bus_id
               and (a.from_date is null or o.recorded_on >= a.from_date)
               and (a.to_date   is null or o.recorded_on <= a.to_date)),
          'unexplained_extra_days', (select count(*) from public.odometer_daily o
             where o.bus_id = a.bus_id and o.above_average and coalesce(btrim(o.reason),'') = ''
               and (a.from_date is null or o.recorded_on >= a.from_date)
               and (a.to_date   is null or o.recorded_on <= a.to_date)),
          'fuel_litres', (select sum(f.litres) from public.fuel_logs f
             where f.active and f.bus_id = a.bus_id
               and (a.from_date is null or f.recorded_on >= a.from_date)
               and (a.to_date   is null or f.recorded_on <= a.to_date)),
          'fuel_cost', (select sum(coalesce(f.cost, f.litres*f.price_per_litre)) from public.fuel_logs f
             where f.active and f.bus_id = a.bus_id
               and (a.from_date is null or f.recorded_on >= a.from_date)
               and (a.to_date   is null or f.recorded_on <= a.to_date)),
          'avg_kmpl', (select round(avg(f.kmpl),2) from public.fuel_efficiency f
             where f.bus_id = a.bus_id and f.kmpl is not null
               and (a.from_date is null or f.recorded_on >= a.from_date)
               and (a.to_date   is null or f.recorded_on <= a.to_date)),
          'fuel_deviations', (select count(*) from public.fuel_efficiency f
             where f.bus_id = a.bus_id and f.deviated
               and (a.from_date is null or f.recorded_on >= a.from_date)
               and (a.to_date   is null or f.recorded_on <= a.to_date)),
          'tyre_checks', (select count(*) from public.tyre_readings r
             where r.active and r.bus_id = a.bus_id
               and (a.from_date is null or r.recorded_on >= a.from_date)
               and (a.to_date   is null or r.recorded_on <= a.to_date))
        ) t
        from public.staff_assignments a where a.staff_id = p_staff
      ) x), '[]'::jsonb),
    'complaints', coalesce((
      select jsonb_agg(jsonb_build_object('recorded_on', c.recorded_on, 'raised_by', c.raised_by_name,
        'role', c.raised_by_role, 'category', c.category, 'description', c.description,
        'status', c.status, 'resolution', c.resolution) order by c.recorded_on desc)
      from public.complaints c where c.active and c.against_staff_id = p_staff), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('doc_type', d.doc_type, 'doc_number', d.doc_number,
        'expires_on', d.expires_on, 'status', d.status))
      from public.document_status d where d.staff_id = p_staff), '[]'::jsonb)
  )
$$;

-- =============================================================================
-- Access: signed-in staff read, add and correct. Nobody deletes.
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['vehicles','vehicle_route_history','staff','staff_assignments',
    'tyre_specs','tyre_readings','odometer_readings','fuel_logs','service_plans','service_events',
    'documents','checkup_parts','checkups','checkup_items','maintenance_bills','complaints'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('drop policy if exists %I on public.%I', t||'_add', t);
    execute format('drop policy if exists %I on public.%I', t||'_fix', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t||'_add', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t||'_fix', t);
  end loop;
end $$;

-- Document scans and bill photos. Private: reachable only through a signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fleet-documents', 'fleet-documents', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

drop policy if exists fleet_docs_read on storage.objects;
drop policy if exists fleet_docs_add  on storage.objects;
drop policy if exists fleet_docs_fix  on storage.objects;
create policy fleet_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'fleet-documents');
create policy fleet_docs_add on storage.objects for insert to authenticated
  with check (bucket_id = 'fleet-documents');
create policy fleet_docs_fix on storage.objects for update to authenticated
  using (bucket_id = 'fleet-documents');

-- A starter parts list so checkups can begin today. Replace it with the
-- school's own list on the Fleet -> Checkup -> Parts screen.
insert into public.checkup_parts (name, category, sort_order) values
  ('Brakes', 'Safety', 10), ('Tyres & wheels', 'Safety', 20), ('Steering', 'Safety', 30),
  ('Headlights & indicators', 'Safety', 40), ('Horn', 'Safety', 50), ('Wipers', 'Safety', 60),
  ('Mirrors', 'Safety', 70), ('Speed governor', 'Safety', 80), ('Fire extinguisher', 'Safety', 90),
  ('First-aid kit', 'Safety', 100), ('Emergency exit', 'Safety', 110), ('Doors & locks', 'Safety', 120),
  ('Engine oil', 'Engine', 200), ('Coolant', 'Engine', 210), ('Battery', 'Engine', 220),
  ('Clutch', 'Engine', 230), ('Air filter', 'Engine', 240), ('Suspension', 'Body', 300),
  ('Seats', 'Body', 310), ('Windows & glass', 'Body', 320), ('Body & paint', 'Body', 330),
  ('GPS tracker', 'Equipment', 400), ('CCTV', 'Equipment', 410)
on conflict (name) do nothing;
