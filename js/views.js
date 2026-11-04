// Sezioni dell'app: ogni pannello è un file in views/, caricato una sola volta all'avvio dentro <main>.
// Il caricamento parte subito, in parallelo al login; l'app si apre solo quando tutte le viste sono pronte.
const VIEWS=['ore','dashboard','riepilogo','trend','ferie','overview','reperibilita','presenze','consuntivo','andamento','fte-trend','benchmark','eventi','rep-overview','admin'];
const _viewsReady=(async()=>{
  const html=await Promise.all(VIEWS.map(v=>fetch('views/'+v+'.html',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`vista "${v}" non disponibile (HTTP ${r.status})`);return r.text();})));
  document.querySelector('main.main-content').insertAdjacentHTML('beforeend',html.join('\n'));
})();
_viewsReady.catch(e=>console.error('[views]',e));
