# Fleet Module

Vehicles, the people who run them, and everything logged against them: tyres,
daily kilometres, fuel, service, maintenance checkups, documents, bills,
complaints, staff tenure, and spare buses. It lives under **Fleet** in the main
navigation; its alerts also appear on the main dashboard.

Schema: `supabase/migrations/20260924000000_fleet_operations.sql` and
`20260924000100_move_bus_details_to_vehicles_and_staff.sql`.
Tests: `tests/fleet/` (see *Testing* below).

---

## 1. The one decision everything rests on: vehicle, not route

Every log records the **vehicle** (the physical bus, by registration) and,
separately, the **route** it covered that day.

Kilometres, fuel, tyres, documents, service history and repair bills all belong
to the vehicle. Vehicles move between routes — in September 2026 three routes
held each other's vehicles and two more had swapped — and a spare bus has no
route at all. Keying these logs by route number would attribute one vehicle's
mileage to another. Recording both is also exactly how a spare standing in for a
broken-down bus is captured: *vehicle = the spare, route = the one it covered*.

A route holds one vehicle at a time (`vehicles.bus_id` is unique). Moving a
vehicle is done on **Fleet → Vehicles**; `vehicle_route_history` records every
move automatically through a trigger.

## 2. Every entry carries who and when

| Column | Meaning | Filled by |
| --- | --- | --- |
| `recorded_on` | the date the data refers to | the person entering it (defaults to today; future dates refused) |
| `provided_by` | who gave the data — driver, mechanic, accounts | the person entering it |
| `entered_by_email` | who typed it in | automatically, from the login |
| `entered_at` | when it was typed in | automatically |

Nothing is deleted: there is **no delete permission** on any fleet table. A wrong
entry is removed with `active = false` and stays in the record.

## 3. Screens and the rules behind them

| Tab | What it does | Rule that drives alerts |
| --- | --- | --- |
| **Overview** | every alert grouped by kind; a card per vehicle | — |
| **Tyres** | *Board* (each bus seen from above), *Recommended pressure* per vehicle, *Enter readings* for the whole fleet in one sheet | unsafe ≤ −30% or ≥ +25% of spec; off-pressure beyond ±10%; left/right on one axle ≥ 15% of spec (min 10 psi) apart; check due (entry missing) after **15 days** — buses carrying children and spares only, not parked buses |
| **Daily km** | one odometer reading per bus each morning, the whole fleet in one sheet; **holidays** | after **5** normal days, a day > 115% of normal **and** > 5 km above it, or < 60% of normal **and** > 5 km below it (one-day gap only), needs a **reason**; a reading below the last is flagged; **missing** when a bus carrying children has no reading for a working day (Mon–Sat, not a holiday) after 11:00 |
| **Fuel** | litres, price, bill amount, odometer at fill | mileage measured tank to tank; after **3** measured fills, a fill more than **15%** from normal *in either direction* needs a reason; **missing** when the gap since the last fill passes twice the bus's usual gap (kept between 7 and 21 days; 10 days until it has three gaps) |
| **Service** | due point by distance and/or days, record a service, set intervals | overdue when past either limit; due soon within **1,000 km or 15 days**. Intervals: Cruiser and Eeco **10,000 km or 1 year**; Traveller built before 2024 **15,000 km or 1 year**; every other vehicle **20,000 km or 1 year** (`20261014000200_service_intervals.sql`) |
| **Checkup** | every part marked *Perfect*, *Able to run* or *Requires action*; the parts list is editable | any part at *Requires action* in the latest checkup |
| **Documents** | coverage grid of every vehicle × document type; licences against the person; file upload | expired, or expiring within **20 days** |
| **Bills** | every bill with a photo; whole-fleet bills and non-fleet vehicles allowed | — |
| **Staff** | drivers and conductors, tenures, moves, the printable **tenure report** | expired licence shows on the person |
| **Complaints** | raised by whom, against a driver, conductor, student or other | open complaints; severity rises after 7 days |
| **Vehicles** | registry including spares; route moves; spare usage | spare in use today (informational) |
| **Guide** | the upkeep-and-mileage reference that used to be the Maintenance page | — |

Every threshold lives in one SQL view (`tyre_status`, `odometer_daily`,
`fuel_efficiency`, `fuel_fill_rule`, `service_status`, `document_status`,
`checkup_status`), and `fleet_alerts` unions them. Tyre judgement is in three
functions (`tyre_dev`, `tyre_class`, `tyre_imbalanced`) shared by the live status and
the weekly history. The screens mirror the same thresholds to give live feedback
while typing, so **change a threshold in the view and in the screen together**.

### The dashboard's fleet week

The main Dashboard shows the fleet a week at a time (`frontend/js/fleet_week.js`,
SQL in `20261014000100_fleet_entry_compliance.sql`). Every alert carries a
`category`, and the two that matter day to day are kept apart because different
people fix them:

- **Data entry missing** (`entry_missing`): a reading that should exist does not —
  daily km, a tyre check, a fuel fill. The office chases whoever enters it.
- **Deviation found** (`deviation`): a reading exists but is far from normal —
  tyre pressure off spec, km far above or below normal, mileage off normal. The
  mechanic or driver acts, or a reason is recorded.
- Everything else (documents, service, checkups, complaints) is `other`.

The calendar behind "should exist": working days are Monday to Saturday minus
`fleet_off_days` (entered on **Daily km → Holidays**; switched off, never deleted);
a morning reading counts as missing only after 11:00 India time; only vehicles on a
route with active children (`fleet_vehicles_in_service`) are expected to log km and
fuel; and nothing before **25 Sep 2026**, the first day the Fleet tab existed
(`fleet_tracking_start()`), is ever "missing" — earlier weeks say *not tracked*.

`fleet_week_report(date)` returns one week's KPIs, the previous week's for the
week-on-week deltas, and both lists. `fleet_week_trend(n)` returns the last *n*
weeks for the trend charts. The tiles: average tyre pressure deviation (signed, with
the average distance from spec deciding *better* or *worse*) and buses off spec;
km readings entered against expected; fuel fills; and the two list counts. Tyre
figures are each bus's last reading of the week, against what are still mostly
**estimated** specs — the dashboard says so.

### Why these particular rules

- **Daily km baseline uses only consecutive days.** A Monday reading after an idle
  weekend is one reading covering three days; letting it into the baseline would
  make every normal day look short.
- **Fuel deviation alerts in both directions.** Worse mileage can mean a fault or
  a leak; *far better* mileage usually means a fill was never logged.
- **Tyre alerts say when the spec is estimated.** The initial recommended
  pressures were inferred from tyre size and model. An "unsafe" alert against an
  estimate may be a false alarm, so the alert text says so until a placard figure
  replaces it.
- **Names are not typed on the Bus page.** Replacing a driver there would rename
  the old person and erase their tenure. Who drives a bus is changed on
  **Fleet → Staff**, which ends one tenure and opens the next.

## 4. Tenure

`staff_assignments` holds one row per person per route per period. At most one
current driver and one current conductor per route, and one current route per
person — both enforced by unique indexes. Moving someone ends the previous holder's
tenure and their own the day before the new start.

Tenures loaded from the original staff sheet have `from_date = null`, meaning
*began before records were kept*. The tenure report counts everything logged on
the route in such a tenure.

`staff_tenure_report(staff_id)` returns, per tenure: days, kilometres logged,
extra-kilometre days without a reason, fuel litres and cost, average km/L, fuel
deviations, tyre checks, and complaints — plus the complaint list and the person's
documents. Figures are everything logged **for the route** during the tenure,
whoever entered them.

## 5. Where the fuel log meets the rest of the app

Every fuel and dead-run cost figure in TransportDesk divides by `buses.mileage`.
The **Fuel** tab shows each vehicle's logged mileage beside that figure. Once a
vehicle has a solid run of logged fills, and the two disagree materially, update
`buses.mileage` — and expect every saving estimate for that route to move with it.

Note that `buses.mileage` is still keyed by **route**, not vehicle. When a vehicle
changes route, its reference mileage does not follow it. That is a known gap.

## 6. Storage

Document scans and bill photos go to the private `fleet-documents` bucket (10 MB,
PDF and images). They are opened through short-lived signed links, never public URLs.

## 7. Testing

`tests/fleet/` drives the real Fleet modules against an in-memory stand-in for the
database, seeded with realistic data — including fuel and odometer history.

```bash
python -m http.server 8012
```

Open `http://localhost:8012/tests/fleet/` (or start **Fleet tests** from
`.claude/launch.json`). It renders all twelve tabs and exercises the save paths and
validation rules, plus the dashboard's fleet week — 94 checks. Run it after any change to a fleet screen.

It tests the screens, not the SQL. The views were checked separately by inserting
synthetic readings inside a transaction that rolled itself back.

## 8. Not done yet

- **Real placard pressures.** Every recommended pressure is still the estimate.
- **The school's own parts list.** A 23-part starter list is in place and editable.
- **Last service dates.** Intervals are set (see §3), but no vehicle has a dated
  service on record, so the one-year limit cannot trigger until one is entered.
- **Spare buses.** None registered yet — add them on **Vehicles** with *Spare* ticked.
- **Historical logs.** Fuel, kilometre and bill history from the old spreadsheets
  was *not* loaded: the samples supplied were partial and from 2024, and loading
  them would have produced misleading averages. A proper import is the next step if
  that history is wanted.
