// Moving a child between rounds.
//
// A child rides in exactly ONE round. Round 1 (classes 2-12) lives in `students`; Round 2
// (PG-1st) lives in `students_round2`. When a child changes round the row is written into
// the target table and the source row is DEACTIVATED rather than deleted, so the move is
// reversible and the history survives.
//
// Both tables are keyed by sr_no (`students` has a UNIQUE constraint, `students_round2` a
// partial unique index over active rows), so a re-entry updates the dormant row instead of
// creating a second one.

import { db } from "./supabase.js";
import { $, toast } from "./utils.js";

const esc = s => globalThis.esc(String(s ?? ''));

/** Which buses currently run a round, so the picker can show the realistic ones first. */
async function busesForRound(round){
  if(round === 2){
    const { data } = await db.from('students_round2').select('bus_no').eq('active', true);
    return [...new Set((data||[]).map(r=>r.bus_no).filter(v=>v!=null))].sort((a,b)=>a-b);
  }
  const { data } = await db.from('bus_roster').select('bus_id');
  return [...new Set((data||[]).map(r=>r.bus_id).filter(v=>v!=null))].sort((a,b)=>a-b);
}

/**
 * Ask which bus the child will ride in the target round.
 * Resolves to a bus id, or null if the user cancels.
 */
function askBus(name, toRound, runningIds, allBuses){
  return new Promise(resolve=>{
    const running = new Set(runningIds.map(String));
    const opts = allBuses.map(b=>{
      const runs = running.has(String(b.bus_id));
      return `<option value="${b.bus_id}">Bus ${b.bus_id} · ${b.capacity} seats${runs?'':' — does not run Round '+toRound+' yet'}</option>`;
    }).join('');
    const wrap = document.createElement('div');
    wrap.className = 'modalwrap';
    wrap.innerHTML = `
      <div class="modalcard" role="dialog" aria-modal="true" aria-labelledby="rmTitle">
        <h3 id="rmTitle">Move ${esc(name)} to Round ${toRound}</h3>
        <p class="note">
          They will ride with <b>Round ${toRound}</b> from now on and be taken off the
          Round ${toRound===2?1:2} rosters. Pick the bus they will travel on.
        </p>
        <div class="field" style="margin-top:12px">
          <label for="rmBus">Bus for Round ${toRound}</label>
          <select id="rmBus">${opts}</select>
        </div>
        <p class="note" id="rmWarn" style="min-height:18px"></p>
        <p class="note">
          Their pickup order is cleared on both buses — set it on the Pickup order tab, and
          re-run the Round 2 route so the distances stay correct.
        </p>
        <div class="actions" style="justify-content:flex-end">
          <button class="b-ghost" id="rmCancel">Cancel</button>
          <button class="b-primary" id="rmGo">Move to Round ${toRound}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const sel = wrap.querySelector('#rmBus');
    const warn = wrap.querySelector('#rmWarn');
    // default to a bus that actually runs the target round
    const firstRunning = allBuses.find(b=>running.has(String(b.bus_id)));
    if(firstRunning) sel.value = String(firstRunning.bus_id);
    const check = () => {
      warn.textContent = running.has(sel.value)
        ? '' : `Bus ${sel.value} has no Round ${toRound} children yet — this starts a new Round ${toRound} route for it.`;
      warn.style.color = running.has(sel.value) ? '' : 'var(--temp)';
    };
    sel.onchange = check; check();
    const close = v => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if(e.key==='Escape') close(null); };
    document.addEventListener('keydown', onKey);
    wrap.onclick = e => { if(e.target===wrap) close(null); };
    wrap.querySelector('#rmCancel').onclick = () => close(null);
    wrap.querySelector('#rmGo').onclick = () => close(parseInt(sel.value,10));
    setTimeout(()=>sel.focus(), 30);
  });
}

/**
 * Move one child between rounds.
 * @param sr_no    the child (the key both tables share)
 * @param toRound  1 or 2
 * @returns true when the move was written
 */
export async function moveStudentRound(sr_no, toRound){
  const sr = String(sr_no);
  const from = toRound === 2 ? 1 : 2;

  // read the live row from the source round
  let src;
  if(from === 1){
    const { data, error } = await db.from('students')
      .select('id,sr_no,name,class,section,bus_no,latitude,longitude').eq('sr_no', sr).eq('active', true).maybeSingle();
    if(error){ toast(error.message,'bad'); return false; }
    src = data;
  }else{
    const { data, error } = await db.from('students_round2')
      .select('id,sr_no,name,class,section,bus_no,latitude,longitude').eq('sr_no', sr).eq('active', true).maybeSingle();
    if(error){ toast(error.message,'bad'); return false; }
    src = data;
  }
  if(!src){ toast(`SR ${sr} is not an active Round ${from} student`,'bad'); return false; }

  const [runningIds, allBuses] = await Promise.all([
    busesForRound(toRound),
    Promise.resolve(globalThis.buses || []),
  ]);
  if(!allBuses.length){ toast('Bus list not loaded — reload the page','bad'); return false; }

  const bus = await askBus(src.name, toRound, runningIds, allBuses);
  if(bus == null) return false;                      // cancelled

  if(toRound === 2){
    // Into Round 2: revive a dormant row for this child if one exists, else insert.
    const { data: existing, error: exErr } = await db.from('students_round2')
      .select('id').eq('sr_no', sr).maybeSingle();
    if(exErr){ toast(exErr.message,'bad'); return false; }
    const rec = { sr_no: sr, name: src.name, class: src.class, section: src.section,
      bus_no: bus, latitude: src.latitude, longitude: src.longitude,
      pickup_order: null, active: true, updated_at: new Date().toISOString(), updated_by: 'round_move' };
    const { error: wErr } = existing
      ? await db.from('students_round2').update(rec).eq('id', existing.id)
      : await db.from('students_round2').insert(rec);
    if(wErr){ toast(wErr.message,'bad'); return false; }
    // only stand the child down from Round 1 once Round 2 holds them
    const { error: dErr } = await db.from('students')
      .update({ active: false, pickup_order: null, updated_by: 'round_move' }).eq('id', src.id);
    if(dErr){ toast('Added to Round 2 but could not deactivate the Round 1 row: '+dErr.message,'bad'); return false; }
  }else{
    // Into Round 1: students.sr_no is UNIQUE, so a dormant row must be updated, not inserted.
    const { data: existing, error: exErr } = await db.from('students')
      .select('id').eq('sr_no', sr).maybeSingle();
    if(exErr){ toast(exErr.message,'bad'); return false; }
    const rec = { sr_no: sr, name: src.name, class: src.class, section: src.section,
      bus_no: bus, latitude: src.latitude, longitude: src.longitude,
      pickup_order: null, active: true, uses_transport: true, updated_by: 'round_move' };
    const { error: wErr } = existing
      ? await db.from('students').update(rec).eq('id', existing.id)
      : await db.from('students').insert(rec);
    if(wErr){ toast(wErr.message,'bad'); return false; }
    const { error: dErr } = await db.from('students_round2')
      .update({ active: false, pickup_order: null, updated_by: 'round_move' }).eq('id', src.id);
    if(dErr){ toast('Added to Round 1 but could not deactivate the Round 2 row: '+dErr.message,'bad'); return false; }
  }

  toast(`${src.name} now rides Round ${toRound} on Bus ${bus} — set their pickup order`,'good');
  return true;
}

Object.assign(globalThis, { moveStudentRound });
