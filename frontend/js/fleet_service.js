// Service: when each vehicle is next due, by distance and by date, from its last
// service and its latest odometer reading. Intervals are per vehicle and editable.

import { vehicles, vehicleById, vLabel, vehicleSelect, auditFields, readAudit, auditLine,
         fmtD, chip, num, val, busy, today, n0, deactivate } from './fleetkit.js';

const RANK = { overdue: 0, due_soon: 1, no_record: 2, no_odometer: 3, no_plan: 4, ok: 5 };
let sel = null;

export async function renderService(el) {
  const vs = await vehicles();
  sel = sel || vs[0]?.id;
  el.innerHTML = `<div class="fstack">
    <div class="fcard" id="svStatus"><div class="hint">Loading…</div></div>
    <div class="fsplit">
      <div class="fcard"><h3>Record a service</h3>
        <p class="lede">The odometer at the service is what the next due point is counted from. Put the
          workshop bill under <b>Bills</b> as well.</p>
        <div class="field"><label for="svV">Vehicle</label>${vehicleSelect('svV', sel)}</div>
        <div class="frow">${auditFields('sv', { dateLabel: 'Service date' })}</div>
        <div class="frow">
          <div class="field"><label for="svO">Odometer at service</label><input id="svO" type="number" min="0" step="1"/></div>
          <div class="field"><label for="svC">Cost (₹)</label><input id="svC" type="number" min="0" step="1"/></div></div>
        <div class="field"><label for="svW">Workshop</label><input id="svW"/></div>
        <div class="field"><label for="svD">Work done</label><textarea id="svD" rows="2" placeholder="Oil and filter, brake pads, …"></textarea></div>
        <div class="actions"><button class="b-primary" id="svSave">Save service</button></div></div>
      <div class="fstack"><div class="fcard" id="svHist"></div><div class="fcard" id="svPlan"></div></div></div></div>`;
  $('svV').onchange = () => { sel = +$('svV').value; history(); plan(); };
  $('svSave').onclick = () => save(el);
  await Promise.all([status(), history(), plan()]);
}

async function status() {
  const { data } = await db.from('service_status').select('*');
  const rows = (data || []).sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) ||
    (a.km_remaining ?? 1e9) - (b.km_remaining ?? 1e9) || (a.bus_id ?? 1e4) - (b.bus_id ?? 1e4));
  const c = s => rows.filter(r => r.status === s).length;
  $('svStatus').innerHTML = `<h3>Service status</h3>
    <p class="lede">${c('overdue')} overdue · ${c('due_soon')} due within 1,000 km or 15 days ·
      ${c('no_record')} with no service on record · ${c('no_odometer')} waiting for an odometer reading from <b>Daily km</b>.</p>
    <div class="tscroll"><table><thead><tr><th>Vehicle</th><th>Status</th><th class="num">Every</th>
      <th>Last service</th><th class="num">Odometer now</th><th class="num">Due at</th><th class="num">Left</th></tr></thead>
    <tbody>${rows.map(r => `<tr data-v="${r.vehicle_id}" style="cursor:pointer"><td>${esc(vLabel(vehicleById(r.vehicle_id)))}</td>
      <td>${chip(r.status)}</td>
      <td class="num">${[r.interval_km ? n0(r.interval_km) + ' km' : '', r.interval_days ? r.interval_days + ' days' : ''].filter(Boolean).join(' / ') || '—'}</td>
      <td>${r.last_odo != null || r.last_on ? `${r.last_on ? fmtD(r.last_on) : '<span class="muted">date unknown</span>'}${r.last_odo != null ? ` <span class="mono">@ ${n0(r.last_odo)}</span>` : ''}` : '<span class="muted">none</span>'}</td>
      <td class="num">${r.current_odo != null ? n0(r.current_odo) + `<span class="audit">${fmtD(r.odo_on)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="num">${[r.next_due_km != null ? n0(r.next_due_km) + ' km' : '', r.next_due_on ? fmtD(r.next_due_on) : ''].filter(Boolean).join('<br>') || '—'}</td>
      <td class="num">${[r.km_remaining != null ? n0(r.km_remaining) + ' km' : '', r.days_remaining != null ? r.days_remaining + ' days' : ''].filter(Boolean).join('<br>') || '—'}</td></tr>`).join('')}</tbody></table></div>`;
  $('svStatus').querySelectorAll('tr[data-v]').forEach(tr => tr.onclick = () => {
    sel = +tr.dataset.v; $('svV').value = sel; history(); plan(); $('svV').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

async function history() {
  const { data } = await db.from('service_events').select('*').eq('vehicle_id', sel).eq('active', true)
    .order('recorded_on', { ascending: false, nullsFirst: false }).order('odo_km', { ascending: false });
  $('svHist').innerHTML = `<h3>${esc(vLabel(vehicleById(sel)))} — services</h3>
    <div class="tscroll"><table><thead><tr><th>Date</th><th class="num">Odometer</th><th>Work done</th><th class="num">Cost</th><th></th></tr></thead>
    <tbody>${(data || []).map(r => `<tr><td>${r.recorded_on ? fmtD(r.recorded_on) : '<span class="muted">unknown</span>'}</td>
      <td class="num">${n0(r.odo_km)}</td><td>${esc(r.work_done || '')}${r.workshop ? `<span class="audit">${esc(r.workshop)}</span>` : ''}${r.notes ? `<span class="audit">${esc(r.notes)}</span>` : ''}${auditLine(r)}</td>
      <td class="num">${r.cost != null ? rs(r.cost) : ''}</td><td><button class="b-ghost linkbtn" data-del="${r.id}">Remove</button></td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">No services recorded.</td></tr>'}</tbody></table></div>`;
  $('svHist').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (await deactivate('service_events', b.dataset.del, 'service record')) { history(); status(); }
  });
}

async function plan() {
  const { data } = await db.from('service_plans').select('*').eq('vehicle_id', sel).maybeSingle();
  const p = data || {};
  $('svPlan').innerHTML = `<h3>Service interval</h3>
    <p class="lede">Whichever comes first. Leave one blank to use only the other.
      ${p.notes ? `<br><span class="muted">${esc(p.notes)}</span>` : ''}</p>
    <div class="frow">
      <div class="field"><label for="spKm">Every (km)</label><input id="spKm" type="number" min="1" step="500" value="${p.interval_km ?? ''}"/></div>
      <div class="field"><label for="spDays">Every (days)</label><input id="spDays" type="number" min="1" step="1" value="${p.interval_days ?? ''}"/></div></div>
    <div class="field"><label for="spBy">Data provided by</label><input id="spBy" value="${esc(p.provided_by || '')}"/></div>
    <div class="actions"><button class="b-primary" id="spSave">Save for this vehicle</button>
      <button class="b-ghost" id="spAll">Apply to every vehicle</button></div>`;
  const rec = () => ({ interval_km: num('spKm'), interval_days: num('spDays'), provided_by: val('spBy') });
  const ok = r => { if (!r.interval_km && !r.interval_days) { toast('Give a distance or a number of days', 'bad'); return false; } return true; };
  $('spSave').onclick = async () => { const r = rec(); if (!ok(r)) return;
    const { error } = await db.from('service_plans').upsert({ vehicle_id: sel, ...r }, { onConflict: 'vehicle_id' });
    if (error) { toast(error.message, 'bad'); return; } toast('Interval saved', 'good'); status(); };
  $('spAll').onclick = async () => { const r = rec(); if (!ok(r)) return;
    const vs = await vehicles();
    if (!confirm(`Set every ${[r.interval_km ? n0(r.interval_km) + ' km' : '', r.interval_days ? r.interval_days + ' days' : ''].filter(Boolean).join(' or ')} for all ${vs.length} vehicles?`)) return;
    busy($('spAll'), true);
    const { error } = await db.from('service_plans').upsert(vs.map(v => ({ vehicle_id: v.id, ...r })), { onConflict: 'vehicle_id' });
    busy($('spAll'), false);
    if (error) { toast(error.message, 'bad'); return; } toast(`Interval set for ${vs.length} vehicles`, 'good'); status(); };
}

async function save(el) {
  const a = readAudit('sv'), odo = num('svO');
  if (odo == null && !a.recorded_on) { toast('Give the odometer reading or the date', 'bad'); return; }
  if (a.recorded_on > today()) { toast('The date cannot be in the future', 'bad'); return; }
  if (odo == null && !confirm('Without the odometer reading, the next service can only be counted by date. Save anyway?')) return;
  busy($('svSave'), true);
  const { error } = await db.from('service_events').insert({ vehicle_id: +$('svV').value, odo_km: odo,
    cost: num('svC'), workshop: val('svW'), work_done: val('svD'), ...a });
  busy($('svSave'), false);
  if (error) { toast(error.message, 'bad'); return; }
  toast('Service saved', 'good'); sel = +$('svV').value; renderService(el);
}
