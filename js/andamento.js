// Andamento progetto: elenco, dettaglio, soglie, FTE erogati
// ANDAMENTO PROGETTO
// Serie L1/L2/L3: colori validati (dataviz) + forma del marker come codifica secondaria.
// Il Totale è una somma, non una categoria: linea neutra in inchiostro con marker a rombo.
const TK_LV=[{k:'l1',l:'L1',c:'#6D28D9',m:'circle'},{k:'l2',l:'L2',c:'#1f6fc9',m:'square'},{k:'l3',l:'L3',c:'#d95926',m:'triangle'}];
const TK_TOT={k:'totale',l:'Totale',c:'#3D3D3D',m:'diamond',tot:true};
const EE_C='#6D28D9',EE_C_HOVER='#5B21B6',THR_C='#BE123C';
function _fmtNum(n){return Number(n).toLocaleString('it-IT');}
function _r2(n){return Math.round(Number(n)*100)/100;}
function _fmtOre(n){return _r2(n).toLocaleString('it-IT',{maximumFractionDigits:2})+' h';}
function _fmtU(n,u){return _r2(n).toLocaleString('it-IT',{maximumFractionDigits:2})+' '+u;}
function _fmtMd(n){return _fmtU(n,'MD');}
function _fmtPct(v){return v==null?'—':v.toLocaleString('it-IT',{maximumFractionDigits:1})+'%';}
function _me(){return isAdmin?null:(RESOURCES.find(r=>r.fullName===currentUser)||null);}
function _myAree(){const me=_me();return me?_cache.aree.filter(a=>a.teamLeadId===me.id&&a.attiva):[];}
function _prjAree(pid){return _cache.aree.filter(a=>a.progettoId===pid);}
// Progetto con più aree: soglie e dati gestiti a livello di area
function _isMultiArea(pid){return _prjAree(pid).length>1;}
// Progetti in cui la risorsa è coinvolta: staffata (allocazione) o Team Lead (di progetto o di un'area)
function _andInvolvedIds(){
  const me=_me(),ids=new Set();if(!me)return ids;
  (me.progetti||[]).forEach(p=>ids.add(_prjIdByName[p]));
  Object.entries(_prjTLsByName).forEach(([p,tls])=>{if(tls.includes(currentUser))ids.add(_prjIdByName[p]);});
  _cache.aree.filter(a=>a.teamLeadId===me.id).forEach(a=>ids.add(a.progettoId));
  return ids;
}
// Progetti visibili in Andamento: quelli in cui si è coinvolti e, per il Manager, quelli delle sue risorse.
// L'admin vede tutti i progetti. Il dettaglio mostra sempre l'intero progetto.
function _andProjectIds(){
  const ids=isAdmin?new Set((_cache.prj||[]).map(p=>_prjIdByName[p])):_andInvolvedIds();
  if(!isAdmin&&isTeamLead)_getManagerProjects().forEach(p=>ids.add(_prjIdByName[p]));
  return[...ids].filter(pid=>_prjNameById[pid]).sort((a,b)=>_prjNameById[a].localeCompare(_prjNameById[b],'it'));
}
// Sola lettura: progetto visibile al Manager tramite le sue risorse, senza esserne coinvolto direttamente
function _andReadOnly(pid){return !isAdmin&&!_andInvolvedIds().has(pid);}
function _andProjects(){return _andProjectIds().map(pid=>_prjNameById[pid]);}
// Soglia di progetto modificabile da: admin, TL del progetto, TL di un'area del progetto, manager con risorse sul progetto
function _canEditSoglia(prj){
  if(isAdmin)return true;
  const me=_me();if(!me)return false;
  const pid=_prjIdByName[prj];
  if((_prjTLsByName[prj]||[]).includes(currentUser))return true;
  if(_cache.aree.some(a=>a.progettoId===pid&&a.teamLeadId===me.id))return true;
  return isTeamLead&&_getManagerProjects().includes(prj);
}
// Soglia d'area modificabile da: admin, TL dell'area, TL del progetto, manager con risorse sul progetto
function _canEditAreaSoglia(a){
  if(isAdmin)return true;
  const me=_me();if(!me)return false;
  const prj=_prjNameById[a.progettoId];
  return a.teamLeadId===me.id||(_prjTLsByName[prj]||[]).includes(currentUser)||(isTeamLead&&_getManagerProjects().includes(prj));
}
// Aree su cui l'utente può inserire dati: tutte quelle attive dei progetti di cui fa parte
// (staffato, TL del progetto o di un'area). Il Manager non inserisce dati.
function _andEditableAree(pid){
  if(!_me()||isTeamLead||!_andInvolvedIds().has(pid))return[];
  return _prjAree(pid).filter(a=>a.attiva);
}
let _andSel={pid:null,areaId:null},_andData=null,_andCharts=[],_andEntryPid=null,_andEeMode=S.get('andEeMode')==='n'?'n':'ore';
const _AND_EMPTY=Object.freeze({l1:0,l2:0,l3:0,totale:0,giorni:0,ultimo:null,ee:0,een:0,cr:0,crn:0,tk:false});
// Indice dei dati per progetto|area|mese ('*' = somma di tutte le aree del progetto)
function _andBuild(d){
  const m={};
  const add=(r,f)=>{const key=r.anno+'-'+r.mese;[r.area_id,'*'].forEach(a=>{const k=`${r.progetto_id}|${a}|${key}`;f(m[k]||(m[k]={..._AND_EMPTY}));});};
  d.tickets.forEach(r=>add(r,z=>{TK_LV.forEach(s=>{z[s.k]+=r[s.k];});z.totale+=r.totale;z.giorni+=r.giorni;z.tk=true;if(!z.ultimo||r.ultimo>z.ultimo)z.ultimo=r.ultimo;}));
  d.ee.forEach(r=>add(r,z=>{z.ee=_r2(z.ee+r.ore);z.een+=r.n;}));
  (d.cr||[]).forEach(r=>add(r,z=>{z.cr=_r2(z.cr+r.md);z.crn+=r.n;}));
  return(pid,aid,y,mo)=>m[`${pid}|${aid==null?'*':aid}|${y}-${mo}`]||_AND_EMPTY;
}
// % L1/L2/L3 sul totale del mese, a 1 decimale con il metodo del resto maggiore: la somma è sempre 100
function _lvPct(r){
  if(!r.totale)return null;
  const raw=TK_LV.map(s=>r[s.k]*1000/r.totale),fl=raw.map(Math.floor);
  let rest=1000-fl.reduce((a,b)=>a+b,0);
  raw.map((v,i)=>[v-fl[i],i]).sort((a,b)=>b[0]-a[0]).forEach(([,i])=>{if(rest>0){fl[i]++;rest--;}});
  return fl.map(v=>v/10);
}
// Aree mostrate nel dettaglio: attive o con dati nel mese selezionato
function _andAree(pid){
  const D=_andData;
  return _prjAree(pid).filter(a=>{const r=D.get(pid,a.id,D.year,D.month);return a.attiva||r.tk||r.een||r.crn;}).sort((a,b)=>a.nome.localeCompare(b.nome,'it'));
}
// Elenco progetti (pagina iniziale) oppure dettaglio del progetto selezionato
async function renderAndamento(){
  const el=document.getElementById('andamentoContent');if(!el)return;
  const prjs=_andProjectIds();
  if(_andSel.pid&&!prjs.includes(_andSel.pid))_andSel={pid:null,areaId:null};
  const pid=_andSel.pid,fc=document.getElementById('andFilters'),mf=document.getElementById('andMesiField');
  // Mese/anno anche nell'elenco (FTE e soglie del mese); il periodo del grafico serve solo nel dettaglio
  if(fc)fc.style.display=prjs.length?'':'none';
  if(mf)mf.style.display=pid?'':'none';
  _andNavOpts(prjs);
  const month=+document.getElementById('andMonth').value,year=+document.getElementById('andYear').value,n=+document.getElementById('andMesi').value;
  if(!pid){
    _andData=null;_andCharts=[];_andEntryInit(null);
    // Warning soglie in elenco: totali del mese selezionato per tutti i progetti, in una sola chiamata
    let warn={},get=null;
    if(prjs.length){
      showSpinner();
      try{const d=await call('getAndamento',{scope:prjs.map(p=>({progettoId:p,areaIds:null})),anno:year,mese:month,mesi:1});get=_andBuild(d);warn=_andWarnings(prjs,get,year,month);}
      catch(e){console.error(e);}
      hideSpinner();
    }
    if(_andSel.pid)return;
    el.innerHTML=_andListHtml(prjs,warn,MONTHS[month]+' '+year,get&&(pid=>get(pid,null,year,month)));return;
  }
  showSpinner();let d;
  try{d=await call('getAndamento',{scope:[{progettoId:pid,areaIds:null}],anno:year,mese:month,mesi:n});}
  catch(e){hideSpinner();el.innerHTML=`<div class="msg err">Errore: ${_esc(e.message)}</div>`;return;}
  hideSpinner();
  _andData={d,pid,year,month,n,get:_andBuild(d),lbl:MONTHS[month]+' '+year};
  if(_andSel.areaId&&!_andAree(pid).some(a=>a.id===_andSel.areaId))_andSel.areaId=null;
  _andNavOpts(prjs);
  _andDraw();
  if(_andEntryPid!==pid)_andEntryInit(pid);
}
function _andDraw(){
  const el=document.getElementById('andamentoContent');if(!el||!_andData)return;
  _andCharts=[];
  el.innerHTML=_andDetailHtml(_andSel.pid,_andSel.areaId);
  requestAnimationFrame(()=>_andCharts.forEach(c=>c.init(c)));
}
// ── navigazione: elenco progetti → progetto → area ──
function _andNavOpts(prjs){
  const o=[{v:'',l:'← Elenco progetti'}];
  prjs.forEach(pid=>{o.push({v:'p:'+pid,l:_prjNameById[pid]});if(_isMultiArea(pid))_prjAree(pid).filter(a=>a.attiva).sort((a,b)=>a.nome.localeCompare(b.nome,'it')).forEach(a=>o.push({v:`a:${pid}:${a.id}`,l:' ↳ '+a.nome}));});
  popSel('andNav',o,_andSel.pid?(_andSel.areaId?`a:${_andSel.pid}:${_andSel.areaId}`:'p:'+_andSel.pid):'');
}
function andNavChange(v){const[t,p,a]=String(v||'').split(':');andGo(t?+p:null,t==='a'?+a:null);}
function andGo(pid,aid){
  const same=!!pid&&_andData&&_andData.pid===pid;
  _andSel={pid:pid||null,areaId:aid||null};
  // Cambio area nello stesso progetto: basta ridisegnare (l'inserimento in fondo resta invariato)
  if(same){_andNavOpts(_andProjectIds());_andDraw();}
  else renderAndamento().catch(console.error);
  document.getElementById('panel-andamento')?.scrollIntoView({behavior:'smooth',block:'start'});
}
// Soglie raggiunte o superate nel mese, per progetto: soglia di progetto e soglie delle singole aree
function _andWarnings(prjs,get,y,m){
  const out={};
  prjs.forEach(pid=>{
    const list=[];
    [null,..._prjAree(pid).map(a=>a.id)].forEach(aid=>{
      const cfg=_thrCfg(pid,aid);if(!cfg)return;
      const r=get(pid,aid,y,m);
      ['ticket','ee'].forEach(k=>{
        const tot=k==='ee'?r.ee:r.totale,ev=_thrEval(cfg,k,tot);
        if(ev.st==='hit'||ev.st==='over')list.push({kind:k,area:aid?_cache.aree.find(a=>a.id===aid)?.nome:null,st:ev.st,tot,soglia:ev.soglia});
      });
    });
    if(list.length)out[pid]=list;
  });
  return out;
}
function _andListHtml(prjs,warn,lbl,monthOf){
  if(!prjs.length)return '<div class="card"><p style="color:var(--ink-3);text-align:center;padding:24px 0">Non risulti staffato su alcun progetto.</p></div>';
  const me=_me();warn=warn||{};
  const wTxt=w=>{const K=_THR_KIND[w.kind];return `${w.kind==='ee'?'Extra Effort':'Ticket'}${w.area?` (${_esc(w.area)})`:''} ${w.st==='over'?'superata':'raggiunta'}: ${K.n(w.tot)} / ${K.n(w.soglia)}`;};
  const row=(pid,f,st)=>{
    const p=_prjNameById[pid],aree=_prjAree(pid).filter(a=>a.attiva).sort((a,b)=>a.nome.localeCompare(b.nome,'it')),tls=_prjTLsByName[p]||[];
    const role=!me?'':tls.includes(currentUser)?'Team Lead del progetto':aree.some(a=>a.teamLeadId===me.id)?'Team Lead d\'area':_andReadOnly(pid)?'Manager · sola lettura':'';
    const w=warn[pid],G=st?_AND_GRP[st]:null;
    return `<div class="and-list-row" role="link" tabindex="0" onclick="andGo(${pid})" onkeydown="if(event.key==='Enter')andGo(${pid})">
      ${G?`<span class="and-st and-st-${st}" aria-hidden="true"><i class="fa-solid ${G.ic}"></i></span>`:''}
      <div style="min-width:0;flex:1"><div class="and-list-name">${G?'':'<i class="fa-solid fa-folder-open"></i> '}${_esc(p)}${f?_fteBoxes(f,lbl):''}${w?` <span class="badge badge-danger and-warn" title="${w.map(wTxt).join(' · ')}"><i class="fa-solid fa-triangle-exclamation" style="margin-right:4px"></i>Warning soglie</span>`:''}${role?` <span class="badge badge-amber">${role}</span>`:''}</div>
        ${G?`<div class="and-st-txt and-st-txt-${st}">${_andStTxt(f,st)}</div>`:''}
        <div class="and-list-meta">${aree.length?`${aree.length} ${aree.length>1?'aree':'area'}: ${aree.map(a=>_esc(a.nome)).join(', ')}`:'Nessuna area configurata'} · Team Lead: ${tls.length?tls.map(_esc).join(', '):'—'}</div>
        ${w?`<div class="and-list-warn"><i class="fa-solid fa-triangle-exclamation"></i> Soglia ${w.map(wTxt).join(' · ')}</div>`:''}</div>
      <button class="btn btn-ink btn-sm" onclick="event.stopPropagation();andGo(${pid})">Apri dettaglio <i class="fa-solid fa-arrow-right" style="margin-left:4px"></i></button>
    </div>`;};
  const title=`<div class="card-title"><i class="fa-solid fa-folder-tree"></i> ${isAdmin?'Progetti':'I tuoi progetti'} <span style="color:var(--ink-3);font-weight:600;font-size:.78rem">· soglie e FTE di ${lbl}</span></div>`;
  // Dati del mese non disponibili: elenco semplice in ordine alfabetico
  if(!monthOf)return `<div class="card">${title}<div class="and-list">${prjs.map(pid=>row(pid,null,null)).join('')}</div></div>`;
  // Gruppi: prima i progetti da verificare (FTE erogati ≥ FTE progetto, dal più sforato), poi quelli in linea
  const grp={check:[],ok:[],none:[]};
  prjs.forEach(pid=>{const f=_fteOf(pid,monthOf(pid));grp[_andFteSt(f)].push({pid,f});});
  grp.check.sort((a,b)=>(b.f.erog-b.f.tot)-(a.f.erog-a.f.tot));
  return `<div class="card">${title}${['check','ok','none'].filter(k=>grp[k].length).map(k=>
    `<div class="and-grp-hd and-grp-${k}"><span class="and-grp-dot"></span>${_AND_GRP[k].l} · ${grp[k].length}</div><div class="and-list">${grp[k].map(x=>row(x.pid,x.f,k)).join('')}</div>`).join('')}</div>`;
}
const _AND_GRP={check:{l:'Da verificare',ic:'fa-xmark'},ok:{l:'In linea',ic:'fa-check'},none:{l:'FTE progetto non configurati',ic:'fa-minus'}};
// Da verificare quando gli FTE erogati raggiungono o superano gli FTE progetto (confronto a 2 decimali)
function _andFteSt(f){return f.tot==null?'none':f.over?'check':'ok';}
function _andStTxt(f,st){
  if(st==='none')return 'Configura gli FTE venduti TOT in Benchmark';
  const d=_r2(_r2(f.erog)-_r2(f.tot)),pct=f.tot?Math.round(Math.abs(d)/f.tot*100):null,p=pct!=null?` (${d>0?'+':'−'}${pct}%)`:'';
  if(st==='check')return d>0?`Sopra di ${_fmtFte(d)} FTE${p}`:'Pari agli FTE progetto';
  return `In linea · margine di ${_fmtFte(-d)} FTE${p}`;
}
// ── inserimento manuale in fondo al dettaglio: per area, ticket del giorno + attività di Extra Effort ──
function _andEntryInit(pid){
  const box=document.getElementById('andEntry');if(!box)return;
  _andEntryPid=pid;
  // Il Manager vede l'andamento ma non inserisce dati
  if(!pid||_andReadOnly(pid)||isTeamLead){box.innerHTML='';return;}
  const head=`<div class="card-title"><i class="fa-solid fa-pen-to-square"></i> Inserimento manuale — ticket ed Extra Effort</div>
    <p style="font-size:.8rem;color:var(--ink-3);margin:-8px 0 14px">Per ogni area: numero di ticket aperti nel giorno (L1, L2, L3) e attività di Extra Effort, indicando la tipologia: attività extra in ore oppure CR da scalare a Plafond in MD (Man Day).</p>`;
  const msg=t=>`<div class="card">${head}<p style="font-size:.84rem;color:var(--ink-3)"><i class="fa-solid fa-circle-info" style="margin-right:6px"></i>${t}</p></div>`;
  if(!_prjAree(pid).some(a=>a.attiva)){box.innerHTML=msg('Nessuna area attiva configurata per questo progetto: l\'amministratore può crearle in Admin › Gestione aree.');return;}
  if(!_me()||!_andEditableAree(pid).length){box.innerHTML=msg('L\'inserimento è riservato alle risorse del progetto.');return;}
  const y=new Date();y.setDate(y.getDate()-1);
  box.innerHTML=`<div class="card">${head}
    <div class="field-row"><div class="field" style="max-width:170px"><label>Data di riferimento</label><input type="date" id="andTicketDate" value="${localDate(y)}" max="${localDate(new Date())}" onchange="loadTicketDay().catch(console.error)"/></div></div>
    <div id="andTicketForm"></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-ink" onclick="saveTicketDay()"><i class="fa-solid fa-floppy-disk"></i> Salva ticket ed Extra Effort</button>
      <div id="andTicketMsg" class="msg"></div>
    </div></div>`;
  loadTicketDay().catch(console.error);
}
// ── soglie ──
function _thrCfg(pid,aid){return aid?_cache.soglieArea[aid]:_cache.soglie[pid];}
// Stato soglia: 'none' | 'off' | 'ok' | 'near' | 'hit' | 'over'
function _thrEval(cfg,kind,tot){
  const v=cfg?(kind==='ee'?cfg.sogliaEe:cfg.soglia):null;
  if(!v)return{st:'none'};
  if(!cfg.attiva)return{st:'off',soglia:v};
  const t=_r2(tot),pct=t/v*100;
  return{st:t>v?'over':t===v?'hit':pct>=80?'near':'ok',soglia:v,pct};
}
function _thrActive(ev){return['ok','near','hit','over'].includes(ev.st);}
const _THR_KIND={ticket:{l:'ticket',u:v=>_fmtNum(v)+' ticket',n:v=>_fmtNum(v)},ee:{l:'Extra Effort',u:_fmtOre,n:_fmtOre}};
function _andAlert(kind,pid,aid,soglia){
  return(_andData?.d.alert||[]).find(a=>a.kind===kind&&+a.progetto_id===pid&&(a.area_id==null?null:+a.area_id)===(aid||null)&&+a.soglia===+soglia&&a.stato==='sent')||null;
}
function _thrBadge(ev,kind){
  const K=_THR_KIND[kind].l;
  if(ev.st==='over')return `<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation" style="margin-right:5px"></i>Soglia ${K} superata</span>`;
  if(ev.st==='hit')return `<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation" style="margin-right:5px"></i>Soglia ${K} raggiunta</span>`;
  if(ev.st==='near')return `<span class="badge badge-warn"><i class="fa-solid fa-circle-exclamation" style="margin-right:5px"></i>Vicino alla soglia ${K}</span>`;
  return '';
}
// Badge di stato di uno scope (progetto o area)
function _andBadges(pid,aid,r){
  const cfg=_thrCfg(pid,aid);
  return _thrBadge(_thrEval(cfg,'ticket',r.totale),'ticket')+_thrBadge(_thrEval(cfg,'ee',r.ee),'ee');
}
function _thrMeter(ev,kind,tot,lbl,alert){
  const K=_THR_KIND[kind];
  if(ev.st==='none')return `<div class="thr thr-none"><i class="fa-solid fa-gauge" style="margin-right:5px"></i>Nessuna soglia ${K.l} configurata</div>`;
  if(ev.st==='off')return `<div class="thr thr-none"><i class="fa-solid fa-pause" style="margin-right:5px"></i>Soglia ${K.l} di ${K.u(ev.soglia)} disattivata</div>`;
  const cls=ev.st==='ok'?'thr-ok':ev.st==='near'?'thr-warn':'thr-danger';
  const icon=ev.st==='ok'?'fa-circle-check':ev.st==='near'?'fa-circle-exclamation':'fa-triangle-exclamation';
  const msg=ev.st==='over'?`Soglia ${K.l} superata di ${K.u(_r2(tot-ev.soglia))}`:ev.st==='hit'?`Soglia ${K.l} raggiunta`:`${ev.pct.toFixed(1).replace('.',',').replace(',0','')}% della soglia ${K.l}`;
  return `<div class="thr ${cls}"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px"><span style="font-weight:600"><i class="fa-solid ${icon}" style="margin-right:5px"></i>${msg}</span><b style="font-variant-numeric:tabular-nums;white-space:nowrap">${K.n(tot)} / ${K.n(ev.soglia)}</b></div>
    <div class="thr-bar"><i style="width:${Math.min(100,ev.pct)}%"></i></div>
    <div style="font-size:.7rem;opacity:.85">Soglia mensile ${lbl}${alert?` · <i class="fa-solid fa-envelope" style="margin:0 3px"></i>alert inviato il ${alert.quando}`:''}</div></div>`;
}
function _andThrMeters(pid,aid,r){
  const cfg=_thrCfg(pid,aid),D=_andData;
  if(!aid&&_isMultiArea(pid)&&!cfg)return `<div class="thr thr-none"><i class="fa-solid fa-sitemap" style="margin-right:5px"></i>Progetto con più aree: le soglie si gestiscono per singola area</div>`;
  return['ticket','ee'].map(k=>{const tot=k==='ee'?r.ee:r.totale,ev=_thrEval(cfg,k,tot);return _thrMeter(ev,k,tot,D.lbl,ev.soglia!=null?_andAlert(k,pid,aid,ev.soglia):null);}).join('');
}
// Indicatore compatto per le tabelle (icona + testo: lo stato non è affidato al solo colore)
function _thrPill(cfg,kind,tot){
  const ev=_thrEval(cfg,kind,tot);if(ev.st==='none')return '';
  const K=_THR_KIND[kind],cls=ev.st==='off'?'':ev.st==='ok'?'badge-ok':ev.st==='near'?'badge-warn':'badge-danger';
  const ic=ev.st==='over'||ev.st==='hit'?'<i class="fa-solid fa-triangle-exclamation" style="margin-right:4px"></i>':'';
  return `<span class="badge ${cls} and-pill" title="Soglia ${K.l}${ev.st==='off'?' (disattivata)':''}">${ic}${kind==='ee'?'EE':'Ticket'} ${K.n(tot)} / ${K.n(ev.soglia)}</span>`;
}
function _thrEditor(pid,aid){
  const cfg=_thrCfg(pid,aid),id=`${pid}-${aid||0}`;
  return `<div class="thr-edit">
      <label class="thr-f"><span>Soglia ticket / mese</span><input type="number" min="1" step="1" id="thrTk-${id}" value="${cfg&&cfg.soglia!=null?cfg.soglia:''}" placeholder="es. 40"/></label>
      <label class="thr-f"><span>Soglia Extra Effort (h)</span><input type="number" min="0.25" step="0.25" id="thrEe-${id}" value="${cfg&&cfg.sogliaEe!=null?cfg.sogliaEe:''}" placeholder="es. 40"/></label>
    </div>
    <div class="thr-edit"><button class="btn btn-ink btn-sm" onclick="saveThr(${pid},${aid||0})"><i class="fa-solid fa-floppy-disk"></i> Salva soglie</button>
      ${cfg?`<button class="btn btn-ghost2 btn-sm" onclick="saveThr(${pid},${aid||0},${!cfg.attiva})">${cfg.attiva?'Disattiva':'Riattiva'}</button><button class="btn-icon danger" title="Rimuovi soglie" onclick="removeThr(${pid},${aid||0})"><i class="fa-solid fa-trash-can" style="font-size:.72rem"></i></button>`:''}
    </div><div id="thrMsg-${id}" class="msg" style="margin-top:8px"></div>`;
}
function _thrInput(raw,int){
  const v=String(raw??'').trim().replace(',','.');if(!v)return{v:null};
  const n=Number(v);if(!Number.isFinite(n)||n<=0||(int&&!Number.isInteger(n)))return{bad:true};
  return{v:int?n:_r2(n)};
}
function _sogliaCheckMsg(res){
  const cs=(res&&res.checks)||[],nm=l=>l.map(c=>_THR_KIND[c.kind]?.l||'ticket').join(' e ');
  const sent=cs.filter(c=>c.status==='alert_sent'),already=cs.filter(c=>c.status==='already_sent'),failed=cs.filter(c=>c.status==='alert_failed');
  let m='Soglie salvate.';
  if(sent.length)m+=` Il mese corrente supera già la soglia ${nm(sent)}: alert email inviato.`;
  if(already.length)m+=` Soglia ${nm(already)} già superata: alert per questo valore già inviato in precedenza.`;
  if(failed.length)m+=` Soglia ${nm(failed)} superata, ma invio alert non riuscito (${failed[0].reason||'errore'}): verrà ritentato al prossimo inserimento.`;
  return m;
}
async function saveThr(pid,aid,attiva){
  aid=aid||null;
  const id=`${pid}-${aid||0}`,me=_me(),cur=_thrCfg(pid,aid);
  const payload={progettoId:pid,areaId:aid,risorsaId:me?me.id:null};
  if(attiva===undefined){
    const tk=_thrInput(document.getElementById('thrTk-'+id)?.value,true),ee=_thrInput(document.getElementById('thrEe-'+id)?.value,false);
    if(tk.bad){showMsg('thrMsg-'+id,'La soglia ticket deve essere un numero intero maggiore di zero.','err');return;}
    if(ee.bad){showMsg('thrMsg-'+id,'La soglia Extra Effort deve essere un numero di ore maggiore di zero.','err');return;}
    if(tk.v==null&&ee.v==null){showMsg('thrMsg-'+id,'Inserisci almeno una soglia (ticket o Extra Effort).','err');return;}
    Object.assign(payload,{soglia:tk.v,sogliaEe:ee.v,attiva:cur?cur.attiva:true});
  }else payload.attiva=attiva;
  showSpinner();let res;
  try{res=await call('saveSoglia',payload);await reloadAll();}
  catch(e){hideSpinner();showMsg('thrMsg-'+id,'Errore: '+e.message,'err');return;}
  hideSpinner();await renderAndamento();if(isAdmin)renderSoglieList();
  showMsg('thrMsg-'+id,attiva===false?'Soglie disattivate.':_sogliaCheckMsg(res),(res?.checks||[]).some(c=>c.status==='alert_failed')?'err':'ok');
}
function removeThr(pid,aid){
  aid=aid||null;
  const a=aid?_cache.aree.find(x=>x.id===aid):null,nome=(_prjNameById[pid]||'')+(a?' / '+a.nome:'');
  openModal('Rimuovi soglie','Rimuovere le soglie mensili (ticket ed Extra Effort) di "'+nome+'"?',async()=>{
    showSpinner();try{await call('saveSoglia',{progettoId:pid,areaId:aid,soglia:null,sogliaEe:null});await reloadAll();}catch(e){hideSpinner();alert('Errore: '+e.message);return;}
    hideSpinner();if(document.getElementById('panel-andamento').classList.contains('active'))await renderAndamento();if(isAdmin)renderSoglieList();
  },'Rimuovi');
}
// ── viste ──
function _andKpis(r,noEe){
  const pc=_lvPct(r);
  return `<div class="and-kpis">
    ${TK_LV.map((s,i)=>`<div class="and-kpi"><small>${_mkSvg(s,10)}${s.l}</small><b>${_fmtNum(r[s.k])}</b><span>${_fmtPct(pc&&pc[i])}</span></div>`).join('')}
    <div class="and-kpi and-kpi-tot"><small>Totale ticket</small><b>${_fmtNum(r.totale)}</b><span>${r.totale?'100%':'—'}</span></div>
    ${noEe?'':`<div class="and-kpi and-kpi-ee"><small><i class="fa-solid fa-stopwatch"></i> Extra Effort</small><b>${_fmtOre(r.ee)}</b><span>${_fmtNum(r.een)} attività</span></div>
    <div class="and-kpi and-kpi-cr"><small><i class="fa-solid fa-file-signature"></i> CR da scalare a Plafond</small><b>${_fmtMd(r.cr)}</b><span>${_fmtNum(r.crn)} attività</span></div>`}
  </div>`;
}
function _andAreaTable(pid,aree){
  const D=_andData;
  return `<div class="and-areas"><div class="and-sum-title">Dettaglio per area — ${D.lbl}</div><div class="table-wrap"><table><thead><tr><th>Area</th><th>Team Lead</th>${TK_LV.map(s=>`<th class="and-num">${s.l}</th>`).join('')}<th class="and-num">Totale</th><th class="and-num">Extra Effort</th><th class="and-num">CR</th><th>Soglie</th><th class="and-num">Giorni inseriti</th><th>Ultimo</th><th></th></tr></thead><tbody>${aree.map(a=>{
    const r=D.get(pid,a.id,D.year,D.month),pc=_lvPct(r),cfg=_thrCfg(pid,a.id);
    const tl=a.teamLeadId?(RESOURCES.find(x=>x.id===a.teamLeadId)?.fullName||'—'):'—';
    const pills=_thrPill(cfg,'ticket',r.totale)+_thrPill(cfg,'ee',r.ee);
    return `<tr class="and-row-link" tabindex="0" onclick="andGo(${pid},${a.id})" onkeydown="if(event.key==='Enter')andGo(${pid},${a.id})" title="Apri il dettaglio dell'area">
      <td><b>${_esc(a.nome)}</b>${a.attiva?'':' <span class="badge badge-warn" style="font-size:.65rem">non attiva</span>'}</td>
      <td style="color:var(--ink-3)">${_esc(tl)}</td>
      ${TK_LV.map((s,i)=>`<td class="and-num">${_fmtNum(r[s.k])}<small class="and-pct">${_fmtPct(pc&&pc[i])}</small></td>`).join('')}
      <td class="and-num"><b>${_fmtNum(r.totale)}</b></td>
      <td class="and-num">${_fmtOre(r.ee)}<small class="and-pct">${_fmtNum(r.een)} att.</small></td>
      <td class="and-num">${_fmtMd(r.cr)}<small class="and-pct">${_fmtNum(r.crn)} att.</small></td>
      <td><div class="and-pills">${pills||'<span style="color:var(--ink-3)">—</span>'}</div></td>
      <td class="and-num">${r.giorni}</td>
      <td style="color:var(--ink-3);white-space:nowrap">${r.ultimo?fmt(r.ultimo):'—'}</td>
      <td style="white-space:nowrap"><span class="and-go">Dettaglio <i class="fa-solid fa-chevron-right"></i></span></td>
    </tr>`;}).join('')}</tbody></table></div></div>`;
}
function _andDetailHtml(pid,aid){
  const D=_andData,p=_prjNameById[pid],multi=_isMultiArea(pid),aree=_andAree(pid);
  const area=aid?_cache.aree.find(a=>a.id===aid):null;
  const scopeName=area?area.nome:multi?'Tutto il progetto':'';
  const periods=[];for(let i=D.n-1;i>=0;i--){let m=D.month-i,y=D.year;while(m<0){m+=12;y--;}periods.push({m,y});}
  const recs=periods.map(({m,y})=>D.get(pid,aid,y,m)),r=D.get(pid,aid,D.year,D.month);
  const cfg=_thrCfg(pid,aid),evTk=_thrEval(cfg,'ticket',r.totale),evEe=_thrEval(cfg,'ee',r.ee);
  const labels=periods.map(({m,y})=>MONTHS[m].slice(0,3)+' '+String(y).slice(2)),full=periods.map(({m,y})=>MONTHS[m]+' '+y);
  const sfx=`${pid}-${aid||0}`;
  const tk={id:'andCv-'+sfx,init:_initTicketChart,draw:_drawTicketChart,labels,full,has:recs.map(x=>x.tk),
    series:[...TK_LV,TK_TOT].map(s=>({...s,data:recs.map(x=>x[s.k])})),thr:_thrActive(evTk)?evTk.soglia:null};
  const ee={id:'andEe-'+sfx,ee:true,init:_initEeChart,draw:_drawEeChart,labels,full,ore:recs.map(x=>x.ee),cnt:recs.map(x=>x.een),thr:_thrActive(evEe)?evEe.soglia:null,mode:_andEeMode};
  // CR da scalare a Plafond: stesso grafico a barre dell'Extra Effort, in Man Day, senza soglia
  const cr={id:'andCr-'+sfx,init:_initEeChart,draw:_drawEeChart,labels,full,ore:recs.map(x=>x.cr),cnt:recs.map(x=>x.crn),thr:null,mode:'md',unit:'MD',vLabel:'MD (Man Day)'};
  _andCharts.push(tk,ee,cr);
  const crumb=`<nav class="and-crumb" aria-label="Percorso"><a href="#" onclick="andGo();return false"><i class="fa-solid fa-arrow-left"></i> ${isAdmin?'Progetti':'I tuoi progetti'}</a><span aria-hidden="true">›</span>${area?`<a href="#" onclick="andGo(${pid});return false">${_esc(p)}</a><span aria-hidden="true">›</span><b>${_esc(area.nome)}</b>`:`<b>${_esc(p)}</b>`}</nav>`;
  const tabs=multi&&aree.length?`<div class="and-tabs" role="tablist" aria-label="Aree del progetto"><button role="tab" aria-selected="${!aid}" class="${aid?'':'on'}" onclick="andGo(${pid})">Tutto il progetto</button>${aree.map(a=>`<button role="tab" aria-selected="${a.id===aid}" class="${a.id===aid?'on':''}" onclick="andGo(${pid},${a.id})">${_esc(a.nome)}</button>`).join('')}</div>`:'';
  const canEdit=area?_canEditAreaSoglia(area):_canEditSoglia(p);
  let editor='';
  if(canEdit)editor=!aid&&multi
    ?`<details class="thr-more"><summary>Soglia complessiva di progetto (facoltativa)</summary>${_thrEditor(pid,null)}</details>`
    :`<div class="and-sum-title" style="margin:14px 0 0">Configura soglie${area?' dell\'area':''}</div>${_thrEditor(pid,aid)}`;
  const sum=`<div class="and-sum">
      <div class="and-sum-title">${scopeName?_esc(scopeName)+' — ':''}${D.lbl}</div>
      ${_andKpis(r)}
      ${r.tk||r.een||r.crn?'':'<div style="font-size:.72rem;color:var(--ink-3);margin-top:6px"><i class="fa-regular fa-circle-question" style="margin-right:4px"></i>Nessun dato registrato nel mese</div>'}
      ${_andThrMeters(pid,aid,r)}
      ${editor}
    </div>`;
  const tableRows=periods.map(({m,y},i)=>{const x=recs[i],pc=_lvPct(x);return `<tr><td>${MONTHS[m]} ${y}</td>${x.tk?TK_LV.map(s=>`<td class="and-num">${_fmtNum(x[s.k])}</td>`).join('')+`<td class="and-num"><b>${_fmtNum(x.totale)}</b></td><td class="and-num">${pc?pc.map(_fmtPct).join(' · '):'—'}</td>`:'<td colspan="5" style="color:var(--ink-3);text-align:center">nessun dato</td>'}</tr>`;}).join('');
  const eeRows=periods.map(({m,y},i)=>`<tr><td>${MONTHS[m]} ${y}</td><td class="and-num">${_fmtNum(recs[i].een)}</td><td class="and-num">${_fmtOre(recs[i].ee)}</td></tr>`).join('');
  const crRows=periods.map(({m,y},i)=>`<tr><td>${MONTHS[m]} ${y}</td><td class="and-num">${_fmtNum(recs[i].crn)}</td><td class="and-num">${_fmtMd(recs[i].cr)}</td></tr>`).join('');
  // Attività del mese selezionato: 'extra' (ore) nella card Extra Effort, 'cr' (MD) nella card CR
  const areaName=id=>_cache.aree.find(a=>a.id===+id)?.nome||'—',showArea=!aid&&multi;
  const actsTable=(tipo,valHead,val,totLabel,tot,empty)=>{
    const acts=D.d.eeDettaglio.filter(e=>(e.tipo||'extra')===tipo&&+e.progetto_id===pid&&(!aid||+e.area_id===aid));
    return acts.length
      ?`<div class="table-wrap"><table><thead><tr><th>Data</th>${showArea?'<th>Area</th>':''}<th>Tipologia attività / Dettaglio</th><th class="and-num">${valHead}</th><th>Inserito da</th></tr></thead><tbody>${acts.map(e=>`<tr><td style="white-space:nowrap">${fmt(e.data)}</td>${showArea?`<td>${_esc(areaName(e.area_id))}</td>`:''}<td>${_esc(e.attivita)}</td><td class="and-num">${val(e)}</td><td style="color:var(--ink-3)">${_esc(e.inserito_da||'—')}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="${showArea?3:2}"><b>${totLabel} ${_esc(scopeName||p)}</b></td><td class="and-num"><b>${tot}</b></td><td></td></tr></tfoot></table></div>`
      :`<p style="font-size:.8rem;color:var(--ink-3)"><i class="fa-solid fa-circle-info" style="margin-right:5px"></i>${empty} in ${D.lbl}.</p>`;
  };
  const actsHtml=actsTable('extra','Extra Effort (ore)',e=>_fmtOre(e.ore),'Totale Extra Effort',_fmtOre(r.ee),'Nessuna attività di Extra Effort registrata');
  const crActsHtml=actsTable('cr','CR (MD)',e=>_fmtMd(e.md),'Totale CR',_fmtMd(r.cr),'Nessuna CR registrata');
  const seg=m=>`<button type="button" data-m="${m}" class="${_andEeMode===m?'on':''}" aria-pressed="${_andEeMode===m}" onclick="andEeMode('${m}')">${m==='n'?'Numero attività':'Ore'}</button>`;
  // Manager in sola lettura: solo i grafici e, sotto, gli elenchi delle attività
  const ro=_andReadOnly(pid);
  return `${crumb}
    <div class="card">
      <div class="and-head"><div class="card-title"><i class="fa-solid fa-folder-open"></i> ${_esc(p)}${area?` <span style="color:var(--ink-3);font-weight:600">/ ${_esc(area.nome)}</span>`:''}${_fteBoxes(_fteOf(pid,D.get(pid,null,D.year,D.month)),D.lbl)}</div><div class="and-badges">${ro?'<span class="badge badge-amber"><i class="fa-solid fa-eye" style="margin-right:4px"></i>Sola lettura</span>':''}${_andBadges(pid,aid,r)}</div></div>
      ${tabs}
      ${_andFteHtml(pid,periods)}
      ${ro?`<div class="and-ro-kpis"><div class="and-sum-title">Ticket ${scopeName?_esc(scopeName)+' — ':''}${D.lbl} · % sul totale del mese</div>${_andKpis(r,true)}</div>`:''}
      <div class="${ro?'':'and-grid'}">
        <div class="and-chart-wrap">
          <div class="and-sum-title">Andamento ticket — ultimi ${D.n} mesi</div>
          <canvas id="${tk.id}" role="img" aria-label="Andamento ticket L1, L2, L3 e totale di ${_esc(p)}${area?' / '+_esc(area.nome):''}"></canvas><div class="and-tip" id="${tk.id}-tip"></div>
          <div class="and-legend">${[...TK_LV,TK_TOT].map(s=>`<span>${_mkSvg(s,12,true)}${s.l}</span>`).join('')}${tk.thr?`<span>${_thrSwatch()}Soglia ${_fmtNum(tk.thr)}</span>`:''}<span style="color:var(--ink-3)">${_mkSvg({c:'#8C8C8C',m:'circle'},10,false,true)}mese senza dati</span></div>
          <details style="margin-top:10px"><summary style="font-size:.76rem;color:var(--ink-3);cursor:pointer">Mostra dati in tabella</summary><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Mese</th>${TK_LV.map(s=>`<th class="and-num">${s.l}</th>`).join('')}<th class="and-num">Totale</th><th class="and-num">% L1 · L2 · L3</th></tr></thead><tbody>${tableRows}</tbody></table></div></details>
        </div>
        ${ro?'':sum}
      </div>
    </div>
    ${ro?'':_andClsHtml(pid,aid,r,scopeName)}
    <div class="card">
      <div class="and-head"><div class="card-title"><i class="fa-solid fa-stopwatch"></i> Extra Effort${scopeName?` <span style="color:var(--ink-3);font-weight:600">— ${_esc(scopeName)}</span>`:''}</div>
        <div class="and-seg" role="group" aria-label="Metrica del grafico Extra Effort">${seg('n')}${seg('ore')}</div></div>
      <div class="and-chart-wrap">
        <canvas id="${ee.id}" class="and-ee-cv" role="img" aria-label="Extra Effort mensile di ${_esc(p)}${area?' / '+_esc(area.nome):''}"></canvas><div class="and-tip" id="${ee.id}-tip"></div>
        ${ee.thr?`<div class="and-legend"><span>${_thrSwatch()}Soglia ${_fmtOre(ee.thr)} (visibile in modalità Ore)</span></div>`:''}
        <details style="margin-top:10px"><summary style="font-size:.76rem;color:var(--ink-3);cursor:pointer">Mostra dati in tabella</summary><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Mese</th><th class="and-num">Attività</th><th class="and-num">Ore</th></tr></thead><tbody>${eeRows}</tbody></table></div></details>
      </div>
      ${_andActsBlock('ee',`Attività di Extra Effort — ${D.lbl}`,actsHtml)}
    </div>
    <div class="card">
      <div class="and-head"><div class="card-title"><i class="fa-solid fa-file-signature"></i> CR - Attività da scalare a Plafond${scopeName?` <span style="color:var(--ink-3);font-weight:600">— ${_esc(scopeName)}</span>`:''}</div></div>
      <div class="and-chart-wrap">
        <div class="and-sum-title">Man Day (MD) per mese — ultimi ${D.n} mesi</div>
        <canvas id="${cr.id}" class="and-ee-cv" role="img" aria-label="CR da scalare a Plafond, Man Day mensili di ${_esc(p)}${area?' / '+_esc(area.nome):''}"></canvas><div class="and-tip" id="${cr.id}-tip"></div>
        <details style="margin-top:10px"><summary style="font-size:.76rem;color:var(--ink-3);cursor:pointer">Mostra dati in tabella</summary><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Mese</th><th class="and-num">Attività</th><th class="and-num">MD</th></tr></thead><tbody>${crRows}</tbody></table></div></details>
      </div>
      ${_andActsBlock('cr',`CR da scalare a Plafond — ${D.lbl}`,crActsHtml)}
    </div>
    ${ro?_andClsHtml(pid,aid,r,scopeName):''}
    ${!ro&&!aid&&multi&&aree.length?`<div class="card">${_andAreaTable(pid,aree)}</div>`:''}`;
}
// ── FTE erogati vs FTE progetto (valori di riferimento dalla sezione Benchmark) ──
function _bench(pid){return _cache.benchmark[String(pid)]||{};}
function _fmtFte(n){return _r2(n).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2});}
// FTE erogati del mese, sempre sull'intero progetto:
//   Σ L1..L3 ((n·Tempo)·(Pyr/8))/21/Pyr + ((ore extra)·(Pyr/8))/21/Pyr + ((MD·8)·(240/8))/21/240
// Pyr si semplifica: ogni termine vale ore/8/21, cioè le ore erogate su 21 giorni da 8 h.
// FTE progetto = FTE venduti TOT del Benchmark; gli erogati diventano rossi quando lo raggiungono o superano.
function _fteOf(pid,r){
  const b=_bench(pid),t=k=>+b[k]||0;
  const ore=r.l1*t('tL1')+r.l2*t('tL2')+r.l3*t('tL3')+r.ee+r.cr*8;
  const erog=ore/8/21,tot=b.fteTot!=null?+b.fteTot:null;
  return{erog,tot,over:tot!=null&&_r2(erog)>=_r2(tot),noTempi:TK_LV.some(s=>r[s.k]>0&&!(+b['t'+s.l]>0))};
}
// Due box accanto al nome del progetto (elenco e dettaglio), sempre sull'intero progetto
function _fteBoxes(f,lbl){
  return `<span class="and-fte">
      <span class="and-fte-kpi${f.over?' over':''}" title="FTE erogati in ${lbl}${f.over?' — raggiungono o superano gli FTE progetto':''}"><small>FTE erogati</small><b>${f.over?'<i class="fa-solid fa-triangle-exclamation" style="font-size:.75rem;margin-right:4px"></i>':''}${_fmtFte(f.erog)}</b></span>
      <span class="and-fte-kpi" title="FTE venduti TOT (Benchmark)"><small>FTE progetto</small><b>${f.tot!=null?_fmtFte(f.tot):'—'}</b></span>
    </span>`;
}
// Sotto il nome: eventuale avviso di configurazione e tabella mensile degli FTE erogati
function _andFteHtml(pid,periods){
  const D=_andData,f=_fteOf(pid,D.get(pid,null,D.year,D.month));
  const note=f.tot==null?'FTE venduti TOT non configurati':f.noTempi?'Tempi L1/L2/L3 mancanti per alcuni ticket del mese':'';
  const rows=periods.map(({m,y})=>{const x=_fteOf(pid,D.get(pid,null,y,m));return `<tr><td>${MONTHS[m]} ${y}</td><td class="and-num${x.over?' fte-over':''}">${_fmtFte(x.erog)}</td><td class="and-num">${x.tot!=null?_fmtFte(x.tot):'—'}</td></tr>`;}).join('');
  return `${note?`<div class="and-fte-note"><i class="fa-solid fa-circle-info" style="margin-right:4px"></i>${note}: <a href="#" onclick="showTab('benchmark');return false">configura in Benchmark</a></div>`:''}
    <details style="margin:0 0 14px"><summary style="font-size:.76rem;color:var(--ink-3);cursor:pointer">FTE erogati per mese</summary><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Mese</th><th class="and-num">FTE erogati</th><th class="and-num">FTE progetto</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
