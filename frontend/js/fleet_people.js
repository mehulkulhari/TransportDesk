// Staff and complaints.
//
// A tenure is one person on one route between two dates. Moving a driver ends one
// tenure and starts the next, so the old record is never overwritten — which is
// what makes a report on "their time on the bus" possible at all.

import { vehicles, staffList, vehicleById, vLabel, routeSelect, auditFields, readAudit, auditLine,
         fmtD, chip, num, val, busy, today, n0, downloadCsv } from './fleetkit.js';

// Parse as UTC: a local-midnight parse in India (UTC+5:30) would land two days early.
const dayBefore = d => new Date(new Date(d + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
let staffFilter = 'current', openId = null;

// =============================================================== STAFF
export async function renderStaff(el) {
  el.innerHTML = `<div class="fsplit" style="grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)">
    <div class="fcard" id="stList"><div class="hint">Loading…</div></div>
    <div class="fstack"><div class="fcard" id="stPane"></div></div></div>
    <div id="stReport" style="margin-top:16px"></div>`;
  await list(el);
  if (openId) profile(openId, el); else addForm(el);
}

async function load() {
  const [{ data: st }, { data: asg }, { data: cp }, { data: ds }] = await Promise.all([
    db.from('staff').select('*').order('name'),
    db.from('staff_assignments').select('*').order('from_date', { ascending: false, nullsFirst: false }),
    db.from('complaints').select('against_staff_id,status').eq('active', true).not('against_staff_id', 'is', null),
    db.from('document_status').select('staff_id,doc_type,status,days_left').not('staff_id', 'is', null)]);
  const cur = {}, all = {};
  (asg || []).forEach(a => { (all[a.staff_id] = all[a.staff_id] || []).push(a); if (!a.to_date) cur[a.staff_id] = a; });
  const comp = {}; (cp || []).forEach(c => { const x = comp[c.against_staff_id] || (comp[c.against_staff_id] = { n: 0, open: 0 }); x.n++; if (c.status === 'open') x.open++; });
  const doc = {}; (ds || []).forEach(d => { if (d.status === 'expired' || d.status === 'expiring') (doc[d.staff_id] = doc[d.staff_id] || []).push(d); });
  return (st || []).map(s => ({ ...s, cur: cur[s.id], tenures: all[s.id] || [], comp: comp[s.id], docAlert: doc[s.id] }));
}

async function list(el) {
  const S = await load();
  const f = { current: s => s.active && s.cur, driver: s => s.active && s.role === 'driver', conductor: s => s.active && s.role === 'conductor',
    free: s => s.active && !s.cur, left: s => !s.active }[staffFilter];
  const rows = S.filter(f).sort((a, b) => (a.cur?.bus_id ?? 1e4) - (b.cur?.bus_id ?? 1e4) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  const pay = S.filter(s => s.active && s.cur).reduce((t, s) => t + (+s.monthly_salary || 0), 0);
  $('stList').innerHTML = `<h3>Drivers and conductors</h3>
    <p class="lede">${S.filter(s => s.active && s.cur && s.role === 'driver').length} drivers and
      ${S.filter(s => s.active && s.cur && s.role === 'conductor').length} conductors on routes ·
      ${rs(pay)} a month in salaries. Click a person to edit them, move them, or run their tenure report.</p>
    <div class="actions" style="margin:0 0 10px"><div class="seg" id="stF">
      ${[['current', 'On a route'], ['driver', 'Drivers'], ['conductor', 'Conductors'], ['free', 'Not on a route'], ['left', 'Left']]
        .map(([k, l]) => `<button class="x ${k === staffFilter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <button class="b-ghost linkbtn" id="stAdd">Add a person</button><button class="b-ghost linkbtn" id="stCsv">Download CSV</button></div>
    <div class="tscroll"><table><thead><tr><th>Route</th><th>Name</th><th>Role</th><th>Since</th><th class="num">Salary / month</th><th>Flags</th></tr></thead>
    <tbody>${rows.map(s => `<tr data-id="${s.id}" style="cursor:pointer" class="${s.id === openId ? 'reasonrow' : ''}">
      <td>${s.cur ? 'Bus ' + s.cur.bus_id : '<span class="muted">—</span>'}</td><td><b>${esc(s.name)}</b>${s.phone ? `<span class="audit">${esc(s.phone)}</span>` : ''}</td>
      <td>${s.role}</td><td>${s.cur ? (s.cur.from_date ? fmtD(s.cur.from_date) : '<span class="muted">before records</span>') : ''}</td>
      <td class="num">${s.monthly_salary != null ? rs(s.monthly_salary) : '—'}</td>
      <td>${s.comp?.open ? chip('open', s.comp.open + ' open complaint' + (s.comp.open > 1 ? 's' : '')) + ' ' : ''}${(s.docAlert || []).map(d => chip(d.status, d.doc_type)).join(' ')}</td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">Nobody here.</td></tr>'}</tbody></table></div>`;
  $('stF').querySelectorAll('button').forEach(b => b.onclick = () => { staffFilter = b.dataset.f; list(el); });
  $('stList').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { openId = +tr.dataset.id; list(el); profile(openId, el); });
  $('stAdd').onclick = () => { openId = null; list(el); addForm(el); };
  $('stCsv').onclick = () => downloadCsv('staff', [{ label: 'Name', k: 'name' }, { label: 'Role', k: 'role' },
    { label: 'Route', csv: s => s.cur?.bus_id ?? '' }, { label: 'Since', csv: s => s.cur?.from_date ?? '' },
    { label: 'Phone', k: 'phone' }, { label: 'Salary', k: 'monthly_salary' }, { label: 'Active', k: 'active' }], rows);
}

function addForm(el) {
  $('stPane').innerHTML = `<h3>Add a person</h3>
    <p class="lede">If they are joining a route that already has someone in that role, that person's tenure ends the day before.</p>
    <div class="frow"><div class="field"><label for="saN">Name</label><input id="saN"/></div>
      <div class="field"><label for="saR">Role</label><select id="saR"><option value="driver">Driver</option><option value="conductor">Conductor</option></select></div></div>
    <div class="frow"><div class="field"><label for="saP">Phone</label><input id="saP" inputmode="tel"/></div>
      <div class="field"><label for="saS">Salary / month (₹)</label><input id="saS" type="number" min="0"/></div></div>
    <div class="frow"><div class="field"><label for="saL">Licence number</label><input id="saL"/></div>
      <div class="field"><label for="saB">Route</label>${routeSelect('saB', '', { blank: 'Not on a route yet' })}</div></div>
    <div class="frow">${auditFields('sa', { dateLabel: 'Starts on' })}</div>
    <div class="actions"><button class="b-primary" id="saSave">Add person</button></div>`;
  $('saSave').onclick = async () => {
    const name = val('saN'); if (!name) { toast('Enter a name', 'bad'); return; }
    const a = readAudit('sa'), role = $('saR').value, route = $('saB').value ? +$('saB').value : null;
    busy($('saSave'), true);
    const { data: p, error } = await db.from('staff').insert({ name, role, phone: val('saP'), monthly_salary: num('saS'),
      licence_no: val('saL'), joined_on: a.recorded_on, provided_by: a.provided_by }).select('id').single();
    if (error) { busy($('saSave'), false); toast(error.message, 'bad'); return; }
    if (route && !(await assign(p.id, role, route, a.recorded_on, a.provided_by))) { busy($('saSave'), false); return; }
    busy($('saSave'), false);
    toast(`${name} added`, 'good'); openId = p.id; await staffList(true); renderStaff(el);
  };
}

/** Put a person on a route from a date, ending whoever held that seat and their own current tenure. */
async function assign(staffId, role, route, from, by) {
  const [{ data: seat }, { data: mine }] = await Promise.all([
    db.from('staff_assignments').select('id,from_date,staff(name)').eq('bus_id', route).eq('role', role).is('to_date', null).maybeSingle(),
    db.from('staff_assignments').select('id,from_date,bus_id').eq('staff_id', staffId).is('to_date', null).maybeSingle()]);
  if (seat && seat.id === mine?.id) { toast('They are already on that route', 'bad'); return false; }
  if (seat && !confirm(`${seat.staff?.name || 'The current ' + role} is the ${role} on route ${route}. End their tenure on ${fmtD(dayBefore(from))}?`)) return false;
  const close = async a => {
    if (!a) return true;
    const to = a.from_date && a.from_date > dayBefore(from) ? from : dayBefore(from);
    const { error } = await db.from('staff_assignments').update({ to_date: to }).eq('id', a.id);
    if (error) { toast(error.message, 'bad'); return false; } return true;
  };
  if (!(await close(seat)) || !(await close(mine))) return false;
  const { error } = await db.from('staff_assignments').insert({ staff_id: staffId, bus_id: route, role, from_date: from, provided_by: by });
  if (error) { toast(error.message, 'bad'); return false; }
  return true;
}

async function profile(id, el) {
  const { data: s } = await db.from('staff').select('*').eq('id', id).single();
  const { data: ts } = await db.from('staff_assignments').select('*').eq('staff_id', id).order('from_date', { ascending: false, nullsFirst: false });
  const cur = (ts || []).find(t => !t.to_date);
  $('stPane').innerHTML = `<h3>${esc(s.name)} <span class="note">${s.role}${s.active ? '' : ' · left'}</span></h3>
    <p class="lede">${cur ? `On route ${cur.bus_id} since ${cur.from_date ? fmtD(cur.from_date) : 'before records were kept'}.` : 'Not on a route.'}</p>
    <div class="frow"><div class="field"><label for="spN">Name</label><input id="spN" value="${esc(s.name)}"/></div>
      <div class="field"><label for="spP">Phone</label><input id="spP" value="${esc(s.phone || '')}"/></div></div>
    <div class="frow"><div class="field"><label for="spS">Salary / month (₹)</label><input id="spS" type="number" value="${s.monthly_salary ?? ''}"/></div>
      <div class="field"><label for="spL">Licence number</label><input id="spL" value="${esc(s.licence_no || '')}"/></div></div>
    <div class="field"><label for="spNo">Notes</label><input id="spNo" value="${esc(s.notes || '')}"/></div>
    <div class="actions"><button class="b-primary" id="spSave">Save details</button><button class="b-signal" id="spRep">Tenure report</button></div>
    <h3 style="margin-top:18px">Move or end</h3>
    <div class="frow"><div class="field"><label for="smB">Move to route</label>${routeSelect('smB', '', { blank: 'Choose a route…' })}</div>
      <div class="field"><label for="smOn">From</label><input id="smOn" type="date" value="${today()}" max="${today()}"/></div></div>
    <div class="field"><label for="smBy">Data provided by</label><input id="smBy"/></div>
    <div class="actions"><button class="b-ghost" id="smMove">Move</button>
      ${cur ? '<button class="b-ghost" id="smEnd">Take off the route</button>' : ''}
      ${s.active ? '<button class="b-danger" id="smLeft">Has left the school</button>' : '<button class="b-ghost" id="smBack">Rejoined</button>'}</div>
    <h3 style="margin-top:18px">Tenures</h3>
    <div class="tscroll"><table><thead><tr><th>Route</th><th>From</th><th>To</th><th class="num">Days</th></tr></thead>
      <tbody>${(ts || []).map(t => `<tr><td>Bus ${t.bus_id}</td><td>${t.from_date ? fmtD(t.from_date) : '<span class="muted">before records</span>'}</td>
        <td>${t.to_date ? fmtD(t.to_date) : chip('ok', 'Current')}</td>
        <td class="num">${t.from_date ? n0(Math.round((new Date(t.to_date || today()) - new Date(t.from_date)) / 864e5)) : '—'}</td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">No tenures.</td></tr>'}</tbody></table></div>`;
  $('spSave').onclick = async () => {
    const name = val('spN'); if (!name) { toast('A name is required', 'bad'); return; }
    const { error } = await db.from('staff').update({ name, phone: val('spP'), monthly_salary: num('spS'), licence_no: val('spL'), notes: val('spNo') }).eq('id', id);
    if (error) { toast(error.message, 'bad'); return; } toast('Saved', 'good'); await staffList(true); list(el);
  };
  $('smMove').onclick = async () => {
    const route = $('smB').value; if (!route) { toast('Choose a route', 'bad'); return; }
    if (await assign(id, s.role, +route, $('smOn').value || today(), val('smBy'))) { toast(`Moved to route ${route}`, 'good'); renderStaff(el); }
  };
  const endCur = async on => { if (!cur) return true;
    const to = cur.from_date && cur.from_date > on ? cur.from_date : on;
    const { error } = await db.from('staff_assignments').update({ to_date: to }).eq('id', cur.id);
    if (error) { toast(error.message, 'bad'); return false; } return true; };
  if ($('smEnd')) $('smEnd').onclick = async () => {
    const on = $('smOn').value || today();
    if (!confirm(`End ${s.name}'s tenure on route ${cur.bus_id} on ${fmtD(on)}?`)) return;
    if (await endCur(on)) { toast('Tenure ended', 'good'); renderStaff(el); } };
  if ($('smLeft')) $('smLeft').onclick = async () => {
    const on = $('smOn').value || today();
    if (!confirm(`Record that ${s.name} left on ${fmtD(on)}? Their history is kept.`)) return;
    if (!(await endCur(on))) return;
    const { error } = await db.from('staff').update({ active: false, left_on: on }).eq('id', id);
    if (error) { toast(error.message, 'bad'); return; } toast('Recorded', 'good'); renderStaff(el); };
  if ($('smBack')) $('smBack').onclick = async () => {
    const { error } = await db.from('staff').update({ active: true, left_on: null }).eq('id', id);
    if (error) { toast(error.message, 'bad'); return; } toast('Recorded', 'good'); renderStaff(el); };
  $('spRep').onclick = () => report(id);
}

/** Everything that happened on a person's route while they were on it — printable. */
async function report(id) {
  const box = $('stReport');
  box.innerHTML = '<div class="hint">Building the report…</div>';
  const { data, error } = await db.rpc('staff_tenure_report', { p_staff: id });
  if (error) { box.innerHTML = `<div class="hint-box">${esc(error.message)}</div>`; return; }
  const s = data.staff || {}, T = data.tenures || [], C = data.complaints || [], D = data.documents || [];
  const kv = (l, v) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  box.innerHTML = `<div class="fcard report">
    <div class="actions noprint" style="margin:0 0 10px;justify-content:flex-end">
      <button class="b-ghost" id="repPrint">Print</button><button class="b-ghost" id="repCsv">Download CSV</button></div>
    <h2>${esc(s.name)}</h2>
    <p class="sub">${esc(s.role || '')}${s.phone ? ' · ' + esc(s.phone) : ''}${s.joined_on ? ' · joined ' + fmtD(s.joined_on) : ''}${s.left_on ? ' · left ' + fmtD(s.left_on) : ''}
      · report generated ${fmtD(today())}</p>
    ${T.map(t => `<div style="border-top:2px solid var(--ink);padding-top:10px;margin-top:14px">
      <h3 style="margin:0 0 2px">Route ${t.bus_id} <span class="note">${t.role}</span></h3>
      <p class="sub" style="margin:0 0 10px">${t.from_date ? fmtD(t.from_date) : 'Before records were kept'} – ${t.to_date ? fmtD(t.to_date) : 'present'}${t.days != null ? ` · ${n0(t.days)} days` : ''}</p>
      <div class="cards">
        ${kv('Km run (logged)', t.km_run != null ? n0(t.km_run) : '—')}${kv('Days with a reading', n0(t.days_logged))}
        ${kv('Extra-km days, no reason', n0(t.unexplained_extra_days))}${kv('Fuel', t.fuel_litres != null ? n0(Math.round(t.fuel_litres)) + ' L' : '—')}
        ${kv('Fuel cost', t.fuel_cost != null ? rs(Math.round(t.fuel_cost)) : '—')}${kv('Average km/L', t.avg_kmpl ?? '—')}
        ${kv('Mileage deviations', n0(t.fuel_deviations))}${kv('Tyre checks', n0(t.tyre_checks))}
        ${kv('Complaints', `${n0(t.complaints)}${t.complaints_open ? ` (${t.complaints_open} open)` : ''}`)}</div></div>`).join('')
      || '<div class="note">No tenures recorded.</div>'}
    <p class="note" style="margin-top:10px">Kilometres, fuel and tyre figures are everything logged for the route during the tenure,
      whoever entered them. Tenures that began before records were kept count everything logged on the route.</p>
    <h3 style="margin-top:16px">Complaints</h3>
    ${C.length ? `<div class="tscroll" style="max-height:none"><table><thead><tr><th>Date</th><th>Raised by</th><th>Category</th><th>What happened</th><th>Outcome</th></tr></thead>
      <tbody>${C.map(c => `<tr><td>${fmtD(c.recorded_on)}</td><td>${esc(c.raised_by)} <span class="muted">${esc(c.role)}</span></td>
        <td>${esc(c.category || '')}</td><td>${esc(c.description)}</td><td>${chip(c.status)}${c.resolution ? `<span class="audit">${esc(c.resolution)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="note">No complaints on record.</div>'}
    <h3 style="margin-top:16px">Documents</h3>
    ${D.length ? D.map(d => `${esc(d.doc_type)} ${d.doc_number ? `<span class="mono">${esc(d.doc_number)}</span>` : ''} — ${d.expires_on ? 'expires ' + fmtD(d.expires_on) : 'no expiry'} ${chip(d.status)}`).join('<br>')
      : '<div class="note">None on record.</div>'}</div>`;
  $('repPrint').onclick = () => window.print();
  $('repCsv').onclick = () => downloadCsv('tenure-' + (s.name || 'staff').replace(/\W+/g, '-'), [
    { label: 'Route', k: 'bus_id' }, { label: 'Role', k: 'role' }, { label: 'From', k: 'from_date' }, { label: 'To', k: 'to_date' },
    { label: 'Days', k: 'days' }, { label: 'Km run', k: 'km_run' }, { label: 'Days logged', k: 'days_logged' },
    { label: 'Extra-km days without reason', k: 'unexplained_extra_days' }, { label: 'Fuel litres', k: 'fuel_litres' },
    { label: 'Fuel cost', k: 'fuel_cost' }, { label: 'Avg km/L', k: 'avg_kmpl' }, { label: 'Mileage deviations', k: 'fuel_deviations' },
    { label: 'Tyre checks', k: 'tyre_checks' }, { label: 'Complaints', k: 'complaints' }, { label: 'Open complaints', k: 'complaints_open' }], T);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =============================================================== COMPLAINTS
let CREW = [];   // people selectable in a complaint: those on a route first, then the rest
const CATEGORIES = ['Rash or unsafe driving', 'Late or missed stop', 'Rude behaviour', 'Mobile phone while driving',
  'Smoking or alcohol', 'Overcrowding', 'Cleanliness', 'Student discipline', 'Bullying', 'Other'];
let cFilter = 'open';

export async function renderComplaints(el) {
  await staffList();
  el.innerHTML = `<div class="fsplit">
    <div class="fcard"><h3>Record a complaint</h3>
      <p class="lede">Who raised it, who it is against, and what happened. It stays open on the dashboard until resolved.</p>
      <div class="frow">${auditFields('cp', { dateLabel: 'Date raised' })}</div>
      <div class="frow"><div class="field"><label for="cpRN">Raised by</label><input id="cpRN" placeholder="Name"/></div>
        <div class="field"><label for="cpRR">They are a</label><select id="cpRR">${['parent', 'student', 'teacher', 'driver', 'conductor', 'staff', 'other']
          .map(r => `<option value="${r}">${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select></div></div>
      <div class="field"><label for="cpRP">Their phone</label><input id="cpRP" inputmode="tel"/></div>
      <div class="field"><label>Against</label><div class="seg" id="cpAT">${['driver', 'conductor', 'student', 'other']
        .map((t, i) => `<button type="button" class="x ${i ? '' : 'on'}" data-t="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      <div class="field" id="cpWhoF"></div>
      <div class="field"><label for="cpB">Route</label>${routeSelect('cpB', '', { blank: 'Not route-specific' })}</div>
      <div class="field"><label for="cpC">Category</label><select id="cpC">${CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label for="cpD">What happened</label><textarea id="cpD" rows="3"></textarea></div>
      <div class="actions"><button class="b-primary" id="cpSave">Save complaint</button></div></div>
    <div class="fcard" id="cpList"><div class="hint">Loading…</div></div></div>`;
  let against = 'driver', student = null;
  const who = () => {
    student = null;
    if (against === 'driver' || against === 'conductor') {
      const people = CREW.filter(p => p.role === against);
      $('cpWhoF').innerHTML = `<label for="cpS">Which ${against}</label><select id="cpS"><option value="">Choose…</option>${people.map(p =>
        `<option value="${p.id}" data-b="${p.bus_id ?? ''}">${esc(p.name)}${p.bus_id ? ' — bus ' + p.bus_id : ''}</option>`).join('')}</select>`;
      $('cpS').onchange = () => { const b = $('cpS').selectedOptions[0]?.dataset.b; if (b) $('cpB').value = b; };
    } else if (against === 'student') {
      $('cpWhoF').innerHTML = `<label for="cpQ">Which student</label><input id="cpQ" placeholder="Type a name or SR number"/>
        <div id="cpHits" style="margin-top:6px"></div>`;
      let t; $('cpQ').oninput = () => { clearTimeout(t); t = setTimeout(findStudent, 250); };
    } else {
      $('cpWhoF').innerHTML = `<label for="cpON">Name</label><input id="cpON"/>`;
    }
  };
  const findStudent = async () => {
    const q = $('cpQ').value.trim(); if (q.length < 2) { $('cpHits').innerHTML = ''; return; }
    // quoted patterns survive commas and brackets in what was typed (see rounds.js)
    const p = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const or = `name.ilike."%${p}%",sr_no.ilike."%${p}%"`;
    const [{ data: r1 }, { data: r2 }] = await Promise.all([
      db.from('students').select('sr_no,name,bus_no').eq('active', true).or(or).limit(8),
      db.from('students_round2').select('sr_no,name,bus_no').eq('active', true).or(or).limit(5)]);
    const hits = (r1 || []).map(h => ({ ...h, r: 1 })).concat((r2 || []).map(h => ({ ...h, r: 2 })));
    $('cpHits').innerHTML = hits.map((h, i) => `<button type="button" class="b-ghost linkbtn" data-i="${i}" style="margin:0 4px 4px 0">
      ${esc(h.name)} · ${esc(h.sr_no)}${h.bus_no ? ' · bus ' + h.bus_no : ''}${h.r === 2 ? ' · R2' : ''}</button>`).join('') || '<span class="muted">No match.</span>';
    $('cpHits').querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
      student = hits[+b.dataset.i]; $('cpQ').value = `${student.name} (${student.sr_no})`;
      $('cpHits').innerHTML = chip('ok', 'Selected'); if (student.bus_no) $('cpB').value = student.bus_no; });
  };
  $('cpAT').querySelectorAll('button').forEach(b => b.onclick = () => {
    against = b.dataset.t; $('cpAT').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); who(); });
  const { data: crew } = await db.from('staff_assignments').select('bus_id,staff(id,name,role,active)').is('to_date', null);
  const onRoute = (crew || []).filter(c => c.staff?.active).map(c => ({ ...c.staff, bus_id: c.bus_id }));
  const rest = (await staffList()).filter(s => s.active && !onRoute.some(o => o.id === s.id));
  CREW = onRoute.concat(rest).sort((a, b) => (a.bus_id ?? 1e4) - (b.bus_id ?? 1e4) || a.name.localeCompare(b.name));
  who();
  $('cpSave').onclick = async () => {
    const a = readAudit('cp'), rn = val('cpRN'), d = val('cpD');
    if (!rn) { toast('Who raised it?', 'bad'); $('cpRN').focus(); return; }
    if (!d) { toast('Describe what happened', 'bad'); $('cpD').focus(); return; }
    const rec = { raised_by_name: rn, raised_by_role: $('cpRR').value, raised_by_phone: val('cpRP'), against_type: against,
      bus_id: $('cpB').value ? +$('cpB').value : null, category: $('cpC').value, description: d, ...a };
    if (against === 'driver' || against === 'conductor') {
      const o = $('cpS').selectedOptions[0]; if (!$('cpS').value) { toast(`Choose the ${against}`, 'bad'); return; }
      rec.against_staff_id = +$('cpS').value; rec.against_name = o.textContent.split(' — ')[0];
    } else if (against === 'student') {
      if (!student) { toast('Pick the student from the search results', 'bad'); return; }
      rec.against_student_sr = student.sr_no; rec.against_name = student.name;
    } else rec.against_name = val('cpON');
    busy($('cpSave'), true);
    const { error } = await db.from('complaints').insert(rec);
    busy($('cpSave'), false);
    if (error) { toast(error.message, 'bad'); return; }
    toast('Complaint recorded', 'good'); renderComplaints(el);
  };
  await clist(el);
}

async function clist(el) {
  let q = db.from('complaints').select('*').eq('active', true).order('recorded_on', { ascending: false }).order('id', { ascending: false });
  if (cFilter !== 'all') q = q.eq('status', cFilter);
  const { data } = await q.limit(200);
  const C = data || [];
  $('cpList').innerHTML = `<h3>Complaints</h3>
    <div class="actions" style="margin:0 0 10px"><div class="seg" id="cpF">${[['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All']]
      .map(([k, l]) => `<button class="x ${k === cFilter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <button class="b-ghost linkbtn" id="cpCsv">Download CSV</button></div>
    ${!C.length ? '<div class="note">Nothing here.</div>' : C.map(c => `<div style="border-top:1px solid var(--edge-soft);padding:10px 0" data-id="${c.id}">
      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">${chip(c.status)}
        <b>${esc(c.against_name || c.against_type)}</b><span class="muted">${esc(c.against_type)}${c.bus_id ? ' · bus ' + c.bus_id : ''}</span>
        <span class="muted" style="margin-left:auto">${fmtD(c.recorded_on)}</span></div>
      <div style="margin:4px 0">${c.category ? `<b>${esc(c.category)}.</b> ` : ''}${esc(c.description)}</div>
      <span class="audit">Raised by ${esc(c.raised_by_name)} (${esc(c.raised_by_role)})${c.raised_by_phone ? ' · ' + esc(c.raised_by_phone) : ''}</span>${auditLine(c)}
      ${c.resolution ? `<div class="hint-box" style="margin-top:6px;padding:8px 10px"><b>${c.status === 'dismissed' ? 'Dismissed' : 'Resolved'} ${fmtD(c.resolved_on)}:</b> ${esc(c.resolution)}</div>` : ''}
      ${c.status === 'open' ? `<div style="display:flex;gap:6px;margin-top:6px"><input class="cpRes" placeholder="What was done about it"/>
        <button class="b-ghost linkbtn" data-act="resolved">Resolve</button><button class="b-ghost linkbtn" data-act="dismissed">Dismiss</button></div>` : ''}</div>`).join('')}`;
  $('cpF').querySelectorAll('button').forEach(b => b.onclick = () => { cFilter = b.dataset.f; clist(el); });
  $('cpList').querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const box = b.closest('[data-id]'), res = box.querySelector('.cpRes').value.trim();
    if (!res) { toast('Say what was done about it', 'bad'); box.querySelector('.cpRes').focus(); return; }
    const { error } = await db.from('complaints').update({ status: b.dataset.act, resolution: res, resolved_on: today() }).eq('id', +box.dataset.id);
    if (error) { toast(error.message, 'bad'); return; } toast('Updated', 'good'); clist(el);
  });
  $('cpCsv').onclick = () => downloadCsv('complaints', [{ label: 'Date', k: 'recorded_on' }, { label: 'Status', k: 'status' },
    { label: 'Against', k: 'against_name' }, { label: 'Type', k: 'against_type' }, { label: 'Route', k: 'bus_id' },
    { label: 'Category', k: 'category' }, { label: 'Description', k: 'description' }, { label: 'Raised by', k: 'raised_by_name' },
    { label: 'Role', k: 'raised_by_role' }, { label: 'Resolution', k: 'resolution' }, { label: 'Resolved on', k: 'resolved_on' }], C);
}
