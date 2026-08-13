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
  if(globalThis.tdRound===2) return loadDashboardR2();
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

async function loadDashboardR2(){
  const [{data:st},{data:cap}] = await Promise.all([
    db.from('students_round2').select('sr_no,name,class,bus_no,latitude,longitude').eq('active',true),
    db.from('bus_capacity').select('bus_id,capacity')]);
  const rows=st||[]; const capBy={}; (cap||[]).forEach(c=>capBy[c.bus_id]=c.capacity);
  const byBus={}; rows.forEach(r=>{ (byBus[r.bus_no]=byBus[r.bus_no]||[]).push(r); });
  const buses=Object.keys(byBus).map(Number).sort((a,b)=>a-b);
  const dupRows=rows.length-new Set(rows.map(r=>r.sr_no)).size;
  const noCoords=rows.filter(r=>r.latitude==null).length;
  const card=(v,l,warn)=>`<div class="stat ${warn&&v>0?'warn':''}"><b>${Number(v).toLocaleString('en-IN')}</b><span>${l}</span></div>`;
  const busRows=buses.map(b=>{const kids=byBus[b];
    const cls={}; kids.forEach(k=>cls[(k.class||'?').toUpperCase()]=(cls[(k.class||'?').toUpperCase()]||0)+1);
    return `<tr><td style="font-weight:600">Bus ${b}</td><td>${kids.length}</td><td>${capBy[b]??'—'}</td>
      <td style="color:var(--slate)">${Object.entries(cls).sort((a,z)=>z[1]-a[1]).map(([k,v])=>k+' ('+v+')').join(', ')}</td></tr>`;}).join('');
  $('dashBody').innerHTML=`
    <h2 style="margin:0 0 12px">Overview — Round 2 <span class="note">(small children · runs after Round 1 in the morning, departs first in the afternoon)</span></h2>
    <div class="cards">
      ${card(rows.length,'Round 2 children')}${card(buses.length,'Buses on Round 2')}
      ${card(rows.length&&buses.length?Math.round(rows.length/buses.length):0,'Avg children / bus')}
      ${card(noCoords,'Missing coordinates',true)}${card(dupRows,'Duplicate SR rows (to correct)',true)}</div>
    <h2 style="margin:22px 0 10px">Children per bus <span class="note">(same physical buses as Round 1 — capacity shown is the vehicle's)</span></h2>
    <div style="background:var(--panel);border:1px solid var(--edge);border-radius:8px;overflow:auto">
      <table><thead><tr><th>Bus</th><th>Children</th><th>Seats</th><th>Classes</th></tr></thead><tbody>${busRows}</tbody></table></div>
    <div class="note" style="margin-top:14px">Alerts and Optimization currently analyse <b>Round 1</b>. Switch back with the toggle in the header.</div>`;
}

// The nav handler in app.js calls loadDashboard() as a global; expose it.
Object.assign(globalThis, { loadDashboard });