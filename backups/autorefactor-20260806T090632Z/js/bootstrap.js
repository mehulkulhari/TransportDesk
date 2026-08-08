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
  const [{data:b},{data:sc}]=await Promise.all([
    db.from('buses').select('bus_id,capacity,latitude,longitude,mileage').order('bus_id'),
    db.from('schools').select('latitude,longitude,school_name').limit(1)]);
  buses=b||[];if(sc&&sc[0])school=sc[0];
  buses.forEach((x,i)=>colorOf[x.bus_id]=`hsl(${Math.round(i*137.5)%360} 70% 45%)`);
 initEditMap();
 buildPickupBtns();
 initTemporary();
 loadDashboard();
}
