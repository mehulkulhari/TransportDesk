# TransportDesk

Transport management for a 59-bus school fleet: ~1,653 Round-1 students, ~325 Round-2
children, plus teachers riding the morning runs.

Read `docs/HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/DOMAIN_RULES.md`,
`docs/ANALYSIS_METHODS.md` and `docs/OPERATIONS.md` before making changes. They record rules and methods that are not derivable from the code.

## Hard constraints

- **This repository is public.** Never commit student names, addresses, coordinates or GPS
  tracks. `.env`, `GPS Files/` and `*.kml` are gitignored — keep them that way.
- **The Google Directions key in `frontend/js/config.js` is HTTP-referrer restricted by
  design.** That restriction is what makes it safe to publish. Never replace it with an
  unrestricted key, and never try to call the Directions REST API server-side — it will
  return `REQUEST_DENIED`. Use the Maps JavaScript SDK from an allowed referrer instead.
- **`pickup_order` is the optimised sequence, not the order buses actually drive.** Never
  assume pickup_order 1 is the first child collected.
- **A child on a small bus cannot be moved to a bigger one.** Receiving bus must be the same
  size tier or smaller. See `docs/DOMAIN_RULES.md` §1.
- **Round 2 routes are closed loops** (school → children → school). Start-point optimisation
  does not apply to Round 2.
- **Deactivate, never delete.** Every query filters `active`; history is the audit trail.

## Style

Plain ES modules, no framework, no build step. Match the surrounding code — it is
deliberately simple. Comments explain *why*, not *what*.

## Numbers

Cost figures feed a real incentive plan, so precision matters more than speed:

- Use each bus's own mileage from `buses`, never a fleet average.
- Measure on real roads (GPS tracks first, Google second), never straight lines — a worked
  example flipped sign between the two.
- Never mix bases in one table: dead run and whole route are different measurements.
- Mark every estimated figure as estimated, and state the method next to the number.
- Render and read a map before making any spatial claim.
