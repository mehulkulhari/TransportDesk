import { start } from "./bootstrap.js";
import { navigate } from "./router.js";
import { start } from "./bootstrap.js";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL='https://ftlaicvkwmxkehlefeap.supabase.co';
const SUPABASE_KEY='sb_publishable_N4uceGsyAcLOUl_nDgzRbw_HhJCbcOZ';
const db=createClient(SUPABASE_URL,SUPABASE_KEY);
// PostgREST returns at most 1000 rows per request; page through so we get every student
async function fetchAll(table,columns){
  const N=1000;let from=0,all=[];
  while(true){
    const {data,error}=await db.from(table).select(columns).range(from,from+N-1);
    if(error){console.error(error);break;}
    all=all.concat(data||[]);
    if(!data||data.length<N)break;
    from+=N;
  }
  return all;
}

// ===================================================================
//  PASTE YOUR GOOGLE MAPS API KEY BETWEEN THE QUOTES BELOW.
//  Leave it empty ('') to keep the free OpenStreetMap basemap.
//  NOTE: Google Maps often will NOT load from a file opened directly
//  (a file:/// address). If the Google layer doesn't appear, the map
//  still works on OpenStreetMap. See the notes for how to serve the
//  file so Google works.
const GOOGLE_MAPS_API_KEY = '';
// ===================================================================
let googleReady=false, googleFailed=false, allMaps=[], googleLayers=[];
// Google calls this automatically when the key is invalid / unauthorised / billing off.
window.gm_authFailure=function(){googleFailed=true;
  googleLayers.forEach(g=>{try{g.remove();}catch(e){}});googleLayers=[];
  console.warn('Google Maps could not authorise this key here — using OpenStreetMap.');};
function loadGoogle(){
  if(!GOOGLE_MAPS_API_KEY) return;
  const s=document.createElement('script');
  s.src=`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
  s.async=true;
  s.onload=()=>{googleReady=true; allMaps.forEach(attachGoogle);};
  s.onerror=()=>{googleFailed=true;};
  document.head.appendChild(s);
}
loadGoogle();
function attachGoogle(m){
  if(!(GOOGLE_MAPS_API_KEY && googleReady && !googleFailed && window.google && window.google.maps
        && L.gridLayer && L.gridLayer.googleMutant)) return;
  try{const g=L.gridLayer.googleMutant({type:'roadmap',maxZoom:20});g.addTo(m);googleLayers.push(g);}catch(e){}
}
// Every map gets OpenStreetMap first (so it is NEVER blank); Google layers on top only if it works.
function addBaseLayer(m){
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(m);
  allMaps.push(m); attachGoogle(m);
}
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const rs=n=>'₹'+Number(n||0).toLocaleString('en-IN');
function toast(m,k){const t=$('toast');t.textContent=m;t.className='show '+(k||'');setTimeout(()=>t.className='',3400);}
function hav(a,b,c,d){const R=6371,r=Math.PI/180,x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;return 2*R*Math.asin(Math.sqrt(x));}

let map,pin,buses=[],school=null,current=null,colorOf={},routeMap,mapLayers={},mapReady=false,checkedBuses=new Set();

/* auth */
$('loginBtn').onclick=async()=>{const b=$('loginBtn');b.disabled=true;$('gateMsg').textContent='Checking…';
  const {error}=await db.auth.signInWithPassword({email:$('em').value.trim(),password:$('pw').value});b.disabled=false;
  if(error){$('gateMsg').innerHTML='<span style="color:#b42318">'+esc(error.message)+'</span>';return;}start();};
$('pw').addEventListener('keydown',e=>{if(e.key==='Enter')$('loginBtn').click();});
$('outBtn').onclick=async()=>{await db.auth.signOut();location.reload();};
db.auth.getSession().then(({data})=>{if(data.session)start();});


document.querySelectorAll('nav button').forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  $('v-'+btn.dataset.view).classList.add('on');
  const v=btn.dataset.view;
  if(v==='dash')loadDashboard();
  if(v==='map')openRouteMap();
  if(v==='students')setTimeout(()=>map&&map.invalidateSize(),60);
  if(v==='bulk')renderBulk();
  if(v==='reports')renderReports();
  if(v==='ask')renderAsk();
  if(v==='admission')renderAdmission();
  if(v==='buspage')renderBusPage();
});

/* ============ DASHBOARD ============ */

/* ============ STUDENTS ============ */
function initEditMap(){
  map=L.map('map',{zoomControl:true}).setView([school?school.latitude:27.578,school?school.longitude:75.137],12);
  addBaseLayer(map);
  if(school)L.marker([school.latitude,school.longitude],{icon:L.divIcon({className:'',html:'<div style="font-size:22px">🏫</div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map).bindPopup('School');
  map.on('click',e=>{if(current)setPin(e.latlng.lat,e.latlng.lng,true);});
}
function setPin(lat,lon,edit){
  if(!pin){pin=L.marker([lat,lon],{draggable:true}).addTo(map);pin.on('dragend',()=>{const p=pin.getLatLng();setPin(p.lat,p.lng,true);});}
  else pin.setLatLng([lat,lon]);
  if($('cLat')){$('cLat').textContent=lat.toFixed(6);$('cLon').textContent=lon.toFixed(6);}
  if(edit&&$('saveBtn'))$('saveBtn').disabled=false;
}
let stimer;$('q').addEventListener('input',e=>{clearTimeout(stimer);stimer=setTimeout(()=>searchStudents(e.target.value),220);});
async function searchStudents(term){term=term.trim();
  if(term.length<2){$('results').innerHTML='<div class="hint">Type a name or SR number.</div>';return;}
  const {data,error}=await db.from('student_effective').select('id,sr_no,student_name,bus_id,using_temp_address,using_temp_bus').or(`student_name.ilike.%${term}%,sr_no.ilike.%${term}%`).limit(40);
  if(error){$('results').innerHTML='<div class="hint">'+esc(error.message)+'</div>';return;}
  renderList($('results'),data,openStudent);
}
function renderList(box,data,onclick){
  if(!data||!data.length){box.innerHTML='<div class="hint">No match.</div>';return;}
  box.innerHTML=data.map(s=>`<div class="item" data-id="${s.id}"><span class="nm">${esc(s.student_name)}${(s.using_temp_address||s.using_temp_bus)?' <span class="flag">TEMP</span>':''}</span><span class="sr mono">${esc(s.sr_no)}</span><span class="bs">Bus ${esc(s.bus_id??'—')}</span></div>`).join('');
  [...box.querySelectorAll('.item')].forEach(el=>el.onclick=()=>{box.querySelectorAll('.item').forEach(x=>x.classList.remove('on'));el.classList.add('on');onclick(el.dataset.id);});
}
async function openStudent(id){
  const {data,error}=await db.from('student_effective').select('*').eq('id',id).single();
  if(error){toast(error.message,'bad');return;}
  // road time to school for the profile
  const {data:rt}=await db.from('students').select('road_km_to_school,road_min_to_school,uses_transport').eq('id',id).single();
  const roadTxt = rt&&rt.road_min_to_school!=null ? `${rt.road_min_to_school} min (${rt.road_km_to_school} km)` : '—';
  const usesTransport = !rt || rt.uses_transport!==false;
  // full profile from the whole-school profile table
  const {data:prof}=await db.from('student_profiles').select('*').eq('sr_no',data.sr_no).maybeSingle();
  const parentName = data.parent_name || (prof&&prof.father_name) || null;
  const parentPhone = data.phone || (prof&&prof.father_phone) || null;
  current=data;$('empty').style.display='none';const f=$('form');f.style.display='block';
  const busOpts=buses.map(b=>`<option value="${b.bus_id}" ${String(b.bus_id)===String(data.permanent_bus)?'selected':''}>Bus ${b.bus_id} · ${b.capacity} seats</option>`).join('');
  const pv=(k,v)=>`<div class="coord"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  f.innerHTML=`<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px">
      <h2 style="margin:0;font-size:17px">${esc(data.student_name)}</h2><span class="note mono">SR ${esc(data.sr_no)}</span>
      <span class="note">Class ${esc(data.class)}${data.section?'-'+esc(data.section):''}</span>
      ${data.using_temp_address?'<span class="flag">Temp address</span>':''}${data.using_temp_bus?'<span class="flag">Temp bus</span>':''}
      ${usesTransport?'':'<span class="flag" style="background:#eef;color:#446">Comes by self</span>'}</div>
    <div style="background:${usesTransport?'#f7f8fa':'#eef2ff'};border:1px solid var(--edge);border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;gap:10px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0"><input type="checkbox" id="selfTransport" ${usesTransport?'':'checked'}> Comes by self (not on school transport)</label>
      <span class="note" style="margin-left:auto">${usesTransport?'Currently on Bus '+esc(data.bus_id):'Removed from bus rosters &amp; capacity'}</span>
    </div>
    <div class="grid" style="margin-bottom:8px">
      ${pv('Current bus','Bus '+esc(data.bus_id))}
      ${pv('Pickup order',data.pickup_order??'—')}
      ${pv('Time to school',roadTxt)}
      ${pv('Parent',esc(parentName||'—'))}
      ${pv('Phone',esc(parentPhone||'—'))}
      ${pv('Permanent bus','Bus '+esc(data.permanent_bus))}</div>
    ${prof?`<details open style="margin-bottom:10px"><summary style="cursor:pointer;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--slate)">Student profile</summary>
      <div class="grid" style="margin-top:8px">
        ${pv('Father',esc(prof.father_name||'—'))}
        ${pv('Mother',esc(prof.mother_name||'—'))}
        ${pv('Father phone',esc(prof.father_phone||'—'))}
        ${pv('Mother phone',esc(prof.mother_phone||'—'))}
        ${pv('Date of birth',esc(prof.dob||'—'))}
        ${pv('Gender',esc(prof.gender||'—'))}
        ${pv('Admission date',esc(prof.admission_date||'—'))}
        ${pv('Previous school',esc(prof.previous_school||'—'))}</div>
      <div class="coord" style="margin-top:8px"><div class="k">Home address</div><div class="v">${esc(prof.home_address||'—')}</div></div>
      </details>`:`<div class="note" style="margin-bottom:10px">No profile on file for this student yet — upload the whole-school CSV in Bulk to add it.</div>`}
    <div class="note">Edit below — drag the pin or click the map to set the pickup point.</div>
    <div class="grid" style="margin-top:12px">
      <div class="coord"><div class="k">Latitude</div><div class="v mono" id="cLat">${(+data.permanent_latitude).toFixed(6)}</div></div>
      <div class="coord"><div class="k">Longitude</div><div class="v mono" id="cLon">${(+data.permanent_longitude).toFixed(6)}</div></div>
      <div><label>Permanent bus</label><select id="busSel">${busOpts}</select></div>
      <div><label>Pickup order</label><input id="pkIn" type="number" min="1" value="${data.pickup_order??''}" placeholder="unset"/></div>
      <div><label>Parent name</label><input id="parIn" value="${esc(data.parent_name||'')}"/></div>
      <div><label>Phone</label><input id="phIn" value="${esc(data.phone||'')}"/></div>
    </div>
    <div class="field" style="margin-top:12px"><label>Why the change (optional)</label><input id="noteIn" placeholder="e.g. shifted house"/></div>
    <div class="actions"><button class="b-primary" id="saveBtn" disabled>Save changes</button>
      <button class="b-ghost" id="resetBtn">Undo pin</button><span class="note" id="lastEdit">${data.updated_by?('Last edited by '+esc(data.updated_by)):''}</span></div>
    <details><summary>Change history &amp; undo</summary><div id="hist" class="note" style="margin-top:8px">Loading…</div></details>`;
  setPin(+data.latitude,+data.longitude,false);map.setView([+data.latitude,+data.longitude],16);$('saveBtn').disabled=true;
  ['busSel','pkIn','parIn','phIn'].forEach(idf=>$(idf).oninput=$(idf).onchange=()=>$('saveBtn').disabled=false);
  $('selfTransport').onchange=()=>$('saveBtn').disabled=false;
  $('saveBtn').onclick=saveStudent;
  $('resetBtn').onclick=()=>{setPin(+data.latitude,+data.longitude,false);$('saveBtn').disabled=true;};
  loadHistory(data.id);
}
async function saveStudent(){
  const p=pin.getLatLng();const newBus=parseInt($('busSel').value,10);
  const comesBySelf=$('selfTransport').checked;
  const pk=$('pkIn').value?parseInt($('pkIn').value,10):null;const busChanged=newBus!==current.permanent_bus;
  const patch={latitude:+p.lat.toFixed(6),longitude:+p.lng.toFixed(6),bus_no:newBus,
    parent_name:$('parIn').value.trim()||null,phone:$('phIn').value.trim()||null,
    address_note:$('noteIn').value.trim()||null,
    uses_transport:!comesBySelf,
    pickup_order: comesBySelf ? null : (busChanged && $('pkIn').value===String(current.pickup_order??'') ? null : pk)};
  const {error}=await db.from('students').update(patch).eq('id',current.id);
  if(error){toast(error.message.includes('uniq_bus_pickup')?`Pickup position ${pk} is already used on bus ${newBus}`:error.message,'bad');return;}
  toast(comesBySelf?'Saved — student removed from school transport':('Saved'+(busChanged&&patch.pickup_order===null?' — set a pickup order on the Pickup tab':'')),'good');
  $('saveBtn').disabled=true;openStudent(current.id);searchStudents($('q').value);loadDashboard();
}
async function loadHistory(id){
  const {data,error}=await db.from('student_address_history').select('id,changed_at,changed_by,old_latitude,new_latitude,old_longitude,new_longitude,old_bus_no,new_bus_no,old_pickup_order,new_pickup_order,note').eq('student_id',id).order('changed_at',{ascending:false}).limit(10);
  const box=$('hist');if(!box)return;
  if(error||!data||!data.length){box.textContent=error?error.message:'No changes recorded yet.';return;}
  box.innerHTML=data.map(h=>{const w=new Date(h.changed_at).toLocaleString();const bits=[];
    if(h.old_latitude!==h.new_latitude||h.old_longitude!==h.new_longitude)bits.push('address moved');
    if(h.old_bus_no!==h.new_bus_no)bits.push(`bus ${h.old_bus_no??'—'}→${h.new_bus_no??'—'}`);
    if(h.old_pickup_order!==h.new_pickup_order)bits.push(`pickup ${h.old_pickup_order??'—'}→${h.new_pickup_order??'—'}`);
    return `<div class="histrow"><span style="flex:1">${w} · ${esc(h.changed_by||'?')} — ${bits.join(', ')||'edited'}${h.note?' · '+esc(h.note):''}</span><button class="b-ghost" style="padding:3px 8px;font-size:11px" data-h="${h.id}">Undo</button></div>`;}).join('');
  [...box.querySelectorAll('button[data-h]')].forEach(b=>b.onclick=async()=>{
    const {error}=await db.rpc('revert_change',{p_history_id:parseInt(b.dataset.h,10)});
    if(error){toast(error.message,'bad');return;}toast('Change reverted','good');openStudent(id);});
}





/* ============ TEMPORARY ============ */
let ttimer;$('tq').addEventListener('input',e=>{clearTimeout(ttimer);ttimer=setTimeout(()=>searchTemp(e.target.value),220);});
async function searchTemp(term){term=term.trim();if(term.length<2){$('tresults').innerHTML='<div class="hint">Search a student.</div>';return;}
  const {data}=await db.from('student_effective').select('id,sr_no,student_name,bus_id,using_temp_address,using_temp_bus').or(`student_name.ilike.%${term}%,sr_no.ilike.%${term}%`).limit(40);
  renderList($('tresults'),data,openTemp);}
async function openTemp(id){
  const {data}=await db.from('student_effective').select('*').eq('id',id).single();
  const busOpts=buses.map(b=>`<option value="${b.bus_id}">Bus ${b.bus_id}</option>`).join('');
  const today=new Date().toISOString().slice(0,10);
  const {data:active}=await db.from('student_temp_assignments').select('*').eq('student_id',id).or(`valid_until.is.null,valid_until.gte.${today}`).order('valid_from',{ascending:false});
  $('tform').innerHTML=`<h2 style="margin:0 0 2px;font-size:17px">${esc(data.student_name)}</h2>
    <div class="note mono" style="margin-bottom:14px">SR ${esc(data.sr_no)} · permanent Bus ${esc(data.permanent_bus)}</div>
    ${active&&active.length?`<div style="background:#fdf1df;border:1px solid #f0d3a8;border-radius:6px;padding:10px 12px;margin-bottom:16px"><b style="color:#b45309">Temporary arrangement active</b>
      <div class="note">${active[0].temp_bus_no?('Temp bus '+active[0].temp_bus_no+' · '):''}${active[0].temp_latitude?'temp address · ':''}until ${active[0].valid_until||'no end date'}${active[0].reason?' · '+esc(active[0].reason):''}</div>
      <button class="b-ghost" id="endTemp" style="margin-top:8px">End it today</button></div>`:''}
    <div class="grid"><div><label>Temporary bus (optional)</label><select id="tBus"><option value="">— keep permanent bus —</option>${busOpts}</select></div>
      <div><label>From</label><input id="tFrom" type="date" value="${today}"/></div>
      <div><label>Until (blank = no end)</label><input id="tUntil" type="date"/></div>
      <div><label>Reason</label><input id="tReason" placeholder="e.g. staying at grandparents"/></div></div>
    <div class="field" style="margin-top:12px"><label>Temporary address (optional)</label><div class="note">Click on the map, or leave blank to keep the home address.</div></div>
    <div id="tmini" style="height:300px;border:1px solid var(--edge);border-radius:6px"></div>
    <div class="actions"><button class="b-signal" id="tSave">Save temporary arrangement</button><span class="note" id="tState"></span></div>`;
  if($('endTemp'))$('endTemp').onclick=async()=>{await db.from('student_temp_assignments').update({valid_until:today}).eq('student_id',id).or(`valid_until.is.null,valid_until.gte.${today}`);toast('Ended','good');openTemp(id);loadDashboard();};
  let tlat=null,tlon=null,tpin=null;
  const mini=L.map('tmini').setView([+data.permanent_latitude,+data.permanent_longitude],14);
  addBaseLayer(mini);
  L.marker([+data.permanent_latitude,+data.permanent_longitude],{opacity:.5}).addTo(mini).bindPopup('Home');
  mini.on('click',e=>{tlat=+e.latlng.lat.toFixed(6);tlon=+e.latlng.lng.toFixed(6);if(!tpin)tpin=L.marker([tlat,tlon]).addTo(mini);else tpin.setLatLng([tlat,tlon]);$('tState').textContent=`temp address ${tlat}, ${tlon}`;});
  setTimeout(()=>mini.invalidateSize(),200);
  $('tSave').onclick=async()=>{const bus=$('tBus').value?parseInt($('tBus').value,10):null;
    if(!bus&&tlat===null){toast('Set a temporary bus or a temporary address','bad');return;}
    const {error}=await db.from('student_temp_assignments').insert({student_id:id,temp_bus_no:bus,temp_latitude:tlat,temp_longitude:tlon,valid_from:$('tFrom').value||today,valid_until:$('tUntil').value||null,reason:$('tReason').value.trim()||null});
    if(error){toast(error.message.includes('temp_no_overlap')?'Overlaps an existing temporary arrangement':error.message,'bad');return;}
    toast('Temporary arrangement saved','good');openTemp(id);loadDashboard();};
}

/* ============ ROUTE MAP ============ */
async function openRouteMap(){
  if(!routeMap){routeMap=L.map('routemap').setView([school?school.latitude:27.578,school?school.longitude:75.137],11);
    addBaseLayer(routeMap);L.control.scale({imperial:false}).addTo(routeMap);}
  setTimeout(()=>routeMap.invalidateSize(),60);if(mapReady)return;
  const data=await fetchAll('bus_roster','sr_no,student_name,bus_id,pickup_order,latitude,longitude,depot_lat,depot_lon,bus_has_depot,road_km_to_school,road_min_to_school');
  const byBus={};data.forEach(s=>{if(s.latitude==null)return;(byBus[s.bus_id]=byBus[s.bus_id]||{stops:[],depot:s.bus_has_depot?[s.depot_lat,s.depot_lon]:null}).stops.push(s);});
  if(school)L.marker([school.latitude,school.longitude],{icon:L.divIcon({className:'',html:'<div style="font-size:22px">🏫</div>',iconSize:[22,22],iconAnchor:[11,11]}),zIndexOffset:1000}).addTo(routeMap).bindPopup('School');
  const leg=$('mapLegend');leg.innerHTML='';
  const busIds=Object.keys(byBus).sort((a,b)=>a-b);
  checkedBuses=new Set(busIds.map(String));
  const ctrl=document.createElement('div');ctrl.style.cssText='display:flex;align-items:center;gap:10px;padding:4px 4px 8px;border-bottom:1px solid var(--edge);margin-bottom:6px;font-size:12px';
  ctrl.innerHTML=`<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="mapSelAll" checked> Select all</label>
    <a href="#" id="mapDesel" style="margin-left:auto">Deselect all</a>`;
  leg.appendChild(ctrl);
  busIds.forEach(bus=>{const col=colorOf[bus]||'#666';const g=L.layerGroup().addTo(routeMap);const info=byBus[bus];
    const order=orderStops(info.stops,info.depot,school?[school.latitude,school.longitude]:null);
    const path=[];if(info.depot)path.push(info.depot);order.forEach(s=>path.push([s.latitude,s.longitude]));if(school)path.push([school.latitude,school.longitude]);
    L.polyline(path,{color:col,weight:2.5,opacity:.8}).addTo(g);
    order.forEach((s,i)=>{
      const road = s.road_min_to_school!=null ? `${s.road_min_to_school} min · ${s.road_km_to_school} km by road to school`
                   : `${hav(s.latitude,s.longitude,school.latitude,school.longitude).toFixed(1)} km straight-line to school`;
      const m=L.circleMarker([s.latitude,s.longitude],{radius:6,weight:1,color:'#fff',fillColor:col,fillOpacity:1});
      m.bindPopup(`<b>${esc(s.student_name)}</b><br>Bus ${bus} · pickup #${i+1}<br><span class="mono">${esc(s.sr_no)}</span><br>${road}<br><a href="#" data-nearest="${s.latitude},${s.longitude}" data-bus="${bus}">Show this bus + 3 nearest ▾</a><div class="nearbox"></div>`);
      m.on('popupopen',ev=>{const el=ev.popup.getElement().querySelector('a[data-nearest]');if(!el)return;
        el.onclick=async(e)=>{e.preventDefault();const [la,lo]=el.dataset.nearest.split(',').map(Number);const cur=el.dataset.bus;
          const box=ev.popup.getElement().querySelector('.nearbox');box.textContent='…';
          const {data:n}=await db.rpc('assign_impact',{p_lat:la,p_lon:lo,p_n:5});
          const others=(n||[]).filter(r=>String(r.bus_id)!==String(cur)).slice(0,3);
          setCheckedBuses([Number(cur),...others.map(r=>r.bus_id)]);
          box.innerHTML=`<div style="margin-top:4px">Now showing 4 buses:</div>Bus ${cur} (current)<br>`+
            others.map(r=>`Bus ${r.bus_id} · ${r.detour_km} km detour · ${r.seats_left} seats${r.has_room?'':' (full)'}`).join('<br>');};});
      m.addTo(g);});
    if(info.depot)L.marker(info.depot,{icon:L.divIcon({className:'',html:`<div style="width:11px;height:11px;background:${col};border:2px solid #fff;transform:rotate(45deg)"></div>`,iconSize:[13,13],iconAnchor:[6,6]})}).addTo(g).bindPopup('Bus '+bus+' depot');
    mapLayers[bus]=g;
    const row=document.createElement('label');row.className='legrow';
    row.innerHTML=`<input type="checkbox" class="legchk" data-bus="${bus}" checked><span class="sw" style="background:${col}"></span>Bus ${bus}<span class="cnt">${info.stops.length}</span>`;
    leg.appendChild(row);
    row.querySelector('.legchk').onchange=e=>{e.stopPropagation();toggleBus(bus,e.target.checked);syncSelAll();};
    row.querySelector('.sw').onclick=e=>{e.preventDefault();isolate(bus);};});
  $('mapSelAll').onchange=e=>{const on=e.target.checked;busIds.forEach(b=>toggleBus(b,on));[...leg.querySelectorAll('.legchk')].forEach(c=>c.checked=on);on&&fitMap();};
  $('mapDesel').onclick=e=>{e.preventDefault();busIds.forEach(b=>toggleBus(b,false));[...leg.querySelectorAll('.legchk')].forEach(c=>c.checked=false);$('mapSelAll').checked=false;};
  mapReady=true;
  $('mapAll').onclick=()=>{busIds.forEach(b=>toggleBus(b,true));[...leg.querySelectorAll('.legchk')].forEach(c=>c.checked=true);$('mapSelAll').checked=true;fitMap();};
  $('mapFit').onclick=fitMapChecked;fitMap();
}
function toggleBus(bus,on){const g=mapLayers[bus];if(!g)return;if(on){routeMap.addLayer(g);checkedBuses.add(String(bus));}else{routeMap.removeLayer(g);checkedBuses.delete(String(bus));}}
function syncSelAll(){const sa=$('mapSelAll');if(sa)sa.checked=(checkedBuses.size===Object.keys(mapLayers).length);}
function setCheckedBuses(ids){const want=new Set(ids.map(String));
  Object.keys(mapLayers).forEach(b=>{const on=want.has(String(b));toggleBus(b,on);const c=document.querySelector(`.legchk[data-bus="${b}"]`);if(c)c.checked=on;});
  syncSelAll();fitMapChecked();}
function isolate(bus){setCheckedBuses([bus]);}
function fitMapChecked(){const all=[];checkedBuses.forEach(b=>{const g=mapLayers[b];if(g)g.getLayers().forEach(l=>all.push(l));});if(all.length){const bb=L.featureGroup(all).getBounds();if(bb.isValid())routeMap.fitBounds(bb.pad(.15));}}
function fitMap(){const all=[];Object.values(mapLayers).forEach(g=>g.getLayers().forEach(l=>all.push(l)));if(all.length){const b=L.featureGroup(all).getBounds();if(b.isValid())routeMap.fitBounds(b.pad(.1));}}
/* use the saved pickup_order if present, else compute NN+2opt */
function orderStops(stops,depot,schoolPt){
  const withOrder=stops.filter(s=>s.pickup_order);
  if(withOrder.length>=stops.length*0.6)return stops.slice().sort((a,b)=>(a.pickup_order||9999)-(b.pickup_order||9999));
  if(stops.length<=2)return stops.slice();
  const P=stops.map(s=>[s.latitude,s.longitude]);let order=[],rem=stops.map((_,i)=>i),cur;
  if(depot)cur=depot;else if(schoolPt){let fi=0,fd=-1;rem.forEach(i=>{const d=hav(schoolPt[0],schoolPt[1],P[i][0],P[i][1]);if(d>fd){fd=d;fi=i;}});order.push(fi);rem=rem.filter(i=>i!==fi);cur=P[fi];}else cur=P[rem[0]];
  while(rem.length){let bi=rem[0],bd=1e9;rem.forEach(i=>{const d=hav(cur[0],cur[1],P[i][0],P[i][1]);if(d<bd){bd=d;bi=i;}});order.push(bi);rem=rem.filter(i=>i!==bi);cur=P[bi];}
  return order.map(i=>stops[i]);
}

/* ============ BULK ============ */
function renderBulk(){
  const opts=buses.map(b=>`<option value="${b.bus_id}">Bus ${b.bus_id} (${b.capacity} seats)</option>`).join('');
  $('bulkBody').innerHTML=`<h2 style="margin:0 0 12px">Bulk operations</h2>
    <div style="background:#fff;border:1px solid var(--edge);border-radius:8px;padding:16px;max-width:680px">
      <h3 style="margin:0 0 8px;font-size:15px">Permanently change the bus of selected students</h3>
      <div class="note" style="margin-bottom:12px">Add students by SR number, pick the new bus, then <b>Analyse impact</b> to see exactly what changes — capacity on every affected bus, route length, and annual fuel — before you commit. Pickup order on the old and new routes is reset.</div>
      <div class="grid">
        <div><label>Add students (SR numbers, comma or space separated)</label><input id="mvSrs" placeholder="e.g. 4542, 3073, 5044"/></div>
        <div><label>New bus</label><select id="mvTo">${opts}</select></div>
      </div>
      <div class="actions"><button class="b-primary" id="mvAnalyse">Analyse impact</button>
        <button class="b-signal" id="mvApply" disabled>Apply move</button>
        <span class="note" id="mvState"></span></div>
      <div id="mvOut" style="margin-top:12px"></div>
    </div>
    <div style="background:#fff;border:1px solid var(--edge);border-radius:8px;padding:16px;max-width:680px;margin-top:16px">
      <h3 style="margin:0 0 8px;font-size:15px">Upload a CSV</h3>
      <div class="note" style="margin-bottom:12px">Upload straight into the database from here. Pick what the file contains, choose the file, preview the match, then apply.</div>
      <div class="grid" style="margin-bottom:10px">
        <div><label>This file contains</label>
          <select id="csvKind">
            <option value="profiles">Student profiles (whole school)</option>
            <option value="pickup">Pickup order (sr_no, seating_order, bus_no)</option>
            <option value="busdetails">Bus details (driver / conductor / vehicle)</option>
          </select></div>
        <div><label>CSV file</label><input type="file" id="csvFile" accept=".csv,text/csv"/></div>
      </div>
      <div id="csvHint" class="note" style="margin-bottom:10px"></div>
      <div class="actions"><button class="b-primary" id="csvGo" disabled>Preview &amp; apply</button>
        <span class="note" id="csvState"></span></div>
      <div id="csvOut" style="margin-top:12px"></div>
    </div>`;
  bindCsvUpload();
  const parseSrs=()=>[...new Set(($('mvSrs').value||'').split(/[\s,]+/).map(x=>x.trim()).filter(Boolean))];
  $('mvAnalyse').onclick=async()=>{
    const srs=parseSrs(), to=parseInt($('mvTo').value,10);
    if(!srs.length){toast('Add at least one SR number','bad');return;}
    $('mvOut').innerHTML='<div class="hint">Calculating impact…</div>';$('mvApply').disabled=true;
    const {data,error}=await db.rpc('move_students_impact',{p_srs:srs,p_to:to});
    if(error){$('mvOut').innerHTML='<div class="note" style="color:var(--stop)">'+esc(error.message)+'</div>';return;}
    if(!data||!data.length){$('mvOut').innerHTML='<div class="note">No matching students with coordinates found for those SR numbers.</div>';return;}
    const tgt=data.find(r=>r.role==='target'), src=data.filter(r=>r.role==='source');
    const netFuel=data.reduce((a,r)=>a+Number(r.delta_annual_fuel||0),0);
    const rupee=n=>((n>=0?'+':'−')+'₹'+Math.abs(Math.round(n)).toLocaleString('en-IN'));
    const km=n=>((n>=0?'+':'−')+Math.abs(n).toFixed(2)+' km');
    let html=`<div style="background:#fff;border:1px solid var(--edge);border-radius:8px;overflow:auto"><table><thead><tr>
      <th>Bus</th><th>Role</th><th>Students</th><th>Riders now → after</th><th>Effective cap</th><th>Route Δ</th><th>Fuel/yr Δ</th></tr></thead><tbody>`;
    const rowHtml=r=>`<tr${r.role==='target'&&r.over_capacity?' style="background:#fdecea"':''}>
      <td>Bus ${r.bus_id}</td><td>${r.role}</td><td>${r.moved}</td>
      <td>${r.current_riders} → ${r.new_riders}${(r.role==='target'&&r.over_capacity)?' ⚠ OVER':''}</td>
      <td>${r.effective_capacity}</td><td>${km(Number(r.delta_route_km))}</td><td>${rupee(Number(r.delta_annual_fuel))}</td></tr>`;
    if(tgt)html+=rowHtml(tgt); src.forEach(r=>html+=rowHtml(r));
    html+=`</tbody></table></div>
      <div class="note" style="margin-top:10px">Net fleet fuel change: <b>${rupee(netFuel)}</b> per year.${tgt&&tgt.over_capacity?' <span style="color:var(--stop)">Target bus would exceed its effective capacity.</span>':''} Route and fuel figures are estimates from the current routes.</div>`;
    $('mvOut').innerHTML=html;
    $('mvApply').disabled=false;
    $('mvApply').dataset.srs=JSON.stringify(srs);$('mvApply').dataset.to=to;
  };
  $('mvApply').onclick=async()=>{
    const srs=JSON.parse($('mvApply').dataset.srs||'[]'), to=parseInt($('mvApply').dataset.to,10);
    if(!srs.length)return;
    if(!confirm(`Permanently move ${srs.length} student(s) to Bus ${to}? Their pickup order will be reset.`))return;
    const {error,count}=await db.from('students').update({bus_no:to,pickup_order:null,updated_by:'bulk_move'})
      .in('sr_no',srs).select('sr_no',{count:'exact'});
    if(error){toast(error.message,'bad');return;}
    toast(`Moved ${count} student(s) to Bus ${to}`,'good');
    $('mvOut').innerHTML=`<div class="note" style="color:var(--good)">Done — ${count} student(s) now on Bus ${to}. Set their pickup positions on the Pickup tab.</div>`;
    $('mvApply').disabled=true;mapReady=false;loadDashboard();
  };
}

/* ============ CSV UPLOAD ============ */
const CSV_HINTS={
  profiles:'Expected columns (header names are matched loosely): SR No, Student Name, Father\u2019s Name, Mother\u2019s Name, Date of Birth, Father\u2019s Mobile No, Mother\u2019s Mobile No, Class, Section, Gender, Home Address, Date of Admission, Previous School Name. Dates as DD-MM-YYYY. Rows are matched to students by SR No and stored as their profile.',
  pickup:'Expected columns: sr_no, seating_order (or pickup_order), bus_no. Each student\u2019s pickup position on their bus is set from this file.',
  busdetails:'Expected columns: bus_id, driver_name, driver_phone, conductor_name, conductor_phone, vehicle_no, model.'
};
function norm(s){return (s||'').toString().trim().toLowerCase().replace(/[^a-z0-9]/g,'');}
function pick(row, keys){ // find a value by any of several loose header names
  const map={}; for(const k in row) map[norm(k)]=row[k];
  for(const want of keys){ const v=map[norm(want)]; if(v!==undefined && String(v).trim()!=='') return String(v).trim(); }
  return null;
}
function isoDate(s){ if(!s)return null; const m=String(s).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); if(!m)return null;
  const[_,d,mo,y]=m; const dt=`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`; return dt; }
function digits(s){ if(!s)return null; const d=String(s).replace(/\D/g,''); return d||null; }
let csvRows=null, csvKind='profiles';
function bindCsvUpload(){
  const upd=()=>{ csvKind=$('csvKind').value; $('csvHint').textContent=CSV_HINTS[csvKind]; };
  $('csvKind').onchange=()=>{upd();$('csvOut').innerHTML='';};
  upd();
  $('csvFile').onchange=e=>{
    const f=e.target.files[0]; if(!f)return;
    $('csvState').textContent='Reading\u2026';
    Papa.parse(f,{header:true,skipEmptyLines:true,complete:res=>{
      csvRows=res.data; $('csvGo').disabled=csvRows.length===0;
      $('csvState').textContent=`${csvRows.length} rows read`;
      $('csvOut').innerHTML=`<div class="note">Columns found: ${Object.keys(csvRows[0]||{}).map(esc).join(', ')||'none'}</div>`;
    }});
  };
  $('csvGo').onclick=applyCsv;
}
async function chunkUpsert(table, rows, opts){ // opts.onConflict
  let done=0; const N=200;
  for(let i=0;i<rows.length;i+=N){
    const slice=rows.slice(i,i+N);
    const {error}=await db.from(table).upsert(slice, opts||{});
    if(error) throw error;
    done+=slice.length; $('csvState').textContent=`Saved ${done}/${rows.length}\u2026`;
  }
  return done;
}
async function applyCsv(){
  if(!csvRows||!csvRows.length){toast('Choose a CSV first','bad');return;}
  $('csvGo').disabled=true; $('csvOut').innerHTML='';
  try{
    if(csvKind==='profiles'){
      const recs=csvRows.map(r=>({
        sr_no: pick(r,['sr_no','sr no','srno','sr']),
        student_name: pick(r,['student_name','student name','name']),
        father_name: pick(r,["father's name",'father name','father_name','fathers name']),
        mother_name: pick(r,["mother's name",'mother name','mother_name','mothers name']),
        dob: isoDate(pick(r,['date of birth','dob','date_of_birth'])),
        father_phone: digits(pick(r,["father's mobile no",'father mobile','father_phone','father phone'])),
        mother_phone: digits(pick(r,["mother's mobile no",'mother mobile','mother_phone','mother phone'])),
        class: pick(r,['class']), section: pick(r,['section']), gender: pick(r,['gender']),
        home_address: pick(r,['home address','home_address','address']),
        admission_date: isoDate(pick(r,['date of admission','admission date','admission_date'])),
        previous_school: pick(r,['previous school name','previous school','previous_school'])
      })).filter(x=>x.sr_no);
      if(!recs.length){toast('No SR No column found','bad');$('csvGo').disabled=false;return;}
      const n=await chunkUpsert('student_profiles',recs,{onConflict:'sr_no'});
      // also backfill parent/phone on transport students for the panel fields
      $('csvOut').innerHTML=`<div class="note" style="color:var(--good)">Saved ${n} student profiles. Transport students will show these on their profile card.</div>`;
      toast(`Uploaded ${n} profiles`,'good'); loadDashboard();
    }
    else if(csvKind==='pickup'){
      const rows=csvRows.map(r=>({
        sr_no: pick(r,['sr_no','sr no','srno','sr']),
        order: parseInt(pick(r,['seating_order','pickup_order','seating order','pickup order','order'])||'',10),
        bus: parseInt(pick(r,['bus_no','bus','bus_id','bus no'])||'',10)
      })).filter(x=>x.sr_no && !isNaN(x.order));
      if(!rows.length){toast('Need sr_no and seating_order columns','bad');$('csvGo').disabled=false;return;}
      // clear affected buses' order first to avoid unique clashes, then set
      const busSet=[...new Set(rows.map(r=>r.bus).filter(b=>!isNaN(b)))];
      for(const b of busSet){ await db.from('students').update({pickup_order:null}).eq('bus_no',b); }
      let done=0,miss=0;
      for(const r of rows){
        const q=db.from('students').update({pickup_order:r.order,updated_by:'csv_upload'}).eq('sr_no',r.sr_no);
        const {error,count}=await (isNaN(r.bus)? q : q.eq('bus_no',r.bus)).select('sr_no',{count:'exact'});
        if(error) throw error; if(count) done++; else miss++;
        $('csvState').textContent=`Set ${done}\u2026`;
      }
      $('csvOut').innerHTML=`<div class="note" style="color:var(--good)">Set pickup order for ${done} students${miss?`; ${miss} SR not matched on the given bus`:''}.</div>`;
      toast(`Pickup order set for ${done}`,'good'); loadDashboard();
    }
    else if(csvKind==='busdetails'){
      const recs=csvRows.map(r=>({
        bus_id: parseInt(pick(r,['bus_id','bus','bus no','bus_no'])||'',10),
        driver_name: pick(r,['driver_name','driver name']), driver_phone: digits(pick(r,['driver_phone','driver phone'])),
        conductor_name: pick(r,['conductor_name','conductor name']), conductor_phone: digits(pick(r,['conductor_phone','conductor phone'])),
        vehicle_no: pick(r,['vehicle_no','vehicle no','vehicle']), model: pick(r,['model'])
      })).filter(x=>!isNaN(x.bus_id));
      if(!recs.length){toast('Need a bus_id column','bad');$('csvGo').disabled=false;return;}
      const n=await chunkUpsert('bus_details',recs,{onConflict:'bus_id'});
      $('csvOut').innerHTML=`<div class="note" style="color:var(--good)">Saved details for ${n} buses.</div>`;
      toast(`Uploaded ${n} bus records`,'good');
    }
  }catch(e){ $('csvOut').innerHTML=`<div class="note" style="color:var(--stop)">${esc(e.message||'Upload failed')}</div>`; toast('Upload failed','bad'); }
  $('csvGo').disabled=false;
}

/* ============ REPORTS (analytical) ============ */
const rupee=n=>'₹'+Math.round(Number(n||0)).toLocaleString('en-IN');
function repTable(cols,rows,title){
  const head=cols.map(c=>`<th>${esc(c.label)}</th>`).join('');
  const body=rows.map(r=>'<tr>'+cols.map(c=>`<td>${esc(c.fmt?c.fmt(r[c.k]):(r[c.k]??''))}</td>`).join('')+'</tr>').join('');
  return `<div class="actions" style="margin:6px 0"><button class="b-ghost repcsv" data-t="${esc(title)}">Download CSV</button><span class="note">${rows.length} rows</span></div>
    <div style="background:#fff;border:1px solid var(--edge);border-radius:8px;overflow:auto"><table data-title="${esc(title)}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function statCard(label,val,sub){return `<div class="stat"><b>${val}</b><span>${label}${sub?` · ${sub}`:''}</span></div>`;}
let repHeat=null, repHeatMode='students';
async function renderReports(){
  $('reportsBody').innerHTML=`<h2 style="margin:0 0 4px">Reports &amp; analytics</h2>
    <div class="note" style="margin-bottom:12px">Live analysis of the fleet, using the diesel price, working days and trips set in the parameters. Fuel and route numbers are model estimates; fees are actuals.</div>
    <div class="busbtns" id="repTabs">
      ${['Fuel efficiency','Capacity','Finance','Start points','Geography'].map((k,i)=>`<button data-r="${k}" class="${i===0?'on':''}">${k}</button>`).join('')}
    </div>
    <div id="repOut" style="margin-top:16px"></div>`;
  const tabs=[...$('repTabs').children];
  tabs.forEach(b=>b.onclick=()=>{tabs.forEach(x=>x.classList.remove('on'));b.classList.add('on');repSection(b.dataset.r);});
  repSection('Fuel efficiency');
}
async function repSection(which){
  const out=$('repOut');out.innerHTML='<div class="hint">Calculating…</div>';
  if(which==='Fuel efficiency'){
    const [{data:s},{data:rows}]=await Promise.all([
      db.from('report_fuel_summary').select('*').single(),
      db.from('report_fuel').select('*').order('cost_per_km',{ascending:false})]);
    out.innerHTML=`<div class="cards" style="margin-bottom:14px">
      ${statCard('Best mileage','Bus '+s.best_mileage_bus, s.best_mileage+' km/l')}
      ${statCard('Worst mileage','Bus '+s.worst_mileage_bus, s.worst_mileage+' km/l')}
      ${statCard('Avg cost / km', rupee(s.avg_cost_per_km))}
      ${statCard('Avg fuel / student', rupee(s.avg_fuel_per_student))}
      ${statCard('Total annual fuel', rupee(s.total_annual_fuel))}</div>
      <div class="note" style="margin-bottom:6px">Per bus, worst cost-per-km first — the buses to look at for re-routing or replacement.</div>`+
      repTable([{k:'bus_id',label:'Bus'},{k:'kmpl',label:'km/l'},{k:'students',label:'Students'},
        {k:'km_per_trip',label:'Km/trip'},{k:'cost_per_km',label:'Cost/km',fmt:rupee},
        {k:'fuel_per_student',label:'Fuel/student',fmt:rupee},{k:'annual_fuel',label:'Annual fuel',fmt:rupee}],rows||[],'fuel_efficiency');
  }
  else if(which==='Capacity'){
    const [{data:s},{data:rows}]=await Promise.all([
      db.from('report_capacity_summary').select('*').single(),
      db.from('report_capacity').select('*').order('utilisation_pct',{ascending:false})]);
    out.innerHTML=`<div class="cards" style="margin-bottom:14px">
      ${statCard('Average occupancy', s.avg_occupancy)}
      ${statCard('Peak occupancy', s.peak_occupancy,'Bus '+s.peak_bus)}
      ${statCard('Spare seats (fleet)', s.total_spare_seats)}
      ${statCard('Fleet utilisation', s.fleet_utilisation_pct+'%')}
      ${statCard('Over capacity', s.over_capacity_buses+' bus'+(s.over_capacity_buses==1?'':'es'))}
      ${statCard('Under 50% full', s.under_half_buses+' bus'+(s.under_half_buses==1?'':'es'))}</div>
      <div class="note" style="margin-bottom:6px">Utilisation = riders ÷ base capacity. Effective capacity includes the limit-break allowance.</div>`+
      repTable([{k:'bus_id',label:'Bus'},{k:'riders',label:'Riders'},{k:'capacity',label:'Capacity'},
        {k:'effective_capacity',label:'Effective'},{k:'spare',label:'Spare'},
        {k:'utilisation_pct',label:'Utilisation',fmt:v=>v+'%'}],rows||[],'capacity');
  }
  else if(which==='Finance'){
    const {data:f}=await db.from('report_finance').select('*').single();
    out.innerHTML=`<div class="cards" style="margin-bottom:14px">
      ${statCard('Annual revenue (fees)', rupee(f.annual_revenue))}
      ${statCard('Annual fuel expense', rupee(f.annual_fuel_expense))}
      ${statCard('Surplus over fuel', rupee(f.surplus_over_fuel))}
      ${statCard('Paying students', f.paying_students)}
      ${statCard('Average fee', rupee(f.avg_fee))}</div>
      <div class="note" style="max-width:680px">Surplus here is revenue minus <b>fuel only</b> — it does not include driver salaries, maintenance, insurance or depreciation, so it overstates true profit. <b>Outstanding transport fees</b> can't be shown yet because the database has each student's annual charge but no record of what's been paid. Add a <span class="mono">paid_amount</span> (or a payments table) and this becomes: outstanding = charged − paid. I can wire that in once fee-collection data exists.</div>`;
  }
  else if(which==='Start points'){
    const [{data:s},{data:rows}]=await Promise.all([
      db.from('report_deadrun_summary').select('*').single(),
      db.from('report_deadrun_full').select('*').order('dead_km',{ascending:false})]);
    out.innerHTML=`<div class="note" style="margin-bottom:10px">Every bus drives empty from its start point to its first student. That "dead run" burns fuel and time before a single child is aboard. Buses with a captured depot start there; the rest start from school. Distances are road-estimated.</div>
      <div class="cards" style="margin-bottom:14px">
        ${statCard('Start points too far', s.buses_far+' of '+s.buses_measured,'over 2 km')}
        ${statCard('Start from school', s.buses_from_school+' buses','no depot set')}
        ${statCard('Dead run / trip', s.total_dead_km_per_trip+' km')}
        ${statCard('Wasted fuel / yr', rupee(s.total_annual_dead_fuel))}
        ${statCard('Recoverable / yr', rupee(s.total_annual_savings_if_close),'if start ≤1.5 km')}</div>
      <div class="note" style="margin-bottom:6px">Per bus, worst dead-run first. "Start" shows whether the bus begins at its own depot or from school. "If close" = fuel saved per year if it started within 1.5 km of its first student.</div>`+
      repTable([{k:'bus_id',label:'Bus'},{k:'start_from',label:'Start'},{k:'first_student',label:'First student'},
        {k:'dead_km',label:'Dead run (km)'},{k:'dead_min_per_trip',label:'Dead min/trip'},
        {k:'annual_dead_fuel',label:'Wasted fuel/yr',fmt:rupee},
        {k:'savable_km',label:'Savable km',fmt:v=>Number(v).toFixed(2)},
        {k:'annual_savings_if_close',label:'Save/yr if ≤1.5km',fmt:rupee}],rows||[],'start_points_deadrun');
  }
  else if(which==='Geography'){
    out.innerHTML=`<div class="note" style="margin-bottom:8px">Where students live, where routes run, and which routes overlap.</div>
      <div class="actions" style="margin-bottom:8px">
        <button class="b-ghost heatbtn on" data-m="students">Student density</button>
        <button class="b-ghost heatbtn" data-m="routes">Route density</button></div>
      <div id="repMap" style="height:440px;border:1px solid var(--edge);border-radius:8px"></div>
      <h3 style="margin:16px 0 6px;font-size:15px">Route overlap — shared corridors</h3>
      <div class="note" style="margin-bottom:6px">Pairs where one bus’s route runs within 300 m of another’s. High overlap = candidates to consolidate.</div>
      <div id="repOverlap"></div>`;
    setTimeout(()=>buildGeography(),50);
  }
  out.querySelectorAll('.repcsv').forEach(b=>b.onclick=()=>downloadRepCsv(b.closest('#repOut').querySelector(`table[data-title="${b.dataset.t}"]`),b.dataset.t));
}
function downloadRepCsv(tbl,title){
  if(!tbl)return;const rows=[...tbl.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>`"${td.textContent.replace(/"/g,'""')}"`).join(','));
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));a.download=title+'.csv';a.click();
}
let repMap=null, repStudentPts=[], repRoutePts=[];
async function buildGeography(){
  if(!repMap){repMap=L.map('repMap').setView([school?school.latitude:27.578,school?school.longitude:75.137],11);
    addBaseLayer(repMap);}
  setTimeout(()=>repMap.invalidateSize(),60);
  const data=await fetchAll('bus_roster','latitude,longitude,pickup_order,bus_id');
  repStudentPts=(data||[]).filter(s=>s.latitude!=null).map(s=>[s.latitude,s.longitude,0.6]);
  // route density: sample midpoints between consecutive stops so corridors light up
  const byBus={};(data||[]).forEach(s=>{if(s.latitude!=null)(byBus[s.bus_id]=byBus[s.bus_id]||[]).push(s);});
  repRoutePts=[];
  Object.values(byBus).forEach(arr=>{arr.sort((a,b)=>(a.pickup_order||9999)-(b.pickup_order||9999));
    for(let i=0;i<arr.length-1;i++){const a=arr[i],b=arr[i+1];for(let t=0;t<=1;t+=0.25)repRoutePts.push([a.latitude+(b.latitude-a.latitude)*t,a.longitude+(b.longitude-a.longitude)*t,0.5]);}});
  drawHeat('students');
  [...document.querySelectorAll('.heatbtn')].forEach(b=>b.onclick=()=>{document.querySelectorAll('.heatbtn').forEach(x=>x.classList.remove('on'));b.classList.add('on');drawHeat(b.dataset.m);});
  const {data:ov}=await db.rpc('route_overlap',{p_metres:300});
  $('repOverlap').innerHTML=repTable([{k:'bus_a',label:'Bus A'},{k:'bus_b',label:'overlaps Bus B'},
    {k:'a_km',label:'A route km'},{k:'shared_km',label:'Shared km'},{k:'shared_pct',label:'Shared %',fmt:v=>v+'%'}],ov||[],'route_overlap');
  $('repOverlap').querySelectorAll('.repcsv').forEach(b=>b.onclick=()=>downloadRepCsv($('repOverlap').querySelector('table'),'route_overlap'));
}
function drawHeat(mode){
  if(!L.heatLayer)return;
  if(repHeat){repMap.removeLayer(repHeat);repHeat=null;}
  const pts=mode==='routes'?repRoutePts:repStudentPts;
  repHeat=L.heatLayer(pts,{radius:mode==='routes'?12:18,blur:15,maxZoom:14}).addTo(repMap);
}

/* ============ ASK (AI / GIS quick questions) ============ */
const QUESTIONS=[
  {q:'Which buses exceed capacity?',run:async()=>{const {data}=await db.from('bus_economics').select('bus_id,students,capacity').order('bus_id');
    const over=(data||[]).filter(r=>r.students>r.capacity);return table(['bus_id','students','capacity'],over.map(r=>({...r})),over.length?'':'No bus is over capacity.');}},
  {q:'Students within 2 km of a bus’s route…',ask:'Bus number',run:async(bus)=>{const {data,error}=await db.rpc('students_near_bus_route',{p_bus:parseInt(bus,10),p_metres:2000});
    if(error)return '<div class="note">'+esc(error.message)+'</div>';return table(['sr_no','student_name','current_bus','metres_from_route'],data||[],'None found.');}},
  {q:'Which temporary buses expire tomorrow?',run:async()=>{const {data}=await db.from('alerts').select('*').eq('kind','temp_ending');return table(['subject','detail'],data||[],'None expiring tomorrow.');}},
  {q:'Nearest buses to a location…',ask:'lat,lon (e.g. 27.60,75.14)',run:async(v)=>{const [la,lo]=v.split(',').map(Number);const {data,error}=await db.rpc('nearest_buses_to_point',{p_lat:la,p_lon:lo,p_n:5});if(error)return esc(error.message);return table(['bus_id','km','riders','capacity'],data||[]);}},
  {q:'Duplicate / shared pickup locations',run:async()=>{const {data}=await db.rpc('duplicate_pickup_locations');return table(['n','students'],(data||[]).slice(0,50),'None.');}},
  {q:'Suggest where to move students off an overloaded bus…',ask:'Bus number',run:async(bus)=>{const {data,error}=await db.rpc('students_near_bus_route',{p_bus:parseInt(bus,10),p_metres:1500});
    if(error)return esc(error.message);
    return '<div class="note" style="margin-bottom:8px">Students of other buses within 1.5 km of Bus '+esc(bus)+'’s route — candidates to absorb its overflow, or to move its students onto:</div>'+table(['sr_no','student_name','current_bus','metres_from_route'],(data||[]).slice(0,40),'None nearby.');}},
];
function table(cols,rows,empty){if(!rows||!rows.length)return `<div class="note">${empty||'No rows.'}</div>`;
  return `<div style="background:#fff;border:1px solid var(--edge);border-radius:8px;overflow:auto;margin-top:8px"><table><thead><tr>${cols.map(c=>`<th>${esc(c.replace(/_/g,' '))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>'<tr>'+cols.map(c=>`<td>${esc(r[c]??'')}</td>`).join('')+'</tr>').join('')}</tbody></table></div>`;}
/* ============ ADMISSION WIZARD / GEOGRAPHIC SUGGESTIONS ============ */
let admap,adpin,adReady=false;
function renderAdmission(){
  if(!admap){admap=L.map('admap').setView([school?school.latitude:27.578,school?school.longitude:75.137],12);
    addBaseLayer(admap);
    if(school)L.marker([school.latitude,school.longitude],{icon:L.divIcon({className:'',html:'<div style="font-size:20px">🏫</div>',iconSize:[20,20],iconAnchor:[10,10]})}).addTo(admap);
    admap.on('click',e=>{setAdPin(e.latlng.lat,e.latlng.lng);suggest(e.latlng.lat,e.latlng.lng);});}
  setTimeout(()=>admap.invalidateSize(),60);
  $('adGo').onclick=()=>{const p=($('adCoord').value||'').split(',').map(Number);
    if(p.length===2&&!isNaN(p[0])){setAdPin(p[0],p[1]);admap.setView([p[0],p[1]],15);suggest(p[0],p[1]);}
    else toast('Enter as: lat, lon','bad');};
}
function setAdPin(lat,lon){if(!adpin){adpin=L.marker([lat,lon],{draggable:true}).addTo(admap);
    adpin.on('dragend',()=>{const p=adpin.getLatLng();$('adCoord').value=`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;suggest(p.lat,p.lng);});}
  else adpin.setLatLng([lat,lon]);$('adCoord').value=`${(+lat).toFixed(6)}, ${(+lon).toFixed(6)}`;}
async function suggest(lat,lon){
  $('adOut').innerHTML='<div class="hint">Working out the detour, fuel and time for each bus…</div>';
  const {data,error}=await db.rpc('assign_impact',{p_lat:lat,p_lon:lon,p_n:4});
  if(error){$('adOut').innerHTML='<div class="note">'+esc(error.message)+'</div>';return;}
  if(!data||!data.length){$('adOut').innerHTML='<div class="note">No routes found.</div>';return;}
  const cell=(l,v)=>`<div class="coord" style="padding:6px 8px"><div class="k">${l}</div><div class="v">${v}</div></div>`;
  $('adOut').innerHTML=`<div class="note" style="margin-bottom:8px">The bus detours to collect the student. Lower detour = less added fuel and less delay for everyone already on board. Student’s own distance/time to school is road-estimated.</div>`+
    data.map(r=>`
    <div style="border:1px solid ${r.recommended?'var(--signal)':'var(--edge)'};border-radius:8px;padding:12px;margin-bottom:10px;background:${r.recommended?'#fff8e8':'#fff'}">
      <div style="display:flex;align-items:baseline;gap:8px"><b style="font-size:16px">Bus ${r.bus_id}</b>
        ${r.recommended?'<span class="flag" style="background:var(--signal);color:#000;border:none">Least detour, has room</span>':''}
        ${!r.has_room?'<span class="flag" style="color:var(--stop)">full</span>':''}</div>
      <div class="grid" style="margin:8px 0">
        ${cell('Route detour',r.detour_km+' km')}
        ${cell('Added fuel / yr','₹'+Number(r.extra_annual_fuel).toLocaleString('en-IN'))}
        ${cell('Adds to trip','+'+r.detour_min+' min')}
        ${cell('Student to school',r.student_km_school+' km · ~'+r.student_min_school+' min')}
        ${cell('Seats',r.seats_left+' of '+r.effective_capacity+' free')}
      </div>
      <button class="b-primary assignBtn" data-bus="${r.bus_id}" data-lat="${lat}" data-lon="${lon}" ${!r.has_room?'disabled':''} style="padding:6px 12px;font-size:12px">Assign to Bus ${r.bus_id}</button>
    </div>`).join('');
  [...document.querySelectorAll('.assignBtn')].forEach(b=>b.onclick=()=>assignAdmission(b.dataset));
}
async function assignAdmission(d){
  const sr=prompt('Enter the new student’s SR number to assign to Bus '+d.bus+':');if(!sr)return;
  const name=prompt('Student name (optional):')||('SR '+sr);
  const {error}=await db.from('students').update({bus_no:parseInt(d.bus,10),latitude:+(+d.lat).toFixed(6),longitude:+(+d.lon).toFixed(6)}).eq('sr_no',sr.trim());
  if(error){toast(error.message.includes('0 rows')||error.details? 'No student with SR '+sr+' — add them first, then assign':error.message,'bad');return;}
  toast(`Assigned ${name} to Bus ${d.bus}`,'good');loadDashboard();
}

/* ============ BUS PAGE ============ */
async function renderBusPage(){
  const opts=buses.map(b=>`<option value="${b.bus_id}">Bus ${b.bus_id}</option>`).join('');
  $('busPageBody').innerHTML=`<h2 style="margin:0 0 10px">Bus page</h2>
    <div style="max-width:220px;margin-bottom:16px"><label>Choose a bus</label><select id="bpSel">${opts}</select></div>
    <div id="bpBody"></div>`;
  $('bpSel').onchange=()=>loadBusPage(parseInt($('bpSel').value,10));
  loadBusPage(parseInt($('bpSel').value,10));
}
async function loadBusPage(bus){
  $('bpBody').innerHTML='<div class="hint">Loading…</div>';
  const [{data:cap},{data:econ},{data:det},{data:roster}]=await Promise.all([
    db.from('bus_capacity').select('*').eq('bus_id',bus).single(),
    db.from('bus_economics').select('*').eq('bus_id',bus).maybeSingle(),
    db.from('bus_details').select('*').eq('bus_id',bus).maybeSingle(),
    db.from('bus_roster').select('sr_no,student_name,pickup_order,road_min_to_school').eq('bus_id',bus).order('pickup_order',{nullsFirst:false})]);
  const d=det||{};
  const stat=(l,v)=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  const fld=(l,k)=>`<div><label>${l}</label><input id="bd_${k}" value="${esc(d[k]||'')}"/></div>`;
  const rows=(roster||[]).map(r=>`<tr><td>${r.pickup_order??'—'}</td><td>${esc(r.student_name)}</td><td class="mono">${esc(r.sr_no)}</td><td>${r.road_min_to_school!=null?r.road_min_to_school+' min':'—'}</td></tr>`).join('');
  $('bpBody').innerHTML=`
    <div class="cards" style="margin-bottom:16px">
      ${stat('Students',cap.riders)}${stat('Capacity',cap.capacity)}${stat('Effective cap',cap.effective_capacity)}
      ${stat('Seats free',Math.max(cap.effective_capacity-cap.riders,0))}
      ${econ?stat('Road km/trip',econ.road_km_per_trip):''}${econ?stat('Annual fuel',rs(econ.annual_fuel_cost)):''}</div>
    <div style="background:#fff;border:1px solid var(--edge);border-radius:8px;padding:16px;margin-bottom:16px;max-width:640px">
      <h3 style="margin:0 0 10px;font-size:15px">Driver, conductor &amp; vehicle</h3>
      <div class="grid">${fld('Driver name','driver_name')}${fld('Driver phone','driver_phone')}${fld('Conductor name','conductor_name')}${fld('Conductor phone','conductor_phone')}${fld('Vehicle no.','vehicle_no')}${fld('Model','model')}</div>
      <div class="actions"><button class="b-primary" id="bpSave">Save bus details</button><span class="note" id="bpState"></span></div>
    </div>
    <h3 style="margin:0 0 8px;font-size:15px">Today's students (${(roster||[]).length}) — in pickup order</h3>
    <div style="background:#fff;border:1px solid var(--edge);border-radius:8px;overflow:auto"><table><thead><tr><th>#</th><th>Name</th><th>SR</th><th>To school</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $('bpSave').onclick=async()=>{
    const rec={bus_id:bus};['driver_name','driver_phone','conductor_name','conductor_phone','vehicle_no','model'].forEach(k=>rec[k]=$('bd_'+k).value.trim()||null);
    const {error}=await db.from('bus_details').upsert(rec);
    if(error){toast(error.message,'bad');return;}toast('Bus details saved','good');};
}

// small gazetteer of Sikar-area places so "near Piprali" resolves without a geocoding key
const PLACES={piprali:[27.610,75.146],'radha kishanpura':[27.60,75.16],nawalgarh:[27.85,75.27],
  fatehpur:[27.99,74.96],reengus:[27.36,75.60],'sikar city':[27.61,75.14],khatushyamji:[27.39,75.42],
  ramgarh:[27.25,75.17],losal:[27.40,74.92],dhod:[27.50,75.13],palsana:[27.42,75.24]};
function parseAsk(q){
  const t=q.toLowerCase().trim();
  const busM=t.match(/bus\s*(\d{1,2})/);
  const place=Object.keys(PLACES).find(p=>t.includes(p));
  const kmM=t.match(/(\d+(?:\.\d+)?)\s*km/); const km=kmM?parseFloat(kmM[1])*1000:2000;
  // intent routing
  if(/exceed|over ?capacity|overload/.test(t)) return {run:QUESTIONS[0].run};
  if(/expir|ending|tomorrow/.test(t)) return {run:QUESTIONS[2].run};
  if(/duplicate|same (stop|location|pickup)|shared/.test(t)) return {run:QUESTIONS[4].run};
  if(place && /which bus|buses (near|go|pass)|near/.test(t)){
    const [la,lo]=PLACES[place];
    return {run:async()=>'<div class="note" style="margin-bottom:8px">Buses whose routes pass nearest '+esc(place)+':</div>'+
      table(['bus_id','walk_metres','km_to_school','seats_left','recommended'],
        await rpc('suggest_bus_for_point',{p_lat:la,p_lon:lo,p_n:6}))};
  }
  if(busM && /shift|move|near|within/.test(t)){
    const b=parseInt(busM[1],10);
    return {run:async()=>'<div class="note" style="margin-bottom:8px">Students within '+(km/1000)+' km of Bus '+b+'’s route (candidates to shift):</div>'+
      table(['sr_no','student_name','current_bus','metres_from_route'],(await rpc('students_near_bus_route',{p_bus:b,p_metres:km})).slice(0,50))};
  }
  if(busM){ const b=parseInt(busM[1],10);
    return {run:async()=>{const {data}=await db.from('bus_capacity').select('*').eq('bus_id',b);
      return table(['bus_id','capacity','effective_capacity','riders'],data||[],'No such bus.');}};}
  if(place){ const [la,lo]=PLACES[place];
    return {run:async()=>table(['bus_id','walk_metres','seats_left','recommended'],await rpc('suggest_bus_for_point',{p_lat:la,p_lon:lo,p_n:5}))};}
  return null;
}
async function rpc(fn,args){const {data,error}=await db.rpc(fn,args);if(error){console.error(error);return [];}return data||[];}
function renderAsk(){
  $('askBody').innerHTML=`<h2 style="margin:0 0 6px">Ask the data</h2>
    <div class="note" style="margin-bottom:12px">Ask in your own words, or tap a question below. Every answer runs a live PostGIS query on your database.</div>
    <div style="display:flex;gap:8px;margin-bottom:6px"><input id="askBox" placeholder="e.g. Which buses go near Piprali?  ·  Which students can be shifted to Bus 18?" autocomplete="off"/><button class="b-signal" id="askGo">Ask</button></div>
    <div class="note" style="margin-bottom:16px">Understood examples: "buses near Piprali", "students within 2 km of Bus 17", "which buses exceed capacity", "duplicate pickup locations", "temp buses expiring tomorrow". Fully open-ended questions need the AI edge function (see notes).</div>
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);margin-bottom:8px">Quick questions</div>
    <div id="qList">${QUESTIONS.map((x,i)=>`<button class="qbtn" data-i="${i}">${esc(x.q)}</button>`).join('')}</div>
    <div id="qOut" style="margin-top:14px"></div>`;
  const runFree=async()=>{const q=$('askBox').value.trim();if(!q)return;
    const parsed=parseAsk(q);$('qOut').innerHTML='<div class="hint">Working…</div>';
    if(!parsed){$('qOut').innerHTML='<div class="note">I couldn’t map that to a query yet. Try naming a bus number or a place (e.g. Piprali), or use a quick question. Open-ended natural language needs the AI edge function.</div>';return;}
    try{$('qOut').innerHTML=await parsed.run();}catch(e){$('qOut').innerHTML='<div class="note">'+esc(e.message||'error')+'</div>';}};
  $('askGo').onclick=runFree;$('askBox').addEventListener('keydown',e=>{if(e.key==='Enter')runFree();});
  [...$('qList').children].forEach(b=>b.onclick=async()=>{const x=QUESTIONS[+b.dataset.i];let arg=null;
    if(x.ask){arg=prompt(x.ask);if(arg===null)return;}
    $('qOut').innerHTML='<div class="hint">Running…</div>';$('qOut').innerHTML=await x.run(arg);});
}
window.addEventListener("DOMContentLoaded", async () => {
    await start();
});