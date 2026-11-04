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
  {k:'grafite',l:'Grafite',sb:'linear-gradient(170deg,#0B1120,#1E293B 50%,#334155)',acc:'#334155'},
  // Squadre: solo i colori sociali (acc2 = secondo colore nell'anteprima)
  {k:'napoli',g:'squadre',l:'Napoli',sb:'linear-gradient(170deg,#002A5C,#075A96 45%,#12A0D7)',acc:'#0B6FB8',acc2:'#12A0D7'},
  {k:'juvestabia',g:'squadre',l:'Juve Stabia',sb:'linear-gradient(170deg,#001A4D,#003380 50%,#0044A6)',acc:'#0044A6',acc2:'#FFD200'},
  {k:'roma',g:'squadre',l:'Roma',sb:'linear-gradient(170deg,#3D0A12,#6E1724 45%,#A8322B)',acc:'#8E1F2F',acc2:'#F0BC42'},
  {k:'salernitana',g:'squadre',l:'Salernitana',sb:'linear-gradient(170deg,#2E0511,#6A1833 45%,#9E2C4C)',acc:'#861F41',acc2:'#A8324F'},
  {k:'barcellona',g:'squadre',l:'Barcellona',sb:'linear-gradient(170deg,#002B57,#004D98 45%,#A50044)',acc:'#004D98',acc2:'#A50044'}
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
  const opt=t=>`<button type="button" class="theme-opt${t.k===_themeCur?' on':''}" data-k="${t.k}" onclick="pickTheme('${t.k}')" aria-pressed="${t.k===_themeCur}">
      <span class="theme-prev"><span class="tp-sb" style="background:${t.sb}"><i></i><i></i><i></i></span><span class="tp-main"><span class="tp-t" style="background:${t.acc}"></span><span class="tp-b" style="background:${t.acc2||t.acc}"></span></span></span>
      <span class="tn">${t.l}${t.k===_themeCur?' <i class="fa-solid fa-circle-check"></i>':''}</span></button>`;
  document.getElementById('themeGrid').innerHTML=`<div class="theme-grp">Colori</div>${THEMES.filter(t=>!t.g).map(opt).join('')}<div class="theme-grp">Squadre</div>${THEMES.filter(t=>t.g==='squadre').map(opt).join('')}`;
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
