// Presenze in ufficio e inserimento assenze dal calendario
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
