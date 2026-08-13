import { db } from "./supabase.js";
import { toast } from "./utils.js";
import { loadBusPage } from "./buspage.js";
import { loadPickup } from "./pickup.js";

function goFix(kind, subject){
  const busM = /bus\s*(\d+)/i.exec(subject||'');
  const nav = v => { const b=document.querySelector(`nav button[data-view="${v}"]`); if(b) b.click(); };
  if(kind==='overloaded' && busM){ nav('buspage');
    setTimeout(()=>{ const sel=$('bpSel'); if(sel){ sel.value=busM[1]; loadBusPage(parseInt(busM[1],10)); } }, 120); return; }
  if(kind==='missing_pickup' && busM){ nav('pickup');
    setTimeout(()=>loadPickup(parseInt(busM[1],10)), 120); return; }
  if(kind==='temp_ending'){ nav('temp'); return; }
  // default: student-centred alerts (missing coords etc.) -> Students, pre-searched
  nav('students');
  setTimeout(()=>{ const q=$('q'); if(q){ q.value=subject||''; if(globalThis.searchStudents) searchStudents(subject||''); } }, 120);
}

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
  const alertBlock=(al&&al.length)?al.map((a,i)=>`<div class="alert ${a.kind}" data-i="${i}" title="Click to open where this gets fixed" style="cursor:pointer"><span class="k">${a.kind.replace('_',' ')}</span><b>${esc(a.subject)}</b><span class="note">${esc(a.detail)}</span><span style="margin-left:auto;color:var(--faint)">›</span></div>`).join(''):'<div class="note">No alerts — everything looks in order.</div>';
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
  document.querySelectorAll('#dashBody .alert[data-i]').forEach(el=>{
    el.onclick=()=>{ const a=(al||[])[Number(el.dataset.i)]; if(a) goFix(a.kind, a.subject); };
  });
}

// The nav handler in app.js calls loadDashboard() as a global; expose it.
Object.assign(globalThis, { loadDashboard });