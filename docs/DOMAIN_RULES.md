# Domain Rules

Business rules that are **not** derivable from the code or the schema. Most were learned by
proposing something that turned out to be impossible in the real world. Read this before
writing anything that moves a child between buses or changes a route.

---

## 1. Size tiers — a child on a small bus cannot move to a bigger one

The fleet spans 7-seat vans to 52-seat coaches, and the small buses run small routes for a
reason: the lanes they serve cannot take a larger vehicle. So a receiving bus must be of the
**same tier or smaller** than the donor.

| Tier | Seats |
| --- | --- |
| tiny | ≤ 16 |
| small | 22–27 |
| mid | 30–36 |
| large | 40–45 |
| largest | 50–52 |

This is the classic **Site-Dependent Vehicle Routing Problem** (Nag, Golden & Assad, 1988).
Model it at the *stop* level — a flag on the student saying what can reach them — never by
building separate road networks per vehicle class.

**Consequence that surprises people:** the tiny tier is oversubscribed — more children than
seats. Small buses therefore can never be emptied out, whatever the optimiser suggests.
That is arithmetic, not preference.

Attempts to infer road width from OpenStreetMap in order to derive tiers automatically were
tested and **rejected**: the mean road class ran the *wrong* way, and Sikar has no width,
`maxwidth`, `est_width` or `smoothness` tags at all.

## 2. Two rounds

- **Round 1** — classes 2–12, table `students`, roughly 1,653 children.
- **Round 2** — pre-primary to class 1, table `students_round2`, roughly 325 children.

The active round is `globalThis.tdRound` (1 or 2), persisted in localStorage; switching
triggers a full `location.reload()`. Round 2 is **completely self-contained**: only its own
students, only its own buses, its own optimisation page.

**Round-2 routes are closed loops** — school → children → school, in both the arrival and
the departure run. There is no depot leg, so **start-point optimisation does not apply to
Round 2 at all**. Do not add it.

Do not print predicted ride times for Round 2. A model of minutes against distance and stop
count was fitted and scored **R² = −0.33**, which is worse than simply guessing the mean.

## 3. Teachers ride the morning buses

Teachers are real stops on Round-1 morning routes, inserted by cheapest insertion
(`frontend/js/teacherroute.js`), and filtered by the selected bus. They consume seats, which
is why several buses are over capacity in the morning but not the afternoon.

A dedicated teachers' shuttle has been considered. Its value would be **seats, not diesel** —
almost every teacher already lives within 400 m of their bus's existing route, so collecting
them costs close to zero extra distance.

## 4. Costing

```
annual fuel = road_km × trips_per_day(2) × working_days(200) × ₹100/litre ÷ mileage
```

Use **each bus's own mileage** from the `buses` table — it ranges from 3.11 to 12.31 km/l —
never a fleet average. The spread is wide enough that the least efficient bus can make a
short empty run cost more than a long one on an efficient bus.

Marginal student cost is measured by **cheapest insertion**: `own_detour_m(bus, sr)` and
`insert_cost_m(bus, lon, lat)`, always in metres and never negative. Multiply by that bus's
measured `bus_factor` to convert a straight-line figure into real road kilometres.

**Straight-line distances are not good enough for a costing decision.** A worked example
flipped sign entirely — a proposed move scored +₹9,801/year on straight lines and
−₹4,293/year once measured on real roads.

## 5. Capacity

`bus_capacity.effective_capacity = capacity + COALESCE(allowance_override, <rule>)`, where
the rule adds 0 below 16 seats, 3 for small buses, and 5 above the 32-seat threshold.
Setting `allowance_override = 0` means effective capacity equals nominal — used where the
operator wants no allowance at all.

**Capacity is read live** by the app from `buses`, so a change needs no deploy. But
`r2_route.capacity` and `opt_fleet_assign` store **copies** and must be refreshed after any
capacity edit, or the optimiser will plan against stale seat counts.

## 6. Fleet changes already made

Three routes have been taken off the road. The vehicle numbering is counter-intuitive and
has caused mistakes, so state it plainly:

- Routes **2, 39 and 53** no longer run.
- Vehicle **53** was moved onto **route 52**, because vehicle 52 was too small for it.
- The three vehicles now parked are therefore **2, 39 and 52**.
- **Route 52 still runs every day.** Its distance is *not* a saving.
- **Bus 44 still runs.** Its students were dispersed, but the bus was never retired. This
  has been recorded wrongly more than once.

Two standing route policies:

- **Nawalgarh road is deliberately split** — bus 6 takes one side, bus 25 the other. Never
  propose merging them; the split is a road-crossing safety decision.
- **Gokulpura** is served by bus 46, not bus 21.

## 7. Data integrity rules

- Students are **deactivated, never deleted**. Every analysis filters on `active`, and
  `student_address_history` is the audit trail that makes retired routes reconstructible.
- A student who does not use transport has `uses_transport = false` and must not display a
  bus number anywhere.
- Coordinates are either both present or both null — never `0`.
- `students_round2` has a partial unique index on `sr_no` where `active`. A child can appear
  in both rounds during a transition, so check for duplicates when reconciling.
