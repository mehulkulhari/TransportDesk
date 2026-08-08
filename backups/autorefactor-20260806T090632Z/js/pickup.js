import { db } from "./supabase.js";
import { $, toast } from "./utils.js";
/* ============ PICKUP ORDER ============ */
let pkBus=null,pkRows=[],dragSr=null;
export function buildPickupBtns(){
  $('pkBusBtns').innerHTML=buses.map(b=>`<button data-bus="${b.bus_id}">${b.bus_id}</button>`).join('');
  [...$('pkBusBtns').children].forEach(el=>el.onclick=()=>{[...$('pkBusBtns').children].forEach(x=>x.classList.remove('on'));el.classList.add('on');loadPickup(parseInt(el.dataset.bus,10));});
}
export async function loadPickup(bus){pkBus=bus;
  const {data,error}=await db.from('bus_roster').select('sr_no,student_name,pickup_order,capacity').eq('bus_id',bus);
  if(error){$('pkWrap').innerHTML='<div class="hint">'+esc(error.message)+'</div>';return;}
  pkRows=data||[];const cap=pkRows[0]?.capacity||0;
  const ordered=pkRows.filter(r=>r.pickup_order).sort((a,b)=>a.pickup_order-b.pickup_order);
  const unset=pkRows.filter(r=>!r.pickup_order);
  const maxPos=Math.max(pkRows.length,...ordered.map(r=>r.pickup_order),0);
  const byPos={};ordered.forEach(r=>byPos[r.pickup_order]=r);
  let cells='';for(let n=1;n<=maxPos;n++){const r=byPos[n];
    cells+=r?`<div class="seat" draggable="true" data-sr="${r.sr_no}" data-pos="${n}"><span class="n">${n}</span><span style="flex:1">${esc(r.student_name)} <span class="note mono">${esc(r.sr_no)}</span></span></div>`
            :`<div class="seat empty" data-pos="${n}"><span class="n">${n}</span><span>empty — drop here</span></div>`;}
  $('pkWrap').innerHTML=`<div style="display:flex;align-items:center;margin-bottom:8px">
      <div class="pill"><b>Bus ${bus}</b><span>bus</span></div><div class="pill"><b>${ordered.length}/${pkRows.length}</b><span>ordered</span></div>
      <div class="pill"><b>${cap||'?'}</b><span>seats</span></div>
      <div class="note" style="margin-left:auto">This is the order students are picked up along the route. Drag to swap positions.</div></div>
    <div class="seatgrid">${cells}</div>
    ${unset.length?`<h3 style="margin:18px 0 6px;font-size:14px">Not yet in the pickup order — drag onto a position</h3>
      <div class="seatgrid">${unset.map(r=>`<div class="seat" draggable="true" data-sr="${r.sr_no}" data-pos=""><span class="n">–</span><span style="flex:1">${esc(r.student_name)} <span class="note mono">${esc(r.sr_no)}</span></span></div>`).join('')}</div>`:''}`;
  wirePkDrag();
}
function wirePkDrag(){document.querySelectorAll('#v-pickup .seat').forEach(el=>{
  el.addEventListener('dragstart',()=>{dragSr=el.dataset.sr;el.classList.add('drag');});
  el.addEventListener('dragend',()=>el.classList.remove('drag'));
  el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('over');});
  el.addEventListener('dragleave',()=>el.classList.remove('over'));
  el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('over');
    const tPos=el.dataset.pos?parseInt(el.dataset.pos,10):null;const tSr=el.dataset.sr||null;
    if(dragSr)movePickup(dragSr,tPos,tSr);});});}
async function movePickup(sr,tPos,tSr){
  const src=pkRows.find(r=>r.sr_no===sr);if(!src)return;const srcPos=src.pickup_order||null;
  try{
    let err=null;
    if(tSr&&tSr!==sr){
      ({error:err}=await db.from('students').update({pickup_order:null}).eq('sr_no',tSr));
      if(!err)({error:err}=await db.from('students').update({pickup_order:tPos}).eq('sr_no',sr));
      if(!err)({error:err}=await db.from('students').update({pickup_order:srcPos}).eq('sr_no',tSr));
    } else {
      ({error:err}=await db.from('students').update({pickup_order:tPos}).eq('sr_no',sr));
    }
    if(err) toast(err.message||'Could not update','bad');
    else toast('Pickup order updated','good');
  }catch(e){toast(e.message||'Could not update','bad');}
  loadPickup(pkBus);
}