// Ore consuntivate giornaliere e promemoria email
// CONSUNTIVO
// Promemoria email: sincronizza il checkbox con lo stato della risorsa loggata
function _syncNotifChk(){
  const card=document.getElementById('consuntivoNotifCard'),chk=document.getElementById('consuntivoNotifChk');
  if(!card||!chk)return;
  const r=isAdmin?null:RESOURCES.find(x=>x.fullName===currentUser);
  if(!r){card.style.display='none';return;}   // admin non ha una risorsa propria
  card.style.display='';
  chk.checked=r.dailyReminder!==false;
}
async function toggleDailyReminder(cb){
  const r=RESOURCES.find(x=>x.fullName===currentUser);
  if(!r){cb.checked=!cb.checked;return;}
  const val=cb.checked;
  cb.disabled=true;showSpinner();
  try{
    await call('setDailyReminder',{risorsaId:r.id,value:val});
    r.dailyReminder=val;
    showMsg('consuntivoNotifMsg',val?'Promemoria attivato.':'Promemoria disattivato.','ok');
  }catch(e){
    cb.checked=!val; // rollback: lo stato mostrato deve riflettere il DB
    showMsg('consuntivoNotifMsg','Errore: '+e.message,'err');
  }
  hideSpinner();cb.disabled=false;
}
// Risorse di cui l'utente vede le ore consuntivate (null = solo le proprie).
// Admin: tutte. Manager: il suo team. Team Lead di progetto: le risorse staffate sui suoi progetti.
function _consuntivoVisibleIds(){
  if(isAdmin)return new Set(RESOURCES.map(r=>r.id));
  const me=_me();if(!me)return null;
  const tlPrjs=new Set(Object.entries(_prjTLsByName).filter(([,tls])=>tls.includes(currentUser)).map(([p])=>p));
  if(!isTeamLead&&!tlPrjs.size)return null;
  const ids=new Set([me.id]);
  RESOURCES.forEach(r=>{if((isTeamLead&&r.managerName===currentUser)||(r.progetti||[]).some(p=>tlPrjs.has(p)))ids.add(r.id);});
  return ids;
}
async function loadConsuntivo(){
  _syncNotifChk();
  const month=+document.getElementById('consuntivoMonth').value;
  const year=+document.getElementById('consuntivoYear').value;
  const el=document.getElementById('consuntivoContent');
  if(!el)return;
  el.innerHTML='<div class="msg">Caricamento...</div>';
  showSpinner();
  let rows;
  try{rows=await call('getConsuntivo',{anno:year,mese:month});}catch(e){hideSpinner();el.innerHTML=`<div class="msg err">Errore: ${_esc(e.message)}</div>`;return;}
  hideSpinner();
  const visibleIds=_consuntivoVisibleIds();
  if(visibleIds){
    _renderConsuntivoTeam(rows.filter(r=>visibleIds.has(+r.risorsa_id)),month,year);
  }else{
    const r=RESOURCES.find(x=>x.fullName===currentUser);
    _renderConsuntivoCollab(rows,month,year,r);
  }
}
// Formatta ore: 8 → "8", 7.5 → "7.5", 0 → ""
function _fmtOreCell(v){return v===0?'':(v%1===0?String(v):v.toFixed(1));}
function _fmtOreTot(v){return v%1===0?String(v):v.toFixed(1);}

// Griglia calendario stile reperibilità — celle editabili via click
// resList: [{id, fullName}] — risorse da mostrare come righe
function _buildConsuntivoGrid(rows,month,year,resList){
  const dim=new Date(year,month+1,0).getDate();
  const DN=['D','L','M','M','G','V','S'];
  const mm=String(month+1).padStart(2,'0');
  // lookup: risorsaId → {giorno: ore}
  const lk={};
  rows.forEach(r=>{const day=new Date(r.data+'T12:00:00Z').getUTCDate();if(!lk[r.risorsa_id])lk[r.risorsa_id]={};lk[r.risorsa_id][day]=+r.ore;});
  // header
  let h=`<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:.72rem;width:100%"><thead><tr>`;
  h+=`<th style="padding:5px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;min-width:90px;position:sticky;left:0;z-index:1">Risorsa</th>`;
  for(let d=1;d<=dim;d++){
    const wd=new Date(year,month,d).getDay(),isWe=wd===0||wd===6;
    const bdr=d===15?';border-right:2px solid rgba(255,255,255,.5)':'';
    h+=`<th style="padding:2px 1px;background:${isWe?'rgba(161,0,255,.12)':'var(--ink)'};color:${isWe?'var(--amber)':'var(--white)'};text-align:center;min-width:28px;font-size:.6rem${bdr}"><div>${DN[wd]}</div><div>${d}</div></th>`;
  }
  h+=`<th style="padding:5px 4px;background:var(--ink);color:var(--white);text-align:center;min-width:38px;font-size:.65rem;border-left:2px solid rgba(255,255,255,.4)">Q1</th>`;
  h+=`<th style="padding:5px 4px;background:var(--ink);color:var(--white);text-align:center;min-width:38px;font-size:.65rem">Q2</th>`;
  h+=`<th style="padding:5px 8px;background:var(--ink);color:var(--white);text-align:center;min-width:44px;font-size:.65rem;font-weight:700">Tot</th>`;
  h+=`</tr></thead><tbody>`;
  // righe
  let gQ1=0,gQ2=0;
  resList.forEach((res,ri)=>{
    const rd=lk[res.id]||{};
    let q1=0,q2=0;
    for(let d=1;d<=dim;d++){const v=rd[d]||0;if(d<=15)q1+=v;else q2+=v;}
    gQ1+=q1;gQ2+=q2;
    const tot=q1+q2;
    h+=`<tr style="background:${ri%2?'var(--stone)':'var(--white)'}">`;
    h+=`<td style="padding:5px 8px 5px 10px;font-weight:600;font-size:.74rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit"><div style="line-height:1.35">${_esc(res.fullName.split(' ')[0])}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${_esc(res.fullName.split(' ').slice(1).join(' '))}</span></div></td>`;
    for(let d=1;d<=dim;d++){
      const wd=new Date(year,month,d).getDay(),isWe=wd===0||wd===6;
      const ore=rd[d]||0;
      const bdr=d===15?';border-right:2px solid var(--stone-3)':'';
      const bg=ore?'var(--ok-bg)':(isWe?'rgba(161,0,255,.04)':'inherit');
      const dd=String(d).padStart(2,'0');
      const dateISO=`${year}-${mm}-${dd}`;
      h+=`<td title="Clicca per modificare" style="border:1px solid var(--line);padding:2px 1px;text-align:center;background:${bg};cursor:pointer${bdr}" onclick="_consuntivoClickCell(this,${res.id},'${dateISO}',${ore})">`;
      if(ore)h+=`<span style="font-size:.68rem;font-weight:600;color:var(--ok)">${_fmtOreCell(ore)}</span>`;
      h+=`</td>`;
    }
    h+=`<td style="padding:5px 4px;text-align:center;font-weight:600;font-size:.72rem;color:var(--ink-2);border-left:2px solid var(--stone-3)">${_fmtOreTot(q1)}</td>`;
    h+=`<td style="padding:5px 4px;text-align:center;font-weight:600;font-size:.72rem;color:var(--ink-2)">${_fmtOreTot(q2)}</td>`;
    h+=`<td style="padding:5px 8px;text-align:center;font-weight:700;font-size:.72rem;color:var(--ok)">${_fmtOreTot(tot)}</td>`;
    h+=`</tr>`;
  });
  // footer totali (solo con più righe)
  if(resList.length>1){
    const gTot=gQ1+gQ2;
    h+=`<tfoot><tr style="background:var(--stone-2);border-top:2px solid var(--stone-3)">`;
    h+=`<td style="position:sticky;left:0;background:var(--stone-2);padding:5px 10px;font-weight:700;font-size:.74rem;color:var(--ink)">Totale</td>`;
    h+=`<td colspan="${dim}" style="background:var(--stone-2)"></td>`;
    h+=`<td style="padding:5px 4px;text-align:center;font-weight:700;font-size:.72rem;color:var(--ink);border-left:2px solid var(--stone-3)">${_fmtOreTot(gQ1)}</td>`;
    h+=`<td style="padding:5px 4px;text-align:center;font-weight:700;font-size:.72rem;color:var(--ink)">${_fmtOreTot(gQ2)}</td>`;
    h+=`<td style="padding:5px 8px;text-align:center;font-weight:700;font-size:.72rem;color:var(--ok)">${_fmtOreTot(gTot)}</td>`;
    h+=`</tr></tfoot>`;
  }
  h+=`</table></div>`;
  return h;
}
// Inline edit: click su cella → input → salva → refresh griglia
async function _consuntivoClickCell(td,risorsaId,dateISO,currentOre){
  if(td.querySelector('input'))return; // già in edit
  const origHTML=td.innerHTML,origBg=td.style.background;
  const inp=document.createElement('input');
  inp.type='number';inp.min='0';inp.max='24';inp.step='0.5';
  inp.value=currentOre>0?currentOre:'';
  inp.style.cssText='width:36px;border:none;background:transparent;font-size:.7rem;font-weight:700;color:#a100ff;text-align:center;outline:2px solid #a100ff;border-radius:2px;padding:0 2px;';
  td.innerHTML='';td.style.background='var(--amber-bg)';
  td.appendChild(inp);inp.focus();if(inp.value)inp.select();
  let done=false;
  async function doSave(){
    if(done)return;done=true;
    const v=parseFloat(inp.value);
    const ore=(!isNaN(v)&&v>0)?v:null;
    showSpinner();
    try{
      await call('saveConsuntivo',{risorsaId,data:dateISO,ore});
      hideSpinner();
      await loadConsuntivo(); // refresh completo per aggiornare Q1/Q2/tot
    }catch(e){
      hideSpinner();
      td.innerHTML=origHTML;td.style.background=origBg;
      console.error('saveConsuntivo:',e.message);
    }
  }
  function doCancel(){if(done)return;done=true;td.innerHTML=origHTML;td.style.background=origBg;}
  inp.addEventListener('blur',doSave);
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();inp.blur();}
    if(e.key==='Escape'){done=true;inp.removeEventListener('blur',doSave);doCancel();}
  });
}
// Badge riepilogo Q1/Q2/Tot
function _consuntivoSummary(q1,q2){
  const tot=q1+q2;
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;align-items:center">
    <div style="background:var(--stone-1);border:1px solid var(--stone-3);border-radius:var(--r);padding:10px 18px;text-align:center">
      <div style="font-size:.7rem;color:var(--ink-3);margin-bottom:2px">I Quindicina</div>
      <div style="font-size:1.2rem;font-weight:700;color:var(--ink)">${_fmtOreTot(q1)} h</div>
    </div>
    <div style="background:var(--stone-1);border:1px solid var(--stone-3);border-radius:var(--r);padding:10px 18px;text-align:center">
      <div style="font-size:.7rem;color:var(--ink-3);margin-bottom:2px">II Quindicina</div>
      <div style="font-size:1.2rem;font-weight:700;color:var(--ink)">${_fmtOreTot(q2)} h</div>
    </div>
    <div style="background:rgba(161,0,255,.08);border:1px solid rgba(161,0,255,.25);border-radius:var(--r);padding:10px 18px;text-align:center">
      <div style="font-size:.7rem;color:var(--ink-3);margin-bottom:2px">Totale mese</div>
      <div style="font-size:1.2rem;font-weight:700;color:#a100ff">${_fmtOreTot(tot)} h</div>
    </div>
  </div>`;
}
function _renderConsuntivoCollab(rows,month,year,resource){
  const el=document.getElementById('consuntivoContent');
  const myRows=resource?rows.filter(x=>+x.risorsa_id===+resource.id):[];
  if(!myRows.length){el.innerHTML='<div class="card"><p style="color:var(--ink-3);text-align:center;padding:24px 0">Nessuna ora consuntivata per questo mese.</p></div>';return;}
  const q1=myRows.filter(r=>new Date(r.data+'T12:00:00Z').getUTCDate()<=15).reduce((s,r)=>s+(+r.ore),0);
  const q2=myRows.filter(r=>new Date(r.data+'T12:00:00Z').getUTCDate()>15).reduce((s,r)=>s+(+r.ore),0);
  const resList=resource?[{id:resource.id,fullName:resource.fullName}]:[];
  el.innerHTML=`<div class="card"><div class="card-title"><i class="fa-solid fa-calendar-days"></i> ${MONTHS[month]} ${year}</div>${_consuntivoSummary(q1,q2)}${_buildConsuntivoGrid(myRows,month,year,resList)}</div>`;
}
function _renderConsuntivoTeam(rows,month,year){
  const el=document.getElementById('consuntivoContent');
  const filterResId=+(document.getElementById('consuntivoRes')?.value||0);
  const filtered=filterResId?rows.filter(r=>+r.risorsa_id===filterResId):rows;
  if(!filtered.length){el.innerHTML='<div class="card"><p style="color:var(--ink-3);text-align:center;padding:24px 0">Nessuna ora consuntivata per questo mese.</p></div>';return;}
  const resMap={};
  filtered.forEach(r=>{if(!resMap[r.risorsa_id])resMap[r.risorsa_id]=r.full_name;});
  const resList=Object.entries(resMap).map(([id,fullName])=>({id:+id,fullName})).sort((a,b)=>a.fullName.localeCompare(b.fullName,'it'));
  const q1=filtered.filter(r=>new Date(r.data+'T12:00:00Z').getUTCDate()<=15).reduce((s,r)=>s+(+r.ore),0);
  const q2=filtered.filter(r=>new Date(r.data+'T12:00:00Z').getUTCDate()>15).reduce((s,r)=>s+(+r.ore),0);
  const suffix=resList.length>1?`<span style="font-size:.75rem;color:var(--ink-3);margin-left:4px">${resList.length} risorse</span>`:'';
  el.innerHTML=`<div class="card"><div class="card-title"><i class="fa-solid fa-calendar-days"></i> ${MONTHS[month]} ${year}${suffix}</div>${_consuntivoSummary(q1,q2)}${_buildConsuntivoGrid(filtered,month,year,resList)}</div>`;
}
