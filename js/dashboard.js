// Dashboard di team (admin e manager)
// TREND
// DASHBOARD
function renderDashboard(){
  const lf=(isTeamLead&&!isAdmin)?currentUser:(document.getElementById('dashboardLead')?.value||'');
  const members=getMembers(lf);
  const now=new Date(),month=now.getMonth(),year=now.getFullYear();
  const hrsMap={};
  (_read(K_HRS,[])||[]).filter(o=>o.anno===year&&o.mese===month).forEach(o=>{const res=RESOURCES.find(x=>x.id===o.risorsaId);if(res)hrsMap[res.fullName]={ore1:o.ore_q1,ore2:o.ore_q2};});
  const resources=members.map(m=>RESOURCES.find(r=>r.fullName===m)).filter(Boolean);
  const totalProjects=new Set(resources.flatMap(r=>r.progetti||[])).size;
  const avgProjects=resources.length?(resources.reduce((s,r)=>s+(r.progetti||[]).length,0)/resources.length).toFixed(1):'0';
  const inserted=resources.filter(r=>hrsMap[r.fullName]).length;
  const filterRow=document.getElementById('dashFilterRow');
  if(filterRow)filterRow.style.display=isAdmin?'':'none';
  document.getElementById('dashKpi').innerHTML=[
    {icon:'fa-users',val:resources.length,lbl:'Risorse',color:'var(--amber)',bg:'var(--amber-bg)'},
    {icon:'fa-folder-open',val:totalProjects,lbl:'Progetti attivi',color:'var(--info)',bg:'var(--info-bg)'},
    {icon:'fa-layer-group',val:avgProjects,lbl:'Proj. medi / risorsa',color:'var(--ok)',bg:'var(--ok-bg)'},
    {icon:'fa-clock',val:inserted+'/'+resources.length,lbl:'Ore inserite '+MONTHS[month],color:inserted===resources.length?'var(--ok)':'var(--warn)',bg:inserted===resources.length?'var(--ok-bg)':'var(--warn-bg)'}
  ].map(k=>`<div class="card" style="margin:0;padding:16px 18px;display:flex;align-items:center;gap:13px"><div style="width:40px;height:40px;border-radius:10px;background:${k.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fa-solid ${k.icon}" style="color:${k.color};font-size:.95rem"></i></div><div><div style="font-size:1.6rem;font-weight:700;font-family:var(--f-display);color:var(--ink);line-height:1">${k.val}</div><div style="font-size:.74rem;color:var(--ink-3);margin-top:3px">${k.lbl}</div></div></div>`).join('');
  requestAnimationFrame(()=>{
    const cv=document.getElementById('dashCanvas');if(!cv)return;
    const ctx=cv.getContext('2d');
    const MIN_SLOT=72,containerW=cv.parentElement.clientWidth||700;
    const W=Math.max(containerW,resources.length*MIN_SLOT),H=220;
    cv.width=W;cv.height=H;cv.style.width=W+'px';cv.style.height=H+'px';
    ctx.clearRect(0,0,W,H);
    if(!resources.length)return;
    const maxP=Math.max(...resources.map(r=>(r.progetti||[]).length),1);
    const Pad={t:28,r:16,b:40,l:16},pw=W-Pad.l-Pad.r,ph=H-Pad.t-Pad.b;
    const n=resources.length,slotW=pw/n,barW=Math.max(14,Math.min(52,slotW*0.55));
    for(let i=0;i<=maxP;i++){const y=Pad.t+ph*(1-i/maxP);ctx.strokeStyle='rgba(0,0,0,.05)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(Pad.l,y);ctx.lineTo(Pad.l+pw,y);ctx.stroke();}
    resources.forEach((r,i)=>{
      const count=(r.progetti||[]).length,color=colorFor(r.fullName);
      const cx=Pad.l+slotW*i+slotW/2,bh=count>0?ph*count/maxP:3,y=Pad.t+ph-bh,x=cx-barW/2,rad=5;
      ctx.fillStyle=color+'1A';ctx.beginPath();
      if(ctx.roundRect){ctx.roundRect(x,Pad.t,barW,ph,rad);}else{ctx.rect(x,Pad.t,barW,ph);}
      ctx.fill();
      ctx.fillStyle=color;ctx.globalAlpha=0.88;ctx.beginPath();
      if(ctx.roundRect){ctx.roundRect(x,y,barW,bh,bh<rad*2?bh/2:rad);}else{ctx.rect(x,y,barW,bh);}
      ctx.fill();ctx.globalAlpha=1;
      if(count>0){ctx.fillStyle=color;ctx.font='bold 12px DM Sans,sans-serif';ctx.textAlign='center';ctx.fillText(count,cx,y-7);}
      ctx.fillStyle='#8A8275';ctx.font='10px DM Sans,sans-serif';ctx.textAlign='center';
      ctx.fillText((r.cognome||r.fullName.split(' ').slice(1).join(' ')||r.fullName.split(' ')[0]).slice(0,10),cx,H-7);
    });
  });
  document.getElementById('dashGrid').innerHTML=resources.map(r=>{
    const hrs=hrsMap[r.fullName],color=colorFor(r.fullName);
    const initials=((r.nome||r.fullName.split(' ')[0])[0]+(r.cognome||r.fullName.split(' ')[1]||'?')[0]).toUpperCase();
    const nProj=(r.progetti||[]).length;
    let hrsStatus;
    if(hrs){const tot=(+hrs.ore1||0)+(+hrs.ore2||0),av=wHours(year,month,1)+wHours(year,month,2);
      if(tot>av)hrsStatus=`<span class="badge badge-warn" style="gap:5px"><i class="fa-solid fa-bolt" style="font-size:.62rem"></i>+${tot-av}h extra</span>`;
      else hrsStatus=`<span class="badge badge-ok" style="gap:5px"><i class="fa-solid fa-check" style="font-size:.62rem"></i>${tot}h</span>`;}
    else hrsStatus=`<span class="badge badge-danger" style="gap:5px"><i class="fa-solid fa-xmark" style="font-size:.62rem"></i>Mancanti</span>`;
    const projChips=(r.progetti||[]).map(p=>`<span style="background:var(--stone-2);border-radius:4px;padding:2px 8px;font-size:.71rem;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px">${_esc(p)}</span>`).join('');
    return `<div class="card" style="margin:0;padding:18px 20px;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:40px;height:40px;border-radius:50%;background:${color}22;border:2px solid ${color}55;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;color:${color};flex-shrink:0">${_esc(initials)}</div>
        <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:.9rem;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(r.fullName)}</div><div style="font-size:.73rem;color:var(--ink-3);margin-top:1px">${_esc(r.managerName||'—')}</div></div>
        <div style="font-size:.72rem;font-weight:700;background:${color}18;color:${color};border-radius:20px;padding:3px 9px;white-space:nowrap;flex-shrink:0">${nProj} ${nProj===1?'progetto':'progetti'}</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;min-height:22px;margin-bottom:12px;flex:1">${projChips||'<span style="font-size:.74rem;color:var(--ink-3)">Nessun progetto</span>'}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:10px">\
        <span style="font-size:.74rem;color:var(--ink-3)">${MONTHS[month]} ${year}</span>${hrsStatus}</div>
    </div>`;
  }).join('')||'<p style="color:var(--ink-3);font-size:.84rem">Nessuna risorsa trovata.</p>';
}
async function renderTrend(){
  const n=+document.getElementById('trendMonths').value,lf=document.getElementById('trendLead').value;
  const members=getMembers(lf),now=new Date(),labels=[],periods=[];
  for(let i=n-1;i>=0;i--){let m=now.getMonth()-i,y=now.getFullYear();while(m<0){m+=12;y--;}labels.push(MONTHS[m].slice(0,3)+' '+String(y).slice(2));periods.push({m,y});}
  let allHrs={};(_read(K_HRS,[])||[]).forEach(o=>{const res=RESOURCES.find(x=>x.id===o.risorsaId);if(res)allHrs[`${res.fullName}||${o.anno}||${o.mese}`]={ore1:o.ore_q1,ore2:o.ore_q2};});
  const ds=members.map(mem=>({label:mem.split(' ')[0],color:colorFor(mem),data:periods.map(({m,y})=>{const e=allHrs[`${mem}||${y}||${m}`];return e?((+e.ore1||0)+(+e.ore2||0)):null;})}));
  const cv=document.getElementById('trendCanvas'),ctx=cv.getContext('2d');
  const W=cv.offsetWidth||800,H=240;cv.width=W;cv.height=H;ctx.clearRect(0,0,W,H);
  const P={t:18,r:18,b:38,l:48},pw=W-P.l-P.r,ph=H-P.t-P.b;
  let mx=0;ds.forEach(d=>d.data.forEach(v=>{if(v!=null&&v>mx)mx=v;}));mx=Math.ceil((mx||160)/20)*20;
  ctx.strokeStyle='var(--stone-3)';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=P.t+ph*(1-i/4);ctx.beginPath();ctx.moveTo(P.l,y);ctx.lineTo(P.l+pw,y);ctx.stroke();ctx.fillStyle='#8A8275';ctx.font='11px DM Sans';ctx.textAlign='right';ctx.fillText(Math.round(mx*i/4)+'h',P.l-5,y+4);}
  ctx.fillStyle='#8A8275';ctx.font='11px DM Sans';ctx.textAlign='center';
  labels.forEach((lb,i)=>{const x=P.l+pw*i/(labels.length-1||1);ctx.fillText(lb,x,H-6);});
  ds.forEach(d=>{
    const pts=d.data.map((v,i)=>v!=null?{x:P.l+pw*i/(labels.length-1||1),y:P.t+ph*(1-v/mx)}:null);
    ctx.strokeStyle=d.color;ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.beginPath();let st=false;
    pts.forEach(p=>{if(!p)return;if(!st){ctx.moveTo(p.x,p.y);st=true;}else ctx.lineTo(p.x,p.y);});ctx.stroke();
    pts.forEach(p=>{if(!p)return;ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle=d.color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();});
  });
  document.getElementById('trendLegend').innerHTML=ds.map((d,i)=>`<span><span class="tdot" style="background:${d.color}"></span>${_esc(members[i])}</span>`).join('');
  const warns=[];
  periods.forEach(({m,y})=>members.forEach(mem=>{const e=allHrs[`${mem}||${y}||${m}`];if(!e)warns.push({mem,m,y,t:'m'});else{const tot=(+e.ore1||0)+(+e.ore2||0),av=wHours(y,m,1)+wHours(y,m,2);if(tot>av)warns.push({mem,m,y,t:'x',tot,av});}}));
  const ae=document.getElementById('trendAlerts');
  if(!warns.length){ae.innerHTML='<p style="color:var(--ok);font-size:.84rem"><i class="fa-solid fa-check" style="margin-right:6px"></i>Nessun avviso.</p>';return;}
  ae.innerHTML=warns.slice(0,12).map(w=>w.t==='m'
    ?`<div style="padding:8px 12px;background:var(--danger-bg);border-radius:var(--r);margin-bottom:6px;font-size:.82rem;color:var(--danger)"><i class="fa-solid fa-xmark" style="margin-right:6px"></i><b>${_esc(w.mem.split(' ')[0])}</b> — ore mancanti per <b>${MONTHS[w.m]} ${w.y}</b></div>`
    :`<div style="padding:8px 12px;background:var(--warn-bg);border-radius:var(--r);margin-bottom:6px;font-size:.82rem;color:var(--warn)"><i class="fa-solid fa-bolt" style="margin-right:6px"></i><b>${_esc(w.mem.split(' ')[0])}</b> — ore extra in <b>${MONTHS[w.m]} ${w.y}</b>: ${w.tot}h / ${w.av}h</div>`
  ).join('');
}
