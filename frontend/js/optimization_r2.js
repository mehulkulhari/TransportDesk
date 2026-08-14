// Round-2 optimization. Round 2 is a separate run with its own geometry, so none of the
// Round-1 snapshot tables apply here and showing them under Round 2 would be plain wrong.
//
// Two things differ from Round 1 by design:
//
//  * NO start-point / depot section. Round-2 buses are already at school when the round
//    begins and return to school at the end, on both the arrival and the departure run, so
//    there is no depot leg to optimise.
//
//  * NO ride-time figures. bus_route_geo.est_min is observed Round-1 GPS telemetry; fitted
//    as est_min ~ a*road_km + b*stop_count across all 59 routes it scores R^2 = -0.33
//    (mean error 29 min), i.e. worse than predicting the average. It does not transfer to a
//    different route, so Round 2 is reported in distance and rupees only.

import { db } from "./supabase.js";
import { $, esc } from "./utils.js";

const money = n => '₹' + Math.round(Number(n)||0).toLocaleString('en-IN');

export async function renderOptimizationR2(){
  $('optBody').innerHTML = '<div class="hint">Loading Round 2 analysis…</div>';
  const [{data:route},{data:moves}] = await Promise.all([
    db.from('r2_route').select('*').order('road_km',{ascending:false}),
    db.from('opt_r2_move').select('*').order('save_rs',{ascending:false})]);
  const rt = route||[], mv = moves||[];

  const children = rt.reduce((a,r)=>a+(r.children||0),0);
  const fleetKm  = rt.reduce((a,r)=>a+Number(r.road_km||0),0);
  const fuel     = rt.reduce((a,r)=>a+Number(r.annual_fuel||0),0);
  const saving   = mv.reduce((a,m)=>a+Number(m.save_rs||0),0);
  const over     = rt.filter(r=>r.capacity && r.children>r.capacity);

  const kpi=(v,l,sub)=>`<div class="stat"><b>${v}</b><span>${l}</span>${sub?`<div class="note" style="font-size:11px;margin-top:4px">${sub}</div>`:''}</div>`;

  const moveRows = mv.map(m=>`<tr>
      <td>${esc(m.student_name)}</td>
      <td class="mono">${esc(m.sr_no)}</td>
      <td>${esc(m.klass||'')}${m.section?'-'+esc(m.section):''}</td>
      <td>Bus ${m.own_bus} → <b>Bus ${m.dest_bus}</b></td>
      <td>${Number(m.own_ride_km).toFixed(2)} → <b style="color:var(--ok)">${Number(m.dest_ride_km).toFixed(2)} km</b></td>
      <td>${Number(m.costs_own_km).toFixed(2)} km</td>
      <td>${Number(m.adds_new_km).toFixed(2)} km</td>
      <td><b>${Number(m.net_km).toFixed(2)} km</b></td>
      <td><b>${money(m.save_rs)}/yr</b></td>
      <td>${m.seats_left}</td>
      <td><a href="?view=map&srs=${encodeURIComponent(m.sr_no)}&dest=${m.dest_bus}" target="_blank" rel="noopener">Map ↗</a></td>
    </tr>`).join('');

  const routeRows = rt.map(r=>{
    const bad = r.capacity && r.children>r.capacity;
    return `<tr>
      <td><b>${r.bus_id}</b></td>
      <td style="${bad?'color:var(--stop);font-weight:600':''}">${r.children}${r.capacity?' / '+r.capacity:''}${bad?` (${r.children-r.capacity} over)`:''}</td>
      <td>${Number(r.road_km).toFixed(2)} km</td>
      <td>${Number(r.straight_km).toFixed(2)} km</td>
      <td>${Number(r.factor).toFixed(3)}×</td>
      <td>${r.annual_fuel?money(r.annual_fuel)+'/yr':'—'}</td>
      <td><a href="?view=map&order=${r.bus_id}" target="_blank" rel="noopener">Order on map ↗</a></td>
    </tr>`;}).join('');

  $('optBody').innerHTML = `
    <h2 style="margin:0 0 4px">Route Optimization — Round 2</h2>
    <div class="note" style="margin-bottom:12px">
      Round 2 carries the small children (PG · Nursery · LKG · UKG · 1st). These buses
      <b>start from school and return to school</b> on both the arrival and the departure run,
      so there is no start-point to optimise — the whole route is a closed loop and the only
      levers are the order of stops and which bus each child rides.
    </div>

    <div class="optsum" style="background:var(--ink);color:#fff;border-radius:var(--r-l);padding:18px 22px;margin-bottom:16px;display:flex;gap:26px;flex-wrap:wrap;align-items:center">
      <div><div style="font-size:26px;font-weight:800;color:var(--signal);line-height:1.1">${money(saving)}</div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.75">Verified saving / year</div>
        <div class="note" style="color:#9fb0c0;font-size:11px;margin-top:3px">of the ${money(fuel)} Round-2 diesel bill</div></div>
      <div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap">
        <span style="background:#2a3f53;border-radius:999px;padding:7px 14px;font-size:12.5px">👶 ${children} children</span>
        <span style="background:#2a3f53;border-radius:999px;padding:7px 14px;font-size:12.5px">🚌 ${rt.length} buses</span>
        <span style="background:#2a3f53;border-radius:999px;padding:7px 14px;font-size:12.5px">🛣️ ${fleetKm.toFixed(0)} km / trip</span>
      </div>
    </div>

    <div class="cards" style="margin-bottom:18px">
      ${kpi(money(fuel),'Round 2 annual fuel','road km × 2 trips × 200 days × ₹100/L ÷ each bus mileage')}
      ${kpi(fleetKm.toFixed(0)+' km','Fleet round trip','school → children → school, all 25 buses')}
      ${kpi(mv.length,'Children on the wrong bus',mv.length?'each move also shortens that child ride':'none worth moving')}
      ${kpi(over.length,'Buses over seats',over.length?over.map(o=>'Bus '+o.bus_id+' +'+(o.children-o.capacity)).join(', '):'all within seats')}
    </div>

    ${over.length?`
    <h3 style="margin:0 0 6px;font-size:15px">🚨 Over the seat count</h3>
    <div class="note" style="margin-bottom:8px">Counted against <b>nominal</b> seats, with no over-capacity allowance. These children need a seat on another Round-2 bus.</div>
    <div style="background:var(--panel);border:1px solid var(--edge);border-radius:8px;overflow:auto;margin-bottom:20px">
      <table><thead><tr><th>Bus</th><th>Children</th><th>Seats</th><th>Over by</th></tr></thead><tbody>
      ${over.map(o=>`<tr><td><b>${o.bus_id}</b></td><td>${o.children}</td><td>${o.capacity}</td><td style="color:var(--stop);font-weight:600">${o.children-o.capacity}</td></tr>`).join('')}
      </tbody></table></div>`:''}

    <h3 style="margin:0 0 6px;font-size:15px">👶 Children who would be better on another bus</h3>
    <div class="note" style="margin-bottom:8px">
      A child is only listed when the move is a <b>real geometric win</b> (net km &gt; 0 after the
      receiving bus detour), is worth more than ₹3,000/yr, the receiving bus has a nominal seat
      free, <b>and the child own along-route ride to school gets shorter</b>. That last test matters
      most here: these are four- and five-year-olds, so a move that saved diesel by putting a
      child on a longer ride is rejected however much it saved.
    </div>
    ${mv.length?`<div style="background:var(--panel);border:1px solid var(--edge);border-radius:8px;overflow:auto;margin-bottom:20px">
      <table><thead><tr><th>Child</th><th>SR</th><th>Class</th><th>Move</th><th>Their ride</th><th>Costs own bus</th><th>Adds to new bus</th><th>Net</th><th>Saving</th><th>Seats left</th><th></th></tr></thead>
      <tbody>${moveRows}</tbody></table></div>`
      :'<div class="note" style="margin-bottom:20px">No child passes all four tests — the Round-2 assignments are geometrically sound.</div>'}

    <h3 style="margin:0 0 6px;font-size:15px">🛣️ Every Round-2 route</h3>
    <div class="note" style="margin-bottom:8px">
      The order of each loop is solved with 2-opt from school and back. Road km is straight-line
      km scaled by that bus own measured road factor from its Round-1 route. <b>No minute figure
      is given</b>: the Round-1 GPS times do not carry over to a different route, and an invented
      one would be worse than none.
    </div>
    <div style="background:var(--panel);border:1px solid var(--edge);border-radius:8px;overflow:auto">
      <table><thead><tr><th>Bus</th><th>Children / seats</th><th>Road km</th><th>Straight km</th><th>Road factor</th><th>Annual fuel</th><th></th></tr></thead>
      <tbody>${routeRows}</tbody></table></div>

    <div class="note" style="margin-top:14px">
      Round-1 figures — re-sequencing, vehicle swaps, depot swaps, per-student fuel shares — are
      a separate analysis on a separate set of students. Switch to Round 1 in the header to see them.
    </div>`;
}

Object.assign(globalThis, { renderOptimizationR2 });
