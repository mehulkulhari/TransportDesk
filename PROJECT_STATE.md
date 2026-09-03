# TransportDesk — Project State

Last updated: 2026-09-03

**New here? Read `docs/HANDOFF.md` first.**

## Live

59 buses. ~1,653 Round-1 students, ~325 Round-2 children, plus teachers riding the morning
runs. Frontend is plain ES modules with no build step; backend is Supabase.

## Working

Student and admission management, bus allocation, the two-round system, pickup ordering,
Round-1 and Round-2 optimisation, teachers inside morning routes, reports, bulk transfer,
GPS mapping, and the dead-run and savings analysis.

## Measured

- Fleet empty running: ~498 km/day, ~₹16.2 lakh/year. A baseline, not a savings target —
  most of it is structural.
- Realised savings to date: ₹10,49,848/year in diesel, across three routes taken off the
  road, 19 start-point changes, and two student moves. Excludes drivers and maintenance for
  the three parked vehicles, which have not been supplied.

## Open

1. Buses 10 and 27 are over capacity (16 in 14, and 17 in 14).
2. One student move (bus 58 to 35) is counted in the savings but not recorded in the database.
3. Bus 38's start point is a regression on dead running and should probably be reverted.
4. No usable GPS track for buses 3, 51, 55 and 43 — those four rest on estimates.
5. Tyre pressures: fleet runs under-inflated, worth ~₹2.5–2.9 lakh/year. Blocked on
   manufacturer placard pressures; the targets used so far were inferred.
6. Live GPS integration and an attendance module are scoped but not started.

## Reference

- `docs/HANDOFF.md` — start here: setup, layout, traps, what to request separately
- `docs/ARCHITECTURE.md` — how the system is built, and why each choice was made
- `docs/OPERATIONS.md` — how the data must be kept, and the maintenance routine
- `docs/DOMAIN_RULES.md` — rules not derivable from the code
- `docs/ANALYSIS_METHODS.md` — how the distance and cost figures are produced
