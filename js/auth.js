// Login, primo accesso, accesso admin, logout e avvio dell'app per ruolo
// SESSIONE: il token resta in localStorage (scade dopo 12 h senza uso), così refresh e nuove schede
// non richiedono un nuovo login; l'ultima sezione aperta è ricordata per scheda (sessionStorage).
const SESSION_KEY='tht_session',TAB_KEY='tht_tab',RENEW_MS=60*60*1000;
let _renewT=null;
function _setToken(t){_token=t||null;try{t?localStorage.setItem(SESSION_KEY,t):localStorage.removeItem(SESSION_KEY);}catch{}}
function _tokenSub(t){try{return JSON.parse(atob(t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{return null;}}
// All'avvio: link d'invito (?invite=) per impostare la password, altrimenti sessione salvata, altrimenti login
let _inviteToken=null;
async function restoreSession(){
  const inv=new URLSearchParams(location.search).get('invite');
  if(inv){await _openInvite(inv);return;}
  let t=null;try{t=localStorage.getItem(SESSION_KEY);}catch{}
  if(!t){document.getElementById('loginScreen').style.display='flex';return;}
  _token=t;let me;
  showSpinner();try{me=await call('session');}catch(e){hideSpinner();
    // 401: call() ha già riportato al login; altri errori (rete): login, il token resta per un nuovo tentativo
    if(_token){_token=null;document.getElementById('loginScreen').style.display='flex';alert('Impossibile contattare il server: '+e.message);}
    return;}
  hideSpinner();
  await _startSession(me.token,me.fullName,me.admin);
}
// Logout o login con un altro utente in un'altra scheda: questa scheda si allinea
window.addEventListener('storage',e=>{
  if(e.key!==SESSION_KEY||!_token)return;
  if(!e.newValue)doLogout();
  else if(_tokenSub(e.newValue)!==_tokenSub(_token))location.reload();
  else _token=e.newValue;
});
// LOGIN
// Link d'invito: l'eventuale sessione di un altro utente su questo browser viene chiusa
async function _openInvite(token){
  _setToken(null);
  document.getElementById('loginScreen').style.display='flex';
  let r;showSpinner();try{r=await call('inviteInfo',{token});}catch(e){hideSpinner();
    history.replaceState(null,'',location.pathname);goStepSelect();
    const err=document.getElementById('errEmail');err.textContent=e.message;err.style.display='block';return;}
  hideSpinner();
  _inviteToken=token;
  document.getElementById('loginSub').textContent=`Benvenuto/a, ${r.fullName}`;
  showStep('stepFirstAccess');document.getElementById('pwd1stA').value='';document.getElementById('pwd1stB').value='';document.getElementById('err1st').style.display='none';
}
function showStep(id){['stepSelect','stepInvite','stepFirstAccess','stepPwd','stepAdmin'].forEach(s=>document.getElementById(s).style.display=s===id?'block':'none');}
function goStepSelect(){document.getElementById('loginSub').textContent='Inserisci la tua email per accedere';showStep('stepSelect');document.getElementById('loginEmail').value='';document.getElementById('errEmail').style.display='none';}
function goAdminLogin(){document.getElementById('loginSub').textContent='Accesso amministratore';showStep('stepAdmin');document.getElementById('adminPwd').value='';document.getElementById('errAdmin').style.display='none';}
async function goStepPwdByEmail(){
  const email=document.getElementById('loginEmail').value.trim();
  const errEl=document.getElementById('errEmail');
  if(!email||!email.includes('@')){errEl.textContent='Inserisci un indirizzo email valido.';errEl.style.display='block';return;}
  let r=null;showSpinner();try{r=await call('loginLookup',{email});}catch(e){hideSpinner();errEl.textContent=e.message;errEl.style.display='block';return;}hideSpinner();
  if(!r){errEl.textContent='Nessun account trovato per questa email.';errEl.style.display='block';return;}
  errEl.style.display='none';_loginRisorsaId=r.risorsaId;_loginFullName=r.fullName;
  if(!r.hasPwd){
    document.getElementById('loginSub').textContent=`Benvenuto/a, ${r.fullName}`;showStep('stepInvite');
    document.getElementById('inviteText').textContent='Non hai ancora una password. Ti invieremo all\'email aziendale un link per impostarla: è valido 72 ore e si usa una sola volta.';
    document.getElementById('inviteBtn').style.display='';document.getElementById('errInvite').style.display='none';
  }
  else{document.getElementById('loginSub').textContent='Bentornato/a';document.getElementById('loginWhoLabel').textContent=r.fullName;showStep('stepPwd');document.getElementById('pwdInput').value='';document.getElementById('errPwd').style.display='none';setTimeout(()=>document.getElementById('pwdInput').focus(),100);}
}
// Primo accesso (o dopo un reset): la password si imposta solo dal link ricevuto via email
async function doRequestInvite(){
  if(!_loginRisorsaId)return;
  const errEl=document.getElementById('errInvite');let r;
  showSpinner();try{r=await call('requestInvite',{risorsaId:_loginRisorsaId});}catch(e){hideSpinner();errEl.textContent=e.message;errEl.style.display='block';return;}hideSpinner();
  errEl.style.display='none';document.getElementById('inviteBtn').style.display='none';
  document.getElementById('inviteText').textContent=`Ti abbiamo inviato il link a ${r.email}. Aprilo per impostare la password: è valido 72 ore.`;
}
async function doFirstAccess(){
  if(!_inviteToken)return;
  const p1=document.getElementById('pwd1stA').value,p2=document.getElementById('pwd1stB').value,errEl=document.getElementById('err1st');
  if(p1.length<6){errEl.textContent='Minimo 6 caratteri.';errEl.style.display='block';return;}
  if(p1!==p2){errEl.textContent='Le password non coincidono.';errEl.style.display='block';return;}
  errEl.style.display='none';
  let res;showSpinner();try{res=await call('firstAccess',{token:_inviteToken,password:p1});}catch(e){hideSpinner();errEl.textContent=e.message;errEl.style.display='block';return;}hideSpinner();
  _inviteToken=null;history.replaceState(null,'',location.pathname);
  await _startSession(res.token,res.fullName,false);
}
// Dopo il login: carica i dati (ora protetti dal token) e apre l'app
async function _startSession(token,user,admin){
  _setToken(token);
  showSpinner();try{await Promise.all([reloadAll(),_viewsReady]);}catch(e){hideSpinner();if(_token){_setToken(null);document.getElementById('loginScreen').style.display='flex';alert('Impossibile caricare i dati.\n\nDettaglio: '+e.message);}return;}hideSpinner();
  currentUser=user;isAdmin=admin;refreshDropdowns();
  // Rinnovo periodico: chi lascia l'app aperta non viene disconnesso a metà lavoro
  clearInterval(_renewT);_renewT=setInterval(()=>{if(_token)call('session').then(me=>_setToken(me.token)).catch(()=>{});},RENEW_MS);
  await launchApp();
}
async function doUserLogin(){
  if(!_loginRisorsaId)return;
  const pwd=document.getElementById('pwdInput').value,errEl=document.getElementById('errPwd');let res;
  showSpinner();try{res=await call('login',{risorsaId:_loginRisorsaId,password:pwd});}catch(e){hideSpinner();errEl.textContent=e.message;errEl.style.display='block';return;}hideSpinner();
  if(!res.ok){errEl.textContent='Password errata.';errEl.style.display='block';return;}
  errEl.style.display='none';document.getElementById('pwdInput').value='';
  await _startSession(res.token,_loginFullName,false);
}
async function doAdminLogin(){
  const pwd=document.getElementById('adminPwd').value,errEl=document.getElementById('errAdmin');let res;
  showSpinner();try{res=await call('adminLogin',{password:pwd});}catch(e){hideSpinner();errEl.textContent=e.message;errEl.style.display='block';return;}hideSpinner();
  if(!res.ok){errEl.textContent='Password errata.';errEl.style.display='block';return;}
  errEl.style.display='none';document.getElementById('adminPwd').value='';
  await _startSession(res.token,'ADMIN',true);
}
function doLogout(){_setToken(null);clearInterval(_renewT);try{sessionStorage.removeItem(TAB_KEY);}catch{}document.getElementById('alertBanner')?.classList.remove('visible');currentUser=null;isAdmin=false;isTeamLead=false;isSeniorManager=false;isProjectTL=false;_loginRisorsaId=null;_loginFullName='';RESOURCES=[];_cache={res:[],prj:[],hrs:[],fer:[],rep:[],pres:[],wbs:{},repTipi:{},aree:[],soglie:{},soglieArea:{}};document.getElementById('loginScreen').style.display='flex';document.getElementById('app').style.display='none';goStepSelect();}
async function launchApp(){
  let lastTab=null;try{lastTab=sessionStorage.getItem(TAB_KEY);}catch{}
  document.getElementById('loginScreen').style.display='none';document.getElementById('app').style.display='block';
  const initials=isAdmin?'AD':currentUser.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('userAvatar').textContent=initials;document.getElementById('hUser').textContent=isAdmin?'Admin':currentUser;
  isTeamLead=!isAdmin&&(RESOURCES.find(r=>r.fullName===currentUser)?.isManager||false);
  isSeniorManager=!isAdmin&&(RESOURCES.find(r=>r.fullName===currentUser)?.isSenior||false);
  isProjectTL=!isAdmin&&(Object.values(_prjTLsByName).some(tls=>tls.includes(currentUser))||_myAree().length>0);
  document.getElementById('hRole').textContent=isAdmin?'Amministratore':isSeniorManager?'Senior Manager':(isTeamLead?'Manager':(isProjectTL?'Team Leader':'Collaboratore'));
  const navVis=(id,show)=>{const el=document.getElementById(id);if(!el)return;el.classList.toggle('nav-hidden',!show);el.style.display=show?'':'none';};
  navVis('navOre',!isAdmin);
  navVis('navFerie',!isAdmin);
  navVis('navRep',!isAdmin);
  navVis('navPresenze',true);
  navVis('navConsuntivo',true);
  navVis('navAndamento',isAdmin||_andProjects().length>0);
  navVis('navFteTrend',isAdmin||_andProjects().length>0);
  navVis('navBenchmark',true);
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
  const canOpen=t=>t&&NAV_MAP[t]&&document.getElementById(NAV_MAP[t])?.style.display!=='none';
  if(canOpen(qTab))showTab(qTab);
  else if(canOpen(lastTab))showTab(lastTab);   // refresh: si torna alla sezione in cui si era
}
