-- =============================================================================
-- Service intervals by vehicle type, as set by the transport manager (14 Oct 2026):
--   Cruiser and Eeco                    10,000 km or 1 year, whichever comes first
--   Traveller built before 2024         15,000 km or 1 year
--   every other vehicle                 20,000 km or 1 year
-- Keyed on make and model year so it applies to whichever plate carries them, and
-- re-runnable: a vehicle added later gets its plan by running this again, or from
-- Fleet -> Service.
-- =============================================================================
insert into public.service_plans (vehicle_id, interval_km, interval_days, provided_by, notes)
select v.id,
  case when v.make ilike '%cruiser%' or v.make ilike '%eeco%' then 10000
       when v.make ilike '%traveller%' and v.model_year < 2024 then 15000
       else 20000 end,
  365,
  'Transport manager',
  case when v.make ilike '%cruiser%' or v.make ilike '%eeco%' then 'Cruiser / Eeco: 10,000 km or 1 year'
       when v.make ilike '%traveller%' and v.model_year < 2024 then 'Traveller before 2024: 15,000 km or 1 year'
       else 'Standard: 20,000 km or 1 year' end
from public.vehicles v
where v.active
on conflict (vehicle_id) do update
  set interval_km = excluded.interval_km, interval_days = excluded.interval_days,
      provided_by = excluded.provided_by, notes = excluded.notes, updated_at = now();
