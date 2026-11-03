// Admin: aree dei progetti e soglie ticket / Extra Effort
// ── ADMIN: gestione aree ──
function renderAreaList(){
  const el=document.getElementById('areaList');if(!el)return;
  const prjs=(_cache.prj||[]).slice().sort();
  const prjOpts=[{v:'',l:'— Seleziona —'},...prjs.map(p=>({v:_prjIdByName[p],l:p}))];
  popSel('newAreaPrj',prjOpts,document.getElementById('newAreaPrj')?.value||'');
  const resSorted=RESOURCES.slice().sort((a,b)=>a.fullName.localeCompare(b.fullName,'it'));
  popSel('newAreaTL',[{v:'',l:'— Nessuno —'},...resSorted.map(r=>({v:r.id,l:r.fullName}))],document.getElementById('newAreaTL')?.value||'');
  const withAree=prjs.filter(p=>_cache.aree.some(a=>a.progettoId===_prjIdByName[p]));
  if(!withAree.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessuna area configurata.</p>';return;}
  el.innerHTML=withAree.map(p=>{
    const pid=_prjIdByName[p];
    return `<div class="lead-group-head">${_esc(p)}</div>`+_cache.aree.filter(a=>a.progettoId===pid).map(a=>`<div class="resource-row" style="flex-wrap:wrap">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1">
        <input type="text" value="${_esc(a.nome)}" style="max-width:200px;padding:5px 9px;font-size:.84rem;background:var(--white)" onkeydown="if(event.key==='Enter')this.blur()" onchange="updateArea(${a.id},{nome:this.value})" aria-label="Nome area"/>
        <select style="max-width:170px;padding:5px 8px;font-size:.8rem;background:var(--white)" onchange="updateArea(${a.id},{progettoId:+this.value})" aria-label="Progetto">${prjs.map(x=>`<option value="${_prjIdByName[x]}"${_prjIdByName[x]===pid?' selected':''}>${_esc(x)}</option>`).join('')}</select>
        <select style="max-width:190px;padding:5px 8px;font-size:.8rem;background:var(--white)" onchange="updateArea(${a.id},{teamLeadId:this.value?+this.value:null})" aria-label="Team Lead"><option value="">— Nessun Team Lead —</option>${resSorted.map(r=>`<option value="${r.id}"${r.id===a.teamLeadId?' selected':''}>${_esc(r.fullName)}</option>`).join('')}</select>
        <label class="mgr-check-label" style="margin:0;text-transform:none;letter-spacing:0"><input type="checkbox" ${a.attiva?'checked':''} onchange="updateArea(${a.id},{attiva:this.checked})"/> Attiva</label>
      </div>
      <div class="resource-actions"><button class="btn-icon danger" title="Elimina area" onclick="deleteAreaUI(${a.id})"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button></div>
    </div>`).join('');
  }).join('');
}
async function addArea(){
  const progettoId=+document.getElementById('newAreaPrj').value,nome=document.getElementById('newAreaNome').value.trim(),tl=document.getElementById('newAreaTL').value;
  if(!progettoId||!nome){showMsg('areaMsg','Progetto e nome area obbligatori.','err');return;}
  showSpinner();try{await call('saveArea',{progettoId,nome,teamLeadId:tl?+tl:null,attiva:true});await reloadAll();}catch(e){hideSpinner();showMsg('areaMsg','Errore: '+e.message,'err');return;}hideSpinner();
  document.getElementById('newAreaNome').value='';renderAreaList();renderSoglieList();showMsg('areaMsg','Area "'+nome+'" aggiunta.','ok');
}
async function updateArea(id,changes){
  const a=_cache.aree.find(x=>x.id===id);if(!a)return;
  const next={...a,...changes};
  if(!String(next.nome||'').trim()){renderAreaList();showMsg('areaMsg','Il nome area non può essere vuoto.','err');return;}
  showSpinner();try{await call('saveArea',{id,progettoId:next.progettoId,nome:next.nome,teamLeadId:next.teamLeadId,attiva:next.attiva});await reloadAll();}catch(e){hideSpinner();renderAreaList();showMsg('areaMsg','Errore: '+e.message,'err');return;}hideSpinner();
  renderAreaList();renderSoglieList();showMsg('areaMsg','Area aggiornata.','ok');
}
function deleteAreaUI(id){
  const a=_cache.aree.find(x=>x.id===id);if(!a)return;
  openModal('Elimina area','Eliminare l\'area "'+a.nome+'"? Se ha già ticket o Extra Effort registrati non potrà essere eliminata: disattivala per conservarne lo storico.',async()=>{
    showSpinner();try{await call('deleteArea',{id});await reloadAll();}catch(e){hideSpinner();showMsg('areaMsg',e.message,'err');return;}hideSpinner();
    renderAreaList();renderSoglieList();showMsg('areaMsg','Area eliminata.','ok');
  },'Elimina');
}
// ── ADMIN: soglie ticket ed Extra Effort (progetto, oppure per area se il progetto ha più aree) ──
function renderSoglieList(){
  const el=document.getElementById('soglieList');if(!el)return;
  const prjs=(_cache.prj||[]).slice().sort();
  if(!prjs.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessun progetto.</p>';return;}
  const row=(pid,aid,label,sub)=>{const s=_thrCfg(pid,aid),id=`${pid}-${aid||0}`;return `<tr>
    <td>${sub?`<span style="padding-left:14px;color:var(--ink-2)">↳ ${_esc(label)}</span>`:`<b>${_esc(label)}</b>`}</td>
    <td><input type="number" min="1" step="1" id="sgIn-${id}" value="${s&&s.soglia!=null?s.soglia:''}" placeholder="—" style="max-width:90px;padding:5px 8px" aria-label="Soglia ticket ${_esc(label)}"/></td>
    <td><input type="number" min="0.25" step="0.25" id="sgEe-${id}" value="${s&&s.sogliaEe!=null?s.sogliaEe:''}" placeholder="—" style="max-width:90px;padding:5px 8px" aria-label="Soglia Extra Effort ${_esc(label)}"/></td>
    <td><input type="checkbox" id="sgOn-${id}" ${!s||s.attiva?'checked':''} style="accent-color:var(--amber);width:15px;height:15px" aria-label="Soglie attive"/></td>
    <td><input type="text" id="sgTo-${id}" value="${_esc(s?s.destinatari:'')}" placeholder="email1@..., email2@..." style="min-width:220px;padding:5px 8px"/></td>
    <td style="white-space:nowrap"><button class="btn btn-ink btn-sm" onclick="saveSogliaAdmin(${pid},${aid||0})"><i class="fa-solid fa-floppy-disk"></i> Salva</button> ${s?`<button class="btn-icon danger" title="Rimuovi soglie" onclick="removeThr(${pid},${aid||0})"><i class="fa-solid fa-trash-can" style="font-size:.72rem"></i></button>`:''}</td>
  </tr>`;};
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Progetto / Area</th><th>Soglia ticket</th><th>Soglia Extra Effort (h)</th><th>Attiva</th><th>Destinatari aggiuntivi (CC)</th><th></th></tr></thead><tbody>${prjs.map(p=>{
    const pid=_prjIdByName[p],multi=_isMultiArea(pid);
    return row(pid,null,multi?p+' — complessiva (facoltativa)':p)+(multi?_prjAree(pid).sort((a,b)=>a.nome.localeCompare(b.nome,'it')).map(a=>row(pid,a.id,a.nome+(a.attiva?'':' (non attiva)'),true)).join(''):'');
  }).join('')}</tbody></table></div>`;
}
async function saveSogliaAdmin(pid,aid){
  aid=aid||null;
  const id=`${pid}-${aid||0}`,a=aid?_cache.aree.find(x=>x.id===aid):null,nome=(_prjNameById[pid]||'')+(a?' / '+a.nome:'');
  const tk=_thrInput(document.getElementById('sgIn-'+id)?.value,true),ee=_thrInput(document.getElementById('sgEe-'+id)?.value,false);
  if(tk.bad){showMsg('soglieMsg','La soglia ticket deve essere un numero intero maggiore di zero.','err');return;}
  if(ee.bad){showMsg('soglieMsg','La soglia Extra Effort deve essere un numero di ore maggiore di zero.','err');return;}
  if(tk.v==null&&ee.v==null){showMsg('soglieMsg',nome+': inserisci almeno una soglia oppure usa il cestino per rimuoverle.','err');return;}
  const attiva=!!document.getElementById('sgOn-'+id)?.checked,destinatari=document.getElementById('sgTo-'+id)?.value||'';
  const bad=destinatari.split(/[,;\s]+/).filter(Boolean).filter(e=>!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if(bad.length){showMsg('soglieMsg','Email non valide: '+bad.join(', '),'err');return;}
  showSpinner();let res;try{res=await call('saveSoglia',{progettoId:pid,areaId:aid,soglia:tk.v,sogliaEe:ee.v,attiva,destinatari});await reloadAll();}catch(e){hideSpinner();showMsg('soglieMsg','Errore: '+e.message,'err');return;}hideSpinner();
  renderSoglieList();showMsg('soglieMsg',nome+': '+(attiva?_sogliaCheckMsg(res):'soglie salvate (disattivate).'),(res?.checks||[]).some(c=>c.status==='alert_failed')?'err':'ok');
}
