// Fleet regression tests: an in-memory stand-in for the Supabase client.
// A stand-in for the Supabase client: the same query-builder surface the Fleet
// screens use, answered from in-memory rows shaped exactly like the real views.

const T = {};
const iso = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const V = [
  { id: 1, reg_no: 'TEST 0001', bus_id: 1, is_spare: false, make: 'Eicher', model_year: 2012, seats: 42, tyre_size: '8.25-16 LT', active: true, annual_maintenance_declared: 90000 },
  { id: 2, reg_no: 'TEST 0002', bus_id: 2, is_spare: false, make: 'Tata', model_year: 2017, seats: 36, tyre_size: '7.50-16 LT', active: true, annual_maintenance_declared: 45000 },
  { id: 3, reg_no: 'TEST 0003', bus_id: 3, is_spare: false, make: 'Tata', model_year: 2016, seats: 36, tyre_size: '7.50-16 LT', active: true },
  { id: 4, reg_no: 'TEST 0058', bus_id: 58, is_spare: false, make: 'Bharat Benz', model_year: 2020, seats: 36, tyre_size: '215/75 R17.5', active: true },
  { id: 5, reg_no: 'SPARE 0001', bus_id: null, is_spare: true, make: 'Tata', model_year: 2014, seats: 36, tyre_size: '7.50-16 LT', active: true },
  { id: 6, reg_no: 'SPARE 0002', bus_id: null, is_spare: true, make: 'Bharat Benz', model_year: 2019, seats: 36, active: true },
];
T.vehicles = V;
T.staff = [
  { id: 1, name: 'Driver One', role: 'driver', phone: '9000000001', monthly_salary: 14000, active: true, joined_on: null },
  { id: 2, name: 'Conductor One', role: 'conductor', phone: '9000000002', monthly_salary: 7500, active: true },
  { id: 3, name: 'Driver Two', role: 'driver', phone: '9000000003', monthly_salary: 11000, active: true },
  { id: 4, name: 'Driver Three', role: 'driver', monthly_salary: 13000, active: true },
  { id: 5, name: 'Relief Driver', role: 'driver', monthly_salary: 12000, active: true },
  { id: 6, name: 'Former Driver', role: 'driver', monthly_salary: 12500, active: false, left_on: iso(40) },
];
T.staff_assignments = [
  { id: 1, staff_id: 1, bus_id: 1, role: 'driver', from_date: null, to_date: null },
  { id: 2, staff_id: 2, bus_id: 1, role: 'conductor', from_date: null, to_date: null },
  { id: 3, staff_id: 3, bus_id: 2, role: 'driver', from_date: iso(200), to_date: null },
  { id: 4, staff_id: 4, bus_id: 3, role: 'driver', from_date: null, to_date: null },
  { id: 5, staff_id: 6, bus_id: 58, role: 'driver', from_date: iso(400), to_date: iso(41) },
];
const spec = { 1: [75, 75, 88, 88], 2: [70, 70, 85, 85], 3: [70, 70, 85, 85], 4: [85, 85, 92, 92], 5: [70, 70, 85, 85] };
T.tyre_specs = Object.entries(spec).map(([v, r]) => ({ vehicle_id: +v, rec_fl: r[0], rec_fr: r[1], rec_bl: r[2], rec_br: r[3], source: v === '1' ? 'placard' : 'inferred', provided_by: 'Estimated from tyre size' }));
const read = { 1: [60, 50, 50, 55, 28], 2: [70, 70, 84, 86, 3], 3: [60, 65, null, 50, 20], 4: [100, 110, null, null, 28] };
T.tyre_readings = Object.entries(read).map(([v, r], i) => ({ id: i + 1, vehicle_id: +v, bus_id: V[+v - 1].bus_id, fl: r[0], fr: r[1], bl: r[2], br: r[3], recorded_on: iso(r[4]), provided_by: 'Mechanic', entered_by_email: 'office@school.in', entered_at: new Date().toISOString(), active: true }));
T.tyre_status = V.map(v => {
  const r = T.tyre_readings.find(x => x.vehicle_id === v.id), s = T.tyre_specs.find(x => x.vehicle_id === v.id) || {};
  const dev = k => r && r[k] != null && s['rec_' + k] ? Math.round(1000 * (r[k] - s['rec_' + k]) / s['rec_' + k]) / 10 : null;
  const ds = ['fl', 'fr', 'bl', 'br'].map(dev).filter(x => x != null);
  const lo = ds.length ? Math.min(...ds) : null, hi = ds.length ? Math.max(...ds) : null;
  return { vehicle_id: v.id, reg_no: v.reg_no, bus_id: v.bus_id, is_spare: v.is_spare, reading_id: r?.id ?? null, recorded_on: r?.recorded_on ?? null,
    fl: r?.fl, fr: r?.fr, bl: r?.bl, br: r?.br, rec_fl: s.rec_fl, rec_fr: s.rec_fr, rec_bl: s.rec_bl, rec_br: s.rec_br, spec_source: s.source,
    days_since: r ? Math.round((Date.now() - new Date(r.recorded_on)) / 864e5) : null, worst_under_pct: lo, worst_over_pct: hi,
    imbalanced: v.id === 3, stale: !r || (Date.now() - new Date(r.recorded_on)) / 864e5 > 15,
    status: !r ? 'no_reading' : lo <= -30 || hi >= 25 ? 'unsafe' : lo <= -10 ? 'low' : hi >= 10 ? 'high' : 'ok' };
});
// ten days of odometer readings, with one extra-long day and one spare cover
T.odometer_daily = [];
let oid = 1;
[1, 2, 3].forEach(v => { let km = 80000 + v * 1000;
  for (let d = 12; d >= 1; d--) { const run = d === 2 && v === 1 ? 92 : 48 + (d % 3);
    const prev = km; km += run;
    T.odometer_daily.push({ id: oid++, vehicle_id: v, bus_id: V[v - 1].bus_id, reading_km: km, recorded_on: iso(d), km_run: d === 12 ? null : run,
      gap_days: d === 12 ? null : 1, avg_daily_km: d < 7 ? 49 : null, baseline_days: 12 - d, above_average: d === 2 && v === 1,
      extra_km: d === 2 && v === 1 ? 43 : null, reason: null, provided_by: 'Driver', entered_by_email: 'office@school.in', active: true }); } });
T.odometer_daily.push({ id: oid++, vehicle_id: 5, bus_id: 2, reading_km: 50000, recorded_on: iso(5), km_run: null, gap_days: null, reason: 'Covered bus 2 — breakdown', active: true });
T.odometer_daily.push({ id: oid++, vehicle_id: 5, bus_id: 2, reading_km: 50061, recorded_on: iso(4), km_run: 61, gap_days: 1, reason: 'Covered bus 2 — breakdown', active: true });
T.odometer_readings = T.odometer_daily;
T.fuel_efficiency = [];
[[1, 3.9], [2, 5.53]].forEach(([v, ref]) => { let odo = 80000;
  for (let i = 0; i < 6; i++) { const L = 40, k = i === 5 && v === 1 ? 3.1 : 4.8 + (i % 2) * 0.2; const prev = odo; odo += Math.round(L * k);
    T.fuel_efficiency.push({ id: v * 10 + i, vehicle_id: v, bus_id: v, recorded_on: iso(40 - i * 7), litres: L, price_per_litre: 95, cost: L * 95, cost_effective: L * 95,
      odo_at_fill: odo, km_since_fill: i ? odo - prev : null, kmpl: i ? Math.round(100 * (odo - prev) / L) / 100 : null, avg_kmpl_r: i > 1 ? 4.9 : null,
      deviation_pct: i === 5 && v === 1 ? -36.7 : i > 1 ? 1 : null, deviated: i === 5 && v === 1, reason: null, reference_kmpl: ref, station: 'Test Filling Station',
      provided_by: 'Driver', entered_by_email: 'office@school.in', active: true }); } });
T.fuel_logs = T.fuel_efficiency;
T.service_plans = V.map(v => ({ vehicle_id: v.id, interval_km: 20000, interval_days: v.id === 2 ? 180 : null, notes: 'From the service sheet' }));
T.service_events = [{ id: 1, vehicle_id: 1, recorded_on: null, odo_km: 67115, active: true, notes: 'Service date not recorded on the sheet.' },
  { id: 2, vehicle_id: 2, recorded_on: iso(170), odo_km: 81000, work_done: 'Oil & filter', cost: 4200, active: true }];
T.service_status = V.map(v => ({ vehicle_id: v.id, reg_no: v.reg_no, bus_id: v.bus_id, is_spare: v.is_spare, interval_km: 20000,
  interval_days: v.id === 2 ? 180 : null, last_odo: v.id === 1 ? 67115 : v.id === 2 ? 81000 : null, last_on: v.id === 2 ? iso(170) : null,
  current_odo: v.id <= 3 ? 81600 + v * 1000 : null, odo_on: iso(1), next_due_km: v.id === 1 ? 87115 : v.id === 2 ? 101000 : null,
  km_remaining: v.id === 1 ? 4515 : v.id === 2 ? 18400 : null, days_remaining: v.id === 2 ? 10 : null,
  status: v.id === 1 ? 'ok' : v.id === 2 ? 'due_soon' : v.id === 3 ? 'no_record' : 'no_odometer' }));
T.documents = [
  { id: 1, vehicle_id: 1, doc_type: 'PUC', expires_on: iso(54), active: true, provided_by: 'Bus documents sheet', entered_at: new Date().toISOString() },
  { id: 2, vehicle_id: 1, doc_type: 'Fitness', expires_on: iso(-55), active: true, file_path: 'vehicle/1/fit.pdf', file_name: 'fitness.pdf' },
  { id: 3, vehicle_id: 3, doc_type: 'Fitness', expires_on: iso(-12), active: true, doc_number: 'FT-99' },
  { id: 4, staff_id: 1, doc_type: 'Driving licence', expires_on: iso(-86), doc_number: 'DL-TEST-1', active: true }];
T.document_status = T.documents.map(d => { const days = Math.round((new Date(d.expires_on) - Date.now()) / 864e5);
  const s = T.staff.find(x => x.id === d.staff_id);
  return { ...d, reg_no: V.find(v => v.id === d.vehicle_id)?.reg_no, bus_id: V.find(v => v.id === d.vehicle_id)?.bus_id,
    staff_name: s?.name, staff_role: s?.role, days_left: days, status: days < 0 ? 'expired' : days <= 20 ? 'expiring' : 'ok' }; });
T.checkup_parts = [['Brakes', 'Safety', 10], ['Tyres & wheels', 'Safety', 20], ['Horn', 'Safety', 50], ['Engine oil', 'Engine', 200], ['Battery', 'Engine', 220], ['Seats', 'Body', 310]]
  .map(([n, c, o], i) => ({ id: i + 1, name: n, category: c, sort_order: o, active: true }));
T.checkups = [{ id: 1, vehicle_id: 1, recorded_on: iso(6), provided_by: 'Workshop', active: true, notes: 'Monthly check' }];
T.checkup_items = [{ checkup_id: 1, part_id: 1, status: 'requires_action', note: 'Pads worn' }, { checkup_id: 1, part_id: 2, status: 'able_to_run' },
  ...[3, 4, 5, 6].map(p => ({ checkup_id: 1, part_id: p, status: 'perfect' }))];
T.checkup_status = [{ checkup_id: 1, vehicle_id: 1, reg_no: V[0].reg_no, bus_id: 1, recorded_on: iso(6), n_perfect: 4, n_able: 1, n_action: 1, action_parts: 'Brakes', days_since: 6 }];
T.maintenance_bills = [
  { id: 1, vehicle_id: 1, recorded_on: iso(30), bill_no: '1413', party_name: 'Test Traders', amount: 14850, category: 'tyres', active: true },
  { id: 2, vehicle_id: null, recorded_on: iso(90), party_name: 'Test Painters', amount: 63000, category: 'body_paint', description: 'Paint for 18 buses', active: true },
  { id: 3, vehicle_id: null, vehicle_ref: 'OTHER 0550', recorded_on: iso(10), bill_no: 'GSJ24-01926', party_name: 'Test Auto Parts', amount: 7336, category: 'parts_oil', active: true, file_path: 'bills/x.pdf', file_name: 'bill.pdf' }];
T.complaints = [{ id: 1, recorded_on: iso(9), raised_by_name: 'A parent', raised_by_role: 'parent', against_type: 'driver', against_staff_id: 1, against_name: 'Driver One', bus_id: 1,
  category: 'Rash or unsafe driving', description: 'Drove fast near the school gate', status: 'open', active: true }];
T.vehicle_route_history = [{ id: 1, vehicle_id: 4, bus_id: 59, from_date: iso(60), to_date: iso(20), changed_by_email: 'office@school.in', changed_at: new Date().toISOString() },
  { id: 2, vehicle_id: 4, bus_id: 58, from_date: iso(20), to_date: null, changed_by_email: 'office@school.in', changed_at: new Date().toISOString() }];
T.fleet_alerts = [
  ...T.tyre_status.filter(t => t.status === 'unsafe').map(t => ({ kind: 'tyre_unsafe', subject: t.reg_no, detail: 'Tyre 43% under pressure (against an estimated spec - confirm the placard)', severity: 3, vehicle_id: t.vehicle_id, bus_id: t.bus_id })),
  ...T.tyre_status.filter(t => t.stale).map(t => ({ kind: 'tyre_check_due', subject: t.reg_no, detail: t.reading_id ? `last checked ${t.days_since} days ago` : 'no pressure reading recorded yet', severity: 1, vehicle_id: t.vehicle_id, bus_id: t.bus_id })),
  ...T.document_status.filter(d => d.status !== 'ok').map(d => ({ kind: d.status === 'expired' ? 'doc_expired' : 'doc_expiring', subject: d.reg_no || d.staff_name, detail: d.doc_type + ' expired', severity: d.status === 'expired' ? 3 : 2, vehicle_id: d.vehicle_id, bus_id: d.bus_id })),
  { kind: 'km_unexplained', subject: V[0].reg_no, detail: '92 km against a normal 49 km - reason needed', severity: 1, vehicle_id: 1, bus_id: 1 },
  { kind: 'fuel_deviation', subject: V[0].reg_no, detail: '3.1 km/L against a normal 4.9 (-36.7%) - reason needed', severity: 2, vehicle_id: 1, bus_id: 1 },
  { kind: 'service_due', subject: V[1].reg_no, detail: 'service due - 10 days left', severity: 1, vehicle_id: 2, bus_id: 2 },
  { kind: 'checkup_action', subject: V[0].reg_no, detail: '1 part require action: Brakes', severity: 2, vehicle_id: 1, bus_id: 1 },
  { kind: 'complaint_open', subject: 'Driver One', detail: 'raised by A parent: Drove fast near the school gate', severity: 2, vehicle_id: null, bus_id: 1 }];
T.vehicle_overview = V.map(v => { const a = T.fleet_alerts.filter(x => x.vehicle_id === v.id), ts = T.tyre_status.find(t => t.vehicle_id === v.id);
  return { vehicle_id: v.id, reg_no: v.reg_no, bus_id: v.bus_id, is_spare: v.is_spare, make: v.make, model_year: v.model_year, seats: v.seats,
    tyre_status: ts.status, tyre_checked_on: ts.recorded_on, tyre_stale: ts.stale, avg_daily_km: v.id <= 3 ? 49 : null,
    avg_kmpl: v.id <= 2 ? 4.9 : null, reference_kmpl: v.id === 1 ? 3.9 : v.id === 2 ? 5.53 : null,
    service_status: T.service_status.find(s => s.vehicle_id === v.id).status, km_remaining: T.service_status.find(s => s.vehicle_id === v.id).km_remaining,
    next_expiry: null, docs_attention: T.document_status.filter(d => d.vehicle_id === v.id && d.status !== 'ok').length,
    n_alerts: a.length, max_severity: a.length ? Math.max(...a.map(x => x.severity)) : 0 }; });
T.students = [{ sr_no: '5001', name: 'Test Student', bus_no: 1, active: true }];
T.students_round2 = [];

const EMBED = { staff: ['staff_id', 'staff'], checkup_parts: ['part_id', 'checkup_parts'], vehicles: ['vehicle_id', 'vehicles'] };
export const writes = [];

class Q {
  constructor(t) { this.t = t; this.f = []; this.o = []; this.lim = null; this.one = null; this.op = 'select'; this.sel = '*'; }
  select(s) { if (this.op === 'select') this.sel = s || '*'; this.ret = true; return this; }
  eq(c, v) { this.f.push(r => r[c] == v); return this; }
  neq(c, v) { this.f.push(r => r[c] != v); return this; }
  gte(c, v) { this.f.push(r => r[c] != null && r[c] >= v); return this; }
  lte(c, v) { this.f.push(r => r[c] != null && r[c] <= v); return this; }
  in(c, vs) { this.f.push(r => vs.includes(r[c])); return this; }
  is(c, v) { this.f.push(r => v === null ? r[c] == null : r[c] === v); return this; }
  not(c, op, v) { this.f.push(r => v === null ? r[c] != null : r[c] !== v); return this; }
  or() { return this; }
  order(c, o = {}) { this.o.push([c, o.ascending !== false]); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.lim = b - a + 1; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  insert(r) { this.op = 'insert'; this.payload = r; return this; }
  update(r) { this.op = 'update'; this.payload = r; return this; }
  upsert(r) { this.op = 'upsert'; this.payload = r; return this; }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
  run() {
    if (this.op !== 'select') {
      writes.push({ table: this.t, op: this.op, payload: this.payload });
      const rows = [].concat(this.payload).map((r, i) => ({ id: 900 + writes.length + i, ...r }));
      return { data: this.one ? rows[0] : rows, error: null };
    }
    if (!(this.t in T)) return { data: null, error: { message: `harness: no fixture for ${this.t}` } };
    let rows = T[this.t].filter(r => this.f.every(f => f(r)));
    for (const [c, asc] of this.o.slice().reverse()) rows = rows.slice().sort((a, b) => ((a[c] ?? '') > (b[c] ?? '') ? 1 : (a[c] ?? '') < (b[c] ?? '') ? -1 : 0) * (asc ? 1 : -1));
    for (const m of (this.sel.match(/([a-z_]+)\(/g) || [])) { const rel = m.slice(0, -1), [fk, tbl] = EMBED[rel] || [];
      if (fk) rows = rows.map(r => ({ ...r, [rel]: (T[tbl] || []).find(x => x.id === r[fk]) || null })); }
    if (this.lim != null) rows = rows.slice(0, this.lim);
    if (this.one) return { data: rows[0] ?? null, error: this.one === 'single' && !rows.length ? { message: 'no rows' } : null };
    return { data: rows, error: null };
  }
}
export const fakeDb = {
  from: t => new Q(t),
  rpc: (name, args) => Promise.resolve(name === 'staff_tenure_report' ? { data: {
    staff: T.staff.find(s => s.id === args.p_staff), documents: [{ doc_type: 'Driving licence', doc_number: 'DL-TEST-1', expires_on: iso(-86), status: 'expired' }],
    complaints: [{ recorded_on: iso(9), raised_by: 'A parent', role: 'parent', category: 'Rash or unsafe driving', description: 'Drove fast near the school gate', status: 'open' }],
    tenures: [{ bus_id: 1, role: 'driver', from_date: null, to_date: null, days: null, km_run: 580, days_logged: 11, unexplained_extra_days: 1,
      fuel_litres: 240, fuel_cost: 22800, avg_kmpl: 4.71, fuel_deviations: 1, tyre_checks: 1, complaints: 1, complaints_open: 1 }] }, error: null }
    : { data: null, error: { message: 'unknown rpc ' + name } }),
  storage: { from: () => ({ upload: async p => ({ data: { path: p }, error: null }), createSignedUrl: async () => ({ data: { signedUrl: 'about:blank' }, error: null }) }) },
};
