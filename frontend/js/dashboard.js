import { db } from "./supabase.js";
import { toast } from "./utils.js";
export async function loadDashboard(){
  const [{data:s},{data:al},{data:dr}]=await Promise.all([
    db.from('dashboard_stats').select('*').single(),
    db.from('alerts').select('*').order('severity',{ascending:false}),
    db.from('report_deadrun_summary').select('*').single()]);
  if(!s){$('dashBody').innerHTML='<div class="hint">Could not load stats.</div>';return;}
  const card=(n,l,warn)=>`<div class="stat ${warn&&+s[n]>0?'warn':''}"><b>${Number(s[n]).toLocaleString('en-IN')}</b><span>${l}</span></div>`;
  const drCard = dr?`<div class="stat warn"><b>₹${Number(dr.total_annual_dead_fuel).toLocaleString('en-IN')}</b><span>Dead-run fuel / yr · ${dr.buses_far} buses start >2 km out</span></div>`:'';
  const groups={overloaded:[],temp_ending:[],missing_coords:[],missing_pickup:[]};
  (al||[]).forEach(a=>groups[a.kind]?.push(a));
  const alertBlock=(al&&al.length)?al.map(a=>`<div class="alert ${a.kind}"><span class="k">${a.kind.replace('_',' ')}</span><b>${esc(a.subject)}</b><span class="note">${esc(a.detail)}</span></div>`).join(''):'<div class="note">No alerts — everything looks in order.</div>';
  $('dashBody').innerHTML=`
    <h2 style="margin:0 0 12px">Overview</h2>
    <div class="cards">
      ${card('students','Students')}${card('buses','Buses')}${card('available_seats','Available seats')}
      ${card('temporary_students','Temporary students')}${card('missing_coordinates','Missing coordinates',true)}
      ${card('overloaded_buses','Overloaded buses',true)}${card('missing_pickup_order','Missing pickup order',true)}
      ${(+s.self_transport>0)?`<div class="stat"><b>${Number(s.self_transport).toLocaleString('en-IN')}</b><span>Come by self</span></div>`:''}
      ${drCard}</div>
    <h2 style="margin:22px 0 10px">Alerts <span class="note">(${(al||[]).length})</span></h2>
    ${alertBlock}`;
}

// The nav handler in app.js calls loadDashboard() as a global; expose it.
Object.assign(globalThis, { loadDashboard });