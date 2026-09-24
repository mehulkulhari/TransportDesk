// Maintenance checkup: every part of a bus marked Perfect, Able to run, or
// Requires action. The parts list is the school's own and is edited here.

import { vehicles, vehicleById, vLabel, vehicleSelect, auditFields, readAudit, auditLine,
         fmtD, chip, val, busy, today, deactivate } from './fleetkit.js';

const LEVELS = [['perfect', 'Perfect', 'p'], ['able_to_run', 'Able to run', 'a'], ['requires_action', 'Requires action', 'r']];
let mode = 'do', sel = null;

export async function renderCheckup(el) {
  const vs = await vehicles();
  sel = sel || vs[0]?.id;
  el.innerHTML = `<div class="actions" style="margin:0 0 16px"><div class="seg" id="ckMode">
      <button data-m="do" class="x">Do a checkup</button><button data-m="status" class="x">Fleet status</button>
      <button data-m="parts" class="x">Parts list</button></div></div><div id="ckBody"></div>`;
  el.querySelectorAll('#ckMode button').forEach(b => {
    b.classList.toggle('on', b.dataset.m === mode);
    b.onclick = () => { mode = b.dataset.m; renderCheckup(el); };
  });
  if (mode === 'parts') return parts($('ckBody'), el);
  if (mode === 'status') return status($('ckBody'), el);
  return form($('ckBody'), el);
}

async function loadParts(all) {
  let q = db.from('checkup_parts').select('*').order('sort_order').order('name');
  if (!all) q = q.eq('active', true);
  const { data } = await q; return data || [];
}

async function form(body, root) {
  const P = await loadParts();
  const cats = [...new Set(P.map(p => p.category || 'Other'))];
  body.innerHTML = `<div class="fsplit">
    <div class="fcard"><h3>Checkup</h3>
      <p class="lede">Mark every part. <b>Able to run</b> means usable but worth watching; <b>Requires action</b>
        means it must be fixed, and it stays on the dashboard until the next checkup clears it.</p>
      <div class="field"><label for="ckV">Vehicle</label>${vehicleSelect('ckV', sel)}</div>
      <div class="frow">${auditFields('ck', { dateLabel: 'Checkup date' })}</div>
      <div class="field"><label for="ckN">Notes</label><textarea id="ckN" rows="2"></textarea></div>
      <div class="actions"><button class="b-ghost" id="ckAll">Mark every part perfect</button></div>
      <div class="hint-box" id="ckTally" style="margin-top:10px"></div>
      <div class="actions"><button class="b-primary" id="ckSave">Save checkup</button></div></div>
    <div class="fcard"><h3>Parts <span class="note">(${P.length})</span></h3>
      ${!P.length ? '<div class="note">The parts list is empty — add parts under <b>Parts list</b>.</div>' :
        cats.map(c => `<h4 style="margin:14px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--slate)">${esc(c)}</h4>
        <div class="tscroll" style="max-height:none"><table><tbody>${P.filter(p => (p.category || 'Other') === c).map(p =>
          `<tr data-p="${p.id}"><td style="width:34%">${esc(p.name)}</td>
           <td><div class="seg">${LEVELS.map(([k, l, cl]) => `<button type="button" data-s="${k}" class="${cl}">${l}</button>`).join('')}</div></td>
           <td><input class="ckNote" placeholder="What is wrong?" hidden/></td></tr>`).join('')}</tbody></table></div>`).join('')}
    </div></div>
    <div class="fcard" id="ckHist" style="margin-top:16px"></div>`;
  const set = (tr, s) => {
    tr.dataset.s = s;
    tr.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
    const n = tr.querySelector('.ckNote'); n.hidden = s === 'perfect'; tally();
  };
  const tally = () => {
    const rows = [...body.querySelectorAll('tr[data-p]')], c = s => rows.filter(r => r.dataset.s === s).length;
    const left = rows.filter(r => !r.dataset.s).length;
    $('ckTally').innerHTML = `${chip('perfect', c('perfect') + ' perfect')} ${chip('able_to_run', c('able_to_run') + ' able to run')}
      ${chip('requires_action', c('requires_action') + ' requires action')} ${left ? `<span class="muted">· ${left} not marked yet</span>` : ''}`;
  };
  body.querySelectorAll('tr[data-p] .seg button').forEach(b => b.onclick = () => set(b.closest('tr'), b.dataset.s));
  $('ckAll').onclick = () => body.querySelectorAll('tr[data-p]').forEach(tr => { if (!tr.dataset.s) set(tr, 'perfect'); });
  $('ckV').onchange = () => { sel = +$('ckV').value; hist(); };
  tally();
  $('ckSave').onclick = async () => {
    const rows = [...body.querySelectorAll('tr[data-p]')];
    const miss = rows.filter(r => !r.dataset.s);
    if (miss.length) { toast(`${miss.length} part${miss.length > 1 ? 's are' : ' is'} not marked yet`, 'bad'); miss[0].scrollIntoView({ block: 'center' }); return; }
    const a = readAudit('ck');
    if (a.recorded_on > today()) { toast('The date cannot be in the future', 'bad'); return; }
    busy($('ckSave'), true);
    const { data: ck, error } = await db.from('checkups').insert({ vehicle_id: +$('ckV').value, notes: val('ckN'), ...a }).select('id').single();
    if (error) { busy($('ckSave'), false); toast(error.message, 'bad'); return; }
    const { error: e2 } = await db.from('checkup_items').insert(rows.map(r => ({
      checkup_id: ck.id, part_id: +r.dataset.p, status: r.dataset.s, note: r.querySelector('.ckNote').value.trim() || null })));
    busy($('ckSave'), false);
    if (e2) {
      // a checkup with no parts would read as "all clear" — hide it rather than leave it half-saved
      await db.from('checkups').update({ active: false }).eq('id', ck.id);
      toast(e2.message, 'bad'); return;
    }
    toast('Checkup saved', 'good'); sel = +$('ckV').value; renderCheckup(root);
  };
  hist();
}

async function hist() {
  const { data: cks } = await db.from('checkups').select('*').eq('vehicle_id', sel).eq('active', true)
    .order('recorded_on', { ascending: false }).limit(8);
  const ids = (cks || []).map(c => c.id);
  const { data: items } = ids.length ? await db.from('checkup_items').select('checkup_id,status,note,checkup_parts(name)').in('checkup_id', ids) : { data: [] };
  const by = {}; (items || []).forEach(i => (by[i.checkup_id] = by[i.checkup_id] || []).push(i));
  $('ckHist').innerHTML = `<h3>${esc(vLabel(vehicleById(sel)))} — past checkups</h3>
    ${!(cks || []).length ? '<div class="note">No checkups recorded for this vehicle.</div>' : (cks || []).map(c => {
      const it = by[c.id] || [], bad = it.filter(i => i.status !== 'perfect');
      return `<div style="border-top:1px solid var(--edge-soft);padding:8px 0">
        <b>${fmtD(c.recorded_on)}</b> ${chip('perfect', it.filter(i => i.status === 'perfect').length + ' perfect')}
        ${bad.length ? bad.map(i => chip(i.status, i.checkup_parts?.name || '?') + (i.note ? ` <span class="muted">${esc(i.note)}</span>` : '')).join(' ') : ''}
        ${c.notes ? `<span class="audit">${esc(c.notes)}</span>` : ''}${auditLine(c)}
        <button class="b-ghost linkbtn" data-del="${c.id}" style="float:right">Remove</button></div>`; }).join('')}`;
  $('ckHist').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (await deactivate('checkups', b.dataset.del, 'checkup')) hist();
  });
}

async function status(body, root) {
  const [vs, { data }] = await Promise.all([vehicles(), db.from('checkup_status').select('*')]);
  const by = {}; (data || []).forEach(r => by[r.vehicle_id] = r);
  const rows = vs.map(v => ({ v, s: by[v.id] })).sort((a, b) =>
    (b.s?.n_action || 0) - (a.s?.n_action || 0) || (b.s?.n_able || 0) - (a.s?.n_able || 0) ||
    (a.s ? 0 : 1) - (b.s ? 0 : 1));
  body.innerHTML = `<div class="fcard"><h3>Latest checkup per vehicle</h3>
    <p class="lede">${rows.filter(r => r.s?.n_action).length} vehicles have parts that require action ·
      ${rows.filter(r => !r.s).length} have never been checked.</p>
    <div class="tscroll"><table><thead><tr><th>Vehicle</th><th>Last checkup</th><th class="num">Perfect</th>
      <th class="num">Able to run</th><th class="num">Requires action</th><th>Parts needing action</th></tr></thead>
    <tbody>${rows.map(({ v, s }) => `<tr data-v="${v.id}" style="cursor:pointer"><td>${esc(vLabel(v))}</td>
      <td>${s ? fmtD(s.recorded_on) + ` <span class="muted">(${s.days_since} days ago)</span>` : '<span class="muted">never</span>'}</td>
      <td class="num">${s?.n_perfect ?? ''}</td><td class="num">${s?.n_able ? chip('able_to_run', s.n_able) : s ? 0 : ''}</td>
      <td class="num">${s?.n_action ? chip('requires_action', s.n_action) : s ? 0 : ''}</td>
      <td>${esc(s?.action_parts || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
  body.querySelectorAll('tr[data-v]').forEach(tr => tr.onclick = () => { sel = +tr.dataset.v; mode = 'do'; renderCheckup(root); });
}

async function parts(body, root) {
  const P = await loadParts(true);
  body.innerHTML = `<div class="fcard" style="max-width:820px"><h3>Parts checked on every bus</h3>
    <p class="lede">This is a <b>starter list</b>. Replace it with the school's own: rename parts, change their group
      and order, or switch off ones you do not check. Switched-off parts disappear from new checkups but stay in old ones.</p>
    <div class="tscroll"><table><thead><tr><th>Part</th><th>Group</th><th class="num">Order</th><th>In use</th></tr></thead>
      <tbody>${P.map(p => `<tr data-id="${p.id}"><td><input data-k="name" value="${esc(p.name)}"/></td>
        <td><input data-k="category" value="${esc(p.category || '')}" style="width:140px"/></td>
        <td class="num"><input data-k="sort_order" type="number" value="${p.sort_order}" style="width:80px"/></td>
        <td><input data-k="active" type="checkbox" ${p.active ? 'checked' : ''} style="width:auto"/></td></tr>`).join('')}</tbody></table></div>
    <div class="actions"><button class="b-primary" id="pSave">Save changes</button></div>
    <h3 style="margin-top:18px">Add a part</h3>
    <div class="frow"><div class="field"><label for="pN">Part</label><input id="pN"/></div>
      <div class="field"><label for="pC">Group</label><input id="pC" list="pCats"/><datalist id="pCats">${[...new Set(P.map(p => p.category).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label for="pO">Order</label><input id="pO" type="number" value="${(Math.max(0, ...P.map(p => p.sort_order)) + 10)}"/></div></div>
    <div class="actions"><button class="b-ghost" id="pAdd">Add part</button></div></div>`;
  const dirty = new Set();
  body.querySelectorAll('tbody input').forEach(i => i.addEventListener('input', () => dirty.add(+i.closest('tr').dataset.id)));
  $('pSave').onclick = async () => {
    if (!dirty.size) { toast('Nothing changed'); return; }
    for (const id of dirty) {
      const tr = body.querySelector(`tr[data-id="${id}"]`), r = {};
      tr.querySelectorAll('[data-k]').forEach(i => r[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value.trim());
      if (!r.name) { toast('A part needs a name', 'bad'); return; }
      const { error } = await db.from('checkup_parts').update(r).eq('id', id);
      if (error) { toast(error.message, 'bad'); return; }
    }
    toast(`Saved ${dirty.size} part${dirty.size > 1 ? 's' : ''}`, 'good'); parts(body, root);
  };
  $('pAdd').onclick = async () => {
    const name = val('pN'); if (!name) { toast('Name the part', 'bad'); return; }
    const { error } = await db.from('checkup_parts').insert({ name, category: val('pC'), sort_order: +$('pO').value || 100 });
    if (error) { toast(/duplicate/.test(error.message) ? 'That part is already on the list' : error.message, 'bad'); return; }
    toast('Part added', 'good'); parts(body, root);
  };
}
