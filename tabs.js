/* tabs.js v2 — OmniTender homepage tab navigation
 * Uses DOM child indexes (0-based) of #main.
 * 0=hero 1=trust-bar 2=fine 3-10=how-it-works 11-16=see-it-live 17-18=pricing 19-20=get-started
 */
(function(){
'use strict';
var TABS=[
  {id:'tab-how',    label:'How It Works',     idx:[3,4,5,6,7,8,9,10]},
  {id:'tab-demo',   label:'See It Live',       idx:[11,12,13,14,15,16]},
  {id:'tab-price',  label:'Pricing & Savings', idx:[17,18]},
  {id:'tab-start',  label:'Get Started',       idx:[19,20]}
];
var panels=[],btns=[];

window.showTab=function(id){
  panels.forEach(function(p){p.classList.toggle('active',p.id===id);});
  btns.forEach(function(b){
    var on=b.dataset.tab===id;
    b.classList.toggle('active',on);
    b.setAttribute('aria-selected',on?'true':'false');
  });
  var nav=document.querySelector('.tab-nav');
  if(nav)nav.scrollIntoView({behavior:'smooth',block:'nearest'});
  if(history&&history.replaceState)history.replaceState(null,'','#'+id);
};

function mkQA(main,ref){
  var w=document.createElement('div');
  w.className='quick-actions';
  w.setAttribute('role','navigation');
  w.setAttribute('aria-label','Quick actions');
  [['📊 Rate Analysis','savings.html',null],
   ['⚡ How It Works',null,'tab-how'],
   ['💰 Calculator',null,'tab-price'],
   ['🖥️ See It Live',null,'tab-demo'],
   ['🚀 Apply Now','apply.html',null]
  ].forEach(function(t){
    var e;
    if(t[1]){e=document.createElement('a');e.href=t[1];}
    else{e=document.createElement('button');e.type='button';(function(id){e.addEventListener('click',function(){showTab(id);});})(t[2]);}
    e.className='quick-tile';e.textContent=t[0];w.appendChild(e);
  });
  main.insertBefore(w,ref);
}

function mkNav(main,ref){
  var nav=document.createElement('nav');
  nav.className='tab-nav';
  nav.setAttribute('role','tablist');
  TABS.forEach(function(t,i){
    var b=document.createElement('button');
    b.className='tab-btn'+(i===0?' active':'');
    b.setAttribute('role','tab');
    b.setAttribute('aria-selected',i===0?'true':'false');
    b.setAttribute('aria-controls',t.id);
    b.dataset.tab=t.id;
    b.textContent=t.label;
    (function(id){b.addEventListener('click',function(){showTab(id);});})(t.id);
    nav.appendChild(b);btns.push(b);
  });
  main.insertBefore(nav,ref);
}

function init(){
  var main=document.getElementById('main');
  if(!main)return;
  var kids=Array.from(main.children);
  if(kids.length<10){console.warn('[tabs.js] DOM mismatch');return;}
  // Build panels and move children in
  TABS.forEach(function(t,i){
    var p=document.createElement('div');
    p.id=t.id;p.className='tab-panel'+(i===0?' active':'');
    p.setAttribute('role','tabpanel');
    panels.push(p);
    var first=kids[t.idx[0]];
    if(first)main.insertBefore(p,first);else main.appendChild(p);
    t.idx.forEach(function(n){if(kids[n])p.appendChild(kids[n]);});
  });
  var ref=main.querySelector('.tab-panel');
  mkQA(main,ref);mkNav(main,ref);
  // Restore from hash
  var h=location.hash.slice(1);
  if(h&&document.getElementById(h))showTab(h);
  console.log('[tabs.js] ready');
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();
})();
