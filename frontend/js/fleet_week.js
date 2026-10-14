// The fleet's week: were the readings entered, and were they normal?
//
// Two lists, kept apart because different people fix them:
//   Data entry missing - a reading that should exist does not (daily km, tyre
//                        check, fuel fill). The office chases whoever enters it.
//   Deviation found    - a reading exists but is far from normal. The mechanic
//                        or the driver acts, or a reason is recorded.
// Every number comes from fleet_week_report / fleet_week_trend in
// supabase/migrations/20261014000100_fleet_entry_compliance.sql, which share
// their thresholds with the live fleet_alerts view.

import { alertGroups, bindAlertGroups } from './fleet.js';
import { fmtD, n0, chip } from './fleetkit.js';

const WEEKS = 12;
const MINUS = '−';

const dt = d => new Date(d + 'T00:00:00Z');
const short = d => dt(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayName = d => dt(d).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
const addDays = (d, n) => new Date(dt(d).getTime() + n * 864e5).toISOString().slice(0, 10);
const signed = (v, unit = '') => v == null ? '—' : (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toLocaleString('en-IN') + unit;
const pct = (a, b) => b ? Math.round(1000 * a / b) / 10 : null;

function weekLabel(ws, cur) {
  const range = `${short(ws)} – ${short(addDays(ws, 6))}`;
  if (ws === cur) return 'This week · ' + range;
  if (ws === addDays(cur, -7)) return 'Last week · ' + range;
  return range;
}

/** Render the whole section into `el`. `onOpen(tab)` opens a Fleet tab. */
export async function renderFleetWeek(el, onOpen) {
  el.innerHTML = '<div class="hint">Loading the fleet week…</div>';
  const [{ data: trend, error: e1 }, { data: other, error: e2 }] = await Promise.all([
    db.rpc('fleet_week_trend', { p_weeks: WEEKS }),
    db.from('fleet_alerts').select('*').eq('category', 'other')]);
  if (e1 || e2) { el.innerHTML = `<div class="note">Could not load the fleet week: ${esc((e1 || e2).message)}</div>`; return; }
  const T = (trend || []).map(r => ({ ws: r.week_start, k: r.kpis }));
  if (!T.length) { el.innerHTML = '<div class="note">No weeks to show.</div>'; return; }
  const cur = T[T.length - 1].ws;
  const S = { T, cur, sel: cur, onOpen, el };

  el.innerHTML = `<div class="wk">
    <div class="wkbar"><label for="wkSel">Week</label>
      <select id="wkSel">${T.slice().reverse().map(w => `<option value="${w.ws}">${esc(weekLabel(w.ws, cur))}</option>`).join('')}</select>
      <span class="note" id="wkNote"></span></div>
    <div id="wkTiles"></div>
    <div class="wkcharts" id="wkCharts"></div>
    <details class="wktable"><summary>Show the weekly numbers as a table</summary><div id="wkTable"></div></details>
    <div class="fsplit wklists" id="wkLists"></div>
    <h3 class="wkh">Other fleet alerts <span class="note">(today · documents, service, checkups, complaints)</span></h3>
    <div id="wkOther">${alertGroups(other || [], { max: 15 })}</div></div>`;
  bindAlertGroups($('wkOther'), onOpen);
  $('wkTable').innerHTML = trendTable(T);
  $('wkSel').onchange = () => pick(S, $('wkSel').value);
  drawCharts(S);
  let rt; S.ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => drawCharts(S), 120); });
  S.ro.observe($('wkCharts'));
  await pick(S, cur);
}

async function pick(S, ws) {
  S.sel = ws; $('wkSel').value = ws;
  // keep the previous render, dimmed, while the new week loads - no layout jump
  ['wkTiles', 'wkLists'].forEach(id => $(id).classList.add('loading'));
  drawCharts(S);
  const { data: R, error } = await db.rpc('fleet_week_report', { p_week: ws });
  if (S.sel !== ws) return;                      // a later pick overtook this one
  ['wkTiles', 'wkLists'].forEach(id => $(id).classList.remove('loading'));
  if (error || !R) { $('wkTiles').innerHTML = `<div class="note">Could not load this week: ${esc(error?.message || 'no data')}</div>`; return; }
  $('wkNote').textContent = dueNote(R);
  $('wkTiles').innerHTML = tiles(R);
  $('wkLists').innerHTML = lists(R);
  bindAlertGroups($('wkLists'), S.onOpen);
}

function dueNote(R) {
  const k = R.kpis;
  if (!k.tracked) return `Not tracked yet: the Fleet tab started on ${fmtD(R.tracking_start)}.`;
  if (!R.due_through) return 'Nothing is due yet this week. A morning reading counts as missing after 11:00.';
  const from = R.week_start < R.tracking_start ? R.tracking_start : R.week_start;
  return `Entries due ${dayName(from)} ${short(from)} – ${dayName(R.due_through)} ${short(R.due_through)}: ` +
    `${k.days_due} working day${k.days_due === 1 ? '' : 's'} (Mon–Sat, holidays excluded, readings by 11:00).`;
}

// ---------------------------------------------------------------- tiles
function delta(cur, prev, { unit = '', better = 'down', pts = false, toSpec = false } = {}) {
  if (cur == null || prev == null) return '<span class="delta flat">No figure for the previous week</span>';
  const d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return '<span class="delta flat">Same as the previous week</span>';
  const good = better === 'down' ? d < 0 : d > 0;
  // a signed "-3.7 pts" under a signed pressure figure would read as pressure; say what moved
  if (toSpec) return `<span class="delta ${good ? 'good' : 'bad'}"><i aria-hidden="true">${d > 0 ? '▲' : '▼'}</i> ${Math.abs(d)} pts ${d < 0 ? 'closer to' : 'further from'} recommended than the previous week</span>`;
  return `<span class="delta ${good ? 'good' : 'bad'}"><i aria-hidden="true">${d > 0 ? '▲' : '▼'}</i> ${signed(d, pts ? ' pts' : unit)} vs previous week <em>(${good ? 'better' : 'worse'})</em></span>`;
}

function tile(label, value, sub, dl, warn) {
  return `<div class="stat wkstat${warn ? ' warn' : ''}"><span class="lbl">${label}</span><b>${value}</b>
    <span class="sub">${sub}</span>${dl || ''}</div>`;
}

function tiles(R) {
  const k = R.kpis, p = R.prev, t = k.tyre, pt = p.tyre;
  const notTracked = '<span class="delta flat">Not tracked before the Fleet tab started</span>';
  const kmPct = pct(k.km.entered, k.km.expected), kmPrev = pct(p.km.entered, p.km.expected);
  const nMiss = R.missing.length, nDev = R.deviations.length;
  const unexplained = R.deviations.filter(d => d.explained === false).length;
  const byKind = (arr, kind) => arr.filter(x => x.kind === kind).length;
  // Distance from spec, not the signed figure, decides better or worse: -5% and +5% are equally off.
  const absNow = t.avg_abs_dev_pct, absPrev = pt.avg_abs_dev_pct;
  return `<div class="cards wkcards">
    ${tile('Average tyre pressure deviation',
      t.checked ? signed(t.avg_dev_pct, '%') : '—',
      t.checked ? `${t.checked} bus${t.checked === 1 ? '' : 'es'} checked · on average ${absNow}% away from recommended` : 'No tyre readings this week',
      t.checked ? delta(absNow, absPrev, { toSpec: true }) : '')}
    ${tile('Buses with tyre pressure off spec',
      t.checked ? n0(t.affected) : '—',
      t.checked ? `of ${t.checked} checked · ${t.unsafe} at unsafe pressure` : 'No tyre readings this week',
      t.checked ? delta(t.affected, pt.checked ? pt.affected : null) : '', t.unsafe > 0)}
    ${tile('Daily km readings entered',
      k.tracked && k.km.expected ? kmPct + '%' : '—',
      k.tracked ? (k.km.expected ? `${n0(k.km.entered)} of ${n0(k.km.expected)} expected (${k.in_service} buses × ${k.days_due} days)` : 'None due yet') : 'Not tracked yet',
      k.tracked ? delta(kmPct, p.tracked ? kmPrev : null, { better: 'up', pts: true }) : notTracked, k.tracked && k.km.expected && kmPct < 90)}
    ${tile('Fuel fills logged', n0(k.fuel.fills),
      `${k.fuel.deviations} off normal mileage${k.fuel.cost ? ' · ' + rs(k.fuel.cost) : ''}`,
      `<span class="delta flat">${n0(p.fuel.fills)} the previous week</span>`)}
    ${tile('Data entry missing', k.tracked ? n0(nMiss) : '—',
      k.tracked ? `km ${byKind(R.missing, 'km')} · tyres ${byKind(R.missing, 'tyre')} · fuel ${byKind(R.missing, 'fuel')} buses` : 'Not tracked yet',
      '', nMiss > 0)}
    ${tile('Deviation found', n0(nDev),
      `tyres ${byKind(R.deviations, 'tyre')} · km ${byKind(R.deviations, 'km')} · fuel ${byKind(R.deviations, 'fuel')}${unexplained ? ` · ${unexplained} need a reason` : ''}`,
      '', nDev > 0)}
  </div>
  <p class="note wkfoot">Tyre deviation is each bus's last reading of the week against its recommended pressure. Most
    recommended pressures are still <b>estimated</b> from tyre size until the placard values are entered (Fleet → Tyres),
    so read these as estimates. A bus counts as off spec at 10% under or over, or with uneven tyres on one axle.</p>`;
}

// ---------------------------------------------------------------- lists
const MISSING = { km: ['Daily km not entered', 'km'], tyre: ['Tyre pressure not checked in 15 days', 'tyres'], fuel: ['No fuel fill logged for too long', 'fuel'] };
const DEVS = { tyre: ['Tyre pressure off recommended', 'tyres'], km: ['Km far from normal', 'km'], fuel: ['Mileage off normal', 'fuel'] };

function group(kind, list, [label, tab], sev, item) {
  if (!list.length) return '';
  return `<details class="agroup sev${sev}" ${sev >= 3 ? 'open' : ''}>
    <summary><b>${list.length}</b><span class="t">${esc(label)}</span>
      <button class="b-ghost linkbtn go-tab" data-tab="${tab}">Open ${tab === 'km' ? 'daily km' : tab}</button></summary>
    <ul>${list.map(item).join('')}</ul></details>`;
}
const who = x => `<b>${x.bus_id != null ? 'Bus ' + x.bus_id : 'Spare'}</b>`;

function lists(R) {
  const k = R.kpis;
  const miss = !k.tracked ? `<div class="note">Not tracked yet: the Fleet tab started on ${fmtD(R.tracking_start)}.</div>`
    : !R.missing.length ? '<div class="note">Every expected entry is in.</div>'
    : ['km', 'tyre', 'fuel'].map(kd => group(kd, R.missing.filter(m => m.kind === kd), MISSING[kd],
        kd === 'km' ? (R.missing.some(m => m.kind === 'km' && m.count >= 3) ? 2 : 1) : 2,
        m => `<li>${who(m)}<span><span class="mono">${esc(m.reg_no)}</span> — ${esc(m.detail)}</span></li>`)).join('');
  const devs = !R.deviations.length ? '<div class="note">No reading this week was far from normal.</div>'
    : ['tyre', 'km', 'fuel'].map(kd => { const L = R.deviations.filter(d => d.kind === kd);
        return group(kd, L, DEVS[kd], Math.max(0, ...L.map(d => d.severity)),
          d => `<li>${who(d)}<span><span class="mono">${esc(d.reg_no)}</span> · ${esc(short(d.date))} — ${esc(d.detail)}
            ${d.estimated_spec ? ' <span class="muted">(estimated spec)</span>' : ''}
            ${d.explained === true ? ' ' + chip('ok', 'Reason given') : d.explained === false ? ' ' + chip('due_soon', 'Reason needed') : ''}</span></li>`); }).join('');
  return `<section><h3 class="wkh">Data entry missing <span class="note">(${R.missing.length})</span></h3>${miss}</section>
    <section><h3 class="wkh">Deviation found <span class="note">(${R.deviations.length})</span></h3>${devs}</section>`;
}

// ---------------------------------------------------------------- trend charts
// Three small single-series charts on a shared week axis rather than one chart
// with two scales: a percentage and a bus count never share a y-axis.
const SERIES = [
  { key: 'dev', title: 'Average tyre pressure deviation', unit: '%', zero: true, signed: true,
    get: k => k.tyre.checked ? k.tyre.avg_dev_pct : null },
  { key: 'off', title: 'Buses with tyre pressure off spec', unit: '', min: 0,
    get: k => k.tyre.checked ? k.tyre.affected : null },
  { key: 'km', title: 'Daily km readings entered', unit: '%', min: 0, max: 100,
    get: k => k.tracked && k.km.expected ? pct(k.km.entered, k.km.expected) : null },
];

function drawCharts(S) {
  const box = S.el.querySelector('#wkCharts'); if (!box || !box.isConnected) return;
  if (!box.children.length) box.innerHTML = SERIES.map(s =>
    `<figure class="wkchart" data-s="${s.key}"><figcaption>${esc(s.title)}</figcaption><div class="plot"></div></figure>`).join('');
  SERIES.forEach(s => lineChart(box.querySelector(`[data-s="${s.key}"] .plot`), s, S));
}

function niceTicks(lo, hi, n = 4) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const t0 = Math.floor(lo / step) * step, out = [];
  for (let v = t0; v <= hi + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

function lineChart(host, s, S) {
  const W = Math.max(240, host.clientWidth || 300), H = 150, m = { l: 40, r: 14, t: 18, b: 24 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b, n = S.T.length;
  const vals = S.T.map(w => s.get(w.k));
  const have = vals.filter(v => v != null);
  const fmt = v => v == null ? 'no figure' : (s.signed ? signed(v, s.unit) : v.toLocaleString('en-IN') + s.unit);
  let lo = Math.min(...have, s.min ?? Infinity, s.zero ? 0 : Infinity), hi = Math.max(...have, s.max ?? -Infinity, s.zero ? 0 : -Infinity);
  if (!have.length) { lo = s.min ?? 0; hi = s.max ?? 10; }
  const ticks = niceTicks(lo, hi); lo = ticks[0]; hi = ticks[ticks.length - 1];
  const x = i => m.l + (n === 1 ? pw / 2 : i * pw / (n - 1));
  const y = v => m.t + ph - (v - lo) / (hi - lo) * ph;
  const step = n > 1 ? pw / (n - 1) : pw;
  const si = S.T.findIndex(w => w.ws === S.sel);
  const every = W < 380 ? 3 : W < 560 ? 2 : 1;
  // line segments break at weeks with no figure
  let path = '', open = false;
  vals.forEach((v, i) => { if (v == null) { open = false; return; } path += (open ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); open = true; });
  const last = vals.reduce((a, v, i) => v != null ? i : a, -1);
  const label = si >= 0 && vals[si] != null ? si : last;
  // the value label sits above its dot unless the line arrives from above, then below
  const nb = label > 0 ? vals[label - 1] : null;
  const below = label >= 0 && nb != null && y(nb) < y(vals[label]) && y(vals[label]) + 20 < m.t + ph + 4;
  host.innerHTML = `<svg width="${W}" height="${H}" role="img" tabindex="0"
      aria-label="${esc(s.title)}, last ${n} weeks. Use the arrow keys to read each week; Enter selects it.">
    <rect class="selband" x="${(x(si) - step / 2).toFixed(1)}" y="${m.t}" width="${step.toFixed(1)}" height="${ph}"/>
    ${ticks.map(t => `<line class="${t === 0 && s.zero ? 'zero' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>
      <text class="tick" x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${s.signed && t ? signed(t) : t.toLocaleString('en-IN')}${s.unit}</text>`).join('')}
    ${S.T.map((w, i) => i % every === (n - 1) % every ? `<text class="tick" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(short(w.ws))}</text>` : '').join('')}
    <path class="ln" d="${path}"/>
    ${vals.map((v, i) => v == null ? '' : `<circle class="dot${i === si ? ' sel' : ''}" cx="${x(i)}" cy="${y(v)}" r="${i === si ? 5 : 4}"/>`).join('')}
    ${label >= 0 ? `<text class="vlab" x="${Math.min(x(label), W - m.r - 4)}" y="${y(vals[label]) + (below ? 19 : -10)}" text-anchor="${x(label) > W - 60 ? 'end' : 'middle'}">${esc(fmt(vals[label]))}</text>` : ''}
    ${!have.length ? `<text class="empty" x="${m.l + pw / 2}" y="${m.t + ph / 2}" text-anchor="middle">No figures in these ${n} weeks</text>` : ''}
    <line class="xhair" y1="${m.t}" y2="${m.t + ph}" style="display:none"/>
    <rect class="hit" x="${m.l - step / 2}" y="0" width="${pw + step}" height="${H}"/></svg>
    <div class="tip" hidden><b></b><span></span></div>`;
  const svg = host.querySelector('svg'), tip = host.querySelector('.tip'), xh = host.querySelector('.xhair');
  let at = si;
  const show = i => {
    at = Math.max(0, Math.min(n - 1, i));
    xh.style.display = ''; xh.setAttribute('x1', x(at)); xh.setAttribute('x2', x(at));
    tip.hidden = false;
    tip.querySelector('b').textContent = fmt(vals[at]);
    tip.querySelector('span').textContent = weekLabel(S.T[at].ws, S.cur);
    const tx = Math.min(Math.max(x(at) - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
    tip.style.left = tx + 'px';
  };
  // SVG elements have no .hidden property, so the crosshair uses display
  const hide = () => { xh.style.display = 'none'; tip.hidden = true; };
  const idx = e => Math.round((e.clientX - svg.getBoundingClientRect().left - m.l) / (n > 1 ? step : 1));
  svg.addEventListener('pointermove', e => show(idx(e)));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('click', e => pick(S, S.T[Math.max(0, Math.min(n - 1, idx(e)))].ws));
  svg.addEventListener('focus', () => show(at < 0 ? n - 1 : at));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(at + (e.key === 'ArrowLeft' ? -1 : 1)); }
    if (e.key === 'Enter') { e.preventDefault(); pick(S, S.T[at].ws); }
  });
}

function trendTable(T) {
  const cell = v => v == null ? '<span class="muted">—</span>' : v;
  return `<div class="tscroll"><table><thead><tr><th>Week</th><th class="num">Avg tyre deviation</th><th class="num">Buses checked</th>
      <th class="num">Off spec</th><th class="num">Unsafe</th><th class="num">Km readings entered</th><th class="num">Fuel fills</th><th class="num">Fuel off normal</th></tr></thead>
    <tbody>${T.slice().reverse().map(({ ws, k }) => `<tr><td>${esc(short(ws))} – ${esc(short(addDays(ws, 6)))}</td>
      <td class="num">${cell(k.tyre.checked ? signed(k.tyre.avg_dev_pct, '%') : null)}</td><td class="num">${k.tyre.checked}</td>
      <td class="num">${cell(k.tyre.checked ? k.tyre.affected : null)}</td><td class="num">${cell(k.tyre.checked ? k.tyre.unsafe : null)}</td>
      <td class="num">${k.tracked ? `${n0(k.km.entered)} of ${n0(k.km.expected)}` : '<span class="muted">not tracked</span>'}</td>
      <td class="num">${k.fuel.fills}</td><td class="num">${k.fuel.deviations}</td></tr>`).join('')}</tbody></table></div>`;
}
