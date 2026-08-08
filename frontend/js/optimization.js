// Optimization analysis engine - reads precomputed snapshot tables
// and provides an interactive simulator for testing route changes

export async function renderOptimization(){
  $('optBody').innerHTML=`<h2 style="margin:0 0 4px">Route Optimization Analysis</h2>
    <div class="note" style="margin-bottom:12px">Live analysis identifying students on wrong buses, stretched routes, and consolidation opportunities. All numbers are based on real road distances and your current parameters (₹100/L diesel, 200 working days, 2 trips/day, 1.6× road factor).</div>
    <div id="optError"></div>
    <div id="optContent" style="display:none">
      <div id="optCards" class="cards" style="margin-bottom:14px"></div>
      <div id="optTables" style="margin-bottom:20px"></div>
      <div style="border-top:1px solid var(--edge);padding-top:16px">
        <h3 style="margin:0 0 10px;font-size:15px">What-if simulator</h3>
        <div class="note" style="margin-bottom:8px">Test moving students to different buses. Enter moves as <span class="mono">SR BUS</span> (e.g., <span class="mono">4807 44</span>), one per line. Hit Simulate to see the exact impact: cost savings, distance change, and whether the receiving bus exceeds capacity.</div>
        <div style="display:grid;grid-template-columns:1fr 120px;gap:8px;margin-bottom:10px">
          <textarea id="simInput" placeholder="4807 44&#10;4808 44" style="font-family:var(--font-mono);font-size:13px;padding:8px;border:1px solid var(--edge);border-radius:4px;min-height:80px;resize:vertical"></textarea>
          <div style="display:flex;flex-direction:column;gap:6px">
            <button class="b-primary" id="simBtn" style="flex:1">Simulate</button>
            <button class="b-ghost" id="simFill">Fill from wrong-bus list</button>
          </div>
        </div>
        <div id="simOut" style="min-height:40px"></div>
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--edge);color:#666;font-size:13px">
        <button class="b-ghost" id="optRecalc" style="font-size:13px">Recalculate analysis</button>
        <span id="optStamp" style="margin-left:12px"></span>
      </div>
    </div>`;

  const errDiv = $('optError');
  const contentDiv = $('optContent');

  try {
    await loadOptimizationData();
    errDiv.innerHTML = '';
    contentDiv.style.display = '';

    $('simBtn').onclick = () => simulateChanges();
    $('simFill').onclick = () => fillFromWrongBusList();
    $('optRecalc').onclick = async () => {
      $('optRecalc').disabled = true;
      await db.rpc('refresh_optimization');
      await loadOptimizationData();
      $('optRecalc').disabled = false;
      toast('Optimization data refreshed', 'good');
    };
  } catch(e) {
    contentDiv.style.display = 'none';
    errDiv.innerHTML = `<div class="note" style="color:#b42318">
      <strong>Could not load optimization data</strong><br>
      ${esc(e.message)}<br>
      <button class="b-ghost" onclick="renderOptimization()" style="margin-top:8px;font-size:13px">Retry</button>
    </div>`;
  }
}

async function loadOptimizationData(){
  const [master, misassigned, stretched, backtrackers, merges, fuelSummary, meta] = await Promise.all([
    db.from('opt_master').select('*').single(),
    db.from('opt_misassigned').select('*'),
    db.from('opt_route_split').select('*'),
    db.from('opt_backtrackers').select('*'),
    db.from('opt_merge').select('*'),
    db.from('report_fuel_summary').select('total_annual_fuel').single(),
    db.from('opt_meta').select('refreshed_at').single()
  ]);

  if(master.error) throw new Error('Optimization data not yet calculated. Hit "Recalculate" to run the analysis.');

  const m = master.data;
  const cardHtml = `
    ${statCard('Wrong-bus students', m.misassigned_students, `₹${Math.round(m.misassign_fuel).toLocaleString('en-IN')}/yr`)}
    ${statCard('Stretched routes', m.stretched_buses, `₹${Math.round(m.route_split_fuel_gross).toLocaleString('en-IN')}/yr`)}
    ${statCard('Backtracker outliers', m.backtracker_students, 'diagnostic')}
    ${statCard('Retirable buses', m.retirable_buses, `₹${Math.round(m.merge_fuel).toLocaleString('en-IN')}/yr`)}
    ${statCard('Fleet utilisation', m.fleet_utilisation_pct+'%', m.buses_running+' buses')}
    ${statCard('Annual fuel spend', rupee(fuelSummary.data?.total_annual_fuel || 0))}
  `;
  $('optCards').innerHTML = cardHtml;

  const tablesHtml = `
    <h3 style="margin:12px 0 6px;font-size:15px">Students on the wrong bus (${misassigned.data?.length||0})</h3>
    <div class="note" style="margin-bottom:6px">These children are on a bus that takes a longer route than another bus with a free seat, which passes within ~1.5 km of them and is ≥2 km closer to school.</div>
    ${renderOptTable([
      {k:'sr_no',label:'SR'},{k:'student_name',label:'Name'},{k:'own_bus',label:'Current bus'},
      {k:'near_bus',label:'Better bus'},{k:'own_detour_m',label:'Current detour (m)',fmt:v=>Math.round(Number(v))},
      {k:'near_insert_m',label:'Better detour (m)',fmt:v=>Math.round(Number(v))},
      {k:'annual_fuel_saving',label:'Save/yr',fmt:rupee}
    ], misassigned.data||[], 'wrong_bus')}

    <h3 style="margin:16px 0 6px;font-size:15px">Stretched routes (${stretched.data?.length||0})</h3>
    <div class="note" style="margin-bottom:6px">Buses that drag a group of students on the opposite side from school. Moving just the outliers to their nearest bus could save significant fuel, though students would have longer rides.</div>
    ${renderOptTable([
      {k:'bus_id',label:'Bus'},{k:'outlier_students',label:'Riders'},{k:'route_km_now',label:'Route km',fmt:v=>Number(v).toFixed(1)},
      {k:'outlier_students',label:'Outliers'},{k:'km_saved_per_trip',label:'Shrink/trip (km)',fmt:v=>Number(v).toFixed(1)},
      {k:'annual_fuel_if_split',label:'Savings if moved',fmt:rupee}
    ], stretched.data||[], 'stretched_routes')}

    <h3 style="margin:16px 0 6px;font-size:15px">Backtracker students (${backtrackers.data?.length||0})</h3>
    <div class="note" style="margin-bottom:6px">Students whose bus drives away from school to reach them (i.e., they're on the opposite side). This is a diagnostic list; high counts can indicate geographic clustering.</div>
    ${renderOptTable([
      {k:'sr_no',label:'SR'},{k:'student_name',label:'Name'},{k:'bus_id',label:'Bus'},
      {k:'km_from_cluster',label:'Dist from cluster (km)',fmt:v=>Number(v).toFixed(1)},{k:'km_to_school',label:'To school (km)',fmt:v=>Number(v).toFixed(1)},
      {k:'annual_backtrack_fuel',label:'Annual fuel',fmt:rupee}
    ], backtrackers.data?.slice(0,100)||[], 'backtrackers')}

    <h3 style="margin:16px 0 6px;font-size:15px">Consolidation candidates (${merges.data?.length||0})</h3>
    <div class="note" style="margin-bottom:6px">Bus pairs where one could absorb the other's route, reducing fleet size and annual costs.</div>
    ${renderOptTable([
      {k:'bus_a',label:'Bus A'},{k:'bus_b',label:'Merge to'},{k:'riders_a',label:'A riders'},
      {k:'riders_b',label:'B riders'},{k:'combined',label:'Combined'},
      {k:'best_capacity',label:'Capacity'},{k:'potential_annual_saving',label:'Save/yr',fmt:rupee}
    ], merges.data||[], 'consolidation')}
  `;
  $('optTables').innerHTML = tablesHtml;

  const stamp = meta.data?.refreshed_at ? new Date(meta.data.refreshed_at).toLocaleString() : 'Unknown';
  $('optStamp').innerHTML = `Calculated: ${esc(stamp)}`;
}

function renderOptTable(cols, rows, title){
  if(!rows.length) return `<div class="note">No data yet.</div>`;
  const html = `<table data-title="${esc(title)}" style="width:100%;border-collapse:collapse">
    <tr style="background:#f5f5f5;font-weight:500;font-size:13px">
      ${cols.map(c=>`<td style="padding:8px;text-align:left;border-bottom:1px solid var(--edge)">${esc(c.label)}</td>`).join('')}
    </tr>
    ${rows.slice(0,50).map(row=>`<tr style="font-size:13px;border-bottom:1px solid var(--edge)">
      ${cols.map(c=>`<td style="padding:8px;text-align:left">${esc(c.fmt ? c.fmt(row[c.k]) : row[c.k])}</td>`).join('')}
    </tr>`).join('')}
  </table>`;
  return html + `<button class="b-ghost" style="margin-top:6px;font-size:12px" onclick="downloadOptCsv(event)" data-t="${esc(title)}">Download CSV</button>
    <div style="margin-bottom:14px"></div>`;
}

export function downloadOptCsv(evt){
  const btn = evt.target;
  const tbl = btn.closest('div').querySelector(`table[data-title="${btn.dataset.t}"]`);
  if(!tbl) return;
  const rows = [...tbl.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>`"${td.textContent.replace(/"/g,'""')}"`).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.join('\n')], {type:'text/csv'}));
  a.download = btn.dataset.t + '.csv';
  a.click();
}

function fillFromWrongBusList(){
  const wrongBusRows = [...($('optTables').querySelectorAll('table[data-title="wrong_bus"] tr') || [])].slice(1);
  const moves = wrongBusRows.map(row=>{
    const cells = [...row.children];
    const sr = cells[0]?.textContent.trim();
    const bus = cells[3]?.textContent.trim();
    return sr && bus ? `${sr} ${bus}` : '';
  }).filter(Boolean);
  $('simInput').value = moves.join('\n');
}

async function simulateChanges(){
  const input = $('simInput').value.trim();
  if(!input) {
    toast('Enter moves in the format: SR BUS (e.g., 4807 44)', 'bad');
    return;
  }

  const moves = input.split('\n')
    .map(line=>line.trim())
    .filter(Boolean)
    .map(line=>{
      const [sr, bus] = line.split(/\s+/);
      return {sr: parseInt(sr,10), bus: parseInt(bus,10)};
    });

  if(!moves.length) {
    toast('No valid moves parsed', 'bad');
    return;
  }

  $('simOut').innerHTML = '<div class="hint">Simulating…</div>';

  try {
    const {data, error} = await db.rpc('simulate_moves', {p_moves: JSON.stringify(moves)});
    if(error) throw error;

    const sim = data;
    const html = `<div class="cards" style="margin-bottom:14px">
      ${statCard('Annual savings', rupee(sim.total_annual_savings))}
      ${statCard('Distance change / trip', (sim.avg_distance_change_km < 0 ? '−' : '') + Math.abs(sim.avg_distance_change_km).toFixed(1)+' km')}
      ${statCard('Fleet time change', (sim.avg_time_change_min < 0 ? '−' : '') + Math.abs(sim.avg_time_change_min).toFixed(0)+' min')}
    </div>
    <h4 style="margin:12px 0 6px;font-size:14px">Per-move impact</h4>
    ${renderOptTable([
      {k:'sr_no',label:'SR'},{k:'new_bus',label:'→ Bus'},{k:'status',label:'Status'},
      {k:'capacity_after',label:'Capacity after'},{k:'annual_savings',label:'Saves/yr',fmt:rupee},
      {k:'distance_change_km',label:'Distance Δ',fmt:v=>(v<0?'−':'+')+Math.abs(v).toFixed(1)+' km'},
      {k:'time_change_min',label:'Ride Δ',fmt:v=>(v<0?'−':'+')+Math.abs(v).toFixed(0)+' min'}
    ], sim.moves||[], 'simulator_result')}
    ${sim.warnings && sim.warnings.length ? `
      <h4 style="margin:12px 0 6px;font-size:14px;color:#b42318">Warnings</h4>
      <ul style="margin:0;padding-left:20px;font-size:13px">
        ${sim.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}
      </ul>
    ` : ''}`;
    $('simOut').innerHTML = html;
    $('simOut').querySelectorAll('button[onclick*="downloadOptCsv"]').forEach(b=>
      b.onclick = (e) => downloadOptCsv(e)
    );
  } catch(e) {
    $('simOut').innerHTML = `<div class="note" style="color:#b42318">${esc(e.message)}</div>`;
  }
}

function statCard(label, value, subtext){
  return `<div style="background:#fff;border:1px solid var(--edge);border-radius:6px;padding:12px;text-align:center">
    <div style="color:#666;font-size:12px;margin-bottom:4px">${esc(label)}</div>
    <div style="font-size:18px;font-weight:600">${esc(value)}</div>
    ${subtext ? `<div style="color:#999;font-size:12px;margin-top:4px">${esc(subtext)}</div>` : ''}
  </div>`;
}

Object.assign(globalThis, { renderOptimization, downloadOptCsv });
