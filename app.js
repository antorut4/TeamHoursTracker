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
let _cache={res:[],prj:[],hrs:[],fer:[],rep:[],pres:[],wbs:{},repTipi:{}};
let _prjIdByName={},_prjNameById={},_prjTLByName={},_prjWbsByName={};
function _read(key,fallback){switch(key){case K_RES:return _cache.res;case K_PRJ:return _cache.prj;case K_HRS:return _cache.hrs;case K_FER:return _cache.fer;case K_REP:return _cache.rep;default:return fallback;}}
function _write(){}
async function reloadAll(){
  const d=await call('bootstrap');
  _cache.prj=(d.progetti||[]).map(r=>r.nome);
  _prjIdByName={};_prjNameById={};_prjTLByName={};
  const nameById={};(d.risorse||[]).forEach(r=>{nameById[r.id]=r.full_name;});
  (d.progetti||[]).forEach(r=>{_prjIdByName[r.nome]=r.id;_prjNameById[r.id]=r.nome;_prjTLByName[r.nome]=r.team_lead_id?nameById[r.team_lead_id]||'':'';_prjWbsByName[r.nome]=r.wbs||'';});
  const byRes={};
  (d.allocazioni||[]).forEach(a=>{
    if(!byRes[a.risorsa_id])byRes[a.risorsa_id]=[];
    byRes[a.risorsa_id].push(_prjNameById[a.progetto_id]);
  });
  RESOURCES=(d.risorse||[]).map(r=>({id:r.id,nome:r.nome,cognome:r.cognome,fullName:r.full_name,email:(r.email||'').toLowerCase(),progetti:(byRes[r.id]||[]).filter(Boolean),managerId:r.manager_id||null,managerName:r.manager_id?nameById[r.manager_id]||null:null,isManager:!!r.is_manager,loadCost:r.load_cost!=null?+r.load_cost:null}));
  _cache.res=RESOURCES;
  _cache.hrs=(d.ore||[]).map(o=>({id:o.id,risorsaId:o.risorsa_id,anno:+o.anno,mese:+o.mese,ore_q1:o.ore_q1!=null?+o.ore_q1:null,note_q1:o.note_q1,ore_q2:o.ore_q2!=null?+o.ore_q2:null,note_q2:o.note_q2}));
  _cache.fer=(d.ferie||[]).map(f=>({id:f.id,risorsaId:f.risorsa_id,start:(f.data_inizio||'').slice(0,10),end:(f.data_fine||'').slice(0,10),tipo:f.tipo,note:f.note}));
  _cache.rep=(d.rep||[]).map(rp=>({id:rp.id,risorsaId:rp.risorsa_id,progetto:_prjNameById[rp.progetto_id]||'',teamLead:_prjTLByName[_prjNameById[rp.progetto_id]]||'',anno:rp.anno,mese:rp.mese,giorni:Array.isArray(rp.giorni)?rp.giorni:[],etichetta:rp.etichetta||''}));
  _cache.wbs=d.wbs||{};
  _cache.repTipi=d.repTipi||{};
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
  isProjectTL=!isAdmin&&Object.values(_prjTLByName).includes(currentUser);
  document.getElementById('hRole').textContent=isAdmin?'Amministratore':(isTeamLead?'Manager':(isProjectTL?'Team Leader':'Collaboratore'));
  const navVis=(id,show)=>{const el=document.getElementById(id);if(!el)return;el.classList.toggle('nav-hidden',!show);el.style.display=show?'':'none';};
  navVis('navOre',!isAdmin);
  navVis('navFerie',!isAdmin);
  navVis('navRep',!isAdmin);
  navVis('navPresenze',true);
  navVis('navSectionTeam',isAdmin||isTeamLead);
  navVis('navRiepilogo',isAdmin||isTeamLead);
  navVis('navTrend',false);
  navVis('navOverview',isAdmin||isTeamLead);
  navVis('navRepOverview',isAdmin||isTeamLead);
  navVis('navSectionAdmin',isAdmin||isTeamLead);
  navVis('navAdmin',isAdmin||isTeamLead);
  initApp();
  if(isAdmin||isTeamLead)showTab('admin');else showTab('ore');
}
// INIT
async function initApp(){
  const now=new Date(),mOpts=MONTHS.map((m,i)=>({v:i,l:m})),yOpts=[-1,0,1].map(d=>{const y=now.getFullYear()+d;return{v:y,l:y};});
  ['oreMonth','riepilogoMonth','ovMonth','adminFerMonth','ferieCalMonth'].forEach(id=>popSel(id,mOpts,now.getMonth()));
  ['oreYear','riepilogoYear','ovYear','adminFerYear','ferieCalYear'].forEach(id=>popSel(id,yOpts,now.getFullYear()));
  popSel('filterAnno',[{v:'',l:'Tutti gli anni'},...yOpts],'');
  refreshDropdowns();
  if(!isAdmin){await loadOreForm();await renderMyOre();checkAlerts();}
  await renderFerieList();
  await populateProgettoSelect('res',getProgettoSelected('res'));
  await populateProgettoSelect('edit',getProgettoSelected('edit'));
  ['resLCField','editLCField'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=(isAdmin||isTeamLead)?'':'none';});
  if(isAdmin){['adminPrjCard','adminResByPrjCard','adminPwdCard'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='';});[document.getElementById('resManagerSel')?.closest('.field'),document.getElementById('editManagerSel')?.closest('.field'),document.getElementById('filterResLead')].forEach(el=>{if(el)el.style.display='';});await renderResourceList();await renderProjectList();await populateSearchByProject();}
  else if(isTeamLead){
    await renderResourceList();
    // Nascondi i card riservati al super-admin (gestione progetti è visibile al manager, filtrata)
    ['adminResByPrjCard','adminPwdCard'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
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
  ['riepilogoLead','trendLead','ovLead','adminFerLead','filterResLead'].forEach(id=>popSel(id,lOpts,''));
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
const TABS=['ore','riepilogo','trend','ferie','overview','reperibilita','admin','presenze'];
const NAV_MAP={ore:'navOre',riepilogo:'navRiepilogo',trend:'navTrend',ferie:'navFerie',overview:'navOverview','rep-overview':'navRepOverview',reperibilita:'navRep',admin:'navAdmin',presenze:'navPresenze'};
function toggleMobileNav(){const s=document.querySelector('.sidebar'),o=document.getElementById('mobileOverlay');s.classList.toggle('mobile-open');o.classList.toggle('visible');}
function closeMobileNav(){document.querySelector('.sidebar').classList.remove('mobile-open');document.getElementById('mobileOverlay').classList.remove('visible');}
async function showTab(t){
  closeMobileNav();
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));
  const an=document.getElementById(NAV_MAP[t]);if(an)an.classList.add('active');
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+t).classList.add('active');
  if(t==='trend')renderTrend().catch(console.error);
  if(t==='overview')renderOverview();
  if(t==='admin')renderAdminFerieCalendar();
  if(t==='riepilogo')loadRiepilogo().catch(console.error);
  if(t==='reperibilita')initRepPanel();
  if(t==='rep-overview')initRepOverviewPanel();
  if(t==='ferie'&&!isAdmin){renderFerieCalendar();}
  if(t==='presenze')initPresenzePanel();
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
  let h='<div class="table-wrap"><table><thead><tr><th>Mese</th><th>I Q</th><th>II Q</th><th>Totale</th><th>Disponibili</th></tr></thead><tbody>';
  rows.forEach(e=>{const tot=(+e.ore_q1||0)+(+e.ore_q2||0),av=wHours(e.anno,e.mese,1)+wHours(e.anno,e.mese,2);
    h+=`<tr><td><b>${MONTHS[e.mese]} ${e.anno}</b></td><td>${e.ore_q1!=null?e.ore_q1+'h':'—'}${e.note_q1?` <span style="color:var(--ink-3);font-size:.73rem">(${e.note_q1})</span>`:''}</td><td>${e.ore_q2!=null?e.ore_q2+'h':'—'}${e.note_q2?` <span style="color:var(--ink-3);font-size:.73rem">(${e.note_q2})</span>`:''}</td><td><b>${tot}h</b></td><td style="color:var(--ink-3)">${av}h</td></tr>`;
  });
  el.innerHTML=h+'</tbody></table></div>';
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
async function saveFerie(){
  const start=document.getElementById('ferieStart').value,end=document.getElementById('ferieEnd').value;
  const tipo=document.getElementById('ferieTipo').value,note=document.getElementById('ferieNote').value;
  if(!start||!end){showMsg('ferieMsg','Inserisci date di inizio e fine.','err');return;}if(end<start){showMsg('ferieMsg','Data fine deve essere >= inizio.','err');return;}
  const user=isAdmin?null:currentUser;if(!user){showMsg('ferieMsg','Admin non può inserire ferie per sé.','err');return;}
  const r=RESOURCES.find(x=>x.fullName===user);if(!r){showMsg('ferieMsg','Risorsa non trovata.','err');return;}
  showSpinner();try{await call('saveFerie',{risorsaId:r.id,start,end,tipo,note:note||null});await reloadAll();}catch(e){hideSpinner();showMsg('ferieMsg','Errore: '+e.message,'err');return;}hideSpinner();
  document.getElementById('ferieStart').value='';document.getElementById('ferieEnd').value='';document.getElementById('ferieNote').value='';document.getElementById('overlapWarn').style.display='none';
  showMsg('ferieMsg',tipo+' aggiunto/a','ok');await renderFerieList();renderFerieCalendar();
}
async function checkOverlap(){
  const start=document.getElementById('ferieStart').value,end=document.getElementById('ferieEnd').value;if(!start||!end)return;
  const r=RESOURCES.find(x=>x.fullName===currentUser),myId=r?r.id:0;
  const overl=(_read(K_FER,[])||[]).filter(f=>f.risorsaId!==myId&&f.start<=end&&f.end>=start);
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
  let rows=(_read(K_FER,[])||[]).map(f=>{const res=RESOURCES.find(x=>x.id===f.risorsaId);return{id:f.id,user:res?res.fullName:'?',start:f.start,end:f.end,tipo:f.tipo,note:f.note};}).sort((a,b)=>a.start<b.start?1:a.start>b.start?-1:0);
  let filtered=rows.filter(e=>{if(fm&&e.user!==fm)return false;if(fa&&!String(e.start).startsWith(fa))return false;if(visibili&&!visibili.includes(e.user))return false;if(search&&!e.user?.toLowerCase().includes(search)&&!(e.note||'').toLowerCase().includes(search))return false;return true;});
  if(!filtered.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.83rem">Nessuna voce trovata.</p>';return;}
  el.innerHTML=filtered.map(e=>{const days=wDays(e.start,e.end),color=TIPO_C(e.tipo),canDel=isAdmin||(e.user===currentUser),desc=e.tipo+' '+fmt(e.start)+'–'+fmt(e.end);
    return `<div class="ferie-item"><div style="display:flex;align-items:flex-start;gap:10px"><span class="ferie-dot" style="background:${color}"></span><div><b>${e.user||'—'}</b> — <span style="color:${color};font-weight:600">${e.tipo}</span><div class="ferie-meta">${fmt(e.start)} → ${fmt(e.end)} · ${days} gg lav.${e.note?' · '+e.note:''}</div></div></div>${canDel?`<button class="btn-icon danger" onclick="deleteFerie(${e.id},'${desc.replace(/'/g,"\\'")}')"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button>`:''}</div>`;
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
function renderFerieCalendar(){
  const el=document.getElementById('ferieCalendar');if(!el)return;
  const month=+document.getElementById('ferieCalMonth').value,year=+document.getElementById('ferieCalYear').value;
  const members=getMyTeamMembers();
  const dim=new Date(year,month+1,0).getDate(),hol=getHol(year);
  let allFer=(_read(K_FER,[])||[]).map(f=>{const r=RESOURCES.find(x=>x.id===f.risorsaId);return r?{user:r.fullName,start:f.start,end:f.end,tipo:f.tipo}:null;}).filter(Boolean);
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
    for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6,tipo=md[m][ds];let cb='',dot='';if(tipo){const c=TIPO_C(tipo);cb=`background:${c}18`;dot=`<div style="width:8px;height:8px;border-radius:2px;background:${c};margin:0 auto" title="${tipo}"></div>`;if(!iw&&!ih){tot++;bt[tipo]=(bt[tipo]||0)+1;}}else if(ih)cb='background:var(--amber-bg)';else if(iw)cb='background:var(--stone-2)';if(isMe&&!ih&&!iw){const ph=dot||`<div style="width:6px;height:6px;border-radius:50%;border:1.5px dashed rgba(0,0,0,.18);margin:0 auto"></div>`;h+=`<td style="padding:3px 1px;text-align:center;${cb};cursor:pointer" onclick="toggleFerieDay('${ds}')" title="${tipo?tipo+' — clicca per eliminare':'Aggiungi assenza'}">${ph}</td>`;}else{h+=`<td style="padding:3px 1px;text-align:center;${cb}">${dot}</td>`;}}
    h+=`<td style="padding:5px 6px;text-align:center;font-weight:700;color:var(--ink);border-left:2px solid var(--stone-3)">${tot}</td></tr>`;
    sumData.push({name:m,days:tot,bt});
  });
  el.innerHTML=h+'</tbody></table>';
  document.getElementById('ferieCalCards').innerHTML=sumData.map(s=>{const det=Object.entries(s.bt).map(([t,n])=>`${t}: ${n}gg`).join(' · ')||'Nessuna assenza';return `<div class="ov-card"><div class="oc-name" style="color:${colorFor(s.name)}">${s.name}</div><div class="oc-num">${s.days} <span style="font-size:.75rem;font-weight:400;color:var(--ink-3)">gg</span></div><div class="oc-sub">${det}</div></div>`;}).join('');
  const ovs=[];for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt);if(wd===0||wd===6||hol.has(ds))continue;const ab=members.filter(m=>md[m][ds]);if(ab.length>1)ovs.push({ds,names:ab,tipi:ab.map(m=>md[m][ds])});}
  document.getElementById('ferieCalOverlaps').innerHTML=ovs.length
    ?`<div style="background:var(--warn-bg);border:1px solid rgba(125,78,0,.2);border-radius:var(--r);padding:12px 14px"><div style="font-weight:600;color:var(--warn);margin-bottom:7px;font-size:.83rem"><i class="fa-solid fa-triangle-exclamation" style="margin-right:6px"></i>Sovrapposizioni (${ovs.length} giorni)</div>${ovs.map(o=>`<div style="font-size:.79rem;color:var(--warn);margin-bottom:3px">${fmt(o.ds)} — ${o.names.map((n,i)=>`${n.split(' ')[0]} (${o.tipi[i]})`).join(', ')}</div>`).join('')}</div>`
    :`<div style="background:var(--ok-bg);border-radius:var(--r);padding:9px 13px;font-size:.82rem;color:var(--ok)"><i class="fa-solid fa-check" style="margin-right:7px"></i>Nessuna sovrapposizione questo mese</div>`;
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
  const tl=_prjTLByName[value];
  const tlHtml=tl?` <span style="font-size:.67rem;color:var(--amber);font-weight:600">→ ${tl.split(' ')[0]}</span>`:'';
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
async function addProject(){
  const name=document.getElementById('newPrjName').value.trim();if(!name){showMsg('addPrjMsg','Inserisci il nome del progetto.','err');return;}
  const prjs=await getProjects();if(prjs.map(p=>p.toLowerCase()).includes(name.toLowerCase())){showMsg('addPrjMsg','Progetto già esistente.','err');return;}
  const tlName=document.getElementById('newPrjTLSel')?.value||'';
  const wbs=(document.getElementById('newPrjWbs')?.value||'').trim();
  showSpinner();try{await call('addProject',{nome:name,teamLeadName:tlName||null,wbs:wbs||null});await reloadAll();}catch(e){hideSpinner();showMsg('addPrjMsg','Errore: '+e.message,'err');return;}hideSpinner();
  document.getElementById('newPrjName').value='';const ts=document.getElementById('newPrjTLSel');if(ts)ts.value='';const ws=document.getElementById('newPrjWbs');if(ws)ws.value='';
  await renderProjectList();populateProgettoSelect('res',getProgettoSelected('res'));populateProgettoSelect('edit',getProgettoSelected('edit'));populateSearchByProject();refreshDropdowns();showMsg('addPrjMsg','"'+name+'" aggiunto','ok');
}
async function saveProjectLead(id,tlName){
  showSpinner();try{await call('saveProjectLead',{id,teamLeadName:tlName||null});await reloadAll();}catch(e){hideSpinner();alert('Errore: '+e.message);return;}hideSpinner();
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
  const tl=_prjTLByName[prj]||'—';
  el.innerHTML=`<div style="font-size:.72rem;color:var(--amber);font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:9px">${staffed.length} risorsa${staffed.length!==1?'e':''} su ${prj} · TL: ${tl}</div>`+staffed.map(r=>`<div class="resource-row"><div><div class="rname">${r.fullName}</div><div class="rmeta">${(r.progetti||[]).join(', ')||'—'}</div></div></div>`).join('');
}
async function populateSearchByProject(){const sel=document.getElementById('searchByProject');if(!sel)return;const prjs=(isTeamLead&&!isAdmin)?_getManagerProjects():(await getProjects()).sort();const cur=sel.value;sel.innerHTML='<option value="">— Seleziona —</option>';prjs.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;if(p===cur)o.selected=true;sel.appendChild(o);});}
function _getManagerProjects(){const myResPrjs=new Set(RESOURCES.filter(r=>r.managerName===currentUser).flatMap(r=>r.progetti||[]));return(_cache.prj||[]).filter(p=>myResPrjs.has(p)).sort();}
async function renderProjectList(){
  const prjsFull=(isTeamLead&&!isAdmin)?_getManagerProjects():(_cache.prj||[]).slice().sort();const el=document.getElementById('prjList');if(!el)return;
  if(!prjsFull.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessun progetto.</p>';return;}
  const tlOpts=RESOURCES.map(r=>`<option value="${r.fullName.replace(/"/g,'&quot;')}">${r.fullName}</option>`).join('');
  el.innerHTML=prjsFull.map(p=>{
    const pid=_prjIdByName[p]||0,tl=_prjTLByName[p]||'';
    const pSafe=p.replace(/'/g,"\\'");
    const tipi=_cache.repTipi[String(pid)]||[];
    const tipiTags=tipi.length?tipi.map(t=>`<span style="background:var(--info-bg);color:var(--info);border-radius:4px;padding:1px 7px;font-size:.7rem;display:inline-flex;align-items:center;gap:3px">${t} <button onclick="removeRepTipoUI(${pid},'${t.replace(/'/g,"\\'")}')" style="background:none;border:none;cursor:pointer;color:var(--info);padding:0;line-height:1;font-size:.75rem">×</button></span>`).join(''):'<span style="font-size:.7rem;color:var(--ink-3);font-style:italic">predefinita</span>';
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;background:var(--stone);border-radius:var(--r);margin-bottom:6px;border:1px solid var(--line)">
      <i class="fa-solid fa-folder" style="color:var(--amber);font-size:.8rem;flex-shrink:0"></i>
      <span style="font-size:.85rem;font-weight:500;flex:1;min-width:80px">${p}</span>
      <span style="font-size:.75rem;color:var(--ink-3);white-space:nowrap">TL:</span>
      <select style="font-size:.75rem;padding:2px 5px;border-radius:4px;border:1px solid var(--line);background:var(--white);max-width:160px" onchange="saveProjectLead(${pid},this.value)">
        <option value="">— Nessuno —</option>${tlOpts.replace(`value="${tl.replace(/"/g,'&quot;')}"`,`value="${tl.replace(/"/g,'&quot;')}" selected`)}
      </select>
      <span style="font-size:.75rem;color:var(--ink-3);white-space:nowrap;flex-shrink:0">WBS:</span>
      <input type="text" placeholder="Codice WBS" value="${(_prjWbsByName[p]||'').replace(/"/g,'&quot;')}" style="font-size:.75rem;padding:2px 6px;border-radius:4px;border:1px solid var(--line);background:var(--white);max-width:120px" onblur="saveProjectWbs(${pid},this.value)" onkeydown="if(event.key==='Enter')saveProjectWbs(${pid},this.value)"/>
      <button class="btn-icon danger" onclick="deleteProject('${pSafe}')"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button>
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
    if(lf&&!r.progetti.some(p=>_prjTLByName[p]===lf))return false;
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
  const month=+document.getElementById('riepilogoMonth').value,year=+document.getElementById('riepilogoYear').value;
  const lf=(isTeamLead&&!isAdmin)?currentUser:(document.getElementById('riepilogoLead')?.value||''),members=getMembers(lf);
  let all={};(_read(K_HRS,[])||[]).filter(o=>o.anno===year&&o.mese===month).forEach(o=>{const res=RESOURCES.find(x=>x.id===o.risorsaId);if(res)all[res.fullName]={ore1:o.ore_q1,note1:o.note_q1,ore2:o.ore_q2,note2:o.note_q2};});
  const allFerRows=(_read(K_FER,[])||[]).map(f=>{const res=RESOURCES.find(x=>x.id===f.risorsaId);return res?{user:res.fullName,start:f.start,end:f.end,tipo:f.tipo,note:f.note}:null;}).filter(Boolean);
  const av=wHours(year,month,1)+wHours(year,month,2);
  const sd=[['Risorsa','Team Lead','I Q (h)','II Q (h)','Totale (h)','Disponibili','Stato']];
  members.forEach(m=>{const lead=getLeadForMember(m),e=all[m];if(e){const tot=(+e.ore1||0)+(+e.ore2||0);sd.push([m,lead,e.ore1||0,e.ore2||0,tot,av,tot>av?'Extra':'OK']);}else sd.push([m,lead,'—','—','—',av,'Mancante']);});
  const fd=[['Risorsa','Team Lead','Tipo','Data Inizio','Data Fine','Giorni Lav.','Note']];
  allFerRows.forEach(e=>{fd.push([e.user,getLeadForMember(e.user),e.tipo,fmt(e.start),fmt(e.end),wDays(e.start,e.end),e.note||'']);});
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(sd),'Riepilogo Ore');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(fd),'Ferie');XLSX.writeFile(wb,`TeamHours_${MONTHS[month]}_${year}.xlsx`);
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
let _repGridData={};
function calcRepEarningsFromDays(days,anno,mese){const hol=getHol(anno);return days.reduce((tot,d)=>{const dt=new Date(anno,mese,d),wd=dt.getDay(),ds=localDate(dt);return tot+(wd===0||wd===6||hol.has(ds)?40:25);},0);}
function calcRepEarnings(resourceName,year,month,etichetta){const gd=_repGridData[etichetta]?.[resourceName];if(!gd)return 0;return calcRepEarningsFromDays([...gd.selectedDays],year,month);}
async function initRepPanel(){
  const now=new Date();
  if(isProjectTL||isAdmin){
    document.getElementById('repUserView').style.display='none';document.getElementById('repLeadView').style.display='block';
    const mOpts=MONTHS.map((m,i)=>({v:i,l:m})),yOpts=[-1,0,1].map(d=>{const y=now.getFullYear()+d;return{v:y,l:y};});
    popSel('repMonth',mOpts,now.getMonth());popSel('repYear',yOpts,now.getFullYear());
    const team=isAdmin?RESOURCES:RESOURCES.filter(r=>(r.progetti||[]).some(p=>_prjTLByName[p]===currentUser));
    const rFilt=document.getElementById('repFilterRisorsa');rFilt.innerHTML='<option value="">Tutte le risorse</option>';team.forEach(r=>{const o=document.createElement('option');o.value=r.fullName;o.textContent=r.fullName;rFilt.appendChild(o);});
    const yFilt=document.getElementById('repFilterAnno');yFilt.innerHTML='<option value="">Tutti gli anni</option>';yOpts.forEach(({v,l})=>{const o=document.createElement('option');o.value=v;o.textContent=l;yFilt.appendChild(o);});
    const mFilt=document.getElementById('repFilterMese');mFilt.innerHTML='<option value="">Tutti i mesi</option>';mOpts.forEach(({v,l})=>{const o=document.createElement('option');o.value=v;o.textContent=l;mFilt.appendChild(o);});
    const myPrjs=isAdmin?await getProjects():Object.entries(_prjTLByName).filter(([,tl])=>tl===currentUser).map(([p])=>p).sort();
    const repPrjSel=document.getElementById('repProgetto');repPrjSel.innerHTML='<option value="">— Seleziona —</option>';myPrjs.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;repPrjSel.appendChild(o);});
    await buildRepGriglia();await renderRepTeam();
  }else{document.getElementById('repUserView').style.display='block';document.getElementById('repLeadView').style.display='none';await renderRepMine();}
}
async function ferieGiorniSet(fullName,year,month){const r=RESOURCES.find(x=>x.fullName===fullName);const mine=r?(_read(K_FER,[])||[]).filter(f=>f.risorsaId===r.id):[];const set=new Set();mine.forEach(e=>{let cur=new Date(e.start+'T12:00:00'),en=new Date(e.end+'T12:00:00');while(cur<=en){if(cur.getFullYear()===year&&cur.getMonth()===month)set.add(cur.getDate());cur.setDate(cur.getDate()+1);}});return set;}
async function buildRepGriglia(){
  const progetto=document.getElementById('repProgetto').value,month=+document.getElementById('repMonth').value,year=+document.getElementById('repYear').value;
  const wrap=document.getElementById('repGrigliaWrap');
  if(!progetto){wrap.style.display='none';_repGridData={};return;}
  wrap.style.display='block';
  const allRes=RESOURCES.filter(r=>(r.progetti||[r.progetto]).filter(Boolean).includes(progetto));
  const resources=isAdmin?allRes:(_prjTLByName[progetto]===currentUser?allRes:allRes.filter(r=>r.fullName===currentUser));
  if(!resources.length){document.getElementById('repGriglia').innerHTML='<p style="color:var(--ink-3);font-size:.84rem;padding:12px">Nessuna risorsa del tuo team su questo progetto.</p>';_repGridData={};return;}
  const tipi=getRepTipiForPrj(progetto);
  const dim=new Date(year,month+1,0).getDate(),hol=getHol(year);
  const DN=['D','L','M','M','G','V','S'];
  _repGridData={};
  const existingRep=(_cache.rep||[]);
  for(const etichetta of tipi){
    _repGridData[etichetta]={};
    for(const r of resources){
      const ferieSet=await ferieGiorniSet(r.fullName,year,month);
      const existing=existingRep.filter(rp=>rp.risorsaId===r.id&&rp.anno===year&&rp.mese===month&&rp.progetto===progetto&&(rp.etichetta||'')===(etichetta||''));
      const existingDays=new Set(existing.flatMap(rp=>rp.giorni));
      _repGridData[etichetta][r.fullName]={ferieSet,selectedDays:existingDays,rid:r.id};
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
      h+=`<td style="padding:5px 10px;font-weight:600;font-size:.74rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit">${r.fullName.split(' ')[0]}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${r.fullName.split(' ').slice(1).join(' ')}</span></td>`;
      for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6,isFerie=gd.ferieSet.has(d),isSel=gd.selectedDays.has(d);
        if(isFerie){h+=`<td style="background:var(--danger-bg);border:1px solid rgba(201,0,60,.12);padding:3px 1px;text-align:center" title="In ferie"><div class="rep-day-blocked">F</div></td>`;}
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
  document.getElementById('repGriglia').innerHTML=h;
}
function toggleRepDayGrid(resourceName,d,etichetta){
  etichetta=etichetta||'';
  const gd=_repGridData[etichetta]?.[resourceName];if(!gd)return;
  const r=RESOURCES.find(x=>x.fullName===resourceName);if(!r)return;
  const etiKey=etichetta||'main';
  const el=document.getElementById(`rd_${r.id}_${d}_${etiKey}`);if(!el)return;
  if(gd.selectedDays.has(d)){gd.selectedDays.delete(d);el.classList.remove('on');}
  else{gd.selectedDays.add(d);el.classList.add('on');}
  const month=+document.getElementById('repMonth').value,year=+document.getElementById('repYear').value;
  const earn=calcRepEarnings(resourceName,year,month,etichetta);
  const ggEl=document.getElementById(`repgg_${r.id}_${etiKey}`),eurEl=document.getElementById(`repeur_${r.id}_${etiKey}`);
  if(ggEl)ggEl.textContent=gd.selectedDays.size;
  if(eurEl)eurEl.textContent=`€${earn}`;
  updateRepTotals();
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
  await buildRepGriglia();await renderRepTeam();
}
async function renderRepTeam(){
  const fRis=document.getElementById('repFilterRisorsa')?.value||'',fAnno=document.getElementById('repFilterAnno')?.value||'',fMese=document.getElementById('repFilterMese')?.value;
  const teamNames=isAdmin?RESOURCES.map(r=>r.fullName):RESOURCES.filter(r=>(r.progetti||[]).some(p=>_prjTLByName[p]===currentUser)).map(r=>r.fullName);
  let filtered=(await getRepStore()).filter(r=>{if(!isAdmin&&!teamNames.includes(r.fullName))return false;if(fRis&&r.fullName!==fRis)return false;if(fAnno&&+r.anno!==+fAnno)return false;if(fMese!==''&&fMese!==undefined&&+r.mese!==+fMese)return false;return true;});
  const el=document.getElementById('repTeamList');
  if(!filtered.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessuna reperibilità trovata.</p>';return;}
  const ferieMap={};await Promise.all(filtered.map(async r=>{ferieMap[r.fullName+'|'+r.anno+'|'+r.mese]=await ferieGiorniSet(r.fullName,r.anno,r.mese);}));
  el.innerHTML=filtered.map(r=>{const ferie=ferieMap[r.fullName+'|'+r.anno+'|'+r.mese]||new Set();
    const daysStr=r.giorni.map(d=>{const iF=ferie.has(d);return `<span style="display:inline-block;background:${iF?'var(--warn-bg)':'var(--info-bg)'};color:${iF?'var(--warn)':'var(--info)'};border-radius:4px;padding:1px 6px;margin:1px 2px;font-size:.71rem">${iF?'⚠ ':''}${d} ${MONTHS[r.mese].slice(0,3)}</span>`;}).join('');
    const canDel=isAdmin||(isProjectTL&&_prjTLByName[r.progetto]===currentUser);
    const earn=calcRepEarningsFromDays(r.giorni,r.anno,r.mese);
    return `<div class="rep-entry"><div style="flex:1"><div class="re-proj">${r.progetto}${r.etichetta?` <span style="font-size:.72rem;font-weight:400;color:var(--ink-3)">(${r.etichetta})</span>`:''}</div><div class="re-meta"><b>${r.fullName}</b> · ${MONTHS[r.mese]} ${r.anno} · ${r.giorni.length} giorno/i · <span style="color:var(--ok);font-weight:700">€${earn}</span> · Lead: ${r.teamLead||'—'}</div><div class="re-days">${daysStr}</div></div>${canDel?`<button class="btn-icon danger" onclick="deleteRep(${r.id},'${r.fullName.replace(/'/g,"\\'")}','${r.progetto.replace(/'/g,"\\'")}')"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button>`:''}</div>`;
  }).join('');
}
async function renderRepMine(){
  const mine=await repForUser(currentUser);
  const el=document.getElementById('repMyList');
  if(!mine.length){el.innerHTML='<p style="color:var(--ink-3);font-size:.84rem">Nessuna reperibilità assegnata.</p>';return;}
  const ferieMineMap={};
  await Promise.all(mine.map(async r=>{ferieMineMap[r.anno+'|'+r.mese]=await ferieGiorniSet(currentUser,r.anno,r.mese);}));
  const totGiorni=mine.reduce((s,r)=>s+r.giorni.length,0);
  const totEuro=mine.reduce((s,r)=>s+calcRepEarningsFromDays(r.giorni,r.anno,r.mese),0);
  const totConflitti=mine.reduce((s,r)=>{const ferie=ferieMineMap[r.anno+'|'+r.mese]||new Set();return s+r.giorni.filter(d=>ferie.has(d)).length;},0);
  let html=`<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
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
  html+=mine.map(r=>{
    const ferie=ferieMineMap[r.anno+'|'+r.mese]||new Set();
    const daysStr=r.giorni.map(d=>{const iF=ferie.has(d),wd=new Date(r.anno,r.mese,d).getDay(),isWe=wd===0||wd===6;return `<span style="display:inline-block;background:${iF?'var(--warn-bg)':isWe?'rgba(161,0,255,.1)':'var(--info-bg)'};color:${iF?'var(--warn)':isWe?'var(--amber)':'var(--info)'};border-radius:4px;padding:1px 6px;margin:1px 2px;font-size:.71rem;font-weight:${isWe?700:400}" title="${iF?'Giorno di ferie!':isWe?'Weekend €40':'Feriale €25'}">${iF?'⚠ ':''}${d} ${MONTHS[r.mese].slice(0,3)}</span>`;}).join('');
    const conflitti=r.giorni.filter(d=>ferie.has(d)).length;
    const earn=calcRepEarningsFromDays(r.giorni,r.anno,r.mese);
    return `<div class="rep-entry"><div><div class="re-proj">${r.progetto}${r.etichetta?` <span style="font-size:.72rem;font-weight:400;color:var(--ink-3)">(${r.etichetta})</span>`:''}</div><div class="re-meta">${MONTHS[r.mese]} ${r.anno} · ${r.giorni.length} giorno/i · <span style="color:var(--ok);font-weight:700">€${earn}</span>${conflitti?` · <span style="color:var(--warn);font-weight:600">${conflitti} giorno/i in ferie!</span>`:''}</div><div class="re-days">${daysStr}</div></div></div>`;
  }).join('');
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
    const tl=_prjTLByName[progetto]||'—';
    html+=`<div class="card" style="margin-bottom:16px">`;
    html+=`<div class="card-title"><i class="fa-solid fa-folder"></i> ${progetto} <span style="font-size:.72rem;color:var(--ink-3);font-weight:400;margin-left:6px">TL: ${tl}</span></div>`;
    html+=`<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:.72rem;width:100%"><thead><tr>`;
    html+=`<th style="padding:5px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;min-width:90px;position:sticky;left:0;z-index:1">Risorsa</th>`;
    for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6;
      html+=`<th style="padding:2px 1px;background:${ih?'var(--amber-bg)':iw?'rgba(161,0,255,.12)':'var(--ink)'};color:${ih||iw?'var(--amber)':'var(--white)'};text-align:center;min-width:24px;font-size:.6rem"><div>${DN[wd]}</div><div>${d}</div></th>`;}
    html+=`<th style="padding:5px 4px;background:var(--ink);color:var(--white);text-align:center;min-width:32px;font-size:.65rem">Gg</th>`;
    html+=`<th style="padding:5px 8px;background:var(--ink);color:var(--white);text-align:right;min-width:70px;white-space:nowrap;font-size:.65rem">Guad.</th></tr></thead><tbody>`;
    resOnPrj.forEach((r,ri)=>{
      const entry=entries.find(e=>e.risorsaId===r.id);
      const days=entry?new Set(entry.giorni):new Set();
      html+=`<tr style="background:${ri%2?'var(--stone)':'var(--white)'}">`;
      html+=`<td style="padding:5px 10px;font-weight:600;font-size:.74rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit">${r.fullName.split(' ')[0]}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${r.fullName.split(' ').slice(1).join(' ')}</span></td>`;
      for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6,on=days.has(d);
        html+=`<td style="border:1px solid var(--line);padding:2px 1px;text-align:center;background:${on?'rgba(0,123,255,.12)':ih?'var(--amber-bg)':iw?'rgba(161,0,255,.05)':'var(--stone)'}"><div style="width:14px;height:14px;margin:auto;border-radius:50%;background:${on?'var(--info)':'transparent'};display:flex;align-items:center;justify-content:center;font-size:.55rem;color:white">${on?'✓':''}</div></td>`;}
      const earn=entry?calcRepEarningsFromDays(entry.giorni,year,month):0;
      html+=`<td style="padding:5px 4px;text-align:center;font-weight:600;font-size:.72rem">${days.size}</td>`;
      html+=`<td style="padding:5px 8px;text-align:right;font-weight:700;color:var(--ok);font-size:.72rem;border-left:1px solid var(--stone-3)">€${earn}</td></tr>`;
    });
    html+=`</tbody></table></div>`;
    const totGg=entries.reduce((s,e)=>s+e.giorni.length,0),totEur=entries.reduce((s,e)=>s+calcRepEarningsFromDays(e.giorni,year,month),0);
    html+=`<div style="margin-top:10px;padding:8px 12px;background:var(--stone);border-radius:var(--r);display:flex;gap:16px;flex-wrap:wrap;font-size:.78rem">`;
    html+=`<span><b>${resOnPrj.length}</b> risorsa/e</span><span><b>${totGg}</b> giorni totali</span><span style="color:var(--ok);font-weight:700">€${totEur} totale</span></div></div>`;
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
  document.getElementById('feriePickerDate').textContent=fmt(dateStr);
  document.getElementById('feriePickerOverlay').classList.add('open');
  document.getElementById('feriePickerBox').classList.add('open');
}
function closeFeriePicker(){
  _feriePickerDate=null;
  document.getElementById('feriePickerOverlay').classList.remove('open');
  document.getElementById('feriePickerBox').classList.remove('open');
}
async function pickFerieTipo(tipo){
  const dateStr=_feriePickerDate;closeFeriePicker();if(!dateStr)return;
  const r=RESOURCES.find(x=>x.fullName===currentUser);if(!r)return;
  showSpinner();try{await call('saveFerie',{risorsaId:r.id,start:dateStr,end:dateStr,tipo,note:null});await reloadAll();}catch(e){hideSpinner();showMsg('ferieMsg','Errore: '+e.message,'err');return;}
  hideSpinner();renderFerieCalendar();showMsg('ferieMsg',tipo+' aggiunto/a.','ok');
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
// AVVIO
(async function init(){
  showSpinner();
  try{await reloadAll();}catch(e){hideSpinner();alert('Impossibile contattare il database.\n\nDettaglio: '+e.message+'\n\nVerifica che il sito sia pubblicato su Netlify con la function attiva e la variabile DATABASE_URL impostata.');return;}
  hideSpinner();refreshDropdowns();
})();