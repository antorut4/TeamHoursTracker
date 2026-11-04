// PERSONALIZZAZIONE: ogni utente sceglie il colore della propria app.
// Il tema è salvato sul server (segue l'utente su ogni dispositivo) e in locale (applicato subito all'apertura).
const THEMES=[
  {k:'viola',l:'Viola',sb:'linear-gradient(170deg,#3B0F80,#5B21B6 45%,#7C3AED)',acc:'#6D28D9'},
  {k:'blu',l:'Blu oceano',sb:'linear-gradient(170deg,#0B1F5C,#1E40AF 45%,#2563EB)',acc:'#1D4ED8'},
  {k:'verde',l:'Verde smeraldo',sb:'linear-gradient(170deg,#022C22,#065F46 45%,#059669)',acc:'#047857'},
  {k:'teal',l:'Turchese',sb:'linear-gradient(170deg,#042F2E,#115E59 45%,#0D9488)',acc:'#0F766E'},
  {k:'rosso',l:'Rosso',sb:'linear-gradient(170deg,#4C0519,#9F1239 45%,#E11D48)',acc:'#BE123C'},
  {k:'rosa',l:'Magenta',sb:'linear-gradient(170deg,#500724,#9D174D 45%,#DB2777)',acc:'#BE185D'},
  {k:'arancio',l:'Arancio tramonto',sb:'linear-gradient(170deg,#431407,#9A3412 45%,#EA580C)',acc:'#C2410C'},
  {k:'grafite',l:'Grafite',sb:'linear-gradient(170deg,#0B1120,#1E293B 50%,#334155)',acc:'#334155'}
];
const THEME_KEY='tht_theme';
let _themeCur='viola',_themePick=null;
function applyTheme(k){
  if(!THEMES.some(t=>t.k===k))k='viola';
  _themeCur=k;
  if(k==='viola')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=k;
  try{if(k==='viola')localStorage.removeItem(THEME_KEY);else localStorage.setItem(THEME_KEY,k);}catch{}
  _themeRedraw();
}
// Anteprima senza salvare (il clic su un tema lo mostra subito su tutta l'app)
function _themePreview(k){
  if(k==='viola')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=k;
  _themeRedraw();
}
// I grafici su canvas leggono l'accento quando vengono disegnati: si ridisegnano quelli visibili
function _themeRedraw(){
  if(document.getElementById('panel-fte-trend')?.classList.contains('active')&&typeof _fteCharts!=='undefined')_fteCharts.forEach(c=>{try{_drawFteChart(c);}catch{}});
}
function openThemePicker(){
  _themePick=_themeCur;
  document.getElementById('themeGrid').innerHTML=THEMES.map(t=>`<button type="button" class="theme-opt${t.k===_themeCur?' on':''}" data-k="${t.k}" onclick="pickTheme('${t.k}')" aria-pressed="${t.k===_themeCur}">
      <span class="theme-prev"><span class="tp-sb" style="background:${t.sb}"><i></i><i></i><i></i></span><span class="tp-main"><span class="tp-t" style="background:${t.acc}"></span><span class="tp-b" style="background:${t.acc}"></span></span></span>
      <span class="tn">${t.l}${t.k===_themeCur?' <i class="fa-solid fa-circle-check"></i>':''}</span></button>`).join('');
  document.getElementById('themeOverlay').classList.add('open');
  closeMobileNav();
}
function pickTheme(k){
  _themePick=k;
  document.querySelectorAll('.theme-opt').forEach(b=>{const on=b.dataset.k===k;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
  _themePreview(k);
}
// Annulla (o clic fuori): si torna al tema salvato
function closeThemePicker(revert){
  document.getElementById('themeOverlay').classList.remove('open');
  if(revert)_themePreview(_themeCur);
}
async function saveTheme(){
  const k=_themePick||_themeCur;
  showSpinner();
  try{await call('setTema',{tema:k});}catch(e){hideSpinner();showMsg('themeMsg','Errore: '+e.message,'err');return;}
  hideSpinner();
  applyTheme(k);closeThemePicker(false);
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('themeOverlay')?.classList.contains('open'))closeThemePicker(true);});
