// Maintenance bills: every workshop, tyre and parts bill, against a vehicle where it
// belongs to one. Some bills cover the whole fleet (painting 18 buses) and some name
// a vehicle that is not in the fleet at all; both are recorded rather than forced
// onto the wrong bus.

import { vehicles, vehicleById, vLabel, vehicleSelect, auditFields, readAudit, auditLine,
         fmtD, chip, num, val, busy, today, n0, upload, fileLink, bindFileLinks, deactivate, downloadCsv } from './fleetkit.js';

const CATS = [['tyres', 'Tyres'], ['parts_oil', 'Parts & oil'], ['repair', 'Repair & labour'], ['body_paint', 'Body & paint'],
  ['electrical', 'Electrical'], ['documents', 'Documents & fees'], ['other', 'Other']];
const catName = k => (CATS.find(c => c[0] === k) || [, k])[1];
let period = 'fy';

/** The Indian financial year the given date falls in: April to March. */
function fy(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return [`${y}-04-01`, `${y + 1}-03-31`, `${y}–${String(y + 1).slice(2)}`];
}

export async function renderBills(el) {
  await vehicles();
  el.innerHTML = `<div class="fsplit">
    <div class="fcard"><h3>Add a bill</h3>
      <p class="lede">Attach a photo of the bill so the amount can always be checked against it.</p>
      <div class="field"><label for="blV">Vehicle</label>${vehicleSelect('blV', '', { blank: 'Whole fleet / not one bus' })}</div>
      <div class="field" id="blRefF"><label for="blRef">Registration on the bill, if it is not a fleet vehicle</label><input id="blRef" placeholder="e.g. a hired or staff vehicle"/></div>
      <div class="frow">${auditFields('bl', { dateLabel: 'Bill date' })}</div>
      <div class="frow">
        <div class="field"><label for="blNo">Bill number</label><input id="blNo"/></div>
        <div class="field"><label for="blAmt">Amount (₹)</label><input id="blAmt" type="number" min="0" step="1"/></div></div>
      <div class="field"><label for="blP">Party</label><input id="blP" list="blParties"/><datalist id="blParties"></datalist></div>
      <div class="field"><label for="blC">Category</label><select id="blC">${CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="field"><label for="blD">What it was for</label><textarea id="blD" rows="2"></textarea></div>
      <div class="field"><label for="blF">Bill scan or photo</label><input id="blF" type="file" accept="application/pdf,image/*"/></div>
      <div class="actions"><button class="b-primary" id="blSave">Save bill</button></div></div>
    <div class="fstack"><div class="fcard" id="blList"><div class="hint">Loading…</div></div><div class="fcard" id="blVeh"></div></div></div>`;
  const toggleRef = () => { $('blRefF').hidden = !!$('blV').value; };
  $('blV').onchange = toggleRef; toggleRef();
  $('blSave').onclick = () => save(el);
  const { data: ps } = await db.from('maintenance_bills').select('party_name').not('party_name', 'is', null).limit(500);
  $('blParties').innerHTML = [...new Set((ps || []).map(r => r.party_name))].sort().map(p => `<option value="${esc(p)}">`).join('');
  await list(el);
}

async function save(el) {
  const amt = num('blAmt'), a = readAudit('bl');
  if (amt == null || amt < 0) { toast('Enter the bill amount', 'bad'); $('blAmt').focus(); return; }
  if (a.recorded_on > today()) { toast('The bill date cannot be in the future', 'bad'); return; }
  const vid = $('blV').value ? +$('blV').value : null;
  busy($('blSave'), true, 'Uploading…');
  try {
    const file = await upload($('blF').files[0], 'bills/' + (vid || 'fleet'));
    const { error } = await db.from('maintenance_bills').insert({ vehicle_id: vid, vehicle_ref: vid ? null : val('blRef'),
      bill_no: val('blNo'), party_name: val('blP'), amount: amt, category: $('blC').value, description: val('blD'), ...a, ...(file || {}) });
    if (error) throw error;
    toast('Bill saved', 'good'); renderBills(el);
  } catch (e) { toast(e.message || 'Could not save', 'bad'); }
  busy($('blSave'), false);
}

async function list(el) {
  const [from, to, label] = period === 'fy' ? fy() : period === 'month'
    ? [today().slice(0, 8) + '01', today(), 'this month'] : ['1900-01-01', '2999-12-31', 'all time'];
  const { data } = await db.from('maintenance_bills').select('*').eq('active', true)
    .gte('recorded_on', from).lte('recorded_on', to).order('recorded_on', { ascending: false });
  const B = data || [], total = B.reduce((s, b) => s + +b.amount, 0);
  const byCat = {}; B.forEach(b => byCat[b.category] = (byCat[b.category] || 0) + +b.amount);
  $('blList').innerHTML = `<h3>Bills — ${period === 'fy' ? 'financial year ' + label : label}</h3>
    <div class="actions" style="margin:0 0 12px"><div class="seg" id="blPer">
      <button class="x" data-p="month">This month</button><button class="x" data-p="fy">This financial year</button><button class="x" data-p="all">All</button></div>
      <button class="b-ghost linkbtn" id="blCsv">Download CSV</button></div>
    <div class="cards" style="margin-bottom:12px"><div class="stat"><b>${rs(Math.round(total))}</b><span>${B.length} bills</span></div>
      ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) =>
        `<div class="stat"><b>${rs(Math.round(v))}</b><span>${esc(catName(k))}</span></div>`).join('')}</div>
    <div class="tscroll"><table><thead><tr><th>Date</th><th>Vehicle</th><th>Party</th><th>Bill no.</th><th>Category</th><th class="num">Amount</th><th>Bill</th><th></th></tr></thead>
    <tbody>${B.map(b => `<tr><td>${fmtD(b.recorded_on)}</td>
      <td>${b.vehicle_id ? esc(vLabel(vehicleById(b.vehicle_id))) : b.vehicle_ref ? `<span class="mono">${esc(b.vehicle_ref)}</span> <span class="muted">not in fleet</span>` : '<span class="muted">whole fleet</span>'}</td>
      <td>${esc(b.party_name || '')}${b.description ? `<span class="audit">${esc(b.description)}</span>` : ''}${auditLine(b)}</td>
      <td class="mono">${esc(b.bill_no || '')}</td><td>${esc(catName(b.category))}</td><td class="num"><b>${rs(Math.round(b.amount))}</b></td>
      <td>${fileLink(b)}</td><td><button class="b-ghost linkbtn" data-del="${b.id}">Remove</button></td></tr>`).join('')
      || '<tr><td colspan="8" class="muted">No bills in this period.</td></tr>'}</tbody></table></div>`;
  $('blPer').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.p === period);
    b.onclick = () => { period = b.dataset.p; list(el); }; });
  bindFileLinks($('blList'));
  $('blList').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (await deactivate('maintenance_bills', b.dataset.del, 'bill')) list(el); });
  $('blCsv').onclick = () => downloadCsv('maintenance-bills', [
    { label: 'Date', k: 'recorded_on' }, { label: 'Vehicle', csv: b => b.vehicle_id ? vLabel(vehicleById(b.vehicle_id)) : b.vehicle_ref || 'Whole fleet' },
    { label: 'Party', k: 'party_name' }, { label: 'Bill no', k: 'bill_no' }, { label: 'Category', csv: b => catName(b.category) },
    { label: 'Amount', k: 'amount' }, { label: 'Description', k: 'description' }, { label: 'Provided by', k: 'provided_by' },
    { label: 'Entered by', k: 'entered_by_email' }], B);

  // spend per vehicle against what accounts declared for the year
  const vs = await vehicles(), { data: decl } = await db.from('vehicles').select('id,annual_maintenance_declared');
  const dm = {}; (decl || []).forEach(d => dm[d.id] = d.annual_maintenance_declared);
  const spent = {}; B.filter(b => b.vehicle_id).forEach(b => spent[b.vehicle_id] = (spent[b.vehicle_id] || 0) + +b.amount);
  const fleetWide = B.filter(b => !b.vehicle_id).reduce((s, b) => s + +b.amount, 0);
  const rows = vs.map(v => ({ v, s: spent[v.id] || 0, d: dm[v.id] })).sort((a, b) => b.s - a.s || (b.d || 0) - (a.d || 0));
  $('blVeh').innerHTML = `<h3>Spend per vehicle</h3>
    <p class="lede">Bills recorded here against the yearly maintenance figure accounts gave for each bus.
      ${fleetWide ? `A further ${rs(Math.round(fleetWide))} is on whole-fleet bills and is not split across buses.` : ''}</p>
    <div class="tscroll"><table><thead><tr><th>Vehicle</th><th class="num">Bills (${period === 'fy' ? 'this year' : period === 'month' ? 'this month' : 'all'})</th><th class="num">Declared per year</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${esc(vLabel(r.v))}</td><td class="num">${r.s ? rs(Math.round(r.s)) : '<span class="muted">—</span>'}</td>
      <td class="num">${r.d != null ? rs(Math.round(r.d)) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}
