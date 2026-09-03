# Archived database objects

On **2026-09-03** the live schema was cleaned so that `public` shows only what
TransportDesk actually uses. Stale tables were **moved to an `archive` schema, not
dropped** — nothing was destroyed, and any of it can be brought back in one statement.

```sql
-- bring one back
ALTER TABLE archive.<name> SET SCHEMA public;

-- once you are satisfied nothing needs it (irreversible)
DROP SCHEMA archive CASCADE;
```

`archive` is not exposed through the PostgREST API, so these tables are invisible to the
application as well as to anyone browsing the schema.

## How the list was decided

A table was archived only if **all four** were true:

1. no `.from()` or `.rpc()` reference anywhere in `frontend/` or `app/`
2. not read by any view (checked through `pg_depend`/`pg_rewrite`)
3. not referenced by any SQL function (checked against `pg_proc.prosrc`)
4. no foreign key pointing at it, and no trigger depending on it

After the move, every table, view and function the frontend uses was confirmed still
present, and all 11 frontend RPCs plus the cost primitives were executed without error.

## What was archived (21 tables)

**Dated backups — superseded**

| Table | Rows | Why |
| --- | --- | --- |
| `backup_road_km_20260813` | 1,661 | snapshot taken before the 13 Aug road-km rebuild |
| `backup_route_geo_20260813` | 59 | snapshot of `bus_route_geo` from the same day |

**One-time CSV import staging — data is already live**

| Table | Rows | Live equivalent |
| --- | --- | --- |
| `import_students` | 1,652 | `students` |
| `import_students_round2` | 335 | `students_round2` |
| `import_teachers` | 86 | `teachers` |

**Legacy staging (`stg_*`) — 12 tables**

`stg_coords` (1,620), `stg_coords3`, `stg_fees`, `stg_profiles` (2,167), `stg_roadtime`,
`stg_seat` (1,607), `stg_seat3`, `stg_seating`, `stg_startpt` (59), `stg_startpt3`,
`stg_students` (1,617), `stg_upsert`.

These were load-and-transform scratch tables. Their contents were long since promoted into
`students`, `student_profiles`, `student_fees` and `buses`.

**Superseded analysis tables**

| Table | Rows | Superseded by |
| --- | --- | --- |
| `an_bus` | 59 | `bus_economics` view and `report_fuel` |
| `opt_dest` | 1,251 | the marginal cheapest-insertion engine (`opt_insertion`) |
| `opt_abn_single` | 1,251 | `opt_abnormal`, which the app actually reads |
| `student_road_school` | 139 | never read by anything |

## Left in place, and why

These looked unused but are load-bearing. **Do not remove them.**

| Object | Kept because |
| --- | --- |
| `opt_insertion` (5,675 rows) | written by `refresh_insertion`, read by `refresh_rebalance`, which produces the `opt_rebalance_moves` the app shows |
| `opt_student_geo`, `opt_bus_health` | feed `opt_consolidation`, which the Optimization page reads |
| `report_backtrackers` | read by `recalc_light` |
| `report_deadrun_v2` | read by `recalc_master` |
| `report_merge_candidates` | read by `recalc_merge` |
| `fleet_speed` | read by `report_deadrun_full`, which the app shows |
| `student_fees` | feeds `bus_economics` and `report_finance` |
| `student_profiles` | read directly by `students.js` and `bulk.js` |
| `student_temp_assignments_r2` | read by `temporary.js`; FK to `students_round2` |
| `transport_params` | read by nine views and twelve functions |
| `spatial_ref_sys`, `geometry_columns`, `geography_columns` | PostGIS internals — never touch |

## Still to decide (deliberately left alone)

Reviewed and found unreferenced, but **not** archived because each is a judgement call the
project owner should make, not a mechanical one.

**Written by a refresh function, but nothing ever reads them.** Removing these means
removing the function too, so they are a complete feature that was built and never wired to
the UI:

- `opt_overcap` (10 rows) ← `refresh_overcap()` — over-capacity buses
- `opt_stop_merge` (283) ← `refresh_stop_merge()` — nearby stops that could be merged
- `opt_village_stops` (7) ← `refresh_village_stops()` — village stop clustering

**Views nothing reads:** `bus_routes`, `stayback_roster`, `student_directory`,
`opt_misassignment`, `opt_reassign_moves`, `opt_route_tangle`.

`opt_misassignment` feeds `opt_reassign_moves`; the pair must go together or not at all.
Views are cheap to keep and cost nothing at runtime, so there is no pressure to remove them —
but if the goal is a schema a new developer can read without confusion, they are the next
candidates.
