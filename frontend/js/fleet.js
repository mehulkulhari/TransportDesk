// Fleet: vehicles, the people who run them, and the logs kept against them.
// This file is the shell (sub-navigation) and the Overview; each tab lives in its
// own fleet_*.js module and exposes render(el).

import { vehicles, staffList, vLabel, vehicleById, n0, fmtD, chip } from './fleetkit.js';
import { renderFleetWeek } from './fleet_week.js';
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
  km_unexplained:  ['Km far from normal — reason needed', 'km'],
  km_missing:      ['Daily km not entered', 'km'],
  fuel_missing:    ['No fuel fill logged for too long', 'fuel'],
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

/** Who an alert is about: a vehicle by its bus number (never its registration), else the person. */
export function alertWho(a) {
  if (a.vehicle_id != null) { const v = vehicleById(a.vehicle_id); if (v) return vLabel(v); }
  return a.bus_id != null && a.vehicle_id != null ? 'Bus ' + a.bus_id : a.subject || '—';
}

/** Alerts grouped by what they are, most urgent first. Every group starts closed:
 *  the heading and count are the summary, the rows open on a click. */
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
    const items = list.slice(0, max).map(a => `<li><b>${esc(alertWho(a))}</b><span>${esc(a.detail)}</span></li>`).join('')
      + (list.length > max ? `<li class="muted">…and ${list.length - max} more</li>` : '');
    return `<details class="agroup sev${sev}">
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
  el.innerHTML = `<div id="ovWeek"></div>
    <details class="fsec" id="ovVehicles"><summary><b>Every vehicle</b>
      <span class="note">status card per bus, most urgent first</span></summary><div class="hint">Loading…</div></details>`;
  // the cards are only fetched when someone opens them
  $('ovVehicles').addEventListener('toggle', async e => {
    const box = e.target; if (!box.open || box.dataset.done) return;
    box.dataset.done = '1';
    const { data: ov } = await db.from('vehicle_overview').select('*');
    const V = (ov || []).sort((a, b) => b.max_severity - a.max_severity || (a.bus_id ?? 1e4) - (b.bus_id ?? 1e4));
    box.querySelector('summary .note').textContent = `${V.length} vehicles · status card per bus, most urgent first`;
    box.querySelector('.hint').outerHTML = `<div class="vgrid">${V.map(vcard).join('')}</div>`;
  });
  await renderFleetWeek($('ovWeek'), t => renderFleet(t));
}

function vcard(v) {
  const tyre = v.tyre_status ? chip(v.tyre_status) : '';
  return `<div class="vcard sev${v.max_severity}">
    <div class="hd"><b>${esc(vLabel(vehicleById(v.vehicle_id) || v))}</b></div>
    <dl>
      <dt>Tyres</dt><dd>${tyre}${v.tyre_stale ? ' <span class="muted">check due</span>' : ''}</dd>
      <dt>Normal day</dt><dd>${v.avg_daily_km != null ? v.avg_daily_km + ' km' : '<span class="muted">no readings</span>'}</dd>
      <dt>Mileage</dt><dd>${v.avg_kmpl != null ? v.avg_kmpl + ' km/L' : '<span class="muted">no fills</span>'}${v.reference_kmpl ? ` <span class="muted">(ref ${v.reference_kmpl})</span>` : ''}</dd>
      <dt>Service</dt><dd>${chip(v.service_status)}${v.km_remaining != null ? ` <span class="mono">${n0(v.km_remaining)} km</span>` : ''}</dd>
      <dt>Documents</dt><dd>${v.docs_attention ? chip('expiring', v.docs_attention + ' need attention') : v.next_expiry ? 'next ' + fmtD(v.next_expiry) : '<span class="muted">none recorded</span>'}</dd>
    </dl></div>`;
}

Object.assign(globalThis, { renderFleet, openFleet });
