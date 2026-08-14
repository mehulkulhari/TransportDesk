// Round-aware helpers. Round 1 is the whole fleet and the `students` table; Round 2 is a
// subset of buses carrying the small children in `students_round2`. Any picker or roster
// built from `buses` alone will wrongly offer Round-1-only buses while Round 2 is selected.

import { db } from "./supabase.js";

/** Bus ids that actually run the currently selected round, ascending. */
export async function roundBusIds(){
  if(globalThis.tdRound!==2) return (globalThis.buses||[]).map(b=>b.bus_id);
  const {data}=await db.from('students_round2').select('bus_no').eq('active',true);
  return [...new Set((data||[]).map(r=>r.bus_no).filter(v=>v!=null))].sort((a,b)=>a-b);
}

/**
 * Search the children of the currently selected round.
 * Returns rows shaped like the Round-1 `student_effective` rows the list renderer expects,
 * so both rounds can share the same UI.
 */
export async function searchRoundStudents(term,limit=40){
  term=(term||'').trim();
  if(globalThis.tdRound!==2){
    const {data}=await db.from('student_effective')
      .select('id,sr_no,student_name,bus_id,using_temp_address,using_temp_bus')
      .or(`student_name.ilike.%${term}%,sr_no.ilike.%${term}%`).limit(limit);
    return data||[];
  }
  const {data}=await db.from('students_round2')
    .select('id,sr_no,name,bus_no,class,section,pickup_order,latitude,longitude')
    .eq('active',true).or(`name.ilike.%${term}%,sr_no.ilike.%${term}%`).limit(limit);
  return (data||[]).map(r=>({id:r.id,sr_no:r.sr_no,student_name:r.name,bus_id:r.bus_no,
    klass:r.class,section:r.section,pickup_order:r.pickup_order,
    latitude:r.latitude,longitude:r.longitude,using_temp_address:false,using_temp_bus:false}));
}

Object.assign(globalThis, { roundBusIds, searchRoundStudents });
