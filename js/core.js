// API verso /api/db, cache dei dati, utility comuni (date, festivi, select), modale di conferma
let _busy=0;
function showSpinner(){_busy++;const e=document.getElementById('netSpinner');if(e)e.style.display='flex';}
function hideSpinner(){_busy=Math.max(0,_busy-1);if(_busy===0){const e=document.getElementById('netSpinner');if(e)e.style.display='none';}}
const FN_URL='/api/db';
// Token di sessione rilasciato dal server al login: identità e ruolo sono verificati lato server a ogni chiamata
let _token=null,_expiredShown=false;
async function call(action,payload){
  const headers={'Content-Type':'application/json'};if(_token)headers.Authorization='Bearer '+_token;
  const res=await fetch(FN_URL,{method:'POST',headers,body:JSON.stringify({action,payload:payload||{}})});
  let j=null;try{j=await res.json();}catch{}
  if(res.status===401&&_token)_sessionExpired();
  if(!res.ok||!j||j.error)throw new Error((j&&j.error)?j.error:('Errore di rete '+res.status));
  return j.data;
}
function _sessionExpired(){
  doLogout();
  if(!_expiredShown){_expiredShown=true;setTimeout(()=>{alert('La sessione è scaduta: accedi di nuovo.');_expiredShown=false;},0);}
}
// Escape HTML: ogni testo che arriva dal database va passato qui prima di finire in innerHTML,
// sia nel contenuto sia negli attributi (value, title, data-*)
function _esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Testo come argomento JS dentro un attributo HTML: onclick="fn(${_jsa(nome)})". Gestisce apostrofi, virgolette, backslash
function _jsa(v){return _esc(JSON.stringify(String(v??'')));}
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
  RESOURCES=(d.risorse||[]).map(r=>({id:r.id,nome:r.nome,cognome:r.cognome,fullName:r.full_name,email:(r.email||'').toLowerCase(),progetti:(byRes[r.id]||[]).filter(Boolean),managerId:r.manager_id||null,managerName:r.manager_id?nameById[r.manager_id]||null:null,isManager:!!r.is_manager,loadCost:r.load_cost!=null?+r.load_cost:null,dailyReminder:r.daily_reminder!==false,employeeId:r.employee_id||''}));
  _cache.res=RESOURCES;
  _cache.hrs=(d.ore||[]).map(o=>({id:o.id,risorsaId:o.risorsa_id,anno:+o.anno,mese:+o.mese,ore_q1:o.ore_q1!=null?+o.ore_q1:null,note_q1:o.note_q1,ore_q2:o.ore_q2!=null?+o.ore_q2:null,note_q2:o.note_q2}));
  _cache.fer=(d.ferie||[]).map(f=>({id:f.id,risorsaId:f.risorsa_id,start:(f.data_inizio||'').slice(0,10),end:(f.data_fine||'').slice(0,10),tipo:f.tipo,note:f.note,oraInizio:f.ora_inizio||null,oraFine:f.ora_fine||null}));
  _cache.rep=(d.rep||[]).map(rp=>({id:rp.id,risorsaId:+rp.risorsa_id,progetto:_prjNameById[rp.progetto_id]||'',teamLead:rp.team_lead_id?nameById[rp.team_lead_id]||'':'',anno:+rp.anno,mese:+rp.mese,giorni:Array.isArray(rp.giorni)?rp.giorni.map(Number):[],etichetta:rp.etichetta||''}));
  _cache.wbs=d.wbs||{};
  _cache.repTipi=d.repTipi||{};
  _cache.repExport=d.repExport||{};
  _cache.benchmark=d.benchmark||{};
  _cache.aree=(d.aree||[]).map(a=>({id:+a.id,progettoId:+a.progetto_id,nome:a.nome,teamLeadId:a.team_lead_id?+a.team_lead_id:null,attiva:a.attiva!==false}));
  // Soglie: area_id nullo = soglia di progetto, altrimenti soglia della singola area
  _cache.soglie={};_cache.soglieArea={};(d.soglie||[]).forEach(s=>{const v={soglia:s.soglia!=null?+s.soglia:null,sogliaEe:s.soglia_ee!=null?+s.soglia_ee:null,attiva:s.attiva!==false,destinatari:s.destinatari||''};if(s.area_id)_cache.soglieArea[s.area_id]=v;else _cache.soglie[s.progetto_id]=v;});
}
async function reloadAll2(){return reloadAll();}
async function getProjects(){return _cache.prj.slice();}
function getWbsForMember(risorsaId,anno,mese){return _cache.wbs[`${risorsaId}_${anno}_${mese}`]||[];}
function getRepTipiForPrj(progetto){const pid=_prjIdByName[progetto];const tipi=pid&&_cache.repTipi[String(pid)];return(tipi&&tipi.length)?tipi:[''];}
const MONTHS=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
// 'Assenza' = assenza di un collega senza dettaglio (il server non invia il tipo Malattia né le note)
const TIPO_C=t=>t==='Ferie'?'#7C5CFC':t==='Malattia'?'#E0245E':t==='Assenza'?'#9AA0BC':'#0E9F6E';
const PAL=['#7C5CFC','#4F8CFF','#0E9F6E','#F25C9A','#22B8CF','#F59E0B','#8B5CF6','#3B6FE0','#14B8A6','#E0245E','#6366F1','#EC4899'];
const S={get:k=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):null}catch{return null}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
let currentUser=null,isAdmin=false,isTeamLead=false,isProjectTL=false,RESOURCES=[];
function _resByName(name){return RESOURCES.find(x=>x.fullName===name);}
let _loginRisorsaId=null,_loginFullName='';
function getMembers(manager){return manager?RESOURCES.filter(r=>r.managerName===manager).map(r=>r.fullName):RESOURCES.map(r=>r.fullName);}
function getLeadTeam(){return RESOURCES.filter(r=>r.managerName===currentUser).map(r=>r.fullName);}
function getLeads(){return RESOURCES.filter(r=>r.isManager).map(r=>r.fullName).sort();}
function getLeadForMember(fullName){const r=RESOURCES.find(x=>x.fullName===fullName);return r?.managerName||'—';}
function colorFor(name){const i=RESOURCES.findIndex(r=>r.fullName===name);return PAL[i%PAL.length]||'#7C5CFC';}
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
