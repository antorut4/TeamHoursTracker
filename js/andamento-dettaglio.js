// Andamento progetto: classificazione ticket, grafici, inserimento ticket ed Extra Effort
// Classificazione dei ticket del mese: per livello, categorie ordinate per numero, con dettaglio attività
function _andClsHtml(pid,aid,r,scopeName){
  const D=_andData,rows=(D.d.cls||[]).filter(x=>+x.progetto_id===pid&&(!aid||+x.area_id===aid));
  const title=`<div class="card-title"><i class="fa-solid fa-sitemap"></i> Classificazione ticket${scopeName?` <span style="color:var(--ink-3);font-weight:600">— ${_esc(scopeName)}</span>`:''} <span style="color:var(--ink-3);font-weight:600">· ${D.lbl}</span></div>`;
  if(!rows.length)return `<div class="card">${title}<p style="font-size:.8rem;color:var(--ink-3)"><i class="fa-solid fa-circle-info" style="margin-right:5px"></i>Nessun ticket classificato in ${D.lbl}.${_andReadOnly(pid)?'':' La classificazione per attività si indica nell\'inserimento manuale, sotto i numeri L1, L2, L3.'}</p></div>`;
  const cols=TK_LV.map(s=>{
    const lv=s.l,mine=rows.filter(x=>x.livello===lv),tot=mine.reduce((a,x)=>a+x.n,0);
    // le righe arrivano per area: si sommano per categoria e attività
    const cats={};mine.forEach(x=>{const c=cats[x.categoria]||(cats[x.categoria]={n:0,acts:{}});c.n+=x.n;c.acts[x.attivita]=(c.acts[x.attivita]||0)+x.n;});
    const list=Object.entries(cats).sort((a,b)=>b[1].n-a[1].n||a[0].localeCompare(b[0],'it')),mx=list.length?list[0][1].n:1;
    const cov=r[s.k]?`${_fmtNum(tot)} di ${_fmtNum(r[s.k])} classificati (${_fmtPct(Math.min(100,tot/r[s.k]*100))})`:`${_fmtNum(tot)} classificati`;
    return `<div class="and-cls-col"><div class="and-cls-hd">${_mkSvg(s,11)}<b>${lv}</b><span>${cov}</span></div>${list.length?list.map(([c,v])=>`<details class="and-cls-cat"><summary><span class="and-cls-nm">${_esc(c)}</span><span class="and-cls-bar" aria-hidden="true"><i style="width:${Math.max(4,v.n/mx*100)}%;background:${s.c}"></i></span><b>${_fmtNum(v.n)}</b></summary><ul>${Object.entries(v.acts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'it')).map(([a,n])=>`<li><span>${_esc(a)}</span><b>${_fmtNum(n)}</b></li>`).join('')}</ul></details>`).join(''):'<p class="and-cls-none">Nessun ticket classificato</p>'}</div>`;
  }).join('');
  return `<div class="card">${title}<div class="and-cls">${cols}</div></div>`;
}
// Elenco attività del mese richiudibile; lo stato aperto/chiuso resta cambiando mese, area o progetto
const _andActsOpen={};
function _andActsBlock(k,title,html){
  return `<details class="and-acts"${_andActsOpen[k]===false?'':' open'} ontoggle="_andActsOpen['${k}']=this.open"><summary>${title}</summary>${html}</details>`;
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
  ctx.fillStyle='#1F2937';ctx.fillText(label,P.l+7,y-3);
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
  for(let i=0;i<=div;i++){const v=mx*i/div,y=Y(v);ctx.strokeStyle=i===0?'rgba(0,0,0,.18)':'rgba(0,0,0,.06)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(P.l,Math.round(y)+.5);ctx.lineTo(P.l+pw,Math.round(y)+.5);ctx.stroke();ctx.fillStyle='#454C5E';ctx.fillText(_fmtNum(v),P.l-8,y);}
  // asse X (salta etichette se lo spazio è poco)
  const every=step&&step<44?2:1;ctx.textAlign='center';ctx.textBaseline='alphabetic';
  c.labels.forEach((lb,i)=>{if(i%every&&i!==n-1)return;ctx.fillStyle=i===n-1?'#111827':'#454C5E';ctx.font=(i===n-1?'600 ':'')+'11px DM Sans,sans-serif';ctx.fillText(lb,X(i),H-8);});
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
  ctx.font='600 11px DM Sans,sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle='#1F2937';
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
  const isOre=c.mode!=='n',u=c.unit||'h',vals=isOre?c.ore:c.cnt,thr=isOre?c.thr:null,fv=v=>isOre?_fmtU(v,u):_fmtNum(v);
  const P={t:20,r:16,b:30,l:48},pw=W-P.l-P.r,ph=H-P.t-P.b,n=vals.length,band=pw/n,bw=Math.max(6,Math.min(36,band*.62));
  const mx=_niceMax(Math.max(1,...vals,thr||0));
  c.geo={l:P.l,band};
  const Y=v=>P.t+ph*(1-v/mx),BX=i=>P.l+band*i+(band-bw)/2;
  ctx.font='11px DM Sans,sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';
  const div=mx%4===0?4:5;
  for(let i=0;i<=div;i++){const v=mx*i/div,y=Y(v);ctx.strokeStyle=i===0?'rgba(0,0,0,.18)':'rgba(0,0,0,.06)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(P.l,Math.round(y)+.5);ctx.lineTo(P.l+pw,Math.round(y)+.5);ctx.stroke();ctx.fillStyle='#454C5E';ctx.fillText(_fmtNum(_r2(v))+(isOre?' '+u:''),P.l-8,y);}
  const every=band<44?2:1;ctx.textAlign='center';ctx.textBaseline='alphabetic';
  c.labels.forEach((lb,i)=>{if(i%every&&i!==n-1)return;ctx.fillStyle=i===n-1?'#111827':'#454C5E';ctx.font=(i===n-1?'600 ':'')+'11px DM Sans,sans-serif';ctx.fillText(lb,BX(i)+bw/2,H-8);});
  if(c.hover!=null){ctx.fillStyle='rgba(0,0,0,.04)';ctx.fillRect(P.l+band*c.hover,P.t,band,ph);}
  // barre sottili ancorate alla base, angoli superiori arrotondati
  vals.forEach((v,i)=>{if(!v)return;const y=Y(v);_barPath(ctx,BX(i),y,bw,P.t+ph-y,4);ctx.fillStyle=c.hover===i?EE_C_HOVER:EE_C;ctx.fill();});
  if(thr)_drawThrLine(ctx,P,pw,Y(thr),'Soglia '+_fmtU(thr,u));
  // etichetta diretta solo sul mese selezionato (ultima barra)
  const last=vals[n-1];
  ctx.font='600 11px DM Sans,sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle='#1F2937';
  ctx.fillText(last?fv(last):(isOre?'0 '+u:'0'),BX(n-1)+bw/2,(last?Y(last):P.t+ph)-4);
}
function _showEeTip(c,i){
  const t=document.getElementById(c.id+'-tip'),cv=document.getElementById(c.id);if(!t||!cv)return;
  const u=c.unit||'h';
  t.innerHTML=`<div class="and-tip-t">${c.full[i]}</div>`+(c.cnt[i]
    ?`<div class="and-tip-r"><span>Attività</span><span>${_fmtNum(c.cnt[i])}</span></div><div class="and-tip-r"><span>${c.vLabel||'Ore Extra Effort'}</span><span>${_fmtU(c.ore[i],u)}</span></div>`
    :'<div style="color:var(--ink-3)">Nessuna attività registrata</div>')
    +(c.thr?`<div class="and-tip-r" style="color:var(--ink-3)"><span>Soglia</span><span>${_fmtU(c.thr,u)}</span></div>`:'');
  t.style.display='block';
  const x=c.geo.l+c.geo.band*(i+.5),w=t.offsetWidth;
  t.style.left=Math.max(0,Math.min(cv.clientWidth-w,x+14>cv.clientWidth-w?x-w-14:x+14))+'px';t.style.top='10px';
}
let _andResizeT=null;
window.addEventListener('resize',()=>{clearTimeout(_andResizeT);_andResizeT=setTimeout(()=>{if(document.getElementById('panel-andamento')?.classList.contains('active'))_andCharts.forEach(c=>c.draw(c));},150);});
// ── Extra Effort: tabella compilabile (una riga per attività), usata nell'inserimento dall'app ──
// Tipologia: 'extra' = attività extra in ore (grafico Extra Effort), 'cr' = CR in Man Day (grafico CR - da scalare a Plafond)
const _EE_UNIT={extra:{ph:'ore',lbl:'Extra Effort (ore)'},cr:{ph:'MD',lbl:'CR (MD, Man Day)'}};
function _eeRowHtml(r){
  const t=r&&r.tipo==='cr'?'cr':'extra',v=r?(t==='cr'?r.md:r.ore):'';
  return `<div class="ee-row"><input type="text" class="ee-att" maxlength="300" placeholder="Tipologia attività / dettaglio" value="${_esc(r?r.attivita:'')}" oninput="_eeRecalc(this)" aria-label="Tipologia attività / dettaglio"/><select class="ee-tipo" onchange="_eeTipo(this)" aria-label="Tipologia"><option value="extra"${t==='extra'?' selected':''}>Attività extra (ore)</option><option value="cr"${t==='cr'?' selected':''}>CR (MD)</option></select><input type="number" class="ee-ore" min="0" step="0.25" inputmode="decimal" placeholder="${_EE_UNIT[t].ph}" value="${v??''}" oninput="_eeRecalc(this)" aria-label="${_EE_UNIT[t].lbl}"/><button type="button" class="btn-icon danger" title="Rimuovi riga" onclick="_eeDel(this)"><i class="fa-solid fa-xmark" style="font-size:.75rem"></i></button></div>`;
}
function _eeTipo(sel){
  const i=sel.closest('.ee-row').querySelector('.ee-ore'),u=_EE_UNIT[sel.value];
  i.placeholder=u.ph;i.setAttribute('aria-label',u.lbl);_eeRecalc(sel);
}
function _eeTotHtml(h,md){return `Totale Extra Effort: <b>${_fmtOre(h)}</b> · CR: <b>${_fmtMd(md)}</b>`;}
function _eeBlockHtml(rows){
  const h=rows.filter(r=>r.tipo!=='cr').reduce((s,r)=>s+r.ore,0),md=rows.filter(r=>r.tipo==='cr').reduce((s,r)=>s+r.md,0);
  return `<div class="ee"><div class="ee-row ee-head"><span>Extra Effort / CR — tipologia attività / dettaglio</span><span>Tipologia</span><span style="text-align:right">Ore / MD</span><span></span></div>
    <div class="ee-rows">${(rows.length?rows:[null]).map(_eeRowHtml).join('')}</div>
    <div class="ee-foot"><button type="button" class="btn btn-ghost2 btn-sm" onclick="_eeAdd(this)"><i class="fa-solid fa-plus"></i> Aggiungi attività</button><span class="ee-tot">${_eeTotHtml(h,md)}</span></div></div>`;
}
function _eeAdd(btn){const l=btn.closest('.ee').querySelector('.ee-rows');l.insertAdjacentHTML('beforeend',_eeRowHtml(null));l.lastElementChild.querySelector('.ee-att').focus();}
function _eeDel(btn){
  const box=btn.closest('.ee'),row=btn.closest('.ee-row');
  if(box.querySelectorAll('.ee-rows .ee-row').length>1)row.remove();
  else{row.querySelectorAll('input').forEach(i=>{i.value='';i.classList.remove('bad');});const s=row.querySelector('.ee-tipo');s.value='extra';_eeTipo(s);}
  _eeRecalc(box);
}
function _eeRecalc(el){
  const box=el.closest('.ee'),tot={extra:0,cr:0};
  box.querySelectorAll('.ee-rows .ee-row').forEach(row=>{const i=row.querySelector('.ee-ore'),n=Number(i.value),ok=i.value===''||(Number.isFinite(n)&&n>0);i.classList.toggle('bad',!ok);if(ok&&i.value!=='')tot[row.querySelector('.ee-tipo').value]+=n;});
  box.querySelector('.ee-tot').innerHTML=_eeTotHtml(tot.extra,tot.cr);
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
    const tipo=row.querySelector('.ee-tipo').value;
    rows.push(tipo==='cr'?{tipo,attivita:a,md:_r2(n)}:{tipo,attivita:a,ore:_r2(n)});
  });
  return{rows,bad};
}
// ── inserimento ticket ed Extra Effort dal dettaglio progetto (TL dell'area o del progetto) ──
async function loadTicketDay(){
  const me=_me(),inp=document.getElementById('andTicketDate'),form=document.getElementById('andTicketForm');
  if(!me||!inp||!inp.value||!form)return;
  showSpinner();let d;
  try{d=await call('getTicketDay',{risorsaId:me.id,data:inp.value,progettoId:_andEntryPid});}
  catch(e){hideSpinner();form.innerHTML=`<div class="msg err">Errore: ${_esc(e.message)}</div>`;return;}
  hideSpinner();
  const ent=d.entries[inp.value]||{},ee=(d.ee||{})[inp.value]||{},cls=(d.cls||{})[inp.value]||{};
  if(!d.aree.length){form.innerHTML='<p style="color:var(--ink-3);font-size:.83rem">Nessuna area attiva su cui puoi inserire dati.</p>';return;}
  form.innerHTML=`<div class="tk-row tk-header" style="padding-top:0"><div class="tk-head" style="text-align:left">Area</div>${TK_LV.map(s=>`<div class="tk-head">${s.l}</div>`).join('')}<div class="tk-head">Totale</div></div>`+d.aree.map(a=>{const v=ent[a.id];return `<div class="tk-area" data-area="${a.id}"><div class="tk-row"><div><div style="font-weight:600">${_esc(a.nome)} ${v?'<span class="badge badge-ok" style="font-size:.65rem">inserito</span>':''}</div></div>${TK_LV.map(s=>`<input type="number" min="0" step="1" inputmode="numeric" placeholder="0" data-k="${s.k}" value="${v?v[s.k]:''}" oninput="_tkRecalc(this)" aria-label="${s.l} ${_esc(a.nome)}"/>`).join('')}<div class="tk-tot">${v?v.totale:0}</div></div>${d.tree?TicketCls.html(d.tree,cls[a.id]):''}${_eeBlockHtml(ee[a.id]||[])}</div>`;}).join('');
  TicketCls.mount(form);
}
function _tkRecalc(inp){
  const row=inp.closest('.tk-row');let tot=0;
  row.querySelectorAll('input').forEach(i=>{const n=Number(i.value),ok=i.value===''||(Number.isInteger(n)&&n>=0);i.classList.toggle('bad',!ok);if(ok&&i.value!=='')tot+=n;});
  row.querySelector('.tk-tot').textContent=tot;
  TicketCls.mount(inp.closest('.tk-area'));
}
async function saveTicketDay(){
  const me=_me(),data=document.getElementById('andTicketDate')?.value;
  if(!me||!data){showMsg('andTicketMsg','Seleziona una data.','err');return;}
  const entries=[];let bad=false,badEe=false,badCls=false;
  document.querySelectorAll('#andTicketForm .tk-area[data-area]').forEach(box=>{
    const e={areaId:+box.dataset.area};
    box.querySelectorAll('.tk-row input').forEach(i=>{const raw=i.value.trim(),n=raw===''?0:Number(raw);if(!Number.isInteger(n)||n<0){bad=true;i.classList.add('bad');}e[i.dataset.k]=n;});
    const x=_eeCollect(box.querySelector('.ee'));if(x.bad)badEe=true;e.ee=x.rows;
    const c=TicketCls.collect(box.querySelector('.tc'));if(c.bad)badCls=true;if(c.rows)e.cls=c.rows;
    entries.push(e);
  });
  if(bad){showMsg('andTicketMsg','Inserisci solo numeri interi non negativi.','err');return;}
  if(badCls){showMsg('andTicketMsg','Classificazione: per un livello hai classificato più ticket di quelli dichiarati.','err');return;}
  if(badEe){showMsg('andTicketMsg','Extra Effort: per ogni riga indica la tipologia attività e un valore maggiore di zero (ore per le attività extra, MD per le CR).','err');return;}
  if(!entries.length)return;
  showSpinner();let res;
  try{res=await call('saveTickets',{risorsaId:me.id,data,entries,progettoId:_andEntryPid});}
  catch(e){hideSpinner();showMsg('andTicketMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  const hit=(res.soglie||[]).filter(s=>s.status==='alert_sent'),kinds=[...new Set(hit.map(s=>_THR_KIND[s.kind]?.l||'ticket'))];
  await loadTicketDay();await renderAndamento();
  showMsg('andTicketMsg',`Ticket ed Extra Effort del ${fmt(data)} salvati.`+(hit.length?` Soglia mensile ${kinds.join(' e ')} raggiunta: alert email inviato.`:''),'ok');
}
