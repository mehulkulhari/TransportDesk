// Round-2 optimization. Round 2 is a separate run with its own geometry, so none of the
// Round-1 snapshot tables apply here and showing them under Round 2 would be plain wrong.
//
// Everything on this page is measured on real roads by Google Directions over the
// school -> children -> school loop. Two things still differ from Round 1 by design:
//
//  * NO start-point / depot section. Round-2 buses are already at school when the round
//    begins and return to school at the end, on both the arrival and the departure run, so
//    there is no depot leg to optimise.
//
//  * Times shown are Google DRIVING times and exclude the time the bus stands at each stop.
//    The Round-1 est_min telemetry does not transfer to a different route (fitted as
//    est_min ~ a*road_km + b*stop_count over all 59 routes it scores R^2 = -0.33), so no
//    door-to-door Round-2 ride time is claimed.

import { db } from "./supabase.js";
import { $, esc } from "./utils.js";

const money = n => '₹' + Math.round(Number(n)||0).toLocaleString('en-IN');
const km = n => Number(n).toFixed(2) + ' km';

export async function renderOptimizationR2(){
  $('optBody').innerHTML = '<div class="hint">Loading Round 2 analysis…</div>';
  const [{data:route},{data:geo},{data:moves}] = await Promise.all([
    db.from('r2_route').select('*'),
    db.from('r2_route_geo').select('*').order('road_km',{ascending:false}),
    db.from('opt_r2_move').select('*').order('save_rs',{ascending:false})]);
  const rt = route||[], gj = geo||[], mv = moves||[];
  const rBy = {}; rt.forEach(r=>rBy[r.bus_id]=r);

  const children = rt.reduce((a,r)=>a+(r.children||0),0);
  const fleetKm  = gj.reduce((a,r)=>a+Number(r.road_km||0),0);
  const fuel     = rt.reduce((a,r)=>a+Number(r.annual_fuel||0),0);
  const reorder  = gj.reduce((a,r)=>a+Number(r.reorder_saving_rs||0),0);
  const reorderKm= gj.reduce((a,r)=>a+Math.max(0,Number(r.seq_km||0)-Number(r.road_km||0)),0);
  const moveRs   = mv.reduce((a,m)=>a+Number(m.save_rs||0),0);
  const total    = reorder + moveRs;
  const over     = rt.filter(r=>r.capacity && r.children>r.capacity).sort((a,b)=>(b.children-b.capacity)-(a.children-a.capacity));
  const redone   = gj.filter(r=>r.reordered).sort((a,b)=>Number(b.reorder_saving_rs)-Number(a.reorder_saving_rs));

  const kpi=(v,l,sub)=>`<div class="stat"><b>${v}</b><span>${l}</span>${sub?`<div class="note" style="font-size:11px;margin-top:4px">${sub}</div>`:''}</div>`;

  $('optBody').innerHTML = `
    <h2 style="margin:0 0 4px">Route Optimization — Round 2</h2>
    <div class="note" style="margin-bottom:12px">
      Round 2 carries the small children (PG · Nursery · LKG · UKG · 1st). These buses
      <b>start from school and return to school</b> on both the arrival and the departure run,
      so there is no start-point to optimise. Every distance below is <b>measured on real roads
      by Google Directions</b>, not estimated from straight lines.
    </div>

    <div style="background:var(--ink);color:#fff;border-radius:var(--r-l);padding:18px 22px;margin-bottom:16px;display:flex;gap:26px;flex-wrap:wrap;align-items:center">
      <div><div style="font-size:26px;font-weight:800;color:var(--signal);line-height:1.1">${money(total)}</div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.75">Verified saving / year</div>
        <div class="note" style="color:#9fb0c0;font-size:11px;margin-top:3px">of the ${money(fuel)} Round-2 diesel bill</div></div>
      <div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap">
        <span style="background:#2a3f53;border-radius:999px;padding:7px 14px;font-size:12.5px">🔀 Re-order ${money(reorder)}</span>
        <span style="background:#2a3f53;border-radius:999px;padding:7px 14px;font-size:12.5px">👶 Wrong bus ${money(moveRs)}</span>
        <span style="background:#2a3f53;border-radius:999px;padding:7px 14px;font-size:12.5px">🛣️ ${fleetKm.toFixed(0)} km / trip</span>
      </div>
    </div>

    <div class="cards" style="margin-bottom:18px">
      ${kpi(money(fuel),'Round 2 annual fuel','real road km × 2 trips × 200 days × ₹100/L ÷ each bus mileage')}
      ${kpi(children,'Children','across '+rt.length+' buses')}
      ${kpi(redone.length,'Routes re-ordered',reorderKm.toFixed(1)+' km/trip cut by driving the same children in a better order')}
      ${kpi(over.length,'Buses over seats',over.length?over.map(o=>'Bus '+o.bus_id+' +'+(o.children-o.capacity)).join(', '):'all within seats')}
    </div>

    ${redone.length?`
    <h3 style="margin:0 0 6px;font-size:15px">🔀 Re-order the stops — the biggest Round-2 win</h3>
    <div class="note" style="margin-bottom:8px">
      <b>No child changes bus.</b> These ${redone.length} routes carry exactly the same children,
      just visited in a better order. The old order was solved on straight-line distance; solving
      it on the real road network instead cuts <b>${reorderKm.toFixed(1)} km every trip</b>.
      The new order is already saved — open a bus in Pickup order or Bus page to hand it to the driver.
    </div>
    <div style="background:var(--panel);border:1px solid var(--edge);border-radius:8px;overflow:auto;margin-bottom:20px">
      <table><thead><tr><th>Bus</th><th>Children</th><th>Stops</th><th>Was</th><th>Now</th><th>Saved / trip</th><th>Saving / yr</th><th></th></tr></thead><tbody>
      ${redone.map(r=>`<tr>
        <td><b>${r.bus_id}</b></td>
        <td>${r.stops}</td>
        <td>${r.uniq_stops}${r.stops>r.uniq_stops?` <span class="note">(${r.stops-r.uniq_stops} share an address)</span>`:''}</td>
        <td>${km(r.seq_km)}</td>
        <td><b style="color:var(--ok)">${km(r.road_km)}</b></td>
        <td>${km(Number(r.seq_km)-Number(r.road_km))}</td>
        <td><b>${money(r.reorder_saving_rs)}</b></td>
        <td><a href="?view=map&order=${r.bus_id}" target="_blank" rel="noopener">Order on map ↗</a></td></tr>`).join('')}
      </tbody></table></div>`:''}

    ${over.length?`
    <h3 style="margin:0 0 6px;font-size:15px">🚨 Over the seat count</h3>
    <div class="note" style="margin-bottom:8px">Counted against <b>nominal</b> seats, with no over-capacity allowance.</div>
    <div style="background:var(--panel);border:1px solid var(--edge);border-radius:8px;overflow:auto;margin-bottom:20px">
      <table><thead><tr><th>Bus</th><th>Children</th><th>Seats</th><th>Over by</th></tr></thead><tbody>
      ${over.map(o=>`<tr><td><b>${o.bus_id}</b></td><td>${o.children}</td><td>${o.capacity}</td><td style="color:var(--stop);font-weight:600">${o.children-o.capacity}</td></tr>`).join('')}
      </tbody></table></div>`:''}

    <h3 style="margin:0 0 6px;font-size:15px">👶 Children who would be better on another bus</h3>
    <div class="note" style="margin-bottom:8px">
      Each of these was re-measured on real roads: the donor loop re-solved <i>without</i> the child
      and the receiving loop re-solved <i>with</i> them. A move only survives if it is a real
      geometric win, is worth over ₹3,000/yr, the receiving bus has a nominal seat free,
      <b>and the child's own ride to school gets shorter</b> — these are four- and five-year-olds,
      so a move that saved diesel by lengthening a child's ride is rejected however much it saved.
    </div>
    ${mv.length?`<div style="background:var(--panel);border:1px solid var(--edge);border-radius:8px;overflow:auto;margin-bottom:8px">
      <table><thead><tr><th>Child</th><th>SR</th><th>Class</th><th>Move</th><th>Frees on own bus</th><th>Adds to new bus</th><th>Net</th><th>Saving / yr</th><th>Seats left</th><th></th></tr></thead>
      <tbody>${mv.map(m=>`<tr>
        <td>${esc(m.student_name)}</td>
        <td class="mono">${esc(m.sr_no)}</td>
        <td>${esc(m.klass||'')}${m.section?'-'+esc(m.section):''}</td>
        <td>Bus ${m.own_bus} → <b>Bus ${m.dest_bus}</b></td>
        <td>${km(m.costs_own_km)}</td>
        <td>${km(m.adds_new_km)}</td>
        <td><b>${km(m.net_km)}</b></td>
        <td><b>${money(m.save_rs)}</b></td>
        <td>${m.seats_left}</td>
        <td><a href="?view=map&srs=${encodeURIComponent(m.sr_no)}&dest=${m.dest_bus}" target="_blank" rel="noopener">Map ↗</a></td>
      </tr>`).join('')}</tbody></table></div>
      <div class="note" style="margin-bottom:20px">
        A third candidate was dropped here: straight-line geometry said moving <b>Aatif Khan</b> from
        bus 19 to bus 11 saved ₹9,801/yr, because bus 11 passes close to him as the crow flies. On the
        real road network that diversion costs 2.85 km and the move <b>loses ₹4,293/yr</b>. It is not listed.
      </div>`
      :'<div class="note" style="margin-bottom:20px">No child passes all four tests.</div>'}

    <h3 style="margin:0 0 6px;font-size:15px">🛣️ Every Round-2 route</h3>
    <div class="note" style="margin-bottom:8px">
      Road km and shape come from Google Directions. <b>Road factor</b> is now measured
      (real road km ÷ straight-line km) rather than borrowed from the Round-1 route — it runs from
      1.18 to 2.24 across these buses, which is why the earlier straight-line estimate was 21% low.
      Minutes are Google <b>driving</b> time and <b>exclude</b> the time spent stopped at each stop.
    </div>
    <div style="background:var(--panel);border:1px solid var(--edge);border-radius:8px;overflow:auto">
      <table><thead><tr><th>Bus</th><th>Children / seats</th><th>Road km</th><th>Driving</th><th>Stops</th><th>Road factor</th><th>Annual fuel</th><th></th></tr></thead>
      <tbody>${gj.map(g=>{const r=rBy[g.bus_id]||{};
        const bad=r.capacity&&r.children>r.capacity;
        return `<tr>
          <td><b>${g.bus_id}</b></td>
          <td style="${bad?'color:var(--stop);font-weight:600':''}">${r.children??g.stops}${r.capacity?' / '+r.capacity:''}${bad?` (${r.children-r.capacity} over)`:''}</td>
          <td>${km(g.road_km)}</td>
          <td>${g.drive_min} min</td>
          <td>${g.uniq_stops}</td>
          <td>${r.factor?Number(r.factor).toFixed(3)+'×':'—'}</td>
          <td>${r.annual_fuel?money(r.annual_fuel):'—'}</td>
          <td><a href="?view=map&order=${g.bus_id}" target="_blank" rel="noopener">Order on map ↗</a></td>
        </tr>`;}).join('')}
      </tbody></table></div>

    <div class="note" style="margin-top:14px">
      Round-1 figures — re-sequencing, vehicle swaps, depot swaps, per-student fuel shares — are
      a separate analysis on a separate set of students. Switch to Round 1 in the header to see them.
    </div>`;
}

Object.assign(globalThis, { renderOptimizationR2 });
