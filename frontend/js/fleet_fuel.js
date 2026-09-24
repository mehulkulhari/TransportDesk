// Fuel log: litres, price and bill amount for every fill. With the odometer at each
// fill, mileage is measured tank to tank against the vehicle's own normal; a fill
// more than 15% away from it in either direction needs a reason.
//
// This is also the ground truth for buses.mileage, which every cost figure in the
// app divides by. The fleet table below shows where the two disagree.

import { vehicles, vehicleById, vLabel, vehicleSelect, routeSelect, bindVehicleRoute, auditFields,
         readAudit, auditLine, fmtD, chip, num, val, busy, today, n0, deactivate, downloadCsv } from './fleetkit.js';

const TOL = 0.15;
let sel = null;

export async function renderFuel(el) {
  const vs = await vehicles();
  sel = sel || vs[0]?.id;
  el.innerHTML = `<div class="fsplit">
    <div class="fcard"><h3>Record a fill</h3>
      <p class="lede">Mileage needs the odometer reading at each fill. If this fill's mileage is far from the bus's
        normal, you will be asked why.</p>
      <div class="field"><label for="fuV">Vehicle</label>${vehicleSelect('fuV', sel)}</div>
      <div class="field"><label for="fuR">Route covered</label>${routeSelect('fuR', vehicleById(sel)?.bus_id)}</div>
      <div class="frow">${auditFields('fu', { dateLabel: 'Fill date' })}</div>
      <div class="frow">
        <div class="field"><label for="fuL">Litres</label><input id="fuL" type="number" min="0" step="0.01"/></div>
        <div class="field"><label for="fuP">Price per litre (₹)</label><input id="fuP" type="number" min="0" step="0.01"/></div>
        <div class="field"><label for="fuC">Cost (₹)</label><input id="fuC" type="number" min="0" step="0.01" placeholder="from the bill"/></div>
        <div class="field"><label for="fuO">Odometer at fill</label><input id="fuO" type="number" min="0" step="1"/></div>
      </div>
      <div class="field"><label for="fuS">Filling station</label><input id="fuS" list="fuStations"/><datalist id="fuStations"></datalist></div>
      <div id="fuLive" class="hint-box" style="margin-bottom:12px">Enter litres and the odometer reading to see this fill's mileage.</div>
      <div class="field" id="fuWhyF" hidden><label for="fuWhy">Why is mileage off normal?</label>
        <textarea id="fuWhy" rows="2" placeholder="e.g. AC used all day, long idle at an event, fill not logged last time"></textarea></div>
      <div class="field"><label for="fuN">Notes</label><input id="fuN"/></div>
      <div class="actions"><button class="b-primary" id="fuSave">Save fill</button></div></div>
    <div class="fstack"><div class="fcard" id="fuHist"></div><div class="fcard" id="fuFleet"></div></div></div>`;
  bindVehicleRoute('fuV', 'fuR');
  $('fuV').onchange = () => { sel = +$('fuV').value; history(); liveCalc(); };
  const recost = () => { const l = num('fuL'), p = num('fuP');
    if (l && p && !$('fuC').dataset.touched) $('fuC').value = (l * p).toFixed(2); liveCalc(); };
  $('fuL').oninput = recost; $('fuP').oninput = recost;
  $('fuC').oninput = () => { $('fuC').dataset.touched = $('fuC').value ? '1' : ''; liveCalc(); };
  $('fuO').oninput = liveCalc;
  $('fuSave').onclick = () => save(el);
  const { data: st } = await db.from('fuel_logs').select('station').not('station', 'is', null).limit(300);
  $('fuStations').innerHTML = [...new Set((st || []).map(r => r.station))].map(s => `<option value="${esc(s)}">`).join('');
  await Promise.all([history(), fleet()]);
}

let HIST = [];
async function history() {
  const { data } = await db.from('fuel_efficiency').select('*').eq('vehicle_id', sel)
    .order('recorded_on', { ascending: false }).order('id', { ascending: false }).limit(15);
  HIST = data || [];
  const v = vehicleById(sel), withK = HIST.filter(r => r.kmpl != null);
  const avg = withK.length ? withK.slice(0, 10).reduce((s, r) => s + +r.kmpl, 0) / Math.min(10, withK.length) : null;
  const ref = HIST[0]?.reference_kmpl;
  $('fuHist').innerHTML = `<h3>${esc(vLabel(v))} — recent fills</h3>
    <p class="lede">${avg ? `Normal for this vehicle: <b>${avg.toFixed(2)} km/L</b> over its last ${Math.min(10, withK.length)} measured fills.` : 'No measured fills yet — mileage needs two fills with odometer readings.'}
      ${ref ? ` The cost analysis assumes <b>${ref} km/L</b>.` : ''}</p>
    <div class="tscroll"><table><thead><tr><th>Date</th><th class="num">Litres</th><th class="num">₹/L</th><th class="num">Cost</th>
      <th class="num">Odometer</th><th class="num">Km</th><th class="num">km/L</th><th class="num">vs normal</th><th>Reason / source</th><th></th></tr></thead>
    <tbody>${HIST.map(r => `<tr class="${r.deviated && !r.reason ? 'reasonrow' : ''}"><td>${fmtD(r.recorded_on)}</td>
      <td class="num">${r.litres}</td><td class="num">${r.price_per_litre ?? '—'}</td><td class="num">${r.cost_effective != null ? rs(Math.round(r.cost_effective)) : '—'}</td>
      <td class="num">${n0(r.odo_at_fill)}</td><td class="num">${n0(r.km_since_fill)}</td><td class="num"><b>${r.kmpl ?? '—'}</b></td>
      <td class="num">${r.deviation_pct != null ? (r.deviated ? chip('due_soon', (r.deviation_pct > 0 ? '+' : '') + r.deviation_pct + '%') : (r.deviation_pct > 0 ? '+' : '') + r.deviation_pct + '%') : ''}</td>
      <td>${r.reason ? esc(r.reason) : r.deviated ? `<div style="display:flex;gap:6px"><input class="why" data-id="${r.id}" placeholder="Reason"/><button class="b-ghost linkbtn addWhy" data-id="${r.id}">Save</button></div>` : ''}${auditLine(r)}</td>
      <td><button class="b-ghost linkbtn" data-del="${r.id}">Remove</button></td></tr>`).join('')
      || '<tr><td colspan="10" class="muted">No fills recorded for this vehicle.</td></tr>'}</tbody></table></div>`;
  $('fuHist').querySelectorAll('.addWhy').forEach(b => b.onclick = async () => {
    const why = $('fuHist').querySelector(`.why[data-id="${b.dataset.id}"]`).value.trim();
    if (!why) { toast('Write the reason first', 'bad'); return; }
    const { error } = await db.from('fuel_logs').update({ reason: why }).eq('id', +b.dataset.id);
    if (error) { toast(error.message, 'bad'); return; }
    toast('Reason saved', 'good'); history(); fleet();
  });
  $('fuHist').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (await deactivate('fuel_logs', b.dataset.del, 'fill')) { history(); fleet(); }
  });
  liveCalc();
}

/** Mileage of the fill being typed, against this vehicle's normal. */
function liveCalc() {
  const l = num('fuL'), o = num('fuO'), box = $('fuLive'), why = $('fuWhyF');
  why.hidden = true;
  const prev = HIST.find(r => r.odo_at_fill != null);
  if (!l || o == null) { box.innerHTML = 'Enter litres and the odometer reading to see this fill’s mileage.'; return; }
  if (!prev) { box.innerHTML = 'This is the first fill with an odometer reading — mileage starts from the next one.'; return; }
  const km = o - prev.odo_at_fill;
  if (km <= 0) { box.innerHTML = `${chip('expired', 'check')} The odometer is not above the last fill (${n0(prev.odo_at_fill)} on ${fmtD(prev.recorded_on)}).`; return; }
  const kmpl = km / l, withK = HIST.filter(r => r.kmpl != null).slice(0, 10);
  const avg = withK.length ? withK.reduce((s, r) => s + +r.kmpl, 0) / withK.length : null;
  let msg = `<b>${n0(km)} km</b> since the last fill on ${fmtD(prev.recorded_on)} → <b>${kmpl.toFixed(2)} km/L</b>`;
  if (avg && withK.length >= 3) {
    const d = (kmpl - avg) / avg;
    msg += ` against a normal ${avg.toFixed(2)} (${d > 0 ? '+' : ''}${(100 * d).toFixed(0)}%)`;
    if (Math.abs(d) > TOL) { msg = chip('due_soon', 'off normal') + ' ' + msg; why.hidden = false; }
    else msg = chip('ok') + ' ' + msg;
  } else msg += ` <span class="muted">— a normal needs 3 measured fills (${withK.length} so far)</span>`;
  box.innerHTML = msg;
}

async function save(el) {
  const v = vehicleById($('fuV').value), route = $('fuR').value, a = readAudit('fu');
  const l = num('fuL'), p = num('fuP'), c = num('fuC'), o = num('fuO');
  if (!l || l <= 0) { toast('Enter the litres filled', 'bad'); $('fuL').focus(); return; }
  if (v.is_spare && !route) { toast('Pick the route this spare covered', 'bad'); $('fuR').focus(); return; }
  if (a.recorded_on > today()) { toast('The date cannot be in the future', 'bad'); return; }
  if (!$('fuWhyF').hidden && !val('fuWhy')) { toast('Give the reason mileage is off normal', 'bad'); $('fuWhy').focus(); return; }
  if (p && c && Math.abs(l * p - c) / c > 0.02 &&
      !confirm(`Litres × price is ₹${(l * p).toFixed(0)} but the cost entered is ₹${c.toFixed(0)}. The cost from the bill will be used. Continue?`)) return;
  busy($('fuSave'), true);
  const { error } = await db.from('fuel_logs').insert({
    vehicle_id: v.id, bus_id: route ? +route : null, litres: l, price_per_litre: p, cost: c, odo_at_fill: o,
    station: val('fuS'), reason: val('fuWhy'), notes: val('fuN'), ...a });
  busy($('fuSave'), false);
  if (error) { toast(error.message, 'bad'); return; }
  toast('Fill saved', 'good'); sel = v.id; renderFuel(el);
}

/** Every vehicle: logged mileage against the figure the cost analysis uses. */
async function fleet() {
  const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const { data } = await db.from('fuel_efficiency').select('vehicle_id,recorded_on,litres,cost_effective,kmpl,deviated,reason,reference_kmpl')
    .gte('recorded_on', since);
  const by = {};
  (data || []).forEach(r => { const g = by[r.vehicle_id] || (by[r.vehicle_id] = { L: 0, C: 0, k: [], open: 0, ref: r.reference_kmpl });
    g.L += +r.litres; g.C += +(r.cost_effective || 0); if (r.kmpl != null) g.k.push(+r.kmpl); if (r.deviated && !r.reason) g.open++; });
  const rows = (await vehicles()).filter(v => by[v.id]).map(v => { const g = by[v.id];
    const avg = g.k.length ? g.k.reduce((s, x) => s + x, 0) / g.k.length : null;
    return { v, L: g.L, C: g.C, fills: g.k.length, avg, ref: g.ref, diff: avg && g.ref ? 100 * (avg - g.ref) / g.ref : null, open: g.open }; });
  $('fuFleet').innerHTML = `<h3>Fleet mileage <span class="note">(last 120 days)</span></h3>
    <p class="lede">"Costing uses" is the km/L every fuel and dead-run figure in the app divides by. Where the
      logged mileage disagrees by a lot, that figure should be updated — and every saving estimate with it.</p>
    ${!rows.length ? '<div class="note">No fills logged yet.</div>' : `<div class="tscroll"><table><thead><tr><th>Vehicle</th>
      <th class="num">Litres</th><th class="num">Cost</th><th class="num">Measured fills</th><th class="num">Logged km/L</th>
      <th class="num">Costing uses</th><th class="num">Difference</th><th>Unexplained</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(vLabel(r.v))}</td><td class="num">${n0(Math.round(r.L))}</td><td class="num">${rs(Math.round(r.C))}</td>
        <td class="num">${r.fills}</td><td class="num"><b>${r.avg ? r.avg.toFixed(2) : '—'}</b></td><td class="num">${r.ref ?? '—'}</td>
        <td class="num">${r.diff != null ? (Math.abs(r.diff) > 10 ? chip('due_soon', (r.diff > 0 ? '+' : '') + r.diff.toFixed(0) + '%') : (r.diff > 0 ? '+' : '') + r.diff.toFixed(0) + '%') : ''}</td>
        <td>${r.open ? chip('due_soon', r.open + ' fill' + (r.open > 1 ? 's' : '')) : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="actions"><button class="b-ghost" id="fuCsv">Download CSV</button></div>`}`;
  if ($('fuCsv')) $('fuCsv').onclick = () => downloadCsv('fleet-mileage', [
    { label: 'Vehicle', csv: r => vLabel(r.v) }, { label: 'Litres', csv: r => r.L.toFixed(1) }, { label: 'Cost', csv: r => Math.round(r.C) },
    { label: 'Measured fills', k: 'fills' }, { label: 'Logged km/L', csv: r => r.avg?.toFixed(2) }, { label: 'Costing uses', k: 'ref' },
    { label: 'Difference %', csv: r => r.diff?.toFixed(1) }], rows);
}
