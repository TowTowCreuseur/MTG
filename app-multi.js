/* app-multi.js — multi/overlay + point d’entrée
   - Overlay adverse readonly (bataille + command zone + cimetière + exil)
   - ✅ Cimetière/Exil avec aperçu au survol (images depuis stores)
   - ✅ Cartes adverses cliquables → ouvrent la LISTE associée à la pastille (lecture seule)
   - ✅ Bouton “Liste” dans Points de vie adverse → ouvre la LISTE globale de l’adversaire (lecture seule)
   - ✅ Barre de joueurs (pseudos cliquables) + sélecteur : bascule d’un plateau à l’autre
   - ✅ Raccourcis: Ctrl/⌘ + ←/→ navigation ; Ctrl/⌘ + ↑ ouverture ; Ctrl/⌘ + ↓ fermeture
   - ✅ “Placement” : écran d’affectation des flèches (← ↑ →) à des adversaires (exclusivité)
   - ✅ Si > 4 joueurs au total : pas de bouton Placement + raccourcis en mode navigation (↑ pour ouvrir, ←/→ pour parcourir)
   - Patch ciblé + refresh périodique 5s (y compris modale loupe ouverte)
   - Connexion WebSocket persistante sur refresh
*/

import {
  ZONES, qs, qsa, randomId,
  createCardEl, attachPreviewListeners,
  serializeBoard, initCore, setLogActionHook
} from './app-core.js';

const CONN_KEY = 'mtg.persist.conn';
function saveConn(data){ try { localStorage.setItem(CONN_KEY, JSON.stringify(data)); } catch {} }
function loadConn(){ try { return JSON.parse(localStorage.getItem(CONN_KEY) || 'null'); } catch { return null; } }

function computeRoomId() {
  const raw = new URLSearchParams(location.search).get('room');
  if (raw) return decodeURIComponent(raw).trim();
  const persisted = loadConn();
  if (persisted?.room) return String(persisted.room);
  return 'default';
}
let ROOM_ID = computeRoomId();

// --- Nom du joueur : priorité URL > persisted > localStorage > 'Inconnu'
const urlp = new URLSearchParams(location.search);
const urlPlayerName = (urlp.get('playerName') || '').trim();
let persisted = loadConn();
let PLAYER_ID   = persisted?.playerId || randomId();
let PLAYER_NAME = urlPlayerName
  || persisted?.playerName
  || (localStorage.getItem('mtg.playerName') || 'Inconnu');

// si l’URL apporte un nom → on le mémorise local & persisted
if (urlPlayerName) {
  try { localStorage.setItem('mtg.playerName', urlPlayerName); } catch {}
}
saveConn({ ...(persisted||{}), playerId: PLAYER_ID, playerName: PLAYER_NAME, room: ROOM_ID });

let socket = null;
const otherStates = {};
let currentView = "self";
let periodicOverlayTimer = null;
let reconnectTimer = null;

let OPP_LIST_OPEN = null; // { playerId, zone: 'cimetiere'|'exil' }

/* ==========================
   UI : Sélecteurs de joueur
   ========================== */
function ensureBoardViewerDropdown(){
  if (qs('#boardSelect')) return;
  const wrap = document.createElement('div');
  wrap.className = 'viewer-switch';
  wrap.style.cssText = 'position:fixed; top:8px; right:8px; display:flex; gap:6px; align-items:center; z-index:1000;';
  const label = document.createElement('label');
  label.htmlFor = 'boardSelect'; label.textContent = 'Voir le plateau de :'; label.style.fontSize = '12px';
  const select = document.createElement('select');
  select.id = 'boardSelect'; select.style.cssText = 'padding:4px 8px;';
  select.addEventListener('change', (e) => { currentView = e.target.value; refreshView(); });
  wrap.appendChild(label); wrap.appendChild(select);
  (qs('.board') || document.body).appendChild(wrap);
}

function ensurePlayersBar(){
  if (qs('#playersBar')) return;
  const bar = document.createElement('div');
  bar.id = 'playersBar';
  bar.style.cssText = `
    position:fixed; top:40px; right:8px; z-index:1000;
    display:flex; flex-wrap:wrap; gap:6px; max-width:50vw; justify-content:flex-end;
  `;
  const style = document.createElement('style');
  style.textContent = `
    .player-chip{
      display:inline-flex; align-items:center; gap:6px; cursor:pointer;
      border:1px solid #e5e5e5; background:#fff; border-radius:999px;
      padding:4px 10px; font-size:12px; box-shadow:0 1px 2px rgba(0,0,0,.05);
      user-select:none;
    }
    .player-chip[data-active="true"]{
      border-color:#bbb; box-shadow:0 2px 8px rgba(0,0,0,.12);
      font-weight:600;
    }
    .player-dot{
      width:8px; height:8px; border-radius:50%; background:#555;
    }
    .placement-btn{
      border:1px solid #ddd; background:#f7f7f7; border-radius:999px; padding:4px 10px; font-size:12px; cursor:pointer;
    }
    /* Dialog Placement */
    #placementDialog::backdrop{ background:rgba(0,0,0,.45); }
    .placement-sheet{ background:#fff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.35); padding:16px; width:min(720px,95vw); }
    .placement-row{ display:grid; grid-template-columns: 1fr auto auto auto; gap:8px; align-items:center; }
    .dir-btn{ border:1px solid #ddd; background:#f9f9f9; border-radius:8px; padding:6px 10px; cursor:pointer; min-width:40px; }
    .dir-btn[data-active="true"]{ background:#ffefef; border-color:#e53935; color:#b71c1c; font-weight:700; }
    .dir-btn[disabled]{ opacity:.45; cursor:not-allowed; }
  `;
  document.head.appendChild(style);
  (qs('.board') || document.body).appendChild(bar);
}

function renderPlayersBar(){
  ensurePlayersBar();
  const bar = qs('#playersBar');
  if (!bar) return;
  bar.innerHTML = '';

  const makeChip = (label, pid, active) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'player-chip';
    chip.dataset.pid = pid;
    chip.dataset.active = active ? 'true' : 'false';
    chip.innerHTML = `<span class="player-dot" aria-hidden="true"></span><span class="player-name">${label}</span>`;
    chip.addEventListener('click', () => {
      currentView = pid;
      const sel = qs('#boardSelect');
      if (sel && [...sel.options].some(o => o.value === pid)) sel.value = pid;
      refreshView();
      // visuel actif
      qsa('.player-chip').forEach(c => c.dataset.active = (c.dataset.pid === pid ? 'true' : 'false'));
    });
    return chip;
  };

  // Moi
  bar.appendChild(makeChip(`Moi (${PLAYER_NAME})`, 'self', currentView === 'self'));

  // Adversaires
  for (const [pid, obj] of Object.entries(otherStates)) {
    const name = obj.name || pid;
    bar.appendChild(makeChip(name, pid, currentView === pid));
  }

  // Bouton Placement (uniquement si ≤ 4 joueurs au total)
  if (getTotalPlayersCount() <= 4) {
    const placeBtn = document.createElement('button');
    placeBtn.type = 'button';
    placeBtn.className = 'placement-btn';
    placeBtn.textContent = 'Placement';
    placeBtn.title = 'Associer des flèches à des adversaires';
    placeBtn.addEventListener('click', openPlacementDialog);
    bar.appendChild(placeBtn);
  }
}

function refreshDropdown(){
  let sel = qs('#boardSelect');
  if (!sel) { ensureBoardViewerDropdown(); sel = qs('#boardSelect'); if (!sel) return; }
  const cur = sel.value;
  sel.innerHTML = `<option value="self">Moi (${PLAYER_NAME})</option>`;
  for (const [pid, obj] of Object.entries(otherStates)) {
    const opt = document.createElement('option');
    opt.value = pid; opt.textContent = obj.name || pid; sel.appendChild(opt);
  }
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur; else { sel.value = "self"; currentView = "self"; }

  // MàJ de la barre de joueurs
  renderPlayersBar();
}

function refreshView(){
  if (currentView === "self") hideOpponentOverlay();
  else {
    const o = otherStates[currentView];
    if (o) showOpponentOverlay(o.state, o.name, currentView);
    else console.warn('Aucun état reçu pour', currentView);
  }
}

/* ======================================================
   Dialogs Readonly pour LISTES (pastilles & points de vie)
   ====================================================== */
function normItems(items){
  const a = Array.isArray(items) ? items : [];
  return a.map(x => ({ label:String(x?.label||'').trim(), qty:Math.max(0, Math.trunc(Number(x?.qty||0))) }))
          .filter(x => x.label);
}
function buildReadonlyListDialog({ title='Liste', items=[] } = {}){
  const dlg = document.createElement('dialog');
  dlg.className = 'list-dialog';
  dlg.innerHTML = `
    <div class="list-sheet" style="background:#fff; border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.35); padding:16px; width:min(560px,95vw); max-height:92vh; display:grid; gap:12px;">
      <div class="list-header" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <strong>${title}</strong>
        <div><button type="button" class="btn btn-close" title="Fermer" style="border:1px solid #ddd; background:#f7f7f7; border-radius:8px; padding:6px 10px; cursor:pointer;">×</button></div>
      </div>
      <div class="list-body" style="display:grid; gap:8px; overflow:auto;"></div>
    </div>
  `;
  const st = document.createElement('style');
  st.textContent = `.list-dialog::backdrop{ background:rgba(0,0,0,.45); }`;
  document.head.appendChild(st);

  document.body.appendChild(dlg);
  const body = dlg.querySelector('.list-body');
  const data = normItems(items);

  if (!data.length){
    const empty = document.createElement('div');
    empty.style.cssText = 'opacity:.7; padding:8px; text-align:center;';
    empty.textContent = 'Aucun item';
    body.appendChild(empty);
  } else {
    data.forEach(it => {
      const row = document.createElement('div');
      row.className = 'list-row readonly';
      row.style.cssText = 'display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center; border:1px solid #eee; border-radius:10px; padding:8px;';
      const lbl = document.createElement('div');
      lbl.textContent = it.label;
      const qty = document.createElement('div');
      qty.textContent = String(it.qty);
      qty.style.cssText = 'font-weight:600;';
      row.appendChild(lbl);
      row.appendChild(qty);
      body.appendChild(row);
    });
  }

  dlg.querySelector('.btn-close')?.addEventListener('click', () => dlg.close());
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close(); });
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
  dlg.showModal();
  return dlg;
}
function openReadonlyLifeListForOpponent(state){
  const items = state?.lifeList?.items || [];
  buildReadonlyListDialog({ title: 'Liste — Points de vie (adversaire)', items });
}
function tryOpenReadonlyCardListFromElement(el){
  if (!el) return;
  let items = [];
  try {
    if (el.dataset.badgeItems) items = JSON.parse(el.dataset.badgeItems);
  } catch { items = []; }
  if (!items || !items.length) return;
  buildReadonlyListDialog({ title: 'Liste — Carte (adversaire)', items });
}

/* =========================================
   Loupe + liste readonly pour zones adverses
   ========================================= */
function mkLoupeBtn(title, onClick) {
  const b = document.createElement('button');
  b.className = 'btn-search'; b.title = title; b.setAttribute('aria-label', title); b.style.marginLeft = '6px';
  b.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" fill="none" stroke-width="2"></circle>
      <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
    </svg>`;
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}
function getSearchDialog(){
  const dialog = document.querySelector('.modal-search');
  if (!dialog) return null;
  return {
    dialog,
    title: dialog.querySelector('.search-title'),
    input: dialog.querySelector('.search-input'),
    results: dialog.querySelector('.search-results'),
    btnShuffle: dialog.querySelector('.btn-shuffle')
  };
}
function renderOppListIntoModal(title, cards){
  const parts = getSearchDialog();
  if (!parts) { alert('Modale de recherche absente du HTML.'); return; }
  const { dialog, title: titleEl, input, results, btnShuffle } = parts;
  if (results) results.innerHTML = '';
  if (btnShuffle) btnShuffle.style.display = 'none';
  if (titleEl) titleEl.textContent = title;

  (cards || []).slice().reverse().forEach((c) => {
    const item = document.createElement('div');
    item.className = 'result-card';
    item.dataset.cardId = c.id;

    // ✅ données pour aperçu et pour LISTE readonly
    if (c.imageNormal) item.dataset.imageNormal = c.imageNormal;
    if (c.imageSmall)  item.dataset.imageSmall  = c.imageSmall;
    if (c.badgeItems && c.badgeItems.length) {
      try { item.dataset.badgeItems = JSON.stringify(c.badgeItems); } catch {}
    }

    item.innerHTML = `
      <span>
        <strong class="card-name">${c.name || '(Carte)'}</strong>
        <em class="card-type">${c.type || ''}</em>
      </span>
    `;

    // ✅ aperçu au survol
    attachPreviewListeners(item);

    // ✅ clic → ouvrir la LISTE (lecture seule) si présente
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => tryOpenReadonlyCardListFromElement(item));

    results.appendChild(item);
  });

  if (input) {
    input.value = '';
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      Array.from(results.children).forEach(el => {
        const txt = el.textContent.toLowerCase();
        el.style.display = txt.includes(q) ? '' : 'none';
      });
    };
  }
  const restore = () => { if (btnShuffle) btnShuffle.style.display = ''; dialog.removeEventListener('close', restore); OPP_LIST_OPEN = null; };
  dialog.addEventListener('close', restore);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', 'true');
}
function openOppReadonlyList(playerId, zone, state){
  OPP_LIST_OPEN = { playerId, zone };
  const title = zone === 'cimetiere' ? 'Cimetière (adversaire)' : 'Exil (adversaire)';
  const cards = zone === 'cimetiere' ? (state?.stores?.cimetiere ?? []) : (state?.stores?.exil ?? []);
  renderOppListIntoModal(title, cards);
}

/* ============= Helpers rendu ============= */
function shallowCardSig(c){
  return [
    c?.id, c?.name, c?.type,
    c?.imageSmall, c?.imageNormal,
    c?.tapped ? 1:0, c?.phased ? 1:0, c?.faceDown ? 1:0, c?.isToken ? 1:0,
    c?.hasBadge ? 1:0, (c?.badgeItems||[]).length
  ].join('|');
}
function arraysEqualBySig(a=[], b=[]){
  if (a.length !== b.length) return false;
  for (let i=0; i<a.length; i++){
    if (shallowCardSig(a[i]) !== shallowCardSig(b[i])) return false;
  }
  return true;
}
/** Rendu carte readonly (commander + battlefield) avec aperçu au survol + clic LISTE (si pastille) */
function renderCardsTo(holder, cards){
  if (!holder) return;
  holder.innerHTML = '';
  (cards||[]).forEach(c => {
    const el = createCardEl(
      { id: c.id, name: c.name, type: c.type, imageSmall: c.imageSmall || null, imageNormal: c.imageNormal || null, hasBadge: !!c.hasBadge, badgeItems: c.badgeItems || [] },
      { faceDown: !!c.faceDown, isToken: !!c.isToken, interactive:false }
    );
    el.draggable = false;
    el.classList.toggle('tapped', !!c.tapped);
    el.classList.toggle('phased', !!c.phased);

    // ✅ activer le même zoom-aperçu que côté joueur local
    attachPreviewListeners(el);

    // ✅ clic → ouvrir la LISTE (lecture seule) si la carte a une pastille/liste
    if ((c.hasBadge || (c.badgeItems && c.badgeItems.length))) {
      if (c.badgeItems && c.badgeItems.length) {
        try { el.dataset.badgeItems = JSON.stringify(c.badgeItems); } catch {}
      }
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        tryOpenReadonlyCardListFromElement(el);
      });
    }

    holder.appendChild(el);
  });
}
/** ✅ Rendu “liste” avec aperçu (utilisé pour cimetière & exil adverses) + clic LISTE */
function renderNamesWithPreview(holder, cards){
  if (!holder) return;
  holder.innerHTML = '';
  (cards || []).forEach(c => {
    const row = document.createElement('div');
    row.className = 'card card--nameonly readonly';
    row.tabIndex = 0;
    row.dataset.cardId = c.id;

    if (c.imageNormal) row.dataset.imageNormal = c.imageNormal;
    if (c.imageSmall)  row.dataset.imageSmall  = c.imageSmall;

    if (c.badgeItems && c.badgeItems.length) {
      try { row.dataset.badgeItems = JSON.stringify(c.badgeItems); } catch {}
    }

    row.innerHTML = `
      <div class="card-name">${c.name || '(Carte)'}</div>
      <div class="card-type" style="opacity:.75; font-size:12px">${c.type || ''}</div>
    `;

    attachPreviewListeners(row);

    row.style.cursor = 'pointer';
    row.addEventListener('click', () => tryOpenReadonlyCardListFromElement(row));

    holder.appendChild(row);
  });
  if (!(cards || []).length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'opacity:.6; font-size:12px; padding:6px; text-align:center;';
    empty.textContent = '— vide —';
    holder.appendChild(empty);
  }
}

/* =========================
   OVERLAY ADVERSAIRE (RO)
   ========================= */
function ensureOpponentOverlay(){
  let dlg = qs('#opponentOverlay');
  if (dlg) return dlg;

  dlg = document.createElement('dialog');
  dlg.id = 'opponentOverlay';
  dlg.style.cssText = 'border:none; padding:0; width:min(1500px,98vw); height:auto; max-height:96vh; background:transparent; overflow:visible;';
  const style = document.createElement('style');
  style.textContent = `
    #opponentOverlay::backdrop{ background:rgba(0,0,0,.45); }
    .opp-sheet{ background:#fff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.35); padding:16px; }
    .opp-header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
    .opp-close{ line-height:1; padding:4px 10px; }
    .opp-body{ overflow:auto; max-height:calc(92vh - 64px); }
    .opp-grid{ display:grid; grid-template-columns: 280px 1fr; gap:12px; }
    .zone.readonly .cards .card{ pointer-events:auto; }
    .card--nameonly{ display:block; padding:6px 8px; border-radius:8px; border:1px solid #22314a; background:linear-gradient(180deg,#1b2640,#0f1729); color:#e6e9ee; }
    .card--nameonly + .card--nameonly{ margin-top:6px; } .card--nameonly .card-name{ color:#e6e9ee; font-weight:700; } .card--nameonly .card-type{ color:#9aa3b2; font-size:12px; }
    .btn-life-list-ro{ margin-left:6px; border:1px solid #ddd; background:#f7f7f7; border-radius:8px; padding:4px 8px; cursor:pointer; }
  `;
  document.head.appendChild(style);

  const sheet = document.createElement('div');
  sheet.className = 'opp-sheet';
  sheet.innerHTML = `
    <div class="opp-header">
      <strong class="opp-title">Plateau adverse</strong>
      <button type="button" class="btn opp-close" title="Fermer">×</button>
    </div>
    <div class="opp-body"></div>
  `;
  dlg.appendChild(sheet);
  document.body.appendChild(dlg);

  dlg.querySelector('.opp-close')?.addEventListener('click', () => dlg.close());
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close(); });
  dlg.addEventListener('close', () => {
    if (currentView !== 'self') {
      currentView = 'self';
      const sel = qs('#boardSelect'); if (sel) sel.value = 'self';
      renderPlayersBar();
    }
  });

  return dlg;
}

function buildOpponentBattlefield(state){
  const layout = document.createElement('div');
  layout.className = 'opp-grid';

  // ---- Colonne gauche : Vie / Command Zone / Cimetière / Exil ----
  const aside = document.createElement('aside');
  aside.className = 'side-zones';

  const life = document.createElement('div');
  life.className = 'zone zone--life readonly';
  life.setAttribute('data-zone', 'life');
  life.innerHTML = `
    <div class="zone-title">Points de vie
      <button type="button" class="btn-life-list-ro" title="Ouvrir la liste (adversaire)" aria-label="Ouvrir la liste (adversaire)">Liste</button>
    </div>
    <div class="life-wrap"><div class="life-value readonly" aria-live="polite">${(state?.life ?? 40)}</div></div>`;

  life.querySelector('.btn-life-list-ro')?.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    openReadonlyLifeListForOpponent(state);
  });

  const cmd = document.createElement('div');
  cmd.className = 'zone zone--commander readonly';
  cmd.setAttribute('data-zone', 'commander');
  cmd.innerHTML = `<div class="zone-title">Commander</div><div class="cards"></div>`;

  const gy = document.createElement('div');
  gy.className = 'zone zone--cimetiere readonly';
  gy.setAttribute('data-zone', 'cimetiere');
  gy.innerHTML = `<div class="zone-title">Cimetière</div><div class="cards"></div>`;

  const ex = document.createElement('div');
  ex.className = 'zone zone--exil readonly';
  ex.setAttribute('data-zone', 'exil');
  ex.innerHTML = `<div class="zone-title">Exil</div><div class="cards"></div>`;

  // Loupes
  gy.querySelector('.zone-title')?.appendChild(
    mkLoupeBtn('Voir le cimetière (adversaire)', () => openOppReadonlyList(state?.playerId || '__opp__', 'cimetiere', state))
  );
  ex.querySelector('.zone-title')?.appendChild(
    mkLoupeBtn('Voir l’exil (adversaire)', () => openOppReadonlyList(state?.playerId || '__opp__', 'exil', state))
  );

  aside.appendChild(life);
  aside.appendChild(cmd);
  aside.appendChild(gy);
  aside.appendChild(ex);

  // ---- Partie droite : Champ de bataille ----
  const section = document.createElement('section');
  section.className = 'zone zone--bataille readonly';
  section.setAttribute('data-zone', 'bataille');
  section.innerHTML = `<div class="zone-title">Champ de bataille</div><div class="battle-rows"></div>`;
  const rowsWrap = section.querySelector('.battle-rows');

  const mounts = {
    lifeEl: life.querySelector('.life-value'),
    commanderEl: cmd.querySelector('.cards'),
    graveyardEl: gy.querySelector('.cards'),
    exileEl: ex.querySelector('.cards'),
    rowEls: [],
    lifeBtn: life.querySelector('.btn-life-list-ro')
  };

  renderCardsTo(mounts.commanderEl, state?.zones?.commander ?? []);
  renderNamesWithPreview(mounts.graveyardEl, state?.stores?.cimetiere ?? []);
  renderNamesWithPreview(mounts.exileEl,     state?.stores?.exil ?? []);

  const rows = (state?.zones?.bataille ?? []);
  for (let i = 0; i < 3; i++) {
    const cardsInRow = rows[i] || [];
    const rowEl = document.createElement('div');
    rowEl.className = 'battle-row';
    rowEl.setAttribute('data-subrow', String(i + 1));

    const holder = document.createElement('div');
    holder.className = 'cards cards--battlefield';
    rowEl.appendChild(holder);

    renderCardsTo(holder, cardsInRow);
    mounts.rowEls[i] = holder;

    rowsWrap.appendChild(rowEl);
  }

  layout.appendChild(aside);
  layout.appendChild(section);

  const wrapper = document.createElement('div');
  wrapper.appendChild(layout);
  return { root: wrapper, mounts };
}

function patchOpponentOverlay(dlg, prev, next){
  if (!dlg || !dlg.__opp) return;
  const { mounts } = dlg.__opp;

  if ((prev?.life ?? 40) !== (next?.life ?? 40)) {
    if (mounts.lifeEl) mounts.lifeEl.textContent = String(next?.life ?? 40);
  }

  const prevCmd = prev?.zones?.commander ?? [];
  const nextCmd = next?.zones?.commander ?? [];
  if (!arraysEqualBySig(prevCmd, nextCmd)) renderCardsTo(mounts.commanderEl, nextCmd);

  const prevGy = prev?.stores?.cimetiere ?? [];
  const nextGy = next?.stores?.cimetiere ?? [];
  if (!arraysEqualBySig(prevGy, nextGy)) renderNamesWithPreview(mounts.graveyardEl, nextGy);

  const prevEx = prev?.stores?.exil ?? [];
  const nextEx = next?.stores?.exil ?? [];
  if (!arraysEqualBySig(prevEx, nextEx)) renderNamesWithPreview(mounts.exileEl, nextEx);

  for (let i=0; i<3; i++){
    const prevRow = (prev?.zones?.bataille?.[i]) ?? [];
    const nextRow = (next?.zones?.bataille?.[i]) ?? [];
    if (!arraysEqualBySig(prevRow, nextRow)) renderCardsTo(mounts.rowEls[i], nextRow);
  }

  if (OPP_LIST_OPEN && dlg.__opp.playerId === OPP_LIST_OPEN.playerId) {
    const zone = OPP_LIST_OPEN.zone;
    const title = zone === 'cimetiere' ? 'Cimetière (adversaire)' : 'Exil (adversaire)';
    const cards = zone === 'cimetiere' ? (next?.stores?.cimetiere ?? []) : (next?.stores?.exil ?? []);
    const parts = getSearchDialog();
    if (parts && (parts.dialog.open || parts.dialog.hasAttribute('open'))) {
      renderOppListIntoModal(title, cards);
      OPP_LIST_OPEN = { playerId: dlg.__opp.playerId, zone };
    } else {
      OPP_LIST_OPEN = null;
    }
  }

  if (mounts.lifeBtn) {
    mounts.lifeBtn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      openReadonlyLifeListForOpponent(next);
    };
  }
}

function showOpponentOverlay(state, name, playerId){
  const dlg = ensureOpponentOverlay();
  const title = dlg.querySelector('.opp-title');
  const body  = dlg.querySelector('.opp-body');
  if (title) title.textContent = `Champ de bataille — ${name || 'Adversaire'}`;

  if (state) state.playerId = playerId;

  if (dlg.__opp && dlg.__opp.playerId === playerId) {
    patchOpponentOverlay(dlg, dlg.__opp.last, state);
    dlg.__opp.last = state;
    if (!dlg.open) dlg.showModal();
    return;
  }

  body.innerHTML = '';
  const built = buildOpponentBattlefield(state);
  body.appendChild(built.root);

  dlg.__opp = { playerId, name, mounts: built.mounts, last: state };
  if (!dlg.open) dlg.showModal();
}
function hideOpponentOverlay(){
  const dlg = qs('#opponentOverlay');
  if (dlg?.open) dlg.close();
}

/* =================================================
   NAVIGATION / RACCOURCIS CLAVIER + MAPPINGS
   ================================================= */
function getOpponentIdListSorted(){
  return Object.entries(otherStates)
    .map(([pid, obj]) => ({ pid, name: (obj?.name || pid).toLowerCase() }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.pid.localeCompare(b.pid))
    .map(x => x.pid);
}

function switchOpponentByArrow(dir){
  const dlg = qs('#opponentOverlay');
  if (!dlg || !dlg.open) return;
  const ids = getOpponentIdListSorted();
  if (!ids.length) return;
  const curPid = (currentView === 'self') ? ids[0] : currentView;

  let idx = ids.indexOf(curPid);
  if (idx === -1) idx = 0;
  const nextIdx = (idx + (dir > 0 ? 1 : -1) + ids.length) % ids.length;
  const nextPid = ids[nextIdx];
  const o = otherStates[nextPid];
  if (!o) return;

  currentView = nextPid;

  const sel = qs('#boardSelect');
  if (sel && [...sel.options].some(o => o.value === nextPid)) sel.value = nextPid;
  renderPlayersBar();

  OPP_LIST_OPEN = null;
  showOpponentOverlay(o.state, o.name, nextPid);
}

/* ----- Stockage & accès mapping ----- */
const MAP_KEY = (room, me) => `mtg.persist.mapping.${room}.${me}`;
function loadMapping(){
  try {
    const raw = localStorage.getItem(MAP_KEY(ROOM_ID, PLAYER_ID));
    if (!raw) return { left:null, up:null, right:null };
    const m = JSON.parse(raw);
    return { left: m.left || null, up: m.up || null, right: m.right || null };
  } catch { return { left:null, up:null, right:null }; }
}
function saveMapping(map){
  try { localStorage.setItem(MAP_KEY(ROOM_ID, PLAYER_ID), JSON.stringify(map)); } catch {}
}
function resetMapping(){
  saveMapping({ left:null, up:null, right:null });
  // fermer le dialog si ouvert
  const dlg = qs('#placementDialog');
  if (dlg?.open) try { dlg.close(); } catch {}
}

/* ----- Placement UI ----- */
function openPlacementDialog(){
  // Si > 4 joueurs, ne pas ouvrir
  if (getTotalPlayersCount() > 4) return;

  const opps = getOpponentIdListSorted().map(pid => ({ pid, name: otherStates[pid]?.name || pid }));
  const dlgId = 'placementDialog';
  let dlg = qs(`#${dlgId}`);
  if (dlg) try { dlg.close(); dlg.remove(); } catch {}

  dlg = document.createElement('dialog');
  dlg.id = dlgId;
  dlg.innerHTML = `
    <div class="placement-sheet">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
        <strong>Placement des flèches</strong>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn-cancel">Annuler</button>
          <button type="button" class="btn-validate">Valider</button>
        </div>
      </div>
      <div class="placement-body" style="display:grid; gap:8px;"></div>
      <div style="margin-top:8px; opacity:.75; font-size:12px;">
        • Une flèche (← ↑ →) ne peut être attribuée qu’à un seul adversaire.<br/>
        • Chaque adversaire peut avoir au plus une flèche.<br/>
        • Si plus de 4 joueurs, la configuration est désactivée et les raccourcis passent en mode navigation (↑ pour ouvrir, ←/→ pour parcourir).
      </div>
    </div>
  `;
  document.body.appendChild(dlg);

  const body = dlg.querySelector('.placement-body');
  const mapping = loadMapping(); // {left,up,right}
  const chosenByPlayer = new Map(); // pid -> dir
  const chosenDirToPid = { left: mapping.left, up: mapping.up, right: mapping.right };

  Object.entries(mapping).forEach(([dir, pid]) => { if (pid) chosenByPlayer.set(pid, dir); });

  function labelForDir(d){ return d==='left' ? '←' : d==='right' ? '→' : '↑'; }

  function render(){
    body.innerHTML = '';
    opps.forEach(({pid, name}) => {
      const row = document.createElement('div');
      row.className = 'placement-row';
      row.dataset.pid = pid;

      const nameEl = document.createElement('div');
      nameEl.textContent = name;

      const mkBtn = (dir) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dir-btn';
        b.textContent = labelForDir(dir);
        const active = chosenByPlayer.get(pid) === dir;
        b.dataset.active = active ? 'true' : 'false';

        const dirUsedElsewhere = chosenDirToPid[dir] && chosenDirToPid[dir] !== pid;
        b.disabled = (!active && !!dirUsedElsewhere);

        b.addEventListener('click', () => {
          const cur = chosenByPlayer.get(pid);
          if (cur === dir) {
            chosenByPlayer.delete(pid);
            if (chosenDirToPid[dir] === pid) chosenDirToPid[dir] = null;
          } else {
            if (cur) { chosenDirToPid[cur] = null; chosenByPlayer.delete(pid); }
            const takenBy = chosenDirToPid[dir];
            if (takenBy && takenBy !== pid) return; // bloqué
            chosenByPlayer.set(pid, dir);
            chosenDirToPid[dir] = pid;
          }
          render();
        });

        return b;
      };

      const bL = mkBtn('left');
      const bU = mkBtn('up');
      const bR = mkBtn('right');

      row.appendChild(nameEl);
      row.appendChild(bL);
      row.appendChild(bU);
      row.appendChild(bR);
      body.appendChild(row);
    });
  }

  dlg.querySelector('.btn-cancel')?.addEventListener('click', () => dlg.close());
  dlg.querySelector('.btn-validate')?.addEventListener('click', () => {
    const next = { left:null, up:null, right:null };
    chosenByPlayer.forEach((dir, pid) => { next[dir] = pid; });
    saveMapping(next);
    dlg.close('ok');
  });

  dlg.addEventListener('close', () => { dlg.remove(); });
  render();
  dlg.showModal();
}

/* =================
   WEBSOCKET CLIENT
   ================= */
function getWsParams(){
  const urlp = new URLSearchParams(location.search);
  const persisted = loadConn();
  const wsHost  = urlp.get('wsHost')  || persisted?.wsHost  || 'mtg-qb1a.onrender.com';
  const wsPort  = urlp.get('wsPort')  || persisted?.wsPort  || '443';
  const wsProto = urlp.get('wsProto') || persisted?.wsProto || 'wss';
  return { wsHost, wsPort, wsProto };
}
function setupMultiplayer(){
  const { wsHost, wsPort, wsProto } = getWsParams();
  saveConn({ ...(loadConn()||{}), wsHost, wsPort, wsProto, room: ROOM_ID, playerId: PLAYER_ID, playerName: PLAYER_NAME });

  const defaultPort = (wsProto === 'wss') ? '443' : '80';
  const portStr = String(wsPort) === defaultPort ? '' : `:${wsPort}`;
  const url = `${wsProto}://${wsHost}${portStr}/?room=${encodeURIComponent(ROOM_ID)}`;
  try { socket?.close(); } catch {}
  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    sendMyState();
    const hb = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) sendMyState(); else clearInterval(hb); }, 900);
  });

  socket.addEventListener('message', async (ev) => {
    let data = ev.data;
    if (data instanceof Blob) data = await data.text();
    else if (data instanceof ArrayBuffer) data = new TextDecoder().decode(data);

    let msg; try { msg = JSON.parse(data); } catch { return; }

    // Messages de log
    if (msg.type === 'log' && msg.playerId !== PLAYER_ID) {
      const name = otherStates[msg.playerId]?.name || msg.name || 'Inconnu';
      appendLog(name, msg.action, msg.extra || {});
      return;
    }

    // Main partagée
    if (msg.type === 'show_hand' && msg.playerId !== PLAYER_ID) {
      const name = otherStates[msg.playerId]?.name || msg.name || 'Inconnu';
      showOpponentHand(name, msg.cards || []);
      return;
    }

    if (msg.type !== 'state') return;

    // detect if this is a new player joining
    const isNewPlayer = !!msg.playerId && !otherStates[msg.playerId] && msg.playerId !== PLAYER_ID;

    if (msg.playerId && typeof msg.name === 'string') {
      otherStates[msg.playerId] = otherStates[msg.playerId] || {};
      otherStates[msg.playerId].name = msg.name;
    }
    if (msg.playerId === PLAYER_ID) return;

    otherStates[msg.playerId] = { name: msg.name, state: msg.state };

    // Réinitialiser le mapping quand un nouveau joueur rejoint
    if (isNewPlayer) {
      resetMapping();
    }

    refreshDropdown();

    // Si > 4 joueurs, s'assurer que les boutons "Placement" disparaissent
    if (getTotalPlayersCount() > 4) {
      // retirer le bouton près d'Untap s'il existe
      const nearBtn = qs('#btnPlacementNearUntap');
      if (nearBtn) nearBtn.remove();
      // fermer le dialog placement s'il est ouvert
      const pd = qs('#placementDialog');
      if (pd?.open) try { pd.close(); } catch {}
    }

    if (currentView === msg.playerId) {
      const dlg = qs('#opponentOverlay');
      if (dlg?.open && dlg.__opp && dlg.__opp.playerId === msg.playerId) {
        patchOpponentOverlay(dlg, dlg.__opp.last, msg.state);
        dlg.__opp.last = msg.state;
      } else {
        showOpponentOverlay(msg.state, msg.name, msg.playerId);
      }
    }
  });

  socket.addEventListener('error', (e) => console.warn('[WS] error', e));
  socket.addEventListener('close',  () => {
    console.warn('[WS] closed — tentative de reconnexion…');
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(setupMultiplayer, 1200);
  });
}
function sendMyState(){
  try {
    const payload = { type: 'state', playerId: PLAYER_ID, name: PLAYER_NAME, state: serializeBoard() };
    socket?.send(JSON.stringify(payload));
  } catch {}
}

/* ============================
   REFRESH PÉRIODIQUE OVERLAY
   ============================ */
function startPeriodicOverlayRefresh(){
  if (periodicOverlayTimer) clearInterval(periodicOverlayTimer);
  periodicOverlayTimer = setInterval(() => {
    if (currentView === 'self') return;
    const o = otherStates[currentView];
    if (!o) return;
    const dlg = qs('#opponentOverlay');
    if (dlg?.__opp && dlg.__opp.playerId === currentView) {
      patchOpponentOverlay(dlg, dlg.__opp.last, o.state);
      dlg.__opp.last = o.state;
    } else {
      showOpponentOverlay(o.state, o.name, currentView);
    }

    if (OPP_LIST_OPEN && OPP_LIST_OPEN.playerId === currentView) {
      const zone = OPP_LIST_OPEN.zone;
      const title = zone === 'cimetiere' ? 'Cimetière (adversaire)' : 'Exil (adversaire)';
      const cards = zone === 'cimetiere' ? (o.state?.stores?.cimetiere ?? []) : (o.state?.stores?.exil ?? []);
      const parts = getSearchDialog();
      if (parts && (parts.dialog.open || parts.dialog.hasAttribute('open'))) {
        renderOppListIntoModal(title, cards);
      } else {
        OPP_LIST_OPEN = null;
      }
    }
  }, 5000);
}

/* =============
   Raccourcis
   ============= */
function getTotalPlayersCount(){
  // self + adversaires connus
  return 1 + Object.keys(otherStates).length;
}
function openFirstOpponent(){
  const ids = getOpponentIdListSorted();
  if (!ids.length) return;
  const pid = ids[0];
  const o = otherStates[pid];
  if (!o) return;
  currentView = pid;
  const sel = qs('#boardSelect');
  if (sel && [...sel.options].some(x=>x.value===pid)) sel.value = pid;
  renderPlayersBar();
  OPP_LIST_OPEN = null;
  showOpponentOverlay(o.state, o.name, pid);
}

function handleMappedJump(dir){
  const total = getTotalPlayersCount();
  const map = loadMapping(); // {left, up, right}
  if (total > 4) return false; // fallback si > 4 joueurs au total
  const pid = map[dir] || null;
  if (!pid) return false;
  const o = otherStates[pid];
  if (!o) return false;

  currentView = pid;
  const sel = qs('#boardSelect');
  if (sel && [...sel.options].some(x=>x.value===pid)) sel.value = pid;
  renderPlayersBar();
  OPP_LIST_OPEN = null;
  showOpponentOverlay(o.state, o.name, pid);
  return true;
}

/* =============
   Entrée
   ============= */

/* =============================================
   LOGS D'ACTIVITÉ
   ============================================= */
function ensureLogPanel(){
  if (qs('#activity-log')) return;
  const panel = document.createElement('div');
  panel.id = 'activity-log';
  panel.style.cssText = `
    position:fixed; bottom:120px; left:8px; width:320px; max-height:180px;
    overflow:hidden; z-index:500; pointer-events:none;
    display:flex; flex-direction:column-reverse; gap:3px;
  `;
  document.body.appendChild(panel);
}

function appendLog(playerName, action, extra={}){
  ensureLogPanel();
  const panel = qs('#activity-log');
  if (!panel) return;

  const colors = ['#4f8cff','#ffd24d','#56c378','#ff6b6b','#c084fc','#fb923c'];
  // Couleur stable par joueur
  let color = '#9aa3b2';
  if (playerName !== 'Moi') {
    const idx = [...Object.values(otherStates)].findIndex(o => o.name === playerName);
    color = colors[(idx + 1) % colors.length] || colors[0];
  } else {
    color = colors[0];
  }

  let text = '';
  if (action === 'draw')   text = `a pioché ${extra.cardName ? '<em>' + extra.cardName + '</em>' : 'une carte'}`;
  if (action === 'search') text = 'consulte sa bibliothèque';
  if (action === 'scry')   text = 'regarde le dessus de sa bibliothèque (Scry)';

  const entry = document.createElement('div');
  entry.style.cssText = 'font-size:12px; line-height:1.4; animation: logFadeIn .2s ease;';
  entry.innerHTML = `<span style="color:${color};font-weight:700;">${playerName}</span> ${text}`;
  panel.prepend(entry);

  // Garder max 8 entrées
  while (panel.children.length > 8) panel.lastElementChild?.remove();

  // Fade out après 8s
  setTimeout(() => {
    entry.style.transition = 'opacity 1s';
    entry.style.opacity = '0';
    setTimeout(() => entry.remove(), 1000);
  }, 8000);
}

// Injecter le style d'animation une fois
if (!document.getElementById('logStyles')){
  const st = document.createElement('style');
  st.id = 'logStyles';
  st.textContent = '@keyframes logFadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }';
  document.head.appendChild(st);
}

function sendLog(action, extra={}){
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify({ type:'log', playerId:PLAYER_ID, name:PLAYER_NAME, action, extra }));
  } catch {}
  // Afficher aussi pour soi-même
  appendLog('Moi', action, extra);
}

/* =============================================
   MAIN PARTAGÉE (show hand)
   ============================================= */
function showOpponentHand(playerName, cards){
  // Fermer la modale existante si présente
  const existing = qs('#dlg-show-hand');
  if (existing?.open) try { existing.close(); existing.remove(); } catch {}

  const dlg = document.createElement('dialog');
  dlg.id = 'dlg-show-hand';
  dlg.style.cssText = 'border:none;border-radius:14px;padding:0;background:#111826;color:#e6e9ee;box-shadow:0 20px 60px rgba(0,0,0,.6);width:min(900px,95vw);max-height:90vh;overflow:auto;border:1px solid #22314a;z-index:9999;';

  const header = `<div style="padding:16px 20px 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #22314a;">
    <div style="font-weight:700;font-size:16px;">Main de <span style="color:#4f8cff;">${playerName}</span> (${cards.length} cartes)</div>
    <button id="close-show-hand" style="padding:6px 14px;border-radius:8px;border:1px solid #22314a;background:#0f1524;color:#e6e9ee;cursor:pointer;">Fermer</button>
  </div>`;

  const grid = `<div style="display:flex;flex-wrap:wrap;gap:10px;padding:16px;">
    ${cards.map(c => `
      <div style="width:110px;display:flex;flex-direction:column;gap:4px;">
        ${c.imageSmall ? `<img src="${c.imageSmall}" alt="${c.name}" style="width:100%;border-radius:8px;border:1px solid #22314a;">` : ''}
        <div style="font-size:11px;font-weight:700;text-align:center;">${c.name}</div>
      </div>`).join('')}
    ${cards.length === 0 ? '<div style="opacity:.6;font-size:13px;">La main est vide</div>' : ''}
  </div>`;

  dlg.innerHTML = header + grid;
  document.body.appendChild(dlg);

  dlg.querySelector('#close-show-hand')?.addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.addEventListener('cancel', e => { e.preventDefault(); dlg.close(); dlg.remove(); });

  // Ouvrir par-dessus tout (même l'overlay adversaire)
  dlg.showModal();
}

function sendMyHand(){
  const handEls = document.querySelectorAll('.zone--main .cards .card');
  const cards = [...handEls].map(el => ({
    id: el.dataset.cardId || '',
    name: el.querySelector('.card-name')?.textContent || '',
    imageSmall: el.dataset.imageSmall || null,
  }));

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert('Vous devez être connecté à une session pour partager votre main.');
    return;
  }
  try {
    socket.send(JSON.stringify({ type:'show_hand', playerId:PLAYER_ID, name:PLAYER_NAME, cards }));
    appendLog('Moi', 'show_hand', {});
  } catch {}
}

function initMulti(){
  ensureBoardViewerDropdown();
  ensurePlayersBar();

  document.addEventListener('DOMContentLoaded',()=>{
    qs('#setNameBtn')?.addEventListener('click',()=>{
      const val=qs('#playerName')?.value.trim();
      if(val){
        PLAYER_NAME=val;
        try { localStorage.setItem('mtg.playerName', val); } catch {}
        saveConn({ ...(loadConn()||{}), playerName: PLAYER_NAME });
        refreshDropdown();
        sendMyState();
      }
    });
    const input = qs('#playerName');
    if (input && !input.value) input.value = PLAYER_NAME;
    qs('#boardSelect')?.addEventListener('change',e=>{ currentView=e.target.value; refreshView(); });
  });

  // Si le nom change dans un autre onglet (ou après builder) → maj live
  window.addEventListener('storage', (e) => {
    if (e.key === 'mtg.playerName') {
      const nv = (e.newValue || '').trim();
      if (nv && nv !== PLAYER_NAME) {
        PLAYER_NAME = nv;
        saveConn({ ...(loadConn()||{}), playerName: PLAYER_NAME });
        refreshDropdown();
        sendMyState();
      }
    }
  });

  // Raccourcis clavier : Ctrl/⌘ + ← / → (nav), Ctrl/⌘ + ↑ (ouvrir), Ctrl/⌘ + ↓ (fermer)
  document.addEventListener('keydown', (e) => {
    // Ignorer si on tape dans un champ texte
    const t = e.target;
    const isTyping = t && (
      t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.isContentEditable
    );
    if (isTyping) return;

    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    if (!ctrlOrMeta) return;

    // Fermer
    if (e.key === 'ArrowDown') {
      const dlg = qs('#opponentOverlay');
      if (dlg?.open) {
        e.preventDefault();
        hideOpponentOverlay();
        currentView = 'self';
        const sel = qs('#boardSelect'); if (sel) sel.value = 'self';
        renderPlayersBar();
      }
      return;
    }

    // Ouverture (↑)
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const total = getTotalPlayersCount();
      if (total <= 4 && handleMappedJump('up')) return; // jump direct si mapping valide
      openFirstOpponent(); // sinon ouverture du premier adversaire
      return;
    }

    // Sauts directs via mapping si overlay pas forcément ouvert
    if (e.key === 'ArrowLeft') {
      if (handleMappedJump('left')) { e.preventDefault(); return; }
      const dlg = qs('#opponentOverlay');
      if (dlg?.open) { e.preventDefault(); switchOpponentByArrow(-1); }
      return;
    }
    if (e.key === 'ArrowRight') {
      if (handleMappedJump('right')) { e.preventDefault(); return; }
      const dlg = qs('#opponentOverlay');
      if (dlg?.open) { e.preventDefault(); switchOpponentByArrow(+1); }
      return;
    }
  });

  refreshDropdown();
  setupMultiplayer();
  startPeriodicOverlayRefresh();
}

/* -------- Placement button près de "Untap all" (si présent dans le DOM principal) ------- */
function ensurePlacementButton(){
  // Afficher uniquement si ≤ 4 joueurs au total
  const anchor = qs('.btn-untap-all');
  const existing = qs('#btnPlacementNearUntap');

  if (getTotalPlayersCount() > 4) {
    if (existing) existing.remove();
    return;
  }
  if (!anchor || existing) return;

  const b = document.createElement('button');
  b.id = 'btnPlacementNearUntap';
  b.type = 'button';
  b.className = 'placement-btn';
  b.style.marginLeft = '6px';
  b.textContent = 'Placement';
  b.title = 'Associer des flèches à des adversaires';
  b.addEventListener('click', openPlacementDialog);
  anchor.insertAdjacentElement('afterend', b);
}

document.addEventListener('DOMContentLoaded', () => {
  initCore();
  initMulti();

  // Hook logs depuis app-core vers le WS
  setLogActionHook((data) => sendLog(data.type, data));

  // Bouton "Montrer ma main"
  const btnShowHand = qs('#btn-show-hand');
  if (btnShowHand) btnShowHand.addEventListener('click', sendMyHand);

  // —— Boutons session sur le plateau —— //
  const statusEl = document.querySelector('#sessionStatus');

  function connectToRoom(room) {
    const params = new URLSearchParams({ room, wsHost: 'mtg-qb1a.onrender.com', wsPort: '443', wsProto: 'wss' });
    if (PLAYER_NAME) params.set('playerName', PLAYER_NAME);
    window.location.href = `${location.pathname}?${params.toString()}`;
  }

  document.querySelector('#createSessionBtn')?.addEventListener('click', () => {
    const room = Math.random().toString(36).slice(2, 8);
    navigator.clipboard.writeText(room).catch(() => {});

    // Modale affichant le code de session
    let dlg = document.querySelector('#dlg-session-code');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dlg-session-code';
      dlg.style.cssText = 'border:none;border-radius:14px;padding:0;background:#111826;color:#e6e9ee;box-shadow:0 10px 30px rgba(0,0,0,.5);width:min(340px,92vw);border:1px solid #22314a;';
      dlg.innerHTML = `
        <div style="padding:24px 28px;text-align:center;">
          <div style="font-size:13px;color:#9aa3b2;margin-bottom:10px;">Code de session — copié dans le presse-papier</div>
          <div id="session-code-display" style="font-size:2.4rem;font-weight:900;letter-spacing:6px;color:#4f8cff;background:#0e1522;border-radius:10px;padding:14px 20px;border:1px solid #22314a;font-family:monospace;"></div>
          <div style="font-size:12px;color:#9aa3b2;margin-top:10px;">Partagez ce code aux autres joueurs</div>
          <button id="dlg-session-ok" style="margin-top:18px;padding:10px 32px;border-radius:10px;border:1px solid #4f8cff;background:#0f1524;color:#4f8cff;font-size:15px;font-weight:700;cursor:pointer;">Valider</button>
        </div>`;
      document.body.appendChild(dlg);
    }

    dlg.querySelector('#session-code-display').textContent = room;
    dlg.querySelector('#dlg-session-ok').onclick = () => dlg.close();
    dlg.addEventListener('cancel', e => e.preventDefault(), { once: true });

    dlg.showModal();
    if (statusEl) statusEl.textContent = `Session : ${room}`;
    connectToRoom(room);
  });

  document.querySelector('#joinSessionBtn')?.addEventListener('click', () => {
    const input = document.querySelector('#joinSessionInput');
    const room = (input?.value || '').trim();
    if (!room) { if (statusEl) statusEl.textContent = 'Entrez un code de session.'; return; }
    connectToRoom(room);
  });

  document.querySelector('#joinSessionInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.querySelector('#joinSessionBtn')?.click();
  });

  // Injecter/synchroniser le bouton Placement près de "Untap all" selon le nombre de joueurs
  ensurePlacementButton();
  // Re-synchroniser si la barre est re-rendue plus tard (ex: adversaires arrivent)
  const obs = new MutationObserver(() => ensurePlacementButton());
  obs.observe(document.body, { childList: true, subtree: true });
});
