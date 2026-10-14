-- =============================================================================
-- Bus-wise student list: one row per child per round, with everything an office
-- usually needs on a printed or exported list - the bus and its crew, the child,
-- the parents and phone numbers, the pickup point and any temporary arrangement.
--
-- Both rounds in one view so a single export covers the whole morning. Round 1
-- reads student_effective, which already applies temporary bus/address changes;
-- the permanent bus is kept alongside so a list never hides that a child is
-- only on this bus for now.
--
-- pickup_order is the app's PLANNED sequence (see docs/DOMAIN_RULES.md), not
-- the order the bus is known to drive - the column is named to say so.
-- =============================================================================

create or replace view public.bus_student_list with (security_invoker = on) as
with r1 as (
  select 1 as round, e.bus_id, e.permanent_bus, e.pickup_order,
    e.sr_no, e.student_name, e.class, e.section,
    e.latitude, e.longitude, e.phone, e.parent_name,
    e.using_temp_bus, e.using_temp_address, e.temp_until, e.temp_reason,
    e.uses_transport, s.address_note, s.road_km_to_school, s.road_min_to_school
  from public.student_effective e
  join public.students s on s.id = e.id
), r2 as (
  select 2, s.bus_no, s.bus_no, s.pickup_order,
    s.sr_no, s.name, s.class, s.section,
    s.latitude, s.longitude, null::text, null::text,
    false, false, null::date, null::text,
    true, null::text, null::numeric, null::numeric
  from public.students_round2 s
  where s.active
), u as (select * from r1 union all select * from r2)
select
  u.round,
  case when u.uses_transport then u.bus_id end                         bus_no,
  case when u.uses_transport then 'transport' else 'comes by self' end transport_status,
  rc.route_name, rc.reg_no vehicle_no,
  rc.driver_name, rc.driver_phone, rc.conductor_name, rc.conductor_phone,
  u.pickup_order planned_pickup_order,
  u.sr_no, u.student_name, u.class, u.section, p.gender, p.dob,
  coalesce(p.father_name, u.parent_name) father_name, p.mother_name,
  coalesce(p.father_phone, u.phone) father_phone, p.mother_phone,
  p.home_address, u.address_note pickup_note,
  u.latitude pickup_latitude, u.longitude pickup_longitude,
  case when u.latitude is not null
       then 'https://www.google.com/maps?q=' || u.latitude || ',' || u.longitude end pickup_map_link,
  u.using_temp_bus on_temporary_bus,
  case when u.using_temp_bus then u.permanent_bus end permanent_bus_no,
  u.using_temp_address on_temporary_address,
  u.temp_until temporary_until, u.temp_reason temporary_reason,
  u.road_km_to_school, u.road_min_to_school,
  f.annual_charge transport_fee, f.academic_year fee_year,
  p.admission_date
from u
left join public.route_crew rc on rc.bus_id = u.bus_id and u.uses_transport
left join public.student_profiles p on p.sr_no = u.sr_no
left join public.student_fees f on f.sr_no = u.sr_no;

comment on view public.bus_student_list is
  'Bus-wise student list for both rounds, read by Reports -> Bus-wise list and its CSV export.';
