// Teachers — morning-only riders (they come to school with Round 1, don't ride back).
// Lets the office assign the missing employee codes and bus numbers right here.

export async function renderTeachers(){
  $('teachersBody').innerHTML = `<h2 style="margin:0 0 4px">Teachers</h2>
    <div class="note" style="margin-bottom:14px">
      Teachers ride to school with the <b>morning Round 1</b> buses and do not travel back with the students.
      Assign missing <b>employee codes</b> and <b>bus numbers</b> below — type <span class="mono">self</span> for teachers who come on their own.
    </div>
    <div id="tcCards" class="cards" style="margin-bottom:14px"></div>
    <div id="tcTable"><div class="hint">Loading…</div></div>`;
  const { data:list, error } = await db.from('teachers').select('*').order('name');
  if(error){ $('tcTable').innerHTML = `<div class="note" style="color:#b42318">${esc(error.message)}</div>`; return; }
  const t = list||[];
  const noBus = t.filter(x=>!x.bus_no).length, noEmp = t.filter(x=>!x.emp_code).length;
  const self = t.filter(x=>(x.bus_no||'').toLowerCase()==='self').length;
  const card=(v,l,warn)=>`<div class="stat ${warn&&v>0?'warn':''}"><b>${v}</b><span>${l}</span></div>`;
  $('tcCards').innerHTML = card(t.length,'Teachers')+card(t.length-noBus,'On a bus (morning)')+
    card(noBus,'No bus assigned',true)+card(noEmp,'No employee code',true)+card(self,'Come by self');
  const rows = t.map(x=>`<tr data-id="${x.id}">
    <td style="font-weight:600">${esc(x.name)}</td>
    <td class="mono" style="font-size:12px;color:var(--slate)">${x.latitude!=null?(Number(x.latitude).toFixed(5)+', '+Number(x.longitude).toFixed(5)):'—'}</td>
    <td style="width:130px"><input class="tc-emp" value="${esc(x.emp_code||'')}" placeholder="emp code" style="padding:5px 8px;font-size:13px"/></td>
    <td style="width:110px"><input class="tc-bus" value="${esc(x.bus_no||'')}" placeholder="bus / self" style="padding:5px 8px;font-size:13px"/></td>
    <td style="white-space:nowrap"><button class="b-ghost tc-save" style="font-size:12px;padding:4px 10px">Save</button>
        <span class="tc-state note" style="margin-left:6px"></span></td>
  </tr>`).join('');
  $('tcTable').innerHTML = `<div style="background:var(--panel);border:1px solid var(--edge);border-radius:8px;overflow:auto;max-height:calc(100vh - 320px)">
    <table><thead><tr><th>Name</th><th>Home location</th><th>Emp code</th><th>Bus (morning)</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
  document.querySelectorAll('#tcTable .tc-save').forEach(btn=>btn.onclick=async ()=>{
    const tr = btn.closest('tr'); const id = Number(tr.dataset.id);
    const emp = tr.querySelector('.tc-emp').value.trim() || null;
    const bus = tr.querySelector('.tc-bus').value.trim() || null;
    if(bus && bus.toLowerCase()!=='self' && !/^\d+$/.test(bus)){ toast('Bus must be a number or "self"','bad'); return; }
    btn.disabled = true;
    const { error:e } = await db.from('teachers').update({ emp_code:emp, bus_no:bus, updated_at:new Date().toISOString() }).eq('id', id);
    btn.disabled = false;
    const st = tr.querySelector('.tc-state');
    if(e){ st.textContent='✗ '+e.message; st.style.color='#b42318'; return; }
    st.textContent='✓ saved'; st.style.color='#0f7b4f';
    setTimeout(()=>{ st.textContent=''; }, 2500);
  });
}

Object.assign(globalThis, { renderTeachers });
