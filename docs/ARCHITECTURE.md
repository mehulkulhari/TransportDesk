# Architecture

How the system is put together, and **why** — the reasoning behind each choice, so that a
future developer can tell a deliberate decision from an accident.

Companion documents: `HANDOFF.md` (getting started), `DOMAIN_RULES.md` (business rules),
`ANALYSIS_METHODS.md` (how figures are measured).

---

## 1. Shape of the system

```
Browser (static files, no build step)
  index.html  — one page, 14 views, all present in the DOM at once
  js/*.js     — ES modules, loaded natively by the browser
      │
      │  supabase-js over HTTPS (PostgREST + Auth)
      ▼
Supabase (managed Postgres 15 + PostGIS)
  ~60 tables · ~30 views · ~30 SQL functions
  All routing and cost mathematics lives HERE, in SQL, not in the browser
      │
      │  measured once, cached, never called at page load
      ▼
Google Directions API (browser-only, referrer-restricted key)
KVL GPS tracker exports (KML files, manual download)
```

There is **no application server of our own**. The browser talks straight to Postgres
through PostgREST. There is nothing to deploy beyond copying static files, and nothing to
keep running.

## 2. Frontend

**One page, many views.** `index.html` contains all 14 views as `<section class="view">`
elements. Navigation toggles a single `on` class — see `app.js:162-164`. There is no
client-side router; `js/router.js` is a two-line stub kept only so imports resolve.

*Why:* the app has a fixed, small set of screens and a single audience. A router and its
history handling would add moving parts without removing any.

**Module layout** (`frontend/js/`, ~4,300 lines total):

| Module | Lines | Responsibility |
| --- | --- | --- |
| `app.js` | 1092 | view switching, shared globals, search, CSV import, reports |
| `optimization.js` | 755 | Round-1 optimisation page — the largest feature |
| `maps.js`, `mapfocus.js` | 452 | Leaflet setup, route drawing, focusing a bus |
| `students.js` | 280 | student editor, map pin, coordinate safety |
| `planner.js` | 215 | route planner with live Directions |
| `bulk.js` | 196 | bulk transfer between buses |
| `optimization_r2.js` | 157 | Round-2 optimisation, deliberately separate |
| `roundmove.js` | 154 | moving a child between rounds |
| `bootstrap.js` | 36 | loads fleet, school and colours, then boots every page |
| `supabase.js`, `auth.js`, `config.js` | 43 | the only three infrastructure modules |

**Start reading at `bootstrap.js`.** It is 36 lines and every page depends on what it
loads: the bus list, the school location, and the per-bus colours.

**Shared state is on `globalThis`,** not in a store — `buses`, `school`, `colorOf`,
`tdRound`, the Leaflet map handles. *Why:* the modules were split out of one large file, and
`globalThis` was the boundary that let them separate without inventing an abstraction.
It works because there is exactly one page and one user session. If the app ever grows
concurrent views, this is the first thing that will need to change.

**Third-party code is loaded from CDN** (Leaflet, PapaParse, GoogleMutant, leaflet.heat) and
supabase-js from `esm.sh`. *Why:* it preserves the no-build-step property. The trade-off is
a hard dependency on those CDNs at page load, accepted because the app is used on a school
network with reliable internet and no offline requirement.

## 3. Backend: the database is the application

The single most important architectural decision: **all routing and cost mathematics lives
in SQL functions, not in the browser or in Python.**

Core primitives (`sql/functions.sql`):

| Function | Purpose |
| --- | --- |
| `insert_cost_m(bus, lon, lat)` | marginal metres to add a stop to a route |
| `own_detour_m(bus, sr)` | marginal metres a specific child costs their own bus |
| `ordered_route_m(bus)` / `_excluding(...)` | route length, with a set of children removed |
| `route_km_greedy(bus)`, `greedy_route_m(...)` | nearest-neighbour route construction |
| `bus_factor(bus)` | that bus's measured straight-line → road-km multiplier |
| `route_order(start, srs)`, `route_km_from(bus, start)` | ordering and cost from any origin |
| `simulate_moves(jsonb)`, `move_students_impact(srs, to)` | what-if before committing |
| `students_near_bus_route(bus, metres)` | corridor search — the basis of every proposal |

*Why in SQL:* these operate over thousands of stop pairs. In the browser each call would be
a round trip per pair; in Postgres with PostGIS it is one indexed query. It also means the
optimiser, the reports and any ad-hoc analysis compute costs **the same way** — there is
one definition of what a kilometre costs, and it cannot drift between callers.

**Results are snapshots, not live queries.** The `opt_*` tables hold precomputed findings,
refreshed by an explicit chain:

```
refresh_student_fix → recalc_light → recalc_merge → recalc_master
  (plus refresh_insertion, refresh_rebalance, refresh_fleet_assign,
   refresh_depot_swap, refresh_overcap, refresh_stop_merge, refresh_village_stops)
```

`opt_meta` and `opt_task_status` record when each ran. *Why:* a full recomputation takes far
longer than a page load will tolerate, and the operator needs stable numbers to act on — a
figure that shifts between viewings cannot be taken to a manager.

**Consequence to remember:** several tables store *copies* of values (`r2_route.capacity`,
`opt_fleet_assign`). After changing capacities or students, refresh them or the optimiser
plans against stale data.

**Views are the read API.** `student_effective` (22 columns) is the canonical student row —
it merges the student, their bus, any temporary assignment, and derived flags such as
`uses_transport`. The UI reads views; it does not assemble entities from base tables.

## 4. Data model

**Two student tables, not one.** `students` (Round 1, ~1,650) and `students_round2` (~325).

*Why:* Round 2 has a different shape, not just a different filter — closed-loop routes with
no depot leg, its own bus subset, its own optimisation. A shared table with a `round` column
was considered and rejected: every query would need the filter, and forgetting it once
silently mixes four-year-olds into secondary-school routes. Two tables make the mistake
impossible rather than merely unlikely. The cost is some duplication — `r2_route`,
`opt_r2_move`, `student_temp_assignments_r2` mirror their Round-1 equivalents.

**Nothing is deleted.** Students carry `active`; `student_address_history` (10,800 rows) is
written by the `students_log_change()` trigger. *Why:* this is what made it possible to
reconstruct three retired bus routes months later and cost them — the audit trail is
load-bearing analysis data, not just compliance.

**Geometry is generated, not hand-maintained.** `students_sync_geom()` keeps `geom` in step
with latitude/longitude so PostGIS indexes stay valid. Coordinates are constrained to be
both-present-or-both-null and within Rajasthan's bounding box, because `+null` evaluating to
`0` once wrote children to the Atlantic.

**The live schema holds only what is used.** On 2026-09-03, 21 stale tables — dated
backups, one-time CSV import staging, legacy `stg_*` scratch tables and superseded analysis
snapshots — were moved to an `archive` schema, which PostgREST does not expose. Nothing was
dropped; `sql/ARCHIVED.md` records what moved, the four tests each had to fail to qualify,
and which look-unused-but-load-bearing objects were deliberately kept.

**Staging tables are deliberate.** `stg_*` and `import_*` receive raw CSV uploads before
anything touches live rows. *Why:* imports come from spreadsheets maintained by hand, and
arrive with duplicates, blank coordinates and shifted columns. Loading and validating
separately means a bad file is a failed import, not a corrupted roster.

## 5. Auth and access

Supabase Auth with email/password; `js/auth.js` is nine lines. Every table has RLS enabled.
There are no roles — all authenticated staff have the same access.

*Why:* the system has a handful of trusted users in one office. Roles were not built because
nothing yet distinguishes them; adding them later means adding policies, not restructuring.

**The `sql/policies.sql` file in the repository is empty of `CREATE POLICY` statements** —
the live policies were applied directly. That is a gap: policies are not reproducible from
the repository. Dump them before any migration work.

## 6. External services

**Google Directions — browser-only, by design.** The key is HTTP-referrer restricted, so
server-side REST calls return `REQUEST_DENIED`. Routing is done through the Maps JavaScript
SDK from an allowed referrer, and results are **cached in the database** (`bus_route_geo`,
`r2_route_geo` hold road km, duration and encoded polylines).

*Why:* the restriction is what makes the key safe to commit to a public repository. Normal
use of the app makes **zero** Directions calls — it reads cached polylines. Only an explicit
recompute costs money. Do not "fix" the restriction; work with it (`ANALYSIS_METHODS.md` §1).

**Basemap is OpenStreetMap tiles** by default; Google tiles are wired via GoogleMutant but
disabled (`GOOGLE_MAPS_API_KEY` is empty). *Why:* free, adequate, and no per-load billing.

**GPS is manual.** KVL tracker exports are downloaded as KML and analysed offline. There is
no live integration — it is a known gap, listed in `PROJECT_STATE.md`.

## 7. Decisions, and what would change them

| Decision | Reason | Revisit when |
| --- | --- | --- |
| No build step, no framework | one page, one audience, no server; keeps the whole app inspectable | the UI grows genuinely concurrent views |
| Cost mathematics in SQL | one definition of cost, no per-pair round trips | never — this is load-bearing |
| Snapshot `opt_*` tables | figures must be stable enough to act on | recomputation gets fast enough to be live |
| Separate Round-2 tables | makes cross-round contamination impossible | the two rounds' route models converge |
| `globalThis` for shared state | honest boundary after splitting one big file | concurrent views, or a second page |
| Soft delete plus history trigger | the audit trail is analysis data | never |
| Directions cached, key referrer-locked | zero ongoing cost, safe in a public repo | never — the restriction is the security control |
| Public repository | it is a portfolio-visible project | if it must hold operational data |

## 8. The public-repository constraint

This shapes more than it first appears. **No student names, addresses, coordinates or GPS
tracks may ever be committed.** `.env`, `GPS Files/`, `*.kml` and the analysis bundle are
gitignored.

The practical consequence: the *methods* live in this repository, and the *data and the
scripts that embed it* are handed over privately. A developer therefore cannot reproduce a
specific figure from the repository alone — they need the analysis bundle too. That is a
deliberate trade, and the alternative (making the repository private) is the one decision
here most worth revisiting.
