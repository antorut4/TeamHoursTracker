// Reperibilità: griglia per progetto, export Excel, overview manager
// REPERIBILITA
async function getRepStore(){return(_read(K_REP,[])||[]).map(rp=>{const r=RESOURCES.find(x=>x.id===rp.risorsaId);return r?{id:rp.id,fullName:r.fullName,progetto:rp.progetto,etichetta:rp.etichetta||'',teamLead:rp.teamLead||'',anno:rp.anno,mese:rp.mese,giorni:Array.isArray(rp.giorni)?rp.giorni:[]}:null;}).filter(Boolean);}
async function repForUser(fullName){const all=await getRepStore();return all.filter(r=>r.fullName===fullName);}
let _repGridData={};let _repExtraResources=[];let _repExtraProject='';let _repHiddenResources=new Set();
function calcRepEarningsFromDays(days,anno,mese){const hol=getHol(anno);return days.reduce((tot,d)=>{const dt=new Date(anno,mese,d),wd=dt.getDay(),ds=localDate(dt);return tot+(wd===0||wd===6||hol.has(ds)?40:25);},0);}
function calcRepEarnings(resourceName,year,month,etichetta){const gd=_repGridData[etichetta]?.[resourceName];if(!gd)return 0;return calcRepEarningsFromDays([...gd.selectedDays],year,month);}
async function initRepPanel(){
  const now=new Date();
  const myTLPrjs=isAdmin?[]:Object.entries(_prjTLsByName).filter(([,tls])=>tls.includes(currentUser)).map(([p])=>p).sort();
  // Una risorsa può essere TL su un progetto e risorsa standard su un altro: assegna la reperibilità
  // sui progetti di cui è TL e vede sempre quella che le è stata assegnata (anche su altri progetti)
  document.getElementById('repUserView').style.display=isAdmin?'none':'block';
  if(!isAdmin){const mOpts=MONTHS.map((m,i)=>({v:i,l:m})),yOpts=[-1,0,1].map(d=>{const y=now.getFullYear()+d;return{v:y,l:y};});popSel('repUserMonth',mOpts,now.getMonth());popSel('repUserYear',yOpts,now.getFullYear());await renderRepMine();}
  if(myTLPrjs.length||isAdmin){
    document.getElementById('repLeadView').style.display='block';
    const mOpts=MONTHS.map((m,i)=>({v:i,l:m})),yOpts=[-1,0,1].map(d=>{const y=now.getFullYear()+d;return{v:y,l:y};});
    popSel('repMonth',mOpts,now.getMonth());popSel('repYear',yOpts,now.getFullYear());
    const team=isAdmin?RESOURCES:RESOURCES.filter(r=>(r.progetti||[]).some(p=>(_prjTLsByName[p]||[]).includes(currentUser)));
    const rFilt=document.getElementById('repFilterRisorsa');rFilt.innerHTML='<option value="">Tutte le risorse</option>';team.forEach(r=>{const o=document.createElement('option');o.value=r.fullName;o.textContent=r.fullName;rFilt.appendChild(o);});
    const yFilt=document.getElementById('repFilterAnno');yFilt.innerHTML='<option value="">Tutti gli anni</option>';yOpts.forEach(({v,l})=>{const o=document.createElement('option');o.value=v;o.textContent=l;yFilt.appendChild(o);});
    const mFilt=document.getElementById('repFilterMese');mFilt.innerHTML='<option value="">Tutti i mesi</option>';mOpts.forEach(({v,l})=>{const o=document.createElement('option');o.value=v;o.textContent=l;mFilt.appendChild(o);});
    mFilt.value=now.getMonth();
    yFilt.value=now.getFullYear();
    const myPrjs=isAdmin?await getProjects():myTLPrjs;
    const repPrjSel=document.getElementById('repProgetto');repPrjSel.innerHTML='<option value="">— Seleziona —</option>';myPrjs.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;repPrjSel.appendChild(o);});
    await buildRepGriglia();await renderRepTeam();
  }else document.getElementById('repLeadView').style.display='none';
}
async function ferieGiorniSet(fullName,year,month){const r=RESOURCES.find(x=>x.fullName===fullName);const mine=r?(_read(K_FER,[])||[]).filter(f=>f.risorsaId===r.id):[];const set=new Set();mine.forEach(e=>{let cur=new Date(e.start+'T12:00:00'),en=new Date(e.end+'T12:00:00');while(cur<=en){if(cur.getFullYear()===year&&cur.getMonth()===month)set.add(cur.getDate());cur.setDate(cur.getDate()+1);}});return set;}
// ── Export Excel reperibilità: valori fissi per progetto + download del mese selezionato ──
const REP_WORKFORCE=['Consulting','Services','Outsourcing','Solutions'];
const REP_XLS_COLS=['Employee number','Workforce','Cognome','Nome','Importo bonus','Mese di riferimento','WBS JOB/progetto','SPOC','Job/Unit/Progetto','Note','Sistema'];
// ExcelJS (font, colori e formati di cella) caricato solo al primo export
let _excelJsP=null;
function _loadExcelJs(){
  if(window.ExcelJS)return Promise.resolve(window.ExcelJS);
  return _excelJsP||(_excelJsP=new Promise((res,rej)=>{
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';s.integrity='sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==';s.crossOrigin='anonymous';s.referrerPolicy='no-referrer';
    s.onload=()=>window.ExcelJS?res(window.ExcelJS):rej(new Error('libreria Excel non disponibile'));
    s.onerror=()=>{_excelJsP=null;s.remove();rej(new Error('impossibile caricare la libreria Excel, controlla la connessione'));};
    document.head.appendChild(s);
  }));
}
function _repExpCfg(progetto){return _cache.repExport[String(_prjIdByName[progetto])]||{};}
function _repExpForm(){return{workforce:document.getElementById('repExpWorkforce')?.value||'',wbs:(document.getElementById('repExpWbs')?.value||'').trim(),spoc:(document.getElementById('repExpSpoc')?.value||'').trim(),jobUnit:(document.getElementById('repExpJob')?.value||'').trim()};}
function renderRepExport(){
  const card=document.getElementById('repExportCard'),body=document.getElementById('repExportBody');if(!card||!body)return;
  const progetto=document.getElementById('repProgetto').value,month=+document.getElementById('repMonth').value,year=+document.getElementById('repYear').value;
  if(!progetto){card.style.display='none';body.dataset.prj='';return;}
  card.style.display='';
  const lbl=`Scarica Excel — ${MONTHS[month]} ${year}`;
  // stesso progetto (cambio mese): aggiorna solo il pulsante, senza perdere eventuali modifiche ai campi
  if(body.dataset.prj===progetto){const b=document.getElementById('repExpDlLbl');if(b)b.textContent=lbl;return;}
  body.dataset.prj=progetto;
  const c=_repExpCfg(progetto);
  body.innerHTML=`<div class="and-sum-title">Valori fissi del progetto ${_esc(progetto)}</div>
    <div class="field-row" style="flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="max-width:170px"><label>Workforce</label><select id="repExpWorkforce"><option value="">— Seleziona —</option>${REP_WORKFORCE.map(w=>`<option${c.workforce===w?' selected':''}>${w}</option>`).join('')}</select></div>
      <div class="field" style="max-width:200px"><label>WBS JOB/progetto</label><input type="text" id="repExpWbs" maxlength="200" value="${_esc(c.wbs||'')}" placeholder="es. ABC123"/></div>
      <div class="field" style="max-width:200px"><label>SPOC</label><input type="text" id="repExpSpoc" maxlength="200" value="${_esc(c.spoc||'')}"/></div>
      <div class="field" style="max-width:220px"><label>Job/Unit/Progetto</label><input type="text" id="repExpJob" maxlength="200" value="${_esc(c.jobUnit||'')}"/></div>
      <div style="padding-bottom:2px"><button class="btn btn-ghost2 btn-sm" onclick="saveRepExportCfg()"><i class="fa-solid fa-floppy-disk"></i> Salva valori</button></div>
    </div>
    <div style="font-size:.72rem;color:var(--ink-3);margin:-4px 0 10px">I valori lasciati vuoti compaiono nell'Excel come "-".</div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px">
      <button class="btn btn-ink" onclick="downloadRepExcel()"><i class="fa-solid fa-file-arrow-down"></i> <span id="repExpDlLbl">${lbl}</span></button>
      <div id="repExpMsg" class="msg"></div>
    </div>`;
}
async function saveRepExportCfg(){
  const progetto=document.getElementById('repProgetto').value;if(!progetto)return;
  const pid=_prjIdByName[progetto],f=_repExpForm();
  showSpinner();let saved;
  try{saved=await call('saveRepExport',{id:pid,...f});}
  catch(e){hideSpinner();showMsg('repExpMsg','Errore: '+e.message,'err');return;}
  hideSpinner();_cache.repExport[String(pid)]=saved;
  showMsg('repExpMsg','Valori fissi salvati per '+progetto+'.','ok');
}
async function downloadRepExcel(){
  const progetto=document.getElementById('repProgetto').value,month=+document.getElementById('repMonth').value,year=+document.getElementById('repYear').value;
  if(!progetto){showMsg('repExpMsg','Seleziona il progetto.','err');return;}
  // l'Excel riporta i dati salvati: niente export con modifiche ancora in sospeso
  const pendingGrid=Object.values(_repGridData).some(g=>Object.values(g).some(gd=>gd.selectedDays.size!==gd.savedDays.size||[...gd.selectedDays].some(d=>!gd.savedDays.has(d))));
  if(pendingGrid){showMsg('repExpMsg','Ci sono modifiche non salvate nella griglia: clicca "Salva" prima di scaricare.','err');return;}
  const c=_repExpCfg(progetto),f=_repExpForm();
  if(['workforce','wbs','spoc','jobUnit'].some(k=>(c[k]||'')!==f[k])){showMsg('repExpMsg','Hai modificato i valori fissi: clicca "Salva valori" prima di scaricare.','err');return;}
  showSpinner();let rep,ExcelJS;
  try{[rep,ExcelJS]=await Promise.all([call('getRepForProject',{progetto,anno:year,mese:month}),_loadExcelJs()]);}
  catch(e){hideSpinner();showMsg('repExpMsg','Errore: '+e.message,'err');return;}
  const meseLbl=`${MONTHS[month]} ${year}`,pad=n=>String(n).padStart(2,'0'),v=s=>s||'-';
  const rows=[],noEmp=new Set();
  rep.forEach(e=>{
    const r=RESOURCES.find(x=>x.id===e.risorsaId);if(!r)return;
    if(!r.employeeId)noEmp.add(r.fullName);
    e.giorni.forEach(d=>rows.push({r,d,sistema:e.etichetta||''}));
  });
  if(!rows.length){hideSpinner();showMsg('repExpMsg',`Nessuna reperibilità salvata per ${progetto} in ${meseLbl}.`,'err');return;}
  // ordine per giorno (colonna Note), poi per risorsa e sistema
  rows.sort((a,b)=>a.d-b.d||a.r.cognome.localeCompare(b.r.cognome,'it')||a.r.nome.localeCompare(b.r.nome,'it')||a.sistema.localeCompare(b.sistema,'it'));
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet(MONTHS[month]);
  const W=[16,13,18,16,14,13,18,18,22,10,18],FONT={name:'Comic Sans MS',size:9};
  ws.columns=REP_XLS_COLS.map((h,i)=>({header:h,width:W[i]}));
  // Note = data di Excel in UTC (nessuno slittamento di fuso) mostrata come "1-Nov": [$-409] = mesi in inglese
  rows.forEach(({r,d,sistema})=>ws.addRow([v(r.employeeId),v(c.workforce),v(r.cognome),v(r.nome),calcRepEarningsFromDays([d],year,month),MONTHS[month],v(c.wbs),v(c.spoc),v(c.jobUnit),new Date(Date.UTC(year,month,d)),v(sistema)]));
  ws.eachRow((row,n)=>row.eachCell({includeEmpty:true},cell=>{
    cell.font=n===1?{...FONT,bold:true}:FONT;
    if(n===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFC0C0C0'}};
    else if(cell.col===5)cell.numFmt='#,##0.00 "€"';
    else if(cell.col===10)cell.numFmt='[$-409]d-mmm';
  }));
  let buf;
  try{buf=await wb.xlsx.writeBuffer();}catch(e){hideSpinner();showMsg('repExpMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  a.download=`Reperibilita_${progetto.replace(/[^\w-]+/g,'_')}_${year}-${pad(month+1)}.xlsx`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),10000);
  const miss=[!c.workforce&&'Workforce',!c.wbs&&'WBS JOB/progetto',!c.spoc&&'SPOC',!c.jobUnit&&'Job/Unit/Progetto'].filter(Boolean);
  const warn=[miss.length?`valori fissi vuoti: ${miss.join(', ')}`:'',noEmp.size?`Employee number mancante per ${[...noEmp].join(', ')}`:''].filter(Boolean);
  const txt=`Excel scaricato: ${rows.length} righe (${meseLbl}).`;
  if(!warn.length){showMsg('repExpMsg',txt,'ok');return;}
  // avviso più lungo da leggere: resta visibile più a lungo del messaggio standard
  const m=document.getElementById('repExpMsg');m.textContent=`${txt} Attenzione — ${warn.join('; ')}.`;m.className='msg warn';
  clearTimeout(m._t);m._t=setTimeout(()=>{m.className='msg';},15000);
}
async function buildRepGriglia(){
  renderRepExport();
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
    if(tipi.length>1||etichetta){h+=`<div style="font-weight:700;font-size:.82rem;color:var(--ink);margin:12px 0 6px;border-bottom:2px solid var(--ink);padding-bottom:4px">${_esc(etichetta||'Reperibilità')}</div>`;}
    h+=`<div style="overflow-x:auto;margin-bottom:16px"><table style="border-collapse:collapse;font-size:.72rem;width:100%"><thead><tr>`;
    h+=`<th style="padding:5px 10px;background:var(--ink);color:var(--white);text-align:left;white-space:nowrap;min-width:90px;position:sticky;left:0;z-index:1">Risorsa</th>`;
    for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6;
      h+=`<th style="padding:2px 1px;background:${ih?'var(--amber-bg)':iw?'rgba(161,0,255,.12)':'var(--ink)'};color:${ih?'var(--amber)':iw?'var(--amber)':'var(--white)'};text-align:center;min-width:24px;font-weight:${ih||iw?600:500};font-size:.6rem"><div>${DN[wd]}</div><div>${d}</div></th>`;}
    h+=`<th style="padding:5px 4px;background:var(--ink);color:var(--white);text-align:center;min-width:32px;font-size:.65rem">Gg</th>`;
    h+=`<th style="padding:5px 8px;background:var(--ink);color:var(--white);text-align:right;min-width:70px;white-space:nowrap;font-size:.65rem">Guadagno</th></tr></thead><tbody>`;
    resources.forEach((r,ri)=>{
      const gd=_repGridData[etichetta][r.fullName];
      h+=`<tr style="background:${ri%2?'var(--stone)':'var(--white)'}">`;
      h+=`<td style="padding:5px 8px 5px 10px;font-weight:600;font-size:.74rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit"><div style="display:flex;align-items:center;gap:6px"><div style="line-height:1.35">${_esc(r.fullName.split(' ')[0])}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${_esc(r.fullName.split(' ').slice(1).join(' '))}</span></div><button onclick="removeRepResource(${_jsa(r.fullName)},event)" title="Rimuovi dalla griglia" style="flex-shrink:0;background:none;border:1px solid transparent;cursor:pointer;color:var(--ink-3);font-size:.7rem;line-height:1;padding:2px 4px;border-radius:3px" onmouseover="this.style.color='var(--danger)';this.style.borderColor='var(--danger)'" onmouseout="this.style.color='var(--ink-3)';this.style.borderColor='transparent'">✕</button></div></td>`;
      for(let d=1;d<=dim;d++){const dt=new Date(year,month,d),wd=dt.getDay(),ds=localDate(dt),ih=hol.has(ds),iw=wd===0||wd===6,isFerie=gd.ferieSet.has(d),isSel=gd.selectedDays.has(d);
        if(isFerie){h+=`<td style="background:var(--danger-bg);border:1px solid rgba(201,0,60,.2);padding:3px 1px;text-align:center" title="${isSel?'In ferie · Reperibilità assegnata':'In ferie – clicca per assegnare comunque'}"><div class="rep-day ferie-ov${isSel?' on':''}" id="rd_${r.id}_${d}_${_esc(etiKey)}" onclick="toggleRepDayGrid(${_jsa(r.fullName)},${d},${_jsa(etichetta)})"><span class="rep-ferie-badge">F</span></div></td>`;}
        else{h+=`<td style="border:1px solid var(--line);padding:3px 1px;text-align:center;background:${ih?'var(--amber-bg)':iw?'rgba(161,0,255,.05)':'var(--stone)'}"><div class="rep-day${ih?' festivo':iw?' weekend':''}${isSel?' on':''}" id="rd_${r.id}_${d}_${_esc(etiKey)}" onclick="toggleRepDayGrid(${_jsa(r.fullName)},${d},${_jsa(etichetta)})"></div></td>`;}
      }
      const earn=calcRepEarnings(r.fullName,year,month,etichetta);
      h+=`<td id="repgg_${r.id}_${_esc(etiKey)}" class="rep-earn-gg">${gd.selectedDays.size}</td>`;
      h+=`<td id="repeur_${r.id}_${_esc(etiKey)}" class="rep-earn" style="padding:5px 8px;text-align:right;border-left:1px solid var(--stone-3)">€${earn}</td></tr>`;
    });
    let initGg=0,initEur=0;
    for(const[,gd]of Object.entries(_repGridData[etichetta])){initGg+=gd.selectedDays.size;initEur+=calcRepEarningsFromDays([...gd.selectedDays],year,month);}
    h+=`</tbody><tfoot><tr style="background:var(--stone-2);border-top:2px solid var(--stone-3)">`;
    h+=`<td style="position:sticky;left:0;background:var(--stone-2);padding:5px 10px;font-weight:700;font-size:.74rem;color:var(--ink)">Totale</td>`;
    h+=`<td colspan="${dim}" style="background:var(--stone-2)"></td>`;
    h+=`<td id="reptot_gg_${_esc(etiKey)}" style="text-align:center;font-weight:700;font-size:.72rem;padding:5px 4px">${initGg}</td>`;
    h+=`<td id="reptot_eur_${_esc(etiKey)}" style="text-align:right;font-weight:700;font-size:.72rem;color:var(--ok);padding:5px 8px;border-left:1px solid var(--stone-3)">€${initEur}</td>`;
    h+=`</tr></tfoot></table></div>`;
  }
  // ── riepilogo per risorsa (somma di tutti i turni) ──
  h+=`<div style="margin-top:14px"><div style="font-size:.74rem;font-weight:700;color:var(--ink-2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Totale per risorsa</div><div style="display:flex;flex-wrap:wrap;gap:8px">`;
  resources.forEach(r=>{
    let resGg=0,resEur=0;
    for(const eti of tipi){const gd=_repGridData[eti]?.[r.fullName];if(gd){resGg+=gd.selectedDays.size;resEur+=calcRepEarningsFromDays([...gd.selectedDays],year,month);}}
    h+=`<div style="background:var(--stone-1);border:1px solid var(--stone-3);border-radius:var(--r);padding:7px 12px;min-width:150px">`;
    h+=`<div style="font-size:.74rem;font-weight:600;color:var(--ink);margin-bottom:2px">${_esc(r.fullName)}</div>`;
    h+=`<div style="font-size:.72rem;color:var(--ink-3)"><span id="reptot_res_gg_${r.id}" style="font-weight:700;color:var(--ink)">${resGg}</span> gg&nbsp;·&nbsp;<span id="reptot_res_eur_${r.id}" style="font-weight:700;color:var(--ok)">€${resEur}</span></div>`;
    h+=`</div>`;
  });
  h+=`</div></div>`;
  let grandGg=0,grandEur=0;
  for(const[,gb]of Object.entries(_repGridData)){for(const[,gd]of Object.entries(gb)){grandGg+=gd.selectedDays.size;grandEur+=calcRepEarningsFromDays([...gd.selectedDays],year,month);}}
  h+=`<div style="margin-top:10px;padding:10px 16px;background:var(--ink);color:var(--white);border-radius:var(--r);display:flex;align-items:center;gap:12px;font-size:.83rem;flex-wrap:wrap"><i class="fa-solid fa-sigma" style="color:var(--amber)"></i><span style="opacity:.75">Totale assegnato:</span><span id="repGrandTotalGg" style="font-weight:700">${grandGg}</span><span style="opacity:.5">giorni ·</span><span id="repGrandTotalEur" style="color:var(--amber);font-weight:700">€${grandEur}</span></div>`;
  const _inGrid=new Set(resources.map(r=>r.fullName));
  const _avail=RESOURCES.filter(r=>!_inGrid.has(r.fullName));
  if(_avail.length){h+=`<div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><select id="repAddExtraSelect" style="font-size:.8rem;padding:5px 8px;border:1px solid var(--line-s);border-radius:var(--r);background:var(--white);color:var(--ink);min-width:180px"><option value="">— Aggiungi risorsa —</option>${_avail.map(r=>`<option value="${_esc(r.fullName)}">${_esc(r.fullName)}${_repHiddenResources.has(r.fullName)?' (nascosta)':''}</option>`).join('')}</select><button class="btn btn-ghost2 btn-sm" onclick="addExtraRepResource()"><i class="fa-solid fa-user-plus"></i> Aggiungi</button></div>`;}
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
    html+=`<div style="font-weight:700;font-size:.82rem;color:var(--ink);margin:0 0 6px;border-bottom:2px solid var(--ink);padding-bottom:4px"><i class="fa-solid fa-folder" style="margin-right:5px;opacity:.6"></i>${_esc(progetto)}${tls.length?`<span style="font-size:.7rem;font-weight:400;color:var(--ink-3);margin-left:8px">TL: ${_esc(tls.join(', '))}</span>`:''}</div>`;
    for(const [meseKey,entries] of Object.entries(byMese).sort(([a],[b])=>{const[ay,am]=a.split('|').map(Number),[by,bm]=b.split('|').map(Number);return ay!==by?ay-by:am-bm;})){
      const anno=+meseKey.split('|')[0],mese=+meseKey.split('|')[1];
      const dim=new Date(anno,mese+1,0).getDate(),holSet=getHol(anno);
      const resOnPrj=RESOURCES.filter(r=>entries.some(e=>e.fullName===r.fullName)).sort((a,b)=>a.fullName.localeCompare(b.fullName));
      const tipiPrj=getRepTipiForPrj(progetto);
      const etichette=tipiPrj[0]!==''?tipiPrj.filter(t=>entries.some(e=>(e.etichetta||'')===t)):[...new Set(entries.map(e=>e.etichetta||''))].sort();
      html+=`<div style="margin-bottom:14px"><div style="font-size:.78rem;font-weight:600;color:var(--ink-2);margin:10px 0 6px">${MONTHS[mese]} ${anno}</div>`;
      for(const eti of etichette){
        const etiEntries=entries.filter(e=>(e.etichetta||'')===eti);
        if(etichette.length>1||eti){html+=`<div style="font-size:.74rem;font-weight:700;color:var(--ink-2);margin:10px 0 4px;padding-left:2px">${_esc(eti||'Reperibilità')}</div>`;}
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
          html+=`<td style="padding:5px 10px;font-weight:600;font-size:.74rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit">${_esc(r.fullName.split(' ')[0])}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${_esc(r.fullName.split(' ').slice(1).join(' '))}</span></td>`;
          for(let d=1;d<=dim;d++){const dt=new Date(anno,mese,d),wd=dt.getDay(),ds=localDate(dt),ih=holSet.has(ds),iw=wd===0||wd===6,on=days.has(d),isConflict=ferieSet.has(d)&&on;
            html+=`<td style="border:1px solid var(--line);padding:2px 1px;text-align:center;background:${on?(isConflict?'rgba(201,0,60,.12)':'rgba(0,123,255,.12)'):ih?'var(--amber-bg)':iw?'rgba(161,0,255,.05)':'var(--stone)'}">`;
            html+=`<div style="width:14px;height:14px;margin:auto;border-radius:50%;background:${on?(isConflict?'var(--danger)':'var(--info)'):'transparent'};display:flex;align-items:center;justify-content:center;font-size:.55rem;color:white" title="${on?(isConflict?'Reperibilità + ferie!':'assegnato'):''}">`;
            html+=on?(isConflict?'!':'✓'):'';
            html+=`</div></td>`;}
          const earn=entry?calcRepEarningsFromDays(entry.giorni,anno,mese):null;
          html+=`<td style="padding:5px 4px;text-align:center;font-weight:600;font-size:.72rem;color:var(--info)">${entry?days.size:'—'}</td>`;
          html+=`<td style="padding:5px 8px;text-align:right;font-weight:700;font-size:.72rem;border-left:1px solid var(--stone-3);color:${earn!==null&&earn>0?'var(--ok)':'var(--ink-3)'}">${earn!==null?`€${earn}`:'—'}</td>`;
          if(canDelPrj)html+=`<td style="padding:2px 4px;text-align:center">${entry?`<button class="btn-icon danger" onclick="deleteRep(${entry.id},${_jsa(r.fullName)},${_jsa(progetto)})"><i class="fa-solid fa-trash-can" style="font-size:.75rem"></i></button>`:''}</td>`;
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
    html+=`<div style="font-weight:700;font-size:.82rem;color:var(--ink);margin:0 0 6px;border-bottom:2px solid var(--ink);padding-bottom:4px"><i class="fa-solid fa-folder" style="margin-right:5px;opacity:.6"></i>${_esc(progetto)}${tls.length?`<span style="font-size:.7rem;font-weight:400;color:var(--ink-3);margin-left:8px">TL: ${_esc(tls.join(', '))}</span>`:''}</div>`;
    for(const eti of etichette){
      const etiEntries=projEntries.filter(e=>(e.etichetta||'')===eti);
      if(etichette.length>1||eti){html+=`<div style="font-size:.74rem;font-weight:700;color:var(--ink-2);margin:10px 0 4px;padding-left:2px">${_esc(eti||'Reperibilità')}</div>`;}
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
        html+=`<td style="padding:5px 10px;font-weight:${isMe?700:600};font-size:.74rem;color:${isMe?'var(--info)':'var(--ink)'};border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit">${_esc(r.fullName.split(' ')[0])}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${_esc(r.fullName.split(' ').slice(1).join(' '))}</span>${isMe?` <span style="font-size:.58rem;background:var(--info);color:white;border-radius:3px;padding:1px 4px;vertical-align:middle">tu</span>`:''}</td>`;
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
    html+=`<div class="card-title"><i class="fa-solid fa-folder"></i> ${_esc(progetto)} <span style="font-size:.72rem;color:var(--ink-3);font-weight:400;margin-left:6px">TL: ${_esc(tlLabel)}</span></div>`;
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
      html+=`<td style="padding:5px 10px;font-weight:600;font-size:.74rem;color:var(--ink);border-right:2px solid var(--stone-3);white-space:nowrap;position:sticky;left:0;background:inherit">${_esc(r.fullName.split(' ')[0])}<br><span style="font-weight:400;color:var(--ink-3);font-size:.63rem">${_esc(r.fullName.split(' ').slice(1).join(' '))}</span></td>`;
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
