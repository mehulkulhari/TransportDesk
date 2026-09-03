# TransportDesk — Developer Handoff

Everything a developer needs to take this over. Read this first, then `DOMAIN_RULES.md`
(the business rules that are not guessable from the code) and `ANALYSIS_METHODS.md`
(how the cost and savings figures are produced).

**This repository is public. It must never contain student names, addresses, coordinates,
or GPS tracks.** Everything identifying is handed over separately — see *What you receive
separately* below.

---

## 1. What this is

Transport management for Euro International School, Sikar (Rajasthan). It runs a **59-bus
fleet** carrying about **1,653 Round-1 students** and **325 Round-2 children**, plus
teachers who ride the same morning buses.

It is not only a CRUD app. About half its value is the routing and cost analysis: which bus
a child should be on, where each bus should start its day, which buses can be taken off the
road, and what each decision is worth in diesel. Those figures feed a real incentive plan,
so **precision matters more than speed** and every number must be traceable to how it was
measured.

## 2. Running it

The frontend is **plain ES modules — no build step, no framework, no bundler**. Do not add
one without a reason; the whole app is served as static files.

```bash
python -m http.server 8000 --directory frontend
```

Then open `http://localhost:8000`. `.claude/launch.json` has the same thing wired up for
tooling. The backend is **Supabase** (Postgres + PostgREST + Auth); there is no server of
our own to run.

## 3. What you receive separately (not in git)

Ask the transport manager for these. Nothing here can be reconstructed from the repository.

| Item | Why you need it | Where it goes |
| --- | --- | --- |
| `.env` | Supabase URL, keys, DB password | repo root, gitignored |
| `GPS Files/` — 57 `.kml` tracks | every distance figure is measured off these | repo root, gitignored |
| `analysis/` bundle | the scripts that produce the cost and savings CSVs | outside the repo; they have student names embedded |
| Source CSVs | tyre pressure, capacities, start points, Round-2 roll | wherever you like, outside git |

`frontend/js/config.js` holds the Supabase publishable key and a Google Directions key.
Both are safe in a public repo: the Supabase key is the publishable (anon) one and is
protected by row-level security, and **the Google key is HTTP-referrer restricted by
design**. Do not "fix" that by swapping in an unrestricted key — an unrestricted key in a
public repo is a genuine security problem. See `ANALYSIS_METHODS.md` for how to work with
the referrer restriction rather than around it.

## 4. Layout

```
frontend/          the app. index.html + js/ ES modules, no build step
  js/bootstrap.js  loads fleet, school and colours, then boots every page. Start here.
  js/supabase.js   the single Supabase client
  js/router.js     page switching
  js/rounds.js     Round 1 / Round 2 switching — read DOMAIN_RULES.md before touching
  js/optimization.js / optimization_r2.js   cost analysis pages, one per round
  js/maps.js, mapfocus.js, teacherroute.js  Leaflet maps and route drawing
sql/               tables, views, functions, policies, reports — the source of truth
supabase/          config and migrations
python/            coordinate and routing helpers
docs/              this file, DOMAIN_RULES.md, ANALYSIS_METHODS.md
app/               older copy of the frontend; frontend/ is the live one
```

## 5. The traps that cost the most time

These are all real defects that were hit and fixed. They will bite again.

- **`pickup_order` is the app's *optimised* sequence, not the order buses actually drive.**
  Any analysis that assumes "pickup_order 1 = the first child collected" is wrong. Use the
  GPS tracks to establish the driven order. This single assumption produced a badly wrong
  cost model once already.
- **Small buses cannot hand children to bigger buses.** See `DOMAIN_RULES.md` §1. This is a
  hard constraint, not a preference, and it invalidates most naive consolidation ideas.
- **Postgres `standard_conforming_strings` is on.** Escaping backslashes when building SQL
  strings inserts a *real* extra backslash. This corrupted 23 encoded polylines, because
  Google's polyline alphabet includes `\`. Load polylines with `\copy` from a CSV, never by
  string-building them into SQL.
- **Views must filter `active`.** `alerts` and `dashboard_stats` once read `students`
  directly and reported children who had left the school.
- **PostgREST `.or()` needs quoted patterns.** Raw interpolation breaks on any value
  containing a comma. Use the double-quoted form, see `frontend/js/rounds.js`.
- **`#app` is a flex column with an explicit `grid-row` fallback** (`frontend/css/main.css`).
  It looks redundant; it is not. Removing it collapses every map to zero height when the
  round strip is hidden.
- **Never write `0` coordinates.** `+null` evaluates to `0`, which is a valid number and a
  location in the Atlantic. `students.js` tracks whether the map pin actually moved.

## 6. Where the project stands

Done and in production: student and admission management, bus allocation, two-round system,
pickup ordering, Round-1 and Round-2 optimisation pages, teachers inside morning routes,
reports, bulk transfer, GPS mapping, and the dead-run and savings analysis.

Open items, roughly in priority order:

1. **Buses 10 and 27 are over capacity** (16 in 14, and 17 in 14). Needs placements.
2. **One student move from bus 58 to bus 35 is not recorded in the database** — the child
   still shows on bus 58, while the savings report already counts the move. Record it or
   the two disagree. The name is in the analysis bundle's savings report.
3. **Bus 38's start point is a regression** on dead running and should probably be reverted;
   its route gain came from the route becoming linear, not from the start point.
4. **Four buses have no usable GPS track** — 3, 51 and 55 were never supplied, and 43's
   track predates a route change. Fresh tracks would put the whole fleet on measured data.
   Bus 43 is the largest figure resting on an estimate.
5. **Tyre pressures**: the fleet runs under-inflated, worth an estimated ₹2.5–2.9 lakh a
   year in diesel plus tyre life. Blocked on manufacturer placard pressures — the targets
   used so far were inferred, and should not drive a fleet-wide re-inflation.
6. Live GPS integration and an attendance module were both scoped but not started.

## 7. Conventions worth keeping

- Match the surrounding code. It is deliberately plain: no framework, few dependencies,
  comments that explain *why* rather than *what*.
- Every cost figure carries its method and its cross-check. If you change how something is
  measured, change the note next to it in the same commit.
- Deactivate, never delete. Student rows carry `active`; history lives in
  `student_address_history` and several analyses depend on it.
- When you cannot measure something, say so in the output rather than estimating silently.
  The CSVs mark which rows are measured and which are estimated, and that distinction is
  what makes them defensible.
