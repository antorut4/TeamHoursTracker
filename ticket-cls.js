// Classificazione ticket ad alberatura a pulsanti: AMS › L1/L2/L3 › categoria › attività.
// Usato sia dall'app (index.html) sia dalla pagina del link email (ticket-entry.html).
// Il blocco va inserito dentro un contenitore [data-area] che contiene gli input input[data-k="l1|l2|l3"]:
// da lì legge i ticket dichiarati per livello, che fanno da tetto alla classificazione.
window.TicketCls = (function () {
  const LV = ['L1', 'L2', 'L3'];
  const st = {};
  let seq = 0;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = (l, c, a) => l + '\u0000' + c + '\u0000' + a;

  function html(tree, rows) {
    const id = 'tc' + (++seq), items = new Map();
    (rows || []).forEach(r => items.set(key(r.livello, r.categoria, r.attivita), { livello: r.livello, categoria: r.categoria, attivita: r.attivita, n: r.n }));
    st[id] = { tree: tree || {}, items, lv: null, cat: null, order: [] };
    return `<div class="tc" data-tc="${id}"></div>`;
  }

  function maxOf(el, lv) {
    const inp = el.closest('[data-area]')?.querySelector(`input[data-k="${lv.toLowerCase()}"]`);
    const n = inp ? Number(inp.value) : 0;
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  function used(s) {
    const lv = { L1: 0, L2: 0, L3: 0 }, cat = {}, act = {};
    s.items.forEach(it => {
      lv[it.livello] += it.n;
      cat[it.livello + '\u0000' + it.categoria] = (cat[it.livello + '\u0000' + it.categoria] || 0) + it.n;
      act[key(it.livello, it.categoria, it.attivita)] = it.n;
    });
    return { lv, cat, act };
  }

  const badge = (n, label) => `<span class="tc-n${n ? ' on' : ''}" aria-label="${label}">${n}</span>`;

  function render(el) {
    const s = st[el.dataset.tc];
    if (!s) return;
    const focused = el.contains(document.activeElement) ? document.activeElement.dataset.f : null;
    const u = used(s), max = {};
    LV.forEach(l => { max[l] = maxOf(el, l); });
    const totU = LV.reduce((a, l) => a + u.lv[l], 0), totM = LV.reduce((a, l) => a + max[l], 0);

    const path = [`<button type="button" data-f="root" onclick="TicketCls.pick(this,'root')">AMS</button>`];
    if (s.lv) path.push(s.cat ? `<button type="button" data-f="plv" onclick="TicketCls.pick(this,'lv',${LV.indexOf(s.lv)})">${s.lv}</button>` : `<b>${s.lv}</b>`);
    if (s.cat) path.push(`<b>${esc(s.cat)}</b>`);

    let btns = '', hint = '';
    if (!s.lv) {
      btns = LV.map((l, i) => `<button type="button" class="tc-b tc-lv ${l}" data-f="lv${i}" onclick="TicketCls.pick(this,'lv',${i})">${l} <span class="tc-n${u.lv[l] ? ' on' : ''}" aria-label="${u.lv[l]} classificati su ${max[l]}">${u.lv[l]}/${max[l]}</span></button>`).join('');
      hint = 'Scegli il livello, poi la categoria e l\'attività: ogni tocco classifica un ticket.';
    } else {
      const cats = Object.keys(s.tree[s.lv] || {}), full = u.lv[s.lv] >= max[s.lv];
      if (!s.cat) {
        btns = cats.map((c, i) => `<button type="button" class="tc-b tc-cat" data-f="cat${i}" onclick="TicketCls.pick(this,'cat',${i})">${esc(c)} ${badge(u.cat[s.lv + '\u0000' + c] || 0, 'classificati')}</button>`).join('');
      } else {
        btns = (s.tree[s.lv][s.cat] || []).map((a, i) => {
          const n = u.act[key(s.lv, s.cat, a)] || 0;
          return `<button type="button" class="tc-b tc-act" data-f="act${i}" ${full ? 'disabled' : ''} onclick="TicketCls.pick(this,'act',${i})">${esc(a)} ${badge(n, 'classificati')}</button>`;
        }).join('');
      }
      hint = !max[s.lv] ? `Indica prima il numero di ticket ${s.lv} nel campo sopra.`
        : full ? `Tutti i ${max[s.lv]} ticket ${s.lv} sono classificati.`
        : `${s.cat ? 'Tocca un\'attività per classificare un ticket' : 'Scegli la categoria'}: restano ${max[s.lv] - u.lv[s.lv]} ticket ${s.lv} da classificare.`;
    }

    const over = LV.filter(l => u.lv[l] > max[l]);
    const warn = over.length ? `<div class="tc-warn" role="alert">⚠ ${over.map(l => `${l}: ${u.lv[l]} ticket classificati ma ${max[l]} dichiarati`).join(' · ')}. Riduci la classificazione o aggiorna il numero di ticket.</div>` : '';

    s.order = [...s.items.keys()].sort((a, b) => a.localeCompare(b, 'it'));
    const list = s.order.map((k, i) => {
      const it = s.items.get(k), canAdd = u.lv[it.livello] < max[it.livello];
      return `<div class="tc-it"><span class="tc-tag ${it.livello}">${it.livello}</span>
        <span class="tc-txt"><span>${esc(it.categoria)} ›</span> ${esc(it.attivita)}</span>
        <span class="tc-st"><button type="button" data-f="dec${i}" aria-label="Togli un ticket" onclick="TicketCls.step(this,${i},-1)">−</button><b>${it.n}</b><button type="button" data-f="inc${i}" aria-label="Aggiungi un ticket" ${canAdd ? '' : 'disabled'} onclick="TicketCls.step(this,${i},1)">+</button></span>
        <button type="button" class="tc-x" data-f="del${i}" aria-label="Rimuovi voce" onclick="TicketCls.step(this,${i},0)">×</button></div>`;
    }).join('');

    el.innerHTML = `<div class="tc-hd"><span class="tc-title">Classificazione ticket <small>(facoltativa)</small></span>
        <span class="tc-sum"><b>${totU}</b> di ${totM} classificati</span></div>
      <nav class="tc-path" aria-label="Percorso classificazione">${path.join('<span aria-hidden="true">›</span>')}</nav>
      <div class="tc-btns">${btns}</div>
      <div class="tc-hint">${hint}</div>${warn}
      ${list ? `<div class="tc-list">${list}</div>` : ''}`;

    if (focused) (el.querySelector(`[data-f="${focused}"]:not(:disabled)`) || el.querySelector('.tc-btns .tc-b:not(:disabled)') || el.querySelector('[data-f="root"]'))?.focus();
  }

  function pick(btn, kind, i) {
    const el = btn.closest('.tc'), s = st[el.dataset.tc];
    if (kind === 'root') { s.lv = null; s.cat = null; }
    else if (kind === 'lv') { s.lv = LV[i]; s.cat = null; }
    else if (kind === 'cat') s.cat = Object.keys(s.tree[s.lv])[i];
    else if (kind === 'act') {
      const a = s.tree[s.lv][s.cat][i], k = key(s.lv, s.cat, a);
      if (used(s).lv[s.lv] >= maxOf(el, s.lv)) return;
      const it = s.items.get(k);
      if (it) it.n++; else s.items.set(k, { livello: s.lv, categoria: s.cat, attivita: a, n: 1 });
    }
    render(el);
  }

  // d = +1 / -1 sul conteggio, 0 = rimuovi la voce
  function step(btn, i, d) {
    const el = btn.closest('.tc'), s = st[el.dataset.tc], k = s.order[i], it = s.items.get(k);
    if (!it) return;
    if (d > 0 && used(s).lv[it.livello] >= maxOf(el, it.livello)) return;
    it.n += d;
    if (!d || it.n <= 0) s.items.delete(k);
    render(el);
  }

  function mount(root) { (root || document).querySelectorAll('.tc[data-tc]').forEach(render); }

  // Voci da salvare; bad se per qualche livello si classifica più di quanto dichiarato
  function collect(el) {
    const s = el && st[el.dataset.tc];
    if (!s) return { rows: undefined, bad: false };
    const u = used(s);
    return { rows: [...s.items.values()].map(it => ({ ...it })), bad: LV.some(l => u.lv[l] > maxOf(el, l)) };
  }

  return { html, mount, pick, step, collect };
})();
