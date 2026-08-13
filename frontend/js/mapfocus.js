// Map focus helpers: un-stacking students who share an address, highlighting a proposed
// move (which children, and which bus should take them), and drawing a new pickup order.
// All of these are driven by URL params so the Optimization tab can deep-link into a new tab.

let focusLayer = null;      // highlight overlay (cleared on each new focus)
let spiderLayer = null;     // leader lines for fanned-out stops
let spiderOpen = null;      // key of the currently fanned group

const KEY = (lat, lon) => Number(lat).toFixed(5) + ',' + Number(lon).toFixed(5);

/* ---------- 1. stops that share one address ---------- */
// Students at the same door render as one dot, so only the top name is reachable.
// Clicking such a dot fans the group out into a ring; clicking the map collapses it.
export function enableStopFanOut(){
  if(!globalThis.routeMap || !globalThis.studentMarkers) return;
  const groups = {};
  studentMarkers.forEach(s=>{ (groups[KEY(s.lat,s.lon)] = groups[KEY(s.lat,s.lon)] || []).push(s); });

  Object.entries(groups).forEach(([key, list])=>{
    if(list.length < 2) return;
    list.forEach(s=>{
      s.marker.bindTooltip(`${list.length} students here — click to open`, {direction:'top'});
      s.marker.on('click', ev=>{
        if(spiderOpen === key){ collapse(); return; }
        collapse();
        fan(key, list);
        if(ev && ev.originalEvent) ev.originalEvent.stopPropagation();
      });
    });
  });
  routeMap.on('click', collapse);
}

function fan(key, list){
  spiderLayer = L.layerGroup().addTo(routeMap);
  const c = [list[0].lat, list[0].lon];
  const zoom = routeMap.getZoom();
  const r = Math.max(18, 90 - zoom * 3);              // px radius, tighter as you zoom in
  const cp = routeMap.latLngToLayerPoint(c);
  list.forEach((s, i)=>{
    const a = (2*Math.PI*i)/list.length - Math.PI/2;
    const p = L.point(cp.x + r*Math.cos(a), cp.y + r*Math.sin(a));
    const ll = routeMap.layerPointToLatLng(p);
    L.polyline([c, ll], {color:'#1f2933', weight:1, opacity:.5, dashArray:'2,3'}).addTo(spiderLayer);
    const col = (globalThis.colorOf && colorOf[s.bus]) || '#666';
    L.marker(ll, {icon: L.divIcon({className:'', iconSize:[null,null], html:
      `<div style="white-space:nowrap;background:#fff;border:2px solid ${col};border-radius:12px;
        padding:2px 8px;font-size:12px;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer">
        ${esc(s.display||'')} <span style="color:#666;font-weight:400">· ${s.bus}</span></div>`})})
      .addTo(spiderLayer)
      .on('click', e=>{ L.DomEvent.stopPropagation(e); s.marker.openPopup(); });
  });
  spiderOpen = key;
}
function collapse(){ if(spiderLayer){ routeMap.removeLayer(spiderLayer); spiderLayer=null; } spiderOpen=null; }

/* ---------- 2. highlight a proposed move ---------- */
// srs = children to move, destBus = the bus that should take them.
export function focusMove(srs, destBus){
  if(!globalThis.routeMap || !srs || !srs.length) return;
  if(focusLayer) routeMap.removeLayer(focusLayer);
  focusLayer = L.layerGroup().addTo(routeMap);
  const want = new Set(srs.map(String));
  const hits = studentMarkers.filter(s=>want.has(String(s.sr_no)));
  if(!hits.length) return;
  const destCol = (globalThis.colorOf && colorOf[destBus]) || '#087443';
  const pts = [];

  hits.forEach(s=>{
    pts.push([s.lat, s.lon]);
    L.circleMarker([s.lat,s.lon], {radius:16, color:'#b42318', weight:3, opacity:.95,
      fillColor:'#b42318', fillOpacity:.15}).addTo(focusLayer);
    L.marker([s.lat,s.lon], {icon:L.divIcon({className:'', iconSize:[null,null], html:
      `<div style="transform:translate(14px,-28px);white-space:nowrap;background:#b42318;color:#fff;
        border-radius:11px;padding:2px 9px;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.4)">
        ${esc(s.display||'')} · bus ${s.bus} → ${destBus}</div>`})}).addTo(focusLayer);
  });

  // arrow from the group to the nearest stop on the receiving bus
  if(destBus){
    const destStops = studentMarkers.filter(s=>String(s.bus)===String(destBus));
    if(destStops.length){
      const mid = [pts.reduce((a,p)=>a+p[0],0)/pts.length, pts.reduce((a,p)=>a+p[1],0)/pts.length];
      let best=null, bd=Infinity;
      destStops.forEach(d=>{ const dd=(d.lat-mid[0])**2+(d.lon-mid[1])**2; if(dd<bd){bd=dd;best=d;} });
      if(best){
        L.polyline([mid,[best.lat,best.lon]], {color:destCol, weight:4, opacity:.9, dashArray:'8,6'}).addTo(focusLayer);
        L.circleMarker([best.lat,best.lon], {radius:11, color:destCol, weight:4, fillColor:'#fff', fillOpacity:1}).addTo(focusLayer);
        L.marker([best.lat,best.lon], {icon:L.divIcon({className:'', iconSize:[null,null], html:
          `<div style="transform:translate(14px,-10px);white-space:nowrap;background:${destCol};color:#fff;
            border-radius:11px;padding:2px 9px;font-size:12px;font-weight:700">Bus ${destBus} takes them</div>`})}).addTo(focusLayer);
        pts.push([best.lat,best.lon]);
      }
    }
  }
  routeMap.fitBounds(L.latLngBounds(pts).pad(0.45));
}

/* ---------- 3. draw a bus's NEW pickup order ---------- */
export async function showNewOrder(busId){
  if(!globalThis.routeMap) return;
  const { data } = await db.from('opt_resequence').select('new_order,now_km,opt_km,save_rs').eq('bus_id',busId).maybeSingle();
  if(!data || !data.new_order){ toast('No new order stored for bus '+busId,'bad'); return; }
  if(focusLayer) routeMap.removeLayer(focusLayer);
  focusLayer = L.layerGroup().addTo(routeMap);
  const bySr = {}; studentMarkers.forEach(s=>{ if(String(s.bus)===String(busId)) bySr[String(s.sr_no)] = s; });
  const seq = data.new_order.split(';').map(x=>bySr[x]).filter(Boolean);
  if(!seq.length){ toast('Order could not be matched to stops','bad'); return; }
  const col = (globalThis.colorOf && colorOf[busId]) || '#0b6e4f';
  const path = seq.map(s=>[s.lat,s.lon]);
  if(globalThis.school) path.push([school.latitude, school.longitude]);
  L.polyline(path, {color:col, weight:5, opacity:.65, dashArray:'10,7'}).addTo(focusLayer);
  seq.forEach((s,i)=>{
    L.marker([s.lat,s.lon], {icon:L.divIcon({className:'', iconSize:[26,26], iconAnchor:[13,13], html:
      `<div style="width:26px;height:26px;border-radius:50%;background:${col};color:#fff;border:2px solid #fff;
        display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
        box-shadow:0 1px 4px rgba(0,0,0,.45)">${i+1}</div>`})})
      .addTo(focusLayer).bindPopup(`<b>#${i+1} ${esc(s.display||'')}</b><br>Bus ${busId} — proposed order<br><span class="mono">SR ${esc(s.sr_no)}</span>`);
  });
  routeMap.fitBounds(L.latLngBounds(path).pad(0.15));
  toast(`Bus ${busId}: proposed order — ${data.now_km} → ${data.opt_km} km`,'good');
}

Object.assign(globalThis, { enableStopFanOut, focusMove, showNewOrder });
