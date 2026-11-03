// Admin: log delle email inviate
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
