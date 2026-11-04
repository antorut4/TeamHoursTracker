// EVENTI: chi crea l'evento sceglie gli invitati; se la data non è fissata gli invitati segnano la disponibilità
// giorno per giorno nel periodo proposto e l'organizzatore fissa la data. Ognuno risponde "ci sono / non ci sono"
// con un commento. I permessi sono controllati sul server: qui si nascondono solo i comandi non disponibili.
let _ev={view:'list',id:null,list:[],data:null,form:null};
const EV_ST={si:{l:'Disponibile',ic:'fa-check',cls:'si'},forse:{l:'Forse',ic:'fa-question',cls:'forse'},no:{l:'Non disponibile',ic:'fa-xmark',cls:'no'}};
const EV_NEXT={'':'si',si:'forse',forse:'no',no:''};
const _evDate=iso=>new Date(iso+'T00:00:00');
const _evCap=s=>s.charAt(0).toUpperCase()+s.slice(1);
function _evLong(iso){return _evCap(_evDate(iso).toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long',year:'numeric'}));}
function _evShort(iso){return _evDate(iso).toLocaleDateString('it-IT',{day:'numeric',month:'short'});}
function _evDays(da,a){const out=[];for(let d=_evDate(da);d<=_evDate(a);d.setDate(d.getDate()+1))out.push(_isoLocal(d));return out;}
function _isoLocal(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function _evToday(){return _isoLocal(new Date());}
function _evMe(){return isAdmin?null:(RESOURCES.find(r=>r.fullName===currentUser)||null);}
function _evInitials(n){return String(n||'?').split(' ').filter(Boolean).map(w=>w[0]).slice(0,2).join('').toUpperCase();}
function _evAvatar(n){return `<span class="ev-av" style="background:${colorFor(n)}">${_esc(_evInitials(n))}</span>`;}
function _evWhen(e){
  if(e.data)return `<i class="fa-regular fa-calendar-check"></i> ${_esc(_evLong(e.data))}`;
  if(e.periodo_da)return `<i class="fa-regular fa-calendar"></i> Data da definire · disponibilità dal ${_esc(_evShort(e.periodo_da))} al ${_esc(_evShort(e.periodo_a))}`;
  return '<i class="fa-regular fa-calendar"></i> Data da definire';
}

async function renderEventi(){
  const el=document.getElementById('eventiContent');if(!el)return;
  if(_ev.view==='form')return _evRenderForm();
  if(_ev.view==='detail'&&_ev.id)return _evLoadDetail(_ev.id);
  showSpinner();
  try{_ev.list=await call('getEventi',{});}catch(e){hideSpinner();el.innerHTML=`<div class="msg err">Errore: ${_esc(e.message)}</div>`;return;}
  hideSpinner();
  _evRenderList();
}
function evBack(){_ev={..._ev,view:'list',id:null,data:null,form:null};renderEventi().catch(console.error);}
function evOpen(id){_ev.view='detail';_ev.id=id;renderEventi().catch(console.error);}

// ── elenco: prossimi eventi e archivio ──
function _evRenderList(){
  const el=document.getElementById('eventiContent'),today=_evToday();
  const past=e=>(e.data||e.periodo_a||'9999')<today;
  const next=_ev.list.filter(e=>!past(e)),old=_ev.list.filter(past);
  if(!_ev.list.length){
    el.innerHTML=`<div class="card ev-empty"><i class="fa-regular fa-calendar-plus"></i><div><b>Nessun evento</b><p>Crea un evento con <b>Nuovo evento</b> e scegli chi invitare: riceveranno l'invito qui, in questa sezione.</p></div></div>`;return;
  }
  const card=e=>{
    const me=e.mia_risposta==='si'?'<span class="badge badge-ok"><i class="fa-solid fa-check"></i> Ci sono</span>'
      :e.mia_risposta==='no'?'<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Non ci sono</span>'
      :e.invitato?'<span class="badge badge-warn"><i class="fa-regular fa-clock"></i> Da rispondere</span>':'';
    return `<div class="card ev-card" role="button" tabindex="0" onclick="evOpen(${+e.id})" onkeydown="if(event.key==='Enter')evOpen(${+e.id})">
      <div class="ev-card-ic"><i class="fa-solid fa-champagne-glasses"></i></div>
      <div class="ev-card-body">
        <div class="ev-card-hd"><b>${_esc(e.nome)}</b>${e.owner?'<span class="badge badge-amber"><i class="fa-solid fa-crown"></i> Organizzatore</span>':''}</div>
        ${e.luogo?`<div class="ev-meta"><i class="fa-solid fa-location-dot"></i> ${_esc(e.luogo)}</div>`:''}
        <div class="ev-meta">${_evWhen(e)}</div>
        <div class="ev-card-ft"><span>${e.si} ci sono · ${e.no} non ci sono · ${e.invitati} invitati</span>${me}</div>
      </div></div>`;
  };
  el.innerHTML=(next.length?`<div class="ev-grid-list">${next.map(card).join('')}</div>`:'<div class="card"><p class="ev-note">Nessun evento in programma.</p></div>')
    +(old.length?`<details class="and-acts ev-archive"><summary>Archivio eventi (${old.length})</summary><div class="ev-grid-list">${old.map(card).join('')}</div></details>`:'');
}

// ── dettaglio ──
async function _evLoadDetail(id){
  const el=document.getElementById('eventiContent');
  showSpinner();let d;
  try{d=await call('getEvento',{id});}catch(e){hideSpinner();_ev.view='list';el.innerHTML=`<div class="msg err">${_esc(e.message)}</div>`;setTimeout(()=>renderEventi().catch(console.error),1500);return;}
  hideSpinner();
  _ev.data=d;_evRenderDetail();
}
// Giorno suggerito: più "disponibile", poi più "forse", poi il primo in ordine di data
function _evBest(d){
  if(!d.periodo_da)return null;
  let best=null;
  _evDays(d.periodo_da,d.periodo_a).forEach(day=>{
    const rows=d.disponibilita.filter(x=>x.data===day),si=rows.filter(x=>x.stato==='si').length,fo=rows.filter(x=>x.stato==='forse').length;
    if(si+fo&&(!best||si>best.si||(si===best.si&&fo>best.fo)))best={day,si,fo};
  });
  return best;
}
function _evRenderDetail(){
  const d=_ev.data,el=document.getElementById('eventiContent');if(!d)return;
  const me=_evMe(),best=_evBest(d),compiled=new Set(d.disponibilita.map(x=>x.risorsa_id)).size;
  const head=`<div class="and-crumb"><a href="#" onclick="evBack();return false"><i class="fa-solid fa-arrow-left"></i> Tutti gli eventi</a><span>/</span><b>${_esc(d.nome)}</b></div>`;
  const info=`<div class="card ev-hero">
      <div class="ev-hero-ic"><i class="fa-solid fa-champagne-glasses"></i></div>
      <div class="ev-hero-body">
        <h2>${_esc(d.nome)}</h2>
        ${d.luogo?`<div class="ev-meta"><i class="fa-solid fa-location-dot"></i> ${_esc(d.luogo)}</div>`:''}
        <div class="ev-meta">${_evWhen(d)}</div>
        <div class="ev-meta"><i class="fa-solid fa-user-pen"></i> Organizzato da ${_esc(d.creatore||'—')}</div>
        ${d.descrizione?`<p class="ev-desc">${_esc(d.descrizione)}</p>`:''}
      </div>
      ${d.owner?`<div class="ev-hero-act"><button class="btn btn-ghost2 btn-sm" onclick="evOpenForm(${+d.id})"><i class="fa-solid fa-pen"></i> Modifica</button><button class="btn btn-danger btn-sm" onclick="evDelete()"><i class="fa-solid fa-trash"></i> Elimina</button></div>`:''}
    </div>`;
  const cal=d.periodo_da?_evCalendar(d,best,me):'';
  // colonna destra: data (suggerita o fissata), partecipazione, risposte
  let dateCard='';
  if(d.data){
    dateCard=`<div class="card ev-side ev-date ev-date-fixed"><div class="ev-side-t"><i class="fa-regular fa-calendar-check"></i> Data dell'evento</div><div class="ev-date-big">${_esc(_evLong(d.data))}</div>
      ${d.owner?`<div class="ev-date-edit"><input type="date" id="evDateIn" value="${_esc(d.data)}"/><button class="btn btn-ghost2 btn-sm" onclick="evSetDate(document.getElementById('evDateIn').value)">Cambia</button></div>${d.periodo_da?`<button class="btn btn-ghost2 btn-sm ev-w100" onclick="evSetDate(null)"><i class="fa-solid fa-rotate-left"></i> Riapri le disponibilità</button>`:''}`:''}</div>`;
  }else if(d.periodo_da){
    dateCard=`<div class="card ev-side ev-date"><div class="ev-side-t"><i class="fa-regular fa-calendar"></i> Data suggerita</div>
      ${best?`<div class="ev-date-big">${_esc(_evLong(best.day))}</div><div class="ev-date-sub"><i class="fa-solid fa-users"></i> ${best.si} ${best.si===1?'persona disponibile':'persone disponibili'}${best.fo?` · ${best.fo} forse`:''}</div>`:'<p class="ev-note">Ancora nessuna disponibilità indicata.</p>'}
      <div class="ev-date-sub">${compiled} di ${d.invitati.length} invitati hanno indicato la disponibilità</div>
      ${d.owner&&best?`<button class="btn btn-amber ev-w100" onclick="evSetDate('${best.day}')"><i class="fa-solid fa-thumbtack"></i> Imposta come data dell'evento</button>`:''}
      ${d.owner?'<p class="ev-hint">Puoi anche scegliere un altro giorno cliccando sulla sua intestazione nel calendario.</p>':''}</div>`;
  }
  const mine=me&&d.invitati.find(i=>i.risorsa_id===me.id);
  const part=mine?`<div class="card ev-side"><div class="ev-side-t"><i class="fa-solid fa-hand"></i> La tua partecipazione</div>
      <div class="ev-rsvp"><button class="ev-rsvp-b si${mine.risposta==='si'?' on':''}" onclick="evRsvp('si')" aria-pressed="${mine.risposta==='si'}"><i class="fa-solid fa-check"></i> Ci sono</button><button class="ev-rsvp-b no${mine.risposta==='no'?' on':''}" onclick="evRsvp('no')" aria-pressed="${mine.risposta==='no'}"><i class="fa-solid fa-xmark"></i> Non ci sono</button></div>
      <label for="evComm">Commento (facoltativo)</label><textarea id="evComm" rows="2" maxlength="500" placeholder="Es. arrivo nel pomeriggio, porto il dolce…">${_esc(mine.commento||'')}</textarea>
      <button class="btn btn-ghost2 btn-sm" onclick="evRsvp(null)"><i class="fa-solid fa-floppy-disk"></i> Salva commento</button><div id="evRsvpMsg" class="msg"></div></div>`:'';
  const si=d.invitati.filter(i=>i.risposta==='si').length,no=d.invitati.filter(i=>i.risposta==='no').length;
  const order={si:0,no:1};
  const resp=`<div class="card ev-side"><div class="ev-side-t"><i class="fa-solid fa-comments"></i> Risposte</div>
      <div class="ev-counts"><span class="ok"><b>${si}</b> ci sono</span><span class="ko"><b>${no}</b> non ci sono</span><span><b>${d.invitati.length-si-no}</b> in attesa</span></div>
      <div class="ev-resp">${d.invitati.slice().sort((a,b)=>(order[a.risposta]??2)-(order[b.risposta]??2)||a.full_name.localeCompare(b.full_name,'it')).map(i=>`<div class="ev-resp-r">${_evAvatar(i.full_name)}<div class="ev-resp-b"><div class="ev-resp-n"><b>${_esc(i.full_name)}</b>${i.risposta==='si'?'<span class="badge badge-ok">Ci sono</span>':i.risposta==='no'?'<span class="badge badge-danger">Non ci sono</span>':'<span class="badge" style="background:var(--stone-2);color:var(--ink-2)">In attesa</span>'}</div>${i.commento?`<div class="ev-resp-c">${_esc(i.commento)}</div>`:''}</div></div>`).join('')}</div></div>`;
  el.innerHTML=`${head}<div class="ev-layout"><div class="ev-main">${info}${cal}</div><div class="ev-aside">${dateCard}${part}${resp}</div></div>`;
}
function _evCalendar(d,best,me){
  const days=_evDays(d.periodo_da,d.periodo_a),open=!d.data;
  const st={};d.disponibilita.forEach(x=>{st[x.risorsa_id+'|'+x.data]=x.stato;});
  const rows=d.invitati.slice().sort((a,b)=>(me&&b.risorsa_id===me.id)-(me&&a.risorsa_id===me.id)||a.full_name.localeCompare(b.full_name,'it'));
  const wk=i=>_evCap(_evDate(i).toLocaleDateString('it-IT',{weekday:'short'}).replace('.',''));
  const colCls=day=>[[0,6].includes(_evDate(day).getDay())?'ev-we':'',d.data===day?'ev-fixed':'',open&&best&&best.day===day?'ev-best':''].join(' ');
  const th=days.map(day=>{
    const lbl=`<span>${wk(day)}</span><b>${_evDate(day).getDate()} ${_evDate(day).toLocaleDateString('it-IT',{month:'short'}).replace('.','')}</b>`;
    return `<th class="${colCls(day)}">${d.owner&&open?`<button class="ev-day-h" onclick="evSetDate('${day}')" title="Fissa l'evento il ${_esc(_evLong(day))}">${lbl}</button>`:lbl}</th>`;
  }).join('');
  const body=rows.map(i=>{
    const mine=me&&i.risorsa_id===me.id;
    return `<tr${mine?' class="ev-me"':''}><td class="ev-name"><div class="ev-nm">${_evAvatar(i.full_name)}<span>${_esc(i.full_name)}${mine?' <small>(tu)</small>':''}</span></div></td>${days.map(day=>{
      const s=st[i.risorsa_id+'|'+day]||'',m=EV_ST[s];
      const inner=m?`<i class="fa-solid ${m.ic}"></i>`:'<i class="fa-solid fa-minus"></i>';
      const tip=`${_esc(i.full_name)} — ${_esc(_evLong(day))}: ${m?m.l:'non indicato'}`;
      return `<td class="${colCls(day)}">${mine&&open?`<button class="ev-cell ${m?m.cls:'none'}" onclick="evToggle('${day}',this)" data-s="${s}" title="${tip}" aria-label="${tip}">${inner}</button>`:`<span class="ev-cell ${m?m.cls:'none'}" title="${tip}">${inner}</span>`}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const tot=days.map(day=>{const r=d.disponibilita.filter(x=>x.data===day),si=r.filter(x=>x.stato==='si').length,fo=r.filter(x=>x.stato==='forse').length;return `<td class="${colCls(day)}"><b>${si}</b>${fo?`<small>+${fo}</small>`:''}</td>`;}).join('');
  const hint=!open?'La data è stata fissata: il calendario è chiuso.':me&&d.invitati.some(i=>i.risorsa_id===me.id)?'Clicca sulle tue caselle: disponibile → forse → non disponibile → non indicato.':'Le disponibilità le indicano gli invitati.';
  return `<div class="card"><div class="and-head"><div class="card-title"><i class="fa-regular fa-calendar-days"></i> Disponibilità</div>
      <div class="legend ev-legend">${Object.values(EV_ST).map(m=>`<span><span class="ev-cell sm ${m.cls}"><i class="fa-solid ${m.ic}"></i></span>${m.l}</span>`).join('')}<span><span class="ev-cell sm none"><i class="fa-solid fa-minus"></i></span>Non indicato</span></div></div>
    <p class="ev-note">${hint}</p>
    <div class="ev-cal-wrap"><table class="ev-cal"><thead><tr><th class="ev-name">Partecipante</th>${th}</tr></thead><tbody>${body}</tbody>
      <tfoot><tr><td class="ev-name"><b>Totale disponibili</b></td>${tot}</tr></tfoot></table></div></div>`;
}
async function evToggle(day,btn){
  const d=_ev.data,me=_evMe();if(!d||!me)return;
  const next=EV_NEXT[btn.dataset.s||''];
  btn.disabled=true;
  try{await call('setDisponibilita',{eventoId:d.id,data:day,stato:next||null});}
  catch(e){btn.disabled=false;alert('Errore: '+e.message);return;}
  d.disponibilita=d.disponibilita.filter(x=>!(x.risorsa_id===me.id&&x.data===day));
  if(next)d.disponibilita.push({risorsa_id:me.id,data:day,stato:next});
  const y=window.scrollY,x=document.querySelector('.ev-cal-wrap')?.scrollLeft||0;
  _evRenderDetail();
  window.scrollTo(0,y);const w=document.querySelector('.ev-cal-wrap');if(w)w.scrollLeft=x;
}
async function evRsvp(risposta){
  const d=_ev.data,me=_evMe();if(!d||!me)return;
  const mine=d.invitati.find(i=>i.risorsa_id===me.id);if(!mine)return;
  const r=risposta===null?mine.risposta:risposta,commento=(document.getElementById('evComm')?.value||'').trim();
  showSpinner();
  try{await call('setPartecipazione',{eventoId:d.id,risposta:r,commento});}catch(e){hideSpinner();showMsg('evRsvpMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  mine.risposta=r;mine.commento=commento||null;
  _evRenderDetail();showMsg('evRsvpMsg',risposta===null?'Commento salvato.':'Risposta salvata.','ok');
}
function evSetDate(day){
  const d=_ev.data;if(!d)return;
  const go=async()=>{showSpinner();try{await call('setEventoData',{id:d.id,data:day});}catch(e){hideSpinner();alert('Errore: '+e.message);return;}hideSpinner();await _evLoadDetail(d.id);};
  if(day&&d.data===day)return;
  openModal(day?'Fissa la data':'Riapri le disponibilità',day?`Fissare "${d.nome}" per ${_evLong(day)}? Gli invitati vedranno la data e il calendario delle disponibilità verrà chiuso.`:'La data verrà tolta e gli invitati potranno di nuovo indicare la disponibilità.',go,day?'Fissa la data':'Riapri');
}
function evDelete(){
  const d=_ev.data;if(!d)return;
  openModal('Elimina evento',`Eliminare "${d.nome}"? Verranno cancellate anche disponibilità e risposte degli invitati.`,async()=>{showSpinner();try{await call('deleteEvento',{id:d.id});}catch(e){hideSpinner();alert('Errore: '+e.message);return;}hideSpinner();evBack();},'Elimina');
}

// ── creazione e modifica ──
function evOpenForm(id){
  const d=id&&_ev.data&&_ev.data.id===id?_ev.data:null;
  const me=_evMe();
  _ev.view='form';_ev.form={id:d?d.id:null,inv:new Set(d?d.invitati.map(i=>i.risorsa_id):(me?[me.id]:[])),owner:d?d.creatore_id:(me?me.id:null),src:d};
  _evRenderForm();window.scrollTo(0,0);
}
function _evRenderForm(){
  const el=document.getElementById('eventiContent'),f=_ev.form;if(!f){evBack();return;}
  const d=f.src||{},prjs=(_cache.prj||[]).slice().sort((a,b)=>a.localeCompare(b,'it'));
  el.innerHTML=`<div class="and-crumb"><a href="#" onclick="${f.id?`evOpen(${+f.id})`:'evBack()'};return false"><i class="fa-solid fa-arrow-left"></i> ${f.id?'Torna all\'evento':'Tutti gli eventi'}</a></div>
  <div class="card"><div class="card-title"><i class="fa-solid fa-${f.id?'pen':'calendar-plus'}"></i> ${f.id?'Modifica evento':'Nuovo evento'}</div>
    <div class="field-row"><div class="field" style="flex:2;min-width:220px"><label for="evNome">Nome dell'evento *</label><input type="text" id="evNome" maxlength="150" placeholder="Es. Team Building 2026" value="${_esc(d.nome||'')}"/></div>
      <div class="field" style="min-width:200px"><label for="evLuogo">Luogo</label><input type="text" id="evLuogo" maxlength="200" placeholder="Es. Villa delle Colline, Firenze" value="${_esc(d.luogo||'')}"/></div></div>
    <div class="field" style="margin-bottom:12px"><label for="evDesc">Cosa faremo</label><textarea id="evDesc" rows="3" maxlength="4000" placeholder="Descrivi l'evento: programma, attività, cosa portare…">${_esc(d.descrizione||'')}</textarea></div>
    <div class="ev-when">
      <div class="ev-when-b"><div class="ev-when-t"><i class="fa-regular fa-calendar-check"></i> Data già decisa</div><div class="field"><label for="evData">Data dell'evento</label><input type="date" id="evData" value="${_esc(d.data||'')}"/></div></div>
      <div class="ev-when-or">oppure</div>
      <div class="ev-when-b"><div class="ev-when-t"><i class="fa-regular fa-calendar-days"></i> Da decidere insieme</div><div class="field-row" style="margin:0"><div class="field"><label for="evDa">Disponibilità dal</label><input type="date" id="evDa" value="${_esc(d.periodo_da||'')}"/></div><div class="field"><label for="evA">al</label><input type="date" id="evA" value="${_esc(d.periodo_a||'')}"/></div></div><p class="ev-hint">Gli invitati segneranno i giorni in cui sono disponibili; poi sceglierai tu la data (massimo 92 giorni).</p></div>
    </div>
    <div class="ev-inv-hd"><label>Invitati *</label><span id="evInvCount" class="badge badge-amber"></span></div>
    <div class="search-row"><input type="text" id="evInvSearch" placeholder="Cerca una persona…" oninput="_evRenderInv()"/>
      <select id="evInvPrj" onchange="evAddProject(this.value);this.value=''"><option value="">+ Aggiungi un progetto intero</option>${prjs.map(p=>`<option value="${_esc(p)}">${_esc(p)}</option>`).join('')}</select>
      <button class="btn btn-ghost2 btn-sm" onclick="evInvAll(true)">Tutti</button><button class="btn btn-ghost2 btn-sm" onclick="evInvAll(false)">Nessuno</button></div>
    <div class="ev-inv" id="evInvList"></div>
    <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:16px"><button class="btn btn-amber" onclick="evSave()"><i class="fa-solid fa-paper-plane"></i> ${f.id?'Salva modifiche':'Crea e invita'}</button><button class="btn btn-ghost2" onclick="${f.id?`evOpen(${+f.id})`:'evBack()'}">Annulla</button><div id="evFormMsg" class="msg"></div></div>
  </div>`;
  _evRenderInv();
}
function _evRenderInv(){
  const f=_ev.form,el=document.getElementById('evInvList');if(!f||!el)return;
  const q=(document.getElementById('evInvSearch')?.value||'').trim().toLowerCase();
  const list=RESOURCES.slice().sort((a,b)=>a.fullName.localeCompare(b.fullName,'it')).filter(r=>!q||r.fullName.toLowerCase().includes(q)||(r.progetti||[]).some(p=>p.toLowerCase().includes(q)));
  el.innerHTML=list.length?list.map(r=>{const fixed=r.id===f.owner;return `<label class="ev-inv-i${f.inv.has(r.id)?' on':''}${fixed?' fixed':''}"><input type="checkbox" ${f.inv.has(r.id)?'checked':''} ${fixed?'disabled':''} onchange="evInvToggle(${+r.id},this.checked)"/>${_evAvatar(r.fullName)}<span><b>${_esc(r.fullName)}</b><small>${fixed?'Organizzatore':_esc((r.progetti||[]).join(' · ')||'—')}</small></span></label>`;}).join('')
    :'<p class="ev-note">Nessuna persona trovata.</p>';
  const c=document.getElementById('evInvCount');if(c)c.textContent=f.inv.size+(f.inv.size===1?' invitato':' invitati');
}
function evInvToggle(id,on){const f=_ev.form;if(!f)return;on?f.inv.add(id):f.inv.delete(id);_evRenderInv();}
function evInvAll(on){const f=_ev.form;if(!f)return;if(on)RESOURCES.forEach(r=>f.inv.add(r.id));else{f.inv.clear();if(f.owner)f.inv.add(f.owner);}_evRenderInv();}
function evAddProject(p){const f=_ev.form;if(!f||!p)return;RESOURCES.filter(r=>(r.progetti||[]).includes(p)).forEach(r=>f.inv.add(r.id));_evRenderInv();}
async function evSave(){
  const f=_ev.form;if(!f)return;
  const v=id=>(document.getElementById(id)?.value||'').trim();
  const p={nome:v('evNome'),luogo:v('evLuogo'),descrizione:v('evDesc'),data:v('evData')||null,periodoDa:v('evDa')||null,periodoA:v('evA')||null,invitati:[...f.inv]};
  if(!p.nome){showMsg('evFormMsg','Inserisci il nome dell\'evento.','err');return;}
  if(!p.data&&(!p.periodoDa||!p.periodoA)){showMsg('evFormMsg','Indica la data dell\'evento oppure il periodo in cui raccogliere le disponibilità.','err');return;}
  if((p.periodoDa&&!p.periodoA)||(!p.periodoDa&&p.periodoA)){showMsg('evFormMsg','Per il periodo servono sia la data di inizio sia quella di fine.','err');return;}
  if(!p.invitati.length){showMsg('evFormMsg','Aggiungi almeno un invitato.','err');return;}
  if(f.id)p.id=f.id;
  showSpinner();let r;
  try{r=await call('saveEvento',p);}catch(e){hideSpinner();showMsg('evFormMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  _ev.form=null;evOpen(r.id);
}
