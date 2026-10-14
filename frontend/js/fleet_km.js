// Daily kilometres: one odometer reading per bus each morning on reaching school.
// Kilometres run = today's reading minus the last one. After five normal days a bus
// has a baseline, and any day well above or well below it needs a reason before it
// stops alerting.

import { vehicles, vehicleById, vLabel, auditFields, readAudit, auditLine, fmtD, chip,
         routeSelect, busy, today, n0, downloadCsv } from './fleetkit.js';

const NEED_DAYS = 5;          // normal days before a baseline is trusted
const OVER = r => r.km > r.avg * 1.15 && r.km - r.avg > 5;   // mirrors odometer_daily.above_average
// mirrors odometer_daily.below_average: only a one-day gap, since a reading after a
// holiday covers more than one day and is not "low"
const UNDER = r => r.gap === 1 && r.km < r.avg * 0.6 && r.avg - r.km > 5;
const dayGap = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);

export async function renderKm(el) {
  const vs = await vehicles();
  el.innerHTML = `<div class="fstack">
    <div class="fcard"><h3>Morning odometer readings</h3>
      <p class="lede">Enter each bus's odometer when it reaches school. The kilometres since the last reading
        appear as you type. Once a bus has ${NEED_DAYS} normal days on record, a day well above its normal
        (more than 15%) or well below it (under 60%) opens a <b>reason</b> box — that day keeps alerting until a reason is given.</p>
      <div class="frow" style="max-width:640px">${auditFields('km', { dateLabel: 'Reading date' })}
        <div class="field"><label for="kmFind">Find a bus</label><input id="kmFind" placeholder="Bus number, e.g. 12"/></div></div>
      <div id="kmSheet"><div class="hint">Loading…</div></div>
      <div class="actions"><button class="b-primary" id="kmSave">Save readings</button><span class="note" id="kmCount"></span></div></div>
    <div class="fcard" id="kmExtra"></div>
    <div class="fcard" id="kmOff"></div></div>`;
  $('km_on').onchange = () => sheet(vs);
  $('kmFind').oninput = e => { const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('#kmSheet tbody tr').forEach(tr => tr.hidden = q && !tr.dataset.q.includes(q)); };
  $('kmSave').onclick = () => save(el);
  await Promise.all([sheet(vs), extraDays(), offDays()]);
}

let CTX = {};   // per vehicle: previous reading, baseline, and any entry already made for the date

async function sheet(vs) {
  const on = $('km_on').value || today();
  const since = new Date(new Date(on) - 75 * 864e5).toISOString().slice(0, 10);
  const { data } = await db.from('odometer_daily')
    .select('id,vehicle_id,bus_id,reading_km,recorded_on,km_run,gap_days,reason,provided_by')
    .gte('recorded_on', since).lte('recorded_on', on).order('recorded_on');
  const byV = {}; (data || []).forEach(r => (byV[r.vehicle_id] = byV[r.vehicle_id] || []).push(r));
  CTX = {};
  vs.forEach(v => {
    const rs = byV[v.id] || [], mine = rs.find(r => r.recorded_on === on);
    const before = rs.filter(r => r.recorded_on < on);
    const prev = before[before.length - 1];
    const normal = before.filter(r => r.gap_days === 1 && r.km_run >= 0).slice(-30);
    CTX[v.id] = { prev, mine, avg: normal.length ? normal.reduce((s, r) => s + +r.km_run, 0) / normal.length : null, n: normal.length };
  });
  $('kmSheet').innerHTML = `<div class="tscroll"><table><thead><tr><th>Vehicle</th><th>Route covered</th>
      <th class="num">Last reading</th><th class="num">Today's reading</th><th class="num">Km run</th><th class="num">Normal day</th><th>Reason</th></tr></thead>
    <tbody>${vs.map(v => { const c = CTX[v.id];
      const avg = c.n >= NEED_DAYS ? `${c.avg.toFixed(0)} km` : `<span class="muted">${c.n}/${NEED_DAYS} days</span>`;
      const last = c.prev ? `${n0(c.prev.reading_km)}<span class="audit">${fmtD(c.prev.recorded_on)}</span>` : '<span class="muted">first reading</span>';
      if (c.mine) return `<tr data-v="${v.id}" data-q="${esc(vLabel(v)).toLowerCase()}" class="done">
        <td>${esc(vLabel(v))}</td><td>${c.mine.bus_id ?? '—'}</td><td class="num">${last}</td>
        <td class="num"><b>${n0(c.mine.reading_km)}</b><span class="audit">entered${c.mine.provided_by ? ' · ' + esc(c.mine.provided_by) : ''}</span></td>
        <td class="num">${c.mine.km_run ?? '—'}</td><td class="num">${avg}</td><td>${c.mine.reason ? esc(c.mine.reason) : ''}</td></tr>`;
      return `<tr data-v="${v.id}" data-q="${esc(vLabel(v)).toLowerCase()}">
        <td>${esc(vLabel(v))}</td><td>${routeSelect('kmr' + v.id, v.bus_id, { blank: v.is_spare ? 'Pick route…' : 'No route' })}</td>
        <td class="num">${last}</td>
        <td class="num"><input type="number" min="0" step="1" class="kmIn" style="width:110px"/></td>
        <td class="num live"></td><td class="num">${avg}</td>
        <td><input class="kmWhy" placeholder="Why so different from normal?" hidden/></td></tr>`; }).join('')}</tbody></table></div>`;
  $('kmSheet').querySelectorAll('.kmIn').forEach(i => i.addEventListener('input', () => live(i.closest('tr'))));
  count();
}

function live(tr) {
  const c = CTX[+tr.dataset.v], v = tr.querySelector('.kmIn').value, why = tr.querySelector('.kmWhy');
  const cell = tr.querySelector('.live');
  tr.classList.remove('reasonrow'); why.hidden = true; why.required = false;
  if (v === '') { cell.textContent = ''; count(); return; }
  if (!c.prev) { cell.innerHTML = '<span class="muted">starts the record</span>'; count(); return; }
  const km = +v - +c.prev.reading_km;
  if (km < 0) { cell.innerHTML = chip('expired', 'lower than last'); count(); return; }
  cell.innerHTML = `<b>${n0(km)}</b>`;
  const gap = dayGap($('km_on').value || today(), c.prev.recorded_on);
  if (c.n >= NEED_DAYS && (OVER({ km, avg: c.avg }) || UNDER({ km, avg: c.avg, gap }))) {
    const d = Math.round(km - c.avg);
    cell.innerHTML += ` ${chip('due_soon', (d > 0 ? '+' : '') + d)}`;
    tr.classList.add('reasonrow'); why.hidden = false; why.required = true;
  }
  count();
}

function count() {
  const n = [...document.querySelectorAll('#kmSheet .kmIn')].filter(i => i.value !== '').length;
  $('kmCount').textContent = `${n} bus${n === 1 ? '' : 'es'} filled in`;
}

async function save(el) {
  const a = readAudit('km');
  if (a.recorded_on > today()) { toast('The date cannot be in the future', 'bad'); return; }
  const recs = [];
  for (const tr of document.querySelectorAll('#kmSheet tbody tr:not(.done)')) {
    const inp = tr.querySelector('.kmIn'); if (!inp || inp.value === '') continue;
    const vid = +tr.dataset.v, v = vehicleById(vid), c = CTX[vid], route = $('kmr' + vid).value;
    if (v.is_spare && !route) { toast(`Pick the route ${vLabel(v)} covered`, 'bad'); $('kmr' + vid).focus(); return; }
    if (c.prev && +inp.value < +c.prev.reading_km &&
        !confirm(`${vLabel(v)}: ${inp.value} is lower than the last reading (${c.prev.reading_km}). Save it anyway?`)) { inp.focus(); return; }
    const why = tr.querySelector('.kmWhy');
    if (why.required && !why.value.trim()) { toast(`Give a reason for ${vLabel(v)}: its km is far from normal`, 'bad'); why.focus(); return; }
    recs.push({ vehicle_id: vid, bus_id: route ? +route : null, reading_km: +inp.value, reason: why.value.trim() || null, ...a });
  }
  if (!recs.length) { toast('Fill in at least one reading', 'bad'); return; }
  busy($('kmSave'), true);
  const { error } = await db.from('odometer_readings').insert(recs);
  busy($('kmSave'), false);
  if (error) { toast(/one_per_day/.test(error.message) ? 'A reading already exists for one of these buses on this date' : error.message, 'bad'); return; }
  toast(`Saved ${recs.length} reading${recs.length === 1 ? '' : 's'}`, 'good');
  renderKm(el);
}

/** Days a bus ran well above or below its normal — explain them here even after the fact. */
async function extraDays() {
  const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const { data } = await db.from('odometer_daily').select('*')
    .or('above_average.eq.true,below_average.eq.true').gte('recorded_on', since).order('recorded_on', { ascending: false });
  const rows = data || [];
  const box = $('kmExtra');
  box.innerHTML = `<h3>Days off normal <span class="note">(last 45 days)</span></h3>
    <p class="lede">A day well above a bus's normal needs a reason — a trip, a breakdown cover, a detour. So does a day
      well below it — a half day, a breakdown, a reading typed wrong. Days without one stay on the dashboard.</p>
    ${!rows.length ? '<div class="note">No days off normal yet — a bus needs five normal days on record before this can show anything.</div>'
    : `<div class="tscroll"><table><thead><tr><th>Date</th><th>Vehicle</th><th>Route</th><th class="num">Km run</th><th class="num">Normal</th><th class="num">Difference</th><th>Reason</th></tr></thead>
      <tbody>${rows.map(r => `<tr data-id="${r.id}" class="${r.reason ? '' : 'reasonrow'}"><td>${fmtD(r.recorded_on)}</td>
        <td>${esc(vLabel(vehicleById(r.vehicle_id)))}</td><td>${r.bus_id ?? '—'}</td><td class="num">${n0(r.km_run)}</td>
        <td class="num">${r.avg_daily_km}</td><td class="num">${r.extra_km > 0 ? '+' : ''}${n0(r.extra_km)}</td>
        <td>${r.reason ? esc(r.reason) + auditLine(r) : `<div style="display:flex;gap:6px"><input class="why" placeholder="Reason"/><button class="b-ghost linkbtn addWhy">Save</button></div>`}</td></tr>`).join('')}</tbody></table></div>
      <div class="actions"><button class="b-ghost" id="kmCsv">Download CSV</button></div>`}`;
  box.querySelectorAll('.addWhy').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'), why = tr.querySelector('.why').value.trim();
    if (!why) { toast('Write the reason first', 'bad'); return; }
    const { error } = await db.from('odometer_readings').update({ reason: why }).eq('id', +tr.dataset.id);
    if (error) { toast(error.message, 'bad'); return; }
    toast('Reason saved', 'good'); extraDays();
  });
  if ($('kmCsv')) $('kmCsv').onclick = () => downloadCsv('km-off-normal', [
    { label: 'Date', k: 'recorded_on' }, { label: 'Vehicle', csv: r => vLabel(vehicleById(r.vehicle_id)) },
    { label: 'Route', k: 'bus_id' }, { label: 'Km run', k: 'km_run' }, { label: 'Normal', k: 'avg_daily_km' },
    { label: 'Difference from normal', k: 'extra_km' }, { label: 'Reason', k: 'reason' }, { label: 'Provided by', k: 'provided_by' }], rows);
}

/** Holidays and other days the buses do not run. Without them every bus would show
 *  "km not entered" all through a vacation. Sundays are already off. */
async function offDays() {
  const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const { data } = await db.from('fleet_off_days').select('*').eq('active', true).gte('day', since).order('day');
  const rows = data || [], box = $('kmOff');
  box.innerHTML = `<h3>Holidays and days off</h3>
    <p class="lede">Daily km is due every Monday to Saturday by 11:00. Add holidays and vacations here and those days are
      not counted as missing. For a vacation, add each day. Sundays are already off.</p>
    <div class="frow" style="max-width:760px">
      <div class="field"><label for="offOn">Date</label><input id="offOn" type="date"/></div>
      <div class="field"><label for="offTo">Until (optional)</label><input id="offTo" type="date"/></div>
      <div class="field"><label for="offWhy">Reason</label><input id="offWhy" placeholder="Diwali vacation, election duty…"/></div>
      <div class="field"><label for="offBy">Data provided by</label><input id="offBy" placeholder="Principal's circular, office…"/></div></div>
    <div class="actions"><button class="b-primary" id="offAdd">Add</button></div>
    ${!rows.length ? '<div class="note">No holidays entered for the last four months or ahead.</div>'
    : `<div class="tscroll" style="max-height:320px"><table><thead><tr><th>Date</th><th>Reason</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${fmtD(r.day)}</td><td>${esc(r.reason)}${auditLine(r)}</td>
        <td><button class="b-ghost linkbtn offRm" data-d="${r.day}">Remove</button></td></tr>`).join('')}</tbody></table></div>`}`;
  $('offAdd').onclick = async () => {
    const from = $('offOn').value, to = $('offTo').value || from, why = $('offWhy').value.trim();
    if (!from || !why) { toast('Give the date and the reason', 'bad'); return; }
    if (to < from) { toast('"Until" is before the first date', 'bad'); return; }
    const days = [];
    for (let d = from; d <= to; d = new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10)) days.push(d);
    if (days.length > 62) { toast('That is more than two months — check the dates', 'bad'); return; }
    // upsert: a day switched off earlier comes back rather than clashing with the old row
    const { error } = await db.from('fleet_off_days').upsert(days.map(day => ({ day, reason: why, provided_by: $('offBy').value.trim() || null, active: true })), { onConflict: 'day' });
    if (error) { toast(error.message, 'bad'); return; }
    toast(`${days.length} day${days.length === 1 ? '' : 's'} marked off`, 'good'); offDays();
  };
  box.querySelectorAll('.offRm').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this day off? Readings will be due on it again.')) return;
    const { error } = await db.from('fleet_off_days').update({ active: false }).eq('day', b.dataset.d);
    if (error) { toast(error.message, 'bad'); return; }
    toast('Day off removed', 'good'); offDays();
  });
}
