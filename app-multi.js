/* app-multi.js — multi/overlay + point d’entrée
   - Overlay adverse readonly (bataille + command zone + cimetière + exil)
   - ✅ Cimetière/Exil avec aperçu au survol (images depuis stores)
   - ✅ Cartes adverses cliquables → ouvrent la LISTE associée à la pastille (lecture seule)
   - ✅ Bouton “Liste” dans Points de vie adverse → ouvre la LISTE globale de l’adversaire (lecture seule)
   - ✅ Barre de joueurs (pseudos cliquables) + sélecteur : bascule d’un plateau à l’autre
   - Patch ciblé + refresh périodique 5s (y compris modale loupe ouverte)
   - Connexion WebSocket persistante sur refresh
*/

import {
  ZONES, qs, qsa, randomId,
  createCardEl, attachPreviewListeners,
  serializeBoard, initCore
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
  dlg.style.cssText = 'border:none; padding:0; width:min(1200px,95vw); height:auto; max-height:92vh; background:transparent; overflow:visible;';
  const style = document.createElement('style');
  style.textContent = `
    #opponentOverlay::backdrop{ background:rgba(0,0,0,.45); }
    .opp-sheet{ background:#fff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.35); padding:16px; }
    .opp-header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
    .opp-close{ line-height:1; padding:4px 10px; }
    .opp-body{ overflow:auto; max-height:calc(92vh - 64px); }
    .opp-grid{ display:grid; grid-template-columns: 280px 1fr; gap:12px; }
    .zone.readonly .cards .card{ pointer-events:auto; }
    .card--nameonly{ display:block; padding:6px 8px; border-radius:8px; border:1px solid rgba(0,0,0,.08); background:#fafafa; }
    .card--nameonly + .card--nameonly{ margin-top:6px; }
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

/* =================
   WEBSOCKET CLIENT
   ================= */
function getWsParams(){
  const urlp = new URLSearchParams(location.search);
  const persisted = loadConn();
  const wsHost  = urlp.get('wsHost')  || persisted?.wsHost  || location.hostname || '127.0.0.1';
  const wsPort  = urlp.get('wsPort')  || persisted?.wsPort  || '8787';
  const wsProto = urlp.get('wsProto') || persisted?.wsProto || (location.protocol === 'https:' ? 'wss' : 'ws');
  return { wsHost, wsPort, wsProto };
}
function setupMultiplayer(){
  const { wsHost, wsPort, wsProto } = getWsParams();
  saveConn({ ...(loadConn()||{}), wsHost, wsPort, wsProto, room: ROOM_ID, playerId: PLAYER_ID, playerName: PLAYER_NAME });

  const url = `${wsProto}://${wsHost}:${wsPort}/?room=${encodeURIComponent(ROOM_ID)}`;
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
    if (msg.type !== 'state') return;

    if (msg.playerId && typeof msg.name === 'string') {
      otherStates[msg.playerId] = otherStates[msg.playerId] || {};
      otherStates[msg.playerId].name = msg.name;
    }
    if (msg.playerId === PLAYER_ID) return;

    otherStates[msg.playerId] = { name: msg.name, state: msg.state };
    refreshDropdown();

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
   Entrée
   ============= */
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

  refreshDropdown();
  setupMultiplayer();
  startPeriodicOverlayRefresh();
}

document.addEventListener('DOMContentLoaded', () => {
  initCore();
  initMulti();
});
