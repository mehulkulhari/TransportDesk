// Route Planner / Stayback — assign a given set of students to available buses
// and build each bus's real-road drop route via Google (exact km + time).
import { db } from "./supabase.js";
import { GOOGLE_DIRECTIONS_KEY } from "./config.js";

const PAL = i => `hsl(${Math.round(i*137.508)%360} 68% 45%)`;
let plMap, plLayers = [];

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
function assignVehicles(groups,pool,hav){
  const used=new Set(), out=[];
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

export function renderPlanner(){
  if(!plMap){
    plMap=L.map('plannermap').setView([school?school.latitude:27.578,school?school.longitude:75.137],11);
    addBaseLayer(plMap); L.control.scale({imperial:false}).addTo(plMap);
  }
  setTimeout(()=>plMap.invalidateSize(),60);
  $('plGo').onclick=()=>planRoutes();
}

async function planRoutes(){
  const btn=$('plGo'); btn.disabled=true; btn.textContent='Planning…';
  try {
    const sy=school.latitude, sx=school.longitude;
    const srs=[...new Set(($('plSrs').value.match(/\d+/g)||[]))];
    if(!srs.length){toast('Paste some SR numbers first','bad');return;}
    const radius=parseFloat($('plRadius').value)||8;
    const maxPer=parseInt($('plMax').value,10)||20;
    const dwell=parseInt($('plDwell').value,10)||45;
    const limit=parseFloat($('plLimit').value)||null;
    const busFilter=($('plBuses').value.match(/\d+/g)||[]).map(Number);

    // students
    const {data:studs,error}=await db.from('student_effective')
      .select('sr_no,student_name,latitude,longitude,bus_id').in('sr_no',srs);
    if(error) throw error;
    const found=(studs||[]).filter(s=>s.latitude!=null)
      .map(s=>({sr:String(s.sr_no),name:s.student_name,lat:s.latitude,lon:s.longitude,reg:s.bus_id}));
    const missing=srs.filter(x=>!found.some(f=>f.sr===x));
    found.forEach(s=>s.dist=hav(sy,sx,s.lat,s.lon));
    const eligible=found.filter(s=>s.dist<=radius);
    const excluded=found.filter(s=>s.dist>radius).sort((a,b)=>b.dist-a.dist);
    if(!eligible.length){$('plStats').innerHTML='<div class="note">No students within the radius.</div>';return;}

    // buses (capacity + depot start)
    const {data:bs}=await db.from('buses').select('bus_id,capacity,start_latitude,start_longitude').order('bus_id');
    let pool=(bs||[]).map(b=>({id:b.bus_id,cap:b.capacity||0,slat:b.start_latitude,slon:b.start_longitude}));
    if(busFilter.length) pool=pool.filter(v=>busFilter.includes(v.id));
    if(!pool.length){toast('No buses available','bad');return;}
    const capLimit=Math.min(Math.max(...pool.map(v=>v.cap)), maxPer);

    // group -> assign -> order
    const groups=sweepGroups(eligible,sy,sx,capLimit);
    const assigned=assignVehicles(groups,pool,hav);

    const ok=await ensureGoogle();
    const trips=[];
    for(const {veh,group} of assigned){
      const ord=orderDrops(group,sy,sx,hav);
      const stops=ord.map(i=>group[i]);
      const pts=[{lat:sy,lng:sx},...stops.map(s=>({lat:s.lat,lng:s.lon}))];
      let road=null;
      if(ok && pts.length>=2) road=await googleRoute(pts);
      const straight=pts.slice(1).reduce((a,p,i)=>a+hav(pts[i].lat,pts[i].lng,p.lat,p.lng),0);
      const km=road?road.km:straight;
      const est=road?Math.round(road.min+stops.length*dwell/60):null;
      trips.push({veh,stops,km,est,path:road?road.path:pts.map(p=>[p.lat,p.lng]),
                  over: limit&&est!=null&&est>limit});
    }
    renderPlan({trips,excluded,missing,radius,sy,sx,limit});
  } catch(e){
    $('plStats').innerHTML=`<div class="note" style="color:#b42318">${esc(e.message||e)}</div>`;
  } finally { btn.disabled=false; btn.textContent='Plan routes'; }
}

function renderPlan({trips,excluded,missing,radius,sy,sx,limit}){
  plLayers.forEach(l=>plMap.removeLayer(l)); plLayers=[];
  const add=l=>{l.addTo(plMap);plLayers.push(l);return l;};
  add(L.marker([sy,sx],{icon:L.divIcon({className:'',html:'<div style="font-size:22px">🏫</div>',iconSize:[22,22],iconAnchor:[11,11]}),zIndexOffset:1000}).bindPopup('School'));
  add(L.circle([sy,sx],{radius:radius*1000,color:'#2563eb',weight:1.5,dashArray:'7 6',fill:false}));
  excluded.forEach(s=>add(L.circleMarker([s.lat,s.lon],{radius:5,color:'#9ca3af',weight:1,fillColor:'#d1d5db',fillOpacity:.85})
    .bindPopup(`<b>${esc(s.name)}</b><br>Not allowed — ${s.dist.toFixed(1)} km (outside ${radius} km)`)));

  const bounds=[[sy,sx]];
  trips.forEach((t,i)=>{
    const col=(t.veh&&globalThis.colorOf&&colorOf[t.veh.id])||PAL(i);
    add(L.polyline(t.path,{color:col,weight:3,opacity:.85}));
    t.stops.forEach((s,n)=>{bounds.push([s.lat,s.lon]);
      add(L.circleMarker([s.lat,s.lon],{radius:7,weight:1.5,color:'#fff',fillColor:col,fillOpacity:1})
        .bindPopup(`<b>${esc(s.name)}</b><br>${t.veh?'Bus '+t.veh.id:'UNASSIGNED'} · drop #${n+1}<br><span class="mono">SR ${esc(s.sr)}</span><br>regular bus ${esc(s.reg??'—')} · ${s.dist.toFixed(1)} km`));
      add(L.marker([s.lat,s.lon],{icon:L.divIcon({className:'',iconSize:[16,16],iconAnchor:[8,8],html:`<div style="font:700 9px/16px sans-serif;text-align:center;color:#fff;text-shadow:0 0 2px #000">${n+1}</div>`})}));
    });
  });
  if(bounds.length>1){const b=L.latLngBounds(bounds);if(b.isValid())plMap.fitBounds(b.pad(.15));}

  const totKm=trips.reduce((a,t)=>a+t.km,0);
  const totStu=trips.reduce((a,t)=>a+t.stops.length,0);
  const card=(v,l)=>`<div style="background:#fff;border:1px solid var(--edge);border-radius:6px;padding:8px 10px;flex:1"><div style="font-size:17px;font-weight:700">${v}</div><div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--slate)">${l}</div></div>`;
  $('plStats').innerHTML=`<div style="display:flex;gap:6px">${card(totStu,'dropped')}${card(trips.length,'buses')}${card(Math.round(totKm),'total km')}${card(excluded.length,'not allowed')}</div>`;

  const rows=trips.map((t,i)=>{
    const col=(t.veh&&globalThis.colorOf&&colorOf[t.veh.id])||PAL(i);
    return `<div class="legrow" style="flex-wrap:wrap">
      <span class="sw" style="background:${col};border-radius:50%"></span>
      <span style="flex:1">${t.veh?'Bus '+t.veh.id:'<span style="color:#b42318">UNASSIGNED</span>'}</span>
      <span class="cnt">${t.stops.length}${t.veh?'/'+t.veh.cap:''}</span>
      <div style="flex-basis:100%;padding-left:22px;color:${t.over?'#b42318':'var(--slate)'};font-size:11px">🚌 ${t.km.toFixed(1)} km${t.est!=null?` · ~${t.est} min`:' (straight line)'}${t.over?` · over ${limit} min limit`:''}</div>
    </div>`;}).join('');
  $('plList').innerHTML=`<div style="background:#fff;border:1px solid var(--edge);border-radius:8px;padding:5px">${rows}</div>`+
    (missing.length?`<div class="note" style="margin-top:8px;color:#b45309">${missing.length} SR(s) not found: ${missing.slice(0,10).join(', ')}</div>`:'')+
    (excluded.length?`<div class="note" style="margin-top:8px">${excluded.length} too far to stay back (grey on map).</div>`:'');
}

Object.assign(globalThis, { renderPlanner });
