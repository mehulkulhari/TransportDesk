-- =============================================================================
-- Data-entry compliance and deviations, week by week.
--
-- Two kinds of problem, kept apart because they need different people to act:
--   ENTRY MISSING   - a reading that should exist does not (tyre check, daily km,
--                     fuel fill). Fixed by whoever enters the data.
--   DEVIATION       - a reading exists but is far from normal. Fixed by the
--                     mechanic or the driver, or explained with a reason.
--
-- "Should exist" needs a calendar:
--   * Working days are Monday to Saturday, minus anything in fleet_off_days
--     (holidays, vacations). Without that table every bus would alarm all
--     through Diwali.
--   * A morning's km reading is due by 11:00 India time. Before then today is
--     not yet counted as missing.
--   * Only vehicles that carry children are expected to log daily km and fuel -
--     a route with no active students (a parked bus) is not. Spares are expected
--     to have their tyres checked too, so they are ready when called on.
--
-- Every threshold is a function below, used by both the live fleet_alerts view
-- and the weekly report, so the dashboard and its history cannot disagree.
-- =============================================================================

-- ---------- calendar ----------------------------------------------------------
create table if not exists public.fleet_off_days (
  day              date primary key,
  reason           text not null,
  provided_by      text,
  entered_by_email text default (auth.jwt() ->> 'email'),
  entered_at       timestamptz not null default now()
);
-- a day entered by mistake is switched off, not erased (Fleet -> Daily km)
alter table public.fleet_off_days add column if not exists active boolean not null default true;
alter table public.fleet_off_days enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'fleet_off_days' and policyname = 'fleet_off_days_read') then
    create policy fleet_off_days_read on public.fleet_off_days for select to authenticated using (true);
    create policy fleet_off_days_add  on public.fleet_off_days for insert to authenticated with check (true);
    create policy fleet_off_days_fix  on public.fleet_off_days for update to authenticated using (true) with check (true);
    -- the app never deletes (it sets active = false); this only allows a database-side correction
    create policy fleet_off_days_del  on public.fleet_off_days for delete to authenticated using (true);
  end if;
end $$;
grant select, insert, update, delete on public.fleet_off_days to authenticated;

create or replace function public.fleet_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function public.fleet_is_working_day(d date) returns boolean
language sql stable as $$
  select extract(isodow from d) < 7 and not exists (select 1 from public.fleet_off_days o where o.day = d and o.active)
$$;

-- The Fleet tab went live on the evening of 24 Sep 2026. Nothing before the
-- next day can be "missing" - there was nowhere to enter it.
create or replace function public.fleet_tracking_start() returns date
language sql immutable as $$ select date '2026-09-25' $$;

-- Working days on which daily entries are due.
create or replace function public.fleet_working_days(p_from date, p_to date) returns setof date
language sql stable as $$
  select d::date from generate_series(greatest(p_from, public.fleet_tracking_start())::timestamp, p_to::timestamp, interval '1 day') d
  where public.fleet_is_working_day(d::date)
$$;

-- The latest working day whose morning reading is already due.
create or replace function public.fleet_last_due_day() returns date
language sql stable as $$
  select max(d) from public.fleet_working_days(public.fleet_today() - 21, public.fleet_today()) d
  where d < public.fleet_today() or (now() at time zone 'Asia/Kolkata')::time >= time '11:00'
$$;

-- Vehicles expected to log daily km and fuel: on a route that has children.
create or replace view public.fleet_vehicles_in_service with (security_invoker = on) as
select v.id vehicle_id, v.reg_no, v.bus_id
from public.vehicles v
where v.active and v.bus_id is not null
  and (exists (select 1 from public.students s where s.active and s.uses_transport and s.bus_no = v.bus_id)
    or exists (select 1 from public.students_round2 r where r.active and r.bus_no = v.bus_id));

-- ---------- tyre thresholds, in one place --------------------------------------
create or replace function public.tyre_dev(v numeric, rec numeric) returns numeric
language sql immutable as $$ select round(100.0 * (v - rec) / nullif(rec, 0), 1) $$;

create or replace function public.tyre_class(lo numeric, hi numeric, has_spec boolean, has_reading boolean)
returns text language sql immutable as $$
  select case
    when not has_reading then 'no_reading'
    when lo <= -30 or hi >= 25 then 'unsafe'
    when not has_spec then 'no_spec'
    when lo <= -10 then 'low'
    when hi >= 10 then 'high'
    else 'ok' end
$$;

-- Two tyres on one axle must match whatever the specification says.
create or replace function public.tyre_imbalanced(fl numeric, fr numeric, bl numeric, br numeric,
  rfl numeric, rfr numeric, rbl numeric, rbr numeric) returns boolean
language sql immutable as $$
  select coalesce(abs(fl - fr), 0) >= greatest(10, 0.15 * coalesce((rfl + rfr) / 2, 100))
      or coalesce(abs(bl - br), 0) >= greatest(10, 0.15 * coalesce((rbl + rbr) / 2, 100))
$$;

-- Every tyre reading, judged against the vehicle's recommended pressure.
create or replace view public.tyre_reading_eval with (security_invoker = on) as
select r.id, r.vehicle_id, v.reg_no, coalesce(r.bus_id, v.bus_id) bus_id, r.recorded_on, r.provided_by,
  r.fl, r.fr, r.bl, r.br, s.rec_fl, s.rec_fr, s.rec_bl, s.rec_br, s.source spec_source,
  x.dev_fl, x.dev_fr, x.dev_bl, x.dev_br,
  (select round(avg(d), 1) from unnest(array[x.dev_fl, x.dev_fr, x.dev_bl, x.dev_br]) d) avg_dev_pct,
  (select round(avg(abs(d)), 1) from unnest(array[x.dev_fl, x.dev_fr, x.dev_bl, x.dev_br]) d) avg_abs_dev_pct,
  least(x.dev_fl, x.dev_fr, x.dev_bl, x.dev_br) worst_under_pct,
  greatest(x.dev_fl, x.dev_fr, x.dev_bl, x.dev_br) worst_over_pct,
  public.tyre_imbalanced(r.fl, r.fr, r.bl, r.br, s.rec_fl, s.rec_fr, s.rec_bl, s.rec_br) imbalanced,
  public.tyre_class(least(x.dev_fl, x.dev_fr, x.dev_bl, x.dev_br), greatest(x.dev_fl, x.dev_fr, x.dev_bl, x.dev_br),
                    s.rec_fl is not null or s.rec_bl is not null, true) status
from public.tyre_readings r
join public.vehicles v on v.id = r.vehicle_id
left join public.tyre_specs s on s.vehicle_id = r.vehicle_id
cross join lateral (select public.tyre_dev(r.fl, s.rec_fl) dev_fl, public.tyre_dev(r.fr, s.rec_fr) dev_fr,
                           public.tyre_dev(r.bl, s.rec_bl) dev_bl, public.tyre_dev(r.br, s.rec_br) dev_br) x
where r.active;

-- tyre_status: same columns as before, now built from the shared functions,
-- plus in_scope (whether this vehicle is expected to be checked at all).
create or replace view public.tyre_status with (security_invoker = on) as
with last as (
  select distinct on (vehicle_id) *
  from public.tyre_readings where active
  order by vehicle_id, recorded_on desc, id desc
), j as (
  select v.id vehicle_id, v.reg_no, v.bus_id, v.is_spare, v.tyre_size,
         l.id reading_id, l.recorded_on, l.provided_by, l.fl, l.fr, l.bl, l.br,
         s.rec_fl, s.rec_fr, s.rec_bl, s.rec_br, s.source spec_source,
         (public.fleet_today() - l.recorded_on) days_since
  from public.vehicles v
  left join last l on l.vehicle_id = v.id
  left join public.tyre_specs s on s.vehicle_id = v.id
  where v.active
), d as (
  select j.*,
    public.tyre_dev(fl, rec_fl) dev_fl, public.tyre_dev(fr, rec_fr) dev_fr,
    public.tyre_dev(bl, rec_bl) dev_bl, public.tyre_dev(br, rec_br) dev_br,
    abs(fl - fr) gap_front, abs(bl - br) gap_rear
  from j
)
select d.*,
  least(dev_fl, dev_fr, dev_bl, dev_br)    worst_under_pct,
  greatest(dev_fl, dev_fr, dev_bl, dev_br) worst_over_pct,
  public.tyre_imbalanced(fl, fr, bl, br, rec_fl, rec_fr, rec_bl, rec_br) imbalanced,
  public.tyre_class(least(dev_fl, dev_fr, dev_bl, dev_br), greatest(dev_fl, dev_fr, dev_bl, dev_br),
                    rec_fl is not null or rec_bl is not null, reading_id is not null) status,
  coalesce(days_since > 15, true) stale,
  (is_spare or exists (select 1 from public.fleet_vehicles_in_service s where s.vehicle_id = d.vehicle_id)) in_scope
from d;

-- ---------- km: a day far below normal is as suspect as one far above -----------
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
  -- after five normal days: more than 15% and 5 km above normal
  (baseline_days >= 5 and km_run > avg_km * 1.15 and km_run - avg_km > 5) above_average,
  round(km_run - avg_km, 1) extra_km,
  -- a single-day gap only: a reading after a holiday covers more than one day
  (baseline_days >= 5 and gap_days = 1 and km_run >= 0 and km_run < avg_km * 0.6 and avg_km - km_run > 5) below_average
from b;

-- ---------- fuel: how long is too long without a fill, per vehicle ---------------
-- Twice this vehicle's usual gap between fills (kept between 7 and 21 days);
-- 10 days until it has three gaps on record.
create or replace view public.fuel_fill_rule with (security_invoker = on) as
with f as (
  select vehicle_id, recorded_on,
    recorded_on - lag(recorded_on) over (partition by vehicle_id order by recorded_on, id) gap
  from public.fuel_logs where active
), g as (
  select vehicle_id, max(recorded_on) last_fill,
    percentile_cont(0.5) within group (order by gap) filter (where gap > 0) med,
    count(gap) filter (where gap > 0) n
  from f group by vehicle_id
)
select s.vehicle_id, s.reg_no, s.bus_id, g.last_fill, round(g.med::numeric, 1) typical_gap_days,
  case when coalesce(g.n, 0) >= 3 then least(21, greatest(7, ceil(2 * g.med)))::int else 10 end max_gap_days
from public.fleet_vehicles_in_service s
left join g on g.vehicle_id = s.vehicle_id;

grant select on public.fleet_vehicles_in_service, public.tyre_reading_eval, public.fuel_fill_rule to authenticated;

-- =============================================================================
-- Live alerts, now with a category: entry_missing, deviation or other.
-- =============================================================================
create or replace view public.fleet_alerts with (security_invoker = on) as
  -- ---------------- deviations
  select 'tyre_unsafe' kind, reg_no subject,
    'Tyre '||case when worst_under_pct <= -30 then round(-worst_under_pct)||'% under'
                  else round(worst_over_pct)||'% over' end||' pressure'||
      case when spec_source = 'inferred' then ' (against an estimated spec - confirm the placard)' else '' end detail,
    3 severity, vehicle_id, bus_id, 'deviation' category
  from public.tyre_status where status = 'unsafe' and in_scope
union all
  select 'tyre_pressure', reg_no,
    case when status = 'low' then round(-worst_under_pct)||'% under recommended'
         else round(worst_over_pct)||'% over recommended' end||
      case when spec_source = 'inferred' then ' (estimated spec)' else '' end, 2, vehicle_id, bus_id, 'deviation'
  from public.tyre_status where status in ('low','high') and in_scope
union all
  select 'tyre_imbalance', reg_no, 'left and right tyres on one axle do not match', 2, vehicle_id, bus_id, 'deviation'
  from public.tyre_status where imbalanced and status <> 'unsafe' and in_scope
union all
  select 'km_unexplained', v.reg_no,
    o.km_run||' km on '||to_char(o.recorded_on,'DD Mon')||' against a normal '||o.avg_daily_km||' km - '||
      case when o.above_average then 'more' else 'less' end||' than usual, reason needed',
    1, o.vehicle_id, o.bus_id, 'deviation'
  from public.odometer_daily o join public.vehicles v on v.id = o.vehicle_id
  where (o.above_average or o.below_average) and coalesce(btrim(o.reason),'') = '' and o.recorded_on >= public.fleet_today() - 30
union all
  select 'km_backwards', v.reg_no, 'odometer reading on '||to_char(o.recorded_on,'DD Mon')||' is lower than the day before',
    2, o.vehicle_id, o.bus_id, 'deviation'
  from public.odometer_daily o join public.vehicles v on v.id = o.vehicle_id
  where o.went_backwards and o.recorded_on >= public.fleet_today() - 30
union all
  select 'fuel_deviation', v.reg_no,
    f.kmpl||' km/L on '||to_char(f.recorded_on,'DD Mon')||' against a normal '||f.avg_kmpl_r||' ('||
      case when f.deviation_pct > 0 then '+' else '' end||f.deviation_pct||'%) - reason needed',
    2, f.vehicle_id, f.bus_id, 'deviation'
  from public.fuel_efficiency f join public.vehicles v on v.id = f.vehicle_id
  where f.deviated and coalesce(btrim(f.reason),'') = '' and f.recorded_on >= public.fleet_today() - 60
  -- ---------------- entry missing
union all
  select 'tyre_check_due', reg_no,
    case when reading_id is null then 'no tyre pressure recorded yet'
         else 'tyres last checked '||days_since||' days ago (due every 15)' end,
    case when reading_id is not null and days_since > 30 then 2 else 1 end, vehicle_id, bus_id, 'entry_missing'
  from public.tyre_status where stale and in_scope
union all
  select 'km_missing', s.reg_no,
    'no odometer reading for '||to_char(x.due,'Dy DD Mon')||
      case when m.missed > 1 then ' · '||m.missed||' of the last '||m.days||' working days missing' else '' end,
    case when m.missed >= 3 then 2 else 1 end, s.vehicle_id, s.bus_id, 'entry_missing'
  from public.fleet_vehicles_in_service s
  cross join (select public.fleet_last_due_day() due) x
  cross join lateral (
    select count(*) days,
           count(*) filter (where not exists (select 1 from public.odometer_readings o
                            where o.active and o.vehicle_id = s.vehicle_id and o.recorded_on = w.d)) missed
    from (select d from public.fleet_working_days(x.due - 13, x.due) d order by d desc limit 6) w) m
  where x.due is not null
    and not exists (select 1 from public.odometer_readings o
                    where o.active and o.vehicle_id = s.vehicle_id and o.recorded_on = x.due)
union all
  select 'fuel_missing', reg_no,
    case when last_fill is null then 'no fuel fill logged yet'
         else 'no fuel fill logged for '||(public.fleet_today() - last_fill)||' days'||
              coalesce(' (usually every '||typical_gap_days||')','') end,
    case when last_fill is null then 1 else 2 end, vehicle_id, bus_id, 'entry_missing'
  from public.fuel_fill_rule
  where last_fill is null or public.fleet_today() - last_fill > max_gap_days
  -- ---------------- everything else
union all
  select case when status = 'expired' then 'doc_expired' else 'doc_expiring' end,
    coalesce(reg_no, staff_name),
    doc_type||case when status = 'expired' then ' expired '||to_char(expires_on,'DD Mon YYYY')
                   else ' expires in '||days_left||' days ('||to_char(expires_on,'DD Mon')||')' end,
    case when status = 'expired' then 3 else 2 end, vehicle_id, bus_id, 'other'
  from public.document_status where status in ('expired','expiring')
union all
  select case when status = 'overdue' then 'service_overdue' else 'service_due' end, reg_no,
    case when status = 'overdue' then 'service overdue'
         else 'service due - '||coalesce(km_remaining||' km',days_remaining||' days')||' left' end,
    case when status = 'overdue' then 3 else 1 end, vehicle_id, bus_id, 'other'
  from public.service_status where status in ('overdue','due_soon')
union all
  select 'checkup_action', reg_no, n_action||' part'||case when n_action = 1 then '' else 's' end||
    ' require action: '||action_parts, 2, vehicle_id, bus_id, 'other'
  from public.checkup_status where n_action > 0
union all
  select 'complaint_open', coalesce(against_name, against_type),
    'raised by '||raised_by_name||' on '||to_char(recorded_on,'DD Mon')||': '||left(description, 80),
    case when public.fleet_today() - recorded_on > 7 then 2 else 1 end, null::int, bus_id, 'other'
  from public.complaints where active and status = 'open'
union all
  select 'spare_in_use', v.reg_no, 'covering route '||o.bus_id||' today', 0, v.id, o.bus_id, 'other'
  from public.odometer_readings o join public.vehicles v on v.id = o.vehicle_id
  where o.active and v.is_spare and o.recorded_on = public.fleet_today() and o.bus_id is not null;

-- =============================================================================
-- One week, summarised. p_week can be any date in the week; weeks run Monday-Sunday.
-- Days not yet due (later this week, or this morning before 11:00) are not counted.
-- =============================================================================
create or replace function public.fleet_week_kpis(p_week date) returns jsonb
language plpgsql stable security invoker as $$
declare
  ws date := date_trunc('week', p_week)::date;
  we date := ws + 6;
  due date := least(ws + 6, coalesce(public.fleet_last_due_day(), ws - 1));
  asof date := least(ws + 6, public.fleet_today());
  tracked boolean := asof >= public.fleet_tracking_start();
  out jsonb;
begin
  with svc as (select * from public.fleet_vehicles_in_service),
  days as (select d from public.fleet_working_days(ws, due) d),
  km_exp as (select s.vehicle_id, d.d from svc s cross join days d),
  km_got as (select distinct vehicle_id, recorded_on from public.odometer_readings
             where active and recorded_on between ws and we),
  tyre_last as (select distinct on (vehicle_id) * from public.tyre_reading_eval
                where recorded_on between ws and we order by vehicle_id, recorded_on desc, id desc),
  tyre_scope as (select vehicle_id from public.tyre_status where in_scope),
  tyre_recent as (select distinct vehicle_id from public.tyre_readings
                  where active and recorded_on between asof - 15 and asof),
  fuel_w as (select * from public.fuel_efficiency where recorded_on between ws and we),
  fuel_last as (select vehicle_id, max(recorded_on) last_fill from public.fuel_logs
                where active and recorded_on <= asof group by vehicle_id),
  km_w as (select * from public.odometer_daily where recorded_on between ws and we)
  select jsonb_build_object(
    'week_start', ws, 'week_end', we, 'days_due', (select count(*) from days), 'tracked', tracked,
    'in_service', (select count(*) from svc),
    'tyre', jsonb_build_object(
      'checked',      (select count(*) from tyre_last),
      'affected',     (select count(*) from tyre_last where status in ('low','high','unsafe') or imbalanced),
      'unsafe',       (select count(*) from tyre_last where status = 'unsafe'),
      'avg_dev_pct',  (select round(avg(avg_dev_pct), 1) from tyre_last),
      'avg_abs_dev_pct', (select round(avg(avg_abs_dev_pct), 1) from tyre_last),
      'in_scope',     (select count(*) from tyre_scope),
      'missing',      case when tracked then (select count(*) from tyre_scope t where not exists (select 1 from tyre_recent r where r.vehicle_id = t.vehicle_id)) end),
    'km', jsonb_build_object(
      'expected',     (select count(*) from km_exp),
      'entered',      (select count(*) from km_exp e where exists (select 1 from km_got g where g.vehicle_id = e.vehicle_id and g.recorded_on = e.d)),
      'deviations',   (select count(*) from km_w where above_average or below_average or went_backwards),
      'unexplained',  (select count(*) from km_w where (above_average or below_average) and coalesce(btrim(reason),'') = '')),
    'fuel', jsonb_build_object(
      'fills',        (select count(*) from fuel_w),
      'litres',       (select round(sum(litres), 1) from fuel_w),
      'cost',         (select round(sum(cost_effective)) from fuel_w),
      'deviations',   (select count(*) from fuel_w where deviated),
      'unexplained',  (select count(*) from fuel_w where deviated and coalesce(btrim(reason),'') = ''),
      'missing',      case when tracked then (select count(*) from public.fuel_fill_rule r left join fuel_last l on l.vehicle_id = r.vehicle_id
                       where l.last_fill is null or asof - l.last_fill > r.max_gap_days) end)
  ) into out;
  return out;
end $$;

-- The week's KPIs, the previous week's for comparison, and the two lists.
create or replace function public.fleet_week_report(p_week date) returns jsonb
language plpgsql stable security invoker as $$
declare
  ws date := date_trunc('week', p_week)::date;
  we date := ws + 6;
  due date := least(ws + 6, coalesce(public.fleet_last_due_day(), ws - 1));
  asof date := least(ws + 6, public.fleet_today());
  missing jsonb; devs jsonb;
begin
  with svc as (select * from public.fleet_vehicles_in_service),
  days as (select d from public.fleet_working_days(ws, due) d),
  km as (
    select s.vehicle_id, s.reg_no, s.bus_id, array_agg(d.d order by d.d) missed, (select count(*) from days) of_days
    from svc s cross join days d
    where not exists (select 1 from public.odometer_readings o where o.active and o.vehicle_id = s.vehicle_id and o.recorded_on = d.d)
    group by s.vehicle_id, s.reg_no, s.bus_id),
  tyre as (
    select t.vehicle_id, t.reg_no, t.bus_id,
      (select max(recorded_on) from public.tyre_readings r where r.active and r.vehicle_id = t.vehicle_id and r.recorded_on <= asof) last_on
    from public.tyre_status t where t.in_scope),
  fuel as (
    select r.vehicle_id, r.reg_no, r.bus_id, r.max_gap_days, r.typical_gap_days,
      (select max(recorded_on) from public.fuel_logs l where l.active and l.vehicle_id = r.vehicle_id and l.recorded_on <= asof) last_fill
    from public.fuel_fill_rule r)
  select coalesce(jsonb_agg(m order by m->>'kind', (m->>'bus_id')::int nulls last), '[]'::jsonb) into missing from (
    select jsonb_build_object('kind','km','vehicle_id',vehicle_id,'reg_no',reg_no,'bus_id',bus_id,
      'count', cardinality(missed), 'of', of_days, 'dates', to_jsonb(missed),
      'detail', cardinality(missed)||' of '||of_days||' working day'||case when of_days = 1 then '' else 's' end||' not entered') m
    from km where due >= ws
    union all
    select jsonb_build_object('kind','tyre','vehicle_id',vehicle_id,'reg_no',reg_no,'bus_id',bus_id,
      'detail', case when last_on is null then 'never checked'
                     else 'last checked '||to_char(last_on,'DD Mon')||', '||(asof - last_on)||' days before '||to_char(asof,'DD Mon') end)
    from tyre where asof >= greatest(ws, public.fleet_tracking_start()) and (last_on is null or asof - last_on > 15)
    union all
    select jsonb_build_object('kind','fuel','vehicle_id',vehicle_id,'reg_no',reg_no,'bus_id',bus_id,
      'detail', case when last_fill is null then 'no fill ever logged'
                     else 'last fill '||to_char(last_fill,'DD Mon')||', '||(asof - last_fill)||' days without one'||
                          coalesce(' (usually every '||typical_gap_days||')','') end)
    from fuel where asof >= greatest(ws, public.fleet_tracking_start()) and (last_fill is null or asof - last_fill > max_gap_days)
  ) x;

  select coalesce(jsonb_agg(d order by (d->>'severity')::int desc, d->>'date' desc), '[]'::jsonb) into devs from (
    select jsonb_build_object('kind','tyre','vehicle_id',e.vehicle_id,'reg_no',e.reg_no,'bus_id',e.bus_id,'date',e.recorded_on,
      'severity', case when e.status = 'unsafe' then 3 else 2 end, 'explained', null,
      'estimated_spec', e.spec_source = 'inferred',
      'detail', concat_ws(' · ',
        case when e.status = 'unsafe' then 'unsafe' when e.status = 'low' then 'under pressure' when e.status = 'high' then 'over pressure' end,
        case when e.imbalanced then 'uneven on one axle' end,
        'average '||case when e.avg_dev_pct > 0 then '+' else '' end||e.avg_dev_pct||'%',
        'worst '||case when abs(coalesce(e.worst_under_pct,0)) >= abs(coalesce(e.worst_over_pct,0))
                       then e.worst_under_pct::text else '+'||e.worst_over_pct end||'%')) d
    from (select distinct on (vehicle_id) * from public.tyre_reading_eval
          where recorded_on between ws and we order by vehicle_id, recorded_on desc, id desc) e
    where e.status in ('low','high','unsafe') or e.imbalanced
    union all
    select jsonb_build_object('kind','km','vehicle_id',o.vehicle_id,'reg_no',v.reg_no,'bus_id',o.bus_id,'date',o.recorded_on,
      'severity', case when o.went_backwards then 2 else 1 end,
      'explained', coalesce(btrim(o.reason),'') <> '', 'reason', o.reason,
      'detail', case when o.went_backwards then 'odometer lower than the day before'
                     else o.km_run||' km against a normal '||o.avg_daily_km||' km ('||
                          case when o.extra_km > 0 then '+' else '' end||o.extra_km||' km)' end)
    from public.odometer_daily o join public.vehicles v on v.id = o.vehicle_id
    where o.recorded_on between ws and we and (o.above_average or o.below_average or o.went_backwards)
    union all
    select jsonb_build_object('kind','fuel','vehicle_id',f.vehicle_id,'reg_no',v.reg_no,'bus_id',f.bus_id,'date',f.recorded_on,
      'severity', 2, 'explained', coalesce(btrim(f.reason),'') <> '', 'reason', f.reason,
      'detail', f.kmpl||' km/L against a normal '||f.avg_kmpl_r||' ('||case when f.deviation_pct > 0 then '+' else '' end||f.deviation_pct||'%)')
    from public.fuel_efficiency f join public.vehicles v on v.id = f.vehicle_id
    where f.recorded_on between ws and we and f.deviated
  ) y;

  return jsonb_build_object('week_start', ws, 'week_end', we,
    'due_through', case when due >= greatest(ws, public.fleet_tracking_start()) then due end,
    'tracking_start', public.fleet_tracking_start(),
    'is_current', ws = date_trunc('week', public.fleet_today())::date,
    'kpis', public.fleet_week_kpis(ws), 'prev', public.fleet_week_kpis(ws - 7),
    'missing', missing, 'deviations', devs);
end $$;

-- The last n weeks, oldest first, for the trend chart.
create or replace function public.fleet_week_trend(p_weeks int default 12)
returns table (week_start date, kpis jsonb)
language sql stable security invoker as $$
  select w::date, public.fleet_week_kpis(w::date)
  from generate_series(date_trunc('week', public.fleet_today()::timestamp) - (greatest(1, least(p_weeks, 52)) - 1) * interval '7 days',
                       date_trunc('week', public.fleet_today()::timestamp), interval '7 days') w
  order by 1
$$;
