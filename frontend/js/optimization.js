// Optimization analysis engine.
// Reads precomputed snapshot tables (instant, never times out) and provides a
// live what-if simulator. Recalculation is chunked into sub-8s RPC calls so it
// never trips the 8s statement timeout on the authenticated role.

const REASON_LABEL = {
  backtracker: 'Bus drives away from school to reach them',
  near_school_far_bus: 'Near school but on a far-reaching bus',
  lone_outlier: 'Lone student dragging the route out',
  closer_to_other_route: 'Another bus already passes closer'
};

// status of each optimization suggestion, keyed "task_type|task_key" (loaded per render)
let optStatus = {};

export async function renderOptimization(){
  $('optBody').innerHTML = `
    <h2 style="margin:0 0 4px">Route Optimization</h2>
    <div class="note" style="margin-bottom:12px">
      The system scans the whole fleet on its own and lists every worthwhile change, ranked by rupees.
      All figures are real net savings on current data (₹100/L diesel, 200 days, 2 trips/day, 1.6× road factor),
      computed the same way as the simulator — so any row here can be confirmed below.
    </div>
    <div id="optError"></div>
    <div id="optContent" style="display:none">
      <div id="optCards" class="cards" style="margin-bottom:16px"></div>
      <div id="optTables"></div>

      <div style="border-top:2px solid var(--edge);padding-top:16px;margin-top:22px">
        <h3 style="margin:0 0 6px;font-size:16px">What-if simulator</h3>
        <div class="note" style="margin-bottom:8px">
          Enter moves as <span class="mono">SR BUS</span> (one per line, e.g. <span class="mono">3310 17</span>).
          The simulator reroutes every affected bus and returns the exact net rupees, distance, capacity and each child's ride-time change.
          Click <b>Test</b> on any row above to load it here.
        </div>
        <div style="display:grid;grid-template-columns:1fr 130px;gap:8px;margin-bottom:10px">
          <textarea id="simInput" placeholder="3310 17" style="font-family:var(--font-mono,monospace);font-size:13px;padding:8px;border:1px solid var(--edge);border-radius:6px;min-height:80px;resize:vertical"></textarea>
          <div style="display:flex;flex-direction:column;gap:6px">
            <button class="b-primary" id="simBtn" style="flex:1">Simulate</button>
            <button class="b-ghost" id="simClear">Clear</button>
          </div>
        </div>
        <div id="simOut" style="min-height:20px"></div>
      </div>

      <div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--edge);color:#666;font-size:13px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button class="b-ghost" id="optRecalc" style="font-size:13px">Recalculate now</button>
        <span id="optStamp"></span>
        <span id="optProgress" style="color:#8a6d00"></span>
      </div>
    </div>`;

  try {
    await loadOptimizationData();
    $('optError').innerHTML = '';
    $('optContent').style.display = '';
    $('simBtn').onclick = () => runSim($('simInput').value);
    $('simClear').onclick = () => { $('simInput').value=''; $('simOut').innerHTML=''; };
    $('optRecalc').onclick = recalcAll;
    wireRowButtons();
  } catch(e){
    $('optContent').style.display = 'none';
    $('optError').innerHTML = `<div class="note" style="color:#b42318">
      <strong>Could not load optimization data.</strong> ${esc(e.message)}<br>
      <button class="b-ghost" style="margin-top:8px;font-size:13px" onclick="renderOptimization()">Retry</button></div>`;
  }
}

async function loadOptimizationData(){
  const [master, studentFix, cost, overlap, depot, merge, backtrack, fuel, meta, rebalSum, rebalMoves, statuses, deadrun, fleetAssign, fleetSum, consSum, consPlan] = await Promise.all([
    db.from('opt_master').select('*').single(),
    db.from('opt_student_fix').select('*').order('net_annual_fuel',{ascending:false}),
    db.from('opt_student_cost').select('*').order('annual_fuel_cost',{ascending:false}),
    db.from('opt_overlap').select('*').gte('shared_km',2).order('shared_km',{ascending:false}),
    db.from('opt_depot_swap').select('*').order('annual_fuel_saving',{ascending:false}),
    db.from('opt_merge').select('*').eq('mergeable',true).order('potential_annual_saving',{ascending:false}),
    db.from('opt_backtrackers').select('*').order('annual_backtrack_fuel',{ascending:false}),
    db.from('report_fuel_summary').select('total_annual_fuel').single(),
    db.from('opt_meta').select('refreshed_at').single(),
    db.from('opt_rebalance_summary').select('*').maybeSingle(),
    db.from('opt_rebalance_moves').select('*'),
    db.from('opt_task_status').select('*'),
    db.from('report_deadrun_full').select('*').order('annual_dead_fuel',{ascending:false}),
    db.from('opt_fleet_assign').select('*').order('annual_saving',{ascending:false}),
    db.from('opt_fleet_assign_summary').select('*').maybeSingle(),
    db.from('opt_consolidation_summary').select('*').maybeSingle(),
    db.from('opt_consolidation_plan').select('*')
  ]);

  if(master.error) throw new Error('Analysis not calculated yet — click "Recalculate now".');

  // status map for every suggestion row: key = "task_type|task_key"
  optStatus = {};
  (statuses.data||[]).forEach(s=>{ optStatus[s.task_type+'|'+s.task_key] = s; });

  const m = master.data;
  const sf = studentFix.data || [];
  const sfFeasible = sf.filter(r=>r.receiving_feasible);
  const sfTotal = sfFeasible.reduce((a,r)=>a+Number(r.net_annual_fuel||0),0);
  const cst = cost.data || [];
  const stuck = cst.filter(r=>!r.has_cheaper_bus);          // far AND can't be moved -> charge a fee
  const stuckCost = stuck.reduce((a,r)=>a+Number(r.annual_fuel_cost||0),0);

  const rb = rebalSum.data;
  const fleetMoves = (fleetAssign.data||[]).filter(r=>r.suggested_vehicle!==r.bus_id);
  const fleetSaving = Number(fleetSum.data?.annual_saving||0);
  const cs = consSum.data;
  const cplan = consPlan.data || [];

  $('optCards').innerHTML = [
    cs&&cs.buses_freed>0 ? card('Consolidate fleet', '59→'+(59-cs.buses_freed), '−'+cs.buses_freed+' buses · '+rupee(cs.fuel_saved)+' fuel + drivers') : '',
    fleetSaving>0 ? card('Vehicle swaps', fleetMoves.length, rupee(fleetSaving)+'/yr fuel') : '',
    rb&&rb.buses_freed>0 ? card('Retire buses (tight)', rb.buses_freed, rupee(rb.annual_fuel_saved)+'/yr fuel + drivers') : '',
    card('Students to move', sfFeasible.length, rupee(sfTotal)+'/yr net'),
    card('Far students (fee)', stuck.length, rupee(stuckCost)+'/yr they cost'),
    card('Corridor overlaps', (overlap.data||[]).length, 'buses sharing roads'),
    card('Depot swaps', (depot.data||[]).length, rupee((depot.data||[]).reduce((a,r)=>a+Number(r.annual_fuel_saving||0),0))+'/yr'),
    card('Retirable buses', m.retirable_buses, rupee(m.merge_fuel)+'/yr'),
    card('Fleet use', m.fleet_utilisation_pct+'%', m.buses_running+' buses'),
    card('Annual fuel', rupee(fuel.data?.total_annual_fuel||0))
  ].join('');

  const rbMoves = rebalMoves.data || [];
  const rbByBus = {};
  rbMoves.forEach(m=>{(rbByBus[m.freed_bus]=rbByBus[m.freed_bus]||{n:0,cost:0}).n++; rbByBus[m.freed_bus].cost+=Number(m.insert_fuel||0);});
  const rbRows = Object.keys(rbByBus).map(b=>({freed_bus:+b, students:rbByBus[b].n, absorb_cost:Math.round(rbByBus[b].cost)}))
    .sort((a,b)=>a.freed_bus-b.freed_bus);

  $('optTables').innerHTML =
    (cs&&cs.buses_freed>0 ? buildConsolidationSection(cs, cplan) : '') +
    (fleetMoves.length ? section(
      '🔧 Vehicle reassignment — put efficient buses on the long routes',
      `Your buses range from <b>3 to 17 km/L</b>, but the current assignment ignores mileage — several long routes run on the thirstiest engines. `+
      `Swapping which physical bus drives which route (students, stops and depots unchanged) cuts <b>${rupee(fleetSaving)}/yr</b> of diesel across ${fleetMoves.length} vehicle swaps, with capacity respected. `+
      `Do the top few first for most of the benefit. Check a bus can physically serve the route (lane width, terrain) before swapping.`,
      optTable([
        {k:'bus_id',label:'Route (bus)'},{k:'riders',label:'Riders'},{k:'route_km',label:'Route km',f:n1},
        {k:'current_mileage',label:'Now km/L',f:n1},{k:'suggested_vehicle',label:'Use engine of bus'},
        {k:'suggested_mileage',label:'New km/L',f:n1},{k:'annual_saving',label:'Save /yr',f:rupee},
        {label:'Status',cell:r=>statusCell('fleet_assign', r.bus_id)}
      ], fleetMoves, 'vehicle_reassignment')
    ) : '') +
    (rb&&rb.buses_freed>0 ? section(
      '🚌 Fleet rebalance — buses you can retire',
      `The big one. By chain-moving students to nearby buses that already have spare seats, these <b>${rb.buses_freed} buses can be retired entirely</b> — saving <b>${rupee(rb.annual_fuel_saved)}/yr in fuel</b> plus their drivers, maintenance and insurance (typically several lakh per bus). ${rb.students_moved} students move, and no receiving bus goes over capacity. Freed buses: <b>${esc(rb.freed_bus_ids)}</b>. Estimates use real cached distances; confirm a specific bus in the simulator before acting.`,
      optTable([
        {k:'freed_bus',label:'Retire bus'},{k:'students',label:'Students to move'},
        {k:'absorb_cost',label:'Added fuel elsewhere /yr',f:rupee},
        {label:'Status',cell:r=>statusCell('rebalance', r.freed_bus)},
        {label:'',cell:r=>mapBtn('', r.freed_bus)}
      ], rbRows, 'fleet_rebalance')
      + `<div style="margin-top:8px;background:#fff;border:1px solid var(--edge);border-radius:6px;padding:8px 10px;font-size:13px">
          Operating cost per retired bus /yr (driver + maintenance + insurance):
          <input id="rbOpCost" value="400000" autocomplete="off" style="width:120px;padding:3px 6px;border:1px solid var(--edge);border-radius:4px"/>
          → <b>True total saving: <span id="rbTotal">—</span>/yr</b>
          <div class="note" style="margin-top:3px">= ${rupee(rb.annual_fuel_saved)} fuel + ${rb.buses_freed} buses × operating cost. Set your school's real per-bus figure.</div>
        </div>`
      + `<div style="margin-top:4px"><button class="b-ghost optcsv" data-t="rebalance_moves" style="font-size:12px">Download full move list (${rbMoves.length})</button></div>`
      + `<table data-title="rebalance_moves" style="display:none"><tr><td>freed_bus</td><td>sr_no</td><td>student_name</td><td>from_bus</td><td>to_bus</td><td>insert_km</td><td>insert_fuel</td></tr>${
          rbMoves.map(m=>`<tr><td>${m.freed_bus}</td><td>${esc(m.sr_no)}</td><td>${esc(m.student_name)}</td><td>${m.from_bus}</td><td>${m.to_bus}</td><td>${m.insert_km}</td><td>${m.insert_fuel}</td></tr>`).join('')}</table>`
    ) : '') +
    section(
      'Students to move — the highest-value fixes',
      `Each row is one child whose bus makes a costly detour for them while another bus (with a free seat) already passes close. `+
      `<b>Net /yr</b> already subtracts the cost the receiving bus takes on. "Feasible" means that bus has room today.`,
      studentFixTable(sf)
    ) +
    section(
      'What far students cost — fee guidance',
      `The real extra fuel each far-flung student burns per year (their marginal road distance × 2 trips × 200 days ÷ mileage × ₹100/L). `+
      `<b>Movable?</b> "no" = genuinely stuck far out → recover this as their transport fee (e.g. a ₹40k/yr student = ₹40k fee, or ~2 new admissions from that area). `+
      `"yes" = a nearer bus can take them → move instead (see the top table).`,
      optTable([
        {k:'sr_no',label:'SR'},{k:'student_name',label:'Name'},{k:'bus_id',label:'Bus'},
        {k:'km_to_school',label:'Km to school',f:n1},{k:'marginal_km',label:'Extra km/trip',f:n1},
        {k:'annual_fuel_cost',label:'Costs school /yr',f:rupee},
        {k:'has_cheaper_bus',label:'Movable?',f:v=>v?'yes — move':'no — charge fee'},
        {label:'Status',cell:r=>statusCell('far_fee', r.sr_no)},
        {label:'',cell:r=>mapBtn(r.sr_no, r.bus_id)}
      ], cst, 'far_student_cost')
    ) +
    section(
      'Corridor overlaps — two buses on the same road',
      `Pairs whose routes run along the same stretch. Candidates to split the corridor so one bus covers each side.`,
      optTable([
        {k:'bus_a',label:'Bus A'},{k:'bus_b',label:'overlaps Bus B'},
        {k:'a_km',label:'A route km',f:n1},{k:'shared_km',label:'Shared km',f:n1},
        {k:'shared_pct',label:'Shared %',f:v=>v+'%'},
        {label:'Status',cell:r=>statusCell('overlap', r.bus_a+'-'+r.bus_b)}
      ], overlap.data||[], 'corridor_overlaps')
    ) +
    section(
      'Depot swaps — start two buses from each other\'s point',
      `Pairs where each bus\'s garage/start point is closer to the OTHER bus\'s students. Swapping start points cuts empty running.`,
      optTable([
        {k:'bus_a',label:'Bus A'},{k:'bus_b',label:'Bus B'},
        {k:'now_km',label:'Now (both) km',f:n1},{k:'swapped_km',label:'Swapped km',f:n1},
        {k:'km_saved_trip',label:'Saved/trip',f:n1},{k:'annual_fuel_saving',label:'Save /yr',f:rupee},
        {label:'Status',cell:r=>statusCell('depot_swap', r.bus_a+'-'+r.bus_b)}
      ], depot.data||[], 'depot_swaps')
    ) +
    section(
      'Start points — buses running empty before the first child',
      `Each bus drives empty from its start point to its first student ("dead run"). These start too far out — moving the start point (or the depot) closer recovers the fuel shown. Click <b>Map</b> to see the bus's start and route.`,
      optTable([
        {k:'bus_id',label:'Bus'},{k:'start_from',label:'Starts from'},{k:'first_student',label:'First student'},
        {k:'dead_km',label:'Dead run km',f:n1},{k:'annual_dead_fuel',label:'Wasted /yr',f:rupee},
        {k:'annual_savings_if_close',label:'Recover /yr if ≤1.5km',f:rupee},
        {label:'Status',cell:r=>statusCell('start_point', r.bus_id)},
        {label:'',cell:r=>mapBtn('', r.bus_id)}
      ], (deadrun.data||[]).filter(r=>Number(r.annual_savings_if_close||0)>0).slice(0,40), 'start_points')
    ) +
    section(
      'Backtracker students (diagnostic)',
      `Children on the opposite side of school from their bus\'s cluster. Not summed into a headline (a far group shares one trip); shown to spot geography problems.`,
      optTable([
        {k:'sr_no',label:'SR'},{k:'student_name',label:'Name'},{k:'bus_id',label:'Bus'},
        {k:'km_from_cluster',label:'From cluster km',f:n1},{k:'km_to_school',label:'To school km',f:n1},
        {k:'annual_backtrack_fuel',label:'Annual fuel',f:rupee},
        {label:'Status',cell:r=>statusCell('backtracker', r.sr_no)},
        {label:'',cell:r=>mapBtn(r.sr_no, r.bus_id)}
      ], (backtrack.data||[]).slice(0,80), 'backtrackers')
    );

  if(rb && rb.buses_freed>0 && $('rbOpCost')){
    const upd=()=>{const op=parseFloat($('rbOpCost').value)||0;
      $('rbTotal').textContent=rupee(Number(rb.annual_fuel_saved)+rb.buses_freed*op);};
    $('rbOpCost').oninput=upd; upd();
  }
  if(cs && cs.buses_freed>0 && $('csOpCost')){
    const upd=()=>{const op=parseFloat($('csOpCost').value)||0;
      $('csTotal').textContent=rupee(Number(cs.fuel_saved)+cs.buses_freed*op);};
    $('csOpCost').oninput=upd; upd();
  }

  const stamp = meta.data?.refreshed_at ? new Date(meta.data.refreshed_at).toLocaleString() : 'unknown';
  $('optStamp').textContent = 'Last calculated: ' + stamp;
}

/* ---------- student-fix table with per-row Test button ---------- */
function studentFixTable(rows){
  if(!rows.length) return `<div class="note">No student moves found.</div>`;
  const head = ['SR','Name','From','To','Why','Own detour','Insert','Net/trip','Net /yr','Room?','Status','']
    .map(h=>`<th style="text-align:left;padding:7px 8px;border-bottom:1px solid var(--edge);white-space:nowrap">${h}</th>`).join('');
  const body = rows.map(r=>`<tr style="border-bottom:1px solid var(--edge);${r.receiving_feasible?'':'opacity:.62'}">
    <td style="padding:6px 8px">${esc(r.sr_no)}</td>
    <td style="padding:6px 8px">${esc(r.student_name)}</td>
    <td style="padding:6px 8px">Bus ${esc(r.own_bus)}</td>
    <td style="padding:6px 8px"><b>Bus ${esc(r.best_bus)}</b></td>
    <td style="padding:6px 8px;color:#555">${esc(REASON_LABEL[r.reason]||r.reason)}</td>
    <td style="padding:6px 8px">${n1(r.own_marginal_km)} km</td>
    <td style="padding:6px 8px">${n1(r.insert_km)} km</td>
    <td style="padding:6px 8px">${n1(r.net_km_trip)} km</td>
    <td style="padding:6px 8px;font-weight:600">${rupee(r.net_annual_fuel)}</td>
    <td style="padding:6px 8px">${r.receiving_feasible?'<span style="color:#087443">yes</span>':'<span style="color:#b42318">full</span>'}</td>
    <td style="padding:6px 8px">${statusCell('student_move', r.sr_no)}</td>
    <td style="padding:6px 8px;white-space:nowrap"><button class="b-ghost simrow" data-mv="${esc(r.sr_no)} ${esc(r.best_bus)}" style="font-size:12px;padding:3px 8px">Test</button> ${mapBtn(r.sr_no, r.own_bus+','+r.best_bus)}</td>
  </tr>`).join('');
  return `<div style="background:#fff;border:1px solid var(--edge);border-radius:8px;overflow:auto">
    <table data-title="students_to_move" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </div>${csvBtn('students_to_move')}`;
}

function wireRowButtons(){
  document.querySelectorAll('.simrow').forEach(b=>b.onclick=()=>{
    $('simInput').value = b.dataset.mv;
    runSim(b.dataset.mv);
    $('simOut').scrollIntoView({behavior:'smooth',block:'center'});
  });
  document.querySelectorAll('.optcsv').forEach(b=>b.onclick=()=>downloadOptCsv(b.dataset.t));
  document.querySelectorAll('.mapbtn').forEach(b=>b.onclick=()=>
    showSuggestionOnMap(b.dataset.sr, (b.dataset.buses||'').split(',').filter(Boolean).map(Number)));
  wireStatusControls();
}

function wireStatusControls(){
  // change status dropdown
  document.querySelectorAll('.optstat').forEach(sel=>sel.onchange=async ()=>{
    const {tt, key} = sel.dataset, v = sel.value;
    if(v==='cannot'){                                  // ask for a reason inline
      const box = sel.closest('.statwrap').querySelector('.statreasoninput');
      if(box){ box.style.display=''; box.querySelector('.statreasontext').focus(); }
      return;                                          // saved only when they click Save
    }
    if(v===''){ if(await clearStatus(tt,key)) refreshStatusCell(tt,key); wireStatusControls(); return; }
    if(await saveStatus(tt,key,v,null)){ refreshStatusCell(tt,key); wireStatusControls(); }
  });
  // save a "cannot be done" reason
  document.querySelectorAll('.statsave').forEach(btn=>btn.onclick=async ()=>{
    const wrap = btn.closest('.statwrap');
    const reason = wrap.querySelector('.statreasontext').value.trim();
    if(!reason){ toast('Add a short reason','bad'); return; }
    if(await saveStatus(wrap.dataset.tt, wrap.dataset.key, 'cannot', reason)){
      refreshStatusCell(wrap.dataset.tt, wrap.dataset.key); wireStatusControls();
    }
  });
  // toggle "why?" reason visibility
  document.querySelectorAll('.statwhy').forEach(a=>a.onclick=()=>{
    const box = a.parentElement.querySelector('.statreasonbox');
    if(box) box.style.display = box.style.display==='none' ? '' : 'none';
  });
}

/* ---------- generic table ---------- */
function optTable(cols, rows, title){
  if(!rows.length) return `<div class="note">None found.</div>`;
  const head = cols.map(c=>`<th style="text-align:left;padding:7px 8px;border-bottom:1px solid var(--edge);white-space:nowrap">${esc(c.label)}</th>`).join('');
  const body = rows.slice(0,80).map(r=>`<tr style="border-bottom:1px solid var(--edge)">${
    cols.map(c=>`<td style="padding:6px 8px">${c.cell?c.cell(r):esc(c.f?c.f(r[c.k]):r[c.k])}</td>`).join('')
  }</tr>`).join('');
  return `<div style="background:#fff;border:1px solid var(--edge);border-radius:8px;overflow:auto">
    <table data-title="${esc(title)}" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </div>${csvBtn(title)}`;
}

const csvBtn = t => `<div style="margin:6px 0 2px"><button class="b-ghost optcsv" data-t="${esc(t)}" style="font-size:12px">Download CSV</button></div>`;

// "Map" button that opens this suggestion live on the Route map (student + its buses)
const mapBtn = (sr, buses) => `<button class="b-ghost mapbtn" data-sr="${esc(sr)}" data-buses="${esc(buses)}" style="font-size:12px;padding:3px 8px">Map</button>`;

/* ---------- per-suggestion status (Work in progress / Completed / Cannot be done) ---------- */
const STAT = { wip:{t:'In progress',c:'#8a6d00',bg:'#fff7e0'}, done:{t:'Completed',c:'#087443',bg:'#e7f5ee'}, cannot:{t:"Can't be done",c:'#b42318',bg:'#fdeceb'} };

// renders the whole status cell for one row (badge/select + reason)
function statusCell(tt, key){
  const s = optStatus[tt+'|'+key];
  const cur = s?.status || '';
  const opts = [['','— set status —'],['wip','Work in progress'],['done','Completed'],['cannot','Cannot be done']]
    .map(([v,l])=>`<option value="${v}"${v===cur?' selected':''}>${l}</option>`).join('');
  const badge = cur ? `<span class="statbadge" style="background:${STAT[cur].bg};color:${STAT[cur].c};padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap">${STAT[cur].t}</span>` : '';
  const reason = (cur==='cannot' && s?.reason)
    ? `<a class="statwhy" data-tt="${esc(tt)}" data-key="${esc(key)}" href="javascript:void 0" style="font-size:11px;color:#b42318;margin-left:6px">why?</a>
       <div class="statreasonbox" data-for="${esc(tt)}|${esc(key)}" style="display:none;font-size:12px;color:#8a1c14;margin-top:3px;max-width:220px;white-space:normal">${esc(s.reason)}</div>` : '';
  return `<div class="statwrap" data-tt="${esc(tt)}" data-key="${esc(key)}" style="min-width:150px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${badge}
        <select class="optstat" data-tt="${esc(tt)}" data-key="${esc(key)}" style="font-size:11px;padding:2px 4px;border:1px solid var(--edge);border-radius:5px">${opts}</select></div>
      ${reason}
      <div class="statreasoninput" data-for="${esc(tt)}|${esc(key)}" style="display:none;margin-top:4px">
        <input class="statreasontext" placeholder="Why can't it be done?" style="width:200px;font-size:12px;padding:3px 6px;border:1px solid var(--edge);border-radius:5px" value="${esc(cur==='cannot'&&s?.reason?s.reason:'')}"/>
        <button class="b-primary statsave" style="font-size:11px;padding:3px 8px;margin-left:4px">Save</button>
      </div>
    </div>`;
}

async function saveStatus(tt, key, status, reason){
  const row = { task_type: tt, task_key: String(key), status, reason: reason||null,
                updated_at: new Date().toISOString(), updated_by: (globalThis.currentUser?.email)||null };
  const { error } = await db.from('opt_task_status').upsert(row, { onConflict:'task_type,task_key' });
  if(error){ toast('Could not save status: '+error.message,'bad'); return false; }
  optStatus[tt+'|'+key] = row;
  return true;
}
async function clearStatus(tt, key){
  const { error } = await db.from('opt_task_status').delete().eq('task_type',tt).eq('task_key',String(key));
  if(error){ toast('Could not clear status: '+error.message,'bad'); return false; }
  delete optStatus[tt+'|'+key];
  return true;
}

// re-render a single status cell in place (after a change)
function refreshStatusCell(tt, key){
  document.querySelectorAll(`.statwrap[data-tt="${cssq(tt)}"][data-key="${cssq(key)}"]`).forEach(el=>{
    el.outerHTML = statusCell(tt, key);
  });
}
const cssq = s => String(s).replace(/["\\]/g,'\\$&');

async function showSuggestionOnMap(sr, buses){
  const nav=[...document.querySelectorAll('nav button')].find(b=>b.dataset.view==='map');
  if(nav) nav.click();                                   // switch to Route map (runs openRouteMap)
  for(let i=0;i<80 && !(globalThis.studentMarkers && studentMarkers.length); i++)
    await new Promise(r=>setTimeout(r,150));              // wait for the map data to load
  if(buses && buses.length && globalThis.setCheckedBuses) setCheckedBuses(buses);
  if(sr && globalThis.findStudentOnMap) findStudentOnMap(String(sr));
}

function section(title, note, tableHtml){
  return `<div style="margin-bottom:22px">
    <h3 style="margin:14px 0 4px;font-size:15px">${title}</h3>
    <div class="note" style="margin-bottom:6px">${note}</div>${tableHtml}</div>`;
}

// large-scale fleet consolidation plan (student reshuffle to free buses)
function buildConsolidationSection(cs, plan){
  const freed = String(cs.freed_bus_ids||'').split(',').filter(Boolean).map(Number);
  const freedSet = new Set(freed);
  const byFrom = {};
  plan.forEach(m=>{ (byFrom[m.from_bus]=byFrom[m.from_bus]||[]).push(m); });
  const freedRows = freed.map(b=>{
    const ms = byFrom[b]||[]; const dests = {};
    ms.forEach(m=>dests[m.to_bus]=(dests[m.to_bus]||0)+1);
    return {bus:b, n:ms.length, dests};
  }).sort((a,b)=>b.n-a.n);
  const chips = Array.from({length:59},(_,i)=>i+1).map(b=>
    `<span style="display:inline-block;min-width:26px;text-align:center;padding:3px 5px;margin:2px;border-radius:5px;font-size:12px;font-weight:600;${
      freedSet.has(b)?'background:#fdeceb;color:#b42318;text-decoration:line-through':'background:#e7f5ee;color:#087443'}">${b}</span>`).join('');
  const maxWalk = Math.max(0,...plan.map(m=>Number(m.walk_m||0)));
  const maxTime = Math.max(0,...plan.map(m=>Number(m.time_delta||0)));
  const badge = t=>`<span style="background:#eef2f7;border:1px solid var(--edge);border-radius:12px;padding:3px 10px;font-size:12px;margin-right:6px;white-space:nowrap">${t}</span>`;
  const freedTable = `<div style="background:#fff;border:1px solid var(--edge);border-radius:8px;overflow:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
    ${['Retire bus','Students','Move them to (bus × count)','Status'].map(h=>`<th style="text-align:left;padding:7px 8px;border-bottom:1px solid var(--edge)">${h}</th>`).join('')}
    </tr></thead><tbody>${freedRows.map(r=>`<tr style="border-bottom:1px solid var(--edge)">
      <td style="padding:6px 8px;font-weight:600;color:#b42318">Bus ${r.bus}</td>
      <td style="padding:6px 8px">${r.n}</td>
      <td style="padding:6px 8px">${Object.entries(r.dests).sort((a,b)=>b[1]-a[1]).map(([t,c])=>`bus ${t} (${c})`).join(', ')}</td>
      <td style="padding:6px 8px">${statusCell('consolidate', r.bus)}</td>
    </tr>`).join('')}</tbody></table></div>`;
  const moveTable = `<table data-title="consolidation_moves" style="display:none"><tr><td>sr_no</td><td>student_name</td><td>from_bus</td><td>to_bus</td><td>walk_m</td><td>time_delta_min</td></tr>${
    plan.map(m=>`<tr><td>${esc(m.sr_no)}</td><td>${esc(m.student_name)}</td><td>${m.from_bus}</td><td>${m.to_bus}</td><td>${m.walk_m}</td><td>${m.time_delta}</td></tr>`).join('')}</table>`;
  return `<div style="margin-bottom:24px;border:2px solid #087443;border-radius:10px;padding:16px 16px 14px;background:#f6fbf8">
    <h3 style="margin:0 0 4px;font-size:17px">🚍 Fleet consolidation plan — reshuffle students, free ${cs.buses_freed} buses</h3>
    <div class="note" style="margin-bottom:10px">
      A fleet-wide reshuffle: <b>${cs.students_moved} students</b> move to a bus that already stops within walking distance, freeing <b>${cs.buses_freed} buses (59 → ${59-cs.buses_freed})</b>.
      Every move respects bus size, capacity, walking distance and ride-time; seats are freed by chain-moves where a nearer bus is full.
    </div>
    <div style="margin-bottom:10px">
      ${badge('✓ walk ≤ '+maxWalk+' m (size-safe)')}${badge('✓ time ≤ +'+maxTime+' min')}${badge('✓ no bus over capacity')}${badge('✓ '+cs.students_moved+' students moved')}
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <div><div style="font-size:12px;color:#666">Fleet size</div><div style="font-size:24px;font-weight:800">59 → ${59-cs.buses_freed}</div></div>
      <div style="background:#fff;border:1px solid var(--edge);border-radius:8px;padding:8px 12px;font-size:13px">
        Operating cost per retired bus /yr:
        <input id="csOpCost" value="400000" autocomplete="off" style="width:110px;padding:3px 6px;border:1px solid var(--edge);border-radius:4px"/>
        → <b>Total saving: <span id="csTotal">—</span>/yr</b>
        <div class="note" style="margin-top:2px">= ${rupee(cs.fuel_saved)} fuel + ${cs.buses_freed} buses × operating cost.</div>
      </div>
    </div>
    <div style="margin-bottom:12px"><div style="font-size:12px;color:#666;margin-bottom:4px">Fleet after plan — <span style="color:#b42318">red = retired</span></div>${chips}</div>
    ${freedTable}
    <div style="margin-top:8px"><button class="b-ghost optcsv" data-t="consolidation_moves" style="font-size:12px">Download full move list (${cs.students_moved})</button></div>
    ${moveTable}
    <div class="note" style="margin-top:8px">Caveats: receiving buses fill to ~100% (keep 2–3 seats free for new admissions/absences); ride-time uses each student's nearest new-stop time as a proxy; assumes children can walk up to ${maxWalk} m to a stop. Review before executing.</div>
  </div>`;
}

/* ---------- simulator (fixed keys + response shape) ---------- */
async function runSim(text){
  const moves = (text||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const [sr, bus] = l.split(/\s+/);
    return { sr_no: String(sr), to_bus: parseInt(bus,10) };
  }).filter(m=>m.sr_no && Number.isFinite(m.to_bus));

  if(!moves.length){ toast('Enter moves as "SR BUS", e.g. 3310 17','bad'); return; }
  $('simOut').innerHTML = '<div class="hint">Simulating…</div>';

  const { data, error } = await db.rpc('simulate_moves', { p_moves: moves });
  if(error){ $('simOut').innerHTML = `<div class="note" style="color:#b42318">${esc(error.message)}</div>`; return; }
  if(data && data.error){ $('simOut').innerHTML = `<div class="note" style="color:#b42318">${esc(data.error)}</div>`; return; }

  const profit = Number(data.annual_profit||0);
  const dkm = Number(data.delta_km_per_trip||0);
  const dmin = Number(data.delta_fleet_minutes_per_trip||0);
  const infeasible = data.infeasible_buses||[];

  const cards = [
    card(profit>=0?'Net saving /yr':'Net cost /yr', rupee(Math.abs(profit)), profit>=0?'lower fuel bill':'higher fuel bill'),
    card('Distance /trip', signkm(dkm)),
    card('Fleet time /trip', (dmin<0?'−':'+')+Math.abs(dmin)+' min')
  ].join('');

  const busRows = (data.buses||[]).map(b=>{
    const saved = -Number(b.delta_annual_fuel||0);
    const fuelCell = saved>=0
      ? `<span style="color:#087443">saves ${rupee(saved)}/yr</span>`
      : `<span style="color:#b42318">costs ${rupee(-saved)}/yr</span>`;
    return `<tr style="border-bottom:1px solid var(--edge)">
    <td style="padding:6px 8px">Bus ${b.bus_id}</td>
    <td style="padding:6px 8px">${b.route_km_before} → ${b.route_km_after} km</td>
    <td style="padding:6px 8px">${signkm(b.delta_km)}</td>
    <td style="padding:6px 8px">${fuelCell}</td>
    <td style="padding:6px 8px">${b.riders_after}/${b.effective_capacity} ${b.over_capacity?'<span style="color:#b42318">over</span>':''}</td>
  </tr>`;}).join('');

  const stuRows = (data.students||[]).map(s=>`<tr style="border-bottom:1px solid var(--edge)">
    <td style="padding:6px 8px">${esc(s.sr_no)}</td>
    <td style="padding:6px 8px">Bus ${s.from_bus} → ${s.to_bus}</td>
    <td style="padding:6px 8px">${s.ride_km_before} → ${s.ride_km_after} km</td>
    <td style="padding:6px 8px">${(s.delta_minutes<0?'−':'+')+Math.abs(s.delta_minutes)} min</td>
  </tr>`).join('');

  $('simOut').innerHTML = `
    <div class="cards" style="margin:6px 0 12px">${cards}</div>
    ${infeasible.length?`<div class="note" style="color:#b42318;margin-bottom:10px">⚠ Over capacity after move: ${
      infeasible.map(b=>`Bus ${b.bus_id} (${b.riders}/${b.effective_capacity})`).join(', ')}</div>`:''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
      <div>
        <div class="note" style="margin-bottom:4px">Affected buses</div>
        <div style="background:#fff;border:1px solid var(--edge);border-radius:8px;overflow:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
            ${['Bus','Route','Δ km','Fuel','Riders'].map(h=>`<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--edge)">${h}</th>`).join('')}
          </tr></thead><tbody>${busRows}</tbody></table></div>
      </div>
      <div>
        <div class="note" style="margin-bottom:4px">Each child's ride</div>
        <div style="background:#fff;border:1px solid var(--edge);border-radius:8px;overflow:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
            ${['SR','Move','Ride','Δ time'].map(h=>`<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--edge)">${h}</th>`).join('')}
          </tr></thead><tbody>${stuRows}</tbody></table></div>
      </div>
    </div>`;
}

/* ---------- chunked recalc (each RPC well under the 8s limit) ---------- */
async function recalcAll(){
  const btn = $('optRecalc'); btn.disabled = true;
  const prog = $('optProgress');
  const steps = [
    ['Analysing students…',       'refresh_student_fix'],
    ['Routes, corridors, depots…','recalc_light'],
    ['Consolidation…',            'recalc_merge'],
    ['Summarising…',              'recalc_master']
  ];
  let failed = [];
  for(const [label, fn] of steps){
    prog.textContent = label;
    const { error } = await db.rpc(fn);
    if(error) failed.push(fn);
  }
  prog.textContent = '';
  btn.disabled = false;
  if(failed.length) toast('Some steps timed out: '+failed.join(', ')+' — try again','bad');
  else toast('Recalculated','good');
  await loadOptimizationData();
  wireRowButtons();
}

/* ---------- helpers ---------- */
function card(label, value, sub){
  return `<div style="background:#fff;border:1px solid var(--edge);border-radius:8px;padding:12px 14px;min-width:120px">
    <div style="color:#666;font-size:12px;margin-bottom:3px">${esc(label)}</div>
    <div style="font-size:19px;font-weight:700">${esc(value)}</div>
    ${sub?`<div style="color:#999;font-size:12px;margin-top:2px">${esc(sub)}</div>`:''}</div>`;
}
const n1 = v => v==null?'':Number(v).toFixed(1);
const signkm = v => (Number(v)<0?'−':'+')+Math.abs(Number(v)).toFixed(1)+' km';

export function downloadOptCsv(title){
  const tbl = document.querySelector(`table[data-title="${title}"]`);
  if(!tbl) return;
  const skip = td => td.querySelector('button,select,input') || ['Status','','Test','Map','Test Map'].includes(td.textContent.trim());
  const rows = [...tbl.querySelectorAll('tr')].map(tr=>[...tr.children]
    .filter(td=>!skip(td))
    .map(td=>`"${td.textContent.replace(/"/g,'""').trim()}"`).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));
  a.download = title+'.csv'; a.click();
}

Object.assign(globalThis, { renderOptimization, downloadOptCsv, showSuggestionOnMap });
