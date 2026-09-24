// Vehicles: the registry of physical buses — including the spares, which have no
// route of their own — and what each spare has done when it stood in for another.

import { vehicles, vehicleById, vLabel, routeSelect, fmtD, chip, val, num, busy, today, n0, downloadCsv } from './fleetkit.js';

export async function renderVehicles(el) {
  el.innerHTML = `<div class="fstack">
    <div class="fcard" id="vhSpare"><div class="hint">Loading…</div></div>
    <div class="fcard" id="vhReg"></div>
    <div class="fsplit"><div class="fcard" id="vhAdd"></div><div class="fcard" id="vhHist"></div></div></div>`;
  await Promise.all([spares(), registry(el), addForm(el), history()]);
}

/** Kilometres and fuel each spare ran, and whose route it covered. */
async function spares() {
  const vs = await vehicles(true), sp = vs.filter(v => v.is_spare);
  if (!sp.length) {
    $('vhSpare').innerHTML = `<h3>Spare buses</h3><div class="hint-box">No spare buses are registered yet. Add the two spares below
      and tick <b>Spare</b>. From then on, record their odometer and fuel on the <b>Daily km</b> and <b>Fuel</b> tabs
      like any other bus, choosing the route they covered — this table then shows everything they have done.</div>`;
    return;
  }
  const ids = sp.map(v => v.id);
  const [{ data: od }, { data: fu }] = await Promise.all([
    db.from('odometer_daily').select('vehicle_id,bus_id,recorded_on,km_run,reason').in('vehicle_id', ids).order('recorded_on', { ascending: false }),
    db.from('fuel_efficiency').select('vehicle_id,bus_id,recorded_on,litres,cost_effective,kmpl').in('vehicle_id', ids)]);
  const S = sp.map(v => {
    const o = (od || []).filter(r => r.vehicle_id === v.id && r.bus_id != null), f = (fu || []).filter(r => r.vehicle_id === v.id);
    const routes = {}; o.forEach(r => routes[r.bus_id] = (routes[r.bus_id] || 0) + 1);
    return { v, days: o.length, km: o.reduce((s, r) => s + Math.max(0, +r.km_run || 0), 0), L: f.reduce((s, r) => s + +r.litres, 0),
      C: f.reduce((s, r) => s + +(r.cost_effective || 0), 0), last: o[0]?.recorded_on,
      routes: Object.entries(routes).sort((a, b) => b[1] - a[1]).map(([b, n]) => `route ${b} ×${n}`).join(', '), log: o.slice(0, 12) };
  });
  $('vhSpare').innerHTML = `<h3>Spare buses</h3>
    <p class="lede">Every day a spare covered for a broken-down bus, with the kilometres and fuel it used. Recorded through
      <b>Daily km</b> and <b>Fuel</b>, choosing the route it covered.</p>
    <div class="cards" style="margin-bottom:12px">${S.map(s => `<div class="stat"><b>${n0(s.days)} days</b>
      <span>${esc(s.v.reg_no)} · ${n0(Math.round(s.km))} km · ${n0(Math.round(s.L))} L · ${rs(Math.round(s.C))}</span></div>`).join('')}</div>
    <div class="tscroll"><table><thead><tr><th>Spare</th><th>Routes covered</th><th>Last used</th><th>Recent days</th></tr></thead>
    <tbody>${S.map(s => `<tr><td>${esc(s.v.reg_no)}</td><td>${s.routes || '<span class="muted">not used yet</span>'}</td>
      <td>${s.last ? fmtD(s.last) : '—'}</td>
      <td>${s.log.map(r => `${fmtD(r.recorded_on)}: route ${r.bus_id}, ${r.km_run != null ? n0(r.km_run) + ' km' : 'first reading'}${r.reason ? ' — ' + esc(r.reason) : ''}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function registry(el) {
  const { data } = await db.from('vehicles').select('*').order('bus_id', { nullsFirst: false });
  const V = (data || []).sort((a, b) => (b.active - a.active) || ((a.bus_id ?? 1e4) - (b.bus_id ?? 1e4)) || a.reg_no.localeCompare(b.reg_no));
  const yr = new Date().getFullYear();
  $('vhReg').innerHTML = `<h3>Vehicle registry <span class="note">(${V.filter(v => v.active).length} in service)</span></h3>
    <p class="lede">A vehicle moves route by choosing a new one here — the move is dated automatically and kept in the history
      below. If the new route already has a vehicle, that vehicle becomes unassigned. Age is worked out from the year.</p>
    <div class="tscroll"><table><thead><tr><th>Registration</th><th>Route</th><th>Spare</th><th>Make</th><th class="num">Year</th>
      <th class="num">Age</th><th class="num">Seats</th><th>Tyre size</th><th>In service</th></tr></thead>
    <tbody>${V.map(v => `<tr data-id="${v.id}" class="${v.active ? '' : 'muted'}"><td class="mono"><input data-k="reg_no" value="${esc(v.reg_no)}" style="width:130px"/></td>
      <td>${routeSelect('vr' + v.id, v.bus_id, { blank: '—' }).replace('<select', '<select data-k="bus_id" style="width:110px"')}</td>
      <td><input type="checkbox" data-k="is_spare" ${v.is_spare ? 'checked' : ''} style="width:auto"/></td>
      <td><input data-k="make" value="${esc(v.make || '')}" style="width:120px"/></td>
      <td class="num"><input data-k="model_year" type="number" value="${v.model_year ?? ''}" style="width:78px"/></td>
      <td class="num">${v.model_year ? yr - v.model_year : '—'}</td>
      <td class="num"><input data-k="seats" type="number" value="${v.seats ?? ''}" style="width:64px"/></td>
      <td><input data-k="tyre_size" value="${esc(v.tyre_size || '')}" style="width:110px"/></td>
      <td><input type="checkbox" data-k="active" ${v.active ? 'checked' : ''} style="width:auto"/></td></tr>`).join('')}</tbody></table></div>
    <div class="actions"><button class="b-primary" id="vhSave">Save changes</button><button class="b-ghost" id="vhCsv">Download CSV</button>
      <span class="note">Only changed rows are saved.</span></div>`;
  const dirty = new Set();
  $('vhReg').querySelectorAll('tbody [data-k]').forEach(i => i.addEventListener(i.type === 'checkbox' || i.tagName === 'SELECT' ? 'change' : 'input',
    () => dirty.add(+i.closest('tr').dataset.id)));
  $('vhCsv').onclick = () => downloadCsv('vehicles', [{ label: 'Registration', k: 'reg_no' }, { label: 'Route', k: 'bus_id' },
    { label: 'Spare', k: 'is_spare' }, { label: 'Make', k: 'make' }, { label: 'Year', k: 'model_year' }, { label: 'Seats', k: 'seats' },
    { label: 'Tyre size', k: 'tyre_size' }, { label: 'In service', k: 'active' }], V);
  $('vhSave').onclick = async () => {
    if (!dirty.size) { toast('Nothing changed'); return; }
    const rows = [...dirty].map(id => { const tr = $('vhReg').querySelector(`tr[data-id="${id}"]`), r = { id };
      tr.querySelectorAll('[data-k]').forEach(i => r[i.dataset.k] = i.type === 'checkbox' ? i.checked
        : i.type === 'number' || i.dataset.k === 'bus_id' ? (i.value === '' ? null : +i.value) : i.value.trim());
      if (r.is_spare) r.bus_id = null;            // a spare has no route of its own
      return r; });
    const taken = rows.filter(r => r.bus_id != null).map(r => [r, V.find(v => v.bus_id === r.bus_id && v.id !== r.id && !dirty.has(v.id))]).filter(x => x[1]);
    if (taken.length && !confirm(taken.map(([r, o]) => `Route ${r.bus_id}: ${o.reg_no} will become unassigned.`).join('\n') + '\n\nContinue?')) return;
    busy($('vhSave'), true);
    // free the routes first — a route can hold one vehicle at a time
    for (const [, o] of taken) { const { error } = await db.from('vehicles').update({ bus_id: null }).eq('id', o.id); if (error) { busy($('vhSave'), false); toast(error.message, 'bad'); return; } }
    // only vehicles whose route really changes are cleared first (so two can swap routes) —
    // touching the rest would write a route change into the history that never happened
    const moved = rows.filter(r => r.bus_id != null && r.bus_id !== V.find(v => v.id === r.id)?.bus_id);
    for (const r of moved) { await db.from('vehicles').update({ bus_id: null }).eq('id', r.id); }
    for (const { id, ...r } of rows) {
      if (!r.reg_no) { busy($('vhSave'), false); toast('A registration number is required', 'bad'); return; }
      const { error } = await db.from('vehicles').update(r).eq('id', id);
      if (error) { busy($('vhSave'), false); toast(/reg_uidx/.test(error.message) ? `${r.reg_no} is already registered` : error.message, 'bad'); return; }
    }
    busy($('vhSave'), false); toast(`Saved ${rows.length} vehicle${rows.length > 1 ? 's' : ''}`, 'good');
    await vehicles(true); renderVehicles(el);
  };
}

async function addForm(el) {
  $('vhAdd').innerHTML = `<h3>Add a vehicle</h3>
    <p class="lede">For a spare, tick <b>Spare</b> and leave the route blank.</p>
    <div class="frow"><div class="field"><label for="vaR">Registration</label><input id="vaR" placeholder="RJ23 AB 1234"/></div>
      <div class="field"><label for="vaB">Route</label>${routeSelect('vaB', '', { blank: 'None' })}</div></div>
    <div class="field"><label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink)">
      <input type="checkbox" id="vaS" style="width:auto"/> Spare bus — stands in when another breaks down</label></div>
    <div class="frow"><div class="field"><label for="vaM">Make</label><input id="vaM"/></div>
      <div class="field"><label for="vaY">Year</label><input id="vaY" type="number" min="1990" max="${new Date().getFullYear() + 1}"/></div>
      <div class="field"><label for="vaSe">Seats</label><input id="vaSe" type="number" min="1" max="100"/></div>
      <div class="field"><label for="vaT">Tyre size</label><input id="vaT" placeholder="7.50-16 LT"/></div></div>
    <div class="field"><label for="vaBy">Data provided by</label><input id="vaBy"/></div>
    <div class="actions"><button class="b-primary" id="vaSave">Add vehicle</button></div>`;
  $('vaS').onchange = () => { if ($('vaS').checked) $('vaB').value = ''; $('vaB').disabled = $('vaS').checked; };
  $('vaSave').onclick = async () => {
    const reg = val('vaR'); if (!reg) { toast('Enter the registration', 'bad'); return; }
    const spare = $('vaS').checked, route = !spare && $('vaB').value ? +$('vaB').value : null;
    if (route && (await vehicles()).some(v => v.bus_id === route) &&
        !confirm(`Route ${route} already has a vehicle. It will become unassigned. Continue?`)) return;
    busy($('vaSave'), true);
    if (route) await db.from('vehicles').update({ bus_id: null }).eq('bus_id', route);
    const { error } = await db.from('vehicles').insert({ reg_no: reg, bus_id: route, is_spare: spare, make: val('vaM'),
      model_year: num('vaY'), seats: num('vaSe'), tyre_size: val('vaT'), provided_by: val('vaBy') });
    busy($('vaSave'), false);
    if (error) { toast(/reg_uidx/.test(error.message) ? 'That registration is already in the registry' : error.message, 'bad'); return; }
    toast(`${reg} added`, 'good'); await vehicles(true); renderVehicles(el);
  };
}

async function history() {
  const { data } = await db.from('vehicle_route_history').select('*').order('changed_at', { ascending: false }).limit(30);
  const H = (data || []).filter(h => h.changed_by_email !== null || h.to_date);
  $('vhHist').innerHTML = `<h3>Route changes</h3>
    <p class="lede">Which vehicle ran which route, and from when. Written automatically whenever a vehicle's route changes.</p>
    ${!H.length ? '<div class="note">No route changes since the registry was set up.</div>' : `<div class="tscroll"><table>
      <thead><tr><th>Vehicle</th><th>Route</th><th>From</th><th>To</th><th>By</th></tr></thead>
      <tbody>${H.map(h => `<tr><td>${esc(vLabel(vehicleById(h.vehicle_id)))}</td><td>${h.bus_id ?? '—'}</td><td>${fmtD(h.from_date)}</td>
        <td>${h.to_date ? fmtD(h.to_date) : chip('ok', 'Current')}</td><td class="muted">${esc(h.changed_by_email || '')}</td></tr>`).join('')}</tbody></table></div>`}`;
}
