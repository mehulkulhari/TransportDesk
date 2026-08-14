import { db } from "./supabase.js";
import { $, toast } from "./utils.js";
import { roundBusIds, searchRoundStudents } from "./rounds.js";
/* ============ PICKUP ORDER ============ */
let pkBus=null,pkRows=[],dragSr=null;
// Round 2 keeps its children in their own table, so every read and write here has to follow
// the selected round or Round 2 would list — and reorder — Round-1 students.
const r2=()=>globalThis.tdRound===2;
const editTable=()=>r2()?'students_round2':'students';
// sr_no is only unique per bus in Round 2's table, so pin writes to the open bus
const scopeBus=q=>r2()?q.eq('bus_no',pkBus):q;
export async function buildPickupBtns(){
  const ids=await roundBusIds();
  $('pkBusBtns').innerHTML=ids.map(id=>`<button data-bus="${id}">${id}</button>`).join('');
  [...$('pkBusBtns').children].forEach(el=>el.onclick=()=>{[...$('pkBusBtns').children].forEach(x=>x.classList.remove('on'));el.classList.add('on');loadPickup(parseInt(el.dataset.bus,10));});
}
export async function loadPickup(bus){pkBus=bus;
  let data,error;
  if(r2()){
    ({data,error}=await db.from('students_round2').select('sr_no,name,pickup_order').eq('bus_no',bus).eq('active',true));
    data=(data||[]).map(r=>({sr_no:r.sr_no,student_name:r.name,pickup_order:r.pickup_order,
      capacity:(buses.find(b=>String(b.bus_id)===String(bus))||{}).capacity||0}));
  }else{
    ({data,error}=await db.from('bus_roster').select('sr_no,student_name,pickup_order,capacity').eq('bus_id',bus));
  }
  if(error){$('pkWrap').innerHTML='<div class="hint">'+esc(error.message)+'</div>';return;}
  pkRows=data||[];const cap=pkRows[0]?.capacity||0;
  const ordered=pkRows.filter(r=>r.pickup_order).sort((a,b)=>a.pickup_order-b.pickup_order);
  const unset=pkRows.filter(r=>!r.pickup_order);
  const maxPos=Math.max(pkRows.length,...ordered.map(r=>r.pickup_order),0);
  const byPos={};ordered.forEach(r=>byPos[r.pickup_order]=r);
  let cells='';for(let n=1;n<=maxPos;n++){const r=byPos[n];
    cells+=r?`<div class="seat" draggable="true" data-sr="${r.sr_no}" data-pos="${n}"><span class="n">${n}</span><span style="flex:1">${esc(r.student_name)} <span class="note mono">${esc(r.sr_no)}</span></span></div>`
            :`<div class="seat empty" data-pos="${n}"><span class="n">${n}</span><span>empty — drop here</span></div>`;}
  $('pkWrap').innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <div class="pill"><b>Bus ${bus}</b><span>bus</span></div><div class="pill"><b>${ordered.length}/${pkRows.length}</b><span>ordered</span></div>
      <div class="pill"><b>${cap||'?'}</b><span>seats</span></div>
      <button class="b-primary" id="pkAdd" style="margin-left:auto;padding:6px 11px">+ Add student to this bus</button></div>
    <div class="note" style="margin:0 0 8px">This is the order students are picked up along the route. Drag to swap positions.</div>
    <div id="pkAddBox" style="display:none;background:#fff;border:1px solid var(--edge);border-radius:8px;padding:10px 12px;margin-bottom:10px">
      <label>Find a student to move onto Bus ${bus} (takes the next free seat)</label>
      <input id="pkAddIn" placeholder="name or SR number" autocomplete="off" style="width:100%;padding:6px 9px;border:1px solid var(--edge);border-radius:5px;margin-top:4px"/>
      <div id="pkAddRes" class="results" style="max-height:220px;margin-top:6px"></div>
    </div>
    <div class="seatgrid">${cells}</div>
    ${unset.length?`<h3 style="margin:18px 0 6px;font-size:14px">Not yet in the pickup order — drag onto a position</h3>
      <div class="seatgrid">${unset.map(r=>`<div class="seat" draggable="true" data-sr="${r.sr_no}" data-pos=""><span class="n">–</span><span style="flex:1">${esc(r.student_name)} <span class="note mono">${esc(r.sr_no)}</span></span></div>`).join('')}</div>`:''}`;
  wirePkDrag();
  let addTimer;
  $('pkAdd').onclick=()=>{const box=$('pkAddBox');const show=box.style.display==='none';box.style.display=show?'block':'none';if(show)$('pkAddIn').focus();};
  $('pkAddIn').oninput=e=>{clearTimeout(addTimer);addTimer=setTimeout(()=>pkSearchAdd(e.target.value),220);};
}

async function pkSearchAdd(term){term=(term||'').trim();
  if(term.length<2){$('pkAddRes').innerHTML='<div class="hint">Type a name or SR number.</div>';return;}
  const data=await searchRoundStudents(term,20);
  const rows=(data||[]).filter(s=>String(s.bus_id)!==String(pkBus));
  if(!rows.length){$('pkAddRes').innerHTML='<div class="hint">No other-bus student matches.</div>';return;}
  $('pkAddRes').innerHTML=rows.map(s=>`<div class="item" data-id="${s.id}" data-name="${esc(s.student_name)}">
    <span class="nm">${esc(s.student_name)}</span><span class="sr mono">${esc(s.sr_no)}</span><span class="bs">now Bus ${esc(s.bus_id??'—')}</span></div>`).join('');
  [...$('pkAddRes').querySelectorAll('.item')].forEach(el=>el.onclick=()=>pkAssign(el.dataset.id,el.dataset.name));
}

async function pkAssign(id,name){
  // next free pickup position on this bus (1..)
  const used=new Set(pkRows.filter(r=>r.pickup_order).map(r=>r.pickup_order));
  let pos=1; while(used.has(pos)) pos++;
  const cap=pkRows[0]?.capacity||0;
  if(cap && pkRows.length>=cap && !confirm(`Bus ${pkBus} is at capacity (${pkRows.length}/${cap}). Add ${name} anyway?`)) return;
  const {error}=await db.from(editTable()).update({bus_no:pkBus,pickup_order:pos}).eq('id',id);
  if(error){toast(error.message.includes('uniq_bus_pickup')?`Seat ${pos} already taken — try again`:error.message,'bad');return;}
  toast(`${name} added to Bus ${pkBus} at seat ${pos}`,'good');
  loadPickup(pkBus);
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
      ({error:err}=await scopeBus(db.from(editTable()).update({pickup_order:null}).eq('sr_no',tSr)));
      if(!err)({error:err}=await scopeBus(db.from(editTable()).update({pickup_order:tPos}).eq('sr_no',sr)));
      if(!err)({error:err}=await scopeBus(db.from(editTable()).update({pickup_order:srcPos}).eq('sr_no',tSr)));
    } else {
      ({error:err}=await scopeBus(db.from(editTable()).update({pickup_order:tPos}).eq('sr_no',sr)));
    }
    if(err) toast(err.message||'Could not update','bad');
    else toast('Pickup order updated','good');
  }catch(e){toast(e.message||'Could not update','bad');}
  loadPickup(pkBus);
}