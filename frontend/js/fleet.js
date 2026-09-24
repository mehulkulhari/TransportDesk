// Fleet: vehicles, the people who run them, and the logs kept against them.
// This file is the shell (sub-navigation) and the Overview; each tab lives in its
// own fleet_*.js module and exposes render(el).

import { vehicles, staffList, vLabel, n0, fmtD, chip } from './fleetkit.js';
import { renderTyres } from './fleet_tyres.js';
import { renderKm } from './fleet_km.js';
import { renderFuel } from './fleet_fuel.js';
import { renderService } from './fleet_service.js';
import { renderCheckup } from './fleet_checkup.js';
import { renderDocs } from './fleet_docs.js';
import { renderBills } from './fleet_bills.js';
import { renderStaff, renderComplaints } from './fleet_people.js';
import { renderVehicles } from './fleet_vehicles.js';

// What each alert means in plain words, and which tab fixes it.
export const FLEET_KINDS = {
  tyre_unsafe:     ['Tyres at unsafe pressure', 'tyres'],
  doc_expired:     ['Documents expired', 'docs'],
  service_overdue: ['Service overdue', 'service'],
  tyre_pressure:   ['Tyres off recommended pressure', 'tyres'],
  tyre_imbalance:  ['Uneven tyres on one axle', 'tyres'],
  doc_expiring:    ['Documents expiring within 20 days', 'docs'],
  fuel_deviation:  ['Mileage off normal — reason needed', 'fuel'],
  km_backwards:    ['Odometer went backwards', 'km'],
  checkup_action:  ['Parts that require action', 'checkup'],
  complaint_open:  ['Open complaints', 'complaints'],
  km_unexplained:  ['Extra kilometres — reason needed', 'km'],
  tyre_check_due:  ['Tyre check due (every 15 days)', 'tyres'],
  service_due:     ['Service due soon', 'service'],
  spare_in_use:    ['Spare buses in use today', 'vehicles'],
};

const TABS = [
  ['Status', [['overview', 'Overview']]],
  ['Daily', [['tyres', 'Tyres'], ['km', 'Daily km'], ['fuel', 'Fuel']]],
  ['Upkeep', [['service', 'Service'], ['checkup', 'Checkup'], ['docs', 'Documents'], ['bills', 'Bills']]],
  ['People', [['staff', 'Staff'], ['complaints', 'Complaints']]],
  ['Setup', [['vehicles', 'Vehicles'], ['guide', 'Guide']]],
];
const RENDER = {
  overview: renderOverview, tyres: renderTyres, km: renderKm, fuel: renderFuel,
  service: renderService, checkup: renderCheckup, docs: renderDocs, bills: renderBills,
  staff: renderStaff, complaints: renderComplaints, vehicles: renderVehicles,
  guide: el => globalThis.renderMaintenance(el),
};

let current = 'overview';
try { current = localStorage.getItem('fleetTab') || 'overview'; } catch (e) { /* private window */ }

export async function renderFleet(tab) {
  if (tab) current = tab;
  if (!RENDER[current]) current = 'overview';
  try { localStorage.setItem('fleetTab', current); } catch (e) { /* ignore */ }
  const body = $('fleetBody');
  body.innerHTML = `<div class="subnav" id="fleetNav"></div><div id="fleetPane"><div class="hint">Loading…</div></div>`;
  await Promise.all([vehicles(), staffList()]);
  drawNav();
  const pane = $('fleetPane');
  try { await RENDER[current](pane); }
  catch (e) { console.error(e); pane.innerHTML = `<div class="hint-box">This screen could not load: ${esc(e.message || e)}</div>`; }
  refreshCounts();
}

function drawNav() {
  $('fleetNav').innerHTML = TABS.map(([grp, tabs]) =>
    `<span class="sg"><span class="grp">${grp}</span>` + tabs.map(([k, l]) =>
      `<button data-t="${k}" class="${k === current ? 'on' : ''}">${l}<span class="ct" hidden></span></button>`).join('') + '</span>'
  ).join('');
  $('fleetNav').querySelectorAll('button').forEach(b => b.onclick = () => renderFleet(b.dataset.t));
}

/** Badge each tab with how many things on it need attention. */
export async function refreshCounts() {
  const { data } = await db.from('fleet_alerts').select('kind,severity');
  const per = {};
  (data || []).forEach(a => {
    const t = (FLEET_KINDS[a.kind] || [])[1]; if (!t) return;
    const c = per[t] || (per[t] = { n: 0, sev: 0 });
    if (a.severity >= 2) c.n++; c.sev = Math.max(c.sev, a.severity);
  });
  document.querySelectorAll('#fleetNav button').forEach(b => {
    const c = per[b.dataset.t], ct = b.querySelector('.ct');
    if (!ct) return;
    if (c && c.n) { ct.hidden = false; ct.textContent = c.n; ct.classList.toggle('warn', c.sev < 3); }
    else ct.hidden = true;
  });
}

/** Alerts grouped by what they are, most urgent first — never a wall of 100 rows. */
export function alertGroups(alerts, { max = 40 } = {}) {
  const groups = {};
  (alerts || []).forEach(a => (groups[a.kind] = groups[a.kind] || []).push(a));
  const order = Object.keys(FLEET_KINDS);
  const kinds = Object.keys(groups).sort((a, b) =>
    Math.max(...groups[b].map(x => x.severity)) - Math.max(...groups[a].map(x => x.severity)) ||
    order.indexOf(a) - order.indexOf(b));
  if (!kinds.length) return '<div class="note">Nothing needs attention.</div>';
  const html = kinds.map(k => {
    const list = groups[k], sev = Math.max(...list.map(x => x.severity));
    const [label, tab] = FLEET_KINDS[k] || [k.replace(/_/g, ' '), 'overview'];
    const items = list.slice(0, max).map(a => `<li><b>${esc(a.subject)}</b><span>${esc(a.detail)}</span></li>`).join('')
      + (list.length > max ? `<li class="muted">…and ${list.length - max} more</li>` : '');
    return `<details class="agroup sev${sev}" ${sev >= 3 ? 'open' : ''}>
      <summary><b>${list.length}</b><span class="t">${esc(label)}</span>
        <button class="b-ghost linkbtn go-tab" data-tab="${tab}">Open ${esc(tab === 'km' ? 'daily km' : tab)}</button></summary>
      <ul>${items}</ul></details>`;
  }).join('');
  return html;
}
/** Wire the "Open …" buttons inside one container only — the dashboard and the
 *  Fleet view both stay in the DOM, so a document-wide query would cross-wire them. */
export function bindAlertGroups(root, onOpen) {
  root.querySelectorAll('.go-tab').forEach(b => b.onclick = e => {
    e.preventDefault(); e.stopPropagation(); onOpen(b.dataset.tab);
  });
}

/** Switch to the Fleet view on a given tab (used by the main dashboard). */
export function openFleet(tab) {
  const btn = document.querySelector('nav button[data-view="fleet"]');
  current = tab || current;
  if (btn) btn.click(); else renderFleet(tab);
}

async function renderOverview(el) {
  const [{ data: al }, { data: ov }] = await Promise.all([
    db.from('fleet_alerts').select('*'),
    db.from('vehicle_overview').select('*')]);
  const A = al || [], V = ov || [];
  const cnt = f => A.filter(f).length;
  const tile = (v, l, warn) => `<div class="stat ${warn && v > 0 ? 'warn' : ''}"><b>${n0(v)}</b><span>${l}</span></div>`;
  const vcard = v => {
    const sev = v.max_severity;
    const tyre = v.tyre_status ? chip(v.tyre_status) : '';
    return `<div class="vcard sev${sev}">
      <div class="hd"><b>${v.bus_id != null ? 'Bus ' + v.bus_id : v.is_spare ? 'Spare' : 'Unassigned'}</b><span class="mono">${esc(v.reg_no)}</span></div>
      <dl>
        <dt>Tyres</dt><dd>${tyre}${v.tyre_stale ? ' <span class="muted">check due</span>' : ''}</dd>
        <dt>Normal day</dt><dd>${v.avg_daily_km != null ? v.avg_daily_km + ' km' : '<span class="muted">no readings</span>'}</dd>
        <dt>Mileage</dt><dd>${v.avg_kmpl != null ? v.avg_kmpl + ' km/L' : '<span class="muted">no fills</span>'}${v.reference_kmpl ? ` <span class="muted">(ref ${v.reference_kmpl})</span>` : ''}</dd>
        <dt>Service</dt><dd>${chip(v.service_status)}${v.km_remaining != null ? ` <span class="mono">${n0(v.km_remaining)} km</span>` : ''}</dd>
        <dt>Documents</dt><dd>${v.docs_attention ? chip('expiring', v.docs_attention + ' need attention') : v.next_expiry ? 'next ' + fmtD(v.next_expiry) : '<span class="muted">none recorded</span>'}</dd>
      </dl></div>`;
  };
  el.innerHTML = `
    <div class="cards" style="margin-bottom:18px">
      ${tile(cnt(a => a.severity >= 3), 'Need attention now', true)}
      ${tile(cnt(a => a.severity === 2), 'Need attention this week', true)}
      ${tile(cnt(a => a.kind === 'tyre_check_due'), 'Tyre checks due', true)}
      ${tile(cnt(a => a.kind.startsWith('doc_')), 'Documents expired or expiring', true)}
      ${tile(cnt(a => a.kind.startsWith('service_')), 'Service due or overdue', true)}
      ${tile(cnt(a => a.kind === 'complaint_open'), 'Open complaints', true)}
      ${tile(cnt(a => a.kind === 'spare_in_use'), 'Spares in use today')}
    </div>
    <div class="fsplit" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)">
      <div id="ovAlerts"><h3 style="margin:0 0 10px;font-size:15px">What needs attention</h3>${alertGroups(A)}</div>
      <div><h3 style="margin:0 0 10px;font-size:15px">Every vehicle <span class="note">(${V.length} · most urgent first)</span></h3>
        <div class="vgrid">${V.sort((a, b) => b.max_severity - a.max_severity || (a.bus_id ?? 1e4) - (b.bus_id ?? 1e4)).map(vcard).join('')}</div></div>
    </div>`;
  bindAlertGroups($('ovAlerts'), t => renderFleet(t));
}

Object.assign(globalThis, { renderFleet, openFleet });
