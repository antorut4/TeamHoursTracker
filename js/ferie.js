// Ferie: inserimento, elenco, overview del team
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
