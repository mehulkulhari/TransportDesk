// Reports -> Bus-wise list: every child grouped by bus, for either round, with a CSV
// export whose columns can be chosen. Reads the bus_student_list view, which is the
// single definition of what a bus list contains (supabase/migrations/20261014000000_*).

import { downloadCsv } from './fleetkit.js';

// Column groups for the export. The on-screen table shows a compact subset.
const GROUPS = [
  ['bus', 'Bus and crew', [
    ['round', 'Round'], ['bus_no', 'Bus'], ['transport_status', 'Transport'], ['route_name', 'Route'],
    ['driver_name', 'Driver'], ['driver_phone', 'Driver phone'],
    ['conductor_name', 'Conductor'], ['conductor_phone', 'Conductor phone']]],
  ['student', 'Student', [
    ['planned_pickup_order', 'Planned pickup order'], ['sr_no', 'SR no.'], ['student_name', 'Student'],
    ['class', 'Class'], ['section', 'Section'], ['gender', 'Gender'], ['dob', 'Date of birth'], ['admission_date', 'Admission date']]],
  ['parents', 'Parents and phones', [
    ['father_name', 'Father'], ['father_phone', 'Father phone'], ['mother_name', 'Mother'], ['mother_phone', 'Mother phone']]],
  ['pickup', 'Address and pickup point', [
    ['home_address', 'Home address'], ['pickup_note', 'Pickup note'], ['pickup_latitude', 'Pickup latitude'],
    ['pickup_longitude', 'Pickup longitude'], ['pickup_map_link', 'Map link']]],
  ['temp', 'Temporary arrangements', [
    ['on_temporary_bus', 'On a temporary bus'], ['permanent_bus_no', 'Usual bus'],
    ['on_temporary_address', 'At a temporary address'], ['temporary_until', 'Temporary until'], ['temporary_reason', 'Reason']]],
  ['fee', 'Fee and distance', [
    ['transport_fee', 'Annual transport fee'], ['fee_year', 'Fee year'],
    ['road_km_to_school', 'Road km to school'], ['road_min_to_school', 'Minutes to school']]],
];
const DEFAULT_ON = new Set(['bus', 'student', 'parents', 'pickup']);

let round = '1', bus = '', withSelf = false, q = '', ROWS = null, picked = null;

/** Every row of the view, paged: PostgREST returns at most 1,000 rows per request. */
async function loadAll() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('bus_student_list').select('*')
      .order('round').order('bus_no', { nullsFirst: false }).order('planned_pickup_order', { nullsFirst: false })
      .order('student_name').range(from, from + 999);
    if (error) throw error;          // a partial list must never pass for a complete one
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

export async function renderStudentList(out) {
  if (!picked) { try { picked = new Set(JSON.parse(localStorage.getItem('slCols') || 'null') || DEFAULT_ON); } catch (e) { picked = new Set(DEFAULT_ON); } }
  out.innerHTML = '<div class="hint">Loading every student…</div>';
  try { ROWS = await loadAll(); }
  catch (e) { out.innerHTML = `<div class="hint-box">The list could not load: ${esc(e.message)}. Nothing has been exported.</div>`; return; }
  const buses = r => [...new Set(ROWS.filter(x => (r === 'both' || String(x.round) === r) && x.bus_no != null).map(x => x.bus_no))].sort((a, b) => a - b);
  out.innerHTML = `
    <div class="note" style="margin-bottom:12px;max-width:760px">Every child grouped by bus, read live from the system. Choose a round and a bus,
      then download exactly the columns you need. "Planned pickup order" is the app's planned sequence, not necessarily the order the driver follows.</div>
    <div class="actions" style="margin:0 0 12px;align-items:flex-end">
      <div><label>Round</label><div class="seg" id="slRound">
        <button class="x" data-r="1">Round 1</button><button class="x" data-r="2">Round 2</button><button class="x" data-r="both">Both</button></div></div>
      <div style="width:180px"><label for="slBus">Bus</label><select id="slBus"></select></div>
      <div style="width:240px"><label for="slQ">Search</label><input id="slQ" placeholder="Name, SR no., class or phone" value="${esc(q)}"/></div>
      <label style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink);margin:0 0 9px">
        <input type="checkbox" id="slSelf" style="width:auto" ${withSelf ? 'checked' : ''}/> Include students who come by self</label>
    </div>
    <details class="fcard" style="margin-bottom:12px" id="slColsBox"><summary>Columns in the CSV — <span id="slColsN"></span></summary>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 16px;margin-top:10px">
        ${GROUPS.map(([k, label, cols]) => `<label style="display:flex;gap:8px;align-items:flex-start;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink)">
          <input type="checkbox" data-g="${k}" style="width:auto;margin-top:3px" ${picked.has(k) ? 'checked' : ''}/>
          <span><b>${label}</b><br><span class="muted" style="font-size:11.5px">${cols.map(c => c[1]).join(', ')}</span></span></label>`).join('')}
      </div></details>
    <div class="actions" style="margin:0 0 12px">
      <button class="b-primary" id="slCsv">Download CSV</button><button class="b-ghost" id="slPrint">Print</button>
      <span class="note" id="slCount"></span></div>
    <div id="slTable"></div>`;
  const fillBus = () => {
    const opts = buses(round);
    if (bus && !opts.includes(+bus)) bus = '';
    $('slBus').innerHTML = `<option value="">All buses (${opts.length})</option>` + opts.map(b => `<option value="${b}" ${String(b) === bus ? 'selected' : ''}>Bus ${b}</option>`).join('');
  };
  out.querySelectorAll('#slRound button').forEach(b => { b.classList.toggle('on', b.dataset.r === round);
    b.onclick = () => { round = b.dataset.r; out.querySelectorAll('#slRound button').forEach(x => x.classList.toggle('on', x === b)); fillBus(); draw(); }; });
  $('slBus').onchange = () => { bus = $('slBus').value; draw(); };
  $('slSelf').onchange = () => { withSelf = $('slSelf').checked; draw(); };
  let t; $('slQ').oninput = () => { clearTimeout(t); t = setTimeout(() => { q = $('slQ').value.trim().toLowerCase(); draw(); }, 200); };
  out.querySelectorAll('#slColsBox input[data-g]').forEach(c => c.onchange = () => {
    c.checked ? picked.add(c.dataset.g) : picked.delete(c.dataset.g);
    try { localStorage.setItem('slCols', JSON.stringify([...picked])); } catch (e) { /* private window */ }
    colsNote(); });
  $('slCsv').onclick = exportCsv;
  $('slPrint').onclick = () => window.print();
  fillBus(); colsNote(); draw();
}

function colsNote() {
  const n = GROUPS.filter(g => picked.has(g[0])).reduce((s, g) => s + g[2].length, 0);
  $('slColsN').textContent = `${n} column${n === 1 ? '' : 's'} chosen`;
}

function current() {
  return ROWS.filter(r =>
    (round === 'both' || String(r.round) === round) &&
    (withSelf || r.transport_status === 'transport') &&
    (!bus || String(r.bus_no) === bus) &&
    (!q || [r.student_name, r.sr_no, r.class && r.class + (r.section ? '-' + r.section : ''), r.father_phone, r.mother_phone, r.father_name]
      .some(v => v != null && String(v).toLowerCase().includes(q))));
}

function draw() {
  const rows = current();
  const groups = new Map();
  rows.forEach(r => { const k = `${r.round}|${r.bus_no ?? 'self'}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  $('slCount').textContent = `${rows.length.toLocaleString('en-IN')} student${rows.length === 1 ? '' : 's'} on ${[...groups.keys()].filter(k => !k.endsWith('self')).length} bus${groups.size === 1 ? '' : 'es'}`;
  const phone = r => [r.father_phone, r.mother_phone].filter(Boolean).map(esc).join('<br>') || '<span class="muted">—</span>';
  $('slTable').innerHTML = !rows.length ? '<div class="note">No students match.</div>' : [...groups.entries()].map(([k, list]) => {
    const h = list[0], self = h.bus_no == null;
    return `<div class="fcard" style="margin-bottom:12px;padding:0;overflow:hidden;break-inside:avoid">
      <div style="padding:10px 14px;border-bottom:1px solid var(--edge);display:flex;gap:14px;flex-wrap:wrap;align-items:baseline">
        <b style="font-size:15px">${self ? 'Comes by self' : 'Bus ' + h.bus_no}</b>
        ${round === 'both' ? `<span class="chip mute">Round ${h.round}</span>` : ''}
        ${self ? '' : `<span>${esc(h.route_name || '')}</span>
        <span class="note">Driver: <b>${esc(h.driver_name || '—')}</b>${h.driver_phone ? ' · ' + esc(h.driver_phone) : ''}</span>
        ${h.conductor_name ? `<span class="note">Conductor: <b>${esc(h.conductor_name)}</b>${h.conductor_phone ? ' · ' + esc(h.conductor_phone) : ''}</span>` : ''}`}
        <span class="note" style="margin-left:auto">${list.length} student${list.length === 1 ? '' : 's'}</span></div>
      <div style="overflow:auto"><table><thead><tr><th class="num">#</th><th>SR no.</th><th>Student</th><th>Class</th><th>Father</th><th>Phones</th><th>Address</th><th></th></tr></thead>
      <tbody>${list.map(r => `<tr><td class="num">${r.planned_pickup_order ?? '—'}</td><td class="mono">${esc(r.sr_no)}</td>
        <td><b>${esc(r.student_name)}</b></td><td>${esc(r.class || '')}${r.section ? '-' + esc(r.section) : ''}</td>
        <td>${esc(r.father_name || '')}</td><td class="mono">${phone(r)}</td>
        <td style="max-width:280px">${esc(r.home_address || '')}${r.pickup_note ? `<span class="audit">${esc(r.pickup_note)}</span>` : ''}</td>
        <td>${r.on_temporary_bus ? `<span class="chip warn" title="${esc(r.temporary_reason || '')}">Temporary — usual bus ${r.permanent_bus_no}</span>` : ''}
          ${r.pickup_latitude == null && !self ? '<span class="chip stop">No pickup point</span>' : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
  }).join('');
}

function exportCsv() {
  const rows = current();
  if (!rows.length) { toast('Nothing to export', 'bad'); return; }
  const cols = GROUPS.filter(g => picked.has(g[0])).flatMap(g => g[2]).map(([k, label]) => ({ k, label,
    csv: r => typeof r[k] === 'boolean' ? (r[k] ? 'Yes' : 'No') : r[k] }));
  if (!cols.length) { toast('Choose at least one group of columns', 'bad'); return; }
  const name = ['bus-wise-students', round === 'both' ? 'both-rounds' : 'round-' + round, bus ? 'bus-' + bus : 'all-buses',
    new Date().toISOString().slice(0, 10)].join('_');
  downloadCsv(name, cols, rows);
  toast(`Exported ${rows.length} students`, 'good');
}
