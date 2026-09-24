// Documents: permit, fitness, insurance, PUC and registration for each vehicle,
// and the licence and verification for each driver and conductor. Renewing adds a
// new record; the latest expiry is the one that counts. Alerts start 20 days out.

import { vehicles, staffList, vehicleById, vLabel, vehicleSelect, auditFields, readAudit, auditLine,
         fmtD, chip, val, busy, today, upload, fileLink, bindFileLinks, deactivate, downloadCsv } from './fleetkit.js';

const V_TYPES = ['Permit', 'Fitness', 'Insurance', 'PUC', 'RC', 'Road tax'];
const S_TYPES = ['Driving licence', 'Police verification', 'Medical fitness'];
let owner = 'vehicle';
let STAFF_ROWS = [];   // every active person, with their current route if they have one

export async function renderDocs(el) {
  await Promise.all([vehicles(), staffList()]);
  el.innerHTML = `<div class="fsplit">
    <div class="fcard" id="dcForm"></div>
    <div class="fstack"><div class="fcard" id="dcGrid"><div class="hint">Loading…</div></div><div class="fcard" id="dcStaff"></div></div></div>`;
  drawForm(el);
  await grid(el);
}

function drawForm(el) {
  $('dcForm').innerHTML = `<h3>Add or renew a document</h3>
    <p class="lede">Renewing? Add the new one — the old record stays as history and the latest expiry takes over.
      A licence belongs to the person, so it follows them if they move bus.</p>
    <div class="field"><label>Belongs to</label><div class="seg" id="dcOwner">
      <button type="button" data-o="vehicle" class="x">A vehicle</button><button type="button" data-o="staff" class="x">A driver or conductor</button></div></div>
    <div class="field" id="dcWhoF"></div>
    <div class="field"><label for="dcT">Document</label><select id="dcT"></select></div>
    <div class="field" id="dcTOF" hidden><label for="dcTO">Document name</label><input id="dcTO"/></div>
    <div class="frow">
      <div class="field"><label for="dcNo">Number</label><input id="dcNo"/></div>
      <div class="field"><label for="dcI">Issued on</label><input id="dcI" type="date"/></div>
      <div class="field"><label for="dcE">Expires on</label><input id="dcE" type="date"/></div></div>
    <div class="field"><label for="dcF">Scan or photo <span class="muted" style="text-transform:none;letter-spacing:0">(PDF or image, up to 10 MB)</span></label>
      <input id="dcF" type="file" accept="application/pdf,image/*"/></div>
    <div class="frow">${auditFields('dc', { dateLabel: 'Date recorded' })}</div>
    <div class="field"><label for="dcN">Notes</label><input id="dcN"/></div>
    <div class="actions"><button class="b-primary" id="dcSave">Save document</button></div>`;
  const drawWho = () => {
    $('dcOwner').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.o === owner));
    $('dcWhoF').innerHTML = owner === 'vehicle'
      ? `<label for="dcV">Vehicle</label>${vehicleSelect('dcV')}`
      : `<label for="dcS">Person</label><select id="dcS">${STAFF_OPTS()}</select>`;
    $('dcT').innerHTML = (owner === 'vehicle' ? V_TYPES : S_TYPES).concat(['Other']).map(t => `<option>${t}</option>`).join('');
    $('dcTOF').hidden = true;
  };
  $('dcOwner').querySelectorAll('button').forEach(b => b.onclick = () => { owner = b.dataset.o; drawWho(); });
  $('dcT').onchange = () => { $('dcTOF').hidden = $('dcT').value !== 'Other'; };
  drawWho();
  $('dcSave').onclick = async () => {
    const type = $('dcT').value === 'Other' ? val('dcTO') : $('dcT').value;
    if (!type) { toast('Name the document', 'bad'); return; }
    const exp = val('dcE'), iss = val('dcI');
    if (!exp && !confirm('No expiry date — this document will never alert. Save anyway?')) return;
    if (exp && iss && exp < iss) { toast('Expiry is before the issue date', 'bad'); return; }
    const a = readAudit('dc'), btn = $('dcSave');
    busy(btn, true, 'Uploading…');
    try {
      const who = owner === 'vehicle' ? { vehicle_id: +$('dcV').value } : { staff_id: +$('dcS').value };
      const file = await upload($('dcF').files[0], owner === 'vehicle' ? 'vehicle/' + who.vehicle_id : 'staff/' + who.staff_id);
      const { error } = await db.from('documents').insert({ ...who, doc_type: type, doc_number: val('dcNo'),
        issued_on: iss, expires_on: exp, notes: val('dcN'), ...a, ...(file || {}) });
      if (error) throw error;
      toast('Document saved', 'good'); renderDocs(el);
    } catch (e) { toast(e.message || 'Could not save', 'bad'); }
    busy(btn, false);
  };
}

const STAFF_OPTS = () => STAFF_ROWS.map(s =>
  `<option value="${s.id}">${esc(s.name)} — ${s.role}${s.bus_id ? ', bus ' + s.bus_id : ''}</option>`).join('');

async function grid(el) {
  const [{ data: ds }, { data: crew }] = await Promise.all([
    db.from('document_status').select('*'),
    db.from('staff_assignments').select('staff_id,bus_id').is('to_date', null)]);
  const route = {}; (crew || []).forEach(c => route[c.staff_id] = c.bus_id);
  STAFF_ROWS = (await staffList(true)).filter(s => s.active).map(s => ({ ...s, bus_id: route[s.id] ?? null }))
    .sort((a, b) => (a.bus_id ?? 1e4) - (b.bus_id ?? 1e4) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  if (owner === 'staff' && $('dcS')) $('dcS').innerHTML = STAFF_OPTS();
  const D = ds || [], vs = await vehicles();
  const vd = {}; D.filter(d => d.vehicle_id).forEach(d => (vd[d.vehicle_id] = vd[d.vehicle_id] || {})[d.doc_type.toLowerCase()] = d);
  const cell = d => !d ? '<td class="muted">missing</td>'
    : `<td class="num" title="${esc(d.doc_number || '')}">${d.expires_on ? fmtD(d.expires_on) : '—'}<br>${chip(d.status, d.status === 'expired' ? 'Expired' : d.status === 'expiring' ? d.days_left + ' days' : d.status === 'ok' ? 'Valid' : undefined)}
       ${d.file_path ? fileLink(d) : ''}</td>`;
  const recorded = vs.filter(v => vd[v.id]).length;
  const urgent = D.filter(d => d.status === 'expired' || d.status === 'expiring');
  $('dcGrid').innerHTML = `<h3>Vehicle documents</h3>
    <p class="lede">${urgent.length} expired or expiring within 20 days · documents recorded for ${recorded} of ${vs.length} vehicles.
      "Missing" means nothing is on record yet, not that the document does not exist.</p>
    <div class="actions" style="margin:0 0 10px"><div class="seg" id="dcFilt">
      <button class="on x" data-f="all">All vehicles</button><button class="x" data-f="att">Needs attention</button>
      <button class="x" data-f="miss">Nothing recorded</button></div>
      <button class="b-ghost linkbtn" id="dcCsv">Download CSV</button></div>
    <div class="tscroll"><table><thead><tr><th>Vehicle</th>${V_TYPES.map(t => `<th class="num">${t}</th>`).join('')}</tr></thead>
      <tbody id="dcRows"></tbody></table></div>`;
  const draw = f => {
    const set = vs.filter(v => f === 'att' ? Object.values(vd[v.id] || {}).some(d => d.status === 'expired' || d.status === 'expiring')
      : f === 'miss' ? !vd[v.id] : true);
    $('dcRows').innerHTML = set.map(v => `<tr><td>${esc(vLabel(v))}</td>${V_TYPES.map(t => cell((vd[v.id] || {})[t.toLowerCase()])).join('')}</tr>`).join('')
      || '<tr><td colspan="7" class="muted">Nothing here.</td></tr>';
    bindFileLinks($('dcRows'));
  };
  $('dcFilt').querySelectorAll('button').forEach(b => b.onclick = () => {
    $('dcFilt').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(b.dataset.f); });
  draw('all');
  $('dcCsv').onclick = () => downloadCsv('vehicle-documents', [{ label: 'Vehicle', csv: v => vLabel(v) }]
    .concat(V_TYPES.map(t => ({ label: t + ' expires', csv: v => (vd[v.id] || {})[t.toLowerCase()]?.expires_on || '' }))), vs);

  // people
  const sd = D.filter(d => d.staff_id);
  $('dcStaff').innerHTML = `<h3>Driver and conductor documents</h3>
    ${!sd.length ? '<div class="note">None recorded yet.</div>' : `<div class="tscroll"><table><thead><tr><th>Person</th><th>Document</th>
      <th>Number</th><th class="num">Expires</th><th>Status</th><th>File</th><th></th></tr></thead>
      <tbody>${sd.sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9)).map(d => `<tr><td>${esc(d.staff_name)} <span class="muted">${d.staff_role}</span></td>
        <td>${esc(d.doc_type)}</td><td class="mono">${esc(d.doc_number || '')}</td><td class="num">${fmtD(d.expires_on)}</td>
        <td>${chip(d.status, d.status === 'expiring' ? d.days_left + ' days' : undefined)}</td><td>${fileLink(d)}</td>
        <td><button class="b-ghost linkbtn" data-del="${d.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>`}
    <h3 style="margin-top:16px">Recently recorded</h3><div id="dcRecent"></div>`;
  bindFileLinks($('dcStaff'));
  $('dcStaff').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (await deactivate('documents', b.dataset.del, 'document')) renderDocs(el); });
  const { data: rec } = await db.from('documents').select('*,vehicles(reg_no,bus_id),staff(name)').eq('active', true)
    .order('entered_at', { ascending: false }).limit(12);
  $('dcRecent').innerHTML = `<div class="tscroll"><table><tbody>${(rec || []).map(d => `<tr>
    <td>${d.vehicles ? esc(vLabel(vehicleById(d.vehicle_id)) || d.vehicles.reg_no) : esc(d.staff?.name || '')}</td>
    <td>${esc(d.doc_type)}${d.notes ? `<span class="audit">${esc(d.notes)}</span>` : ''}${auditLine(d)}</td>
    <td class="num">${fmtD(d.expires_on)}</td><td>${fileLink(d)}</td>
    <td><button class="b-ghost linkbtn" data-del="${d.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>`;
  bindFileLinks($('dcRecent'));
  $('dcRecent').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (await deactivate('documents', b.dataset.del, 'document')) renderDocs(el); });
}
