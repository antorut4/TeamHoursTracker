// CONFRONTO & FEEDBACK: ognuno vede le richieste di confronto ricevute e quelle inviate.
// Chi riceve gestisce la propria copia (pianifica, risponde, completa, rifiuta); chi chiede vede lo stato per persona.
let _cf={box:'ricevute',st:'da_pianificare',tema:'',sel:null,data:null,form:null,act:null};
const CF_TEMI={crescita:{l:'Crescita professionale',ic:'arrow-trend-up'},feedback:{l:'Feedback sul lavoro',ic:'comment-dots'},
  organizzazione:{l:'Organizzazione e carichi di lavoro',ic:'gear'},progetti:{l:'Nuovi progetti',ic:'lightbulb'},
  team:{l:'Feedback sul team',ic:'people-group'},benessere:{l:'Benessere',ic:'heart'},altro:{l:'Altro',ic:'comments'}};
const CF_PRI={alta:{l:'Alta priorità',cls:'badge-danger',ic:'circle-exclamation'},media:{l:'Media priorità',cls:'badge-warn',ic:'circle-exclamation'},bassa:{l:'Bassa priorità',cls:'badge-info',ic:'circle-info'}};
const CF_ST={da_pianificare:{l:'Da pianificare',cls:'badge-warn'},pianificato:{l:'Pianificato',cls:'badge-info'},completato:{l:'Completato',cls:'badge-ok'},rifiutato:{l:'Rifiutato',cls:'badge-danger'}};
const CF_TABS=[{k:'da_pianificare',l:'Da pianificare'},{k:'pianificato',l:'Pianificati'},{k:'chiusi',l:'Completati'}];
const _cfTema=t=>CF_TEMI[t]||CF_TEMI.altro;
const _cfDay=iso=>iso?_evDate(String(iso).slice(0,10)).toLocaleDateString('it-IT',{day:'numeric',month:'short',year:'numeric'}):'';
function _cfSub(name){
  const r=RESOURCES.find(x=>x.fullName===name);if(!r)return '';
  return r.isSenior?'Senior Manager':r.isManager?'Manager':((r.progetti||[]).join(' · ')||'Collaboratore');
}
// Stato di una richiesta inviata: la più "avanzata" tra quelle dei destinatari ancora aperte
function _cfOutSt(c){const s=c.destinatari.map(d=>d.stato);return s.includes('pianificato')?'pianificato':s.includes('da_pianificare')?'da_pianificare':'chiusi';}
const _cfInSt=c=>['completato','rifiutato'].includes(c.stato)?'chiusi':c.stato;

async function renderConfronti(){
  const el=document.getElementById('confrontiContent');if(!el)return;
  if(_cf.form)return _cfRenderForm();
  showSpinner();
  try{_cf.data=await call('getConfronti',{});}catch(e){hideSpinner();el.innerHTML=`<div class="msg err">Errore: ${_esc(e.message)}</div>`;return;}
  hideSpinner();
  _cfNavBadge();_cfRender();
}
// Numero di richieste ricevute ancora da pianificare, accanto alla voce del menu
async function cfRefreshBadge(){if(isAdmin)return;try{_cf.data=await call('getConfronti',{});_cfNavBadge();}catch(e){console.error(e);}}
function _cfNavBadge(){
  const nav=document.getElementById('navConfronti');if(!nav||!_cf.data)return;
  const n=_cf.data.ricevute.filter(c=>c.stato==='da_pianificare').length;
  let b=nav.querySelector('.nav-badge');
  if(!n){if(b)b.remove();return;}
  if(!b){b=document.createElement('span');b.className='nav-badge';nav.appendChild(b);}
  b.textContent=n;b.title=n+(n===1?' richiesta da pianificare':' richieste da pianificare');
}
function cfBox(b){_cf.box=b;_cf.sel=null;_cf.act=null;_cfRender();}
function cfTab(t){_cf.st=t;_cf.sel=null;_cf.act=null;_cfRender();}
function cfTema(t){_cf.tema=t;_cf.sel=null;_cf.act=null;_cfRender();}
function cfSel(id){_cf.sel=id;_cf.act=null;_cfRender();if(window.innerWidth<1000)document.getElementById('cfDetail')?.scrollIntoView({behavior:'smooth',block:'start'});}

function _cfRender(){
  const el=document.getElementById('confrontiContent'),D=_cf.data;if(!el||!D)return;
  const inBox=_cf.box==='ricevute',all=inBox?D.ricevute:D.inviate,stOf=inBox?_cfInSt:_cfOutSt;
  const byTema=all.filter(c=>!_cf.tema||c.tema===_cf.tema);
  const list=byTema.filter(c=>stOf(c)===_cf.st);
  if(_cf.sel&&!list.some(c=>c.id===_cf.sel))_cf.sel=null;
  if(!_cf.sel&&list.length&&window.innerWidth>=1000)_cf.sel=list[0].id;
  const cnt=k=>byTema.filter(c=>stOf(c)===k).length;
  const pending=D.ricevute.filter(c=>c.stato==='da_pianificare').length;
  const boxes=`<div class="and-seg cf-box" role="tablist"><button class="${inBox?'on':''}" onclick="cfBox('ricevute')" role="tab" aria-selected="${inBox}"><i class="fa-solid fa-inbox"></i> Ricevute${pending?` <span class="cf-dot">${pending}</span>`:''}</button><button class="${!inBox?'on':''}" onclick="cfBox('inviate')" role="tab" aria-selected="${!inBox}"><i class="fa-solid fa-paper-plane"></i> Inviate</button></div>`;
  const tabs=`<div class="cf-bar"><div class="and-tabs cf-tabs">${CF_TABS.map(t=>`<button class="${_cf.st===t.k?'on':''}" onclick="cfTab('${t.k}')">${t.l} (${cnt(t.k)})</button>`).join('')}</div>
    <select class="cf-tema-sel" onchange="cfTema(this.value)" aria-label="Filtra per tema"><option value="">Tutti i temi</option>${Object.entries(CF_TEMI).map(([k,t])=>`<option value="${k}"${_cf.tema===k?' selected':''}>${t.l}</option>`).join('')}</select></div>`;
  const empty=inBox?(all.length?'Nessuna richiesta in questo stato.':'Nessuno ti ha ancora chiesto un confronto.')
    :(all.length?'Nessuna richiesta in questo stato.':'Non hai ancora chiesto un confronto: usa <b>Richiedi un confronto</b>.');
  const rows=list.length?list.map(c=>_cfRow(c,inBox)).join(''):`<div class="cf-empty"><i class="fa-regular fa-comments"></i><p>${empty}</p></div>`;
  const sel=list.find(c=>c.id===_cf.sel);
  el.innerHTML=`${boxes}<div class="cf-layout"><div class="card cf-list-card">${tabs}<div class="cf-list">${rows}</div></div>
    <div class="cf-detail-col" id="cfDetail">${sel?_cfDetail(sel,inBox):'<div class="card cf-detail cf-detail-empty"><i class="fa-regular fa-hand-pointer"></i><p>Seleziona una richiesta per vederne il dettaglio.</p></div>'}</div></div>`;
}
function _cfRow(c,inBox){
  const t=_cfTema(c.tema),p=CF_PRI[c.priorita]||CF_PRI.media;
  const who=inBox?c.richiedente:(c.destinatari.length===1?c.destinatari[0].full_name:c.destinatari[0].full_name+' +'+(c.destinatari.length-1));
  const sub=inBox?_cfSub(c.richiedente):(c.destinatari.length===1?_cfSub(c.destinatari[0].full_name):c.destinatari.length+' persone');
  const tags=(c.argomenti||[]).slice(0,2).map(a=>`<span class="cf-tag">${_esc(a)}</span>`).join('')+((c.argomenti||[]).length>2?`<span class="cf-tag more">+${c.argomenti.length-2}</span>`:'');
  const extra=inBox&&c.stato==='pianificato'&&c.data_incontro?`<div class="cf-when"><i class="fa-regular fa-calendar-check"></i> ${_esc(_evLong(c.data_incontro))}${c.ora_incontro?' · '+_esc(c.ora_incontro):''}</div>`
    :inBox&&_cfInSt(c)==='chiusi'?`<span class="badge ${CF_ST[c.stato].cls}">${CF_ST[c.stato].l}</span>`:'';
  return `<div class="cf-row${_cf.sel===c.id?' on':''}" role="button" tabindex="0" onclick="cfSel(${+c.id})" onkeydown="if(event.key==='Enter')cfSel(${+c.id})">
    <div class="cf-who">${_evAvatar(who)}<div><b>${_esc(who)}</b><small>${_esc(sub)}</small><span class="cf-date"><i class="fa-regular fa-calendar"></i> Richiesta il ${_esc(_cfDay(c.created_at))}</span></div></div>
    <div class="cf-body"><div class="cf-tema"><i class="fa-solid fa-${t.ic}"></i> ${t.l}</div>${tags?`<div class="cf-tags">${tags}</div>`:''}<div class="cf-quote">“${_esc(c.messaggio)}”</div>${extra}</div>
    <div class="cf-side"><span class="badge ${p.cls}"><i class="fa-solid fa-${p.ic}"></i> ${p.l}</span><i class="fa-solid fa-chevron-right cf-chev"></i></div>
  </div>`;
}
function _cfDetail(c,inBox){
  const t=_cfTema(c.tema),who=inBox?c.richiedente:null;
  const head=inBox?`<div class="cf-d-head">${_evAvatar(who).replace('ev-av','ev-av cf-av-lg')}<div><b>${_esc(who)}</b><small>${_esc(_cfSub(who))}</small></div><button class="btn-icon" onclick="cfSel(null)" aria-label="Chiudi"><i class="fa-solid fa-xmark"></i></button></div>`
    :`<div class="cf-d-head"><span class="cf-out-ic"><i class="fa-solid fa-paper-plane"></i></span><div><b>La tua richiesta</b><small>a ${c.destinatari.length} ${c.destinatari.length===1?'persona':'persone'} · ${_esc(_cfDay(c.created_at))}</small></div><button class="btn-icon" onclick="cfSel(null)" aria-label="Chiudi"><i class="fa-solid fa-xmark"></i></button></div>`;
  const pref=[c.periodo_da||c.periodo_a?`<div><i class="fa-regular fa-calendar"></i><span><small>Periodo preferito</small>${c.periodo_da?'Dal '+_esc(_cfDay(c.periodo_da)):''}${c.periodo_a?' al '+_esc(_cfDay(c.periodo_a)):''}</span></div>`:'',
    c.durata_min?`<div><i class="fa-regular fa-clock"></i><span><small>Durata indicativa</small>${+c.durata_min} minuti</span></div>`:''].join('');
  const sec=(ic,title,html)=>`<div class="cf-sec"><div class="cf-sec-t"><i class="fa-solid fa-${ic}"></i> ${title}</div>${html}</div>`;
  let body=`<div class="cf-d-tema"><i class="fa-solid fa-${t.ic}"></i> ${t.l} <span class="badge ${(CF_PRI[c.priorita]||CF_PRI.media).cls}">${(CF_PRI[c.priorita]||CF_PRI.media).l}</span></div>
    <blockquote class="cf-d-quote"><i class="fa-solid fa-quote-left"></i> ${_esc(c.messaggio)}</blockquote>
    ${(c.argomenti||[]).length?sec('list-ul','Temi da discutere',`<ul class="cf-ul">${c.argomenti.map(a=>`<li>${_esc(a)}</li>`).join('')}</ul>`):''}
    ${pref?sec('calendar-days','Preferenze',`<div class="cf-pref">${pref}</div>`):''}
    ${c.note?sec('note-sticky','Altre note',`<div class="cf-notebox">${_esc(c.note)}</div>`):''}`;
  if(inBox){
    const st=CF_ST[c.stato];
    body+=sec('flag','Stato',`<span class="badge ${st.cls}">${st.l}</span>${c.data_incontro?`<div class="cf-meet"><i class="fa-regular fa-calendar-check"></i> <b>${_esc(_evLong(c.data_incontro))}</b>${c.ora_incontro?' alle '+_esc(c.ora_incontro):''}${c.luogo?`<div><i class="fa-solid fa-location-dot"></i> ${_esc(c.luogo)}</div>`:''}</div>`:''}${c.n_destinatari>1?`<p class="ev-hint">Richiesta inviata anche ${c.n_destinatari===2?'a un\'altra persona':`ad altre ${c.n_destinatari-1} persone`}.</p>`:''}`);
    if(c.risposta)body+=sec('reply','La tua risposta',`<div class="cf-notebox">${_esc(c.risposta)}</div>`);
    body+=_cfActions(c);
  }else{
    body+=sec('users','Destinatari',`<div class="cf-dest">${c.destinatari.map(d=>`<div class="cf-dest-r">${_evAvatar(d.full_name)}<div class="cf-dest-b"><div class="cf-dest-n"><b>${_esc(d.full_name)}</b><span class="badge ${CF_ST[d.stato].cls}">${CF_ST[d.stato].l}</span></div>${d.data_incontro&&d.stato!=='da_pianificare'?`<div class="cf-dest-m"><i class="fa-regular fa-calendar-check"></i> ${_esc(_evLong(d.data_incontro))}${d.ora_incontro?' alle '+_esc(d.ora_incontro):''}${d.luogo?' · '+_esc(d.luogo):''}</div>`:''}${d.risposta?`<div class="cf-dest-c">“${_esc(d.risposta)}”</div>`:''}</div></div>`).join('')}</div>`);
    body+=`<div class="cf-actions"><button class="btn btn-danger ev-w100" onclick="cfWithdraw(${+c.id})"><i class="fa-solid fa-trash"></i> Ritira la richiesta</button></div>`;
  }
  return `<div class="card cf-detail">${head}${body}</div>`;
}
// Comandi del destinatario: form inline per pianificare o rispondere
function _cfActions(c){
  const a=_cf.act;
  if(a==='pianifica')return `<div class="cf-form-in"><div class="cf-sec-t"><i class="fa-regular fa-calendar-plus"></i> ${c.stato==='pianificato'?'Modifica incontro':'Pianifica incontro'}</div>
      <div class="field-row" style="margin-bottom:8px"><div class="field"><label for="cfData">Data *</label><input type="date" id="cfData" value="${_esc(c.data_incontro||'')}"/></div><div class="field" style="max-width:120px"><label for="cfOra">Ora</label><input type="time" id="cfOra" value="${_esc(c.ora_incontro||'')}"/></div></div>
      <div class="field" style="margin-bottom:8px"><label for="cfLuogo">Luogo o link</label><input type="text" id="cfLuogo" maxlength="300" placeholder="Es. Sala riunioni 2, Teams…" value="${_esc(c.luogo||'')}"/></div>
      <div class="field" style="margin-bottom:10px"><label for="cfRisp">Messaggio (facoltativo)</label><textarea id="cfRisp" rows="2" maxlength="2000" placeholder="Es. Volentieri, ci vediamo lì!">${_esc(c.risposta||'')}</textarea></div>
      <div class="cf-btns"><button class="btn btn-amber" onclick="cfDo(${+c.id},'pianifica')"><i class="fa-solid fa-check"></i> Conferma</button><button class="btn btn-ghost2" onclick="cfAct(null)">Annulla</button></div><div id="cfMsg" class="msg"></div></div>`;
  if(a==='rispondi')return `<div class="cf-form-in"><div class="cf-sec-t"><i class="fa-solid fa-reply"></i> Rispondi alla richiesta</div>
      <textarea id="cfRisp" rows="3" maxlength="2000" placeholder="Scrivi una risposta…">${_esc(c.risposta||'')}</textarea>
      <div class="cf-btns" style="margin-top:8px"><button class="btn btn-amber" onclick="cfDo(${+c.id},'rispondi')"><i class="fa-solid fa-paper-plane"></i> Invia risposta</button><button class="btn btn-ghost2" onclick="cfAct(null)">Annulla</button></div><div id="cfMsg" class="msg"></div></div>`;
  const b=[];
  if(c.stato==='da_pianificare')b.push(`<button class="btn btn-amber ev-w100" onclick="cfAct('pianifica')"><i class="fa-regular fa-calendar-plus"></i> Pianifica incontro</button>`);
  if(c.stato==='pianificato')b.push(`<button class="btn btn-amber ev-w100" onclick="cfDo(${+c.id},'completa')"><i class="fa-solid fa-circle-check"></i> Segna come completato</button>`,`<button class="btn btn-ghost2 ev-w100" onclick="cfAct('pianifica')"><i class="fa-regular fa-calendar"></i> Modifica incontro</button>`);
  if(['da_pianificare','pianificato'].includes(c.stato))b.push(`<button class="btn btn-ghost2 ev-w100" onclick="cfAct('rispondi')"><i class="fa-regular fa-comment-dots"></i> Rispondi alla richiesta</button>`,`<button class="cf-link" onclick="cfReject(${+c.id})"><i class="fa-solid fa-ban"></i> Rifiuta la richiesta</button>`);
  else b.push(`<button class="btn btn-ghost2 ev-w100" onclick="cfDo(${+c.id},'riapri')"><i class="fa-solid fa-rotate-left"></i> Riapri la richiesta</button>`,`<button class="btn btn-ghost2 ev-w100" onclick="cfAct('rispondi')"><i class="fa-regular fa-comment-dots"></i> ${c.risposta?'Modifica la risposta':'Rispondi'}</button>`);
  return `<div class="cf-actions">${b.join('')}<div id="cfMsg" class="msg"></div></div>`;
}
function cfAct(a){_cf.act=a;_cfRender();}
async function cfDo(id,azione,extra){
  const p={id,azione,...(extra||{})};
  if(azione==='pianifica'){p.data=document.getElementById('cfData')?.value||'';p.ora=document.getElementById('cfOra')?.value||null;p.luogo=document.getElementById('cfLuogo')?.value||null;
    if(!p.data){showMsg('cfMsg','Indica la data dell\'incontro.','err');return;}}
  // La risposta si invia solo dai form che la mostrano: completare o rifiutare non la cancella
  const rEl=document.getElementById('cfRisp');if(rEl&&['pianifica','rispondi'].includes(azione))p.risposta=rEl.value.trim();
  showSpinner();
  try{await call('updateConfronto',p);}catch(e){hideSpinner();showMsg('cfMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  // La richiesta cambia stato: si passa alla scheda in cui ora si trova, mantenendola selezionata
  _cf.act=null;
  const next={pianifica:'pianificato',completa:'chiusi',rifiuta:'chiusi',riapri:'da_pianificare'}[azione];
  if(next)_cf.st=next;
  _cf.sel=id;
  await renderConfronti();
}
function cfReject(id){
  openModal('Rifiuta la richiesta','La persona che ha chiesto il confronto vedrà la richiesta come rifiutata. Puoi aggiungere una risposta prima, con "Rispondi alla richiesta".',()=>cfDo(id,'rifiuta'),'Rifiuta');
}
function cfWithdraw(id){
  openModal('Ritira la richiesta','La richiesta verrà eliminata e sparirà anche per le persone a cui l\'hai inviata.',async()=>{showSpinner();try{await call('deleteConfronto',{id});}catch(e){hideSpinner();alert('Errore: '+e.message);return;}hideSpinner();_cf.sel=null;await renderConfronti();},'Ritira');
}

// ── nuova richiesta ──
function cfOpenForm(){
  if(isAdmin){alert('Le richieste di confronto si inviano con il proprio account, non con quello di amministratore.');return;}
  _cf.form={dest:new Set(),tema:'crescita',pri:'media',arg:[]};_cfRenderForm();window.scrollTo(0,0);
}
function cfCloseForm(){_cf.form=null;renderConfronti().catch(console.error);}
function _cfRenderForm(){
  const el=document.getElementById('confrontiContent'),f=_cf.form;if(!el||!f)return;
  el.innerHTML=`<div class="and-crumb"><a href="#" onclick="cfCloseForm();return false"><i class="fa-solid fa-arrow-left"></i> Torna alle richieste</a></div>
  <div class="card"><div class="card-title"><i class="fa-solid fa-comments"></i> Richiedi un confronto</div>
    <div class="ev-inv-hd"><label>Con chi vuoi confrontarti? *</label><span id="cfDestCount" class="badge badge-amber"></span></div>
    <div class="search-row"><input type="text" id="cfDestSearch" placeholder="Cerca una persona o un progetto…" oninput="_cfRenderDest()"/></div>
    <div class="ev-inv cf-dest-pick" id="cfDestList"></div>
    <label style="margin-top:16px">Tema *</label>
    <div class="cf-temi" role="radiogroup" aria-label="Tema del confronto">${Object.entries(CF_TEMI).map(([k,t])=>`<button type="button" role="radio" class="cf-tema-b${f.tema===k?' on':''}" data-k="${k}" aria-checked="${f.tema===k}" onclick="cfPickTema('${k}')"><i class="fa-solid fa-${t.ic}"></i><span>${t.l}</span></button>`).join('')}</div>
    <div class="field" style="margin:14px 0 12px"><label for="cfMotivo">Motivo del confronto *</label><textarea id="cfMotivo" rows="3" maxlength="2000" placeholder="Es. Vorrei confrontarmi sulle possibili opportunità di crescita all'interno del team…"></textarea></div>
    <label for="cfArgIn">Temi da discutere</label>
    <div class="cf-arg-in"><input type="text" id="cfArgIn" maxlength="200" placeholder="Es. Competenze da sviluppare — premi Invio per aggiungere" onkeydown="if(event.key==='Enter'){event.preventDefault();cfAddArg();}"/><button class="btn btn-ghost2" onclick="cfAddArg()"><i class="fa-solid fa-plus"></i> Aggiungi</button></div>
    <div class="cf-arg-list" id="cfArgList"></div>
    <div class="field-row" style="margin-top:14px">
      <div class="field" style="flex:0 0 auto"><label>Priorità</label><div class="and-seg" id="cfPri">${['alta','media','bassa'].map(k=>`<button type="button" data-k="${k}" class="${f.pri===k?'on':''}" onclick="cfPickPri('${k}')">${k[0].toUpperCase()+k.slice(1)}</button>`).join('')}</div></div>
      <div class="field" style="max-width:170px"><label for="cfDa">Periodo preferito dal</label><input type="date" id="cfDa"/></div>
      <div class="field" style="max-width:170px"><label for="cfA">al</label><input type="date" id="cfA"/></div>
      <div class="field" style="max-width:160px"><label for="cfDur">Durata indicativa</label><select id="cfDur"><option value="">—</option>${[15,30,45,60,90].map(m=>`<option value="${m}"${m===30?' selected':''}>${m} minuti</option>`).join('')}</select></div>
    </div>
    <div class="field" style="margin-bottom:12px"><label for="cfNote">Altre note</label><textarea id="cfNote" rows="2" maxlength="1000" placeholder="Es. Sono disponibile anche in orario pranzo."></textarea></div>
    <div class="cf-btns"><button class="btn btn-amber" onclick="cfSend()"><i class="fa-solid fa-paper-plane"></i> Invia richiesta</button><button class="btn btn-ghost2" onclick="cfCloseForm()">Annulla</button><div id="cfFormMsg" class="msg"></div></div>
  </div>`;
  _cfRenderDest();_cfRenderArg();
}
function _cfRenderDest(){
  const f=_cf.form,el=document.getElementById('cfDestList');if(!f||!el)return;
  const me=_evMe(),q=(document.getElementById('cfDestSearch')?.value||'').trim().toLowerCase();
  const mine=me?new Set(me.progetti||[]):new Set();
  // In cima il proprio manager e i colleghi di progetto, poi tutti gli altri
  const rank=r=>(me&&r.id===me.managerId?0:(r.progetti||[]).some(p=>mine.has(p))?1:2);
  const list=RESOURCES.filter(r=>!me||r.id!==me.id).filter(r=>!q||r.fullName.toLowerCase().includes(q)||(r.progetti||[]).some(p=>p.toLowerCase().includes(q)))
    .sort((a,b)=>rank(a)-rank(b)||a.fullName.localeCompare(b.fullName,'it'));
  el.innerHTML=list.length?list.map(r=>`<label class="ev-inv-i${f.dest.has(r.id)?' on':''}"><input type="checkbox" ${f.dest.has(r.id)?'checked':''} onchange="cfDestToggle(${+r.id},this.checked)"/>${_evAvatar(r.fullName)}<span><b>${_esc(r.fullName)}</b><small>${me&&r.id===me.managerId?'Il tuo manager':_esc(_cfSub(r.fullName))}</small></span></label>`).join('')
    :'<p class="ev-note">Nessuna persona trovata.</p>';
  const c=document.getElementById('cfDestCount');if(c)c.textContent=f.dest.size?f.dest.size+(f.dest.size===1?' persona':' persone'):'nessuna';
}
function cfDestToggle(id,on){const f=_cf.form;if(!f)return;on?f.dest.add(id):f.dest.delete(id);_cfRenderDest();}
function cfPickTema(k){const f=_cf.form;if(!f)return;f.tema=k;document.querySelectorAll('.cf-tema-b').forEach(b=>{const on=b.dataset.k===k;b.classList.toggle('on',on);b.setAttribute('aria-checked',on);});}
function cfPickPri(k){const f=_cf.form;if(!f)return;f.pri=k;document.querySelectorAll('#cfPri button').forEach(b=>b.classList.toggle('on',b.dataset.k===k));}
function cfAddArg(){
  const f=_cf.form,i=document.getElementById('cfArgIn');if(!f||!i)return;
  const v=i.value.trim();if(!v)return;
  if(f.arg.length>=15){showMsg('cfFormMsg','Massimo 15 temi da discutere.','err');return;}
  if(!f.arg.includes(v))f.arg.push(v);i.value='';i.focus();_cfRenderArg();
}
function cfDelArg(i){const f=_cf.form;if(!f)return;f.arg.splice(i,1);_cfRenderArg();}
function _cfRenderArg(){
  const f=_cf.form,el=document.getElementById('cfArgList');if(!f||!el)return;
  el.innerHTML=f.arg.map((a,i)=>`<span class="cf-tag">${_esc(a)}<button onclick="cfDelArg(${i})" aria-label="Rimuovi ${_esc(a)}"><i class="fa-solid fa-xmark"></i></button></span>`).join('');
}
async function cfSend(){
  const f=_cf.form;if(!f)return;
  const pend=(document.getElementById('cfArgIn')?.value||'').trim();if(pend&&!f.arg.includes(pend))f.arg.push(pend);
  const v=id=>(document.getElementById(id)?.value||'').trim();
  const p={destinatari:[...f.dest],tema:f.tema,messaggio:v('cfMotivo'),argomenti:f.arg,priorita:f.pri,periodoDa:v('cfDa')||null,periodoA:v('cfA')||null,durata:v('cfDur')?+v('cfDur'):null,note:v('cfNote')};
  if(!p.destinatari.length){showMsg('cfFormMsg','Scegli almeno una persona.','err');return;}
  if(!p.messaggio){showMsg('cfFormMsg','Scrivi il motivo del confronto.','err');return;}
  if(p.periodoDa&&p.periodoA&&p.periodoA<p.periodoDa){showMsg('cfFormMsg','La fine del periodo è prima dell\'inizio.','err');return;}
  showSpinner();let r;
  try{r=await call('saveConfronto',p);}catch(e){hideSpinner();showMsg('cfFormMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  _cf={..._cf,form:null,box:'inviate',st:'da_pianificare',tema:'',sel:r.id,act:null};
  await renderConfronti();
}
