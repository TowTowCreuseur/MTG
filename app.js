/* app.js — interactions plateau + multi
   - Plateau : drag & drop, pioche, recherche, etc.
   - Multi : partage d’état via WebSocket
   - Sessions : création lien d’invitation + rejoindre
*/

const ZONES = {
  PIOCHE: 'pioche',
  MAIN: 'main',
  BATAILLE: 'bataille',
  CIMETIERE: 'cimetiere',
  EXIL: 'exil',
  COMMANDER: 'commander'
};

const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));

// ---------- Deck ----------
function makeDeck(cards) {
  let counter = 0;
  return cards.map(c => ({
    id: `${c.name}-${++counter}`,
    name: c.name,
    type: c.type,
    image: c.image || null
  }));
}
let deck = makeDeck([
  { name: 'Éclair', type: 'Éphémère' },
  { name: 'Forêt', type: 'Terrain' },
  { name: 'Ours runegrave', type: 'Créature — Ours' },
  { name: 'Contresort', type: 'Éphémère' },
  { name: 'Île', type: 'Terrain' },
  { name: 'Île', type: 'Terrain' },
  { name: 'Géant fracasseur', type: 'Créature — Géant' },
  { name: 'Chemin vers l’exil', type: 'Éphémère' },
  { name: 'Plaine', type: 'Terrain' },
  { name: 'Marais', type: 'Terrain' },
]);

// ---------- Carte ----------
function createCardEl(card, { faceDown=false } = {}) {
  const el = document.createElement('article');
  el.className = 'card' + (faceDown ? ' face-down' : '');
  el.draggable = true;
  el.dataset.cardId = card.id;
  el.tabIndex = 0;

  const illust = card.image ? `<div class="card-illust"><img src="${card.image}" alt="${card.name}"></div>` : '';
  el.innerHTML = `
    ${illust}
    <div class="card-name">${card.name}</div>
    <div class="card-type">${card.type || ''}</div>
  `;
  attachCardListeners(el);
  return el;
}
function attachCardListeners(cardEl) {
  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);
  cardEl.addEventListener('dblclick', () => toggleTappedOn(cardEl));
  cardEl.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 't') toggleTappedOn(cardEl); });

  // triple clic = phased
  let clicks = 0, last = 0, timer=null;
  cardEl.addEventListener('click', () => {
    const now = Date.now();
    if (now - last < 350) { clicks++; } else { clicks = 1; }
    last = now;
    clearTimeout(timer);
    timer = setTimeout(() => { if (clicks >= 3) togglePhased(cardEl); clicks=0; }, 360);
  });
}
function toggleTappedOn(cardEl) { if (cardEl.closest('.zone--bataille')) cardEl.classList.toggle('tapped'); }
function togglePhased(cardEl) { if (cardEl.closest('.zone--bataille')) cardEl.classList.toggle('phased'); }

// ---------- DnD ----------
function handleDragStart(e) { e.currentTarget.classList.add('dragging'); e.dataTransfer.setData('text/plain', e.currentTarget.dataset.cardId || ''); }
function handleDragEnd(e) { e.currentTarget.classList.remove('dragging'); }
function onZoneDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('over'); }
function onZoneDragLeave(e) { e.currentTarget.classList.remove('over'); }
function resolveDropContainer(zone) { return zone.classList.contains('battle-row') ? qs('.cards', zone) : zone.querySelector('.cards') || zone; }
function onZoneDrop(e) {
  e.preventDefault();
  const zone = e.currentTarget;
  zone.classList.remove('over');
  const cardId = e.dataTransfer.getData('text/plain');
  const card = document.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`) || document.querySelector('.card.dragging');
  if (!card) return;
  resolveDropContainer(zone).appendChild(card);
  if (card.classList.contains('face-down')) card.classList.remove('face-down');
  if ([ZONES.MAIN, ZONES.CIMETIERE, ZONES.EXIL, ZONES.COMMANDER].includes(zone.dataset.zone)) {
    card.classList.remove('tapped','phased');
  }
}

// ---------- Pioche ----------
function updateDeckCount() { const c=qs('.zone--pioche .deck-count [data-count]'); if(c) c.textContent=deck.length; }
function spawnTopCardForDrag() { if(deck.length===0)return; const top=deck.pop(); updateDeckCount(); qs('.zone--pioche .cards--pioche').appendChild(createCardEl(top,{faceDown:true})); }

// ---------- Recherche ----------
function openSearchModal() { /* inchangé */ }
function shuffleDeck() { for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];} }

// ---------- Deck depuis localStorage ----------
function tryLoadDeckFromLocalStorage(){ /* inchangé */ }

// ---------- Multi ----------
const ROOM_ID = new URLSearchParams(location.search).get('room') || 'default';
let PLAYER_ID = crypto.randomUUID();
let PLAYER_NAME = "Inconnu";
let socket = null;
const otherStates = {};
let currentView = "self";

function serializeBoard(){ /* sérialise DOM en JSON */ }
function renderBoard(state,isSelf){ /* rendu plateau, main seulement si isSelf */ }
// 🔧 URL du serveur WebSocket — remplace par ton URL Render après déploiement
const WS_SERVER_URL = "wss://mtg-qb1a.onrender.com";

function setupMultiplayer(){
  const url=`${WS_SERVER_URL}/?room=${encodeURIComponent(ROOM_ID)}`;
  socket=new WebSocket(url);
  socket.addEventListener('open',()=>{
    setInterval(()=>{
      if(socket?.readyState===WebSocket.OPEN){
        socket.send(JSON.stringify({type:'state',playerId:PLAYER_ID,name:PLAYER_NAME,state:serializeBoard()}));
      }
    },500);
  });
  socket.addEventListener('message',ev=>{
    const msg=JSON.parse(ev.data);
    if(msg.type!=='state'||msg.playerId===PLAYER_ID) return;
    otherStates[msg.playerId]={name:msg.name,state:msg.state};
    refreshDropdown(); refreshView();
  });
}
function refreshDropdown(){
  const sel=qs('#boardSelect'); const cur=sel?.value;
  if(!sel) return;
  sel.innerHTML=`<option value="self">Moi (${PLAYER_NAME})</option>`;
  for(const [pid,obj] of Object.entries(otherStates)){
    const opt=document.createElement('option'); opt.value=pid; opt.textContent=obj.name||pid; sel.appendChild(opt);
  }
  if(cur && [...sel.options].some(o=>o.value===cur)) sel.value=cur; else {sel.value="self"; currentView="self";}
}
function refreshView(){
  const zones=qs('#zones');
  if(currentView==="self"){ renderBoard(serializeBoard(),true); }
  else { const o=otherStates[currentView]; if(o) renderBoard(o.state,false); }
}

// ---------- Init ----------
function init(){
  qsa('.dropzone, .battle-row').forEach(z=>{z.addEventListener('dragover',onZoneDragOver);z.addEventListener('dragleave',onZoneDragLeave);z.addEventListener('drop',onZoneDrop);});
  qs('.btn-draw:not(.btn-shuffle-deck)')?.addEventListener('click',spawnTopCardForDrag);
  qs('.btn-shuffle-deck')?.addEventListener('click',()=>{ shuffleDeck(); updateDeckCount(); });
  qs('.btn-search')?.addEventListener('click',openSearchModal);
  const imported=tryLoadDeckFromLocalStorage(); updateDeckCount();
  if(!imported){ const main=qs('[data-zone="main"] .cards'); ['Éclair','Forêt','Ours runegrave'].forEach(name=>{const f=deck.find(c=>c.name===name);if(f)main.appendChild(createCardEl(f));}); }
  setupMultiplayer();
}
document.addEventListener('DOMContentLoaded',()=>{
  qs('#setNameBtn')?.addEventListener('click',()=>{const val=qs('#playerName')?.value.trim(); if(val){PLAYER_NAME=val; refreshDropdown();}});
  qs('#boardSelect')?.addEventListener('change',e=>{currentView=e.target.value; refreshView();});

  // 🔥 Sessions
  qs('#createSessionBtn')?.addEventListener('click',()=>{
    const roomId=Math.random().toString(36).slice(2,8);
    const invite=`${location.origin}${location.pathname}?room=${roomId}`;

    // remplir le champ de la modale
    const input=qs('#inviteLink');
    if(input) input.value=invite;

    // ouvrir la modale
    const dlg=qs('#inviteDialog');
    if(dlg && typeof dlg.showModal==='function'){ dlg.showModal(); }
    else if(dlg){ dlg.setAttribute('open',true); }

    // copier dans presse-papier
    navigator.clipboard.writeText(invite).catch(()=>{});

    // basculer l’hôte sur la nouvelle session
  });

  qs('#joinSessionBtn')?.addEventListener('click',()=>{
    const link=qs('#joinLink')?.value.trim();
    if(link) location.href=link;
  });

  init();
});
