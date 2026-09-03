# Operating TransportDesk

How the system is kept correct day to day. Written for whoever runs transport, and for the
developer who needs to know why the data flows the way it does.

Companion documents: `HANDOFF.md`, `ARCHITECTURE.md`, `DOMAIN_RULES.md`,
`ANALYSIS_METHODS.md`.

---

## 1. The website is the record

**Every change is made in TransportDesk and nowhere else.** Addresses, bus reassignments,
capacities, start points, children leaving — all of it.

This is not tidiness. Editing a spreadsheet and re-importing it silently discards three
things the system depends on:

- the **change history** in `student_address_history`, which is what made it possible to
  reconstruct three retired routes months later and cost them
- **coordinates corrected by hand** on the map, which no spreadsheet has
- the **`active` flags** that keep departed children out of every report

A re-import cannot know which of two versions is newer, so it overwrites good data with
stale data.

```
Website edit → database → history recorded → reports and costs update
```

One direction only. Anything arriving from the side — a sheet, a CSV, a WhatsApp list — is
typed in, never imported over the top.

### Do

- **Address changed** → Students, drag the map pin, save. Coordinates and history are
  written together.
- **Bus changed** → Students for one child, Bulk for many. Both record who moved and from
  where.
- **Child left** → mark inactive. Never delete.
- **Moved to Round 2** → use the round-move action, which deactivates the Round 1 row rather
  than duplicating the child.

### Do not

- **Do not edit a spreadsheet and re-upload it.** Import is for a genuinely new intake, and
  even then it lands in staging and is checked before touching live rows.
- **Do not keep a private copy of the roster.** Once two lists exist, one is wrong and
  nobody knows which.
- **Do not edit the database directly** through Supabase unless fixing something the app
  cannot do. Direct edits skip the `students_log_change()` trigger, so the change vanishes
  from the audit trail.

### The one thing the app does not do for itself

`r2_route.capacity` and `opt_fleet_assign` store **copies** of capacity. After any capacity
change they must be refreshed, or the optimiser plans against stale seat counts:

```sql
UPDATE r2_route r SET capacity = b.capacity FROM buses b WHERE b.bus_id = r.bus_id;
SELECT refresh_fleet_assign();
```

Wiring this into the capacity save action is a good first task for a new developer.

## 2. Maintenance routine

Ordered by how quickly the thing being checked turns into a real problem.

| When | Check | Where |
| --- | --- | --- |
| Weekly | Buses over effective capacity | Dashboard alerts |
| Weekly | Missing coordinates; self-transport children still showing a bus | Dashboard alerts |
| Weekly | Children active in both rounds at once | Students, both rounds |
| Fortnightly | Tyre pressure — **all four tyres** recorded per bus | paper round, then Maintenance |
| Monthly | Recompute route geometry and the optimisation snapshot | Optimization page |
| Monthly | Fuel logged against each bus's recorded mileage; investigate drift | Reports · Fuel |
| Termly | Fresh GPS download for every bus; re-measure empty running | KVL export |
| Termly | Review start points against where buses actually begin | Optimization |
| Yearly | Re-measure mileage; refresh diesel price and working days | `buses`, `transport_params` |

Two deserve a named owner rather than a rota: the **fortnightly tyre round**, which has a
safety consequence, and the **monthly fuel-against-mileage check**, which will catch a
failing engine, a leak or a driver problem before anything else does.

### Useful queries

```sql
-- buses over their effective capacity
SELECT bus_id, riders, effective_capacity FROM bus_capacity
WHERE riders > effective_capacity ORDER BY riders - effective_capacity DESC;

-- children active in both rounds
SELECT s.sr_no FROM students s
JOIN students_round2 r ON r.sr_no = s.sr_no AND r.active WHERE s.active;

-- data gaps
SELECT count(*) FILTER (WHERE latitude IS NULL AND uses_transport) AS no_coords,
       count(*) FILTER (WHERE NOT uses_transport AND bus_no IS NOT NULL) AS self_with_bus
FROM students WHERE active;

-- how stale is the cached route geometry
SELECT max(computed_at) FROM bus_route_geo;
```

## 3. Bus details: staff, vehicle and running cost

The Bus page carries the vehicle registration, make, year of manufacture, route name, the
driver and conductor with their **monthly** salaries, and the year's maintenance spend. It
totals staff, maintenance and fuel into what the bus costs to run in a year.

Two conventions matter:

- **Vehicle age is derived from the year of manufacture, never stored.** Storing an age
  guarantees it is wrong within a year.
- **A blank cost stays blank; it is never saved as 0.** Zero would claim the bus costs
  nothing to run, which is different from not knowing.

21 buses have no conductor. In the source spreadsheet that was recorded by typing the
vehicle type into the conductor column ("Traveller", "CRUISER", "Mini Bus", "ECO") with a
salary of 0; on load those were converted to a genuine blank. Keep them blank.

Non-fuel cost is not small. Across the fleet the recorded figures come to about
**₹95 lakh a year in maintenance** and **₹11.1 lakh a month in driver and conductor pay** —
comparable to the whole diesel bill. Any proposal to take a bus off the road should be
costed on all three, not on diesel alone.

## 4. Round 2 seat utilisation

Round 2 runs at roughly **59% seat fill** — about 325 children in 548 seats across 25 buses.
That is the largest remaining efficiency question in the fleet, and unlike Round 1 it is not
constrained by dead running, because those routes are closed loops from school.

Any consolidation proposal must satisfy all of:

1. the receiving bus is the **same seat tier or smaller** (see `DOMAIN_RULES.md` §1)
2. the receiving bus has the spare seats **after** the transfer
3. transferring children live close to children the host bus already visits
4. no bus is both a donor and a host, so the moves stay independent
5. **ride time stays acceptable for pre-primary children** — the binding constraint in
   Round 2, and the one no query can check for you

Withdrawing vehicles needs management approval, so produce the measured net saving — gross
route fuel **minus** the extra distance the receiving buses will drive — before the meeting,
not after.

## 5. Keeping figures defensible

The cost figures feed an incentive plan, so they get challenged. Three habits make that
survivable:

- **Attribute each saving to one cause.** If a start point moved and the route changed
  together, and neither works without the other, it is one line in the report — not two.
- **Never mix bases in one table.** Every row answers the same question, and the table says
  which question.
- **Mark estimates as estimates,** and put the method next to the number. Two figures
  challenged as exaggerated were re-tested and confirmed precisely because the method was
  recorded alongside them.
