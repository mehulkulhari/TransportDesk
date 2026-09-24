// Shared building blocks for the Fleet screens.
//
// Every log in the fleet module records the VEHICLE (the physical bus, by
// registration) and, separately, the ROUTE it covered. They are not the same
// thing: vehicles move between routes, and a spare bus has no route of its own
// until it stands in for one. See supabase/migrations/20260924000000_*.sql.

let VEH = null, STAFF = null;

export const today = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export const fmtD = d => d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : ''))
  .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const n0 = v => v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN');

/** Active vehicles: route buses in route order, then spares, then anything unassigned. */
export async function vehicles(force) {
  if (VEH && !force) return VEH;
  const { data, error } = await db.from('vehicles')
    .select('id,reg_no,bus_id,is_spare,make,model_year,seats,tyre_size,notes').eq('active', true);
  if (error) { toast(error.message, 'bad'); return VEH || []; }
  const rank = v => v.bus_id != null ? v.bus_id : v.is_spare ? 1e4 : 2e4;
  VEH = (data || []).sort((a, b) => rank(a) - rank(b) || a.reg_no.localeCompare(b.reg_no));
  return VEH;
}
export const vehicleById = id => (VEH || []).find(v => v.id === +id);

export function vLabel(v) {
  if (!v) return '—';
  return (v.bus_id != null ? `Bus ${v.bus_id}` : v.is_spare ? 'Spare' : 'Unassigned') + ' · ' + v.reg_no;
}

export async function staffList(force) {
  if (STAFF && !force) return STAFF;
  const { data } = await db.from('staff').select('id,name,role,phone,active').order('name');
  STAFF = data || [];
  return STAFF;
}

export function vehicleSelect(id, selected, { blank = '' } = {}) {
  const o = (VEH || []).map(v =>
    `<option value="${v.id}" ${+selected === v.id ? 'selected' : ''}>${esc(vLabel(v))}</option>`).join('');
  return `<select id="${id}">${blank ? `<option value="">${esc(blank)}</option>` : ''}${o}</select>`;
}

export function routeSelect(id, selected, { blank = 'No route' } = {}) {
  const o = (globalThis.buses || []).map(b =>
    `<option value="${b.bus_id}" ${+selected === b.bus_id ? 'selected' : ''}>Route ${b.bus_id}</option>`).join('');
  return `<select id="${id}"><option value="">${esc(blank)}</option>${o}</select>`;
}

/** A spare must name the route it covered; a route bus defaults to its own. */
export function bindVehicleRoute(vehId, routeId) {
  const sync = () => {
    const v = vehicleById($(vehId).value); if (!v) return;
    $(routeId).value = v.bus_id ?? '';
    $(routeId).closest('.field')?.classList.toggle('needs', !!v.is_spare);
  };
  $(vehId).addEventListener('change', sync); sync();
}

/** The "date" and "data provided by" pair that every entry in the fleet module carries. */
export function auditFields(prefix, { date = today(), dateLabel = 'Date', who = '' } = {}) {
  const names = (STAFF || []).map(s => `<option value="${esc(s.name)}">`).join('');
  return `<div class="field"><label for="${prefix}_on">${esc(dateLabel)}</label>
      <input id="${prefix}_on" type="date" value="${date}" max="${today()}"/></div>
    <div class="field"><label for="${prefix}_by">Data provided by</label>
      <input id="${prefix}_by" list="${prefix}_names" value="${esc(who)}" placeholder="Driver, mechanic, accounts…"/>
      <datalist id="${prefix}_names">${names}</datalist></div>`;
}
export function readAudit(prefix) {
  return { recorded_on: $(prefix + '_on').value || today(), provided_by: val(prefix + '_by') };
}

/** Who gave it, who typed it, when — shown under every record. */
export function auditLine(r) {
  const bits = [];
  if (r.provided_by) bits.push('from ' + esc(r.provided_by));
  if (r.entered_by_email) bits.push('entered by ' + esc(r.entered_by_email));
  if (r.entered_at) bits.push(new Date(r.entered_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }));
  return bits.length ? `<span class="audit">${bits.join(' · ')}</span>` : '';
}

export const val = id => { const e = $(id); const s = e ? String(e.value).trim() : ''; return s === '' ? null : s; };
export const num = id => { const s = val(id); if (s == null) return null; const x = Number(s); return Number.isFinite(x) ? x : null; };

const CHIP = {
  ok: 'ok', perfect: 'ok', resolved: 'ok', placard: 'ok',
  low: 'warn', high: 'warn', due_soon: 'warn', expiring: 'warn', able_to_run: 'warn', open: 'warn', manual: 'warn',
  unsafe: 'stop', expired: 'stop', overdue: 'stop', requires_action: 'stop',
  inferred: 'mute', no_reading: 'mute', no_spec: 'mute', no_record: 'mute', no_plan: 'mute',
  no_odometer: 'mute', no_expiry: 'mute', dismissed: 'mute'
};
const CHIP_TEXT = {
  ok: 'OK', perfect: 'Perfect', able_to_run: 'Able to run', requires_action: 'Requires action',
  due_soon: 'Due soon', no_reading: 'No reading', no_spec: 'No spec', no_record: 'No service record',
  no_plan: 'No plan', no_odometer: 'No odometer', no_expiry: 'No expiry', inferred: 'Estimated',
  placard: 'Placard', manual: 'Manual'
};
export function chip(status, text) {
  if (status == null) return '';
  const t = text ?? CHIP_TEXT[status] ?? String(status).replace(/_/g, ' ');
  return `<span class="chip ${CHIP[status] || 'mute'}">${esc(t)}</span>`;
}

/** Deactivate, never delete — the database has no delete permission at all. */
export async function deactivate(table, id, what) {
  if (!confirm(`Remove this ${what}? It is hidden, not erased, and stays in the history.`)) return false;
  const { error } = await db.from(table).update({ active: false }).eq('id', id);
  if (error) { toast(error.message, 'bad'); return false; }
  toast(`${what[0].toUpperCase() + what.slice(1)} removed`, 'good');
  return true;
}

const BUCKET = 'fleet-documents';
export async function upload(file, folder) {
  if (!file) return null;
  if (file.size > 10 * 1024 * 1024) throw new Error('File is larger than 10 MB');
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const path = `${folder}/${Date.now()}_${safe}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return { file_path: path, file_name: file.name };
}
export async function openFile(path) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) { toast(error.message, 'bad'); return; }
  window.open(data.signedUrl, '_blank', 'noopener');
}
export const fileLink = r => r.file_path
  ? `<button class="b-ghost linkbtn" data-file="${esc(r.file_path)}">${esc(r.file_name || 'Open file')}</button>` : '';
export function bindFileLinks(root) {
  root.querySelectorAll('[data-file]').forEach(b => b.onclick = () => openFile(b.dataset.file));
}

/** Minimal CSV download of whatever a screen is showing. */
export function downloadCsv(name, cols, rows) {
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [cols.map(c => q(c.label)).join(',')]
    .concat(rows.map(r => cols.map(c => q(c.csv ? c.csv(r) : r[c.k])).join(','))).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = name + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Saving…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; }
}
