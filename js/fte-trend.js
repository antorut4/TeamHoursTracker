// Andamento FTE: un grafico a linee per progetto con gli FTE erogati degli ultimi 12 o 6 mesi
// e gli FTE progetto (FTE venduti TOT del Benchmark) come soglia. Stessi progetti e stesso calcolo di Andamento progetto.
const FTE_C='#6D28D9';
let _fteN=S.get('fteTrendN')===6?6:12,_fteCharts=[];
function fteSetPeriod(n){
  _fteN=n===6?6:12;S.set('fteTrendN',_fteN);
  renderFteTrend().catch(console.error);
}
// Asse Y a 4 tacche con passo "tondo" (1, 2, 2,5, 5 × 10^k): funziona anche sotto l'unità
function _fteAxis(v){
  if(!(v>0))return{max:1,step:.25};
  const raw=v/4,p=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/p,step=(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;
  return{max:step*4,step};
}
async function renderFteTrend(){
  const el=document.getElementById('fteTrendContent');if(!el)return;
  document.querySelectorAll('#fteFilters .and-seg button').forEach(b=>{const on=+b.dataset.n===_fteN;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
  const prjs=_andProjectIds();
  if(!prjs.length){el.innerHTML='<div class="card"><p style="font-size:.84rem;color:var(--ink-3)">Nessun progetto da mostrare.</p></div>';return;}
  const month=+document.getElementById('fteMonth').value,year=+document.getElementById('fteYear').value,n=_fteN;
  let d;showSpinner();
  try{d=await call('getAndamento',{scope:prjs.map(p=>({progettoId:p,areaIds:null})),anno:year,mese:month,mesi:n});}
  catch(e){hideSpinner();el.innerHTML=`<div class="msg err">Errore: ${_esc(e.message)}</div>`;return;}
  hideSpinner();
  const get=_andBuild(d);
  const periods=[];for(let i=n-1;i>=0;i--){let m=month-i,y=year;while(m<0){m+=12;y--;}periods.push({m,y});}
  const labels=periods.map(({m,y})=>MONTHS[m].slice(0,3)+' '+String(y).slice(2)),full=periods.map(({m,y})=>MONTHS[m]+' '+y);
  const items=prjs.map(pid=>{
    const f=periods.map(({m,y})=>_fteOf(pid,get(pid,null,y,m)));
    return{pid,name:_prjNameById[pid],vals:f.map(x=>_r2(x.erog)),thr:f[0].tot,over:f.filter(x=>x.over).length,last:f[n-1]};
  });
  // Prima i progetti con più mesi sopra soglia, in fondo quelli senza FTE progetto configurati
  items.sort((a,b)=>(a.thr==null)-(b.thr==null)||b.over-a.over||a.name.localeCompare(b.name,'it'));
  _fteCharts=items.map((it,i)=>({id:'fteCv'+i,labels,full,vals:it.vals,thr:it.thr,hover:null}));
  el.innerHTML=`<div class="fte-grid">${items.map((it,i)=>_fteCardHtml(it,_fteCharts[i],n,full[n-1])).join('')}</div>`;
  requestAnimationFrame(()=>_fteCharts.forEach(_initFteChart));
}
function _fteCardHtml(it,c,n,lastLbl){
  const st=it.thr==null?`<span class="badge" style="background:var(--stone-2);color:var(--ink-2)">FTE progetto non configurati</span>`
    :it.over?`<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation" style="margin-right:4px"></i>Sopra soglia in ${it.over} ${it.over===1?'mese':'mesi'} su ${n}</span>`
    :`<span class="badge badge-ok"><i class="fa-solid fa-check" style="margin-right:4px"></i>Sempre in linea</span>`;
  return `<div class="card fte-card">
    <div class="fte-card-hd">
      <div class="and-list-name"><i class="fa-solid fa-folder-open"></i> ${_esc(it.name)}${_fteBoxes(it.last,lastLbl)}</div>
      ${st}
    </div>
    <div class="and-chart-wrap"><canvas id="${c.id}" class="fte-cv" role="img" aria-label="FTE erogati di ${_esc(it.name)} negli ultimi ${n} mesi"></canvas><div class="and-tip" id="${c.id}-tip"></div></div>
    <div class="and-legend"><span><svg width="22" height="12" aria-hidden="true"><line x1="0" y1="6" x2="22" y2="6" stroke="${FTE_C}" stroke-width="2"/><circle cx="11" cy="6" r="3.5" fill="${FTE_C}" stroke="#fff" stroke-width="1.5"/></svg>FTE erogati</span>${it.thr!=null?`<span>${_thrSwatch()}FTE progetto ${_fmtFte(it.thr)}</span><span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="${THR_C}"/></svg>Mese sopra soglia</span>`:`<span style="color:var(--ink-3)">Configura gli FTE venduti TOT in <a href="#" onclick="showTab('benchmark');return false">Benchmark</a> per vedere la soglia</span>`}</div>
  </div>`;
}
function _initFteChart(c){
  const cv=document.getElementById(c.id);if(!cv)return;
  _drawFteChart(c);
  const tip=document.getElementById(c.id+'-tip');
  cv.onmousemove=e=>{const g=c.geo;if(!g)return;const x=e.clientX-cv.getBoundingClientRect().left;
    const i=Math.max(0,Math.min(c.vals.length-1,Math.round((x-g.l)/(g.step||1))));
    if(i!==c.hover){c.hover=i;_drawFteChart(c);}
    const v=c.vals[i],over=c.thr!=null&&v>=_r2(c.thr);
    tip.innerHTML=`<div class="and-tip-t">${c.full[i]}</div><div class="and-tip-r"><span>FTE erogati</span><span${over?' style="color:var(--danger)"':''}>${_fmtFte(v)}</span></div>`
      +(c.thr!=null?`<div class="and-tip-r" style="color:var(--ink-2)"><span>FTE progetto</span><span>${_fmtFte(c.thr)}</span></div><div class="and-tip-r" style="border-top:1px solid var(--line);margin-top:4px;padding-top:4px"><span>${over?'Sopra di':'Margine'}</span><span${over?' style="color:var(--danger)"':''}>${_fmtFte(Math.abs(v-c.thr))}</span></div>`:'');
    tip.style.display='block';
    const px=g.l+g.step*i,w=tip.offsetWidth;
    tip.style.left=Math.max(0,Math.min(cv.clientWidth-w,px+12>cv.clientWidth-w?px-w-12:px+12))+'px';tip.style.top='10px';};
  cv.onmouseleave=()=>{c.hover=null;_drawFteChart(c);tip.style.display='none';};
}
function _drawFteChart(c){
  const cv=document.getElementById(c.id);if(!cv)return;
  const dpr=window.devicePixelRatio||1,W=cv.clientWidth||500,H=220;
  cv.width=W*dpr;cv.height=H*dpr;const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const P={t:16,r:26,b:30,l:44},pw=W-P.l-P.r,ph=H-P.t-P.b,n=c.vals.length,step=n>1?pw/(n-1):0;
  const ax=_fteAxis(Math.max(...c.vals,c.thr||0)*1.08),mx=ax.max;
  c.geo={l:P.l,step};
  const X=i=>P.l+(n>1?step*i:pw/2),Y=v=>P.t+ph*(1-v/mx);
  // griglia + asse Y con valori decimali
  ctx.font='11px DM Sans,sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';
  for(let i=0;i<=4;i++){const v=ax.step*i,y=Y(v);ctx.strokeStyle=i===0?'rgba(0,0,0,.2)':'rgba(0,0,0,.07)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(P.l,Math.round(y)+.5);ctx.lineTo(P.l+pw,Math.round(y)+.5);ctx.stroke();ctx.fillStyle='#454C5E';ctx.fillText(_r2(v).toLocaleString('it-IT',{maximumFractionDigits:2}),P.l-8,y);}
  // asse X: con 12 mesi su card strette si salta un'etichetta su due
  const every=step&&step<40?2:1;ctx.textAlign='center';ctx.textBaseline='alphabetic';
  c.labels.forEach((lb,i)=>{if((n-1-i)%every)return;ctx.fillStyle=i===n-1?'#111827':'#454C5E';ctx.font=(i===n-1?'600 ':'')+'11px DM Sans,sans-serif';ctx.fillText(lb,X(i),H-8);});
  if(c.thr!=null){const y=Math.round(Y(c.thr))+.5;ctx.strokeStyle=THR_C;ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(P.l,y);ctx.lineTo(P.l+pw,y);ctx.stroke();ctx.setLineDash([]);}
  if(c.hover!=null){ctx.strokeStyle='rgba(0,0,0,.25)';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(Math.round(X(c.hover))+.5,P.t);ctx.lineTo(Math.round(X(c.hover))+.5,P.t+ph);ctx.stroke();ctx.setLineDash([]);}
  // area leggera sotto la linea, poi linea e marker (rossi i mesi che raggiungono o superano la soglia)
  ctx.beginPath();c.vals.forEach((v,i)=>{i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v));});ctx.lineTo(X(n-1),Y(0));ctx.lineTo(X(0),Y(0));ctx.closePath();ctx.fillStyle='rgba(109,40,217,.07)';ctx.fill();
  ctx.strokeStyle=FTE_C;ctx.lineWidth=2.25;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
  c.vals.forEach((v,i)=>{i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v));});ctx.stroke();
  c.vals.forEach((v,i)=>{
    const over=c.thr!=null&&v>=_r2(c.thr),r=c.hover===i?5.5:4.5;
    ctx.beginPath();ctx.arc(X(i),Y(v),r,0,Math.PI*2);ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.fillStyle=over?THR_C:FTE_C;ctx.fill();
  });
  // valore diretto sull'ultimo mese
  const lv=c.vals[n-1];ctx.font='600 11px DM Sans,sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle='#111827';
  ctx.textAlign='right';ctx.fillText(_fmtFte(lv),X(n-1)-8,Y(lv)-8);
}
// Ridisegno al ridimensionamento della finestra, solo se la sezione è aperta
window.addEventListener('resize',()=>{if(document.getElementById('panel-fte-trend')?.classList.contains('active'))_fteCharts.forEach(_drawFteChart);});
