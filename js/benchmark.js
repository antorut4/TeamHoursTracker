// Benchmark: valori di riferimento per progetto
// ── BENCHMARK: una riga per ogni progetto presente a backend, campi modificabili da tutti ──
const BENCH_COLS=[{k:'fteTot',l:'FTE venduti TOT'},{k:'fteCr',l:'FTE CR'},{k:'fteTicket',l:'FTE Ticket/Extra'},{k:'tL1',l:'Tempo L1 (h)'},{k:'tL2',l:'Tempo L2 (h)'},{k:'tL3',l:'Tempo L3 (h)'},{k:'pyr',l:'Pyr'}];
function renderBenchmark(){
  const el=document.getElementById('benchmarkContent');if(!el)return;
  const prjs=(_cache.prj||[]).slice().sort((a,b)=>a.localeCompare(b,'it'));
  if(!prjs.length){el.innerHTML='<div class="card"><p style="color:var(--ink-3);font-size:.84rem">Nessun progetto.</p></div>';return;}
  el.innerHTML=`<div class="card"><div class="card-title"><i class="fa-solid fa-scale-balanced"></i> Benchmark per progetto</div>
    <div class="table-wrap bench-wrap"><table><thead><tr><th>Progetto</th>${BENCH_COLS.map(c=>`<th class="and-num">${c.l}</th>`).join('')}</tr></thead><tbody>${prjs.map(p=>{
      const pid=_prjIdByName[p],b=_bench(pid);
      return `<tr data-pid="${pid}"><td><b>${_esc(p)}</b></td>${BENCH_COLS.map(c=>`<td class="and-num"><input type="number" class="bench-in" data-k="${c.k}" min="0" step="0.01" value="${b[c.k]!=null?b[c.k]:''}" aria-label="${c.l} — ${_esc(p)}"/></td>`).join('')}</tr>`;}).join('')}</tbody></table></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-ink" onclick="saveBenchmark()"><i class="fa-solid fa-floppy-disk"></i> Salva benchmark</button>
      <div id="benchMsg" class="msg"></div>
    </div></div>`;
}
async function saveBenchmark(){
  const rows=[...document.querySelectorAll('#benchmarkContent tr[data-pid]')].map(tr=>{const o={progettoId:+tr.dataset.pid};tr.querySelectorAll('.bench-in').forEach(i=>{o[i.dataset.k]=i.value.trim();});return o;});
  const bad=rows.find(r=>BENCH_COLS.some(c=>r[c.k]!==''&&!(+r[c.k]>=0)));
  if(bad){showMsg('benchMsg',`Valori non validi per ${_prjNameById[bad.progettoId]}: usa numeri maggiori o uguali a zero.`,'err');return;}
  showSpinner();let saved;
  try{saved=await call('saveBenchmark',{rows});}catch(e){hideSpinner();showMsg('benchMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  Object.entries(saved||{}).forEach(([pid,v])=>{_cache.benchmark[pid]=v;});
  showMsg('benchMsg','Benchmark salvato.','ok');
}
