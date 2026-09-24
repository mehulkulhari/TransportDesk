// Tyres: the board (every bus seen from above), the recommended pressure for each
// vehicle, and the fortnightly entry sheet.

import { vehicles, vehicleById, vLabel, auditFields, readAudit, auditLine, fmtD, chip,
         routeSelect, deactivate, busy, today, n0 } from './fleetkit.js';

const POS = [['fl', 'FL', 'Front left'], ['fr', 'FR', 'Front right'], ['bl', 'BL', 'Back left'], ['br', 'BR', 'Back right']];
let mode = 'board', focusVehicle = null;

/** How far one tyre is from its recommended pressure, as a colour. Mirrors tyre_status. */
function tone(v, rec) {
  if (v == null || v === '') return '';
  if (!rec) return 'mute';
  const d = 100 * (v - rec) / rec;
  if (d <= -30 || d >= 25) return 'stop';
  if (d <= -10 || d >= 10) return 'warn';
  return 'ok';
}
const dev = (v, rec) => v == null || !rec ? '' : `${v >= rec ? '+' : ''}${Math.round(100 * (v - rec) / rec)}%`;

export async function renderTyres(el) {
  el.innerHTML = `<div class="actions" style="margin:0 0 16px">
      <div class="seg" id="tyMode">
        <button data-m="board">Board</button><button data-m="spec">Recommended pressure</button><button data-m="entry">Enter readings</button>
      </div><span class="note" id="tyNote"></span></div><div id="tyBody"></div>`;
  el.querySelectorAll('#tyMode button').forEach(b => {
    b.classList.toggle('on', b.dataset.m === mode); b.classList.toggle('x', true);
    b.onclick = () => { mode = b.dataset.m; renderTyres(el); };
  });
  const body = $('tyBody');
  if (mode === 'spec') return drawSpecs(body);
  if (mode === 'entry') return drawEntry(body, el);
  return drawBoard(body, el);
}

// ---------------------------------------------------------------- board
async function drawBoard(body, root) {
  const { data } = await db.from('tyre_status').select('*');
  const rows = (data || []).sort((a, b) => (a.bus_id ?? 1e4) - (b.bus_id ?? 1e4));
  const bad = rows.filter(r => ['unsafe', 'low', 'high'].includes(r.status) || r.imbalanced);
  const due = rows.filter(r => r.stale);
  const est = rows.filter(r => r.spec_source === 'inferred').length;
  $('tyNote').innerHTML = `${bad.length} vehicles off pressure · ${due.length} due a check (every 15 days)`;
  const card = r => {
    const t = POS.map(([k, l]) => {
      const v = r[k], rec = r['rec_' + k];
      return `<div class="tyre ${tone(v, rec)}" title="${l}: ${v ?? 'not read'} psi, recommended ${rec ?? '—'}">${v ?? '–'}<small>${v != null ? dev(v, rec) || l : l}</small></div>`;
    }).join('');
    return `<div class="tbus" data-v="${r.vehicle_id}">
      <div class="hd"><b>${r.bus_id != null ? 'Bus ' + r.bus_id : r.is_spare ? 'Spare' : 'Unassigned'}</b><span>${esc(r.reg_no)}</span></div>
      <div class="chassis">${t}</div>
      <div class="ft"><span>${r.recorded_on ? fmtD(r.recorded_on) : 'never checked'}</span>
        ${chip(r.status)}${r.imbalanced && r.status !== 'unsafe' ? ' ' + chip('high', 'uneven') : ''}</div></div>`;
  };
  body.innerHTML = `
    ${est ? `<div class="hint-box" style="margin-bottom:14px">${est} of ${rows.length} vehicles are measured against an
      <b>estimated</b> recommended pressure. Read the pressure off each door placard and enter it under
      <b>Recommended pressure</b> — until then, "unsafe" on those buses may be a false alarm.</div>` : ''}
    <div class="actions" style="margin:0 0 12px"><div class="seg" id="tyFilter">
      <button data-f="all" class="on x">All ${rows.length}</button>
      <button data-f="bad" class="x">Off pressure ${bad.length}</button><button data-f="due" class="x">Check due ${due.length}</button></div>
      <span class="note">Colour shows each tyre against its own recommended pressure. Click a bus for its history.</span></div>
    <div class="tyregrid" id="tyGrid">${rows.map(card).join('')}</div>
    <div id="tyHist" style="margin-top:18px"></div>`;
  const draw = f => {
    const set = f === 'bad' ? bad : f === 'due' ? due : rows;
    $('tyGrid').innerHTML = set.map(card).join('') || '<div class="note">Nothing here.</div>';
    $('tyGrid').querySelectorAll('.tbus').forEach(c => c.onclick = () => history(+c.dataset.v, root));
  };
  body.querySelectorAll('#tyFilter button').forEach(b => b.onclick = () => {
    body.querySelectorAll('#tyFilter button').forEach(x => x.classList.toggle('on', x === b)); draw(b.dataset.f);
  });
  draw('all');
  if (focusVehicle) history(focusVehicle, root);
}

async function history(vid, root) {
  focusVehicle = vid;
  const v = vehicleById(vid);
  const { data } = await db.from('tyre_readings').select('*').eq('vehicle_id', vid).eq('active', true)
    .order('recorded_on', { ascending: false }).limit(20);
  $('tyHist').innerHTML = `<div class="fcard"><h3>${esc(vLabel(v))} — pressure history</h3>
    <p class="lede">Most recent first. A wrong entry can be removed; it stays in the record as removed.</p>
    <div class="tscroll"><table><thead><tr><th>Date</th><th class="num">FL</th><th class="num">FR</th><th class="num">BL</th><th class="num">BR</th><th>Route</th><th>Source</th><th></th></tr></thead>
    <tbody>${(data || []).map(r => `<tr><td>${fmtD(r.recorded_on)}</td>
      ${POS.map(([k]) => `<td class="num">${r[k] ?? '–'}</td>`).join('')}
      <td>${r.bus_id ?? '—'}</td><td>${auditLine(r)}${r.notes ? `<span class="audit">${esc(r.notes)}</span>` : ''}</td>
      <td><button class="b-ghost linkbtn" data-del="${r.id}">Remove</button></td></tr>`).join('')
      || '<tr><td colspan="8" class="muted">No readings yet.</td></tr>'}</tbody></table></div>
    <div class="actions"><button class="b-primary" id="tyAddOne">Enter a reading for this bus</button></div></div>`;
  $('tyHist').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (await deactivate('tyre_readings', b.dataset.del, 'reading')) renderTyres(root);
  });
  $('tyAddOne').onclick = () => { mode = 'entry'; renderTyres(root); };
  $('tyHist').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------------------------------------------------------------- specs
async function drawSpecs(body) {
  const vs = await vehicles();
  const { data } = await db.from('tyre_specs').select('*');
  const by = {}; (data || []).forEach(s => by[s.vehicle_id] = s);
  $('tyNote').textContent = 'The pressure each tyre should be at, cold. Read it off the door or frame placard.';
  body.innerHTML = `<div class="fcard">
    <h3>Recommended pressure per vehicle</h3>
    <p class="lede"><b>Estimated</b> figures came from tyre size and model and are only a starting point.
      When you read the real figure off a vehicle's placard, enter it and set the source to <b>Placard</b> —
      alerts become trustworthy for that bus from then on.</p>
    <div class="frow" style="max-width:520px">${auditFields('sp', { dateLabel: 'Date checked' })}</div>
    <div class="tscroll"><table><thead><tr><th>Vehicle</th><th>Tyre size</th>
      ${POS.map(([, l, t]) => `<th class="num" title="${t}">${l} psi</th>`).join('')}<th>Source</th><th></th></tr></thead>
      <tbody>${vs.map(v => { const s = by[v.id] || {};
        return `<tr data-v="${v.id}"><td>${esc(vLabel(v))}</td><td class="mono">${esc(v.tyre_size || '—')}</td>
          ${POS.map(([k]) => `<td class="num"><input type="number" min="10" max="200" step="1" data-k="rec_${k}" value="${s['rec_' + k] ?? ''}" style="width:70px"/></td>`).join('')}
          <td><select data-k="source" style="width:120px">${['inferred', 'placard', 'manual'].map(o =>
            `<option value="${o}" ${(s.source || 'inferred') === o ? 'selected' : ''}>${{ inferred: 'Estimated', placard: 'Placard', manual: 'Manual' }[o]}</option>`).join('')}</select></td>
          <td>${s.provided_by ? `<span class="audit">${esc(s.provided_by)}</span>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="actions"><button class="b-primary" id="spSave">Save changed rows</button><span class="note">Only rows you edit are saved.</span></div></div>`;
  const dirty = new Set();
  body.querySelectorAll('tbody input,tbody select').forEach(i => i.addEventListener('input', () => dirty.add(+i.closest('tr').dataset.v)));
  $('spSave').onclick = async () => {
    if (!dirty.size) { toast('Nothing changed'); return; }
    const a = readAudit('sp');
    const rows = [...dirty].map(id => {
      const tr = body.querySelector(`tr[data-v="${id}"]`), r = { vehicle_id: id, recorded_on: a.recorded_on, provided_by: a.provided_by };
      tr.querySelectorAll('[data-k]').forEach(i => r[i.dataset.k] = i.type === 'number' ? (i.value === '' ? null : +i.value) : i.value);
      return r;
    });
    busy($('spSave'), true);
    const { error } = await db.from('tyre_specs').upsert(rows, { onConflict: 'vehicle_id' });
    busy($('spSave'), false);
    if (error) { toast(error.message, 'bad'); return; }
    toast(`Saved ${rows.length} vehicle${rows.length === 1 ? '' : 's'}`, 'good'); dirty.clear();
  };
}

// ---------------------------------------------------------------- entry sheet
async function drawEntry(body, root) {
  const vs = await vehicles();
  const [{ data: specs }, { data: last }] = await Promise.all([
    db.from('tyre_specs').select('*'), db.from('tyre_status').select('vehicle_id,fl,fr,bl,br,recorded_on')]);
  const sp = {}, ls = {};
  (specs || []).forEach(s => sp[s.vehicle_id] = s); (last || []).forEach(s => ls[s.vehicle_id] = s);
  $('tyNote').textContent = 'Fill in only the buses you checked. Blank rows are ignored.';
  const order = focusVehicle ? [vehicleById(focusVehicle), ...vs.filter(v => v.id !== focusVehicle)].filter(Boolean) : vs;
  body.innerHTML = `<div class="fcard">
    <h3>Enter tyre pressures</h3>
    <p class="lede">Check cold, before the morning run, every 15 days. The colour beside each figure is live
      against that vehicle's recommended pressure. A spare covering a route should have that route chosen.</p>
    <div class="frow" style="max-width:640px">${auditFields('ty', { dateLabel: 'Date checked' })}
      <div class="field"><label for="tyFind">Find a bus</label><input id="tyFind" placeholder="Bus number or registration"/></div></div>
    <div class="tscroll"><table><thead><tr><th>Vehicle</th><th>Route covered</th>
      ${POS.map(([, l, t]) => `<th class="num" title="${t}">${l}</th>`).join('')}<th>Last check</th><th>Now</th></tr></thead>
      <tbody>${order.map(v => { const s = sp[v.id] || {}, l = ls[v.id] || {};
        return `<tr data-v="${v.id}" data-q="${esc((v.bus_id ?? '') + ' ' + v.reg_no).toLowerCase()}">
          <td>${esc(vLabel(v))}</td>
          <td>${routeSelect('tyr' + v.id, v.bus_id, { blank: v.is_spare ? 'Pick route…' : 'No route' })}</td>
          ${POS.map(([k]) => `<td class="num"><input type="number" min="0" max="250" step="1" data-k="${k}"
             placeholder="${s['rec_' + k] ?? ''}" title="Recommended ${s['rec_' + k] ?? '—'} psi" style="width:64px"/></td>`).join('')}
          <td class="muted">${l.recorded_on ? fmtD(l.recorded_on) + ` <span class="mono">${[l.fl, l.fr, l.bl, l.br].map(x => x ?? '–').join('/')}</span>` : 'never'}</td>
          <td class="live"></td></tr>`; }).join('')}</tbody></table></div>
    <div class="actions"><button class="b-primary" id="tySave">Save readings</button><span class="note" id="tyCount">0 buses filled in</span></div></div>`;
  focusVehicle = null;
  const filled = () => [...body.querySelectorAll('tbody tr')].filter(tr => [...tr.querySelectorAll('input[data-k]')].some(i => i.value !== ''));
  body.querySelectorAll('tbody input[data-k]').forEach(i => i.addEventListener('input', () => {
    const tr = i.closest('tr'), s = sp[+tr.dataset.v] || {};
    i.className = tone(i.value === '' ? null : +i.value, s['rec_' + i.dataset.k]) ? 'tone-' + tone(+i.value, s['rec_' + i.dataset.k]) : '';
    const vals = POS.map(([k]) => { const x = tr.querySelector(`[data-k="${k}"]`).value; return x === '' ? null : +x; });
    const tones = POS.map(([k], j) => tone(vals[j], s['rec_' + k])).filter(Boolean);
    tr.querySelector('.live').innerHTML = !tones.length ? '' : tones.includes('stop') ? chip('unsafe') : tones.includes('warn') ? chip('low', 'off pressure') : tones.includes('mute') ? chip('no_spec') : chip('ok');
    $('tyCount').textContent = `${filled().length} bus${filled().length === 1 ? '' : 'es'} filled in`;
  }));
  $('tyFind').oninput = e => { const q = e.target.value.trim().toLowerCase();
    body.querySelectorAll('tbody tr').forEach(tr => tr.hidden = q && !tr.dataset.q.includes(q)); };
  $('tySave').onclick = async () => {
    const rows = filled(); if (!rows.length) { toast('Fill in at least one bus', 'bad'); return; }
    const a = readAudit('ty');
    if (a.recorded_on > today()) { toast('The date cannot be in the future', 'bad'); return; }
    const recs = [];
    for (const tr of rows) {
      const vid = +tr.dataset.v, v = vehicleById(vid), route = $('tyr' + vid).value;
      if (v.is_spare && !route) { toast(`Pick the route ${v.reg_no} covered`, 'bad'); $('tyr' + vid).focus(); return; }
      const r = { vehicle_id: vid, bus_id: route ? +route : null, ...a };
      tr.querySelectorAll('input[data-k]').forEach(i => r[i.dataset.k] = i.value === '' ? null : +i.value);
      recs.push(r);
    }
    busy($('tySave'), true);
    const { error } = await db.from('tyre_readings').insert(recs);
    busy($('tySave'), false);
    if (error) { toast(error.message, 'bad'); return; }
    toast(`Saved ${recs.length} bus${recs.length === 1 ? '' : 'es'}`, 'good');
    mode = 'board'; renderTyres(root);
  };
}
