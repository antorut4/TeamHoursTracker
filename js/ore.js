// Forecast ore personale, riepilogo del team e WBS per risorsa
// ORE
async function loadOreForm(){
  const month=+document.getElementById('oreMonth').value,year=+document.getElementById('oreYear').value;
  const h1=wHours(year,month,1),h2=wHours(year,month,2);
  const box=document.getElementById('oreInfoBox');box.style.display='block';
  const r=RESOURCES.find(x=>x.fullName===currentUser);let e={};
  if(r){const rec=(_read(K_HRS,[])||[]).find(o=>o.risorsaId===r.id&&o.anno===year&&o.mese===month);if(rec)e=rec;}
  let wbsHtml='';
  if(r){
    const wbs=getWbsForMember(r.id,year,month);
    if(wbs.length>0){
      const q1=wbs.filter(x=>x.q==='1Q'),q2=wbs.filter(x=>x.q==='2Q');
      wbsHtml=`<div class="wbs-info-box"><div class="wbs-info-label"><i class="fa-solid fa-code-branch"></i> WBS assegnate dal manager</div><div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:8px">`;
      if(q1.length)wbsHtml+=`<div><div style="font-size:.72rem;font-weight:700;color:var(--ink-2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">I Quindicina</div>${q1.map(x=>`<div style="font-size:.83rem;margin-bottom:3px"><span style="color:var(--ink-3)">${_esc(x.progetto)}</span>${x.codice?` <b style="font-family:monospace;color:var(--ink)">${_esc(x.codice)}</b>`:''}${x.ore!=null?` <span style="color:var(--amber);font-weight:700">${_esc(x.ore)}h</span>`:''}</div>`).join('')}</div>`;
      if(q2.length)wbsHtml+=`<div><div style="font-size:.72rem;font-weight:700;color:var(--ink-2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">II Quindicina</div>${q2.map(x=>`<div style="font-size:.83rem;margin-bottom:3px"><span style="color:var(--ink-3)">${_esc(x.progetto)}</span>${x.codice?` <b style="font-family:monospace;color:var(--ink)">${_esc(x.codice)}</b>`:''}${x.ore!=null?` <span style="color:var(--amber);font-weight:700">${_esc(x.ore)}h</span>`:''}</div>`).join('')}</div>`;
      wbsHtml+=`</div></div>`;
    }
  }
  const lcHtml=r&&r.loadCost!=null?`<div style="margin-top:10px;padding:8px 12px;background:var(--amber-bg);border-radius:var(--r);display:inline-flex;align-items:center;gap:8px;font-size:.83rem"><i class="fa-solid fa-euro-sign" style="color:var(--amber)"></i><span style="color:var(--ink-2)">Il tuo Load Cost:</span> <b style="color:var(--amber)">€${r.loadCost}</b></div>`:'';
  box.innerHTML=`<i class="fa-regular fa-calendar" style="margin-right:7px"></i><b>${MONTHS[month]} ${year}</b> &nbsp;—&nbsp; I quindicina: <b>${h1}h</b> &nbsp;|&nbsp; II quindicina: <b>${h2}h</b>${wbsHtml}${lcHtml}`;
  document.getElementById('ore1').value=e.ore_q1!=null?e.ore_q1:h1;document.getElementById('note1').value=e.note_q1||'';
  document.getElementById('ore2').value=e.ore_q2!=null?e.ore_q2:h2;document.getElementById('note2').value=e.note_q2||'';
  checkOreStrao();
}
function checkOreStrao(){
  const month=+document.getElementById('oreMonth').value,year=+document.getElementById('oreYear').value;
  const h1=wHours(year,month,1),h2=wHours(year,month,2);
  const v1=parseFloat(document.getElementById('ore1').value),v2=parseFloat(document.getElementById('ore2').value);
  const w1=document.getElementById('oreWarn1'),w2=document.getElementById('oreWarn2');
  if(w1){if(!isNaN(v1)&&v1>h1){w1.style.display='block';document.getElementById('oreWarn1Txt').textContent=`Ore extra: +${Math.round((v1-h1)*10)/10}h rispetto alle ${h1}h previste`;}else{w1.style.display='none';}}
  if(w2){if(!isNaN(v2)&&v2>h2){w2.style.display='block';document.getElementById('oreWarn2Txt').textContent=`Ore extra: +${Math.round((v2-h2)*10)/10}h rispetto alle ${h2}h previste`;}else{w2.style.display='none';}}
}
async function saveOre(){
  const month=+document.getElementById('oreMonth').value,year=+document.getElementById('oreYear').value;
  const o1=document.getElementById('ore1').value,o2=document.getElementById('ore2').value;
  if(o1===''&&o2===''){showMsg('oreMsg','Inserisci almeno un valore.','err');return;}
  const r=RESOURCES.find(x=>x.fullName===currentUser);if(!r){showMsg('oreMsg','Risorsa non trovata.','err');return;}
  const row={risorsaId:r.id,anno:year,mese:month,ore_q1:o1!==''?+o1:null,note_q1:document.getElementById('note1').value||null,ore_q2:o2!==''?+o2:null,note_q2:document.getElementById('note2').value||null};
  showSpinner();try{await call('saveOre',row);await reloadAll();}catch(e){hideSpinner();showMsg('oreMsg','Errore: '+e.message,'err');return;}hideSpinner();
  showMsg('oreMsg','Ore salvate','ok');await renderMyOre();checkAlerts();
}
async function renderMyOre(){
  const r=RESOURCES.find(x=>x.fullName===currentUser);const el=document.getElementById('myOreList');
  if(!r){el.innerHTML='<p style="color:var(--ink-3);font-size:.83rem">Nessuna ora inserita.</p>';return;}
  const rows=(_read(K_HRS,[])||[]).filter(o=>o.risorsaId===r.id).sort((a,b)=>(b.anno-a.anno)||(b.mese-a.mese));
  if(!rows.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.83rem">Nessuna ora inserita.</p>';return;}
  let h='<div class="table-wrap"><table><thead><tr><th>Mese</th><th>I Q</th><th>II Q</th><th>Totale</th><th>Disponibili</th><th></th></tr></thead><tbody>';
  rows.forEach(e=>{const tot=(+e.ore_q1||0)+(+e.ore_q2||0),av=wHours(e.anno,e.mese,1)+wHours(e.anno,e.mese,2);const extra=tot-av;
    const straoBadge=extra>0?` <span style="font-size:.69rem;font-weight:700;color:var(--warn);background:var(--warn-bg);border-radius:10px;padding:1px 7px;white-space:nowrap"><i class="fa-solid fa-bolt" style="margin-right:3px"></i>+${Math.round(extra*10)/10}h extra</span>`:'';
    h+=`<tr style="${extra>0?'background:var(--warn-bg)':''}"><td><b>${MONTHS[e.mese]} ${e.anno}</b></td><td>${e.ore_q1!=null?e.ore_q1+'h':'—'}${e.note_q1?` <span style="color:var(--ink-3);font-size:.73rem">(${_esc(e.note_q1)})</span>`:''}</td><td>${e.ore_q2!=null?e.ore_q2+'h':'—'}${e.note_q2?` <span style="color:var(--ink-3);font-size:.73rem">(${_esc(e.note_q2)})</span>`:''}</td><td><b>${tot}h</b>${straoBadge}</td><td style="color:var(--ink-3)">${av}h</td><td><button class="btn-icon danger" onclick="deleteMyOre(${e.id},'${MONTHS[e.mese]} ${e.anno}')" title="Elimina inserimento"><i class="fa-solid fa-trash-can" style="font-size:.72rem"></i></button></td></tr>`;
  });
  el.innerHTML=h+'</tbody></table></div>';
}
async function deleteMyOre(id,label){
  openModal('Elimina ore','Eliminare le ore di "'+label+'"?',async()=>{
    showSpinner();try{await call('deleteOre',{id});await reloadAll();}catch(e){hideSpinner();showMsg('oreMsg','Errore: '+e.message,'err');return;}
    hideSpinner();showMsg('oreMsg','Ore eliminate.','ok');await renderMyOre();checkAlerts();
  },'Elimina');
}
async function sollecitaForecast(){
  const r=RESOURCES.find(x=>x.fullName===currentUser);
  if(!r){showMsg('sollecitaMsg','Risorsa non trovata.','err');return;}
  // Il sollecito riguarda il mese filtrato nel pannello Riepilogo team
  const mese=+document.getElementById('riepilogoMonth').value,anno=+document.getElementById('riepilogoYear').value,lbl=MONTHS[mese]+' '+anno;
  showSpinner();
  let res;
  try{res=await call('sollecitaForecast',{managerId:r.id,anno,mese});}
  catch(e){hideSpinner();showMsg('sollecitaMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  if(res.reason==='no_smtp'){showMsg('sollecitaMsg','SMTP non configurato.','err');return;}
  if(res.reason==='no_resources'){showMsg('sollecitaMsg','Nessuna risorsa nel tuo team con email configurata.','warn');return;}
  if(res.reason==='all_complete'){showMsg('sollecitaMsg',`Tutte le risorse hanno compilato il Forecast di ${lbl}.`,'ok');return;}
  let msg=`${lbl} — solleciti inviati: ${res.sent}`;
  if(res.skipped)msg+=`, già compilati: ${res.skipped}`;
  if(res.failed)msg+=`, errori: ${res.failed}`;
  showMsg('sollecitaMsg',msg,res.sent>0?'ok':'warn');
}
// RIEPILOGO
async function loadRiepilogo(){
  const month=+document.getElementById('riepilogoMonth').value,year=+document.getElementById('riepilogoYear').value;
  const _rLeadFld=document.getElementById('riepilogoLead');if(_rLeadFld)_rLeadFld.closest('.field').style.display=(isTeamLead&&!isAdmin)?'none':'';
  const lf=(isTeamLead&&!isAdmin)?currentUser:(_rLeadFld?.value||''),members=getMembers(lf);
  let _hrs={};(_read(K_HRS,[])||[]).filter(o=>o.anno===year&&o.mese===month).forEach(o=>{const res=RESOURCES.find(x=>x.id===o.risorsaId);if(res)_hrs[res.fullName]={ore1:o.ore_q1,note1:o.note_q1,ore2:o.ore_q2,note2:o.note_q2};});
  const av=wHours(year,month,1)+wHours(year,month,2);
  const canWbs=isAdmin||isTeamLead;
  const canLC=isAdmin||isTeamLead;
  const cols=canWbs?(canLC?9:8):7;
  let h=`<div class="table-wrap"><table><thead><tr><th>Risorsa</th><th>Team Lead</th><th>I Q</th><th>II Q</th><th>Totale</th><th>Disponibili</th><th>Stato</th>${canLC?'<th style="white-space:nowrap">LC (€)</th>':''}${canWbs?'<th></th>':''}</tr></thead><tbody>`;
  if(!members.length)h+=`<tr><td colspan="${cols}" style="text-align:center;color:var(--ink-3)">Nessuna risorsa</td></tr>`;
  members.forEach(m=>{
    const lead=getLeadForMember(m),e=_hrs[m];
    const res=RESOURCES.find(x=>x.fullName===m),rid=res?res.id:0;
    const wbsEntries=res?getWbsForMember(rid,year,month):[];
    const hasWbs=wbsEntries.length>0;
    const panelId=`wbsp-${rid}-${month}-${year}`;
    const wbsTd=canWbs?`<td style="white-space:nowrap"><button class="btn btn-ghost2 btn-sm${hasWbs?' btn-wbs-set':''}" onclick="toggleWbsPanel('${panelId}',${rid},${month},${year})"><i class="fa-solid fa-code-branch"></i> WBS</button></td>`:'';
    const lcTd=canLC?`<td style="white-space:nowrap;font-size:.82rem;color:var(--amber);font-weight:600">${res&&res.loadCost!=null?'€'+res.loadCost:'—'}</td>`:'';
    if(!e)h+=`<tr><td>${_esc(m)}</td><td style="color:var(--ink-3);font-size:.8rem">${_esc(lead)}</td><td colspan="3" style="color:var(--ink-3)">—</td><td style="color:var(--ink-3)">${av}h</td><td><span class="badge badge-warn">Non inserito</span></td>${lcTd}${wbsTd}</tr>`;
    else{const tot=(+e.ore1||0)+(+e.ore2||0);h+=`<tr><td><b>${_esc(m)}</b></td><td style="color:var(--ink-3);font-size:.8rem">${_esc(lead)}</td><td>${e.ore1!=null?e.ore1+'h':'—'}</td><td>${e.ore2!=null?e.ore2+'h':'—'}</td><td><b>${tot}h</b></td><td style="color:var(--ink-3)">${av}h</td><td>${tot>av?`<span class="badge badge-amber">Extra ${tot}h</span>`:`<span class="badge badge-ok">${tot}h</span>`}</td>${lcTd}${wbsTd}</tr>`;}
    if(canWbs)h+=`<tr id="${panelId}" style="display:none"><td colspan="${cols}" style="padding:0">${buildWbsPanelHtml(rid,m,month,year,wbsEntries)}</td></tr>`;
  });
  document.getElementById('riepilogoTable').innerHTML=h+'</tbody></table></div>';
}
function toggleWbsPanel(panelId,risorsaId,month,year){
  const row=document.getElementById(panelId);if(!row)return;
  const isOpen=row.style.display!=='none';
  document.querySelectorAll('[id^="wbsp-"]').forEach(el=>{el.style.display='none';});
  if(!isOpen)row.style.display='';
}
function buildWbsPanelHtml(risorsaId,memberName,month,year,entries){
  const q1=entries.filter(e=>e.q==='1Q'),q2=entries.filter(e=>e.q==='2Q');
  function colHtml(q,list){
    const cid=`wbs-rows-${risorsaId}-${month}-${year}-${q}`;
    let s=`<div id="${cid}">`;
    if(!list.length)s+=wbsRowHtml(risorsaId,month,year,q,0,'','','');
    else list.forEach((e,i)=>{s+=wbsRowHtml(risorsaId,month,year,q,i,e.progetto||'',e.codice||'',e.ore!=null?e.ore:'');});
    s+=`</div><button class="btn btn-ghost2 btn-sm" style="margin-top:6px" onclick="addWbsRow(${risorsaId},${month},${year},'${q}')"><i class="fa-solid fa-plus"></i> Aggiungi WBS</button>`;
    return s;
  }
  const label1=`<div class="wbs-col-head"><span>I</span> Quindicina (1–15)</div>`;
  const label2=`<div class="wbs-col-head"><span>II</span> Quindicina (16–fine)</div>`;
  return `<div class="wbs-panel"><div class="wbs-panel-title"><i class="fa-solid fa-code-branch"></i> WBS per <b>${_esc(memberName)}</b> — ${MONTHS[month]} ${year}</div><div class="wbs-cols"><div class="wbs-col">${label1}${colHtml('1Q',q1)}</div><div class="wbs-col">${label2}${colHtml('2Q',q2)}</div></div><div style="display:flex;gap:10px;align-items:center;margin-top:14px"><button class="btn btn-ink" onclick="saveWbsForMember(${risorsaId},${month},${year})"><i class="fa-solid fa-floppy-disk"></i> Salva WBS</button><div id="wbs-msg-${risorsaId}-${month}-${year}" class="msg"></div></div></div>`;
}
function wbsRowHtml(risorsaId,month,year,q,idx,progetto,codice,ore){
  const rid=`wbsr-${risorsaId}-${month}-${year}-${q}-${idx}`;
  const cE=_esc(codice||'');
  const oV=ore!=null&&ore!==''?_esc(ore):'';
  const res=RESOURCES.find(x=>x.id===risorsaId);const prjs=res?.progetti||[];
  const opts='<option value="">— Progetto —</option>'+prjs.map(p=>`<option value="${_esc(p)}"${p===progetto?' selected':''}>${_esc(p)}</option>`).join('');
  return `<div class="wbs-row" id="${rid}"><select class="wbs-input wbs-prj-sel" onchange="onWbsProgettoChange(this,'${rid}')">${opts}</select><input type="text" class="wbs-input wbs-code" placeholder="Codice WBS" value="${cE}"/><input type="number" class="wbs-input wbs-ore" placeholder="Ore" min="0" step="0.5" value="${oV}"/><button class="btn-icon danger" onclick="removeWbsRow('${rid}')" title="Rimuovi"><i class="fa-solid fa-xmark"></i></button></div>`;
}
function onWbsProgettoChange(sel,rid){
  const row=document.getElementById(rid);if(!row)return;
  const wbsCode=_prjWbsByName[sel.value]||'';
  const ci=row.querySelector('.wbs-code');
  if(ci&&wbsCode)ci.value=wbsCode;
}
function addWbsRow(risorsaId,month,year,q){
  const c=document.getElementById(`wbs-rows-${risorsaId}-${month}-${year}-${q}`);if(!c)return;
  c.insertAdjacentHTML('beforeend',wbsRowHtml(risorsaId,month,year,q,c.children.length,'','',''));
}
function removeWbsRow(rowId){const el=document.getElementById(rowId);if(el)el.remove();}
async function saveWbsForMember(risorsaId,month,year){
  const entries=[];
  ['1Q','2Q'].forEach(q=>{
    const c=document.getElementById(`wbs-rows-${risorsaId}-${month}-${year}-${q}`);if(!c)return;
    [...c.querySelectorAll('.wbs-row')].forEach(row=>{
      const progetto=(row.querySelector('.wbs-prj-sel')?.value||'').trim(),codice=(row.querySelector('.wbs-code')?.value||'').trim();
      const oreVal=row.querySelector('.wbs-ore')?.value;const ore=oreVal!==''&&oreVal!=null?+oreVal:null;
      if(progetto||codice)entries.push({q,progetto,codice,ore});
    });
  });
  const msgId=`wbs-msg-${risorsaId}-${month}-${year}`;
  showSpinner();
  try{await call('saveWbs',{risorsaId,anno:year,mese:month,entries});_cache.wbs[`${risorsaId}_${year}_${month}`]=entries;}
  catch(err){hideSpinner();showMsg(msgId,'Errore: '+err.message,'err');return;}
  hideSpinner();showMsg(msgId,'WBS salvata','ok');
}
