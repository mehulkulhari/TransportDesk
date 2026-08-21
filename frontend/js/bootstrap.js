import { initTemporary } from "./temporary.js";
import { buildPickupBtns } from "./pickup.js";
import { initEditMap } from "./maps.js";
import { getCurrentUser } from "./auth.js";
import { loadDashboard } from "./dashboard.js";
import { db } from "./supabase.js";
import { $, toast } from "./utils.js";
export async function start() {
  const user = await getCurrentUser();
  $('gate').style.display='none';$('app').style.display='flex';$('whoami').textContent=user?.email||'';
  const [busQ,schoolQ,colorQ]=await Promise.all([
    db.from('buses').select('bus_id,capacity,latitude,longitude,mileage').order('bus_id'),
    db.from('schools').select('latitude,longitude,school_name').limit(1),
    db.from('bus_color').select('bus_id,color')]);
  // The fleet list drives EVERY bus dropdown in the app (Bulk, Students, Temporary,
  // Admission, Bus page). Swallowing an error here leaves them all silently empty with no
  // hint anything went wrong, so a failure has to be loud and the load has to be retried.
  const {data:b,error:busErr}=busQ, {data:sc}=schoolQ, {data:bc}=colorQ;
  if(busErr || !b || !b.length){
    $('app').style.display='none'; $('gate').style.display='flex';
    $('gateMsg').innerHTML='<span style="color:#b42318">Could not load the bus list'+
      (busErr?': '+esc(busErr.message):'')+'. Sign in again to retry — do not use Bulk until the bus list loads.</span>';
    console.error('bus list failed to load',busErr);
    return;
  }
  buses=b;if(sc&&sc[0])school=sc[0];
  // Colours come from a graph-colouring of the fleet: buses whose students are within
  // 900 m of each other are "adjacent" and are guaranteed different, visually-distant
  // colours. Falls back to a hue spread if the table is unavailable.
  const byId={}; (bc||[]).forEach(r=>byId[r.bus_id]=r.color);
  buses.forEach((x,i)=>colorOf[x.bus_id]= byId[x.bus_id] || `hsl(${Math.round(i*137.5)%360} 70% 45%)`);
 initEditMap();
 buildPickupBtns();
 initTemporary();
 loadDashboard();
}
