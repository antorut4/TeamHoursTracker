let _busy=0;
function showSpinner(){_busy++;const e=document.getElementById('netSpinner');if(e)e.style.display='flex';}
function hideSpinner(){_busy=Math.max(0,_busy-1);if(_busy===0){const e=document.getElementById('netSpinner');if(e)e.style.display='none';}}
const FN_URL='/api/db';
async function call(action,payload){
  const res=await fetch(FN_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload:payload||{}})});
  let j=null;try{j=await res.json();}catch{}
  if(!res.ok||!j||j.error)throw new Error((j&&j.error)?j.error:('Errore di rete '+res.status));
  return j.data;
}
const K_HRS='hrs',K_FER='fer',K_RES='res',K_REP='rep',K_PRJ='prj',K_FRIS='hrs_fris';
let _cache={res:[],prj:[],hrs:[],fer:[],rep:[],pres:[],wbs:{},repTipi:{},aree:[],soglie:{},soglieArea:{}};
let _prjIdByName={},_prjNameById={},_prjTLsByName={},_prjWbsByName={};
function _read(key,fallback){switch(key){case K_RES:return _cache.res;case K_PRJ:return _cache.prj;case K_HRS:return _cache.hrs;case K_FER:return _cache.fer;case K_REP:return _cache.rep;default:return fallback;}}
function _write(){}
async function reloadAll(){
  const d=await call('bootstrap');
  _cache.prj=(d.progetti||[]).map(r=>r.nome);
  _prjIdByName={};_prjNameById={};_prjTLsByName={};
  const nameById={};(d.risorse||[]).forEach(r=>{nameById[r.id]=r.full_name;});
  (d.progetti||[]).forEach(r=>{_prjIdByName[r.nome]=r.id;_prjNameById[r.id]=r.nome;_prjTLsByName[r.nome]=Array.isArray(r.team_lead_names)?r.team_lead_names:[];_prjWbsByName[r.nome]=r.wbs||'';});
  const byRes={};
  (d.allocazioni||[]).forEach(a=>{
    if(!byRes[a.risorsa_id])byRes[a.risorsa_id]=[];
    byRes[a.risorsa_id].push(_prjNameById[a.progetto_id]);
  });
  RESOURCES=(d.risorse||[]).map(r=>({id:r.id,nome:r.nome,cognome:r.cognome,fullName:r.full_name,email:(r.email||'').toLowerCase(),progetti:(byRes[r.id]||[]).filter(Boolean),managerId:r.manager_id||null,managerName:r.manager_id?nameById[r.manager_id]||null:null,isManager:!!r.is_manager,loadCost:r.load_cost!=null?+r.load_cost:null,dailyReminder:r.daily_reminder!==false}));
  _cache.res=RESOURCES;
  _cache.hrs=(d.ore||[]).map(o=>({id:o.id,risorsaId:o.risorsa_id,anno:+o.anno,mese:+o.mese,ore_q1:o.ore_q1!=null?+o.ore_q1:null,note_q1:o.note_q1,ore_q2:o.ore_q2!=null?+o.ore_q2:null,note_q2:o.note_q2}));
  _cache.fer=(d.ferie||[]).map(f=>({id:f.id,risorsaId:f.risorsa_id,start:(f.data_inizio||'').slice(0,10),end:(f.data_fine||'').slice(0,10),tipo:f.tipo,note:f.note,oraInizio:f.ora_inizio||null,oraFine:f.ora_fine||null}));
  _cache.rep=(d.rep||[]).map(rp=>({id:rp.id,risorsaId:+rp.risorsa_id,progetto:_prjNameById[rp.progetto_id]||'',teamLead:rp.team_lead_id?nameById[rp.team_lead_id]||'':'',anno:+rp.anno,mese:+rp.mese,giorni:Array.isArray(rp.giorni)?rp.giorni.map(Number):[],etichetta:rp.etichetta||''}));
  _cache.wbs=d.wbs||{};
  _cache.repTipi=d.repTipi||{};
  _cache.aree=(d.aree||[]).map(a=>({id:+a.id,progettoId:+a.progetto_id,nome:a.nome,teamLeadId:a.team_lead_id?+a.team_lead_id:null,attiva:a.attiva!==false}));
  // Soglie: area_id nullo = soglia di progetto, altrimenti soglia della singola area
  _cache.soglie={};_cache.soglieArea={};(d.soglie||[]).forEach(s=>{const v={soglia:s.soglia!=null?+s.soglia:null,sogliaEe:s.soglia_ee!=null?+s.soglia_ee:null,attiva:s.attiva!==false,destinatari:s.destinatari||''};if(s.area_id)_cache.soglieArea[s.area_id]=v;else _cache.soglie[s.progetto_id]=v;});
}
async function reloadAll2(){return reloadAll();}
async function getProjects(){return _cache.prj.slice();}
function getWbsForMember(risorsaId,anno,mese){return _cache.wbs[`${risorsaId}_${anno}_${mese}`]||[];}
function getRepTipiForPrj(progetto){const pid=_prjIdByName[progetto];const tipi=pid&&_cache.repTipi[String(pid)];return(tipi&&tipi.length)?tipi:[''];}
const MONTHS=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const TIPO_C=t=>t==='Ferie'?'#A100FF':t==='Malattia'?'#C9003C':'#007A4C';
const PAL=['#A100FF','#007A4C','#004B87','#C9003C','#E60075','#FF6900','#00BAAB','#7500C0','#005734','#003366','#6200CC','#FF3385'];
const S={get:k=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):null}catch{return null}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
let currentUser=null,isAdmin=false,isTeamLead=false,isProjectTL=false,RESOURCES=[];
function simpleHash(str){let h=5381;for(let i=0;i<str.length;i++)h=((h<<5)+h)+str.charCodeAt(i);return(h>>>0).toString(36);}
function _resByName(name){return RESOURCES.find(x=>x.fullName===name);}
function _resByEmail(email){const e=(email||'').toLowerCase().trim();return RESOURCES.find(x=>x.email===e);}
let _loginRisorsaId=null;
function getMembers(manager){return manager?RESOURCES.filter(r=>r.managerName===manager).map(r=>r.fullName):RESOURCES.map(r=>r.fullName);}
function getLeadTeam(){return RESOURCES.filter(r=>r.managerName===currentUser).map(r=>r.fullName);}
function getLeads(){return RESOURCES.filter(r=>r.isManager).map(r=>r.fullName).sort();}
function getLeadForMember(fullName){const r=RESOURCES.find(x=>x.fullName===fullName);return r?.managerName||'—';}
function colorFor(name){const i=RESOURCES.findIndex(r=>r.fullName===name);return PAL[i%PAL.length]||'#A100FF';}
const HC={};
function easterSunday(year){const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31)-1,day=((h+l-7*m+114)%31)+1;return new Date(year,month,day);}
function getHol(year){if(HC[year])return HC[year];const fd=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+dd;};const pa=easterSunday(year),pk=new Date(year,pa.getMonth(),pa.getDate()+1);HC[year]=new Set([`${year}-01-01`,`${year}-01-06`,fd(pa),fd(pk),`${year}-04-25`,`${year}-05-01`,`${year}-06-02`,`${year}-08-15`,`${year}-11-01`,`${year}-12-08`,`${year}-12-25`,`${year}-12-26`]);return HC[year];}
function localDate(dt){const y=dt.getFullYear(),m=String(dt.getMonth()+1).padStart(2,'0'),d=String(dt.getDate()).padStart(2,'0');return y+'-'+m+'-'+d;}
function wHours(year,month,q){const h=getHol(year);let days=0;const s=q===1?1:16,e=q===1?15:new Date(year,month+1,0).getDate();for(let d=s;d<=e;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt);if(wd!==0&&wd!==6&&!h.has(ds))days++;}return days*8;}
function wDays(s,e){let c=0,cur=new Date(s+'T12:00:00'),end=new Date(e+'T12:00:00');while(cur<=end){const wd=cur.getDay(),ds=localDate(cur);if(wd!==0&&wd!==6&&!getHol(cur.getFullYear()).has(ds))c++;cur.setDate(cur.getDate()+1);}return c;}
function fmt(ds){const[y,m,d]=ds.split('-');return `${d}/${m}/${y}`;}
function showMsg(id,txt,t){const el=document.getElementById(id);if(!el)return;el.textContent=txt;el.className='msg '+t;setTimeout(()=>{el.className='msg';},3500);}
function popSel(id,opts,sel){const s=document.getElementById(id);if(!s)return;s.innerHTML='';opts.forEach(({v,l})=>{const o=document.createElement('option');o.value=v;o.textContent=l;if(String(v)===String(sel))o.selected=true;s.appendChild(o);});}
let _mcb=null;
function openModal(title,msg,cb,lbl){document.getElementById('MT').textContent=title;document.getElementById('MM').textContent=msg;const btn=document.getElementById('MK');btn.textContent=lbl||'Conferma';_mcb=cb;document.getElementById('MO').classList.add('open');}
function MC(){document.getElementById('MO').classList.remove('open');_mcb=null;}
document.getElementById('MK').onclick=()=>{document.getElementById('MO').classList.remove('open');if(_mcb){const f=_mcb;_mcb=null;f();}};
// LOGIN
function showStep(id){['stepSelect','stepFirstAccess','stepPwd','stepAdmin'].forEach(s=>document.getElementById(s).style.display=s===id?'block':'none');}
function goStepSelect(){document.getElementById('loginSub').textContent='Inserisci la tua email per accedere';showStep('stepSelect');document.getElementById('loginEmail').value='';document.getElementById('errEmail').style.display='none';}
function goAdminLogin(){document.getElementById('loginSub').textContent='Accesso amministratore';showStep('stepAdmin');document.getElementById('adminPwd').value='';document.getElementById('errAdmin').style.display='none';}
async function goStepPwdByEmail(){
  const email=document.getElementById('loginEmail').value.trim();
  const errEl=document.getElementById('errEmail');
  if(!email||!email.includes('@')){errEl.textContent='Inserisci un indirizzo email valido.';errEl.style.display='block';return;}
  const r=_resByEmail(email);
  if(!r){errEl.textContent='Nessun account trovato per questa email.';errEl.style.display='block';return;}
  errEl.style.display='none';_loginRisorsaId=r.id;
  let has=false;showSpinner();try{has=await call('userHasPwd',{risorsaId:r.id});}catch(e){hideSpinner();alert('Errore di connessione: '+e.message);return;}hideSpinner();
  if(!has){document.getElementById('loginSub').textContent=`Benvenuto/a, ${r.fullName}`;showStep('stepFirstAccess');document.getElementById('pwd1stA').value='';document.getElementById('pwd1stB').value='';document.getElementById('err1st').style.display='none';}
  else{document.getElementById('loginSub').textContent='Bentornato/a';document.getElementById('loginWhoLabel').textContent=r.fullName;showStep('stepPwd');document.getElementById('pwdInput').value='';document.getElementById('errPwd').style.display='none';setTimeout(()=>document.getElementById('pwdInput').focus(),100);}
}
async function doFirstAccess(){
  if(!_loginRisorsaId)return;
  const p1=document.getElementById('pwd1stA').value,p2=document.getElementById('pwd1stB').value,errEl=document.getElementById('err1st');
  if(p1.length<6){errEl.textContent='Minimo 6 caratteri.';errEl.style.display='block';return;}
  if(p1!==p2){errEl.textContent='Le password non coincidono.';errEl.style.display='block';return;}
  errEl.style.display='none';
  showSpinner();try{await call('setUserPwd',{risorsaId:_loginRisorsaId,hash:simpleHash(p1)});}catch(e){hideSpinner();alert('Errore: '+e.message);return;}hideSpinner();
  const r=RESOURCES.find(x=>x.id===_loginRisorsaId);currentUser=r?r.fullName:'';isAdmin=false;await launchApp();
}
async function doUserLogin(){
  if(!_loginRisorsaId)return;
  const pwd=document.getElementById('pwdInput').value;let ok=false;
  showSpinner();try{ok=await call('checkUserPwd',{risorsaId:_loginRisorsaId,hash:simpleHash(pwd)});}catch(e){hideSpinner();alert('Errore: '+e.message);return;}hideSpinner();
  if(!ok){document.getElementById('errPwd').style.display='block';return;}
  document.getElementById('errPwd').style.display='none';
  const r=RESOURCES.find(x=>x.id===_loginRisorsaId);currentUser=r?r.fullName:'';isAdmin=false;await launchApp();
}
async function doAdminLogin(){
  const pwd=document.getElementById('adminPwd').value;let ok=false;
  showSpinner();try{ok=await call('checkAdminPwd',{hash:simpleHash(pwd)});}catch(e){hideSpinner();alert('Errore: '+e.message);return;}hideSpinner();
  if(!ok){document.getElementById('errAdmin').style.display='block';return;}document.getElementById('errAdmin').style.display='none';document.getElementById('adminPwd').value='';currentUser='ADMIN';isAdmin=true;await launchApp();
}
function doLogout(){currentUser=null;isAdmin=false;_loginRisorsaId=null;document.getElementById('loginScreen').style.display='flex';document.getElementById('app').style.display='none';goStepSelect();}
async function launchApp(){
  document.getElementById('loginScreen').style.display='none';document.getElementById('app').style.display='block';
  const initials=isAdmin?'AD':currentUser.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('userAvatar').textContent=initials;document.getElementById('hUser').textContent=isAdmin?'Admin':currentUser;
  isTeamLead=!isAdmin&&(RESOURCES.find(r=>r.fullName===currentUser)?.isManager||false);
  isProjectTL=!isAdmin&&(Object.values(_prjTLsByName).some(tls=>tls.includes(currentUser))||_myAree().length>0);
  document.getElementById('hRole').textContent=isAdmin?'Amministratore':(isTeamLead?'Manager':(isProjectTL?'Team Leader':'Collaboratore'));
  const navVis=(id,show)=>{const el=document.getElementById(id);if(!el)return;el.classList.toggle('nav-hidden',!show);el.style.display=show?'':'none';};
  navVis('navOre',!isAdmin);
  navVis('navFerie',!isAdmin);
  navVis('navRep',!isAdmin);
  navVis('navPresenze',true);
  navVis('navConsuntivo',true);
  navVis('navAndamento',isAdmin||_andProjects().length>0);
  navVis('navSectionTeam',isAdmin||isTeamLead);
  navVis('navDashboard',isAdmin||isTeamLead);
  navVis('navRiepilogo',isAdmin||isTeamLead);
  navVis('navTrend',false);
  navVis('navOverview',isAdmin||isTeamLead);
  navVis('navRepOverview',isAdmin||isTeamLead);
  navVis('navSectionAdmin',isAdmin||isTeamLead);
  navVis('navAdmin',isAdmin||isTeamLead);
  initApp();
  if(isAdmin||isTeamLead)showTab('dashboard');else showTab('ore');
  // Deep link dalle email (es. alert soglia → ?tab=andamento&prj=ID&area=ID)
  const qs=new URLSearchParams(location.search),qTab=qs.get('tab');
  if(qTab==='andamento'&&+qs.get('prj'))_andSel={pid:+qs.get('prj'),areaId:+qs.get('area')||null};
  if(qTab&&NAV_MAP[qTab]&&document.getElementById(NAV_MAP[qTab])?.style.display!=='none')showTab(qTab);
}
// INIT
async function initApp(){
  const now=new Date(),mOpts=MONTHS.map((m,i)=>({v:i,l:m})),yOpts=[-1,0,1].map(d=>{const y=now.getFullYear()+d;return{v:y,l:y};});
  ['oreMonth','riepilogoMonth','ovMonth','adminFerMonth','ferieCalMonth','consuntivoMonth','andMonth'].forEach(id=>popSel(id,mOpts,now.getMonth()));
  ['oreYear','riepilogoYear','ovYear','adminFerYear','ferieCalYear','consuntivoYear','andYear'].forEach(id=>popSel(id,yOpts,now.getFullYear()));
  popSel('filterAnno',[{v:'',l:'Tutti gli anni'},...yOpts],'');
  refreshDropdowns();
  if(!isAdmin){await loadOreForm();await renderMyOre();checkAlerts();}
  await renderFerieList();
  await populateProgettoSelect('res',getProgettoSelected('res'));
  await populateProgettoSelect('edit',getProgettoSelected('edit'));
  ['resLCField','editLCField'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=(isAdmin||isTeamLead)?'':'none';});
  // consuntivoRes: visibile solo a manager/admin, permette di filtrare per risorsa
  const consuntivoResField=document.getElementById('consuntivoResField');
  if(consuntivoResField)consuntivoResField.style.display=(isAdmin||isTeamLead)?'':'none';
  if(isAdmin||isTeamLead){
    const rOpts=[{v:'',l:'Tutte le risorse'},...RESOURCES.map(r=>({v:r.id,l:r.fullName}))];
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
const TABS=['ore','riepilogo','trend','ferie','overview','reperibilita','admin','presenze','dashboard','consuntivo','andamento'];
const NAV_MAP={andamento:'navAndamento',ore:'navOre',riepilogo:'navRiepilogo',trend:'navTrend',ferie:'navFerie',overview:'navOverview','rep-overview':'navRepOverview',reperibilita:'navRep',admin:'navAdmin',presenze:'navPresenze',dashboard:'navDashboard',consuntivo:'navConsuntivo'};
function toggleMobileNav(){const s=document.querySelector('.sidebar'),o=document.getElementById('mobileOverlay');s.classList.toggle('mobile-open');o.classList.toggle('visible');}
function closeMobileNav(){document.querySelector('.sidebar').classList.remove('mobile-open');document.getElementById('mobileOverlay').classList.remove('visible');}
async function showTab(t){
  closeMobileNav();
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
}
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
      if(q1.length)wbsHtml+=`<div><div style="font-size:.72rem;font-weight:700;color:var(--ink-2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">I Quindicina</div>${q1.map(x=>`<div style="font-size:.83rem;margin-bottom:3px"><span style="color:var(--ink-3)">${x.progetto}</span>${x.codice?` <b style="font-family:monospace;color:var(--ink)">${x.codice}</b>`:''}${x.ore!=null?` <span style="color:var(--amber);font-weight:700">${x.ore}h</span>`:''}</div>`).join('')}</div>`;
      if(q2.length)wbsHtml+=`<div><div style="font-size:.72rem;font-weight:700;color:var(--ink-2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">II Quindicina</div>${q2.map(x=>`<div style="font-size:.83rem;margin-bottom:3px"><span style="color:var(--ink-3)">${x.progetto}</span>${x.codice?` <b style="font-family:monospace;color:var(--ink)">${x.codice}</b>`:''}${x.ore!=null?` <span style="color:var(--amber);font-weight:700">${x.ore}h</span>`:''}</div>`).join('')}</div>`;
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
  if(w1){if(!isNaN(v1)&&v1>h1){w1.style.display='block';document.getElementById('oreWarn1Txt').textContent=`Straordinari: +${Math.round((v1-h1)*10)/10}h rispetto alle ${h1}h previste`;}else{w1.style.display='none';}}
  if(w2){if(!isNaN(v2)&&v2>h2){w2.style.display='block';document.getElementById('oreWarn2Txt').textContent=`Straordinari: +${Math.round((v2-h2)*10)/10}h rispetto alle ${h2}h previste`;}else{w2.style.display='none';}}
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
    const straoBadge=extra>0?` <span style="font-size:.69rem;font-weight:700;color:var(--warn);background:var(--warn-bg);border-radius:10px;padding:1px 7px;white-space:nowrap"><i class="fa-solid fa-bolt" style="margin-right:3px"></i>+${Math.round(extra*10)/10}h strao</span>`:'';
    h+=`<tr style="${extra>0?'background:var(--warn-bg)':''}"><td><b>${MONTHS[e.mese]} ${e.anno}</b></td><td>${e.ore_q1!=null?e.ore_q1+'h':'—'}${e.note_q1?` <span style="color:var(--ink-3);font-size:.73rem">(${e.note_q1})</span>`:''}</td><td>${e.ore_q2!=null?e.ore_q2+'h':'—'}${e.note_q2?` <span style="color:var(--ink-3);font-size:.73rem">(${e.note_q2})</span>`:''}</td><td><b>${tot}h</b>${straoBadge}</td><td style="color:var(--ink-3)">${av}h</td><td><button class="btn-icon danger" onclick="deleteMyOre(${e.id},'${MONTHS[e.mese]} ${e.anno}')" title="Elimina inserimento"><i class="fa-solid fa-trash-can" style="font-size:.72rem"></i></button></td></tr>`;
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
  showSpinner();
  let res;
  try{res=await call('sollecitaForecast',{managerId:r.id});}
  catch(e){hideSpinner();showMsg('sollecitaMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  if(res.reason==='no_smtp'){showMsg('sollecitaMsg','SMTP non configurato.','err');return;}
  if(res.reason==='no_resources'){showMsg('sollecitaMsg','Nessuna risorsa nel tuo team con email configurata.','warn');return;}
  if(res.reason==='all_complete'){showMsg('sollecitaMsg','Tutte le risorse hanno compilato il Forecast. ','ok');return;}
  let msg=`Solleciti inviati: ${res.sent}`;
  if(res.skipped)msg+=`, già completi: ${res.skipped}`;
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
    if(!e)h+=`<tr><td>${m}</td><td style="color:var(--ink-3);font-size:.8rem">${lead}</td><td colspan="3" style="color:var(--ink-3)">—</td><td style="color:var(--ink-3)">${av}h</td><td><span class="badge badge-warn">Non inserito</span></td>${lcTd}${wbsTd}</tr>`;
    else{const tot=(+e.ore1||0)+(+e.ore2||0);h+=`<tr><td><b>${m}</b></td><td style="color:var(--ink-3);font-size:.8rem">${lead}</td><td>${e.ore1!=null?e.ore1+'h':'—'}</td><td>${e.ore2!=null?e.ore2+'h':'—'}</td><td><b>${tot}h</b></td><td style="color:var(--ink-3)">${av}h</td><td>${tot>av?`<span class="badge badge-amber">Extra ${tot}h</span>`:`<span class="badge badge-ok">${tot}h</span>`}</td>${lcTd}${wbsTd}</tr>`;}
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
  return `<div class="wbs-panel"><div class="wbs-panel-title"><i class="fa-solid fa-code-branch"></i> WBS per <b>${memberName}</b> — ${MONTHS[month]} ${year}</div><div class="wbs-cols"><div class="wbs-col">${label1}${colHtml('1Q',q1)}</div><div class="wbs-col">${label2}${colHtml('2Q',q2)}</div></div><div style="display:flex;gap:10px;align-items:center;margin-top:14px"><button class="btn btn-ink" onclick="saveWbsForMember(${risorsaId},${month},${year})"><i class="fa-solid fa-floppy-disk"></i> Salva WBS</button><div id="wbs-msg-${risorsaId}-${month}-${year}" class="msg"></div></div></div>`;
}
function wbsRowHtml(risorsaId,month,year,q,idx,progetto,codice,ore){
  const rid=`wbsr-${risorsaId}-${month}-${year}-${q}-${idx}`;
  const cE=(codice||'').replace(/"/g,'&quot;');
  const oV=ore!=null&&ore!==''?ore:'';
  const res=RESOURCES.find(x=>x.id===risorsaId);const prjs=res?.progetti||[];
  const opts='<option value="">— Progetto —</option>'+prjs.map(p=>`<option value="${p.replace(/"/g,'&quot;')}"${p===progetto?' selected':''}>${p}</option>`).join('');
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
// TREND
// DASHBOARD
function renderDashboard(){
  const lf=(isTeamLead&&!isAdmin)?currentUser:(document.getElementById('dashboardLead')?.value||'');
  const members=getMembers(lf);
  const now=new Date(),month=now.getMonth(),year=now.getFullYear();
  const hrsMap={};
  (_read(K_HRS,[])||[]).filter(o=>o.anno===year&&o.mese===month).forEach(o=>{const res=RESOURCES.find(x=>x.id===o.risorsaId);if(res)hrsMap[res.fullName]={ore1:o.ore_q1,ore2:o.ore_q2};});
  const resources=members.map(m=>RESOURCES.find(r=>r.fullName===m)).filter(Boolean);
  const totalProjects=new Set(resources.flatMap(r=>r.progetti||[])).size;
  const avgProjects=resources.length?(resources.reduce((s,r)=>s+(r.progetti||[]).length,0)/resources.length).toFixed(1):'0';
  const inserted=resources.filter(r=>hrsMap[r.fullName]).length;
  const filterRow=document.getElementById('dashFilterRow');
  if(filterRow)filterRow.style.display=isAdmin?'':'none';
  document.getElementById('dashKpi').innerHTML=[
    {icon:'fa-users',val:resources.length,lbl:'Risorse',color:'var(--amber)',bg:'var(--amber-bg)'},
    {icon:'fa-folder-open',val:totalProjects,lbl:'Progetti attivi',color:'var(--info)',bg:'var(--info-bg)'},
    {icon:'fa-layer-group',val:avgProjects,lbl:'Proj. medi / risorsa',color:'var(--ok)',bg:'var(--ok-bg)'},
    {icon:'fa-clock',val:inserted+'/'+resources.length,lbl:'Ore inserite '+MONTHS[month],color:inserted===resources.length?'var(--ok)':'var(--warn)',bg:inserted===resources.length?'var(--ok-bg)':'var(--warn-bg)'}
  ].map(k=>`<div class="card" style="margin:0;padding:16px 18px;display:flex;align-items:center;gap:13px"><div style="width:40px;height:40px;border-radius:10px;background:${k.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fa-solid ${k.icon}" style="color:${k.color};font-size:.95rem"></i></div><div><div style="font-size:1.6rem;font-weight:700;font-family:var(--f-display);color:var(--ink);line-height:1">${k.val}</div><div style="font-size:.74rem;color:var(--ink-3);margin-top:3px">${k.lbl}</div></div></div>`).join('');
  requestAnimationFrame(()=>{
    const cv=document.getElementById('dashCanvas');if(!cv)return;
    const ctx=cv.getContext('2d');
    const MIN_SLOT=72,containerW=cv.parentElement.clientWidth||700;
    const W=Math.max(containerW,resources.length*MIN_SLOT),H=220;
    cv.width=W;cv.height=H;cv.style.width=W+'px';cv.style.height=H+'px';
    ctx.clearRect(0,0,W,H);
    if(!resources.length)return;
    const maxP=Math.max(...resources.map(r=>(r.progetti||[]).length),1);
    const Pad={t:28,r:16,b:40,l:16},pw=W-Pad.l-Pad.r,ph=H-Pad.t-Pad.b;
    const n=resources.length,slotW=pw/n,barW=Math.max(14,Math.min(52,slotW*0.55));
    for(let i=0;i<=maxP;i++){const y=Pad.t+ph*(1-i/maxP);ctx.strokeStyle='rgba(0,0,0,.05)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(Pad.l,y);ctx.lineTo(Pad.l+pw,y);ctx.stroke();}
    resources.forEach((r,i)=>{
      const count=(r.progetti||[]).length,color=colorFor(r.fullName);
      const cx=Pad.l+slotW*i+slotW/2,bh=count>0?ph*count/maxP:3,y=Pad.t+ph-bh,x=cx-barW/2,rad=5;
      ctx.fillStyle=color+'1A';ctx.beginPath();
      if(ctx.roundRect){ctx.roundRect(x,Pad.t,barW,ph,rad);}else{ctx.rect(x,Pad.t,barW,ph);}
      ctx.fill();
      ctx.fillStyle=color;ctx.globalAlpha=0.88;ctx.beginPath();
      if(ctx.roundRect){ctx.roundRect(x,y,barW,bh,bh<rad*2?bh/2:rad);}else{ctx.rect(x,y,barW,bh);}
      ctx.fill();ctx.globalAlpha=1;
      if(count>0){ctx.fillStyle=color;ctx.font='bold 12px DM Sans,sans-serif';ctx.textAlign='center';ctx.fillText(count,cx,y-7);}
      ctx.fillStyle='#8A8275';ctx.font='10px DM Sans,sans-serif';ctx.textAlign='center';
      ctx.fillText((r.cognome||r.fullName.split(' ').slice(1).join(' ')||r.fullName.split(' ')[0]).slice(0,10),cx,H-7);
    });
  });
  document.getElementById('dashGrid').innerHTML=resources.map(r=>{
    const hrs=hrsMap[r.fullName],color=colorFor(r.fullName);
    const initials=((r.nome||r.fullName.split(' ')[0])[0]+(r.cognome||r.fullName.split(' ')[1]||'?')[0]).toUpperCase();
    const nProj=(r.progetti||[]).length;
    let hrsStatus;
    if(hrs){const tot=(+hrs.ore1||0)+(+hrs.ore2||0),av=wHours(year,month,1)+wHours(year,month,2);
      if(tot>av)hrsStatus=`<span class="badge badge-warn" style="gap:5px"><i class="fa-solid fa-bolt" style="font-size:.62rem"></i>+${tot-av}h extra</span>`;
      else hrsStatus=`<span class="badge badge-ok" style="gap:5px"><i class="fa-solid fa-check" style="font-size:.62rem"></i>${tot}h</span>`;}
    else hrsStatus=`<span class="badge badge-danger" style="gap:5px"><i class="fa-solid fa-xmark" style="font-size:.62rem"></i>Mancanti</span>`;
    const projChips=(r.progetti||[]).map(p=>`<span style="background:var(--stone-2);border-radius:4px;padding:2px 8px;font-size:.71rem;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px">${p}</span>`).join('');
    return `<div class="card" style="margin:0;padding:18px 20px;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:40px;height:40px;border-radius:50%;background:${color}22;border:2px solid ${color}55;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;color:${color};flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:.9rem;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.fullName}</div><div style="font-size:.73rem;color:var(--ink-3);margin-top:1px">${r.managerName||'—'}</div></div>
        <div style="font-size:.72rem;font-weight:700;background:${color}18;color:${color};border-radius:20px;padding:3px 9px;white-space:nowrap;flex-shrink:0">${nProj} ${nProj===1?'progetto':'progetti'}</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;min-height:22px;margin-bottom:12px;flex:1">${projChips||'<span style="font-size:.74rem;color:var(--ink-3)">Nessun progetto</span>'}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:10px">\
        <span style="font-size:.74rem;color:var(--ink-3)">${MONTHS[month]} ${year}</span>${hrsStatus}</div>
    </div>`;
  }).join('')||'<p style="color:var(--ink-3);font-size:.84rem">Nessuna risorsa trovata.</p>';
}
async function renderTrend(){
  const n=+document.getElementById('trendMonths').value,lf=document.getElementById('trendLead').value;
  const members=getMembers(lf),now=new Date(),labels=[],periods=[];
  for(let i=n-1;i>=0;i--){let m=now.getMonth()-i,y=now.getFullYear();while(m<0){m+=12;y--;}labels.push(MONTHS[m].slice(0,3)+' '+String(y).slice(2));periods.push({m,y});}
  let allHrs={};(_read(K_HRS,[])||[]).forEach(o=>{const res=RESOURCES.find(x=>x.id===o.risorsaId);if(res)allHrs[`${res.fullName}||${o.anno}||${o.mese}`]={ore1:o.ore_q1,ore2:o.ore_q2};});
  const ds=members.map(mem=>({label:mem.split(' ')[0],color:colorFor(mem),data:periods.map(({m,y})=>{const e=allHrs[`${mem}||${y}||${m}`];return e?((+e.ore1||0)+(+e.ore2||0)):null;})}));
  const cv=document.getElementById('trendCanvas'),ctx=cv.getContext('2d');
  const W=cv.offsetWidth||800,H=240;cv.width=W;cv.height=H;ctx.clearRect(0,0,W,H);
  const P={t:18,r:18,b:38,l:48},pw=W-P.l-P.r,ph=H-P.t-P.b;
  let mx=0;ds.forEach(d=>d.data.forEach(v=>{if(v!=null&&v>mx)mx=v;}));mx=Math.ceil((mx||160)/20)*20;
  ctx.strokeStyle='var(--stone-3)';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=P.t+ph*(1-i/4);ctx.beginPath();ctx.moveTo(P.l,y);ctx.lineTo(P.l+pw,y);ctx.stroke();ctx.fillStyle='#8A8275';ctx.font='11px DM Sans';ctx.textAlign='right';ctx.fillText(Math.round(mx*i/4)+'h',P.l-5,y+4);}
  ctx.fillStyle='#8A8275';ctx.font='11px DM Sans';ctx.textAlign='center';
  labels.forEach((lb,i)=>{const x=P.l+pw*i/(labels.length-1||1);ctx.fillText(lb,x,H-6);});
  ds.forEach(d=>{
    const pts=d.data.map((v,i)=>v!=null?{x:P.l+pw*i/(labels.length-1||1),y:P.t+ph*(1-v/mx)}:null);
    ctx.strokeStyle=d.color;ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.beginPath();let st=false;
    pts.forEach(p=>{if(!p)return;if(!st){ctx.moveTo(p.x,p.y);st=true;}else ctx.lineTo(p.x,p.y);});ctx.stroke();
    pts.forEach(p=>{if(!p)return;ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle=d.color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();});
  });
  document.getElementById('trendLegend').innerHTML=ds.map((d,i)=>`<span><span class="tdot" style="background:${d.color}"></span>${members[i]}</span>`).join('');
  const warns=[];
  periods.forEach(({m,y})=>members.forEach(mem=>{const e=allHrs[`${mem}||${y}||${m}`];if(!e)warns.push({mem,m,y,t:'m'});else{const tot=(+e.ore1||0)+(+e.ore2||0),av=wHours(y,m,1)+wHours(y,m,2);if(tot>av)warns.push({mem,m,y,t:'x',tot,av});}}));
  const ae=document.getElementById('trendAlerts');
  if(!warns.length){ae.innerHTML='<p style="color:var(--ok);font-size:.84rem"><i class="fa-solid fa-check" style="margin-right:6px"></i>Nessun avviso.</p>';return;}
  ae.innerHTML=warns.slice(0,12).map(w=>w.t==='m'
    ?`<div style="padding:8px 12px;background:var(--danger-bg);border-radius:var(--r);margin-bottom:6px;font-size:.82rem;color:var(--danger)"><i class="fa-solid fa-xmark" style="margin-right:6px"></i><b>${w.mem.split(' ')[0]}</b> — ore mancanti per <b>${MONTHS[w.m]} ${w.y}</b></div>`
    :`<div style="padding:8px 12px;background:var(--warn-bg);border-radius:var(--r);margin-bottom:6px;font-size:.82rem;color:var(--warn)"><i class="fa-solid fa-bolt" style="margin-right:6px"></i><b>${w.mem.split(' ')[0]}</b> — ore extra in <b>${MONTHS[w.m]} ${w.y}</b>: ${w.tot}h / ${w.av}h</div>`
  ).join('');
}
// FERIE RISORSE
function getFerieRisorseMonitorate(){if(isAdmin)return null;const saved=S.get(K_FRIS)||{};if(saved[currentUser]===undefined)return getMyProjectColleagues();return saved[currentUser];}
function getMyProjectColleagues(){const myRes=RESOURCES.find(r=>r.fullName===currentUser);if(!myRes)return[currentUser];const myPrjs=new Set(myRes.progetti||[]);if(!myPrjs.size)return[currentUser];const colleagues=RESOURCES.filter(r=>r.fullName!==currentUser&&(r.progetti||[]).some(p=>myPrjs.has(p))).map(r=>r.fullName).sort((a,b)=>a.localeCompare(b));return[currentUser,...colleagues];}
function saveFerieRisorse(lista){const saved=S.get(K_FRIS)||{};saved[currentUser]=lista;S.set(K_FRIS,saved);}
function initFerieRisorseCard(){
  if(isAdmin){document.getElementById('ferieRisorseCard').style.display='none';return;}
  document.getElementById('ferieRisorseCard').style.display='block';
  const monitorate=getFerieRisorseMonitorate();
  const wrap=document.getElementById('ferieRisorseCheck');
  wrap.innerHTML=RESOURCES.filter(r=>r.fullName!==currentUser).map(r=>{
    const checked=monitorate.includes(r.fullName)?'checked':'',color=colorFor(r.fullName);
    return `<label style="display:flex;align-items:center;gap:7px;cursor:pointer;background:var(--stone);border-radius:var(--r);padding:6px 11px;font-size:.82rem;border:1px solid ${checked?color:'var(--line)'};transition:.15s" id="frlabel_${r.fullName.replace(/\s/g,'_')}">
      <input type="checkbox" ${checked} value="${r.fullName}" onchange="onFerieRisorsaChange(this)" style="accent-color:${color};width:14px;height:14px"/>
      <span style="font-weight:500;color:${color}">${r.fullName.split(' ')[0]}</span>
      <span style="color:var(--ink-3);font-size:.74rem">${r.fullName.split(' ').slice(1).join(' ')}</span>
    </label>`;
  }).join('');
}
function onFerieRisorsaChange(cb){const color=colorFor(cb.value);const label=document.getElementById('frlabel_'+cb.value.replace(/\s/g,'_'));if(label)label.style.borderColor=cb.checked?color:'var(--line)';const checked=[...document.querySelectorAll('#ferieRisorseCheck input:checked')].map(i=>i.value);saveFerieRisorse([currentUser,...checked]);renderFerieList();}
function selAllFerieRisorse(sel){document.querySelectorAll('#ferieRisorseCheck input').forEach(cb=>{cb.checked=sel;const color=colorFor(cb.value);const label=document.getElementById('frlabel_'+cb.value.replace(/\s/g,'_'));if(label)label.style.borderColor=sel?color:'var(--line)';});const checked=sel?[...document.querySelectorAll('#ferieRisorseCheck input')].map(i=>i.value):[];saveFerieRisorse([currentUser,...checked]);renderFerieList();}
// FERIE
function _notificaMsg(n){
  if(!n)return'';
  if(n.reason==='no_smtp')return'(SMTP non configurato)';
  if(n.reason==='no_tl')return'(Nessun Team Leader trovato)';
  if(n.reason==='error')return'(Errore invio email)';
  if(n.sent===0)return'';
  return `Email inviata a: ${n.destinatari.join(', ')}.`;
}
async function saveFerie(){
  const start=document.getElementById('ferieStart').value,end=document.getElementById('ferieEnd').value;
  const tipo=document.getElementById('ferieTipo').value,note=document.getElementById('ferieNote').value;
  if(!start||!end){showMsg('ferieMsg','Inserisci date di inizio e fine.','err');return;}if(end<start){showMsg('ferieMsg','Data fine deve essere >= inizio.','err');return;}
  const user=isAdmin?null:currentUser;if(!user){showMsg('ferieMsg','Admin non può inserire ferie per sé.','err');return;}
  const r=RESOURCES.find(x=>x.fullName===user);if(!r){showMsg('ferieMsg','Risorsa non trovata.','err');return;}
  showSpinner();let _nRes;try{_nRes=await call('saveFerie',{risorsaId:r.id,start,end,tipo,note:note||null});await reloadAll();}catch(e){hideSpinner();showMsg('ferieMsg','Errore: '+e.message,'err');return;}hideSpinner();
  document.getElementById('ferieStart').value='';document.getElementById('ferieEnd').value='';document.getElementById('ferieNote').value='';document.getElementById('overlapWarn').style.display='none';
  showMsg('ferieMsg',tipo+' aggiunto/a. '+_notificaMsg(_nRes),'ok');await renderFerieList();renderFerieCalendar();
}
async function checkOverlap(){
  const start=document.getElementById('ferieStart').value,end=document.getElementById('ferieEnd').value;if(!start||!end)return;
  const r=RESOURCES.find(x=>x.fullName===currentUser),myId=r?r.id:0;
  const myPrjs=new Set(r?.progetti||[]);
  const overl=(_read(K_FER,[])||[]).filter(f=>{if(f.risorsaId===myId||f.start>end||f.end<start)return false;const other=RESOURCES.find(x=>x.id===f.risorsaId);return other&&(other.progetti||[]).some(p=>myPrjs.has(p));});
  const names=[...new Set(overl.map(f=>{const res=RESOURCES.find(x=>x.id===f.risorsaId);return res?res.fullName:'?';}))];
  const w=document.getElementById('overlapWarn');
  if(names.length){w.textContent='Sovrapposizione con: '+names.join(', ');w.style.display='block';}else w.style.display='none';
}
async function deleteFerie(id,desc){openModal('Elimina assenza','Eliminare "'+desc+'"?',async()=>{showSpinner();try{await call('deleteFerie',{id});await reloadAll();}catch(e){hideSpinner();showMsg('ferieMsg','Errore: '+e.message,'err');return;}hideSpinner();await renderFerieList();renderAdminFerieCalendar();renderFerieCalendar();},'Elimina');}
async function renderFerieList(){
  const el=document.getElementById('ferieList');
  const search=(document.getElementById('searchFerie')?.value||'').toLowerCase();
  const fm=document.getElementById('filterMembro')?.value||'',fa=document.getElementById('filterAnno')?.value||'';
  const visibili=isAdmin?null:getFerieRisorseMonitorate();
  let rows=(_read(K_FER,[])||[]).map(f=>{const res=RESOURCES.find(x=>x.id===f.risorsaId);return{id:f.id,user:res?res.fullName:'?',start:f.start,end:f.end,tipo:f.tipo,note:f.note,oraInizio:f.oraInizio||null,oraFine:f.oraFine||null};}).sort((a,b)=>a.start<b.start?1:a.start>b.start?-1:0);
  let filtered=rows.filter(e=>{if(fm&&e.user!==fm)return false;if(fa&&!String(e.start).startsWith(fa))return false;if(visibili&&!visibili.includes(e.user))return false;if(search&&!e.user?.toLowerCase().includes(search)&&!(e.note||'').toLowerCase().includes(search))return false;return true;});
  if(!filtered.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.83rem">Nessuna voce trovata.</p>';return;}
  el.innerHTML=filtered.map(e=>{const days=wDays(e.start,e.end),color=TIPO_C(e.tipo),canDel=isAdmin||(e.user===currentUser),desc=e.tipo+' '+fmt(e.start)+'–'+fmt(e.end);
    const orario=(e.tipo==='Permesso/ROL'&&e.oraInizio&&e.oraFine)?` · ${e.oraInizio}–${e.oraFine}`:'';
    const dateRange=e.start===e.end?fmt(e.start):fmt(e.start)+' → '+fmt(e.end);
    return `<div class="ferie-item"><div style="display:flex;align-items:flex-start;gap:10px"><span class="ferie-dot" style="background:${color}"></span><div><b>${e.user||'—'}</b> — <span style="color:${color};font-weight:600">${e.tipo}</span><div class="ferie-meta">${dateRange} · ${days} gg lav.${orario}${e.note?' · '+e.note:''}</div></div></div>${canDel?`<button class="btn-icon danger" onclick="deleteFerie(${e.id},'${desc.replace(/'/g,"\\'")}')"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button>`:''}</div>`;
  }).join('');
}
// OVERVIEW
async function renderOverview(){
  const month=+document.getElementById('ovMonth').value,year=+document.getElementById('ovYear').value;
  const _ovLeadFld=document.getElementById('ovLead');if(_ovLeadFld)_ovLeadFld.closest('.field').style.display=(isTeamLead&&!isAdmin)?'none':'';
  const lf=(isTeamLead&&!isAdmin)?currentUser:(_ovLeadFld?.value||''),members=getMembers(lf);
  const dim=new Date(year,month+1,0).getDate(),hol=getHol(year);
  let allFer=(_read(K_FER,[])||[]).map(f=>{const r=RESOURCES.find(x=>x.id===f.risorsaId);return r?{user:r.fullName,start:f.start,end:f.end,tipo:f.tipo}:null;}).filter(Boolean);
  const DN=['D','L','M','M','G','V','S'];
  const md={};members.forEach(m=>{md[m]={};});
  allFer.forEach(e=>{if(!md[e.user])return;let c=new Date(e.start+'T12:00:00'),en=new Date(e.end+'T12:00:00');while(c<=en){const ds=localDate(c);if(ds.startsWith(`${year}-${String(month+1).padStart(2,'0')}`))md[e.user][ds]=e.tipo;c.setDate(c.getDate()+1);}});
  if(!members.length){document.getElementById('ovCalendar').innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessuna risorsa.</p>';return;}
  let h=`<table style="border-collapse:collapse;font-size:.73rem;width:100%"><thead><tr><th style="padding:5px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;min-width:88px;border-radius:0">Risorsa</th>`;
  for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6;h+=`<th style="padding:2px 1px;background:${ih?'var(--amber-bg)':iw?'var(--stone-2)':'var(--ink)'};color:${ih?'var(--amber)':iw?'var(--ink-3)':'var(--white)'};text-align:center;min-width:22px;font-weight:${ih||iw?400:600}"><div style="font-size:.58rem">${DN[wd]}</div><div>${d}</div></th>`;}
  h+=`<th style="padding:5px 6px;background:var(--ink);color:var(--white);text-align:center;min-width:32px">Tot</th></tr></thead><tbody>`;
  const sumData=[];
  members.forEach((m,mi)=>{
    h+=`<tr style="background:${mi%2?'var(--stone)':'var(--white)'}"><td style="padding:6px 10px;font-weight:600;font-size:.76rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap">${m.split(' ')[0]}<br><span style="font-weight:400;color:var(--ink-3);font-size:.66rem">${m.split(' ').slice(1).join(' ')}</span></td>`;
    let tot=0;const bt={};
    for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6,tipo=md[m][ds];let cb='',dot='';if(tipo){const c=TIPO_C(tipo);cb=`background:${c}18`;dot=`<div style="width:8px;height:8px;border-radius:2px;background:${c};margin:0 auto" title="${tipo}"></div>`;if(!iw&&!ih){tot++;bt[tipo]=(bt[tipo]||0)+1;}}else if(ih)cb='background:var(--amber-bg)';else if(iw)cb='background:var(--stone-2)';h+=`<td style="padding:3px 1px;text-align:center;${cb}">${dot}</td>`;}
    h+=`<td style="padding:5px 6px;text-align:center;font-weight:700;color:var(--ink);border-left:2px solid var(--stone-3)">${tot}</td></tr>`;
    sumData.push({name:m,days:tot,bt});
  });
  document.getElementById('ovCalendar').innerHTML=h+'</tbody></table>';
}
function renderAdminFerieCalendar(){
  const el=document.getElementById('adminFerCalendar');if(!el)return;
  const month=+document.getElementById('adminFerMonth').value,year=+document.getElementById('adminFerYear').value;
  const lf=document.getElementById('adminFerLead').value,members=getMembers(lf);
  const dim=new Date(year,month+1,0).getDate(),hol=getHol(year);
  let allFer=(_read(K_FER,[])||[]).map(f=>{const r=RESOURCES.find(x=>x.id===f.risorsaId);return r?{user:r.fullName,start:f.start,end:f.end,tipo:f.tipo}:null;}).filter(Boolean);
  const DN=['D','L','M','M','G','V','S'];
  const md={};members.forEach(m=>{md[m]={};});
  allFer.forEach(e=>{if(!md[e.user])return;let c=new Date(e.start+'T12:00:00'),en=new Date(e.end+'T12:00:00');while(c<=en){const ds=localDate(c);if(ds.startsWith(`${year}-${String(month+1).padStart(2,'0')}`))md[e.user][ds]=e.tipo;c.setDate(c.getDate()+1);}});
  if(!members.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessuna risorsa.</p>';return;}
  let h=`<table style="border-collapse:collapse;font-size:.73rem;width:100%"><thead><tr><th style="padding:5px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;min-width:88px;border-radius:0">Risorsa</th>`;
  for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6;h+=`<th style="padding:2px 1px;background:${ih?'var(--amber-bg)':iw?'var(--stone-2)':'var(--ink)'};color:${ih?'var(--amber)':iw?'var(--ink-3)':'var(--white)'};text-align:center;min-width:22px;font-weight:${ih||iw?400:600}"><div style="font-size:.58rem">${DN[wd]}</div><div>${d}</div></th>`;}
  h+=`<th style="padding:5px 6px;background:var(--ink);color:var(--white);text-align:center;min-width:32px">Tot</th></tr></thead><tbody>`;
  members.forEach((m,mi)=>{
    h+=`<tr style="background:${mi%2?'var(--stone)':'var(--white)'}"><td style="padding:6px 10px;font-weight:600;font-size:.76rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap">${m.split(' ')[0]}<br><span style="font-weight:400;color:var(--ink-3);font-size:.66rem">${m.split(' ').slice(1).join(' ')}</span></td>`;
    let tot=0;
    for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6,tipo=md[m][ds];let cb='',dot='';if(tipo){const c=TIPO_C(tipo);cb=`background:${c}18`;dot=`<div style="width:8px;height:8px;border-radius:2px;background:${c};margin:0 auto" title="${tipo}"></div>`;if(!iw&&!ih)tot++;}else if(ih)cb='background:var(--amber-bg)';else if(iw)cb='background:var(--stone-2)';h+=`<td style="padding:3px 1px;text-align:center;${cb}">${dot}</td>`;}
    h+=`<td style="padding:5px 6px;text-align:center;font-weight:700;color:var(--ink);border-left:2px solid var(--stone-3)">${tot}</td></tr>`;
  });
  el.innerHTML=h+'</tbody></table>';
}
function getMyTeamMembers(){
  if(isTeamLead){const t=RESOURCES.filter(r=>r.managerName===currentUser).map(r=>r.fullName);return t.includes(currentUser)?t:[currentUser,...t];}
  return getMyProjectColleagues();
}
function _shareProject(a,b){const pa=new Set(RESOURCES.find(r=>r.fullName===a)?.progetti||[]);return(RESOURCES.find(r=>r.fullName===b)?.progetti||[]).some(p=>pa.has(p));}
function renderFerieCalendar(){
  const el=document.getElementById('ferieCalendar');if(!el)return;
  const month=+document.getElementById('ferieCalMonth').value,year=+document.getElementById('ferieCalYear').value;
  const members=getMyTeamMembers();
  const dim=new Date(year,month+1,0).getDate(),hol=getHol(year);
  let allFer=(_read(K_FER,[])||[]).map(f=>{const r=RESOURCES.find(x=>x.id===f.risorsaId);return r?{user:r.fullName,start:f.start,end:f.end,tipo:f.tipo,oraInizio:f.oraInizio||null,oraFine:f.oraFine||null}:null;}).filter(Boolean);
  const DN=['D','L','M','M','G','V','S'];
  const md={};members.forEach(m=>{md[m]={};});
  allFer.forEach(e=>{if(!md[e.user])return;let c=new Date(e.start+'T12:00:00'),en=new Date(e.end+'T12:00:00');while(c<=en){const ds=localDate(c);if(ds.startsWith(`${year}-${String(month+1).padStart(2,'0')}`))md[e.user][ds]=e.tipo;c.setDate(c.getDate()+1);}});
  if(!members.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessun collega nel tuo team.</p>';document.getElementById('ferieCalCards').innerHTML='';document.getElementById('ferieCalOverlaps').innerHTML='';return;}
  let h=`<table style="border-collapse:collapse;font-size:.73rem;width:100%"><thead><tr><th style="padding:5px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;min-width:88px;border-radius:0">Risorsa</th>`;
  for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6;h+=`<th style="padding:2px 1px;background:${ih?'var(--amber-bg)':iw?'var(--stone-2)':'var(--ink)'};color:${ih?'var(--amber)':iw?'var(--ink-3)':'var(--white)'};text-align:center;min-width:22px;font-weight:${ih||iw?400:600}"><div style="font-size:.58rem">${DN[wd]}</div><div>${d}</div></th>`;}
  h+=`<th style="padding:5px 6px;background:var(--ink);color:var(--white);text-align:center;min-width:32px">Tot</th></tr></thead><tbody>`;
  const sumData=[];
  members.forEach((m,mi)=>{
    const isMe=m===currentUser;
    h+=`<tr style="background:${isMe?'rgba(161,0,255,.07)':mi%2?'var(--stone)':'var(--white)'}"><td style="padding:6px 10px;font-weight:600;font-size:.76rem;color:${isMe?'var(--amber)':'var(--ink)'};border-right:2px solid var(--stone-3);white-space:nowrap">${m.split(' ')[0]}${isMe?' ★':''}<br><span style="font-weight:400;color:var(--ink-3);font-size:.66rem">${m.split(' ').slice(1).join(' ')}</span></td>`;
    let tot=0;const bt={};
    for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6,tipo=md[m][ds];let cb='',dot='';if(tipo){const c=TIPO_C(tipo);cb=`background:${c}18`;dot=`<div style="width:8px;height:8px;border-radius:2px;background:${c};margin:0 auto" title="${tipo}"></div>`;if(!iw&&!ih){tot++;bt[tipo]=(bt[tipo]||0)+1;}}else if(ih)cb='background:var(--amber-bg)';else if(iw)cb='background:var(--stone-2)';if(isMe&&!ih&&(!iw||tipo)){const ph=dot||`<div style="width:6px;height:6px;border-radius:50%;border:1.5px dashed rgba(0,0,0,.18);margin:0 auto"></div>`;h+=`<td style="padding:3px 1px;text-align:center;${cb};cursor:pointer" onclick="toggleFerieDay('${ds}')" title="${tipo?tipo+' — clicca per eliminare':'Aggiungi assenza'}">${ph}</td>`;}else{h+=`<td style="padding:3px 1px;text-align:center;${cb}">${dot}</td>`;}}
    h+=`<td style="padding:5px 6px;text-align:center;font-weight:700;color:var(--ink);border-left:2px solid var(--stone-3)">${tot}</td></tr>`;
    sumData.push({name:m,days:tot,bt});
  });
  el.innerHTML=h+'</tbody></table>';
  const _monthStr=`${year}-${String(month+1).padStart(2,'0')}`;
  const _tipiDef=[{tp:'Ferie',color:'#A100FF',bg:'rgba(161,0,255,.08)'},{tp:'Permesso/ROL',color:'var(--ok)',bg:'var(--ok-bg)'},{tp:'Malattia',color:'var(--danger)',bg:'var(--danger-bg)'}];
  let _cardsHtml='';
  // Global dayMap across ALL tipos — so cross-type overlaps (es. Ferie + Malattia) vengono rilevate
  const _allMonthEntries=allFer.filter(e=>members.includes(e.user)&&e.end>=_monthStr+'-01'&&e.start<=_monthStr+'-'+String(dim).padStart(2,'0'));
  const _globalDayMap={};
  _allMonthEntries.forEach(e=>{let c=new Date(e.start+'T12:00:00'),en=new Date(e.end+'T12:00:00');while(c<=en){const ds=localDate(c);if(ds.startsWith(_monthStr)){const wd=c.getDay();if(!hol.has(ds)&&wd!==0&&wd!==6){if(!_globalDayMap[ds])_globalDayMap[ds]=[];if(!_globalDayMap[ds].includes(e.user))_globalDayMap[ds].push(e.user);}}c.setDate(c.getDate()+1);}});
  _tipiDef.forEach(({tp,color,bg})=>{
    const entries=allFer.filter(e=>e.tipo===tp&&members.includes(e.user)&&e.end>=_monthStr+'-01'&&e.start<=_monthStr+'-'+String(dim).padStart(2,'0'));
    const tipoUsers=new Set(entries.map(e=>e.user));
    // Overlaps dove almeno un utente ha un'assenza di questo tipo (include cross-tipo)
    const ovDays=Object.entries(_globalDayMap).filter(([,u])=>u.some(n=>tipoUsers.has(n))&&u.some((n,i)=>u.some((m,j)=>j>i&&_shareProject(n,m)))).map(([ds,us])=>[ds,us.filter(n=>us.some(m=>m!==n&&_shareProject(n,m)))]).filter(([,u])=>u.length>1).sort((a,b)=>a[0]<b[0]?-1:1);
    const byUser={};entries.forEach(e=>{if(!byUser[e.user])byUser[e.user]=[];byUser[e.user].push(e);});
    const userKeys=Object.keys(byUser).sort();
    _cardsHtml+=`<div style="margin-bottom:12px;border:1px solid ${color}38;border-radius:var(--r);overflow:hidden">`;
    _cardsHtml+=`<div style="padding:8px 12px;background:${bg};border-bottom:1px solid ${color}30;display:flex;align-items:center;justify-content:space-between"><span style="font-weight:700;color:${color};font-size:.83rem"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:7px;vertical-align:middle"></span>${tp}</span>${entries.length?`<span style="font-size:.73rem;color:${color};font-weight:600">${entries.length} entr${entries.length===1?'ata':'ate'}</span>`:'<span style="font-size:.72rem;color:var(--ink-3)">Nessuna assenza questo mese</span>'}</div>`;
    if(userKeys.length){userKeys.forEach((u,i)=>{const ue=byUser[u],col=colorFor(u);const dateList=(()=>{const pts=[];const noOr=ue.filter(e=>!(tp==='Permesso/ROL'&&e.oraInizio&&e.oraFine)),withOr=ue.filter(e=>tp==='Permesso/ROL'&&e.oraInizio&&e.oraFine);if(noOr.length){const ds=new Set();noOr.forEach(e=>{let c=new Date(e.start+'T12:00:00'),en=new Date(e.end+'T12:00:00');while(c<=en){ds.add(localDate(c));c.setDate(c.getDate()+1);}});const sd=[...ds].sort();let rs=sd[0],re=sd[0];for(let i=1;i<sd.length;i++){const nx=new Date(re+'T12:00:00');nx.setDate(nx.getDate()+1);if(localDate(nx)===sd[i]){re=sd[i];}else{pts.push(rs===re?fmt(rs):fmt(rs)+' → '+fmt(re));rs=re=sd[i];}}if(sd.length)pts.push(rs===re?fmt(rs):fmt(rs)+' → '+fmt(re));}withOr.forEach(e=>{pts.push(`${e.start===e.end?fmt(e.start):fmt(e.start)+' → '+fmt(e.end)} <span style="background:${color}22;color:${color};border-radius:3px;padding:1px 5px;font-size:.67rem;font-weight:700">${e.oraInizio}–${e.oraFine}</span>`);});return pts.join(' &nbsp;·&nbsp; ');})();_cardsHtml+=`<div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;${i>0?'border-top:1px solid var(--line)':''}"><span style="font-weight:600;color:${col};font-size:.8rem;white-space:nowrap;min-width:100px">${u.split(' ').slice(0,2).join(' ')}</span><span style="font-size:.78rem;color:var(--ink-2);flex:1">${dateList}</span></div>`;});}
    if(ovDays.length){_cardsHtml+=`<div style="padding:8px 12px;background:var(--warn-bg);border-top:1px solid rgba(125,78,0,.15)"><div style="font-weight:600;color:var(--warn);font-size:.76rem;margin-bottom:4px"><i class="fa-solid fa-triangle-exclamation" style="margin-right:4px"></i>Sovrapposizioni (${ovDays.length} giorni)</div>${ovDays.map(([ds,us])=>{const labels=us.map(n=>{const e=_allMonthEntries.find(x=>x.user===n&&x.start<=ds&&x.end>=ds);const t=e?e.tipo:'';return `${n.split(' ').slice(0,2).join(' ')}<span style="font-size:.65rem;color:${TIPO_C(t)};font-weight:600;margin-left:3px">(${t})</span>`;});return `<div style="font-size:.74rem;color:var(--warn);margin-bottom:2px">${fmt(ds)}: ${labels.join(', ')}</div>`;}).join('')}</div>`;}
    else if(entries.length){_cardsHtml+=`<div style="padding:6px 12px;background:var(--ok-bg);border-top:1px solid rgba(0,122,76,.12);font-size:.74rem;color:var(--ok)"><i class="fa-solid fa-check" style="margin-right:5px"></i>Nessuna sovrapposizione</div>`;}
    _cardsHtml+=`</div>`;
  });
  document.getElementById('ferieCalCards').innerHTML=_cardsHtml;
  document.getElementById('ferieCalOverlaps').innerHTML='';
}
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
  const tlHtml=tls.length?` <span style="font-size:.67rem;color:var(--amber);font-weight:600">→ ${tls.map(t=>t.split(' ')[0]).join(', ')}</span>`:'';
  tag.innerHTML=`<i class="fa-solid fa-folder" style="font-size:.7rem"></i> ${value}${tlHtml}<button type="button" onclick="removeProgettoTag(this,'${prefix}')" title="Rimuovi">✕</button>`;
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
  chip.innerHTML=`<i class="fa-solid fa-user-tie" style="font-size:.65rem"></i>${name}<button type="button" onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--amber);padding:0;line-height:1;font-size:.85rem;margin-left:2px">×</button>`;
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
  el.innerHTML=`<div style="font-size:.72rem;color:var(--amber);font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:9px">${staffed.length} risorsa${staffed.length!==1?'e':''} su ${prj} · TL: ${tlLabel}</div>`+staffed.map(r=>`<div class="resource-row"><div><div class="rname">${r.fullName}</div><div class="rmeta">${(r.progetti||[]).join(', ')||'—'}</div></div></div>`).join('');
}
async function populateSearchByProject(){const sel=document.getElementById('searchByProject');if(!sel)return;const prjs=(isTeamLead&&!isAdmin)?_getManagerProjects():(await getProjects()).sort();const cur=sel.value;sel.innerHTML='<option value="">— Seleziona —</option>';prjs.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;if(p===cur)o.selected=true;sel.appendChild(o);});}
function _getManagerProjects(){const myResPrjs=new Set(RESOURCES.filter(r=>r.managerName===currentUser).flatMap(r=>r.progetti||[]));return(_cache.prj||[]).filter(p=>myResPrjs.has(p)).sort();}
async function renderProjectList(){
  const prjsFull=(isTeamLead&&!isAdmin)?_getManagerProjects():(_cache.prj||[]).slice().sort();const el=document.getElementById('prjList');if(!el)return;
  if(!prjsFull.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessun progetto.</p>';return;}
  const tlOptsList=RESOURCES.map(r=>`<option value="${r.fullName.replace(/"/g,'&quot;')}">${r.fullName}</option>`).join('');
  el.innerHTML=prjsFull.map(p=>{
    const pid=_prjIdByName[p]||0,currentTLs=_prjTLsByName[p]||[];
    const pSafe=p.replace(/'/g,"\\'");
    const tipi=_cache.repTipi[String(pid)]||[];
    const tipiTags=tipi.length?tipi.map(t=>`<span style="background:var(--info-bg);color:var(--info);border-radius:4px;padding:1px 7px;font-size:.7rem;display:inline-flex;align-items:center;gap:3px">${t} <button onclick="removeRepTipoUI(${pid},'${t.replace(/'/g,"\\'")}')" style="background:none;border:none;cursor:pointer;color:var(--info);padding:0;line-height:1;font-size:.75rem">×</button></span>`).join(''):'<span style="font-size:.7rem;color:var(--ink-3);font-style:italic">predefinita</span>';
    const tlChips=currentTLs.map(tl=>`<span style="display:inline-flex;align-items:center;gap:4px;background:var(--amber-bg);color:var(--amber);border-radius:4px;padding:2px 7px;font-size:.72rem;font-weight:600">${tl.split(' ')[0]} ${tl.split(' ').slice(1).join(' ')} <button onclick="removeProjectTL(${pid},'${tl.replace(/'/g,"\\'")}')" style="background:none;border:none;cursor:pointer;color:var(--amber);padding:0;line-height:1;font-size:.8rem;margin-left:2px">×</button></span>`).join('');
    const addableTLs=tlOptsList.replace(currentTLs.map(tl=>`value="${tl.replace(/"/g,'&quot;')}"`).join('|'),'');
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;background:var(--stone);border-radius:var(--r);margin-bottom:6px;border:1px solid var(--line)">
      <i class="fa-solid fa-folder" style="color:var(--amber);font-size:.8rem;flex-shrink:0"></i>
      <span style="font-size:.85rem;font-weight:500;flex:1;min-width:80px">${p}</span>
      <span style="font-size:.75rem;color:var(--ink-3);white-space:nowrap;flex-shrink:0">WBS:</span>
      <input type="text" placeholder="Codice WBS" value="${(_prjWbsByName[p]||'').replace(/"/g,'&quot;')}" style="font-size:.75rem;padding:2px 6px;border-radius:4px;border:1px solid var(--line);background:var(--white);max-width:120px" onblur="saveProjectWbs(${pid},this.value)" onkeydown="if(event.key==='Enter')saveProjectWbs(${pid},this.value)"/>
      <button class="btn-icon danger" onclick="deleteProject('${pSafe}')"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button>
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
  const managerName=isTeamLead?currentUser:(document.getElementById('resManagerSel')?.value||'');
  const managerRes=managerName?RESOURCES.find(r=>r.fullName===managerName):null;
  const managerId=managerRes?managerRes.id:null;
  const isManager=!!(document.getElementById('resIsManager')?.checked);
  const email=(document.getElementById('resEmail')?.value||'').trim().toLowerCase()||null;
  if(!nome||!cognome){showMsg('addResMsg','Nome e Cognome obbligatori.','err');return;}
  if(!email){showMsg('addResMsg','Email obbligatoria.','err');return;}
  const fn=nome+' '+cognome;if(RESOURCES.find(r=>r.fullName.toLowerCase()===fn.toLowerCase())){showMsg('addResMsg','Risorsa già presente.','err');return;}
  const loadCost=(document.getElementById('resLC')?.value||'').replace(/,/g,'.');
  showSpinner();try{await call('addResource',{nome,cognome,email,progetti,managerId,isManager,loadCost:loadCost!==''?+loadCost:null});await reloadAll();}catch(e){hideSpinner();showMsg('addResMsg','Errore: '+e.message,'err');return;}hideSpinner();
  document.getElementById('resNome').value='';document.getElementById('resCognome').value='';
  if(document.getElementById('resEmail'))document.getElementById('resEmail').value='';
  if(document.getElementById('resLC'))document.getElementById('resLC').value='';
  if(document.getElementById('resIsManager'))document.getElementById('resIsManager').checked=false;
  populateProgettoSelect('res',[]);
  await renderResourceList();refreshDropdowns();checkAlerts();showMsg('addResMsg',fn+' aggiunto/a','ok');
}
async function renderResourceList(){
  const search=(document.getElementById('searchRes')?.value||'').toLowerCase(),lf=document.getElementById('filterResLead')?.value||'';
  const fl=document.getElementById('filterResLead');if(fl){const pv=fl.value;fl.innerHTML='<option value="">Tutti i team lead</option>';getLeads().forEach(l=>{const o=document.createElement('option');o.value=l;o.textContent=l;if(l===pv)o.selected=true;fl.appendChild(o);});}
  const el=document.getElementById('resourceList');if(!el)return;
  if(!RESOURCES.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessuna risorsa ancora.</p>';return;}
  let filtered=RESOURCES.filter(r=>{
    if(isTeamLead&&!isAdmin&&r.managerName!==currentUser)return false;
    if(lf&&!r.progetti.some(p=>(_prjTLsByName[p]||[]).includes(lf)))return false;
    if(search&&!r.fullName.toLowerCase().includes(search))return false;
    return true;
  });
  if(!filtered.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessun risultato.</p>';return;}
  const pwds={};try{const res=await Promise.all(filtered.map(r=>call('userHasPwd',{risorsaId:r.id})));filtered.forEach((r,i)=>{pwds[r.id]=!!res[i];});}catch(e){console.error('stato password',e);}
  let h='';
  filtered.slice().sort((a,b)=>a.fullName.localeCompare(b.fullName)).forEach(r=>{
    const idx=RESOURCES.indexOf(r),hasPwd=!!pwds[r.id];
    const prjMeta=(r.progetti||[]).join(' · ')||'—';
    const mgrBadge=r.isManager?`<span class="badge badge-amber" style="font-size:.68rem"><i class="fa-solid fa-user-tie" style="margin-right:3px"></i>Manager</span> `:'';
    const mgrMeta=r.managerName?`<span style="color:var(--amber);font-size:.72rem"><i class="fa-solid fa-sitemap" style="margin-right:3px"></i>${r.managerName}</span> · `:'';
    const emailMeta=r.email?`<span style="color:var(--ink-3);font-size:.72rem"><i class="fa-solid fa-envelope" style="margin-right:3px"></i>${r.email}</span> · `:'';
    const lcMeta=(isAdmin||isTeamLead)&&r.loadCost!=null?`<span style="color:var(--amber);font-size:.72rem;font-weight:600"><i class="fa-solid fa-euro-sign" style="margin-right:2px"></i>LC: ${r.loadCost}</span> · `:'';
    h+=`<div class="resource-row"><div><div class="rname">${r.fullName} ${mgrBadge}</div><div class="rmeta">${emailMeta}${mgrMeta}${lcMeta}${prjMeta} · <span class="badge ${hasPwd?'badge-ok':'badge-warn'}" style="font-size:.68rem">${hasPwd?'Password impostata':'Nessuna password'}</span></div></div><div class="resource-actions">${!hasPwd?'':`<button class="btn btn-ghost2 btn-sm" onclick="confirmResetPwd(${idx},'${r.fullName.replace(/'/g,"\\'")}')">Reset pwd</button>`}<button class="btn-icon" onclick="startEdit(${idx})"><i class="fa-solid fa-pen" style="font-size:.75rem"></i></button><button class="btn-icon danger" onclick="deleteResource(${idx},'${r.fullName.replace(/'/g,"\\'")}')"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button></div></div>`;
  });
  h+=`<div style="color:var(--ink-3);font-size:.75rem;margin-top:12px">Totale: ${RESOURCES.length} risorsa${RESOURCES.length!==1?'e':''}</div>`;
  el.innerHTML=h;
}
async function confirmResetPwd(idx,name){openModal('Reset password','Resettare la password di "'+name+'"?',async()=>{const rid=RESOURCES[idx].id;await call('resetUserPwd',{risorsaId:rid});await renderResourceList();showMsg('resourceMsg','Password di '+name+' resettata.','ok');},'Reset');}
function startEdit(idx){
  const r=RESOURCES[idx];
  document.getElementById('editIdx').value=idx;
  document.getElementById('editNome').value=r.nome;
  document.getElementById('editCognome').value=r.cognome;
  populateProgettoSelect('edit',r.progetti||[r.progetto].filter(Boolean));
  const eeEl=document.getElementById('editEmail');if(eeEl)eeEl.value=r.email||'';
  const emSel=document.getElementById('editManagerSel');if(emSel)emSel.value=r.managerName||'';
  const emChk=document.getElementById('editIsManager');if(emChk)emChk.checked=!!r.isManager;
  const elcEl=document.getElementById('editLC');if(elcEl)elcEl.value=r.loadCost!=null?r.loadCost:'';
  const ec=document.getElementById('editCard');ec.style.display='block';
  const eb=ec.querySelector('.acc-body'),ebtn=ec.querySelector('.acc-toggle');
  if(eb&&!eb.classList.contains('open')){eb.classList.add('open');if(ebtn)ebtn.innerHTML='<i class="fa-solid fa-chevron-up"></i>';}
  ec.scrollIntoView({behavior:'smooth',block:'nearest'});
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
  showSpinner();try{await call('saveEdit',{id:rid,nome,cognome,email,progetti,managerId,isManager,loadCost:loadCost!==''?+loadCost:null});await reloadAll();}catch(e){hideSpinner();showMsg('editMsg','Errore: '+e.message,'err');return;}hideSpinner();
  document.getElementById('editCard').style.display='none';await renderResourceList();refreshDropdowns();showMsg('resourceMsg',newFN+' aggiornato/a','ok');
}
async function deleteResource(idx,name){openModal('Elimina risorsa','Eliminare "'+name+'"? Verranno rimossi ore, ferie e reperibilità associati.',async()=>{const rid=RESOURCES[idx].id;showSpinner();try{await call('deleteResource',{id:rid});await reloadAll();}catch(e){hideSpinner();showMsg('resourceMsg','Errore: '+e.message,'err');return;}hideSpinner();await renderResourceList();refreshDropdowns();showMsg('resourceMsg',name+' eliminato/a.','ok');},'Elimina');}
async function changeAdminPwd(){const p1=document.getElementById('newPwd1').value,p2=document.getElementById('newPwd2').value;if(!p1){showMsg('pwdMsg','Inserisci la nuova password.','err');return;}if(p1!==p2){showMsg('pwdMsg','Le password non coincidono.','err');return;}if(p1.length<6){showMsg('pwdMsg','Minimo 6 caratteri.','err');return;}showSpinner();try{await call('setAdminPwd',{hash:simpleHash(p1)});}catch(e){hideSpinner();showMsg('pwdMsg','Errore: '+e.message,'err');return;}hideSpinner();document.getElementById('newPwd1').value='';document.getElementById('newPwd2').value='';showMsg('pwdMsg','Password aggiornata','ok');}
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
// REPERIBILITA
async function getRepStore(){return(_read(K_REP,[])||[]).map(rp=>{const r=RESOURCES.find(x=>x.id===rp.risorsaId);return r?{id:rp.id,fullName:r.fullName,progetto:rp.progetto,etichetta:rp.etichetta||'',teamLead:rp.teamLead||'',anno:rp.anno,mese:rp.mese,giorni:Array.isArray(rp.giorni)?rp.giorni:[]}:null;}).filter(Boolean);}
async function repForUser(fullName){const all=await getRepStore();return all.filter(r=>r.fullName===fullName);}
let _repGridData={};let _repExtraResources=[];let _repExtraProject='';let _repHiddenResources=new Set();
function calcRepEarningsFromDays(days,anno,mese){const hol=getHol(anno);return days.reduce((tot,d)=>{const dt=new Date(anno,mese,d),wd=dt.getDay(),ds=localDate(dt);return tot+(wd===0||wd===6||hol.has(ds)?40:25);},0);}
function calcRepEarnings(resourceName,year,month,etichetta){const gd=_repGridData[etichetta]?.[resourceName];if(!gd)return 0;return calcRepEarningsFromDays([...gd.selectedDays],year,month);}
async function initRepPanel(){
  const now=new Date();
  if(isProjectTL||isAdmin){
    document.getElementById('repUserView').style.display='none';document.getElementById('repLeadView').style.display='block';
    const mOpts=MONTHS.map((m,i)=>({v:i,l:m})),yOpts=[-1,0,1].map(d=>{const y=now.getFullYear()+d;return{v:y,l:y};});
    popSel('repMonth',mOpts,now.getMonth());popSel('repYear',yOpts,now.getFullYear());
    const team=isAdmin?RESOURCES:RESOURCES.filter(r=>(r.progetti||[]).some(p=>(_prjTLsByName[p]||[]).includes(currentUser)));
    const rFilt=document.getElementById('repFilterRisorsa');rFilt.innerHTML='<option value="">Tutte le risorse</option>';team.forEach(r=>{const o=document.createElement('option');o.value=r.fullName;o.textContent=r.fullName;rFilt.appendChild(o);});
    const yFilt=document.getElementById('repFilterAnno');yFilt.innerHTML='<option value="">Tutti gli anni</option>';yOpts.forEach(({v,l})=>{const o=document.createElement('option');o.value=v;o.textContent=l;yFilt.appendChild(o);});
    const mFilt=document.getElementById('repFilterMese');mFilt.innerHTML='<option value="">Tutti i mesi</option>';mOpts.forEach(({v,l})=>{const o=document.createElement('option');o.value=v;o.textContent=l;mFilt.appendChild(o);});
    mFilt.value=now.getMonth();
    yFilt.value=now.getFullYear();
    const myPrjs=isAdmin?await getProjects():Object.entries(_prjTLsByName).filter(([,tls])=>tls.includes(currentUser)).map(([p])=>p).sort();
    const repPrjSel=document.getElementById('repProgetto');repPrjSel.innerHTML='<option value="">— Seleziona —</option>';myPrjs.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;repPrjSel.appendChild(o);});
    await buildRepGriglia();await renderRepTeam();
  }else{document.getElementById('repUserView').style.display='block';document.getElementById('repLeadView').style.display='none';const mOpts=MONTHS.map((m,i)=>({v:i,l:m})),yOpts=[-1,0,1].map(d=>{const y=now.getFullYear()+d;return{v:y,l:y};});popSel('repUserMonth',mOpts,now.getMonth());popSel('repUserYear',yOpts,now.getFullYear());await renderRepMine();}
}
async function ferieGiorniSet(fullName,year,month){const r=RESOURCES.find(x=>x.fullName===fullName);const mine=r?(_read(K_FER,[])||[]).filter(f=>f.risorsaId===r.id):[];const set=new Set();mine.forEach(e=>{let cur=new Date(e.start+'T12:00:00'),en=new Date(e.end+'T12:00:00');while(cur<=en){if(cur.getFullYear()===year&&cur.getMonth()===month)set.add(cur.getDate());cur.setDate(cur.getDate()+1);}});return set;}
async function buildRepGriglia(){
  const progetto=document.getElementById('repProgetto').value,month=+document.getElementById('repMonth').value,year=+document.getElementById('repYear').value;
  const wrap=document.getElementById('repGrigliaWrap');
  if(!progetto){wrap.style.display='none';_repGridData={};return;}
  if(progetto!==_repExtraProject){_repExtraResources=[];_repExtraProject=progetto;_repHiddenResources=new Set();}
  wrap.style.display='block';
  const allRes=RESOURCES.filter(r=>(r.progetti||[r.progetto]).filter(Boolean).includes(progetto));
  const staffed=(isAdmin?allRes:((_prjTLsByName[progetto]||[]).includes(currentUser)?allRes:allRes.filter(r=>r.fullName===currentUser))).filter(r=>!_repHiddenResources.has(r.fullName));
  const extraRes=_repExtraResources.map(n=>RESOURCES.find(x=>x.fullName===n)).filter(Boolean).filter(r=>!staffed.find(x=>x.id===r.id));
  const resources=[...staffed,...extraRes];
  if(!resources.length){document.getElementById('repGriglia').innerHTML='<p style="color:var(--ink-3);font-size:.84rem;padding:12px">Nessuna risorsa del tuo team su questo progetto.</p>';_repGridData={};return;}
  const tipi=getRepTipiForPrj(progetto);
  const dim=new Date(year,month+1,0).getDate(),hol=getHol(year);
  const DN=['D','L','M','M','G','V','S'];
  _repGridData={};
  const freshRep=await call('getRepForProject',{progetto,anno:year,mese:month});
  console.log('[REP] getRepForProject →',{progetto,anno:year,mese:month},'risultato:',freshRep);
  // Chiave composta risorsaId|etichetta per supportare multi-turno
  const repByResEti={};freshRep.forEach(rp=>{repByResEti[`${rp.risorsaId}|${rp.etichetta||''}`]=new Set(rp.giorni);});
  for(const etichetta of tipi){
    _repGridData[etichetta]={};
    for(const r of resources){
      const ferieSet=await ferieGiorniSet(r.fullName,year,month);
      const existingDays=repByResEti[`${r.id}|${etichetta}`]||new Set();
      _repGridData[etichetta][r.fullName]={ferieSet,selectedDays:new Set(existingDays),savedDays:new Set(existingDays),rid:r.id};
    }
  }
  let h='';
  for(const etichetta of tipi){
    const etiKey=etichetta||'main';
    if(tipi.length>1||etichetta){h+=`<div style="font-weight:700;font-size:.82rem;color:var(--ink);margin:12px 0 6px;border-bottom:2px solid var(--ink);padding-bottom:4px">${etichetta||'Reperibilità'}</div>`;}
    h+=`<div style="overflow-x:auto;margin-bottom:16px"><table style="border-collapse:collapse;font-size:.72rem;width:100%"><thead><tr>`;
    h+=`<th style="padding:5px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;min-width:90px;position:sticky;left:0;z-index:1">Risorsa</th>`;
    for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6;
      h+=`<th style="padding:2px 1px;background:${ih?'var(--amber-bg)':iw?'rgba(161,0,255,.12)':'var(--ink)'};color:${ih?'var(--amber)':iw?'var(--amber)':'var(--white)'};text-align:center;min-width:24px;font-weight:${ih||iw?600:500};font-size:.6rem"><div>${DN[wd]}</div><div>${d}</div></th>`;}
    h+=`<th style="padding:5px 4px;background:var(--ink);color:var(--white);text-align:center;min-width:32px;font-size:.65rem">Gg</th>`;
    h+=`<th style="padding:5px 8px;background:var(--ink);color:var(--white);text-align:right;min-width:70px;white-space:nowrap;font-size:.65rem">Guadagno</th></tr></thead><tbody>`;
    resources.forEach((r,ri)=>{
      const gd=_repGridData[etichetta][r.fullName];
      const etiEsc=etichetta.replace(/'/g,"\\'");
      h+=`<tr style="background:${ri%2?'var(--stone)':'var(--white)'}">`;
      h+=`<td style="padding:5px 8px 5px 10px;font-weight:600;font-size:.74rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit"><div style="display:flex;align-items:center;gap:6px"><div style="line-height:1.35">${r.fullName.split(' ')[0]}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${r.fullName.split(' ').slice(1).join(' ')}</span></div><button onclick="removeRepResource('${r.fullName.replace(/'/g,"\\'")}',event)" title="Rimuovi dalla griglia" style="flex-shrink:0;background:none;border:1px solid transparent;cursor:pointer;color:var(--ink-3);font-size:.7rem;line-height:1;padding:2px 4px;border-radius:3px" onmouseover="this.style.color='var(--danger)';this.style.borderColor='var(--danger)'" onmouseout="this.style.color='var(--ink-3)';this.style.borderColor='transparent'">✕</button></div></td>`;
      for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6,isFerie=gd.ferieSet.has(d),isSel=gd.selectedDays.has(d);
        if(isFerie){h+=`<td style="background:var(--danger-bg);border:1px solid rgba(201,0,60,.2);padding:3px 1px;text-align:center" title="${isSel?'In ferie · Reperibilità assegnata':'In ferie – clicca per assegnare comunque'}"><div class="rep-day ferie-ov${isSel?' on':''}" id="rd_${r.id}_${d}_${etiKey}" onclick="toggleRepDayGrid('${r.fullName.replace(/'/g,"\\'")}',${d},'${etiEsc}')"><span class="rep-ferie-badge">F</span></div></td>`;}
        else{h+=`<td style="border:1px solid var(--line);padding:3px 1px;text-align:center;background:${ih?'var(--amber-bg)':iw?'rgba(161,0,255,.05)':'var(--stone)'}"><div class="rep-day${ih?' festivo':iw?' weekend':''}${isSel?' on':''}" id="rd_${r.id}_${d}_${etiKey}" onclick="toggleRepDayGrid('${r.fullName.replace(/'/g,"\\'")}',${d},'${etiEsc}')"></div></td>`;}
      }
      const earn=calcRepEarnings(r.fullName,year,month,etichetta);
      h+=`<td id="repgg_${r.id}_${etiKey}" class="rep-earn-gg">${gd.selectedDays.size}</td>`;
      h+=`<td id="repeur_${r.id}_${etiKey}" class="rep-earn" style="padding:5px 8px;text-align:right;border-left:1px solid var(--stone-3)">€${earn}</td></tr>`;
    });
    let initGg=0,initEur=0;
    for(const[,gd]of Object.entries(_repGridData[etichetta])){initGg+=gd.selectedDays.size;initEur+=calcRepEarningsFromDays([...gd.selectedDays],year,month);}
    h+=`</tbody><tfoot><tr style="background:var(--stone-2);border-top:2px solid var(--stone-3)">`;
    h+=`<td style="position:sticky;left:0;background:var(--stone-2);padding:5px 10px;font-weight:700;font-size:.74rem;color:var(--ink)">Totale</td>`;
    h+=`<td colspan="${dim}" style="background:var(--stone-2)"></td>`;
    h+=`<td id="reptot_gg_${etiKey}" style="text-align:center;font-weight:700;font-size:.72rem;padding:5px 4px">${initGg}</td>`;
    h+=`<td id="reptot_eur_${etiKey}" style="text-align:right;font-weight:700;font-size:.72rem;color:var(--ok);padding:5px 8px;border-left:1px solid var(--stone-3)">€${initEur}</td>`;
    h+=`</tr></tfoot></table></div>`;
  }
  // ── riepilogo per risorsa (somma di tutti i turni) ──
  h+=`<div style="margin-top:14px"><div style="font-size:.74rem;font-weight:700;color:var(--ink-2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Totale per risorsa</div><div style="display:flex;flex-wrap:wrap;gap:8px">`;
  resources.forEach(r=>{
    let resGg=0,resEur=0;
    for(const eti of tipi){const gd=_repGridData[eti]?.[r.fullName];if(gd){resGg+=gd.selectedDays.size;resEur+=calcRepEarningsFromDays([...gd.selectedDays],year,month);}}
    h+=`<div style="background:var(--stone-1);border:1px solid var(--stone-3);border-radius:var(--r);padding:7px 12px;min-width:150px">`;
    h+=`<div style="font-size:.74rem;font-weight:600;color:var(--ink);margin-bottom:2px">${r.fullName}</div>`;
    h+=`<div style="font-size:.72rem;color:var(--ink-3)"><span id="reptot_res_gg_${r.id}" style="font-weight:700;color:var(--ink)">${resGg}</span> gg&nbsp;·&nbsp;<span id="reptot_res_eur_${r.id}" style="font-weight:700;color:var(--ok)">€${resEur}</span></div>`;
    h+=`</div>`;
  });
  h+=`</div></div>`;
  let grandGg=0,grandEur=0;
  for(const[,gb]of Object.entries(_repGridData)){for(const[,gd]of Object.entries(gb)){grandGg+=gd.selectedDays.size;grandEur+=calcRepEarningsFromDays([...gd.selectedDays],year,month);}}
  h+=`<div style="margin-top:10px;padding:10px 16px;background:var(--ink);color:var(--white);border-radius:var(--r);display:flex;align-items:center;gap:12px;font-size:.83rem;flex-wrap:wrap"><i class="fa-solid fa-sigma" style="color:var(--amber)"></i><span style="opacity:.75">Totale assegnato:</span><span id="repGrandTotalGg" style="font-weight:700">${grandGg}</span><span style="opacity:.5">giorni ·</span><span id="repGrandTotalEur" style="color:var(--amber);font-weight:700">€${grandEur}</span></div>`;
  const _inGrid=new Set(resources.map(r=>r.fullName));
  const _avail=RESOURCES.filter(r=>!_inGrid.has(r.fullName));
  if(_avail.length){h+=`<div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><select id="repAddExtraSelect" style="font-size:.8rem;padding:5px 8px;border:1px solid var(--line-s);border-radius:var(--r);background:var(--white);color:var(--ink);min-width:180px"><option value="">— Aggiungi risorsa —</option>${_avail.map(r=>`<option value="${r.fullName.replace(/"/g,'&quot;')}">${r.fullName}${_repHiddenResources.has(r.fullName)?' (nascosta)':''}</option>`).join('')}</select><button class="btn btn-ghost2 btn-sm" onclick="addExtraRepResource()"><i class="fa-solid fa-user-plus"></i> Aggiungi</button></div>`;}
  document.getElementById('repGriglia').innerHTML=h;
  const mFilt=document.getElementById('repFilterMese'),yFilt=document.getElementById('repFilterAnno');
  if(mFilt)mFilt.value=month;
  if(yFilt)yFilt.value=year;
  await renderRepTeam();
}
function addExtraRepResource(){const sel=document.getElementById('repAddExtraSelect');if(!sel||!sel.value)return;const name=sel.value;_repHiddenResources.delete(name);if(!_repExtraResources.includes(name))_repExtraResources.push(name);buildRepGriglia();}
function removeRepResource(name,e){if(e)e.stopPropagation();const ei=_repExtraResources.indexOf(name);if(ei!==-1)_repExtraResources.splice(ei,1);else _repHiddenResources.add(name);buildRepGriglia();}
async function toggleRepDayGrid(resourceName,d,etichetta){
  etichetta=etichetta||'';
  const gd=_repGridData[etichetta]?.[resourceName];if(!gd)return;
  const r=RESOURCES.find(x=>x.fullName===resourceName);if(!r)return;
  const etiKey=etichetta||'main';
  const el=document.getElementById(`rd_${r.id}_${d}_${etiKey}`);if(!el)return;
  const wasOn=gd.selectedDays.has(d);
  if(wasOn){gd.selectedDays.delete(d);el.classList.remove('on');}
  else{gd.selectedDays.add(d);el.classList.add('on');}
  const month=+document.getElementById('repMonth').value,year=+document.getElementById('repYear').value;
  const earn=calcRepEarnings(resourceName,year,month,etichetta);
  const ggEl=document.getElementById(`repgg_${r.id}_${etiKey}`),eurEl=document.getElementById(`repeur_${r.id}_${etiKey}`);
  if(ggEl)ggEl.textContent=gd.selectedDays.size;
  if(eurEl)eurEl.textContent=`€${earn}`;
  updateRepTotals();
  const progetto=document.getElementById('repProgetto').value;
  const tlName=(currentUser&&currentUser!=='ADMIN')?currentUser:null;
  const giorni=[...gd.selectedDays].sort((a,b)=>a-b);
  try{
    const saved=await call('saveRep',{risorsaId:r.id,progetto,etichetta,teamLead:tlName,anno:year,mese:month,giorni});
    console.log('[REP] saveRep ok →',saved);
    gd.savedDays=new Set(gd.selectedDays);
  }catch(e){
    if(wasOn){gd.selectedDays.add(d);el.classList.add('on');}else{gd.selectedDays.delete(d);el.classList.remove('on');}
    if(ggEl)ggEl.textContent=gd.selectedDays.size;
    updateRepTotals();
    alert('ERRORE salvataggio reperibilità:\n'+e.message);
  }
}
async function applyRepRange(){
  const start=document.getElementById('repRangeStart').value,end=document.getElementById('repRangeEnd').value;
  const month=+document.getElementById('repMonth').value,year=+document.getElementById('repYear').value;
  if(!start||!end){showMsg('repMsg','Inserisci date inizio e fine.','err');return;}
  if(end<start){showMsg('repMsg','Data fine deve essere >= inizio.','err');return;}
  let cur=new Date(start+'T12:00:00'),en=new Date(end+'T12:00:00');
  while(cur<=en){
    if(cur.getFullYear()===year&&cur.getMonth()===month){
      const d=cur.getDate();
      for(const[etichetta,gridByName]of Object.entries(_repGridData)){
        const etiKey=etichetta||'main';
        for(const[name,gd]of Object.entries(gridByName)){
          if(!gd.ferieSet.has(d)){
            gd.selectedDays.add(d);
            const r=RESOURCES.find(x=>x.fullName===name);
            if(r){const el=document.getElementById(`rd_${r.id}_${d}_${etiKey}`);if(el)el.classList.add('on');}
          }
        }
      }
    }
    cur.setDate(cur.getDate()+1);
  }
  for(const[etichetta,gridByName]of Object.entries(_repGridData)){
    const etiKey=etichetta||'main';
    for(const[name,gd]of Object.entries(gridByName)){
      const r=RESOURCES.find(x=>x.fullName===name);if(!r)continue;
      const earn=calcRepEarnings(name,year,month,etichetta);
      const ggEl=document.getElementById(`repgg_${r.id}_${etiKey}`),eurEl=document.getElementById(`repeur_${r.id}_${etiKey}`);
      if(ggEl)ggEl.textContent=gd.selectedDays.size;if(eurEl)eurEl.textContent=`€${earn}`;
    }
  }
  updateRepTotals();
}
function clearRepGriglia(){
  const month=+document.getElementById('repMonth').value,year=+document.getElementById('repYear').value;
  const dim=new Date(year,month+1,0).getDate();
  for(const[etichetta,gridByName]of Object.entries(_repGridData)){
    const etiKey=etichetta||'main';
    for(const[name,gd]of Object.entries(gridByName)){
      gd.selectedDays=new Set();
      const r=RESOURCES.find(x=>x.fullName===name);if(!r)continue;
      for(let d=1;d<=dim;d++){const el=document.getElementById(`rd_${r.id}_${d}_${etiKey}`);if(el)el.classList.remove('on');}
      const ggEl=document.getElementById(`repgg_${r.id}_${etiKey}`),eurEl=document.getElementById(`repeur_${r.id}_${etiKey}`);
      if(ggEl)ggEl.textContent='0';if(eurEl)eurEl.textContent='€0';
    }
  }
  updateRepTotals();
}
function updateRepTotals(){
  const month=+document.getElementById('repMonth').value,year=+document.getElementById('repYear').value;
  let grandGg=0,grandEur=0;
  const perRes={};
  for(const[etichetta,gridByName]of Object.entries(_repGridData)){
    const etiKey=etichetta||'main';
    let totGg=0,totEur=0;
    for(const[name,gd]of Object.entries(gridByName)){
      const gg=gd.selectedDays.size,eur=calcRepEarnings(name,year,month,etichetta);
      totGg+=gg;totEur+=eur;
      const r=RESOURCES.find(x=>x.fullName===name);if(!r)continue;
      if(!perRes[r.id]){perRes[r.id]={gg:0,eur:0};}
      perRes[r.id].gg+=gg;perRes[r.id].eur+=eur;
    }
    grandGg+=totGg;grandEur+=totEur;
    const tGgEl=document.getElementById(`reptot_gg_${etiKey}`),tEurEl=document.getElementById(`reptot_eur_${etiKey}`);
    if(tGgEl)tGgEl.textContent=totGg;
    if(tEurEl)tEurEl.textContent=`€${totEur}`;
  }
  for(const[rid,tot]of Object.entries(perRes)){
    const rGgEl=document.getElementById(`reptot_res_gg_${rid}`),rEurEl=document.getElementById(`reptot_res_eur_${rid}`);
    if(rGgEl)rGgEl.textContent=tot.gg;
    if(rEurEl)rEurEl.textContent=`€${tot.eur}`;
  }
  const gGgEl=document.getElementById('repGrandTotalGg'),gEurEl=document.getElementById('repGrandTotalEur');
  if(gGgEl)gGgEl.textContent=grandGg;
  if(gEurEl)gEurEl.textContent=`€${grandEur}`;
}
async function saveReperibilita(){
  const progetto=document.getElementById('repProgetto').value,month=+document.getElementById('repMonth').value,year=+document.getElementById('repYear').value;
  if(!progetto){showMsg('repMsg','Seleziona il progetto.','err');return;}
  let hasAny=false;
  for(const[,gridByName]of Object.entries(_repGridData)){for(const[,gd]of Object.entries(gridByName)){if(gd.selectedDays.size>0){hasAny=true;break;}}if(hasAny)break;}
  if(!hasAny){showMsg('repMsg','Seleziona almeno un giorno per almeno una risorsa.','err');return;}
  const tlName=(currentUser&&currentUser!=='ADMIN')?currentUser:null;
  const savedNames=new Set();
  showSpinner();
  try{
    for(const[etichetta,gridByName]of Object.entries(_repGridData)){
      for(const[name,gd]of Object.entries(gridByName)){
        if(gd.selectedDays.size===0)continue;
        const rRes=RESOURCES.find(x=>x.fullName===name);if(!rRes?.id)continue;
        const giorni=[...gd.selectedDays].sort((a,b)=>a-b);
        await call('saveRep',{risorsaId:rRes.id,progetto,etichetta,teamLead:tlName,anno:year,mese:month,giorni});
        savedNames.add(name.split(' ')[0]);
      }
    }
    await reloadAll();
  }catch(e){hideSpinner();showMsg('repMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  showMsg('repMsg','Reperibilità salvata per '+[...savedNames].join(', '),'ok');
  // Aggiorna solo savedDays senza ricostruire la griglia (i checkbox restano visibili)
  const existingRep=_cache.rep||[];
  for(const[etichetta,gridByName]of Object.entries(_repGridData)){
    for(const[name,gd]of Object.entries(gridByName)){
      const r=RESOURCES.find(x=>x.fullName===name);if(!r)continue;
      const existing=existingRep.filter(rp=>rp.risorsaId===r.id&&rp.anno===year&&rp.mese===month&&rp.progetto===progetto&&(rp.etichetta||'')===(etichetta||''));
      gd.savedDays=new Set(existing.flatMap(rp=>rp.giorni));
    }
  }
  await renderRepTeam();
}
async function renderRepTeam(){
  const fRis=document.getElementById('repFilterRisorsa')?.value||'',fAnno=document.getElementById('repFilterAnno')?.value||'',fMese=document.getElementById('repFilterMese')?.value;
  const selProgetto=document.getElementById('repProgetto')?.value||'';
  const teamNames=isAdmin?RESOURCES.map(r=>r.fullName):RESOURCES.filter(r=>(r.progetti||[]).some(p=>(_prjTLsByName[p]||[]).includes(currentUser))).map(r=>r.fullName);
  const myProjects=isAdmin?null:new Set(Object.entries(_prjTLsByName).filter(([,tls])=>tls.includes(currentUser)).map(([p])=>p));
  let filtered=(await getRepStore()).filter(r=>{if(!isAdmin){if(!teamNames.includes(r.fullName))return false;if(!myProjects.has(r.progetto))return false;}if(selProgetto&&r.progetto!==selProgetto)return false;if(fRis&&r.fullName!==fRis)return false;if(fAnno&&+r.anno!==+fAnno)return false;if(fMese!==''&&fMese!==undefined&&+r.mese!==+fMese)return false;return true;});
  const el=document.getElementById('repTeamList');
  if(!filtered.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessuna reperibilità trovata.</p>';return;}
  const ferieMap={};
  await Promise.all([...new Set(filtered.map(r=>r.fullName+'|'+r.anno+'|'+r.mese))].map(async key=>{const[fn,a,m]=key.split('|');ferieMap[key]=await ferieGiorniSet(fn,+a,+m);}));
  const totGiorni=filtered.reduce((s,r)=>s+r.giorni.length,0);
  const totEuro=filtered.reduce((s,r)=>s+calcRepEarningsFromDays(r.giorni,r.anno,r.mese),0);
  const totConflitti=filtered.reduce((s,r)=>s+r.giorni.filter(d=>(ferieMap[r.fullName+'|'+r.anno+'|'+r.mese]||new Set()).has(d)).length,0);
  let html=`<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
    <div style="background:var(--ok-bg);border:1px solid rgba(45,106,79,.2);border-radius:var(--r);padding:10px 16px;flex:1;min-width:120px">
      <div style="font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--ok);margin-bottom:3px">Totale guadagno</div>
      <div style="font-size:1.4rem;font-weight:700;color:var(--ok);font-family:var(--f-display)">€${totEuro}</div>
    </div>
    <div style="background:var(--info-bg);border:1px solid rgba(26,78,122,.15);border-radius:var(--r);padding:10px 16px;flex:1;min-width:120px">
      <div style="font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--info);margin-bottom:3px">Giorni totali</div>
      <div style="font-size:1.4rem;font-weight:700;color:var(--info);font-family:var(--f-display)">${totGiorni}</div>
    </div>
    ${totConflitti?`<div style="background:var(--warn-bg);border:1px solid rgba(125,78,0,.2);border-radius:var(--r);padding:10px 16px;flex:1;min-width:120px"><div style="font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--warn);margin-bottom:3px">Conflitti ferie</div><div style="font-size:1.4rem;font-weight:700;color:var(--warn);font-family:var(--f-display)">${totConflitti}</div></div>`:''}
  </div>`;
  const DN=['D','L','M','M','G','V','S'];
  const byPrj={};
  filtered.forEach(r=>{if(!byPrj[r.progetto])byPrj[r.progetto]={};const k=`${r.anno}|${r.mese}`;if(!byPrj[r.progetto][k])byPrj[r.progetto][k]=[];byPrj[r.progetto][k].push(r);});
  for(const [progetto,byMese] of Object.entries(byPrj).sort(([a],[b])=>a.localeCompare(b))){
    const tls=_prjTLsByName[progetto]||[];
    const canDelPrj=isAdmin||(isProjectTL&&tls.includes(currentUser));
    html+=`<div style="margin-bottom:24px">`;
    html+=`<div style="font-weight:700;font-size:.82rem;color:var(--ink);margin:0 0 6px;border-bottom:2px solid var(--ink);padding-bottom:4px"><i class="fa-solid fa-folder" style="margin-right:5px;opacity:.6"></i>${progetto}${tls.length?`<span style="font-size:.7rem;font-weight:400;color:var(--ink-3);margin-left:8px">TL: ${tls.join(', ')}</span>`:''}</div>`;
    for(const [meseKey,entries] of Object.entries(byMese).sort(([a],[b])=>{const[ay,am]=a.split('|').map(Number),[by,bm]=b.split('|').map(Number);return ay!==by?ay-by:am-bm;})){
      const anno=+meseKey.split('|')[0],mese=+meseKey.split('|')[1];
      const dim=new Date(anno,mese+1,0).getDate(),holSet=getHol(anno);
      const resOnPrj=RESOURCES.filter(r=>entries.some(e=>e.fullName===r.fullName)).sort((a,b)=>a.fullName.localeCompare(b.fullName));
      const tipiPrj=getRepTipiForPrj(progetto);
      const etichette=tipiPrj[0]!==''?tipiPrj.filter(t=>entries.some(e=>(e.etichetta||'')===t)):[...new Set(entries.map(e=>e.etichetta||''))].sort();
      html+=`<div style="margin-bottom:14px"><div style="font-size:.78rem;font-weight:600;color:var(--ink-2);margin:10px 0 6px">${MONTHS[mese]} ${anno}</div>`;
      for(const eti of etichette){
        const etiEntries=entries.filter(e=>(e.etichetta||'')===eti);
        if(etichette.length>1||eti){html+=`<div style="font-size:.74rem;font-weight:700;color:var(--ink-2);margin:10px 0 4px;padding-left:2px">${eti||'Reperibilità'}</div>`;}
        html+=`<div style="overflow-x:auto;margin-bottom:10px"><table style="border-collapse:collapse;font-size:.72rem;width:100%"><thead><tr>`;
        html+=`<th style="padding:5px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;min-width:90px;position:sticky;left:0;z-index:1">Risorsa</th>`;
        for(let d=1;d<=dim;d++){const dt=new Date(anno,mese,d),wd=dt.getDay(),ds=localDate(dt),ih=holSet.has(ds),iw=wd===0||wd===6;
          html+=`<th style="padding:2px 1px;background:${ih?'var(--amber-bg)':iw?'rgba(161,0,255,.12)':'var(--ink)'};color:${ih||iw?'var(--amber)':'var(--white)'};text-align:center;min-width:24px;font-size:.6rem"><div>${DN[wd]}</div><div>${d}</div></th>`;}
        html+=`<th style="padding:5px 4px;background:var(--ink);color:var(--white);text-align:center;min-width:32px;font-size:.65rem">Gg</th>`;
        html+=`<th style="padding:5px 8px;background:var(--ink);color:var(--white);text-align:right;min-width:70px;white-space:nowrap;font-size:.65rem">Guad.</th>`;
        if(canDelPrj)html+=`<th style="padding:5px 4px;background:var(--ink);color:var(--white);text-align:center;min-width:32px"></th>`;
        html+=`</tr></thead><tbody>`;
        resOnPrj.forEach((r,ri)=>{
          const entry=etiEntries.find(e=>e.fullName===r.fullName);
          const days=entry?new Set(entry.giorni):new Set();
          const ferieSet=ferieMap[r.fullName+'|'+anno+'|'+mese]||new Set();
          html+=`<tr style="background:${ri%2?'var(--stone)':'var(--white)'}">`;
          html+=`<td style="padding:5px 10px;font-weight:600;font-size:.74rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit">${r.fullName.split(' ')[0]}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${r.fullName.split(' ').slice(1).join(' ')}</span></td>`;
          for(let d=1;d<=dim;d++){const dt=new Date(anno,mese,d),wd=dt.getDay(),ds=localDate(dt),ih=holSet.has(ds),iw=wd===0||wd===6,on=days.has(d),isConflict=ferieSet.has(d)&&on;
            html+=`<td style="border:1px solid var(--line);padding:2px 1px;text-align:center;background:${on?(isConflict?'rgba(201,0,60,.12)':'rgba(0,123,255,.12)'):ih?'var(--amber-bg)':iw?'rgba(161,0,255,.05)':'var(--stone)'}">`;
            html+=`<div style="width:14px;height:14px;margin:auto;border-radius:50%;background:${on?(isConflict?'var(--danger)':'var(--info)'):'transparent'};display:flex;align-items:center;justify-content:center;font-size:.55rem;color:white" title="${on?(isConflict?'Reperibilità + ferie!':'assegnato'):''}">`;
            html+=on?(isConflict?'!':'✓'):'';
            html+=`</div></td>`;}
          const earn=entry?calcRepEarningsFromDays(entry.giorni,anno,mese):null;
          html+=`<td style="padding:5px 4px;text-align:center;font-weight:600;font-size:.72rem;color:var(--info)">${entry?days.size:'—'}</td>`;
          html+=`<td style="padding:5px 8px;text-align:right;font-weight:700;font-size:.72rem;border-left:1px solid var(--stone-3);color:${earn!==null&&earn>0?'var(--ok)':'var(--ink-3)'}">${earn!==null?`€${earn}`:'—'}</td>`;
          if(canDelPrj)html+=`<td style="padding:2px 4px;text-align:center">${entry?`<button class="btn-icon danger" onclick="deleteRep(${entry.id},'${r.fullName.replace(/'/g,"\\'")}','${progetto.replace(/'/g,"\\'")}')"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button>`:''}</td>`;
          html+=`</tr>`;
        });
        html+=`</tbody></table></div>`;
      }
      html+=`</div>`;
    }
    html+=`</div>`;
  }
  el.innerHTML=html;
}
async function renderRepMine(){
  const el=document.getElementById('repMyList');
  const monthEl=document.getElementById('repUserMonth'),yearEl=document.getElementById('repUserYear');
  if(!monthEl||!yearEl)return;
  const month=+monthEl.value,year=+yearEl.value;
  const myRes=RESOURCES.find(x=>x.fullName===currentUser);
  if(!myRes){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Risorsa non trovata.</p>';return;}
  const allRep=(_cache.rep||[]).filter(r=>r.anno===year&&r.mese===month);
  const myEntries=allRep.filter(r=>r.risorsaId===myRes.id);
  const myProjects=new Set(myEntries.map(r=>r.progetto));
  if(!myProjects.size){
    const hasAny=(_cache.rep||[]).some(r=>r.risorsaId===myRes.id);
    el.innerHTML=`<p style="color:var(--ink-3);font-size:.84rem">${hasAny?'Nessuna reperibilità assegnata per questo mese.':'Nessuna reperibilità assegnata.'}</p>`;
    return;
  }
  const ferieSet=await ferieGiorniSet(currentUser,year,month);
  const totGiorni=myEntries.reduce((s,r)=>s+r.giorni.length,0);
  const totEuro=myEntries.reduce((s,r)=>s+calcRepEarningsFromDays(r.giorni,year,month),0);
  const totConflitti=myEntries.reduce((s,r)=>s+r.giorni.filter(d=>ferieSet.has(d)).length,0);
  let html=`<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
    <div style="background:var(--ok-bg);border:1px solid rgba(45,106,79,.2);border-radius:var(--r);padding:10px 16px;flex:1;min-width:120px">
      <div style="font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--ok);margin-bottom:3px">Totale guadagno</div>
      <div style="font-size:1.4rem;font-weight:700;color:var(--ok);font-family:var(--f-display)">€${totEuro}</div>
    </div>
    <div style="background:var(--info-bg);border:1px solid rgba(26,78,122,.15);border-radius:var(--r);padding:10px 16px;flex:1;min-width:120px">
      <div style="font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--info);margin-bottom:3px">Giorni totali</div>
      <div style="font-size:1.4rem;font-weight:700;color:var(--info);font-family:var(--f-display)">${totGiorni}</div>
    </div>
    ${totConflitti?`<div style="background:var(--warn-bg);border:1px solid rgba(125,78,0,.2);border-radius:var(--r);padding:10px 16px;flex:1;min-width:120px"><div style="font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--warn);margin-bottom:3px">Conflitti ferie</div><div style="font-size:1.4rem;font-weight:700;color:var(--warn);font-family:var(--f-display)">${totConflitti}</div></div>`:''}
  </div>`;
  const dim=new Date(year,month+1,0).getDate(),hol=getHol(year),DN=['D','L','M','M','G','V','S'];
  for(const progetto of [...myProjects].sort()){
    const projEntries=allRep.filter(r=>r.progetto===progetto);
    const resInProj=RESOURCES.filter(r=>projEntries.some(e=>e.risorsaId===r.id));
    const sorted=[myRes,...resInProj.filter(r=>r.id!==myRes.id)];
    const tls=_prjTLsByName[progetto]||[];
    // Etichette distinte per questo progetto (ordinate; '' viene mostrata senza etichetta)
    const etichette=[...new Set(projEntries.map(e=>e.etichetta||''))].sort();
    html+=`<div style="margin-bottom:18px">`;
    html+=`<div style="font-weight:700;font-size:.82rem;color:var(--ink);margin:0 0 6px;border-bottom:2px solid var(--ink);padding-bottom:4px"><i class="fa-solid fa-folder" style="margin-right:5px;opacity:.6"></i>${progetto}${tls.length?`<span style="font-size:.7rem;font-weight:400;color:var(--ink-3);margin-left:8px">TL: ${tls.join(', ')}</span>`:''}</div>`;
    for(const eti of etichette){
      const etiEntries=projEntries.filter(e=>(e.etichetta||'')===eti);
      if(etichette.length>1||eti){html+=`<div style="font-size:.74rem;font-weight:700;color:var(--ink-2);margin:10px 0 4px;padding-left:2px">${eti||'Reperibilità'}</div>`;}
      html+=`<div style="overflow-x:auto;margin-bottom:10px"><table style="border-collapse:collapse;font-size:.72rem;width:100%"><thead><tr>`;
      html+=`<th style="padding:5px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;min-width:90px;position:sticky;left:0;z-index:1">Risorsa</th>`;
      for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6;
        html+=`<th style="padding:2px 1px;background:${ih?'var(--amber-bg)':iw?'rgba(161,0,255,.12)':'var(--ink)'};color:${ih||iw?'var(--amber)':'var(--white)'};text-align:center;min-width:24px;font-size:.6rem"><div>${DN[wd]}</div><div>${d}</div></th>`;}
      html+=`<th style="padding:5px 4px;background:var(--ink);color:var(--white);text-align:center;min-width:32px;font-size:.65rem">Gg</th>`;
      html+=`<th style="padding:5px 8px;background:var(--ink);color:var(--white);text-align:right;min-width:70px;white-space:nowrap;font-size:.65rem">Guad.</th>`;
      html+=`</tr></thead><tbody>`;
      sorted.forEach((r,ri)=>{
        const entry=etiEntries.find(e=>e.risorsaId===r.id);
        const days=entry?new Set(entry.giorni):new Set();
        const isMe=r.id===myRes.id;
        html+=`<tr style="background:${isMe?'rgba(0,123,255,.06)':ri%2?'var(--stone)':'var(--white)'}">`;
        html+=`<td style="padding:5px 10px;font-weight:${isMe?700:600};font-size:.74rem;color:${isMe?'var(--info)':'var(--ink)'};border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit">${r.fullName.split(' ')[0]}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${r.fullName.split(' ').slice(1).join(' ')}</span>${isMe?` <span style="font-size:.58rem;background:var(--info);color:white;border-radius:3px;padding:1px 4px;vertical-align:middle">tu</span>`:''}</td>`;
        for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6,on=days.has(d),isFerieConflict=isMe&&ferieSet.has(d)&&on;
          html+=`<td style="border:1px solid var(--line);padding:2px 1px;text-align:center;background:${on?(isFerieConflict?'rgba(201,0,60,.12)':'rgba(0,123,255,.12)'):ih?'var(--amber-bg)':iw?'rgba(161,0,255,.05)':'var(--stone)'}">`;
          html+=`<div style="width:14px;height:14px;margin:auto;border-radius:50%;background:${on?(isFerieConflict?'var(--danger)':'var(--info)'):'transparent'};display:flex;align-items:center;justify-content:center;font-size:.55rem;color:white" title="${on?(isFerieConflict?'Reperibilità + ferie!':'assegnato'):''}">`;
          html+=on?(isFerieConflict?'!':'✓'):'';
          html+=`</div></td>`;}
        const earn=isMe&&entry?calcRepEarningsFromDays(entry.giorni,year,month):null;
        html+=`<td style="padding:5px 4px;text-align:center;font-weight:600;font-size:.72rem;color:${isMe?'var(--info)':'var(--ink)'}">${days.size}</td>`;
        html+=`<td style="padding:5px 8px;text-align:right;font-weight:700;font-size:.72rem;border-left:1px solid var(--stone-3);color:${isMe?'var(--ok)':'var(--ink-3)'}">${earn!==null?`€${earn}`:'—'}</td>`;
        html+=`</tr>`;
      });
      html+=`</tbody></table></div>`;
    }
    html+=`</div>`;
  }
  el.innerHTML=html;
}
async function deleteRep(id,name,prog){openModal('Elimina reperibilità','Eliminare la reperibilità di "'+name+'" per "'+prog+'"?',async()=>{showSpinner();try{await call('deleteRep',{id});await reloadAll();}catch(e){hideSpinner();showMsg('repMsg','Errore: '+e.message,'err');return;}hideSpinner();await renderRepTeam();showMsg('repMsg','Reperibilità eliminata.','ok');},'Elimina');}
// OVERVIEW REPERIBILITÀ (solo manager)
async function initRepOverviewPanel(){
  const now=new Date();
  const mOpts=MONTHS.map((m,i)=>({v:i,l:m})),yOpts=[-1,0,1].map(d=>{const y=now.getFullYear()+d;return{v:y,l:y};});
  popSel('repOvMonth',mOpts,now.getMonth());popSel('repOvYear',yOpts,now.getFullYear());
  await renderRepOverview();
}
async function renderRepOverview(){
  const month=+document.getElementById('repOvMonth').value,year=+document.getElementById('repOvYear').value;
  const el=document.getElementById('repOverviewContent');if(!el)return;
  const myResources=isAdmin?RESOURCES:RESOURCES.filter(r=>r.managerName===currentUser);
  const myResIds=new Set(myResources.map(r=>r.id));
  const repEntries=(_cache.rep||[]).filter(r=>r.anno===year&&r.mese===month&&myResIds.has(r.risorsaId));
  if(!repEntries.length){el.innerHTML='<div class="card"><p style="color:var(--ink-3);font-size:.84rem">Nessuna reperibilità trovata per questo mese.</p></div>';return;}
  const byProject={};repEntries.forEach(r=>{if(!byProject[r.progetto])byProject[r.progetto]=[];byProject[r.progetto].push(r);});
  const dim=new Date(year,month+1,0).getDate(),hol=getHol(year),DN=['D','L','M','M','G','V','S'];
  let html='';
  for(const [progetto,entries] of Object.entries(byProject).sort(([a],[b])=>a.localeCompare(b))){
    const resOnPrj=myResources.filter(r=>entries.some(e=>e.risorsaId===r.id));
    const tls=_prjTLsByName[progetto]||[];const tlLabel=tls.length?tls.join(', '):'—';
    html+=`<div class="card" style="margin-bottom:16px">`;
    html+=`<div class="card-title"><i class="fa-solid fa-folder"></i> ${progetto} <span style="font-size:.72rem;color:var(--ink-3);font-weight:400;margin-left:6px">TL: ${tlLabel}</span></div>`;
    html+=`<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:.72rem;width:100%"><thead><tr>`;
    html+=`<th style="padding:5px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;min-width:90px;position:sticky;left:0;z-index:1">Risorsa</th>`;
    for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6;
      html+=`<th style="padding:2px 1px;background:${ih?'var(--amber-bg)':iw?'rgba(161,0,255,.12)':'var(--ink)'};color:${ih||iw?'var(--amber)':'var(--white)'};text-align:center;min-width:24px;font-size:.6rem"><div>${DN[wd]}</div><div>${d}</div></th>`;}
    html+=`<th style="padding:5px 4px;background:var(--ink);color:var(--white);text-align:center;min-width:32px;font-size:.65rem">Gg</th>`;
    if(isAdmin)html+=`<th style="padding:5px 8px;background:var(--ink);color:var(--white);text-align:right;min-width:70px;white-space:nowrap;font-size:.65rem">Guad.</th>`;
    html+=`</tr></thead><tbody>`;
    resOnPrj.forEach((r,ri)=>{
      const entry=entries.find(e=>e.risorsaId===r.id);
      const days=entry?new Set(entry.giorni):new Set();
      html+=`<tr style="background:${ri%2?'var(--stone)':'var(--white)'}">`;
      html+=`<td style="padding:5px 10px;font-weight:600;font-size:.74rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit">${r.fullName.split(' ')[0]}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${r.fullName.split(' ').slice(1).join(' ')}</span></td>`;
      for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6,on=days.has(d);
        html+=`<td style="border:1px solid var(--line);padding:2px 1px;text-align:center;background:${on?'rgba(0,123,255,.12)':ih?'var(--amber-bg)':iw?'rgba(161,0,255,.05)':'var(--stone)'}"><div style="width:14px;height:14px;margin:auto;border-radius:50%;background:${on?'var(--info)':'transparent'};display:flex;align-items:center;justify-content:center;font-size:.55rem;color:white">${on?'✓':''}</div></td>`;}
      html+=`<td style="padding:5px 4px;text-align:center;font-weight:600;font-size:.72rem">${days.size}</td>`;
      if(isAdmin){const earn=entry?calcRepEarningsFromDays(entry.giorni,year,month):0;html+=`<td style="padding:5px 8px;text-align:right;font-weight:700;color:var(--ok);font-size:.72rem;border-left:1px solid var(--stone-3)">€${earn}</td>`;}
      html+=`</tr>`;
    });
    html+=`</tbody></table></div>`;
    const totGg=entries.reduce((s,e)=>s+e.giorni.length,0);
    html+=`<div style="margin-top:10px;padding:8px 12px;background:var(--stone);border-radius:var(--r);display:flex;gap:16px;flex-wrap:wrap;font-size:.78rem">`;
    html+=`<span><b>${resOnPrj.length}</b> risorsa/e</span><span><b>${totGg}</b> giorni totali</span>`;
    if(isAdmin){const totEur=entries.reduce((s,e)=>s+calcRepEarningsFromDays(e.giorni,year,month),0);html+=`<span style="color:var(--ok);font-weight:700">€${totEur} totale</span>`;}
    html+=`</div></div>`;
  }
  el.innerHTML=html;
}
// PRESENZE
// FERIE DAY-CLICK
let _feriePickerDate=null;
function toggleFerieDay(dateStr){
  const r=RESOURCES.find(x=>x.fullName===currentUser);if(!r)return;
  const existing=(_cache.fer||[]).find(f=>f.risorsaId===r.id&&f.start<=dateStr&&f.end>=dateStr);
  if(existing){
    const label=existing.start===existing.end?fmt(dateStr):`${fmt(existing.start)} → ${fmt(existing.end)} (${existing.tipo})`;
    openModal('Rimuovi assenza',`Eliminare l'assenza del ${label}?`,async()=>{
      showSpinner();try{await call('deleteFerie',{id:existing.id});await reloadAll();}catch(e){hideSpinner();showMsg('ferieMsg','Errore: '+e.message,'err');return;}
      hideSpinner();renderFerieCalendar();showMsg('ferieMsg','Assenza rimossa.','ok');
    },'Elimina');
  }else{showFeriePicker(dateStr);}
}
function showFeriePicker(dateStr){
  _feriePickerDate=dateStr;
  const sEl=document.getElementById('feriePickerStart'),eEl=document.getElementById('feriePickerEnd');
  if(sEl)sEl.value=dateStr;
  if(eEl)eEl.value=dateStr;
  document.getElementById('feriePickerOverlay').classList.add('open');
  document.getElementById('feriePickerBox').classList.add('open');
  setTimeout(()=>{if(eEl)eEl.focus();},80);
}
function closeFeriePicker(){
  _feriePickerDate=null;
  document.getElementById('feriePickerOverlay').classList.remove('open');
  document.getElementById('feriePickerBox').classList.remove('open');
  const tr=document.getElementById('feriePermessoTimeRow');if(tr)tr.style.display='none';
}
function showPermessoTime(){
  const tr=document.getElementById('feriePermessoTimeRow');
  if(tr){tr.style.display='flex';const fi=document.getElementById('feriePermessoFrom');if(fi)fi.focus();}
}
async function pickFerieTipo(tipo){
  const dateStr=_feriePickerDate;closeFeriePicker();if(!dateStr)return;
  const r=RESOURCES.find(x=>x.fullName===currentUser);if(!r)return;
  showSpinner();let _nR1;try{_nR1=await call('saveFerie',{risorsaId:r.id,start:dateStr,end:dateStr,tipo,note:null});await reloadAll();}catch(e){hideSpinner();showMsg('ferieMsg','Errore: '+e.message,'err');return;}
  hideSpinner();renderFerieCalendar();showMsg('ferieMsg',tipo+' aggiunto/a. '+_notificaMsg(_nR1),'ok');
}
async function pickFerieTipoRange(tipo){
  const start=document.getElementById('feriePickerStart')?.value||_feriePickerDate;
  const end=document.getElementById('feriePickerEnd')?.value||_feriePickerDate;
  let oraInizio=null,oraFine=null;
  if(tipo==='Permesso/ROL'){
    oraInizio=document.getElementById('feriePermessoFrom')?.value||null;
    oraFine=document.getElementById('feriePermessoTo')?.value||null;
    if(!oraInizio||!oraFine){showMsg('ferieMsg','Inserisci orario di inizio e fine.','err');return;}
    if(oraFine<=oraInizio){showMsg('ferieMsg','Orario fine deve essere successivo all\'inizio.','err');return;}
  }
  closeFeriePicker();
  if(!start||!end){showMsg('ferieMsg','Seleziona le date.','err');return;}
  if(end<start){showMsg('ferieMsg','Data fine deve essere >= inizio.','err');return;}
  const r=RESOURCES.find(x=>x.fullName===currentUser);if(!r)return;
  showSpinner();let _nR2;try{_nR2=await call('saveFerie',{risorsaId:r.id,start,end,tipo,note:null,oraInizio,oraFine});await reloadAll();}catch(e){hideSpinner();showMsg('ferieMsg','Errore: '+e.message,'err');return;}
  hideSpinner();renderFerieCalendar();showMsg('ferieMsg',tipo+' aggiunto/a. '+_notificaMsg(_nR2),'ok');
}
let _presWeekOffset=0;
function _getMonday(offset){const t=new Date(),dow=t.getDay(),diff=dow===0?-6:1-dow,m=new Date(t);m.setDate(t.getDate()+diff+offset*7);m.setHours(0,0,0,0);return m;}
function _getWeekDays(offset){const mon=_getMonday(offset);return Array.from({length:5},(_,i)=>{const d=new Date(mon);d.setDate(mon.getDate()+i);return localDate(d);});}
function prevWeek(){_presWeekOffset--;loadPresenzeAndRender();}
function nextWeek(){_presWeekOffset++;loadPresenzeAndRender();}
async function initPresenzePanel(){_presWeekOffset=0;await loadPresenzeAndRender();}
async function loadPresenzeAndRender(){
  const from=_getWeekDays(_presWeekOffset-1)[0],to=_getWeekDays(_presWeekOffset+1)[4];
  showSpinner();
  try{
    const rows=await call('getPresenze',{from,to});
    rows.forEach(r=>{if(!_cache.pres.some(p=>p.risorsaId===r.risorsa_id&&p.data===r.data)){_cache.pres.push({risorsaId:r.risorsa_id,data:(r.data||'').slice(0,10)});}});
  }catch(e){showMsg('presenzeMsg','Errore caricamento: '+e.message,'err');}
  hideSpinner();
  renderPresenzeGrid();
}
function renderPresenzeGrid(){
  const days=_getWeekDays(_presWeekOffset);
  const mon=_getMonday(_presWeekOffset),fri=new Date(mon);fri.setDate(mon.getDate()+4);
  document.getElementById('presenzeWeekLabel').textContent=`${mon.getDate()} ${MONTHS[mon.getMonth()].slice(0,3)} — ${fri.getDate()} ${MONTHS[fri.getMonth()].slice(0,3)} ${fri.getFullYear()}`;
  const todayStr=localDate(new Date());
  let members=isAdmin?RESOURCES.map(r=>r.fullName):getMyTeamMembers();
  if(!isAdmin&&!members.includes(currentUser))members=[currentUser,...members];
  const presSet=new Set(_cache.pres.map(p=>`${p.risorsaId}|${p.data}`));
  const DN=['Lun','Mar','Mer','Gio','Ven'];
  const colCnt=days.map(d=>members.filter(m=>{const r=RESOURCES.find(x=>x.fullName===m);return r&&presSet.has(`${r.id}|${d}`);}).length);
  let h=`<table style="border-collapse:collapse;font-size:.82rem;width:100%"><thead><tr><th style="padding:8px 12px;text-align:left;border-bottom:2px solid var(--stone-3);min-width:120px;color:var(--ink-3);font-size:.68rem;text-transform:uppercase;letter-spacing:.08em">Risorsa</th>`;
  days.forEach((d,i)=>{
    const dt=new Date(d+'T12:00:00'),isHol=getHol(dt.getFullYear()).has(d),isToday=d===todayStr;
    h+=`<th style="padding:6px 4px;text-align:center;border-bottom:2px solid ${isToday?'var(--amber)':'var(--stone-3)'};min-width:80px"><div style="font-size:.63rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:${isHol?'var(--amber)':isToday?'var(--amber)':'var(--ink-3)'}">${DN[i]}</div><div style="font-size:1.05rem;font-weight:700;color:${isToday?'var(--amber)':'var(--ink)'};margin:2px 0">${dt.getDate()}</div><div style="font-size:.65rem;font-weight:600;color:${isHol?'var(--amber)':colCnt[i]?'var(--ok)':'var(--ink-3);opacity:.5'}">${isHol?'festivo':colCnt[i]?colCnt[i]+' presenti':'—'}</div></th>`;
  });
  h+=`</tr></thead><tbody>`;
  members.forEach((m,mi)=>{
    const r=RESOURCES.find(x=>x.fullName===m);if(!r)return;
    const isMe=!isAdmin&&m===currentUser,color=colorFor(m);
    h+=`<tr style="background:${mi%2?'var(--stone)':'var(--white)'}"><td style="padding:8px 12px;font-weight:${isMe?700:500};border-right:1px solid var(--stone-3);white-space:nowrap"><span style="color:${isMe?'var(--amber)':'var(--ink)'}">${m.split(' ')[0]}${isMe?' ★':''}</span><span style="font-size:.7rem;color:var(--ink-3);display:block;font-weight:400">${m.split(' ').slice(1).join(' ')}</span></td>`;
    days.forEach(d=>{
      const dt=new Date(d+'T12:00:00'),isHol=getHol(dt.getFullYear()).has(d),isPresent=presSet.has(`${r.id}|${d}`);
      if(isHol){h+=`<td style="padding:6px 4px;text-align:center;background:var(--amber-bg)"></td>`;}
      else if(isMe){h+=`<td style="padding:6px 4px;text-align:center" onclick="togglePresenzaDay('${d}',${r.id})"><div class="pres-cell${isPresent?' on':''}" style="color:${color}" id="presCell_${r.id}_${d.replace(/-/g,'_')}">${isPresent?'<i class="fa-solid fa-check"></i>':''}</div></td>`;}
      else{h+=`<td style="padding:6px 4px;text-align:center">${isPresent?`<div style="width:14px;height:14px;border-radius:50%;background:${color};margin:0 auto" title="${m}"></div>`:`<div style="width:14px;height:14px;border-radius:50%;border:1.5px solid var(--stone-3);margin:0 auto;opacity:.35"></div>`}</td>`;}
    });
    h+=`</tr>`;
  });
  document.getElementById('presenzeGrid').innerHTML=h+`</tbody></table>`;
}
async function togglePresenzaDay(dateStr,risorsaId){
  const isPresent=_cache.pres.some(p=>p.risorsaId===risorsaId&&p.data===dateStr);
  showSpinner();
  try{
    if(isPresent){await call('deletePresenza',{risorsaId,data:dateStr});_cache.pres=_cache.pres.filter(p=>!(p.risorsaId===risorsaId&&p.data===dateStr));}
    else{await call('savePresenza',{risorsaId,data:dateStr});_cache.pres.push({risorsaId,data:dateStr});}
  }catch(e){hideSpinner();showMsg('presenzeMsg','Errore: '+e.message,'err');return;}
  hideSpinner();renderPresenzeGrid();
}
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
async function loadConsuntivo(){
  _syncNotifChk();
  const month=+document.getElementById('consuntivoMonth').value;
  const year=+document.getElementById('consuntivoYear').value;
  const el=document.getElementById('consuntivoContent');
  if(!el)return;
  el.innerHTML='<div class="msg">Caricamento...</div>';
  showSpinner();
  let rows;
  try{rows=await call('getConsuntivo',{anno:year,mese:month});}catch(e){hideSpinner();el.innerHTML=`<div class="msg err">Errore: ${e.message}</div>`;return;}
  hideSpinner();
  if(isAdmin||isTeamLead){
    _renderConsuntivoTeam(rows,month,year);
  }else{
    const r=RESOURCES.find(x=>x.fullName===currentUser);
    _renderConsuntivoCollab(rows,month,year,r);
  }
}
// Formatta ore: 8 → "8", 7.5 → "7.5", 0 → ""
function _fmtOre(v){return v===0?'':(v%1===0?String(v):v.toFixed(1));}
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
    h+=`<td style="padding:5px 8px 5px 10px;font-weight:600;font-size:.74rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit"><div style="line-height:1.35">${res.fullName.split(' ')[0]}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${res.fullName.split(' ').slice(1).join(' ')}</span></div></td>`;
    for(let d=1;d<=dim;d++){
      const wd=new Date(year,month,d).getDay(),isWe=wd===0||wd===6;
      const ore=rd[d]||0;
      const bdr=d===15?';border-right:2px solid var(--stone-3)':'';
      const bg=ore?'var(--ok-bg)':(isWe?'rgba(161,0,255,.04)':'inherit');
      const dd=String(d).padStart(2,'0');
      const dateISO=`${year}-${mm}-${dd}`;
      h+=`<td title="Clicca per modificare" style="border:1px solid var(--line);padding:2px 1px;text-align:center;background:${bg};cursor:pointer${bdr}" onclick="_consuntivoClickCell(this,${res.id},'${dateISO}',${ore})">`;
      if(ore)h+=`<span style="font-size:.68rem;font-weight:600;color:var(--ok)">${_fmtOre(ore)}</span>`;
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

// ANDAMENTO PROGETTO
// Serie L1/L2/L3: colori validati (dataviz) + forma del marker come codifica secondaria.
// Il Totale è una somma, non una categoria: linea neutra in inchiostro con marker a rombo.
const TK_LV=[{k:'l1',l:'L1',c:'#A100FF',m:'circle'},{k:'l2',l:'L2',c:'#1f6fc9',m:'square'},{k:'l3',l:'L3',c:'#d95926',m:'triangle'}];
const TK_TOT={k:'totale',l:'Totale',c:'#3D3D3D',m:'diamond',tot:true};
const EE_C='#A100FF',EE_C_HOVER='#7500C0',THR_C='#C9003C';
function _esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function _fmtNum(n){return Number(n).toLocaleString('it-IT');}
function _r2(n){return Math.round(Number(n)*100)/100;}
function _fmtOre(n){return _r2(n).toLocaleString('it-IT',{maximumFractionDigits:2})+' h';}
function _fmtPct(v){return v==null?'—':v.toLocaleString('it-IT',{maximumFractionDigits:1})+'%';}
function _me(){return isAdmin?null:(RESOURCES.find(r=>r.fullName===currentUser)||null);}
function _myAree(){const me=_me();return me?_cache.aree.filter(a=>a.teamLeadId===me.id&&a.attiva):[];}
function _prjAree(pid){return _cache.aree.filter(a=>a.progettoId===pid);}
// Progetto con più aree: soglie e dati gestiti a livello di area
function _isMultiArea(pid){return _prjAree(pid).length>1;}
// Visibilità: admin tutti i progetti; manager i progetti delle proprie risorse; Team Lead solo i progetti
// di cui è TL (tutte le aree) oppure, se TL d'area, le sole aree di cui è responsabile.
// Map progettoId → null (progetto intero) | Set di areaId
function _andScope(){
  const sc=new Map(),full=pid=>{if(pid)sc.set(pid,null);};
  if(isAdmin){(_cache.prj||[]).forEach(p=>full(_prjIdByName[p]));return sc;}
  const me=_me();if(!me)return sc;
  Object.entries(_prjTLsByName).forEach(([p,tls])=>{if(tls.includes(currentUser))full(_prjIdByName[p]);});
  if(isTeamLead)_getManagerProjects().forEach(p=>full(_prjIdByName[p]));
  _cache.aree.filter(a=>a.teamLeadId===me.id).forEach(a=>{
    if(sc.has(a.progettoId)&&sc.get(a.progettoId)===null)return;
    if(!sc.has(a.progettoId))sc.set(a.progettoId,new Set());
    sc.get(a.progettoId).add(a.id);
  });
  // TL di tutte le aree del progetto = visibilità sull'intero progetto
  sc.forEach((s,pid)=>{if(s&&_prjAree(pid).every(a=>s.has(a.id)))sc.set(pid,null);});
  return sc;
}
function _andProjects(){return[..._andScope().keys()].map(pid=>_prjNameById[pid]).filter(Boolean).sort();}
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
let _andSel={pid:null,areaId:null},_andData=null,_andAutoOpen=true,_andCharts=[],_andTkInit=false,_andEeMode=S.get('andEeMode')==='n'?'n':'ore';
const _AND_EMPTY=Object.freeze({l1:0,l2:0,l3:0,totale:0,giorni:0,ultimo:null,ee:0,een:0,tk:false});
// Riga dati visibile nello scope dell'utente
function _andVis(sc,r){const pid=+r.progetto_id;if(!sc.has(pid))return false;const s=sc.get(pid);return!s||s.has(+r.area_id);}
// Indice dei dati per progetto|area|mese ('*' = somma delle aree visibili del progetto)
function _andBuild(d,sc){
  const m={};
  const add=(r,f)=>{const key=r.anno+'-'+r.mese;[r.area_id,'*'].forEach(a=>{const k=`${r.progetto_id}|${a}|${key}`;f(m[k]||(m[k]={..._AND_EMPTY}));});};
  d.tickets.filter(r=>_andVis(sc,r)).forEach(r=>add(r,z=>{TK_LV.forEach(s=>{z[s.k]+=r[s.k];});z.totale+=r.totale;z.giorni+=r.giorni;z.tk=true;if(!z.ultimo||r.ultimo>z.ultimo)z.ultimo=r.ultimo;}));
  d.ee.filter(r=>_andVis(sc,r)).forEach(r=>add(r,z=>{z.ee=_r2(z.ee+r.ore);z.een+=r.n;}));
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
// Aree mostrate: nello scope dell'utente, attive o con dati nel mese selezionato
function _andAree(pid){
  const D=_andData,s=D.sc.get(pid);
  return _prjAree(pid).filter(a=>{if(s&&!s.has(a.id))return false;const r=D.get(pid,a.id,D.year,D.month);return a.attiva||r.tk||r.een;}).sort((a,b)=>a.nome.localeCompare(b.nome,'it'));
}
function _andRestricted(pid){return!!(_andData&&_andData.sc.get(pid));}
async function renderAndamento(){
  const el=document.getElementById('andamentoContent');if(!el)return;
  const month=+document.getElementById('andMonth').value,year=+document.getElementById('andYear').value,n=+document.getElementById('andMesi').value;
  const tc=document.getElementById('andTicketCard'),mine=_myAree();
  if(tc){
    tc.style.display=mine.length?'':'none';
    if(mine.length&&!_andTkInit){
      _andTkInit=true;
      const inp=document.getElementById('andTicketDate'),y=new Date();y.setDate(y.getDate()-1);
      inp.value=localDate(y);inp.max=localDate(new Date());
      loadTicketDay().catch(console.error);
    }
  }
  const sc=_andScope();
  const prjs=[...sc.keys()].filter(pid=>_prjNameById[pid]).sort((a,b)=>_prjNameById[a].localeCompare(_prjNameById[b],'it'));
  if(!prjs.length){_andData=null;_andNavOpts();el.innerHTML='<div class="card"><p style="color:var(--ink-3);text-align:center;padding:24px 0">Nessun progetto di cui sei Team Lead.</p></div>';return;}
  showSpinner();let d;
  try{d=await call('getAndamento',{scope:prjs.map(pid=>({progettoId:pid,areaIds:sc.get(pid)?[...sc.get(pid)]:null})),anno:year,mese:month,mesi:n});}
  catch(e){hideSpinner();el.innerHTML=`<div class="msg err">Errore: ${_esc(e.message)}</div>`;return;}
  hideSpinner();
  _andData={d,sc,prjs,year,month,n,get:_andBuild(d,sc),lbl:MONTHS[month]+' '+year};
  if(_andSel.pid&&!sc.has(_andSel.pid))_andSel={pid:null,areaId:null};
  if(_andSel.areaId&&!_andAree(_andSel.pid).some(a=>a.id===_andSel.areaId))_andSel.areaId=null;
  // Con un solo progetto visibile si apre direttamente il dettaglio (solo al primo accesso)
  if(_andAutoOpen&&!_andSel.pid&&prjs.length===1)_andSel={pid:prjs[0],areaId:null};
  _andAutoOpen=false;
  _andDraw();
}
function _andDraw(){
  const el=document.getElementById('andamentoContent');if(!el||!_andData)return;
  _andNavOpts();_andCharts=[];
  el.innerHTML=_andSel.pid?_andDetailHtml(_andSel.pid,_andSel.areaId):_andOverviewHtml();
  requestAnimationFrame(()=>_andCharts.forEach(c=>c.init(c)));
}
// ── navigazione: panoramica → progetto → area ──
function _andNavOpts(){
  const D=_andData,o=[{v:'',l:'Panoramica — tutti i progetti'}];
  if(D)D.prjs.forEach(pid=>{o.push({v:'p:'+pid,l:_prjNameById[pid]});if(_isMultiArea(pid))_andAree(pid).forEach(a=>o.push({v:`a:${pid}:${a.id}`,l:' ↳ '+a.nome}));});
  popSel('andNav',o,_andSel.pid?(_andSel.areaId?`a:${_andSel.pid}:${_andSel.areaId}`:'p:'+_andSel.pid):'');
}
function andNavChange(v){const[t,p,a]=String(v||'').split(':');andGo(t?+p:null,t==='a'?+a:null);}
function andGo(pid,aid){
  _andSel={pid:pid||null,areaId:aid||null};_andDraw();
  document.getElementById('andamentoContent')?.scrollIntoView({behavior:'smooth',block:'start'});
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
// Badge di stato di uno scope (progetto o area); le soglie di progetto non valgono per chi vede solo alcune aree
function _andBadges(pid,aid,r){
  if(!aid&&_andRestricted(pid))return '';
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
function _andKpis(r){
  const pc=_lvPct(r);
  return `<div class="and-kpis">
    ${TK_LV.map((s,i)=>`<div class="and-kpi"><small>${_mkSvg(s,10)}${s.l}</small><b>${_fmtNum(r[s.k])}</b><span>${_fmtPct(pc&&pc[i])}</span></div>`).join('')}
    <div class="and-kpi and-kpi-tot"><small>Totale ticket</small><b>${_fmtNum(r.totale)}</b><span>${r.totale?'100%':'—'}</span></div>
    <div class="and-kpi and-kpi-ee"><small><i class="fa-solid fa-stopwatch"></i> Extra Effort</small><b>${_fmtOre(r.ee)}</b><span>${_fmtNum(r.een)} attività</span></div>
  </div>`;
}
function _andAreaTable(pid,aree){
  const D=_andData;
  return `<div class="and-areas"><div class="and-sum-title">Dettaglio per area — ${D.lbl}</div><div class="table-wrap"><table><thead><tr><th>Area</th><th>Team Lead</th>${TK_LV.map(s=>`<th class="and-num">${s.l}</th>`).join('')}<th class="and-num">Totale</th><th class="and-num">Extra Effort</th><th>Soglie</th><th class="and-num">Giorni inseriti</th><th>Ultimo</th><th></th></tr></thead><tbody>${aree.map(a=>{
    const r=D.get(pid,a.id,D.year,D.month),pc=_lvPct(r),cfg=_thrCfg(pid,a.id);
    const tl=a.teamLeadId?(RESOURCES.find(x=>x.id===a.teamLeadId)?.fullName||'—'):'—';
    const pills=_thrPill(cfg,'ticket',r.totale)+_thrPill(cfg,'ee',r.ee);
    return `<tr class="and-row-link" tabindex="0" onclick="andGo(${pid},${a.id})" onkeydown="if(event.key==='Enter')andGo(${pid},${a.id})" title="Apri il dettaglio dell'area">
      <td><b>${_esc(a.nome)}</b>${a.attiva?'':' <span class="badge badge-warn" style="font-size:.65rem">non attiva</span>'}</td>
      <td style="color:var(--ink-3)">${_esc(tl)}</td>
      ${TK_LV.map((s,i)=>`<td class="and-num">${_fmtNum(r[s.k])}<small class="and-pct">${_fmtPct(pc&&pc[i])}</small></td>`).join('')}
      <td class="and-num"><b>${_fmtNum(r.totale)}</b></td>
      <td class="and-num">${_fmtOre(r.ee)}<small class="and-pct">${_fmtNum(r.een)} att.</small></td>
      <td><div class="and-pills">${pills||'<span style="color:var(--ink-3)">—</span>'}</div></td>
      <td class="and-num">${r.giorni}</td>
      <td style="color:var(--ink-3);white-space:nowrap">${r.ultimo?fmt(r.ultimo):'—'}</td>
      <td style="white-space:nowrap"><span class="and-go">Dettaglio <i class="fa-solid fa-chevron-right"></i></span></td>
    </tr>`;}).join('')}</tbody></table></div></div>`;
}
function _andOverviewHtml(){
  const D=_andData;
  return D.prjs.map(pid=>{
    const p=_prjNameById[pid],r=D.get(pid,null,D.year,D.month),multi=_isMultiArea(pid),restr=_andRestricted(pid),aree=_andAree(pid);
    const overAree=multi?aree.filter(a=>{const ar=D.get(pid,a.id,D.year,D.month),cfg=_thrCfg(pid,a.id);return['hit','over'].includes(_thrEval(cfg,'ticket',ar.totale).st)||['hit','over'].includes(_thrEval(cfg,'ee',ar.ee).st);}).length:0;
    return `<div class="card">
      <div class="and-head">
        <button class="and-title-link" onclick="andGo(${pid})" title="Apri il dettaglio del progetto"><i class="fa-solid fa-folder-open"></i> ${_esc(p)} <i class="fa-solid fa-chevron-right" style="font-size:.7rem;color:var(--ink-3)"></i></button>
        <div class="and-badges">${restr?'<span class="badge badge-info">Solo le tue aree</span>':''}${_andBadges(pid,null,r)}${overAree?`<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation" style="margin-right:5px"></i>${overAree} ${overAree>1?'aree':'area'} oltre soglia</span>`:''}</div>
      </div>
      <div class="and-sum-title">${restr?'Le tue aree':multi?'Totale progetto (tutte le aree)':'Totale progetto'} — ${D.lbl}</div>
      ${_andKpis(r)}
      ${restr?'':`<div class="and-thr-row">${_andThrMeters(pid,null,r)}</div>`}
      ${multi&&aree.length?_andAreaTable(pid,aree):''}
      <div class="and-card-foot"><button class="btn btn-ghost2 btn-sm" onclick="andGo(${pid})">Apri dettaglio progetto <i class="fa-solid fa-arrow-right" style="margin-left:4px"></i></button></div>
    </div>`;
  }).join('');
}
function _andDetailHtml(pid,aid){
  const D=_andData,p=_prjNameById[pid],multi=_isMultiArea(pid),restr=_andRestricted(pid),aree=_andAree(pid);
  const area=aid?_cache.aree.find(a=>a.id===aid):null;
  const scopeName=area?area.nome:restr?'Le tue aree':multi?'Tutto il progetto':'';
  const periods=[];for(let i=D.n-1;i>=0;i--){let m=D.month-i,y=D.year;while(m<0){m+=12;y--;}periods.push({m,y});}
  const recs=periods.map(({m,y})=>D.get(pid,aid,y,m)),r=D.get(pid,aid,D.year,D.month);
  // Le soglie di progetto non si applicano a chi vede solo alcune aree (il totale non è quello del progetto)
  const thrOn=!!aid||!restr,cfg=_thrCfg(pid,aid);
  const evTk=thrOn?_thrEval(cfg,'ticket',r.totale):{st:'none'},evEe=thrOn?_thrEval(cfg,'ee',r.ee):{st:'none'};
  const labels=periods.map(({m,y})=>MONTHS[m].slice(0,3)+' '+String(y).slice(2)),full=periods.map(({m,y})=>MONTHS[m]+' '+y);
  const sfx=`${pid}-${aid||0}`;
  const tk={id:'andCv-'+sfx,init:_initTicketChart,draw:_drawTicketChart,labels,full,has:recs.map(x=>x.tk),
    series:[...TK_LV,TK_TOT].map(s=>({...s,data:recs.map(x=>x[s.k])})),thr:_thrActive(evTk)?evTk.soglia:null};
  const ee={id:'andEe-'+sfx,ee:true,init:_initEeChart,draw:_drawEeChart,labels,full,ore:recs.map(x=>x.ee),cnt:recs.map(x=>x.een),thr:_thrActive(evEe)?evEe.soglia:null,mode:_andEeMode};
  _andCharts.push(tk,ee);
  const crumb=`<nav class="and-crumb" aria-label="Percorso"><a href="#" onclick="andGo();return false"><i class="fa-solid fa-table-cells-large"></i> Panoramica progetti</a><span aria-hidden="true">›</span>${area?`<a href="#" onclick="andGo(${pid});return false">${_esc(p)}</a><span aria-hidden="true">›</span><b>${_esc(area.nome)}</b>`:`<b>${_esc(p)}</b>`}</nav>`;
  const tabs=multi&&aree.length?`<div class="and-tabs" role="tablist" aria-label="Aree del progetto"><button role="tab" aria-selected="${!aid}" class="${aid?'':'on'}" onclick="andGo(${pid})">${restr?'Le tue aree':'Tutto il progetto'}</button>${aree.map(a=>`<button role="tab" aria-selected="${a.id===aid}" class="${a.id===aid?'on':''}" onclick="andGo(${pid},${a.id})">${_esc(a.nome)}</button>`).join('')}</div>`:'';
  const canEdit=thrOn&&(area?_canEditAreaSoglia(area):_canEditSoglia(p));
  let editor='';
  if(canEdit)editor=!aid&&multi
    ?`<details class="thr-more"><summary>Soglia complessiva di progetto (facoltativa)</summary>${_thrEditor(pid,null)}</details>`
    :`<div class="and-sum-title" style="margin:14px 0 0">Configura soglie${area?' dell\'area':''}</div>${_thrEditor(pid,aid)}`;
  const sum=`<div class="and-sum">
      <div class="and-sum-title">${scopeName?_esc(scopeName)+' — ':''}${D.lbl}</div>
      ${_andKpis(r)}
      ${r.tk||r.een?'':'<div style="font-size:.72rem;color:var(--ink-3);margin-top:6px"><i class="fa-regular fa-circle-question" style="margin-right:4px"></i>Nessun dato registrato nel mese</div>'}
      ${thrOn?_andThrMeters(pid,aid,r):'<div class="thr thr-none"><i class="fa-solid fa-sitemap" style="margin-right:5px"></i>Soglie disponibili nel dettaglio di ciascuna area</div>'}
      ${editor}
    </div>`;
  const tableRows=periods.map(({m,y},i)=>{const x=recs[i],pc=_lvPct(x);return `<tr><td>${MONTHS[m]} ${y}</td>${x.tk?TK_LV.map(s=>`<td class="and-num">${_fmtNum(x[s.k])}</td>`).join('')+`<td class="and-num"><b>${_fmtNum(x.totale)}</b></td><td class="and-num">${pc?pc.map(_fmtPct).join(' · '):'—'}</td>`:'<td colspan="5" style="color:var(--ink-3);text-align:center">nessun dato</td>'}</tr>`;}).join('');
  const eeRows=periods.map(({m,y},i)=>`<tr><td>${MONTHS[m]} ${y}</td><td class="and-num">${_fmtNum(recs[i].een)}</td><td class="and-num">${_fmtOre(recs[i].ee)}</td></tr>`).join('');
  // Attività Extra Effort del mese selezionato
  const acts=D.d.eeDettaglio.filter(e=>+e.progetto_id===pid&&_andVis(D.sc,e)&&(!aid||+e.area_id===aid));
  const areaName=id=>_cache.aree.find(a=>a.id===+id)?.nome||'—',showArea=!aid&&multi;
  const actsHtml=acts.length
    ?`<div class="table-wrap"><table><thead><tr><th>Data</th>${showArea?'<th>Area</th>':''}<th>Tipologia attività / Dettaglio</th><th class="and-num">Extra Effort (ore)</th><th>Inserito da</th></tr></thead><tbody>${acts.map(e=>`<tr><td style="white-space:nowrap">${fmt(e.data)}</td>${showArea?`<td>${_esc(areaName(e.area_id))}</td>`:''}<td>${_esc(e.attivita)}</td><td class="and-num">${_fmtOre(e.ore)}</td><td style="color:var(--ink-3)">${_esc(e.inserito_da||'—')}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="${showArea?3:2}"><b>Totale Extra Effort ${_esc(scopeName||p)}</b></td><td class="and-num"><b>${_fmtOre(r.ee)}</b></td><td></td></tr></tfoot></table></div>`
    :`<p style="font-size:.8rem;color:var(--ink-3)"><i class="fa-solid fa-circle-info" style="margin-right:5px"></i>Nessuna attività di Extra Effort registrata in ${D.lbl}.</p>`;
  const seg=m=>`<button type="button" data-m="${m}" class="${_andEeMode===m?'on':''}" aria-pressed="${_andEeMode===m}" onclick="andEeMode('${m}')">${m==='n'?'Numero attività':'Ore'}</button>`;
  return `${crumb}
    <div class="card">
      <div class="and-head"><div class="card-title"><i class="fa-solid fa-folder-open"></i> ${_esc(p)}${area?` <span style="color:var(--ink-3);font-weight:600">/ ${_esc(area.nome)}</span>`:''}</div><div class="and-badges">${restr&&!aid?'<span class="badge badge-info">Solo le tue aree</span>':''}${_andBadges(pid,aid,r)}</div></div>
      ${tabs}
      <div class="and-grid">
        <div class="and-chart-wrap">
          <div class="and-sum-title">Andamento ticket — ultimi ${D.n} mesi</div>
          <canvas id="${tk.id}" role="img" aria-label="Andamento ticket L1, L2, L3 e totale di ${_esc(p)}${area?' / '+_esc(area.nome):''}"></canvas><div class="and-tip" id="${tk.id}-tip"></div>
          <div class="and-legend">${[...TK_LV,TK_TOT].map(s=>`<span>${_mkSvg(s,12,true)}${s.l}</span>`).join('')}${tk.thr?`<span>${_thrSwatch()}Soglia ${_fmtNum(tk.thr)}</span>`:''}<span style="color:var(--ink-3)">${_mkSvg({c:'#8C8C8C',m:'circle'},10,false,true)}mese senza dati</span></div>
          <details style="margin-top:10px"><summary style="font-size:.76rem;color:var(--ink-3);cursor:pointer">Mostra dati in tabella</summary><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Mese</th>${TK_LV.map(s=>`<th class="and-num">${s.l}</th>`).join('')}<th class="and-num">Totale</th><th class="and-num">% L1 · L2 · L3</th></tr></thead><tbody>${tableRows}</tbody></table></div></details>
        </div>
        ${sum}
      </div>
    </div>
    <div class="card">
      <div class="and-head"><div class="card-title"><i class="fa-solid fa-stopwatch"></i> Extra Effort${scopeName?` <span style="color:var(--ink-3);font-weight:600">— ${_esc(scopeName)}</span>`:''}</div>
        <div class="and-seg" role="group" aria-label="Metrica del grafico Extra Effort">${seg('n')}${seg('ore')}</div></div>
      <div class="and-chart-wrap">
        <canvas id="${ee.id}" class="and-ee-cv" role="img" aria-label="Extra Effort mensile di ${_esc(p)}${area?' / '+_esc(area.nome):''}"></canvas><div class="and-tip" id="${ee.id}-tip"></div>
        ${ee.thr?`<div class="and-legend"><span>${_thrSwatch()}Soglia ${_fmtOre(ee.thr)} (visibile in modalità Ore)</span></div>`:''}
        <details style="margin-top:10px"><summary style="font-size:.76rem;color:var(--ink-3);cursor:pointer">Mostra dati in tabella</summary><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Mese</th><th class="and-num">Attività</th><th class="and-num">Ore</th></tr></thead><tbody>${eeRows}</tbody></table></div></details>
      </div>
      <div class="and-sum-title" style="margin-top:18px">Attività di Extra Effort — ${D.lbl}</div>
      ${actsHtml}
    </div>
    ${!aid&&multi&&aree.length?`<div class="card">${_andAreaTable(pid,aree)}</div>`:''}`;
}
function andEeMode(m){
  _andEeMode=m==='n'?'n':'ore';S.set('andEeMode',_andEeMode);
  document.querySelectorAll('.and-seg button').forEach(b=>{const on=b.dataset.m===_andEeMode;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
  _andCharts.filter(c=>c.ee).forEach(c=>{c.mode=_andEeMode;c.hover=null;_drawEeChart(c);});
}
// Marker SVG per legenda/box (stessa forma del grafico)
function _mkSvg(s,size,withLine,hollow){
  const w=withLine?22:size,cx=w/2,cy=size/2,r=size*0.36;
  const fill=hollow?'#fff':s.c,stroke=s.c;
  const shape=s.m==='square'?`<rect x="${cx-r}" y="${cy-r}" width="${r*2}" height="${r*2}" rx="1" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
    :s.m==='triangle'?`<polygon points="${cx},${cy-r*1.15} ${cx+r*1.1},${cy+r*0.85} ${cx-r*1.1},${cy+r*0.85}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
    :s.m==='diamond'?`<polygon points="${cx},${cy-r*1.25} ${cx+r*1.25},${cy} ${cx},${cy+r*1.25} ${cx-r*1.25},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
    :`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  return `<svg width="${w}" height="${size}" aria-hidden="true">${withLine?`<line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="${s.c}" stroke-width="2"/>`:''}${shape}</svg>`;
}
function _thrSwatch(){return `<svg width="22" height="12" aria-hidden="true"><line x1="0" y1="6" x2="22" y2="6" stroke="${THR_C}" stroke-width="1.5" stroke-dasharray="4 3"/></svg>`;}
// ── grafico a linee ticket (canvas, stesso approccio del Trend) con crosshair + tooltip ──
function _niceMax(v){if(v<=5)return 5;const p=Math.pow(10,Math.floor(Math.log10(v))),f=v/p;return(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;}
function _initTicketChart(c){
  const cv=document.getElementById(c.id);if(!cv)return;
  c.hover=null;_drawTicketChart(c);
  cv.onmousemove=e=>{const g=c.geo;if(!g)return;const r=cv.getBoundingClientRect(),x=e.clientX-r.left;const i=Math.max(0,Math.min(c.labels.length-1,Math.round((x-g.l)/(g.step||1))));if(i!==c.hover){c.hover=i;_drawTicketChart(c);}_showTicketTip(c,i);};
  cv.onmouseleave=()=>{c.hover=null;_drawTicketChart(c);const t=document.getElementById(c.id+'-tip');if(t)t.style.display='none';};
}
// Linea di soglia tratteggiata con etichetta in inchiostro (il colore di stato resta sulla linea)
function _drawThrLine(ctx,P,pw,y,label){
  ctx.strokeStyle=THR_C;ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(P.l,Math.round(y)+.5);ctx.lineTo(P.l+pw,Math.round(y)+.5);ctx.stroke();ctx.setLineDash([]);
  ctx.font='600 11px DM Sans,sans-serif';ctx.textAlign='left';ctx.textBaseline='bottom';
  const w=ctx.measureText(label).width;ctx.fillStyle='rgba(255,255,255,.85)';ctx.fillRect(P.l+4,y-15,w+6,13);
  ctx.fillStyle='#3D3D3D';ctx.fillText(label,P.l+7,y-3);
}
function _drawTicketChart(c){
  const cv=document.getElementById(c.id);if(!cv)return;
  const dpr=window.devicePixelRatio||1,W=cv.clientWidth||600,H=260;
  cv.width=W*dpr;cv.height=H*dpr;const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const P={t:14,r:52,b:30,l:40},pw=W-P.l-P.r,ph=H-P.t-P.b,n=c.labels.length,step=n>1?pw/(n-1):0;
  const mx=_niceMax(Math.max(1,...c.series.flatMap(s=>s.data),c.thr||0));
  c.geo={l:P.l,step};
  const X=i=>P.l+(n>1?step*i:pw/2),Y=v=>P.t+ph*(1-v/mx);
  // griglia recessiva + asse Y
  ctx.font='11px DM Sans,sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';
  const div=mx%4===0?4:5; // tick interi: i ticket non hanno decimali
  for(let i=0;i<=div;i++){const v=mx*i/div,y=Y(v);ctx.strokeStyle=i===0?'rgba(0,0,0,.18)':'rgba(0,0,0,.06)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(P.l,Math.round(y)+.5);ctx.lineTo(P.l+pw,Math.round(y)+.5);ctx.stroke();ctx.fillStyle='#8C8C8C';ctx.fillText(_fmtNum(v),P.l-8,y);}
  // asse X (salta etichette se lo spazio è poco)
  const every=step&&step<44?2:1;ctx.textAlign='center';ctx.textBaseline='alphabetic';
  c.labels.forEach((lb,i)=>{if(i%every&&i!==n-1)return;ctx.fillStyle=i===n-1?'#3D3D3D':'#8C8C8C';ctx.font=(i===n-1?'600 ':'')+'11px DM Sans,sans-serif';ctx.fillText(lb,X(i),H-8);});
  if(c.thr)_drawThrLine(ctx,P,pw,Y(c.thr),'Soglia '+_fmtNum(c.thr));
  if(c.hover!=null){ctx.strokeStyle='rgba(0,0,0,.25)';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(Math.round(X(c.hover))+.5,P.t);ctx.lineTo(Math.round(X(c.hover))+.5,P.t+ph);ctx.stroke();ctx.setLineDash([]);}
  c.series.forEach(s=>{
    ctx.strokeStyle=s.c;ctx.lineWidth=s.tot?2.5:2;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
    s.data.forEach((v,i)=>{i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v));});ctx.stroke();
  });
  // marker: pieni con dati, vuoti nei mesi senza registrazioni; anello bianco per le sovrapposizioni
  c.series.forEach(s=>s.data.forEach((v,i)=>{
    const x=X(i),y=Y(v),r=c.hover===i?5.5:4.5;
    ctx.beginPath();
    if(s.m==='square')ctx.rect(x-r*.9,y-r*.9,r*1.8,r*1.8);
    else if(s.m==='triangle'){ctx.moveTo(x,y-r*1.15);ctx.lineTo(x+r*1.1,y+r*.85);ctx.lineTo(x-r*1.1,y+r*.85);ctx.closePath();}
    else if(s.m==='diamond'){ctx.moveTo(x,y-r*1.2);ctx.lineTo(x+r*1.2,y);ctx.lineTo(x,y+r*1.2);ctx.lineTo(x-r*1.2,y);ctx.closePath();}
    else ctx.arc(x,y,r,0,Math.PI*2);
    ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();
    ctx.fillStyle=c.has[i]?s.c:'#fff';ctx.fill();
    if(!c.has[i]){ctx.lineWidth=1.5;ctx.strokeStyle=s.c;ctx.stroke();}
  }));
  // etichette dirette a fine linea (testo in inchiostro, non nel colore della serie), senza collisioni
  const ends=c.series.map(s=>({l:s.l,y:Y(s.data[n-1])})).sort((a,b)=>a.y-b.y);
  for(let i=1;i<ends.length;i++)if(ends[i].y-ends[i-1].y<13)ends[i].y=ends[i-1].y+13;
  // se le etichette sforano in basso, risalgono mantenendo la spaziatura
  const yMax=P.t+ph+4;for(let i=ends.length-1;i>=0;i--)ends[i].y=Math.min(ends[i].y,yMax-(ends.length-1-i)*13);
  ctx.font='600 11px DM Sans,sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle='#3D3D3D';
  ends.forEach(e=>ctx.fillText(e.l,X(n-1)+10,e.y));
}
function _showTicketTip(c,i){
  const t=document.getElementById(c.id+'-tip'),cv=document.getElementById(c.id);if(!t||!cv)return;
  const tot=c.series.find(s=>s.tot);
  t.innerHTML=`<div class="and-tip-t">${c.full[i]}</div>`+(c.has[i]?c.series.filter(s=>!s.tot).map(s=>`<div class="and-tip-r"><span>${_mkSvg(s,10)} ${s.l}</span><span>${_fmtNum(s.data[i])}</span></div>`).join('')+`<div class="and-tip-r" style="border-top:1px solid var(--line);margin-top:4px;padding-top:4px"><span>${_mkSvg(TK_TOT,10)} Totale</span><span>${_fmtNum(tot?tot.data[i]:0)}</span></div>`:'<div style="color:var(--ink-3)">Nessun dato registrato</div>')
    +(c.thr?`<div class="and-tip-r" style="color:var(--ink-3)"><span>Soglia</span><span>${_fmtNum(c.thr)}</span></div>`:'');
  t.style.display='block';
  const x=c.geo.l+c.geo.step*i,w=t.offsetWidth;
  t.style.left=Math.max(0,Math.min(cv.clientWidth-w,x+12>cv.clientWidth-w?x-w-12:x+12))+'px';t.style.top='10px';
}
// ── grafico a barre Extra Effort: numero attività oppure ore, per mese ──
function _initEeChart(c){
  const cv=document.getElementById(c.id);if(!cv)return;
  c.hover=null;_drawEeChart(c);
  const hide=()=>{const t=document.getElementById(c.id+'-tip');if(t)t.style.display='none';};
  cv.onmousemove=e=>{const g=c.geo;if(!g)return;const r=cv.getBoundingClientRect(),i=Math.floor((e.clientX-r.left-g.l)/g.band);
    if(i<0||i>=c.labels.length){if(c.hover!=null){c.hover=null;_drawEeChart(c);}hide();return;}
    if(i!==c.hover){c.hover=i;_drawEeChart(c);}_showEeTip(c,i);};
  cv.onmouseleave=()=>{c.hover=null;_drawEeChart(c);hide();};
}
function _barPath(ctx,x,y,w,h,r){r=Math.min(r,w/2,h);ctx.beginPath();ctx.moveTo(x,y+h);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h);ctx.closePath();}
function _drawEeChart(c){
  const cv=document.getElementById(c.id);if(!cv)return;
  const dpr=window.devicePixelRatio||1,W=cv.clientWidth||600,H=240;
  cv.width=W*dpr;cv.height=H*dpr;const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const isOre=c.mode!=='n',vals=isOre?c.ore:c.cnt,thr=isOre?c.thr:null,fv=v=>isOre?_fmtOre(v):_fmtNum(v);
  const P={t:20,r:16,b:30,l:48},pw=W-P.l-P.r,ph=H-P.t-P.b,n=vals.length,band=pw/n,bw=Math.max(6,Math.min(36,band*.62));
  const mx=_niceMax(Math.max(1,...vals,thr||0));
  c.geo={l:P.l,band};
  const Y=v=>P.t+ph*(1-v/mx),BX=i=>P.l+band*i+(band-bw)/2;
  ctx.font='11px DM Sans,sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';
  const div=mx%4===0?4:5;
  for(let i=0;i<=div;i++){const v=mx*i/div,y=Y(v);ctx.strokeStyle=i===0?'rgba(0,0,0,.18)':'rgba(0,0,0,.06)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(P.l,Math.round(y)+.5);ctx.lineTo(P.l+pw,Math.round(y)+.5);ctx.stroke();ctx.fillStyle='#8C8C8C';ctx.fillText(_fmtNum(_r2(v))+(isOre?' h':''),P.l-8,y);}
  const every=band<44?2:1;ctx.textAlign='center';ctx.textBaseline='alphabetic';
  c.labels.forEach((lb,i)=>{if(i%every&&i!==n-1)return;ctx.fillStyle=i===n-1?'#3D3D3D':'#8C8C8C';ctx.font=(i===n-1?'600 ':'')+'11px DM Sans,sans-serif';ctx.fillText(lb,BX(i)+bw/2,H-8);});
  if(c.hover!=null){ctx.fillStyle='rgba(0,0,0,.04)';ctx.fillRect(P.l+band*c.hover,P.t,band,ph);}
  // barre sottili ancorate alla base, angoli superiori arrotondati
  vals.forEach((v,i)=>{if(!v)return;const y=Y(v);_barPath(ctx,BX(i),y,bw,P.t+ph-y,4);ctx.fillStyle=c.hover===i?EE_C_HOVER:EE_C;ctx.fill();});
  if(thr)_drawThrLine(ctx,P,pw,Y(thr),'Soglia '+_fmtOre(thr));
  // etichetta diretta solo sul mese selezionato (ultima barra)
  const last=vals[n-1];
  ctx.font='600 11px DM Sans,sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle='#3D3D3D';
  ctx.fillText(last?fv(last):(isOre?'0 h':'0'),BX(n-1)+bw/2,(last?Y(last):P.t+ph)-4);
}
function _showEeTip(c,i){
  const t=document.getElementById(c.id+'-tip'),cv=document.getElementById(c.id);if(!t||!cv)return;
  t.innerHTML=`<div class="and-tip-t">${c.full[i]}</div>`+(c.cnt[i]
    ?`<div class="and-tip-r"><span>Attività</span><span>${_fmtNum(c.cnt[i])}</span></div><div class="and-tip-r"><span>Ore Extra Effort</span><span>${_fmtOre(c.ore[i])}</span></div>`
    :'<div style="color:var(--ink-3)">Nessuna attività registrata</div>')
    +(c.thr?`<div class="and-tip-r" style="color:var(--ink-3)"><span>Soglia</span><span>${_fmtOre(c.thr)}</span></div>`:'');
  t.style.display='block';
  const x=c.geo.l+c.geo.band*(i+.5),w=t.offsetWidth;
  t.style.left=Math.max(0,Math.min(cv.clientWidth-w,x+14>cv.clientWidth-w?x-w-14:x+14))+'px';t.style.top='10px';
}
let _andResizeT=null;
window.addEventListener('resize',()=>{clearTimeout(_andResizeT);_andResizeT=setTimeout(()=>{if(document.getElementById('panel-andamento')?.classList.contains('active'))_andCharts.forEach(c=>c.draw(c));},150);});
// ── Extra Effort: tabella compilabile (una riga per attività), usata nell'inserimento dall'app ──
function _eeRowHtml(r){
  return `<div class="ee-row"><input type="text" class="ee-att" maxlength="300" placeholder="Tipologia attività / dettaglio" value="${_esc(r?r.attivita:'')}" oninput="_eeRecalc(this)" aria-label="Tipologia attività / dettaglio"/><input type="number" class="ee-ore" min="0" step="0.25" inputmode="decimal" placeholder="ore" value="${r?r.ore:''}" oninput="_eeRecalc(this)" aria-label="Extra Effort (ore)"/><button type="button" class="btn-icon danger" title="Rimuovi riga" onclick="_eeDel(this)"><i class="fa-solid fa-xmark" style="font-size:.75rem"></i></button></div>`;
}
function _eeBlockHtml(rows){
  return `<div class="ee"><div class="ee-row ee-head"><span>Extra Effort — tipologia attività / dettaglio</span><span style="text-align:right">Ore</span><span></span></div>
    <div class="ee-rows">${(rows.length?rows:[null]).map(_eeRowHtml).join('')}</div>
    <div class="ee-foot"><button type="button" class="btn btn-ghost2 btn-sm" onclick="_eeAdd(this)"><i class="fa-solid fa-plus"></i> Aggiungi attività</button><span class="ee-tot">Totale Extra Effort: <b>${_fmtOre(rows.reduce((s,r)=>s+r.ore,0))}</b></span></div></div>`;
}
function _eeAdd(btn){const l=btn.closest('.ee').querySelector('.ee-rows');l.insertAdjacentHTML('beforeend',_eeRowHtml(null));l.lastElementChild.querySelector('.ee-att').focus();}
function _eeDel(btn){
  const box=btn.closest('.ee'),row=btn.closest('.ee-row');
  if(box.querySelectorAll('.ee-rows .ee-row').length>1)row.remove();
  else row.querySelectorAll('input').forEach(i=>{i.value='';i.classList.remove('bad');});
  _eeRecalc(box);
}
function _eeRecalc(el){
  const box=el.closest('.ee');let tot=0;
  box.querySelectorAll('.ee-ore').forEach(i=>{const n=Number(i.value),ok=i.value===''||(Number.isFinite(n)&&n>0);i.classList.toggle('bad',!ok);if(ok&&i.value!=='')tot+=n;});
  box.querySelector('.ee-tot b').textContent=_fmtOre(tot);
}
// Righe compilate: le righe completamente vuote sono ignorate, quelle a metà sono un errore
function _eeCollect(box){
  const rows=[];let bad=false;
  box.querySelectorAll('.ee-rows .ee-row').forEach(row=>{
    const att=row.querySelector('.ee-att'),ore=row.querySelector('.ee-ore'),a=att.value.trim(),o=ore.value.trim();
    if(!a&&!o)return;
    const n=Number(o),okA=!!a,okO=o!==''&&Number.isFinite(n)&&n>0;
    att.classList.toggle('bad',!okA);ore.classList.toggle('bad',!okO);
    if(!okA||!okO){bad=true;return;}
    rows.push({attivita:a,ore:_r2(n)});
  });
  return{rows,bad};
}
// ── inserimento ticket ed Extra Effort dall'app (Team Lead delle aree) ──
async function loadTicketDay(){
  const me=_me(),inp=document.getElementById('andTicketDate'),form=document.getElementById('andTicketForm');
  if(!me||!inp||!inp.value||!form)return;
  showSpinner();let d;
  try{d=await call('getTicketDay',{risorsaId:me.id,data:inp.value});}
  catch(e){hideSpinner();form.innerHTML=`<div class="msg err">Errore: ${_esc(e.message)}</div>`;return;}
  hideSpinner();
  const ent=d.entries[inp.value]||{},ee=(d.ee||{})[inp.value]||{};
  if(!d.aree.length){form.innerHTML='<p style="color:var(--ink-3);font-size:.83rem">Nessuna area attiva assegnata.</p>';return;}
  form.innerHTML=`<div class="tk-row tk-header" style="padding-top:0"><div class="tk-head" style="text-align:left">Progetto / Area</div>${TK_LV.map(s=>`<div class="tk-head">${s.l}</div>`).join('')}<div class="tk-head">Totale</div></div>`+d.aree.map(a=>{const v=ent[a.id];return `<div class="tk-area" data-area="${a.id}"><div class="tk-row"><div><div style="font-size:.7rem;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em">${_esc(a.progetto)}</div><div style="font-weight:600">${_esc(a.nome)} ${v?'<span class="badge badge-ok" style="font-size:.65rem">inserito</span>':''}</div></div>${TK_LV.map(s=>`<input type="number" min="0" step="1" inputmode="numeric" placeholder="0" data-k="${s.k}" value="${v?v[s.k]:''}" oninput="_tkRecalc(this)" aria-label="${s.l} ${_esc(a.nome)}"/>`).join('')}<div class="tk-tot">${v?v.totale:0}</div></div>${_eeBlockHtml(ee[a.id]||[])}</div>`;}).join('');
}
function _tkRecalc(inp){
  const row=inp.closest('.tk-row');let tot=0;
  row.querySelectorAll('input').forEach(i=>{const n=Number(i.value),ok=i.value===''||(Number.isInteger(n)&&n>=0);i.classList.toggle('bad',!ok);if(ok&&i.value!=='')tot+=n;});
  row.querySelector('.tk-tot').textContent=tot;
}
async function saveTicketDay(){
  const me=_me(),data=document.getElementById('andTicketDate')?.value;
  if(!me||!data){showMsg('andTicketMsg','Seleziona una data.','err');return;}
  const entries=[];let bad=false,badEe=false;
  document.querySelectorAll('#andTicketForm .tk-area[data-area]').forEach(box=>{
    const e={areaId:+box.dataset.area};
    box.querySelectorAll('.tk-row input').forEach(i=>{const raw=i.value.trim(),n=raw===''?0:Number(raw);if(!Number.isInteger(n)||n<0){bad=true;i.classList.add('bad');}e[i.dataset.k]=n;});
    const x=_eeCollect(box.querySelector('.ee'));if(x.bad)badEe=true;e.ee=x.rows;
    entries.push(e);
  });
  if(bad){showMsg('andTicketMsg','Inserisci solo numeri interi non negativi.','err');return;}
  if(badEe){showMsg('andTicketMsg','Extra Effort: per ogni riga indica la tipologia attività e un numero di ore maggiore di zero.','err');return;}
  if(!entries.length)return;
  showSpinner();let res;
  try{res=await call('saveTickets',{risorsaId:me.id,data,entries});}
  catch(e){hideSpinner();showMsg('andTicketMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  const hit=(res.soglie||[]).filter(s=>s.status==='alert_sent'),kinds=[...new Set(hit.map(s=>_THR_KIND[s.kind]?.l||'ticket'))];
  await loadTicketDay();await renderAndamento();
  showMsg('andTicketMsg',`Ticket ed Extra Effort del ${fmt(data)} salvati.`+(hit.length?` Soglia mensile ${kinds.join(' e ')} raggiunta: alert email inviato.`:''),'ok');
}
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
// LOG EMAIL (admin)
async function loadEmailLog(){
  const el=document.getElementById('emailLogContent');if(!el)return;
  const tipo=document.getElementById('emailLogTipo')?.value||'';
  const stato=document.getElementById('emailLogStato')?.value||'';
  el.innerHTML='<div class="msg">Caricamento...</div>';
  showSpinner();
  let rows;
  try{rows=await call('getEmailLog',{tipo:tipo||null,stato:stato||null,limit:200});}
  catch(e){hideSpinner();el.innerHTML=`<div class="msg err">Errore: ${e.message}</div>`;return;}
  hideSpinner();
  if(!rows.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.82rem;padding:14px 0">Nessun invio registrato.</p>';return;}
  const TIPO_LBL={daily_reminder:'Reminder ore',assenza:'Assenza',sollecito_forecast:'Sollecito Forecast',ticket_reminder:'Reminder ticket',alert_soglia_ticket:'Alert soglia ticket',alert_soglia_ee:'Alert soglia Extra Effort'};
  const _bg=(bg,c,t)=>`<span style="background:${bg};color:${c};border-radius:3px;padding:2px 8px;font-size:.68rem;font-weight:700;white-space:nowrap">${t}</span>`;
  const badge=s=>{
    if(s==='sent')     return _bg('var(--ok-bg)','var(--ok)','INVIATA');
    if(s==='error')    return _bg('var(--danger-bg)','var(--danger)','ERRORE');
    if(s==='run_start')return _bg('var(--stone-2)','var(--ink-2)','▶ AVVIO');
    if(s==='run_end')  return _bg('var(--stone-2)','var(--ink-2)','■ FINE');
    if(s==='run_error')return _bg('var(--danger-bg)','var(--danger)','✖ CRASH');
    return _bg('var(--amber-bg)','var(--amber)','SALTATA');
  };
  let h='<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.74rem"><thead><tr>';
  ['Quando','Tipo','Destinatario','Stato','Dettaglio'].forEach(t=>{
    h+=`<th style="padding:6px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;font-size:.68rem">${t}</th>`;});
  h+='</tr></thead><tbody>';
  rows.forEach((r,i)=>{
    const m=r.meta||{};
    let det='';
    if(r.stato==='run_start')det=`<span style="color:var(--ink-3)">Avvio invio reminder del ${m.giorno||(m.giorni||[]).join(', ')}</span>`;
    else if(r.stato==='run_end')det=`<span style="color:var(--ink-3)">${m.destinatari||0} destinatari — <strong style="color:var(--ok)">${m.inviate||0} inviate</strong>${m.errori?`, <strong style="color:var(--danger)">${m.errori} errori</strong>`:''}</span>`;
    else if(r.stato==='run_error')det=`<span style="color:var(--danger)">Crash: ${r.errore||''}</span>`;
    else if(r.stato==='error')det=`<span style="color:var(--danger)">${r.errore||''}${m.responseCode?` (SMTP ${m.responseCode})`:''}</span>`;
    else if(r.stato==='skipped')det=`<span style="color:var(--ink-3)">${r.errore||''}</span>`;
    else if(r.tipo==='alert_soglia_ee')det=`<span style="color:var(--ink-3)">${_esc(m.progetto||'')}${m.area?' / '+_esc(m.area):''} — ${m.mese!=null?MONTHS[m.mese]:''} ${m.anno||''}: <strong style="color:var(--danger)">${_fmtOre(m.totale||0)} / ${_fmtOre(m.soglia||0)}</strong> (${m.attivita||0} attività)${m.cc&&m.cc.length?` · CC: ${_esc(m.cc.join(', '))}`:''}</span>`;
    else if(r.tipo==='alert_soglia_ticket')det=`<span style="color:var(--ink-3)">${_esc(m.progetto||'')}${m.area?' / '+_esc(m.area):''} — ${m.mese!=null?MONTHS[m.mese]:''} ${m.anno||''}: <strong style="color:var(--danger)">${m.totale}/${m.soglia}</strong> (L1 ${m.l1} · L2 ${m.l2} · L3 ${m.l3})${m.cc&&m.cc.length?` · CC: ${_esc(m.cc.join(', '))}`:''}</span>`;
    else if(r.tipo==='ticket_reminder')det=`<span style="color:var(--ink-3)">giorni ${(m.giorni||[]).join(', ')}${m.aree?` · ${_esc(m.aree.join(', '))}`:''}</span>`;
    else if(r.tipo==='assenza')det=`<span style="color:var(--ink-3)">${m.risorsa||''} — ${m.tipo||''} ${m.dal||''}${m.al&&m.al!==m.dal?'→'+m.al:''}${m.overlap?' <strong style="color:var(--amber)">⚠ overlap</strong>':''}</span>`;
    else det=`<span style="color:var(--ink-3)">giorno ${m.giorno||''}${m.response?` · <span title="${String(m.response).replace(/"/g,'&quot;')}">${String(m.response).slice(0,28)}</span>`:''}</span>`;
    h+=`<tr style="background:${i%2?'var(--stone)':'var(--white)'}">`;
    h+=`<td style="padding:5px 10px;white-space:nowrap;color:var(--ink-3)">${r.quando||''}</td>`;
    h+=`<td style="padding:5px 10px;white-space:nowrap">${TIPO_LBL[r.tipo]||r.tipo}</td>`;
    h+=`<td style="padding:5px 10px;white-space:nowrap"><div style="font-weight:600;color:var(--ink)">${r.nome||'—'}</div><div style="font-size:.66rem;color:var(--ink-3)">${r.destinatario}</div></td>`;
    h+=`<td style="padding:5px 10px;white-space:nowrap">${badge(r.stato)}</td>`;
    h+=`<td style="padding:5px 10px">${det}</td></tr>`;
  });
  h+='</tbody></table></div>';
  el.innerHTML=h;
}
// AVVIO
(async function init(){
  showSpinner();
  try{await reloadAll();}catch(e){hideSpinner();alert('Impossibile contattare il database.\n\nDettaglio: '+e.message+'\n\nVerifica che il sito sia pubblicato su Netlify con la function attiva e la variabile DATABASE_URL impostata.');return;}
  hideSpinner();refreshDropdowns();
})();