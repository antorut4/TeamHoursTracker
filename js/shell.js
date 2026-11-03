// Inizializzazione dei filtri, banner ore mancanti, navigazione tra le sezioni
// INIT
async function initApp(){
  const now=new Date(),mOpts=MONTHS.map((m,i)=>({v:i,l:m})),yOpts=[-1,0,1].map(d=>{const y=now.getFullYear()+d;return{v:y,l:y};});
  ['oreMonth','riepilogoMonth','ovMonth','adminFerMonth','ferieCalMonth','consuntivoMonth','andMonth','fteMonth'].forEach(id=>popSel(id,mOpts,now.getMonth()));
  ['oreYear','riepilogoYear','ovYear','adminFerYear','ferieCalYear','consuntivoYear','andYear','fteYear'].forEach(id=>popSel(id,yOpts,now.getFullYear()));
  popSel('filterAnno',[{v:'',l:'Tutti gli anni'},...yOpts],'');
  refreshDropdowns();
  if(!isAdmin){await loadOreForm();await renderMyOre();checkAlerts();}
  await renderFerieList();
  await populateProgettoSelect('res',getProgettoSelected('res'));
  await populateProgettoSelect('edit',getProgettoSelected('edit'));
  ['resLCField','editLCField','resEmpField','editEmpField'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=(isAdmin||isTeamLead)?'':'none';});
  // consuntivoRes: visibile solo a admin/manager/TL di progetto, filtra tra le risorse che possono vedere
  const consuntivoResField=document.getElementById('consuntivoResField'),consuntivoIds=_consuntivoVisibleIds();
  if(consuntivoResField)consuntivoResField.style.display=consuntivoIds?'':'none';
  if(consuntivoIds){
    const rOpts=[{v:'',l:'Tutte le risorse'},...RESOURCES.filter(r=>consuntivoIds.has(r.id)).map(r=>({v:r.id,l:r.fullName}))];
    popSel('consuntivoRes',rOpts,'');
  }
  if(isAdmin){renderAreaList();renderSoglieList();['adminPrjCard','adminResByPrjCard','adminPwdCard','adminEmailLogCard','adminAreeCard','adminSoglieCard'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='';});[document.getElementById('resManagerSel')?.closest('.field'),document.getElementById('editManagerSel')?.closest('.field'),document.getElementById('filterResLead')].forEach(el=>{if(el)el.style.display='';});await renderResourceList();await renderProjectList();await populateSearchByProject();}
  else if(isTeamLead){
    const sfBtn=document.getElementById('sollecitaForecastBtn');if(sfBtn)sfBtn.style.display='';
    await renderResourceList();
    // Nascondi i card riservati al super-admin (gestione progetti è visibile al manager, filtrata)
    ['adminResByPrjCard','adminPwdCard','adminEmailLogCard'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    await renderProjectList();await populateSearchByProject();
    // Nascondi il filtro team lead nell'elenco risorse (il manager vede solo il suo team)
    const flEl=document.getElementById('filterResLead');if(flEl)flEl.closest('.search-row') && (flEl.style.display='none');
    // Nascondi il selettore manager nel form aggiungi risorsa (sarà auto-assegnato)
    const mgrFieldRes=document.getElementById('resManagerSel')?.closest('.field');if(mgrFieldRes)mgrFieldRes.style.display='none';
    // Nascondi il selettore manager nel form modifica risorsa
    const mgrFieldEdit=document.getElementById('editManagerSel')?.closest('.field');if(mgrFieldEdit)mgrFieldEdit.style.display='none';
    // Aggiorna intestazione pannello admin
    const ph=document.querySelector('#panel-admin .page-header p');if(ph)ph.textContent='Gestione delle tue risorse';
  }
}
function refreshDropdowns(){
  const leads=getLeads(),lOpts=[{v:'',l:'Tutti'},...leads.map(l=>({v:l,l:l}))];
  ['riepilogoLead','trendLead','ovLead','adminFerLead','filterResLead','dashboardLead'].forEach(id=>popSel(id,lOpts,''));
  popSel('filterMembro',[{v:'',l:'Tutti i membri'},...RESOURCES.map(r=>({v:r.fullName,l:r.fullName}))],'');
  const tlOpts=[{v:'',l:'— Nessuno —'},...RESOURCES.map(r=>({v:r.fullName,l:r.fullName}))];
  popSel('newPrjTLSel',tlOpts,'');
  // selettori manager nel form aggiungi/modifica risorsa
  const mgrOpts=[{v:'',l:'— Nessun manager —'},...leads.map(l=>({v:l,l:l}))];
  ['resManagerSel','editManagerSel'].forEach(id=>popSel(id,mgrOpts,''));
}
// ALERT
async function checkAlerts(){
  if(isAdmin||!RESOURCES.length)return;const r=RESOURCES.find(x=>x.fullName===currentUser);if(!r)return;
  const now=new Date(),missing=[],limit=now.getDate()<=5?1:0,checks=[];
  for(let back=limit+1;back<=limit+3;back++){let m=now.getMonth()-back,y=now.getFullYear();if(m<0){m+=12;y--;}checks.push({m,y,label:MONTHS[m]+' '+y});}
  const inserted=new Set((_read(K_HRS,[])||[]).filter(o=>o.risorsaId===r.id).map(x=>`${x.anno}||${x.mese}`));
  checks.forEach(({m,y,label})=>{if(!inserted.has(`${y}||${m}`))missing.push(label);});
  const b=document.getElementById('alertBanner'),t=document.getElementById('alertText');
  if(missing.length){b.classList.add('visible');t.textContent=`Ore mancanti: ${missing.join(', ')}`;}else b.classList.remove('visible');
}
// TABS
const TABS=['ore','riepilogo','trend','ferie','overview','reperibilita','admin','presenze','dashboard','consuntivo','andamento','fte-trend','benchmark'];
const NAV_MAP={andamento:'navAndamento','fte-trend':'navFteTrend',benchmark:'navBenchmark',ore:'navOre',riepilogo:'navRiepilogo',trend:'navTrend',ferie:'navFerie',overview:'navOverview','rep-overview':'navRepOverview',reperibilita:'navRep',admin:'navAdmin',presenze:'navPresenze',dashboard:'navDashboard',consuntivo:'navConsuntivo'};
function toggleMobileNav(){const s=document.querySelector('.sidebar'),o=document.getElementById('mobileOverlay');s.classList.toggle('mobile-open');o.classList.toggle('visible');}
function closeMobileNav(){document.querySelector('.sidebar').classList.remove('mobile-open');document.getElementById('mobileOverlay').classList.remove('visible');}
async function showTab(t){
  closeMobileNav();
  try{sessionStorage.setItem(TAB_KEY,t);}catch{}
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));
  const an=document.getElementById(NAV_MAP[t]);if(an)an.classList.add('active');
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+t).classList.add('active');
  if(t==='dashboard')renderDashboard();
  if(t==='trend')renderTrend().catch(console.error);
  if(t==='overview')renderOverview();
  if(t==='admin'){renderAdminFerieCalendar();if(isAdmin){renderAreaList();renderSoglieList();}}
  if(t==='riepilogo')loadRiepilogo().catch(console.error);
  if(t==='reperibilita')initRepPanel();
  if(t==='rep-overview')initRepOverviewPanel();
  if(t==='ferie'&&!isAdmin){renderFerieCalendar();}
  if(t==='presenze')initPresenzePanel();
  if(t==='consuntivo')loadConsuntivo().catch(console.error);
  if(t==='andamento')renderAndamento().catch(console.error);
  if(t==='fte-trend')renderFteTrend().catch(console.error);
  if(t==='benchmark')renderBenchmark();
}
