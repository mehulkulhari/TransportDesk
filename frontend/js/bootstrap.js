import { initTemporary } from "./temporary.js";
import { buildPickupBtns } from "./pickup.js";
import { initEditMap } from "./maps.js";
import { getCurrentUser } from "./auth.js";
import { loadDashboard } from "./dashboard.js";
import { db } from "./supabase.js";
import { $, toast } from "./utils.js";
export async function start() {
  const user = await getCurrentUser();
  $('gate').style.display='none';$('app').style.display='grid';$('whoami').textContent=user?.email||'';
  const [{data:b},{data:sc},{data:bc}]=await Promise.all([
    db.from('buses').select('bus_id,capacity,latitude,longitude,mileage').order('bus_id'),
    db.from('schools').select('latitude,longitude,school_name').limit(1),
    db.from('bus_color').select('bus_id,color')]);
  buses=b||[];if(sc&&sc[0])school=sc[0];
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
