// Route Planner / Stayback — assign a given set of students to available buses
// and build each bus's real-road drop route via Google (exact km + time).
// Students come in by SR number, by whole class, or both; each finished route
// can be sent to its driver as Google Maps links.
import { db } from "./supabase.js";
import { GOOGLE_DIRECTIONS_KEY } from "./config.js";
import { roundBusIds } from "./rounds.js";

const PAL = i => `hsl(${Math.round(i*137.508)%360} 68% 45%)`;
const DWELL_SEC = 20;          // time at each drop, added to Google's driving time
const LINK_DROPS = 10;         // Google Maps links take 9 waypoints + the destination
let plMap, plLayers = [];
let ROSTER = null, CREW = null, LAST = null;
const PICKED = new Set();      // class keys ticked

function bearing(sy,sx,lat,lon){
  const k=Math.cos(sy*Math.PI/180), dx=(lon-sx)*k, dy=(lat-sy);
  return (Math.atan2(dx,dy)*180/Math.PI+360)%360;
}
// cut a bearing-sorted list into k contiguous wedges at the widest angular gaps
function balancedCuts(items,k){
  const n=items.length; if(k<=1||n<=1) return [items];
  const win=Math.max(1,Math.floor(0.3*n/k)); const cuts=[];
  for(let i=1;i<k;i++){
    const ideal=Math.max(1,Math.min(n-1,Math.round(i*n/k)));
    const lo=Math.max(1,ideal-win), hi=Math.min(n-1,ideal+win); let bj=lo,bg=-1;
    for(let t=lo;t<=hi;t++){const g=items[t].brg-items[t-1].brg; if(g>bg){bg=g;bj=t;}}
    cuts.push(bj);
  }
  const uniq=[...new Set(cuts)].sort((a,b)=>a-b); const out=[]; let prev=0;
  uniq.forEach(c=>{if(c>prev){out.push(items.slice(prev,c));prev=c;}}); out.push(items.slice(prev));
  return out.filter(g=>g.length);
}
function sweepGroups(students,sy,sx,maxSize){
  const items=students.map(s=>({...s,brg:bearing(sy,sx,s.lat,s.lon)})).sort((a,b)=>a.brg-b.brg);
  let k=Math.max(1,Math.ceil(items.length/maxSize));
  let groups=balancedCuts(items,k); let guard=0;
  while(groups.some(g=>g.length>maxSize)&&guard++<100){
    const big=groups.filter(g=>g.length>maxSize).sort((a,b)=>b.length-a.length)[0];
    groups=groups.filter(g=>g!==big).concat(balancedCuts(big,Math.ceil(big.length/maxSize)));
  }
  return groups.filter(g=>g.length);
}
// smallest available bus that fits each group; tie-break on depot proximity
function assignVehicles(groups,pool,hav,used=new Set()){
  const out=[];
  [...groups].sort((a,b)=>b.length-a.length).forEach(g=>{
    const clat=g.reduce((a,s)=>a+s.lat,0)/g.length, clon=g.reduce((a,s)=>a+s.lon,0)/g.length;
    const fits=pool.filter(v=>!used.has(v.id)&&v.cap>=g.length);
    if(!fits.length){out.push({veh:null,group:g});return;}
    const depotKm=v=>(v.slat==null||v.slon==null)?9e9:hav(v.slat,v.slon,clat,clon);
    fits.sort((a,b)=>(a.cap-b.cap)||(depotKm(a)-depotKm(b)));
    used.add(fits[0].id); out.push({veh:fits[0],group:g});
  });
  return out;
}
// drop order: nearest-neighbour outward from school, then a light 2-opt
function orderDrops(group,sy,sx,hav){
  const rem=group.map((_,i)=>i), order=[]; let cur=[sy,sx];
  while(rem.length){let bi=0,bd=1e9;rem.forEach((idx,p)=>{const d=hav(cur[0],cur[1],group[idx].lat,group[idx].lon);if(d<bd){bd=d;bi=p;}});
    const idx=rem.splice(bi,1)[0];order.push(idx);cur=[group[idx].lat,group[idx].lon];}
  // 2-opt on school + drops (school fixed at start, open end)
  let nodes=[[sy,sx,-1],...order.map(i=>[group[i].lat,group[i].lon,i])];
  for(let pass=0;pass<40;pass++){let improved=false;const n=nodes.length;
    for(let i=1;i<n-1;i++){const a=nodes[i-1];
      for(let j=i+1;j<n;j++){const b=nodes[i],c=nodes[j],d=j+1<n?nodes[j+1]:null;
        const before=hav(a[0],a[1],b[0],b[1])+(d?hav(c[0],c[1],d[0],d[1]):0);
        const after=hav(a[0],a[1],c[0],c[1])+(d?hav(b[0],b[1],d[0],d[1]):0);
        if(after<before-1e-9){const seg=nodes.slice(i,j+1).reverse();nodes=nodes.slice(0,i).concat(seg,nodes.slice(j+1));improved=true;}}}
    if(!improved)break;}
  return nodes.slice(1).map(t=>t[2]);
}

let dsvc;
async function ensureGoogle(){
  if(globalThis.googleFailed) return false;           // key invalid/expired -> skip
  if(window.google&&google.maps&&google.maps.geometry) return true;
  if(!GOOGLE_DIRECTIONS_KEY) return false;
  try{
    await new Promise((res,rej)=>{const s=document.createElement('script');
      s.src=`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_DIRECTIONS_KEY}&libraries=geometry`;
      s.onload=res;s.onerror=()=>rej(new Error('maps load'));document.head.appendChild(s);});
  }catch(e){return false;}
  await new Promise(r=>setTimeout(r,400));            // let gm_authFailure fire on a bad key
  return !!(window.google&&google.maps&&!globalThis.googleFailed);
}
function googleRoute(pts){ // pts: [{lat,lng}...] -> {km,min,path} real road; null on failure
  return new Promise(res=>{
    if(globalThis.googleFailed||!window.google||!google.maps){res(null);return;}
    if(!dsvc) dsvc=new google.maps.DirectionsService();
    const to=setTimeout(()=>res(null),8000);
    dsvc.route({origin:pts[0],destination:pts[pts.length-1],
      waypoints:pts.slice(1,-1).map(p=>({location:p,stopover:true})),
      travelMode:google.maps.TravelMode.DRIVING},(r,st)=>{clearTimeout(to);
        if(st!=='OK'){res(null);return;}
        const legs=r.routes[0].legs;
        res({km:legs.reduce((a,l)=>a+l.distance.value,0)/1000,
             min:legs.reduce((a,l)=>a+l.duration.value,0)/60,
             path:r.routes[0].overview_path.map(p=>[p.lat(),p.lng()])});});
  });
}

// ---------------------------------------------------------------- classes
// The student records spell one class several ways ("1", "1st", "I-ENG"; "4", "IV";
// "Nursery", "NURSERY"; "12th Sci", "12th Science"). One key per class, so ticking a
// class never leaves half of it behind.
const ROMAN={i:1,ii:2,iii:3,iv:4,v:5,vi:6,vii:7,viii:8,ix:9,x:10,xi:11,xii:12};
export function classKey(c){
  const raw=String(c??'').trim(); if(!raw) return 'Not set';
  const m=raw.toLowerCase().replace(/[-_.]/g,' ').replace(/\s+/g,' ').trim();
  if(/^(nursery|nur)$/.test(m)) return 'Nursery';
  if(/^(pg|pre nursery|play ?group)$/.test(m)) return 'PG';
  if(/^(lkg|ukg)$/.test(m)) return m.toUpperCase();
  const mm=m.match(/^(\d{1,2}|[ivx]{1,4})(?:st|nd|rd|th)?(?:\s+(.*))?$/);
  if(mm){ const n=/\d/.test(mm[1])?+mm[1]:ROMAN[mm[1]];
    if(n>=1&&n<=12){ const r=mm[2]||'';
      const stream=/^sci/.test(r)?'Science':/^com/.test(r)?'Commerce':/^(hum|art)/.test(r)?'Humanities':'';
      return stream?`${n} ${stream}`:String(n); } }
  return raw;
}
function classRank(k){
  const pre={PG:0,Nursery:1,LKG:2,UKG:3}; if(k in pre) return pre[k];
  const m=k.match(/^(\d+)(?: (\w+))?$/); if(m) return 10+ +m[1]+(m[2]?['Commerce','Humanities','Science'].indexOf(m[2])*.1+.1:0);
  return k==='Not set'?1e4:1e3;
}
const classLabel=k=>/^\d/.test(k)?'Class '+k:k;
const QUICK=[['Pre-primary',r=>r<10],['1–5',r=>r>=11&&r<16],['6–8',r=>r>=16&&r<19],['9–10',r=>r>=19&&r<21],['11–12',r=>r>=21&&r<23]];

async function loadRoster(){
  const r2=globalThis.tdRound===2;
  const rows=r2
    ? (await fetchAll('students_round2','sr_no,name,class,section,latitude,longitude,bus_no,active'))
        .filter(s=>s.active).map(s=>({sr:String(s.sr_no),name:s.name,cls:s.class,sec:s.section,lat:s.latitude,lon:s.longitude,reg:s.bus_no,transport:true}))
    : (await fetchAll('student_effective','sr_no,student_name,class,section,latitude,longitude,bus_id,uses_transport'))
        .map(s=>({sr:String(s.sr_no),name:s.student_name,cls:s.class,sec:s.section,lat:s.latitude,lon:s.longitude,reg:s.bus_id,transport:s.uses_transport!==false}));
  rows.forEach(s=>s.key=classKey(s.cls));
  return rows;
}

function drawClasses(){
  const counts={};
  ROSTER.filter(s=>s.transport).forEach(s=>counts[s.key]=(counts[s.key]||0)+1);
  const keys=Object.keys(counts).sort((a,b)=>classRank(a)-classRank(b)||a.localeCompare(b));
  $('plClasses').innerHTML=`<div class="plquick">
      <button type="button" class="b-ghost linkbtn" data-q="all">All</button>
      <button type="button" class="b-ghost linkbtn" data-q="none">None</button>
      ${QUICK.map(([l],i)=>`<button type="button" class="b-ghost linkbtn" data-q="${i}">${l}</button>`).join('')}</div>
    <div class="plchips">${keys.map(k=>`<button type="button" class="clchip" data-k="${esc(k)}" aria-pressed="${PICKED.has(k)}">${esc(classLabel(k))}<small>${counts[k]}</small></button>`).join('')}</div>`;
  $('plClasses').querySelectorAll('.clchip').forEach(b=>b.onclick=()=>{
    PICKED.has(b.dataset.k)?PICKED.delete(b.dataset.k):PICKED.add(b.dataset.k);
    b.setAttribute('aria-pressed',PICKED.has(b.dataset.k)); countSelected(); });
  $('plClasses').querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{
    const q=b.dataset.q;
    if(q==='none') PICKED.clear();
    else keys.filter(k=>q==='all'||QUICK[+q][1](classRank(k))).forEach(k=>PICKED.add(k));
    drawClasses(); countSelected(); });
}

/** Who is coming: typed SRs (anyone on the roll) plus every transport student in a ticked class. */
function selection(){
  const srs=[...new Set(($('plSrs').value.match(/\d+/g)||[]))];
  const bySr=new Map(ROSTER.map(s=>[s.sr,s]));
  const chosen=new Map();
  ROSTER.forEach(s=>{ if(s.transport&&PICKED.has(s.key)) chosen.set(s.sr,s); });
  const fromClasses=chosen.size;
  srs.forEach(x=>{ const s=bySr.get(x); if(s) chosen.set(x,s); });
  return { students:[...chosen.values()], missing:srs.filter(x=>!bySr.has(x)), fromClasses, typed:srs.length };
}
function countSelected(){
  if(!ROSTER){ $('plCount').textContent=''; return; }
  const s=selection();
  $('plCount').textContent=s.students.length
    ? `${s.students.length} student${s.students.length===1?'':'s'} selected · ${s.fromClasses} from ${PICKED.size} class${PICKED.size===1?'':'es'}, ${s.typed} SR${s.typed===1?'':'s'} typed${s.missing.length?` (${s.missing.length} not found)`:''}`
    : 'Type SR numbers, pick classes, or both.';
}

export async function renderPlanner(){
  if(!plMap){
    plMap=L.map('plannermap').setView([school?school.latitude:27.578,school?school.longitude:75.137],11);
    addBaseLayer(plMap); L.control.scale({imperial:false}).addTo(plMap);
  }
  setTimeout(()=>plMap.invalidateSize(),60);
  $('plGo').onclick=()=>planRoutes();
  $('plSrs').oninput=countSelected;
  if(!ROSTER){
    $('plClasses').innerHTML='<div class="hint">Loading classes…</div>';
    try{ ROSTER=await loadRoster(); }
    catch(e){ $('plClasses').innerHTML=`<div class="note" style="color:#b42318">Could not load students: ${esc(e.message||e)}</div>`; return; }
  }
  drawClasses(); countSelected();
}

async function buildTrip(veh,group,sy,sx,useGoogle){
  const ord=orderDrops(group,sy,sx,hav);
  const stops=ord.map(i=>group[i]);
  const pts=[{lat:sy,lng:sx},...stops.map(s=>({lat:s.lat,lng:s.lon}))];
  const road=useGoogle&&pts.length>=2?await googleRoute(pts):null;
  const straight=pts.slice(1).reduce((a,p,i)=>a+hav(pts[i].lat,pts[i].lng,p.lat,p.lng),0);
  return {veh,stops,km:road?road.km:straight,measured:!!road,
    est:road?Math.round(road.min+stops.length*DWELL_SEC/60):null,
    path:road?road.path:pts.map(p=>[p.lat,p.lng])};
}

async function planRoutes(){
  const btn=$('plGo'); btn.disabled=true; btn.textContent='Planning…';
  try {
    if(!ROSTER){ toast('Students are still loading','bad'); return; }
    const sy=school.latitude, sx=school.longitude;
    const sel=selection();
    if(!sel.students.length){toast('Type SR numbers or pick classes first','bad');return;}
    const limit=parseFloat($('plLimit').value)||null;
    const busFilter=($('plBuses').value.match(/\d+/g)||[]).map(Number);
    const noPin=sel.students.filter(s=>s.lat==null||s.lon==null);
    const eligible=sel.students.filter(s=>s.lat!=null&&s.lon!=null);
    eligible.forEach(s=>s.dist=hav(sy,sx,s.lat,s.lon));
    if(!eligible.length){$('plStats').innerHTML='<div class="note">None of these students has a pickup point on the map.</div>';return;}

    // buses (capacity + depot start)
    const r2 = globalThis.tdRound===2;
    const [{data:bs},{data:crew}]=await Promise.all([
      db.from('buses').select('bus_id,capacity,start_latitude,start_longitude').order('bus_id'),
      db.from('route_crew').select('bus_id,driver_name,driver_phone')]);
    CREW=new Map((crew||[]).map(c=>[c.bus_id,c]));
    // Round-2 buses start FROM SCHOOL and return to it, so they have no depot leg; and only
    // the buses that actually run Round 2 are available for a Round-2 stayback.
    const r2Ids = r2 ? new Set((await roundBusIds()).map(String)) : null;
    let pool=(bs||[])
      .filter(b=>!r2 || r2Ids.has(String(b.bus_id)))
      .map(b=>({id:b.bus_id,cap:b.capacity||0,
        slat: r2 ? sy : b.start_latitude,
        slon: r2 ? sx : b.start_longitude}));
    if(busFilter.length) pool=pool.filter(v=>busFilter.includes(v.id));
    if(!pool.length){toast('No buses available','bad');return;}
    const capLimit=Math.max(...pool.map(v=>v.cap));

    // group -> assign -> order
    const used=new Set();
    const assigned=assignVehicles(sweepGroups(eligible,sy,sx,capLimit),pool,hav,used);
    const ok=await ensureGoogle();
    const trips=[];
    for(const {veh,group} of assigned) trips.push(await buildTrip(veh,group,sy,sx,ok));

    // A route over the time limit is split in two, the second half going to the
    // smallest free bus that fits, for as long as free buses remain.
    let splits=0;
    if(limit&&ok){
      for(let guard=0;guard<15;guard++){
        const over=trips.filter(t=>t.veh&&t.est!=null&&t.est>limit&&t.stops.length>1).sort((a,b)=>b.est-a.est)[0];
        if(!over) break;
        const halves=balancedCuts(over.stops.map(s=>({...s,brg:bearing(sy,sx,s.lat,s.lon)})).sort((a,b)=>a.brg-b.brg),2);
        if(halves.length<2) break;
        const [big,small]=halves.sort((a,b)=>b.length-a.length);
        const extra=assignVehicles([small],pool,hav,used)[0];
        if(!extra.veh) break;                                  // no free bus left
        trips.splice(trips.indexOf(over),1,
          await buildTrip(over.veh,big,sy,sx,ok), await buildTrip(extra.veh,small,sy,sx,ok));
        splits++;
      }
    }
    trips.forEach(t=>t.over=!!(limit&&t.est!=null&&t.est>limit));
    LAST={trips,noPin,missing:sel.missing,sy,sx,limit,google:ok,splits};
    renderPlan(LAST);
  } catch(e){
    $('plStats').innerHTML=`<div class="note" style="color:#b42318">${esc(e.message||e)}</div>`;
  } finally { btn.disabled=false; btn.textContent='Plan routes'; }
}

// ---------------------------------------------------------------- Google Maps links
const ll=p=>`${(+p.lat).toFixed(6)},${(+p.lon).toFixed(6)}`;
/** One trip as Google Maps direction links, starting at school, at most LINK_DROPS drops each. */
export function mapsLinks(trip,sy,sx){
  const out=[]; let from={lat:sy,lon:sx};
  for(let i=0;i<trip.stops.length;i+=LINK_DROPS){
    const part=trip.stops.slice(i,i+LINK_DROPS), dest=part[part.length-1];
    const q=new URLSearchParams({api:'1',origin:ll(from),destination:ll(dest),travelmode:'driving'});
    if(part.length>1) q.set('waypoints',part.slice(0,-1).map(ll).join('|'));
    out.push({from:i+1,to:i+part.length,url:'https://www.google.com/maps/dir/?'+q.toString()});
    from=dest;
  }
  return out;
}
function tripMessage(t,sy,sx){
  const links=mapsLinks(t,sy,sx), today=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
  return [`Bus ${t.veh.id} — drop route, ${today}`,
    `${t.stops.length} drop${t.stops.length===1?'':'s'} · ${t.km.toFixed(1)} km${t.est!=null?` · about ${t.est} min`:''}`,
    '', ...t.stops.map((s,i)=>`${i+1}. ${s.name}${s.key&&s.key!=='Not set'?` (${classLabel(s.key)})`:''}`),
    '', 'Google Maps:', ...links.map(l=>links.length>1?`Drops ${l.from}–${l.to}: ${l.url}`:l.url)].join('\n');
}
const waNumber=p=>{ const d=String(p||'').replace(/\D/g,''); return d.length===10?'91'+d:d.length===12&&d.startsWith('91')?d:null; };
async function copyText(txt,what){
  try{ await navigator.clipboard.writeText(txt); toast(what+' copied','good'); }
  catch(e){ prompt('Copy this:',txt); }
}

function renderPlan({trips,noPin,missing,sy,sx,limit,google,splits}){
  plLayers.forEach(l=>plMap.removeLayer(l)); plLayers=[];
  const add=l=>{l.addTo(plMap);plLayers.push(l);return l;};
  add(L.marker([sy,sx],{icon:L.divIcon({className:'',html:'<div style="font-size:22px">🏫</div>',iconSize:[22,22],iconAnchor:[11,11]}),zIndexOffset:1000}).bindPopup('School'));

  const bounds=[[sy,sx]];
  trips.forEach((t,i)=>{
    const col=(t.veh&&globalThis.colorOf&&colorOf[t.veh.id])||PAL(i);
    add(L.polyline(t.path,{color:col,weight:3,opacity:.85}));
    t.stops.forEach((s,n)=>{bounds.push([s.lat,s.lon]);
      add(L.circleMarker([s.lat,s.lon],{radius:7,weight:1.5,color:'#fff',fillColor:col,fillOpacity:1})
        .bindPopup(`<b>${esc(s.name)}</b><br>${t.veh?'Bus '+t.veh.id:'UNASSIGNED'} · drop #${n+1}<br><span class="mono">SR ${esc(s.sr)}</span> · ${esc(classLabel(s.key))}<br>regular bus ${esc(s.reg??'—')} · ${s.dist.toFixed(1)} km`));
      add(L.marker([s.lat,s.lon],{icon:L.divIcon({className:'',iconSize:[16,16],iconAnchor:[8,8],html:`<div style="font:700 9px/16px sans-serif;text-align:center;color:#fff;text-shadow:0 0 2px #000">${n+1}</div>`})}));
    });
  });
  if(bounds.length>1){const b=L.latLngBounds(bounds);if(b.isValid())plMap.fitBounds(b.pad(.15));}

  const totKm=trips.reduce((a,t)=>a+t.km,0);
  const totStu=trips.reduce((a,t)=>a+t.stops.length,0);
  const card=(v,l)=>`<div style="background:#fff;border:1px solid var(--edge);border-radius:6px;padding:8px 10px;flex:1"><div style="font-size:17px;font-weight:700">${v}</div><div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--slate)">${l}</div></div>`;
  $('plStats').innerHTML=`<div style="display:flex;gap:6px">${card(totStu,'dropped')}${card(trips.filter(t=>t.veh).length,'buses')}${card(Math.round(totKm),google?'total km':'km (straight line)')}</div>`;

  const rows=trips.map((t,i)=>{
    const col=(t.veh&&globalThis.colorOf&&colorOf[t.veh.id])||PAL(i);
    const crew=t.veh&&CREW?.get(t.veh.id), wa=waNumber(crew?.driver_phone);
    return `<div class="legrow plrow" style="flex-wrap:wrap;cursor:default">
      <span class="sw" style="background:${col};border-radius:50%"></span>
      <span style="flex:1">${t.veh?'Bus '+t.veh.id:'<span style="color:#b42318">UNASSIGNED — no bus big enough left</span>'}${crew?.driver_name?` <span class="note">· ${esc(crew.driver_name)}</span>`:''}</span>
      <span class="cnt">${t.stops.length}${t.veh?'/'+t.veh.cap:''}</span>
      <div style="flex-basis:100%;padding-left:22px;color:${t.over?'#b42318':'var(--slate)'};font-size:11px">🚌 ${t.km.toFixed(1)} km${t.est!=null?` · ~${t.est} min`:' (straight line, no Google time)'}${t.over?` · over the ${limit} min limit`:''}</div>
      ${t.veh?`<div class="plshare" style="flex-basis:100%;padding-left:22px">
        <button type="button" class="b-ghost linkbtn plcopy" data-i="${i}">Copy route for driver</button>
        ${wa?`<a class="b-ghost linkbtn" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(tripMessage(t,sy,sx))}">Send on WhatsApp</a>`:''}
        ${mapsLinks(t,sy,sx).map((l,k,a)=>`<a class="b-ghost linkbtn" target="_blank" rel="noopener" href="${esc(l.url)}">Open in Maps${a.length>1?` (${l.from}–${l.to})`:''}</a>`).join('')}
      </div>`:''}
    </div>`;}).join('');
  const overLeft=trips.filter(t=>t.over).length;
  $('plList').innerHTML=`<div class="actions" style="margin:0 0 6px"><button type="button" class="b-ghost" id="plCopyAll">Copy all routes</button></div>
    <div style="background:#fff;border:1px solid var(--edge);border-radius:8px;padding:5px">${rows}</div>
    <div class="note" style="margin-top:8px">Each Maps link carries up to ${LINK_DROPS} drops in order, starting from school; a longer route gets one link per ${LINK_DROPS} drops. Links open best in the Google Maps app — a phone's web browser shows only the first 3 stops. Times include ${DWELL_SEC} s at each drop.</div>`+
    (splits?`<div class="note" style="margin-top:8px">${splits} route${splits===1?' was':'s were'} over the ${limit} min limit and split onto another bus.</div>`:'')+
    (overLeft?`<div class="note" style="margin-top:8px;color:#b42318">${overLeft} route${overLeft===1?' is':'s are'} still over ${limit} min — no free bus left to split onto. Add buses or raise the limit.</div>`:'')+
    (limit&&!google?`<div class="note" style="margin-top:8px;color:#b45309">Google driving times were unavailable, so the time limit could not be checked.</div>`:'')+
    (missing.length?`<div class="note" style="margin-top:8px;color:#b45309">${missing.length} SR(s) not found: ${esc(missing.slice(0,10).join(', '))}</div>`:'')+
    (noPin.length?`<div class="note" style="margin-top:8px;color:#b45309">${noPin.length} student(s) have no pickup point and were left out: ${esc(noPin.slice(0,10).map(s=>s.name+' ('+s.sr+')').join(', '))}</div>`:'');
  $('plList').querySelectorAll('.plcopy').forEach(b=>b.onclick=()=>{const t=trips[+b.dataset.i]; copyText(tripMessage(t,sy,sx),'Bus '+t.veh.id+' route');});
  $('plCopyAll').onclick=()=>copyText(trips.filter(t=>t.veh).map(t=>tripMessage(t,sy,sx)).join('\n\n— — —\n\n'),'All routes');
}

Object.assign(globalThis, { renderPlanner });
