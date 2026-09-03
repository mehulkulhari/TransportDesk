# Analysis Methods

How the distance and cost figures are produced. These feed an incentive plan, so every
number is expected to survive being questioned. The rule throughout: **measure it, say how
it was measured, and mark anything that is estimated.**

---

## 1. Measuring real road distance

Two sources, in order of preference.

**KVL GPS tracks** — the road the bus actually drove. 57 KML files, one per route, named
`rNN_<plate>_<date>_<start>_to_<end>.kml`, recorded on the morning runs of 11–12 August
2026. Each holds a stated `Distance`, a `Running` time, and a LineString sampled at roughly
35 m. **Route `rNN` corresponds to bus `NN`** — this was proved geometrically, not assumed
(see §3). Tracks are missing for buses 3, 51 and 55.

**Google Directions** — used only where GPS cannot answer. The API key is **HTTP-referrer
restricted**, which means server-side REST calls fail with `REQUEST_DENIED`. It cannot be
"fixed" with a different key; the restriction is what makes the key safe to publish. Use the
Maps **JavaScript SDK** `DirectionsService` from a page served on an allowed referrer
(`localhost:8010`), and POST results back to a small local receiver. The analysis bundle
contains a working harness.

Never mix the two sources within a single before-and-after comparison. Route both sides by
the same method so the routing engine's bias cancels out, and quote the other source
alongside as an independent cross-check.

## 2. Dead run (empty running)

The distance a bus covers with **no child aboard**, getting from where it starts to the
first child it reaches.

Method, per bus:

1. Take the recorded morning track and build cumulative distance along it.
2. Project **every child on that bus** onto the track — nearest **segment**, not nearest
   vertex, so precision is not capped by the 35 m sampling interval.
3. Accept a child as being on the route only within **200 m** of the track, so an address
   that has changed since the recording cannot drag the anchor to the wrong place.
4. The dead run is the along-track distance from the start of the recording to the
   **earliest** accepted child.

> **Do not anchor on `pickup_order = 1`.** That is the app's optimised sequence, not the
> order the bus drove. Doing so put the supposedly-empty stretch straight through
> neighbourhoods the bus was already collecting in. The error was caught by *drawing* the
> track with every child plotted on it — always do that before trusting a new figure.

The afternoon leg is taken as equal to the morning. Google measured both directions
independently and found a fleet-wide difference of only 2.5 %, so this is a small
assumption rather than a large one.

**Result: about 498 km of empty running per day, costing roughly ₹16.2 lakh a year.**
Note that most of this is structural — buses must physically reach their routes — so it is
a **baseline to measure against, not a savings target**.

## 3. Validating that data belongs to what it claims

Cheap checks that have each caught a real error:

- **Do the children lie on their own bus's track?** Across the fleet, 1,298 of 1,369 sit
  within 200 m of it, with a median offset of 5 m. That simultaneously proves the route-to-
  bus mapping. Where it failed it was informative: one bus had only 6 of 30 children on its
  track, which correctly identified a route change; another's children fitted a *different*
  bus's track perfectly, which is how the vehicle swap on route 52 was confirmed.
- **Does the recording start where the database says the bus starts?** Median gap 13 m
  across the fleet — the stored start points are confirmed by the buses' own movements.
- **Does the computed track length match the length KVL states in the same file?** Agreement
  is within 1.3 % fleet-wide, which validates the parsing.
- **Does an optimiser beat the measured route?** If re-ordering the stops produces a shorter
  route on the *old* side than you measured, your saving is an artefact of a bad stop order.
  Both figures that were challenged as exaggerated survived exactly this test.

## 4. Attributing a saving to the right cause

A single operational change often moves several things at once. Keep the categories apart
and state which basis each figure uses.

- **Start-point change** → measure the **dead run** only, old against new, holding the
  student set and the route order constant.
- **Student moved between buses** → measure the **whole route** on the losing bus and on
  the receiving bus, and report the net. The receiving bus's added distance is a real cost
  and must be subtracted.
- **Route taken off the road** → the whole route's fuel, minus any penalty incurred
  elsewhere (for example a less efficient vehicle inheriting a route).

Where two changes only work *together*, report them as **one line**, not split across
categories. One start-point move was only possible because three students left that bus;
with the new start point and those students still aboard, the route was *worse* than before.
Splitting such a package across two tables either double-counts it or produces a nonsensical
negative in one of them.

Never present a mixed-basis table. A file where some rows showed whole routes and others
showed dead runs was — correctly — rejected as inconsistent.

## 5. Mileage and pressure

Rolling resistance is **not linear** in tyre pressure; it rises roughly as `P^-0.4`. A tyre
20 % under-inflated adds about 9 % rolling resistance, 40 % adds 23 %, and 60 % adds 44 %.
Averaging pressures before applying the relationship therefore understates the damage, and
the worst few vehicles account for most of the loss. Model each tyre individually, weight
the rear axle at about 65 % of the effect because it carries the load, and take rolling
resistance as roughly 25 % of tractive fuel energy for stop-start school duty.

Publish the sensitivity range alongside the central figure — the two assumptions in that
last sentence are the ones a reader will want to vary.

## 6. Reasoning about geography

For any spatial claim, **render a map and read it** before asserting anything. Fetch the
road network, draw the route with the relevant points marked, and look at the image. This
has repeatedly caught errors that were invisible in tabular output — most notably the
`pickup_order` mistake in §2.

Coordinates alone are a poor way to reason about place; a labelled rendering, or a
`<distance> <bearing>: <landmark>` description, is far more reliable.
