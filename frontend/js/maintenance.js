// Maintenance → mileage reference page.
// Static, research-backed guidance on how vehicle upkeep changes km/L, by bus size.
// Figures cited from US DOE / fueleconomy.gov, NACFE and fleet studies (see Sources).

const SIZE_CLASSES = [
  ['Mini / LCV', '≤16 seats', 'Force Traveller / Tempo type', '6 tyres'],
  ['Small', '22–27 seats', 'Light bus', '6 tyres'],
  ['Midi', '30–36 seats', 'Eicher / BharatBenz type', '6 tyres'],
  ['Large', '40–45 seats', 'Tata / Ashok Leyland type', '6 tyres'],
  ['XL', '50–52 seats', 'Full-size coach', '6 tyres'],
];

// factor, mileage impact (cited), best value / frequency, note
const FACTORS = [
  ['Tyre pressure', 'Up to −3% (≈ −0.2% per 1 psi under-inflation; ~ −1% at 10% under)',
    'Keep at OEM placard psi. Check COLD, every 2 weeks.',
    'Biggest, cheapest lever. A dusty-Sikar fleet that corrected pressures went 5.2→5.7 km-equiv (+9.6%).'],
  ['Engine tune / injectors', '−10% to −15% when out of tune',
    'Service injectors, sensors & calibration on OEM interval (≈ yearly / 40–100k km).',
    'The single largest maintenance loss. Rough idle, black smoke or power loss = get it checked now.'],
  ['Air filter', '−2% to −5% (diesel, clogged)',
    'Blow out / clean every 5,000–10,000 km in dust; replace per OEM (≈ 20–40k km).',
    'Sikar dust clogs filters fast — inspect monthly in summer.'],
  ['Fuel filter', '−1% to −2% (clogged)',
    'Replace every 20,000–40,000 km.',
    'Also protects the (expensive) injection system from wear.'],
  ['Engine oil grade', '−1% to −2% (wrong grade)',
    'Use OEM grade (most diesel buses 15W-40 / as specified); change every 10–15k km or 6 months.',
    'Correct low-friction grade + fresh oil both help.'],
  ['Wheel alignment & dragging brakes', '−2% to −5%',
    'Align on tyre change / after kerb hits; fix binding calipers immediately.',
    'A dragging brake silently burns fuel and overheats — check for uneven tyre wear / hot wheels.'],
  ['Idling', '≈ 2–4 L of diesel per hour of idling',
    'Switch off if stopped > 2–3 min. 45 min/day ≈ 450 L ≈ ₹45,000/bus/yr.',
    'Zero-value fuel burn. Big at gates and during waits.'],
  ['Overloading', '−1% to −3% when over rated load',
    'Keep riders ≤ rated capacity (this app enforces it).',
    'Extra weight = extra fuel and faster tyre/brake wear.'],
  ['Tyre condition & type', '−3%+ with worn / wrong tyres',
    'Correct tread, balanced wheels; low-rolling-resistance tyres help.',
    'Worn or mismatched tyres raise rolling resistance.'],
  ['Driving style & speed', '−5% to −15%',
    'Smooth acceleration, steady moderate speed, anticipate stops.',
    'Driver habit often dwarfs a single mechanical fault — worth driver training.'],
];

// tyre pressure -> fuel loss (DOE 0.2% per psi under)
const PSI_ROWS = [[0,'0%'],[5,'≈ −1%'],[10,'≈ −2%'],[15,'≈ −3%'],[20,'≈ −4%']];

// typical cold pressures by size (INDICATIVE — always confirm the door placard / OEM manual)
const PSI_BY_SIZE = [
  ['Mini / LCV (≤16)', '~50–65 psi'],
  ['Small (22–27)', '~65–80 psi'],
  ['Midi (30–36)', '~75–95 psi'],
  ['Large (40–45)', '~90–105 psi'],
  ['XL (50–52)', '~100–110 psi'],
];

const cardCss = 'background:#fff;border:1px solid var(--edge);border-radius:10px;padding:14px 16px';

export function renderMaintenance(){
  const th = h => `<th style="text-align:left;padding:8px 10px;border-bottom:2px solid var(--edge);font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#555">${h}</th>`;
  const td = (v,extra='') => `<td style="padding:8px 10px;border-bottom:1px solid var(--edge);${extra}">${v}</td>`;

  const factorsTable = `
    <div style="${cardCss};overflow:auto;padding:0">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px">
        <thead><tr>${['Factor','Effect on mileage','Best value / frequency','Why it matters'].map(th).join('')}</tr></thead>
        <tbody>${FACTORS.map(f=>`<tr>
          ${td('<b>'+f[0]+'</b>')}
          ${td('<span style="color:#b42318;font-weight:600">'+f[1]+'</span>')}
          ${td(f[2])}
          ${td('<span style="color:#555">'+f[3]+'</span>')}
        </tr>`).join('')}</tbody>
      </table>
    </div>`;

  const psiTable = `
    <div style="${cardCss}">
      <h3 style="margin:0 0 8px;font-size:15px">Tyre pressure → fuel loss</h3>
      <div class="note" style="margin-bottom:8px">US DOE: fuel economy drops ≈ <b>0.2% for every 1 psi</b> below the recommended pressure (all tyres).</div>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px">
        <thead><tr>${['psi below recommended','Approx. mileage loss'].map(th).join('')}</tr></thead>
        <tbody>${PSI_ROWS.map(r=>`<tr>${td(r[0]+' psi')}${td('<span style="color:#b42318;font-weight:600">'+r[1]+'</span>')}</tr>`).join('')}</tbody>
      </table>
      <div class="note" style="margin-top:8px">Tyres lose ≈ 1 psi/month and ≈ 1 psi for every 5 °C drop in temperature — <b>check cold, every 2 weeks</b>.</div>
    </div>`;

  const psiBySize = `
    <div style="${cardCss}">
      <h3 style="margin:0 0 8px;font-size:15px">Typical cold pressure by bus size</h3>
      <div class="note" style="margin-bottom:8px;color:#b42318"><b>Indicative only</b> — always set to the figure on the door/frame placard or OEM manual for that exact vehicle.</div>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px">
        <thead><tr>${['Bus size','Typical cold psi'].map(th).join('')}</tr></thead>
        <tbody>${PSI_BY_SIZE.map(r=>`<tr>${td('<b>'+r[0]+'</b>')}${td(r[1])}</tr>`).join('')}</tbody>
      </table>
    </div>`;

  const sizeTable = `
    <div style="${cardCss};overflow:auto">
      <h3 style="margin:0 0 8px;font-size:15px">Our fleet's size classes</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px">
        <thead><tr>${['Class','Seats','Typical model','Tyres'].map(th).join('')}</tr></thead>
        <tbody>${SIZE_CLASSES.map(s=>`<tr>${td('<b>'+s[0]+'</b>')}${td(s[1])}${td(s[2])}${td(s[3])}</tr>`).join('')}</tbody>
      </table>
      <div class="note" style="margin-top:8px">Bigger buses have more tyres and higher fuel burn, so the same % loss costs more rupees — prioritise upkeep on the large/XL buses on long routes.</div>
    </div>`;

  const checklist = `
    <div style="${cardCss};background:#f6fbf8;border-color:#087443">
      <h3 style="margin:0 0 8px;font-size:15px">🔧 Best-mileage checklist (all buses)</h3>
      <ul style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.8">
        <li><b>Every 2 weeks:</b> tyre pressure (cold) to OEM psi; look for dragging brakes / hot wheels.</li>
        <li><b>Monthly (summer):</b> clean the air filter (Sikar dust).</li>
        <li><b>Every 10–15k km / 6 months:</b> engine oil (OEM grade) + filter.</li>
        <li><b>Every 20–40k km:</b> fuel filter; air filter replacement per OEM.</li>
        <li><b>Yearly / per OEM:</b> injector service, sensor & tune-up, wheel alignment.</li>
        <li><b>Daily:</b> no idling beyond 2–3 min; keep within rated load; smooth driving.</li>
      </ul>
      <div class="note" style="margin-top:8px">Combined, disciplined upkeep typically recovers <b>10–20%</b> of fuel — on a ₹99 L/yr fleet that is ₹10–20 lakh/yr, before any routing change.</div>
    </div>`;

  $('maintBody').innerHTML = `
    <h2 style="margin:0 0 4px">Maintenance → Mileage</h2>
    <div class="note" style="margin-bottom:16px">
      A bus's km/L isn't fixed — it depends heavily on how the vehicle is kept. Below is how each maintenance factor changes mileage,
      the best values/frequencies, and how it varies by bus size. Percentages are from published sources (US DOE / fueleconomy.gov,
      NACFE, fleet studies); pressures and service intervals are typical values — <b>confirm each against the vehicle's OEM manual</b>.
    </div>
    ${factorsTable}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      ${psiTable}${psiBySize}
    </div>
    <div style="margin-top:16px">${sizeTable}</div>
    <div style="margin-top:16px">${checklist}</div>
    <div class="note" style="margin-top:16px;font-size:12px;color:#888">
      Sources: US DOE fueleconomy.gov (Keeping Your Vehicle in Shape) — tyre pressure up to 3%, oil 1–2%, air filter; NACFE / fleet-equipment
      studies — 0.2%/psi, ~1% per 10% under-inflation, out-of-tune 10–15%, fuel filter 1–2%, diesel air-filter 2–5%. Rupee figures use this
      fleet's params (₹100/L, 200 days, 2 trips/day). Service intervals are indicative — follow each bus's OEM schedule.
    </div>`;
}

Object.assign(globalThis, { renderMaintenance });
