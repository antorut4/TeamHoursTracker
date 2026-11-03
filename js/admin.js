// Admin: progetti, risorse, password admin, export Excel e backup
// ACCORDION
function toggleAcc(btn){const body=btn.closest('.card').querySelector('.acc-body');const isOpen=body.classList.contains('open');body.classList.toggle('open');btn.innerHTML=isOpen?'<i class="fa-solid fa-chevron-down"></i>':'<i class="fa-solid fa-chevron-up"></i>';}
// PROGETTI
async function populateProgettoSelect(prefix,selected=[]){
  const sel=document.getElementById(prefix+'ProgettoSel');if(!sel)return;
  const prjs=await getProjects();
  sel.innerHTML='<option value="">— Progetto —</option>';
  prjs.sort().forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;sel.appendChild(o);});
  const tagsDiv=document.getElementById(prefix+'ProgettoTags');if(!tagsDiv)return;tagsDiv.innerHTML='';
  const selArr=Array.isArray(selected)?selected:(selected?[selected]:[]);
  selArr.forEach(p=>_addTag(prefix,p));
}
function _addTag(prefix,value){
  if(!value)return;
  const tagsDiv=document.getElementById(prefix+'ProgettoTags');if(!tagsDiv)return;
  if([...tagsDiv.querySelectorAll('.prj-tag')].some(t=>t.dataset.value===value))return;
  const tag=document.createElement('span');tag.className='prj-tag';tag.dataset.value=value;
  const tls=_prjTLsByName[value]||[];
  const tlHtml=tls.length?` <span style="font-size:.67rem;color:var(--amber);font-weight:600">→ ${_esc(tls.map(t=>t.split(' ')[0]).join(', '))}</span>`:'';
  tag.innerHTML=`<i class="fa-solid fa-folder" style="font-size:.7rem"></i> ${_esc(value)}${tlHtml}<button type="button" onclick="removeProgettoTag(this,'${prefix}')" title="Rimuovi">✕</button>`;
  tagsDiv.appendChild(tag);
}
function addProgettoTag(prefix){
  const sel=document.getElementById(prefix+'ProgettoSel');if(!sel||!sel.value)return;
  _addTag(prefix,sel.value);sel.value='';
}
function removeProgettoTag(btn,prefix){btn.parentElement.remove();}
function getProgettoSelected(prefix){const tagsDiv=document.getElementById(prefix+'ProgettoTags');if(!tagsDiv)return[];return[...tagsDiv.querySelectorAll('.prj-tag')].map(t=>t.dataset.value);}
function getProgettoLeads(prefix){const tagsDiv=document.getElementById(prefix+'ProgettoTags');if(!tagsDiv)return{};const m={};tagsDiv.querySelectorAll('.prj-tag').forEach(t=>{if(t.dataset.lead)m[t.dataset.value]=t.dataset.lead;});return m;}
function addNewPrjTL(){
  const sel=document.getElementById('newPrjTLSel');if(!sel||!sel.value)return;
  const name=sel.value,tags=document.getElementById('newPrjTLTags');
  if(!tags)return;
  if([...tags.querySelectorAll('[data-tl]')].some(t=>t.dataset.tl===name)){sel.value='';return;}
  const chip=document.createElement('span');
  chip.dataset.tl=name;chip.style.cssText='display:inline-flex;align-items:center;gap:4px;background:var(--amber-bg);color:var(--amber);border-radius:4px;padding:2px 8px;font-size:.75rem;font-weight:600';
  chip.innerHTML=`<i class="fa-solid fa-user-tie" style="font-size:.65rem"></i>${_esc(name)}<button type="button" onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--amber);padding:0;line-height:1;font-size:.85rem;margin-left:2px">×</button>`;
  tags.appendChild(chip);sel.value='';
}
function getNewPrjTLNames(){return[...document.querySelectorAll('#newPrjTLTags [data-tl]')].map(t=>t.dataset.tl);}
async function addProject(){
  const name=document.getElementById('newPrjName').value.trim();if(!name){showMsg('addPrjMsg','Inserisci il nome del progetto.','err');return;}
  const prjs=await getProjects();if(prjs.map(p=>p.toLowerCase()).includes(name.toLowerCase())){showMsg('addPrjMsg','Progetto già esistente.','err');return;}
  const teamLeadNames=getNewPrjTLNames();
  const wbs=(document.getElementById('newPrjWbs')?.value||'').trim();
  showSpinner();try{await call('addProject',{nome:name,teamLeadNames,wbs:wbs||null});await reloadAll();}catch(e){hideSpinner();showMsg('addPrjMsg','Errore: '+e.message,'err');return;}hideSpinner();
  document.getElementById('newPrjName').value='';const tags=document.getElementById('newPrjTLTags');if(tags)tags.innerHTML='';const ts=document.getElementById('newPrjTLSel');if(ts)ts.value='';const ws=document.getElementById('newPrjWbs');if(ws)ws.value='';
  await renderProjectList();populateProgettoSelect('res',getProgettoSelected('res'));populateProgettoSelect('edit',getProgettoSelected('edit'));populateSearchByProject();refreshDropdowns();showMsg('addPrjMsg','"'+name+'" aggiunto','ok');
}
async function saveProjectLead(id,tlName){/* deprecata — usa addProjectTL/removeProjectTL */}
async function addProjectTL(progettoId,tlName){
  if(!tlName)return;
  showSpinner();try{await call('addProjectTL',{progettoId,tlName});await reloadAll();}catch(e){hideSpinner();alert('Errore: '+e.message);return;}hideSpinner();
  await renderProjectList();refreshDropdowns();populateProgettoSelect('res',getProgettoSelected('res'));populateProgettoSelect('edit',getProgettoSelected('edit'));
}
async function removeProjectTL(progettoId,tlName){
  showSpinner();try{await call('removeProjectTL',{progettoId,tlName});await reloadAll();}catch(e){hideSpinner();alert('Errore: '+e.message);return;}hideSpinner();
  await renderProjectList();refreshDropdowns();populateProgettoSelect('res',getProgettoSelected('res'));populateProgettoSelect('edit',getProgettoSelected('edit'));
}
async function saveProjectWbs(id,wbs){
  try{await call('saveProjectWbs',{id,wbs:wbs||null});const nome=_prjNameById[id];if(nome)_prjWbsByName[nome]=wbs||'';}catch(e){alert('Errore WBS: '+e.message);}
}
async function deleteProject(name){openModal('Elimina progetto','Eliminare "'+name+'"? Verrà rimosso anche dalle allocazioni.',async()=>{showSpinner();try{await call('deleteProject',{nome:name});await reloadAll();}catch(e){hideSpinner();showMsg('addPrjMsg','Errore: '+e.message,'err');return;}hideSpinner();await renderProjectList();populateProgettoSelect('res',[]);populateProgettoSelect('edit',[]);populateSearchByProject();showMsg('addPrjMsg','Progetto eliminato.','ok');},'Elimina');}
async function renderResourcesByProject(){
  const prj=document.getElementById('searchByProject')?.value||'';const el=document.getElementById('resourcesByProjectList');if(!el)return;
  if(!prj){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Seleziona un progetto.</p>';return;}
  const staffed=RESOURCES.filter(r=>(r.progetti||[r.progetto]).filter(Boolean).includes(prj));
  if(!staffed.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessuna risorsa allocata.</p>';return;}
  const tls=_prjTLsByName[prj]||[];const tlLabel=tls.length?tls.join(', '):'—';
  el.innerHTML=`<div style="font-size:.72rem;color:var(--amber);font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:9px">${staffed.length} risorsa${staffed.length!==1?'e':''} su ${_esc(prj)} · TL: ${_esc(tlLabel)}</div>`+staffed.map(r=>`<div class="resource-row"><div><div class="rname">${_esc(r.fullName)}</div><div class="rmeta">${_esc((r.progetti||[]).join(', ')||'—')}</div></div></div>`).join('');
}
async function populateSearchByProject(){const sel=document.getElementById('searchByProject');if(!sel)return;const prjs=(isTeamLead&&!isAdmin)?_getManagerProjects():(await getProjects()).sort();const cur=sel.value;sel.innerHTML='<option value="">— Seleziona —</option>';prjs.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;if(p===cur)o.selected=true;sel.appendChild(o);});}
function _getManagerProjects(){const team=new Set(getLeadTeam()),myResPrjs=new Set(RESOURCES.filter(r=>team.has(r.fullName)).flatMap(r=>r.progetti||[]));return(_cache.prj||[]).filter(p=>myResPrjs.has(p)).sort();}
async function renderProjectList(){
  const prjsFull=(isTeamLead&&!isAdmin)?_getManagerProjects():(_cache.prj||[]).slice().sort();const el=document.getElementById('prjList');if(!el)return;
  if(!prjsFull.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessun progetto.</p>';return;}
  const tlOptsList=RESOURCES.map(r=>`<option value="${_esc(r.fullName)}">${_esc(r.fullName)}</option>`).join('');
  el.innerHTML=prjsFull.map(p=>{
    const pid=_prjIdByName[p]||0,currentTLs=_prjTLsByName[p]||[];
    const tipi=_cache.repTipi[String(pid)]||[];
    const tipiTags=tipi.length?tipi.map(t=>`<span style="background:var(--info-bg);color:var(--info);border-radius:4px;padding:1px 7px;font-size:.7rem;display:inline-flex;align-items:center;gap:3px">${_esc(t)} <button onclick="removeRepTipoUI(${pid},${_jsa(t)})" style="background:none;border:none;cursor:pointer;color:var(--info);padding:0;line-height:1;font-size:.75rem">×</button></span>`).join(''):'<span style="font-size:.7rem;color:var(--ink-3);font-style:italic">predefinita</span>';
    const tlChips=currentTLs.map(tl=>`<span style="display:inline-flex;align-items:center;gap:4px;background:var(--amber-bg);color:var(--amber);border-radius:4px;padding:2px 7px;font-size:.72rem;font-weight:600">${_esc(tl.split(' ')[0])} ${_esc(tl.split(' ').slice(1).join(' '))} <button onclick="removeProjectTL(${pid},${_jsa(tl)})" style="background:none;border:none;cursor:pointer;color:var(--amber);padding:0;line-height:1;font-size:.8rem;margin-left:2px">×</button></span>`).join('');
    const addableTLs=tlOptsList.replace(currentTLs.map(tl=>`value="${_esc(tl)}"`).join('|'),'');
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;background:var(--stone);border-radius:var(--r);margin-bottom:6px;border:1px solid var(--line)">
      <i class="fa-solid fa-folder" style="color:var(--amber);font-size:.8rem;flex-shrink:0"></i>
      <span style="font-size:.85rem;font-weight:500;flex:1;min-width:80px">${_esc(p)}</span>
      <span style="font-size:.75rem;color:var(--ink-3);white-space:nowrap;flex-shrink:0">WBS:</span>
      <input type="text" placeholder="Codice WBS" value="${_esc(_prjWbsByName[p]||'')}" style="font-size:.75rem;padding:2px 6px;border-radius:4px;border:1px solid var(--line);background:var(--white);max-width:120px" onblur="saveProjectWbs(${pid},this.value)" onkeydown="if(event.key==='Enter')saveProjectWbs(${pid},this.value)"/>
      <button class="btn-icon danger" onclick="deleteProject(${_jsa(p)})"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button>
      <div style="flex:1 1 100%;display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding-top:5px;border-top:1px solid var(--line)">
        <span style="font-size:.72rem;color:var(--ink-3);font-weight:600;white-space:nowrap;flex-shrink:0"><i class="fa-solid fa-user-tie" style="margin-right:3px"></i>Team Lead:</span>
        <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">${tlChips||'<span style="font-size:.72rem;color:var(--ink-3);font-style:italic">nessuno</span>'}
          <select style="font-size:.72rem;padding:2px 6px;border-radius:4px;border:1px solid var(--line);background:var(--white);max-width:160px;color:var(--ink-2)" onchange="if(this.value){addProjectTL(${pid},this.value);this.value=''}">
            <option value="">+ Aggiungi TL</option>${tlOptsList}
          </select>
        </div>
      </div>
      <div style="flex:1 1 100%;display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding-top:5px;border-top:1px solid var(--line)">
        <span style="font-size:.72rem;color:var(--ink-3);font-weight:600;white-space:nowrap"><i class="fa-solid fa-tower-broadcast" style="margin-right:3px"></i>Reperibilità:</span>
        <div style="display:flex;gap:3px;flex-wrap:wrap">${tipiTags}</div>
        <button class="btn btn-ghost2 btn-sm" onclick="addRepTipoUI(${pid})" style="font-size:.7rem;padding:1px 7px"><i class="fa-solid fa-plus"></i> Aggiungi</button>
      </div>
    </div>`;
  }).join('');
}
function addRepTipoUI(pid){
  const label=prompt('Nome tipo reperibilità (es. Turno 1):');
  if(!label||!label.trim())return;
  const tipi=[...(_cache.repTipi[String(pid)]||[])];
  if(tipi.includes(label.trim()))return;
  tipi.push(label.trim());
  saveRepTipiJS(pid,tipi);
}
function removeRepTipoUI(pid,tipo){
  const tipi=(_cache.repTipi[String(pid)]||[]).filter(t=>t!==tipo);
  saveRepTipiJS(pid,tipi);
}
async function saveRepTipiJS(pid,tipi){
  showSpinner();try{await call('saveRepTipi',{id:pid,tipi});_cache.repTipi[String(pid)]=tipi;await renderProjectList();}catch(e){alert('Errore: '+e.message);}hideSpinner();
}
// RISORSE ADMIN
async function addResource(){
  addProgettoTag('res');
  const nome=document.getElementById('resNome').value.trim(),cognome=document.getElementById('resCognome').value.trim();
  const progetti=getProgettoSelected('res');
  const managerName=(isTeamLead&&!isSeniorManager)?currentUser:(document.getElementById('resManagerSel')?.value||'');
  const managerRes=managerName?RESOURCES.find(r=>r.fullName===managerName):null;
  const managerId=managerRes?managerRes.id:null;
  const isManager=!!(document.getElementById('resIsManager')?.checked);
  const email=(document.getElementById('resEmail')?.value||'').trim().toLowerCase()||null;
  if(!nome||!cognome){showMsg('addResMsg','Nome e Cognome obbligatori.','err');return;}
  if(!email){showMsg('addResMsg','Email obbligatoria.','err');return;}
  const fn=nome+' '+cognome;if(RESOURCES.find(r=>r.fullName.toLowerCase()===fn.toLowerCase())){showMsg('addResMsg','Risorsa già presente.','err');return;}
  const loadCost=(document.getElementById('resLC')?.value||'').replace(/,/g,'.');
  const employeeId=(document.getElementById('resEmpId')?.value||'').trim();
  const sr=isAdmin?_seniorFields('res'):{};
  showSpinner();try{await call('addResource',{nome,cognome,email,progetti,managerId,isManager,...sr,loadCost:loadCost!==''?+loadCost:null,employeeId});await reloadAll();}catch(e){hideSpinner();showMsg('addResMsg','Errore: '+e.message,'err');return;}hideSpinner();
  document.getElementById('resNome').value='';document.getElementById('resCognome').value='';
  if(document.getElementById('resEmail'))document.getElementById('resEmail').value='';
  if(document.getElementById('resLC'))document.getElementById('resLC').value='';
  if(document.getElementById('resEmpId'))document.getElementById('resEmpId').value='';
  if(document.getElementById('resIsManager'))document.getElementById('resIsManager').checked=false;
  _setSeniorFields('res',null);
  populateProgettoSelect('res',[]);
  await renderResourceList();refreshDropdowns();checkAlerts();showMsg('addResMsg',fn+' aggiunto/a','ok');
}
async function renderResourceList(){
  const search=(document.getElementById('searchRes')?.value||'').toLowerCase(),lf=document.getElementById('filterResLead')?.value||'';
  const fl=document.getElementById('filterResLead');if(fl){const pv=fl.value;fl.innerHTML='<option value="">Tutti i team lead</option>';getLeads().forEach(l=>{const o=document.createElement('option');o.value=l;o.textContent=l;if(l===pv)o.selected=true;fl.appendChild(o);});}
  const el=document.getElementById('resourceList');if(!el)return;
  if(!RESOURCES.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessuna risorsa ancora.</p>';return;}
  const myTeam=new Set(getLeadTeam());
  let filtered=RESOURCES.filter(r=>{
    if(isTeamLead&&!isAdmin&&!myTeam.has(r.fullName))return false;
    if(lf&&!r.progetti.some(p=>(_prjTLsByName[p]||[]).includes(lf)))return false;
    if(search&&!r.fullName.toLowerCase().includes(search))return false;
    return true;
  });
  if(!filtered.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessun risultato.</p>';return;}
  const pwds={};try{const res=await Promise.all(filtered.map(r=>call('userHasPwd',{risorsaId:r.id})));filtered.forEach((r,i)=>{pwds[r.id]=!!res[i];});}catch(e){console.error('stato password',e);}
  let h='';
  filtered.slice().sort((a,b)=>a.fullName.localeCompare(b.fullName)).forEach(r=>{
    const idx=RESOURCES.indexOf(r),hasPwd=!!pwds[r.id];
    const prjMeta=_esc((r.progetti||[]).join(' · ')||'—');
    const assoc=r.isSenior?RESOURCES.filter(x=>x.managerId===r.id&&x.isManager).map(x=>x.fullName):[];
    const mgrBadge=r.isSenior?`<span class="badge badge-amber" style="font-size:.68rem"><i class="fa-solid fa-crown" style="margin-right:3px"></i>Senior Manager</span> `
      :r.isManager?`<span class="badge badge-amber" style="font-size:.68rem"><i class="fa-solid fa-user-tie" style="margin-right:3px"></i>Manager</span> `:'';
    const assocMeta=r.isSenior?`<span style="color:var(--ink-2);font-size:.72rem"><i class="fa-solid fa-people-group" style="margin-right:3px"></i>Manager associati: ${assoc.length?_esc(assoc.join(', ')):'nessuno'}</span> · `:'';
    const mgrMeta=r.managerName?`<span style="color:var(--amber);font-size:.72rem"><i class="fa-solid fa-sitemap" style="margin-right:3px"></i>${_esc(r.managerName)}</span> · `:'';
    const emailMeta=r.email?`<span style="color:var(--ink-3);font-size:.72rem"><i class="fa-solid fa-envelope" style="margin-right:3px"></i>${_esc(r.email)}</span> · `:'';
    const lcMeta=(isAdmin||isTeamLead)&&r.loadCost!=null?`<span style="color:var(--amber);font-size:.72rem;font-weight:600"><i class="fa-solid fa-euro-sign" style="margin-right:2px"></i>LC: ${_esc(r.loadCost)}</span> · `:'';
    const empMeta=(isAdmin||isTeamLead)&&r.employeeId?`<span style="color:var(--ink-2);font-size:.72rem;font-weight:600"><i class="fa-solid fa-id-badge" style="margin-right:3px"></i>Emp. ${_esc(r.employeeId)}</span> · `:'';
    h+=`<div class="resource-row"><div><div class="rname">${_esc(r.fullName)} ${mgrBadge}</div><div class="rmeta">${emailMeta}${mgrMeta}${assocMeta}${lcMeta}${empMeta}${prjMeta} · <span class="badge ${hasPwd?'badge-ok':'badge-warn'}" style="font-size:.68rem">${hasPwd?'Password impostata':'Nessuna password'}</span></div></div><div class="resource-actions">${!hasPwd?'':`<button class="btn btn-ghost2 btn-sm" onclick="confirmResetPwd(${idx},${_jsa(r.fullName)})">Reset pwd</button>`}<button class="btn-icon" onclick="startEdit(${idx})"><i class="fa-solid fa-pen" style="font-size:.75rem"></i></button><button class="btn-icon danger" onclick="deleteResource(${idx},${_jsa(r.fullName)})"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button></div></div>`;
  });
  h+=`<div style="color:var(--ink-3);font-size:.75rem;margin-top:12px">Totale: ${RESOURCES.length} risorsa${RESOURCES.length!==1?'e':''}</div>`;
  el.innerHTML=h;
}
async function confirmResetPwd(idx,name){openModal('Reset password','Resettare la password di "'+name+'"?',async()=>{const rid=RESOURCES[idx].id;await call('resetUserPwd',{risorsaId:rid});await renderResourceList();showMsg('resourceMsg','Password di '+name+' resettata: al prossimo accesso riceverà via email il link per impostarne una nuova.','ok');},'Reset');}
function startEdit(idx){
  const r=RESOURCES[idx];
  document.getElementById('editIdx').value=idx;
  document.getElementById('editNome').value=r.nome;
  document.getElementById('editCognome').value=r.cognome;
  populateProgettoSelect('edit',r.progetti||[r.progetto].filter(Boolean));
  const eeEl=document.getElementById('editEmail');if(eeEl)eeEl.value=r.email||'';
  const emSel=document.getElementById('editManagerSel');if(emSel)emSel.value=r.managerName||'';
  const emChk=document.getElementById('editIsManager');if(emChk)emChk.checked=!!r.isManager;
  _setSeniorFields('edit',r);
  const elcEl=document.getElementById('editLC');if(elcEl)elcEl.value=r.loadCost!=null?r.loadCost:'';
  const eempEl=document.getElementById('editEmpId');if(eempEl)eempEl.value=r.employeeId||'';
  const ec=document.getElementById('editCard');ec.style.display='block';
  const eb=ec.querySelector('.acc-body'),ebtn=ec.querySelector('.acc-toggle');
  if(eb&&!eb.classList.contains('open')){eb.classList.add('open');if(ebtn)ebtn.innerHTML='<i class="fa-solid fa-chevron-up"></i>';}
  ec.scrollIntoView({behavior:'smooth',block:'nearest'});
}
// Senior Manager (solo admin): spunta del ruolo ed elenco dei manager associati, che ereditano lui come manager
function _setSeniorFields(prefix,r){
  const chk=document.getElementById(prefix+'IsSenior');if(!chk)return;
  chk.checked=!!r?.isSenior;
  const box=document.getElementById(prefix+'SeniorMgrs');
  const cands=RESOURCES.filter(x=>x.isManager&&(!r||x.id!==r.id)).sort((a,b)=>a.fullName.localeCompare(b.fullName,'it'));
  box.innerHTML=cands.length?cands.map(x=>`<label class="mgr-check-label"><input type="checkbox" value="${x.id}"${r&&x.managerId===r.id?' checked':''}/> <span>${_esc(x.fullName)}${x.isSenior?' <small>(Senior)</small>':''}</span></label>`).join('')
    :'<span style="font-size:.8rem;color:var(--ink-3)">Nessun manager disponibile: prima segna come manager le risorse da associare.</span>';
  toggleSeniorBox(prefix);
}
function toggleSeniorBox(prefix){
  const chk=document.getElementById(prefix+'IsSenior'),wrap=document.getElementById(prefix+'SeniorBox');
  if(chk&&wrap)wrap.style.display=chk.checked?'':'none';
  // Il Senior Manager è sempre anche manager
  const mgr=document.getElementById(prefix+'IsManager');if(chk?.checked&&mgr)mgr.checked=true;
}
function _seniorFields(prefix){
  const chk=document.getElementById(prefix+'IsSenior');if(!chk)return{};
  const ids=chk.checked?[...document.querySelectorAll('#'+prefix+'SeniorMgrs input:checked')].map(i=>+i.value):[];
  return{isSenior:chk.checked,managerIds:ids};
}
function cancelEdit(){document.getElementById('editCard').style.display='none';}
async function saveEdit(){
  addProgettoTag('edit');
  const idx=+document.getElementById('editIdx').value,nome=document.getElementById('editNome').value.trim(),cognome=document.getElementById('editCognome').value.trim();
  const progetti=getProgettoSelected('edit');if(!nome||!cognome){showMsg('editMsg','Nome e Cognome obbligatori.','err');return;}
  const managerName=document.getElementById('editManagerSel')?.value||'';
  const managerRes=managerName?RESOURCES.find(r=>r.fullName===managerName):null;
  const managerId=managerRes?managerRes.id:null;
  const isManager=!!(document.getElementById('editIsManager')?.checked);
  const email=(document.getElementById('editEmail')?.value||'').trim().toLowerCase()||null;
  const newFN=nome+' '+cognome,rid=RESOURCES[idx].id;
  const loadCost=(document.getElementById('editLC')?.value||'').replace(/,/g,'.');
  // campo nascosto (stessa visibilità del LC) → employeeId non inviato, il server lo lascia invariato
  const empEl=document.getElementById('editEmpId'),employeeId=empEl&&document.getElementById('editEmpField')?.style.display!=='none'?empEl.value.trim():undefined;
  const sr=isAdmin?_seniorFields('edit'):{};
  showSpinner();try{await call('saveEdit',{id:rid,nome,cognome,email,progetti,managerId,isManager,...sr,loadCost:loadCost!==''?+loadCost:null,employeeId});await reloadAll();}catch(e){hideSpinner();showMsg('editMsg','Errore: '+e.message,'err');return;}hideSpinner();
  document.getElementById('editCard').style.display='none';await renderResourceList();refreshDropdowns();showMsg('resourceMsg',newFN+' aggiornato/a','ok');
}
async function deleteResource(idx,name){openModal('Elimina risorsa','Eliminare "'+name+'"? Verranno rimossi ore, ferie e reperibilità associati.',async()=>{const rid=RESOURCES[idx].id;showSpinner();try{await call('deleteResource',{id:rid});await reloadAll();}catch(e){hideSpinner();showMsg('resourceMsg','Errore: '+e.message,'err');return;}hideSpinner();await renderResourceList();refreshDropdowns();showMsg('resourceMsg',name+' eliminato/a.','ok');},'Elimina');}
async function changeAdminPwd(){const p1=document.getElementById('newPwd1').value,p2=document.getElementById('newPwd2').value;if(!p1){showMsg('pwdMsg','Inserisci la nuova password.','err');return;}if(p1!==p2){showMsg('pwdMsg','Le password non coincidono.','err');return;}if(p1.length<6){showMsg('pwdMsg','Minimo 6 caratteri.','err');return;}showSpinner();try{const r=await call('setAdminPwd',{password:p1});_setToken(r.token);}catch(e){hideSpinner();showMsg('pwdMsg','Errore: '+e.message,'err');return;}hideSpinner();document.getElementById('newPwd1').value='';document.getElementById('newPwd2').value='';showMsg('pwdMsg','Password aggiornata','ok');}
// EXPORT
async function exportExcel(){
  const msgEl=document.getElementById('exportMsg');
  const exportErr=msg=>{if(msgEl){msgEl.textContent=msg;msgEl.className='msg err';setTimeout(()=>{msgEl.className='msg';},6000);}console.error('[EXPORT]',msg);};
  const exportOk=msg=>{if(msgEl){msgEl.textContent=msg;msgEl.className='msg ok';setTimeout(()=>{msgEl.className='msg';},3000);}};
  console.log('[EXPORT] click, XLSX=',typeof XLSX);
  if(typeof XLSX==='undefined'){exportErr('Libreria Excel non caricata — ricarica la pagina.');return;}
  showSpinner();
  try{
    console.log('[EXPORT] reloadAll start');
    await reloadAll();
    console.log('[EXPORT] reloadAll done, hrs=',_cache.hrs.length,'fer=',_cache.fer.length);
    const month=+document.getElementById('riepilogoMonth').value,year=+document.getElementById('riepilogoYear').value;
    const lf=(isTeamLead&&!isAdmin)?currentUser:(document.getElementById('riepilogoLead')?.value||''),members=getMembers(lf);
    let all={};(_read(K_HRS,[])||[]).filter(o=>o.anno===year&&o.mese===month).forEach(o=>{const res=RESOURCES.find(x=>x.id===o.risorsaId);if(res)all[res.fullName]={ore1:o.ore_q1,note1:o.note_q1,ore2:o.ore_q2,note2:o.note_q2};});
    const allFerRows=(_read(K_FER,[])||[]).map(f=>{const res=RESOURCES.find(x=>x.id===f.risorsaId);return res?{user:res.fullName,start:f.start,end:f.end,tipo:f.tipo,note:f.note,oraInizio:f.oraInizio||null,oraFine:f.oraFine||null}:null;}).filter(Boolean);
    const av=wHours(year,month,1)+wHours(year,month,2);
    const sd=[['Risorsa','Team Lead','I Q (h)','II Q (h)','Totale (h)','Disponibili','Stato']];
    members.forEach(m=>{const lead=getLeadForMember(m),e=all[m];if(e){const tot=(+e.ore1||0)+(+e.ore2||0);sd.push([m,lead,e.ore1||0,e.ore2||0,tot,av,tot>av?'Extra':'OK']);}else sd.push([m,lead,'—','—','—',av,'Mancante']);});
    const fd=[['Risorsa','Team Lead','Tipo','Data Inizio','Data Fine','Giorni Lav.','Orario','Note']];
    allFerRows.forEach(e=>{const orario=(e.tipo==='Permesso/ROL'&&e.oraInizio&&e.oraFine)?e.oraInizio+'–'+e.oraFine:'';fd.push([e.user,getLeadForMember(e.user),e.tipo,fmt(e.start),fmt(e.end),wDays(e.start,e.end),orario,e.note||'']);});
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(sd),'Riepilogo Ore');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(fd),'Ferie');
    console.log('[EXPORT] workbook built, sd rows=',sd.length,'fd rows=',fd.length);
    const buf=XLSX.write(wb,{bookType:'xlsx',type:'array'});
    const blob=new Blob([new Uint8Array(buf)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.style.display='none';a.href=url;a.download=`TeamHours_${MONTHS[month]}_${year}.xlsx`;
    document.body.appendChild(a);
    console.log('[EXPORT] clicking download link, url=',url);
    a.click();
    setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},1500);
    exportOk('File scaricato');
  }catch(err){console.error('[EXPORT] error',err);exportErr('Errore: '+err.message);}
  finally{hideSpinner();}
}
async function exportICS(){
  const _me=RESOURCES.find(x=>x.fullName===currentUser);
  const mine=_me?(_read(K_FER,[])||[]).filter(f=>f.risorsaId===_me.id).map(f=>({start:f.start,end:f.end,tipo:f.tipo,note:f.note,id:f.id})):[];
  if(!mine.length){alert('Nessuna ferie da esportare.');return;}
  const fi=ds=>ds.replace(/-/g,'');
  let ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TeamHoursTracker//IT\r\n';
  mine.forEach(e=>{const ed=new Date(e.end+'T12:00:00');ed.setDate(ed.getDate()+1);ics+=`BEGIN:VEVENT\r\nSUMMARY:${e.tipo}${e.note?' - '+e.note:''}\r\nDTSTART;VALUE=DATE:${fi(e.start)}\r\nDTEND;VALUE=DATE:${fi(localDate(ed))}\r\nUID:${e.id}@tht\r\nEND:VEVENT\r\n`;});
  ics+='END:VCALENDAR';
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([ics],{type:'text/calendar'}));a.download=`ferie_${currentUser.split(' ')[0]}.ics`;a.click();
}
async function exportBackup(){
  const data={ts:new Date().toISOString(),app:'TeamHoursTracker',v:1,res:_read(K_RES,[])||[],prj:_read(K_PRJ,[])||[],hrs:_read(K_HRS,[])||[],fer:_read(K_FER,[])||[],rep:_read(K_REP,[])||[]};
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=`TeamHours_backup_${new Date().toISOString().slice(0,10)}.json`;a.click();
}
async function importBackup(event){if(event&&event.target)event.target.value='';alert('Ripristino da file disabilitato.\n\nI dati sono sul database condiviso: usa gli snapshot / PITR dalla console Neon.');}
