import { db } from "./supabase.js";
import { $, toast } from "./utils.js";
/* ============ TEMPORARY ============ */
export function initTemporary() {
  let ttimer;

  $('tq').addEventListener('input', e => {
    clearTimeout(ttimer);
    ttimer = setTimeout(() => searchTemp(e.target.value), 220);
  });
}
export async function searchTemp(term){term=term.trim();if(term.length<2){$('tresults').innerHTML='<div class="hint">Search a student.</div>';return;}
  const {data}=await db.from('student_effective').select('id,sr_no,student_name,bus_id,using_temp_address,using_temp_bus').or(`student_name.ilike.%${term}%,sr_no.ilike.%${term}%`).limit(40);
  renderList($('tresults'),data,openTemp);}
export async function openTemp(id){
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
