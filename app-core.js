/* app-core.js — logique locale : plateau, cartes, modales, scry, jetons, deck
   Exporte pour le module multi :
   - qs, qsa, randomId
   - createCardEl (avec {interactive:false} pour affichage readonly)
   - lifeTotal(), setLife(), changeLife(), updateLifeDisplay()
   - exileStore, graveyardStore
   - deck() (getter)
   - shuffleDeck(), spawnTopCardForDrag()
   - openSearchModal(), openExileSearchModal(), openGraveyardSearchModal(), openTokenDialog()
   - serializeBoard()  ⟵ inclut l’ordre du deck
   - restoreBoard(state) ⟵ restaure zones, stores et deck
   - initCore() (démarrage local)
   - ✅ attachPreviewListeners(el) ⟵ active le même zoom-aperçu que sur tes cartes locales
*/

export const ZONES = {
  PIOCHE: 'pioche',
  MAIN: 'main',
  BATAILLE: 'bataille',
  CIMETIERE: 'cimetiere',
  EXIL: 'exil',
  COMMANDER: 'commander',
  LIFE: 'life',
  TOKENS: 'tokens'
};

export const qs = (s, el=document) => el.querySelector(s);
export const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));

/* ---------- Polyfill/ID util ---------- */
export const randomId = () => {
  try { if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
};

/* =========================================================
   TOKENS: normalisation + recherche Scryfall (réutilisable)
   ========================================================= */

/** Normalise une carte Scryfall (token) vers le format local */
export function normalizeTokenCard(c){
  const face = Array.isArray(c.card_faces) && c.card_faces.length ? c.card_faces[0] : null;
  const uris  = c.image_uris || face?.image_uris || {};
  const imgSmall  = uris.small  ?? null;
  const imgNormal = uris.normal ?? imgSmall;
  return {
    id: c.id,
    name: c.printed_name || c.name,
    type: c.printed_type_line || c.type_line || '',
    imageSmall: imgSmall || null,
    imageNormal: imgNormal || null
  };
}

/**
 * Recherche de jetons via Scryfall.
 * - queryOrUrl : texte (ex: "Zombie") ou URL next_page
 * - isNext     : true si queryOrUrl est une URL de pagination
 *
 * Retourne { cards, hasMore, next, page }
 */
export async function scryfallTokenSearch(queryOrUrl, { isNext=false } = {}) {
  const CARD_LANG = 'fr';
  const makeUrl = (q) =>
    `https://api.scryfall.com/cards/search?order=name&unique=prints&q=${encodeURIComponent(q)}`;

  // fetch helper
  const fetchJson = async (u) => {
    try {
      const r = await fetch(u);
      const json = await r.json().catch(() => null);
      return { ok: r.ok, json, url: u };
    } catch {
      return { ok: false, json: null, url: u };
    }
  };
  const isEmpty = (resp) => {
    if (!resp || !resp.json) return true;
    if (resp.json.object === 'error') return true;
    return !(resp.json.data || []).length;
  };

  // Pagination direct
  if (isNext) {
    const resp = await fetchJson(queryOrUrl);
    if (!resp.ok || resp.json?.object === 'error') {
      return { cards: [], hasMore: false, next: null, page: queryOrUrl };
    }
    return {
      cards: (resp.json.data || []).map(normalizeTokenCard),
      hasMore: !!resp.json.has_more,
      next: resp.json.next_page || null,
      page: resp.url
    };
  }

  const q = String(queryOrUrl || '').trim();
  const nameFilter = q ? `(printed_name:"${q}" OR name:"${q}")` : '';

  // 1) Tokens FR
  const qTokensFr = `is:token -type:emblem lang:${CARD_LANG} ${nameFilter}`.trim();
  let resp = await fetchJson(makeUrl(qTokensFr));

  // 2) Tokens toutes langues (si aucun résultat)
  if (isEmpty(resp)) {
    const qTokensAny = `is:token -type:emblem ${nameFilter}`.trim();
    resp = await fetchJson(makeUrl(qTokensAny));
  }

  // Si pas de recherche (liste générale) : retourner tel quel
  if (!q) {
    if (!resp.ok || resp.json?.object === 'error') {
      return { cards: [], hasMore: false, next: null, page: resp?.url || null };
    }
    return {
      cards: (resp.json.data || []).map(normalizeTokenCard),
      hasMore: !!resp.json.has_more,
      next: resp.json.next_page || null,
      page: resp.url
    };
  }

  // 3) Cartes FR si pas de token trouvé
  if (isEmpty(resp)) {
    const qCardsFr = `lang:${CARD_LANG} ${nameFilter}`.trim();
    resp = await fetchJson(makeUrl(qCardsFr));
  }

  // 4) Cartes toutes langues
  if (isEmpty(resp)) {
    const qCardsAny = `${nameFilter}`.trim() || `"${q}"`;
    resp = await fetchJson(makeUrl(qCardsAny));
  }

  // 5) Match exact oracle
  if (isEmpty(resp)) {
    const qExact = `!"${q}"`;
    resp = await fetchJson(makeUrl(qExact));
  }

  if (!resp.ok || resp.json?.object === 'error') {
    return { cards: [], hasMore: false, next: null, page: resp?.url || null };
  }

  return {
    cards: (resp.json.data || []).map(normalizeTokenCard),
    hasMore: !!resp.json.has_more,
    next: resp.json.next_page || null,
    page: resp.url
  };
}

// ---------- Utilitaires UI ----------
function btn(label, cls='') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls || 'btn';
  b.textContent = label;
  return b;
}

// ---------- Hover utils (source/aperçu) ----------
let __pointer = { x: 0, y: 0 };
document.addEventListener('pointermove', (e) => {
  __pointer.x = e.clientX;
  __pointer.y = e.clientY;
}, { passive: true });

function isPointerInside(el){
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const x = __pointer.x, y = __pointer.y;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// ---------- Deck ----------
function makeDeck(cards) {
  let counter = 0;
  return cards.map(c => ({
    id: `${c.name}-${++counter}`,
    name: c.name,
    type: c.type,
    imageSmall: c.imageSmall || null,
    imageNormal: c.imageNormal || null
  }));
}
let _deck = makeDeck([
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
export const deck = () => _deck;

// ---------- Compteur de vie ----------
let _lifeTotal = 40;
export const lifeTotal = () => _lifeTotal;

export function updateLifeDisplay(){
  const el = qs('.zone--life .life-value');
  if (el) el.textContent = String(_lifeTotal);
}
export function setLife(n){
  if (!Number.isFinite(n)) return;
  n = Math.trunc(n);
  _lifeTotal = n;
  updateLifeDisplay();
}
export function changeLife(delta){
  setLife(_lifeTotal + Math.trunc(delta));
}

// ---------- Carte ----------
export function createCardEl(card, { faceDown=false, isToken=false, interactive=true } = {}) {
  const el = document.createElement('article');
  el.className = 'card' + (faceDown ? ' face-down' : '') + (isToken ? ' token' : '');
  el.draggable = !!interactive;
  el.dataset.cardId = card.id;
  el.tabIndex = 0;

  if (isToken) el.dataset.isToken = '1';

  if (card.imageSmall)  el.dataset.imageSmall  = card.imageSmall;
  if (card.imageNormal) el.dataset.imageNormal = card.imageNormal;

  const illust = card.imageSmall
    ? `<div class="card-illust">
         <img src="${card.imageSmall}" alt="${card.name}" loading="lazy" decoding="async">
       </div>`
    : '';

  el.innerHTML = `
    ${illust}
    <div class="card-name">${card.name}</div>
  `;

  if (interactive) attachCardListeners(el);
  return el;
}

// ---------- Aperçu au survol ----------
let __previewTimer = null;
let __previewDlg = null; // dialog d’aperçu
let __isMouseDown = false;
// Réf fiable vers la carte en cours de drag
let __draggingCardEl = null;

function showCardPreview(fromEl){
  if (__previewDlg && window.__previewSourceEl === fromEl) return;
  window.__previewSourceEl = fromEl;

  const name = fromEl.querySelector('.card-name')?.textContent || '';
  const type = fromEl.querySelector('.card-type')?.textContent || '';
  const imgSrc =
    fromEl.dataset.imageNormal ||
    fromEl.querySelector('.card-illust img')?.getAttribute('src') ||
    fromEl.dataset.imageSmall || null;

  if (!__previewDlg) {
    __previewDlg = document.createElement('dialog');
    __previewDlg.className = 'preview-dialog';
    __previewDlg.style.cssText = 'border:none; outline:none; padding:0; background:transparent; overflow:visible; width:100vw; height:100vh;';
    const style = document.createElement('style');
    style.textContent = `.preview-dialog::backdrop{background:transparent !important;}`;
    document.head.appendChild(style);
    __previewDlg.addEventListener('mousedown', () => { hideCardPreview(); });
    __previewDlg.addEventListener('cancel', (e) => { e.preventDefault(); hideCardPreview(); });
  }

  __previewDlg.innerHTML = '';
  const outer = document.createElement('div');
  outer.style.cssText = 'position:fixed; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none;';

  const cardWrap = document.createElement('div');
  cardWrap.style.cssText = 'pointer-events:auto; background:#fff; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.4); padding:12px; max-width:min(90vw,560px); width:min(90vw,560px); max-height:90vh; display:grid; gap:8px;';
  if (imgSrc) {
    const img = document.createElement('img');
    img.src = imgSrc; img.alt = name;
    img.style.cssText = 'width:100%; height:auto; object-fit:contain;';
    cardWrap.appendChild(img);
  }
  const title = document.createElement('div');
  title.textContent = name;
  title.style.cssText = 'font-size:clamp(20px,3.2vw,28px); font-weight:700;';
  cardWrap.appendChild(title);

  if (type) {
    const ty = document.createElement('div');
    ty.textContent = type;
    ty.style.cssText = 'opacity:.8; font-size:clamp(14px,2.2vw,18px);';
    cardWrap.appendChild(ty);
  }

  window.__previewHot = cardWrap;
  cardWrap.addEventListener('mouseleave', () => {
    setTimeout(() => { if (!isPointerInside(window.__previewSourceEl)) hideCardPreview(); }, 50);
  });

  outer.appendChild(cardWrap);
  __previewDlg.appendChild(outer);

  if (!__previewDlg.open) {
    document.body.appendChild(__previewDlg);
    __previewDlg.showModal();
  }

  __previewDlg.style.opacity = '0';
  __previewDlg.style.transition = 'opacity .12s ease-out';
  requestAnimationFrame(()=>{ __previewDlg.style.opacity = '1'; });
}

function hideCardPreview(){
  if (__previewDlg?.open) {
    __previewDlg.style.opacity = '0';
    setTimeout(() => {
      try { __previewDlg.close(); } catch(e){}
      __previewDlg.remove();
      __previewDlg = null;
      window.__previewHot = null;
      window.__previewSourceEl = null;
    }, 120);
  }
}

/** ✅ Export utilitaire : attache UNIQUEMENT les listeners d’aperçu au survol (pas de drag, pas de clic).
 *  À utiliser côté app-multi.js sur les cartes readonly (adversaire).
 */
export function attachPreviewListeners(cardEl){
  if (!cardEl) return;
  cardEl.addEventListener('mousedown', () => { __isMouseDown = true; clearTimeout(__previewTimer); hideCardPreview(); });
  cardEl.addEventListener('mouseup',   () => { __isMouseDown = false; });

  cardEl.addEventListener('mouseenter', () => {
    clearTimeout(__previewTimer);
    __previewTimer = setTimeout(() => {
      if (__previewDlg && window.__previewSourceEl === cardEl) return;
      if (!__isMouseDown && cardEl.matches(':hover')) showCardPreview(cardEl);
    }, 750);
  });

  cardEl.addEventListener('mouseleave', () => {
    clearTimeout(__previewTimer);
    setTimeout(() => { if (!isPointerInside(cardEl)) hideCardPreview(); }, 20);
  });
}

// ---------- Stores cachés ----------
export const exileStore = [];
export const graveyardStore = [];

function cardElToObj(el){
  return {
    id: el.dataset.cardId,
    name: el.querySelector('.card-name')?.textContent || '',
    type: el.querySelector('.card-type')?.textContent || '',
    imageSmall: el.dataset.imageSmall || null,
    imageNormal: el.dataset.imageNormal || null,
    tapped: el.classList.contains('tapped'),
    phased: el.classList.contains('phased'),
    faceDown: el.classList.contains('face-down'),
    isToken: el.dataset.isToken === '1'
  };
}

// ---------- Listeners carte (interactives locales) ----------
function attachCardListeners(cardEl) {
  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);
  cardEl.addEventListener('dblclick', () => toggleTappedOn(cardEl));
  cardEl.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 't') toggleTappedOn(cardEl); });

  // triple clic = phased
  let clicks = 0, last = 0, timer=null;
  cardEl.addEventListener('click', () => {
    hideCardPreview();
    const now = Date.now();
    if (now - last < 350) { clicks++; } else { clicks = 1; }
    last = now;
    clearTimeout(timer);
    timer = setTimeout(() => { if (clicks >= 3) togglePhased(cardEl); clicks=0; }, 360);
  });

  // 🔎 même logique d’aperçu que les readonly
  attachPreviewListeners(cardEl);
}

export function toggleTappedOn(cardEl) { if (cardEl.closest('.zone--bataille')) cardEl.classList.toggle('tapped'); }
export function togglePhased(cardEl)   { if (cardEl.closest('.zone--bataille')) cardEl.classList.toggle('phased'); }

/** 🔁 Untap all — dégager toutes les cartes du joueur local (champ de bataille + command zone) */
export function untapAllLocal(){
  const root = qs('main.board') || document; // on reste dans le plateau local
  root.querySelectorAll('.zone--bataille .card.tapped, .zone--commander .card.tapped')
      .forEach(el => el.classList.remove('tapped'));
}

// ---------- DnD ----------
function handleDragStart(e) {
  const el = e.currentTarget;
  el.classList.add('dragging');
  __draggingCardEl = el; // garder une ref sûre
  e.dataTransfer.setData('text/plain', el.dataset.cardId || '');
}
function handleDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  __draggingCardEl = null; // libérer la ref
  __isMouseDown = false;
  hideCardPreview();
}
function onZoneDragOver(e)  { e.preventDefault(); e.currentTarget.classList.add('over'); }
function onZoneDragLeave(e) { e.currentTarget.classList.remove('over'); }
function resolveDropContainer(zone) { return zone.classList.contains('battle-row') ? qs('.cards', zone) : zone.querySelector('.cards') || zone; }
function onZoneDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  const zone = e.currentTarget;
  zone.classList.remove('over');

  // Récupération robuste de la carte
  const cardId = e.dataTransfer.getData('text/plain');
  let card = null;
  if (cardId) card = document.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`);
  if (!card) card = document.querySelector('.card.dragging');
  if (!card) card = __draggingCardEl;
  if (!card) return;

  const zoneType = zone.dataset.zone;

  // Jeton ?
  const isToken = card.dataset.isToken === '1';

  // Drop dans la PIOCHE → remettre la carte au-dessus du deck
  if (zoneType === ZONES.PIOCHE) {
    if (!isToken) {
      const obj = cardElToObj(card);
      // haut du deck = fin du tableau (spawnTopCardForDrag() fait _deck.pop())
      _deck.push({
        id: obj.id,
        name: obj.name,
        type: obj.type || '',
        imageSmall: obj.imageSmall || null,
        imageNormal: obj.imageNormal || null
      });
      updateDeckCount();
    }
    try { card.remove(); } catch {}
    return;
  }

  // Exil : les jetons disparaissent, sinon stockés dans le store
  if (zoneType === ZONES.EXIL) {
    if (isToken) { try { card.remove(); } catch {} return; }
    exileStore.push(cardElToObj(card));
    try { card.remove(); } catch {}
    return;
  }

  // Cimetière : les jetons disparaissent, sinon stockés dans le store
  if (zoneType === ZONES.CIMETIERE) {
    if (isToken) { try { card.remove(); } catch {} return; }
    graveyardStore.push(cardElToObj(card));
    try { card.remove(); } catch {}
    return;
  }

  // Comportement par défaut : déposer la carte visuellement dans la zone
  resolveDropContainer(zone).appendChild(card);
  if (card.classList.contains('face-down')) card.classList.remove('face-down');
  if ([ZONES.MAIN, ZONES.CIMETIERE, ZONES.EXIL, ZONES.COMMANDER].includes(zoneType)) {
    card.classList.remove('tapped','phased');
  }
}

// ---------- Pioche ----------
function updateDeckCount() { const c=qs('.zone--pioche .deck-count [data-count]'); if(c) c.textContent=_deck.length; }
export function spawnTopCardForDrag() {
  if (_deck.length === 0) return;
  const top = _deck.pop();
  updateDeckCount();
  const hand = qs('.zone--main .cards--hand') || qs('.zone--main .cards');
  const el = createCardEl(top, { faceDown: false });
  hand.appendChild(el);
  el.scrollIntoView({ block: 'nearest', inline: 'end', behavior: 'smooth' });
}

// ---------- Helpers titre modale ----------
function setSearchTitle(txt){ const t = qs('.search-title'); if (t) t.textContent = txt; }

// ---------- Recherche (bibliothèque) ----------
export function openSearchModal() {
  const dialog = qs('.modal-search'); if (!dialog) return;
  const input = qs('.search-input', dialog);
  const results = qs('.search-results', dialog);
  const shuffle = qs('.btn-shuffle', dialog);
  if (shuffle) shuffle.style.display = '';
  if (results) results.innerHTML = '';

  // ✅ bouton de fermeture (si présent dans le HTML)
  const btnClose = qs('.btn-close, .btn-close-search, .btn-cancel', dialog);
  if (btnClose) btnClose.onclick = () => { try { dialog.close(); } catch {} };

  setSearchTitle('Recherche dans la bibliothèque');

  [..._deck].slice().reverse().forEach(c => {
    const item = document.createElement('div');
    item.className = 'result-card';
    item.dataset.cardId = c.id;
    // ✅ Alimente l’aperçu
    if (c.imageNormal) item.dataset.imageNormal = c.imageNormal;
    if (c.imageSmall)  item.dataset.imageSmall  = c.imageSmall;

    item.innerHTML = `
      <span>
        <strong class="card-name">${c.name}</strong>
        <em class="card-type">${c.type || ''}</em>
      </span>
      <button class="btn-piocher" type="button">Piocher</button>
    `;

    // ✅ Aperçu au survol de la ligne
    attachPreviewListeners(item);

    item.querySelector('.btn-piocher')?.addEventListener('click', () => {
      const idx = _deck.findIndex(d => d.id === c.id);
      if (idx !== -1) {
        const picked = _deck.splice(idx, 1)[0];
        updateDeckCount();
        const hand = qs('.zone--main .cards--hand') || qs('.zone--main .cards');
        hand.appendChild(createCardEl(picked, { faceDown: false }));
        hand.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'end', behavior: 'smooth' });
      }
      item.remove();
    });
    results?.appendChild(item);
  });

  if (input) {
    input.value = '';
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      Array.from(results?.children || []).forEach(el => {
        const txt = el.textContent.toLowerCase();
        el.style.display = txt.includes(q) ? '' : 'none';
      });
    };
  }

  const btnShuffle = qs('.btn-shuffle', dialog);
  if (btnShuffle) {
    // Mélange puis ré-ouvre la liste (deck mélangé, modale conservée)
    btnShuffle.onclick = () => { shuffleDeck(); openSearchModal(); };
  }

  // (optionnel) Si tu as un bouton dédié "mélanger & fermer"
  const btnShuffleClose = qs('.btn-shuffle-close', dialog);
  if (btnShuffleClose) {
    btnShuffleClose.onclick = () => { shuffleDeck(); try { dialog.close(); } catch {} };
  }

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', 'true');
}

// ---------- Recherche (EXIL) ----------
export function openExileSearchModal() {
  const dialog = qs('.modal-search'); if (!dialog) return;
  const input = qs('.search-input', dialog);
  const results = qs('.search-results', dialog);
  const shuffleBtn = qs('.btn-shuffle', dialog);

  if (results) results.innerHTML = '';
  if (shuffleBtn) shuffleBtn.style.display = 'none';

  setSearchTitle('Recherche dans l’exil');

  [...exileStore].slice().reverse().forEach((c) => {
    const item = document.createElement('div');
    item.className = 'result-card';
    item.dataset.cardId = c.id;
    // ✅ données pour aperçu
    if (c.imageNormal) item.dataset.imageNormal = c.imageNormal;
    if (c.imageSmall)  item.dataset.imageSmall  = c.imageSmall;

    item.innerHTML = `
      <span>
        <strong class="card-name">${c.name}</strong>
        <em class="card-type">${c.type || ''}</em>
      </span>
      <button class="btn-piocher" type="button">Piocher</button>
    `;

    // ✅ aperçu au survol
    attachPreviewListeners(item);

    item.querySelector('.btn-piocher')?.addEventListener('click', () => {
      const realIdx = exileStore.findIndex(x => x.id === c.id);
      if (realIdx !== -1) {
        const picked = exileStore.splice(realIdx, 1)[0];
        const hand = qs('.zone--main .cards--hand') || qs('.zone--main .cards');
        hand.appendChild(createCardEl({
          id: picked.id, name: picked.name, type: picked.type,
          imageSmall: picked.imageSmall, imageNormal: picked.imageNormal
        }, { faceDown: false }));
        hand.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'end', behavior: 'smooth' });
      }
      item.remove();
    });

    results?.appendChild(item);
  });

  if (input) {
    input.value = '';
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      Array.from(results?.children || []).forEach(el => {
        const txt = el.textContent.toLowerCase();
        el.style.display = txt.includes(q) ? '' : 'none';
      });
    };
  }

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', 'true');

  if (shuffleBtn) setTimeout(() => { shuffleBtn.style.display = ''; }, 0);
}

// ---------- Recherche (CIMETIÈRE) ----------
export function openGraveyardSearchModal() {
  const dialog = qs('.modal-search'); if (!dialog) return;
  const input = qs('.search-input', dialog);
  const results = qs('.search-results', dialog);
  const shuffleBtn = qs('.btn-shuffle', dialog);

  if (results) results.innerHTML = '';
  if (shuffleBtn) shuffleBtn.style.display = 'none';

  setSearchTitle('Recherche dans le cimetière');

  [...graveyardStore].slice().reverse().forEach((c) => {
    const item = document.createElement('div');
    item.className = 'result-card';
    item.dataset.cardId = c.id;
    // ✅ données pour aperçu
    if (c.imageNormal) item.dataset.imageNormal = c.imageNormal;
    if (c.imageSmall)  item.dataset.imageSmall  = c.imageSmall;

    item.innerHTML = `
      <span>
        <strong class="card-name">${c.name}</strong>
        <em class="card-type">${c.type || ''}</em>
      </span>
      <button class="btn-piocher" type="button">Piocher</button>
    `;

    // ✅ aperçu au survol
    attachPreviewListeners(item);

    item.querySelector('.btn-piocher')?.addEventListener('click', () => {
      const realIdx = graveyardStore.findIndex(x => x.id === c.id);
      if (realIdx !== -1) {
        const picked = graveyardStore.splice(realIdx, 1)[0];
        const hand = qs('.zone--main .cards--hand') || qs('.zone--main .cards');
        hand.appendChild(createCardEl({
          id: picked.id, name: picked.name, type: picked.type,
          imageSmall: picked.imageSmall, imageNormal: picked.imageNormal
        }, { faceDown: false }));
        hand.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'end', behavior: 'smooth' });
      }
      item.remove();
    });

    results?.appendChild(item);
  });

  if (input) {
    input.value = '';
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      Array.from(results?.children || []).forEach(el => {
        const txt = el.textContent.toLowerCase();
        el.style.display = txt.includes(q) ? '' : 'none';
      });
    };
  }

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', 'true');

  if (shuffleBtn) setTimeout(() => { shuffleBtn.style.display = ''; }, 0);
}

/* ===== TOKENS (Scryfall) =====
   Version utilisant scryfallTokenSearch() défini plus haut
   - même fenêtre (dimensions/styles) que app.js
   - clic "Ajouter au plateau" → demande quantité → placement auto équilibré
*/
function askTokenQuantityAndAdd(card){
  const dlg = document.createElement('dialog');
  dlg.className = 'modal-token-qty';
  dlg.innerHTML = `
    <form method="dialog" style="min-width:320px; padding:16px; display:grid; gap:12px;">
      <h3 style="margin:0">Ajouter des jetons</h3>
      <div>
        <label>Combien de “${card.name}” ?</label>
        <input type="number" min="1" value="1" style="width:100%; padding:8px">
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button value="cancel" class="btn btn-secondary">Annuler</button>
        <button value="ok" class="btn btn-primary">Ajouter</button>
      </div>
    </form>
  `;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') {
      const n = Math.max(1, Math.trunc(Number(dlg.querySelector('input')?.value || 1)));
      placeTokenCopies(card, n);
    }
    dlg.remove();
  });
  dlg.showModal();
}

function placeTokenCopies(card, n){
  // Placement sur les 3 rangées du champ de bataille — équilibré
  const rows = qsa('.zone--bataille .battle-row .cards');
  if (!rows.length) return;
  const counts = rows.map(r => r.querySelectorAll('.card').length);
  for (let i = 0; i < n; i++){
    const minCount = Math.min(...counts);
    const idx = counts.indexOf(minCount);
    const holder = rows[idx];
    const el = createCardEl(
      { id: `${card.id}-token-${randomId().slice(0,8)}`,
        name: card.name, type: card.type,
        imageSmall: card.imageSmall || null, imageNormal: card.imageNormal || null
      },
      { isToken:true, faceDown:false, interactive:true }
    );
    holder.appendChild(el);
    counts[idx]++;
  }
}

export async function openTokenDialog(){
  const dlg = document.getElementById('tokenDialog');
  if (!dlg) { alert('Dialog de tokens introuvable dans le HTML.'); return; }

  // Styles de la fenêtre identiques à app.js (injectés une seule fois)
  if (!document.getElementById('tokenDialogStyles')){
    const st = document.createElement('style');
    st.id = 'tokenDialogStyles';
    st.textContent = `
      #tokenDialog::backdrop{ background:rgba(0,0,0,.45); }
      .token-sheet{ background:#fff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.35); padding:16px; width:min(1200px,95vw); max-height:92vh; display:grid; grid-template-rows:auto auto 1fr auto; gap:12px; }
      .token-header{ display:flex; gap:8px; align-items:center; justify-content:space-between; }
      .token-searchbar{ display:flex; gap:8px; align-items:center; }
      .token-results{ overflow:auto; display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
      .token-pager{ display:flex; justify-content:space-between; gap:8px; }
      .token-close{ padding:6px 10px; }
      .token-input{ flex:1; padding:8px; border:1px solid #ddd; border-radius:8px; }
    `;
    document.head.appendChild(st);
  }

  const input   = dlg.querySelector('#tokenQuery');
  const btnGo   = dlg.querySelector('#tokenSearchBtn');
  const btnX    = dlg.querySelector('#tokenCloseBtn');
  const results = dlg.querySelector('.token-results');
  const pager   = dlg.querySelector('.token-pager');

  let nextPage = null;
  let prevStack = [];
  let currentPageUrl = null;

  function render(list, hasMore, next){
    results.innerHTML = '';
    pager.innerHTML = '';

    if (!list.length){
      results.innerHTML = `<div style="opacity:.7;padding:8px">Aucun résultat</div>`;
      return;
    }

    list.forEach(c=>{
      const item = document.createElement('article');
      item.className = 'token-item';
      item.style.cssText = 'display:grid; gap:6px; border:1px solid #ddd; border-radius:10px; padding:8px;';
      if (c.imageNormal) item.dataset.imageNormal = c.imageNormal;
      if (c.imageSmall)  item.dataset.imageSmall  = c.imageSmall;

      const head = document.createElement('div');
      head.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';

      const title = document.createElement('div');
      title.innerHTML = `<strong class="card-name">${c.name}</strong><div class="card-type" style="opacity:.75">${c.type||''}</div>`;

      const actions = document.createElement('div');
      const add = document.createElement('button');
      add.type='button';
      add.className='btn-primary';
      add.textContent='Ajouter au plateau';
      add.addEventListener('click', ()=> askTokenQuantityAndAdd(c));
      actions.appendChild(add);

      head.appendChild(title);
      head.appendChild(actions);
      item.appendChild(head);

      if (c.imageSmall){
        const img = document.createElement('img');
        img.src = c.imageSmall; img.alt = c.name; img.loading = 'lazy'; img.decoding = 'async';
        img.style.cssText = 'width:100%;border-radius:8px;';
        item.appendChild(img);
      }

      // aperçu au survol
      attachPreviewListeners(item);

      results.appendChild(item);
    });

    // Pager
    if (prevStack.length > 0 || hasMore){
      const row = document.createElement('div'); row.style.cssText='display:flex; gap:8px; justify-content:space-between; padding-top:8px;';
      const bPrev = document.createElement('button'); bPrev.className='btn-secondary'; bPrev.textContent='← Précédent';
      const bNext = document.createElement('button'); bNext.className='btn-primary';   bNext.textContent='Suivant →';
      bPrev.disabled = prevStack.length === 0;
      bNext.disabled = !hasMore;

      bPrev.onclick = async ()=>{
        if (prevStack.length === 0) return;
        const prevUrl = prevStack.pop();
        const res = await scryfallTokenSearch(prevUrl, { isNext:true });
        currentPageUrl = res.page;
        nextPage = res.next;
        render(res.cards, res.hasMore, res.next);
      };
      bNext.onclick = async ()=>{
        if (!next) return;
        if (currentPageUrl) prevStack.push(currentPageUrl);
        const res = await scryfallTokenSearch(next, { isNext:true });
        currentPageUrl = res.page;
        nextPage = res.next;
        render(res.cards, res.hasMore, res.next);
      };

      row.appendChild(bPrev); row.appendChild(bNext);
      pager.appendChild(row);
    }
  }

  async function run(q){
    prevStack = [];
    currentPageUrl = null;
    const res = await scryfallTokenSearch((q || '').trim());
    currentPageUrl = res.page;
    nextPage = res.next;
    render(res.cards, res.hasMore, res.next);
  }

  if (!dlg.hasAttribute('data-wired')){
    btnGo?.addEventListener('click', ()=> run(input?.value.trim() || ''));
    input?.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); run(input.value.trim()); }});
    btnX?.addEventListener('click', ()=> dlg.close());
    dlg.setAttribute('data-wired','1');
  }

  input && (input.value = '');
  results && (results.innerHTML = '');
  pager && (pager.innerHTML = '');

  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open','true');
  setTimeout(()=> input?.focus(), 0);

  // Premier chargement : liste FR (tous tokens triés par nom)
  run('');
}

// ---------- SCRY ----------
function openScryPrompt(){
  if (_deck.length === 0) { alert("La bibliothèque est vide."); return; }

  const dlg = document.createElement('dialog');
  dlg.className = 'modal-scry-ask';
  dlg.innerHTML = `
    <form method="dialog" style="min-width: 320px; padding: 16px; display:grid; gap:12px">
      <h3 style="margin:0">Scry — combien ?</h3>
      <div>
        <input type="number" min="1" max="${_deck.length}" value="1" style="width:100%; padding:8px" aria-label="Nombre de cartes à regarder">
        <small style="opacity:.7">Max : ${_deck.length} (cartes restantes)</small>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end">
        <button value="cancel" class="btn btn-cancel">Annuler</button>
        <button value="ok" class="btn btn-primary">Valider</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') {
      const n = Math.max(1, Math.min(_deck.length, parseInt(dlg.querySelector('input').value || '1',10)));
      dlg.remove();
      openScryDialog(n);
    } else {
      dlg.remove();
    }
  });
  dlg.showModal();
}

function openScryDialog(n){
  const looked = _deck.splice(_deck.length - n, n);
  updateDeckCount();

  const src = looked.slice().reverse();
  const toTop = [];
  const toBottom = [];

  const dlg = document.createElement('dialog');
  dlg.className = 'modal-scry';
  dlg.style.padding = '0';
  dlg.innerHTML = `
    <div style="padding:16px; display:grid; gap:12px; width:min(960px, 95vw);">
      <h3 style="margin:0">Scry — organiser l’ordre</h3>
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px; align-items:start;">
        <section style="display:grid; gap:8px;">
          <header style="display:flex; justify-content:space-between; align-items:center;">
            <strong>Cartes regardées (${n})</strong>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn-src-to-top">Mettre tout ↑</button>
              <button type="button" class="btn-src-to-bottom">Mettre tout ↓</button>
            </div>
          </header>
          <div class="scry-list scry-src" style="display:grid; gap:6px;"></div>
        </section>

        <section style="display:grid; gap:8px;">
          <header><strong>Dessus de pioche</strong> <small style="opacity:.7; display:block">La 1ʳᵉ ici sera piochée en premier</small></header>
          <div class="scry-list scry-top" style="display:grid; gap:6px; min-height:48px;"></div>
        </section>

        <section style="display:grid; gap:8px;">
          <header><strong>Dessous de pioche</strong> <small style="opacity:.7; display:block">La 1ʳᵉ ici sera la plus proche du dessus</small></header>
          <div class="scry-list scry-bottom" style="display:grid; gap:6px; min-height:48px;"></div>
        </section>
      </div>

      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button type="button" class="btn-cancel">Annuler</button>
        <button type="button" class="btn-validate">Valider le scry</button>
      </div>
    </div>
  `;
  document.body.appendChild(dlg);

  const wrapSrc   = dlg.querySelector('.scry-src');
  const wrapTop   = dlg.querySelector('.scry-top');
  const wrapBottom= dlg.querySelector('.scry-bottom');

  function renderReorderable(wrap, arr) {
    wrap.innerHTML = '';
    if (arr.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px; opacity:.7; border:1px dashed #ccc; border-radius:8px; text-align:center;';
      empty.textContent = 'Aucune carte';
      wrap.appendChild(empty);
      return;
    }
    arr.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'scry-row';
      row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px; border:1px solid #ddd; border-radius:8px;';
      if (c.imageNormal) row.dataset.imageNormal = c.imageNormal;
      if (c.imageSmall)  row.dataset.imageSmall  = c.imageSmall;

      const up = btn('↑','btn btn-up'); up.title = 'Remonter';
      const down = btn('↓','btn btn-down'); down.title = 'Descendre';
      const name = document.createElement('span'); name.textContent = c.name || '(Carte)'; name.className = 'card-name'; name.style.flex = '1';
      const type = document.createElement('span'); type.textContent = c.type || ''; type.className = 'card-type'; type.style.opacity = '.75';
      const back = btn('↩ Source','btn');

      up.onclick = () => { if (i>0) { [arr[i-1], arr[i]] = [arr[i], arr[i-1]]; renderAll(); } };
      down.onclick = () => { if (i<arr.length-1) { [arr[i+1], arr[i]] = [arr[i], arr[i+1]]; renderAll(); } };
      back.onclick = () => { const x = arr.splice(i,1)[0]; src.push(x); renderAll(); };

      // aperçu survol pour les lignes scry (même logique)
      attachPreviewListeners(row);

      row.appendChild(up);
      row.appendChild(down);
      row.appendChild(name);
      row.appendChild(type);
      row.appendChild(back);
      wrap.appendChild(row);
    });
  }

  function renderSrc(){
    wrapSrc.innerHTML = '';
    if (src.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px; opacity:.7; border:1px dashed #ccc; border-radius:8px; text-align:center;';
      empty.textContent = 'Aucune carte';
      wrapSrc.appendChild(empty);
      return;
    }
    src.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'scry-row';
      row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px; border:1px solid #ddd; border-radius:8px;';
      if (c.imageNormal) row.dataset.imageNormal = c.imageNormal;
      if (c.imageSmall)  row.dataset.imageSmall  = c.imageSmall;

      const name = document.createElement('span');
      name.textContent = c.name || '(Carte)';
      name.className = 'card-name';
      name.style.flex = '1';

      const type = document.createElement('span');
      type.textContent = c.type || '';
      type.className = 'card-type';
      type.style.opacity = '.75';

      const toTopBtn = btn('→ Haut','btn');
      const toBottomBtn = btn('→ Bas','btn');
      toTopBtn.onclick = () => { const x = src.splice(i,1)[0]; toTop.push(x); renderAll(); };
      toBottomBtn.onclick = () => { const x = src.splice(i,1)[0]; toBottom.push(x); renderAll(); };

      // aperçu survol
      attachPreviewListeners(row);

      row.appendChild(name);
      row.appendChild(type);
      row.appendChild(toTopBtn);
      row.appendChild(toBottomBtn);
      wrapSrc.appendChild(row);
    });
  }

  function renderAll(){ renderSrc(); renderReorderable(wrapTop, toTop); renderReorderable(wrapBottom, toBottom); }

  dlg.querySelector('.btn-src-to-top')?.addEventListener('click', () => { toTop.push(...src.splice(0)); renderAll(); });
  dlg.querySelector('.btn-src-to-bottom')?.addEventListener('click', () => { toBottom.push(...src.splice(0)); renderAll(); });

  dlg.querySelector('.btn-cancel')?.addEventListener('click', () => {
    _deck.push(...looked);
    updateDeckCount();
    dlg.close('cancel');
  });

  dlg.querySelector('.btn-validate')?.addEventListener('click', () => {
    if (toBottom.length) _deck.unshift(...toBottom.slice().reverse());
    const topReversed = toTop.slice().reverse();
    _deck.push(...topReversed);
    const srcReversed = src.slice().reverse();
    _deck.push(...srcReversed);
    updateDeckCount();
    dlg.close('ok');
  });

  dlg.addEventListener('close', () => { dlg.remove(); });
  dlg.showModal();
  renderAll();
}

// Fermeture auto de l’aperçu si on sort de la source
document.addEventListener('pointermove', () => {
  if (__previewDlg && window.__previewSourceEl && !isPointerInside(window.__previewSourceEl)) {
    hideCardPreview();
  }
}, { passive: true });

export function shuffleDeck() {
  // ✅ garde-fou + compteur mis à jour
  if (!Array.isArray(_deck)) _deck = [];
  for (let i = _deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [_deck[i], _deck[j]] = [_deck[j], _deck[i]];
  }
  // MAJ affichage du nombre de cartes
  const c = qs('.zone--pioche .deck-count [data-count]');
  if (c) c.textContent = _deck.length;
}

/* =======================
   PERSISTANCE D’ÉTAT JEU
   ======================= */

const PERSIST_KEY = 'mtg.persist.state';

function cardObj(c){
  return {
    id: c.id, name: c.name, type: c.type || '',
    imageSmall: c.imageSmall || null, imageNormal: c.imageNormal || null,
    tapped: !!c.tapped, phased: !!c.phased, faceDown: !!c.faceDown, isToken: !!c.isToken
  };
}

export function serializeBoard(){
  const root = qs('main.board') || document;

  const cardToObj = (el) => ({
    id: el.dataset.cardId,
    name: el.querySelector('.card-name')?.textContent || '',
    type: el.querySelector('.card-type')?.textContent || '',
    imageSmall: el.dataset.imageSmall || null,
    imageNormal: el.dataset.imageNormal || null,
    tapped: el.classList.contains('tapped'),
    phased: el.classList.contains('phased'),
    faceDown: el.classList.contains('face-down'),
    isToken: el.dataset.isToken === '1'
  });

  const simpleZone = (sel) =>
    Array.from(root.querySelectorAll(sel + ' .cards .card')).map(cardToObj);

  const battlefield = Array.from(
    root.querySelectorAll('.zone--bataille .battle-row')
  ).map(row =>
    Array.from(row.querySelectorAll('.cards .card')).map(cardToObj)
  );

  return {
    ts: Date.now(),
    life: _lifeTotal,
    zones: {
      pioche:    simpleZone('.zone--pioche'),
      commander: simpleZone('.zone--commander'),
      cimetiere: simpleZone('.zone--cimetiere'),
      exil:      simpleZone('.zone--exil'),
      main:      simpleZone('.zone--main'),
      bataille:  battlefield
    },
    stores: {
      exil: exileStore.map(x => ({ ...x })),
      cimetiere: graveyardStore.map(x => ({ ...x }))
    },
    deck: _deck.map(cardObj) // ordre complet (haut = fin du tableau)
  };
}

export function restoreBoard(state){
  if (!state || typeof state !== 'object') return false;

  // Vie
  _lifeTotal = Number.isFinite(state.life) ? Math.trunc(state.life) : 40;
  updateLifeDisplay();

  // Stores (cachés)
  exileStore.splice(0, exileStore.length, ...((state.stores?.exil) || []));
  graveyardStore.splice(0, graveyardStore.length, ...((state.stores?.cimetiere) || []));

  // Deck (ordre complet)
  if (Array.isArray(state.deck)) {
    _deck = state.deck.map(cardObj);
  }
  updateDeckCount();

  // Helper DOM reset
  const clearZone = (sel) => { const z = qs(sel); const holder = z?.querySelector('.cards') || z; if (holder) holder.innerHTML = ''; };
  const pushTo = (sel, list=[]) => {
    const holder = qs(sel)?.querySelector('.cards') || qs(sel);
    if (!holder) return;
    list.forEach(c => {
      const el = createCardEl(c, { faceDown: !!c.faceDown, isToken: !!c.isToken, interactive:true });
      el.classList.toggle('tapped', !!c.tapped);
      el.classList.toggle('phased', !!c.phased);
      holder.appendChild(el);
    });
  };

  // Clear zones
  ['.zone--commander','.zone--cimetiere','.zone--exil','.zone--main'].forEach(clearZone);
  qsa('.zone--bataille .battle-row .cards').forEach(h => h.innerHTML='');

  // Rebuild Commander/Main/Exil/Cimetière depuis state.zones
  pushTo('.zone--commander', state.zones?.commander || []);
  pushTo('.zone--cimetiere', state.zones?.cimetiere || []);
  pushTo('.zone--exil',      state.zones?.exil || []);
  pushTo('.zone--main',      state.zones?.main || []);

  // Battlefield (3 rangées)
  const rows = (state.zones?.bataille || []);
  rows.forEach((rowCards, i) => {
    const holder = qs(`.zone--bataille .battle-row[data-subrow="${i+1}"] .cards`);
    if (!holder) return;
    (rowCards || []).forEach(c => {
      const el = createCardEl(c, { faceDown: !!c.faceDown, isToken: !!c.isToken, interactive:true });
      el.classList.toggle('tapped', !!c.tapped);
      el.classList.toggle('phased', !!c.phased);
      holder.appendChild(el);
    });
  });

  return true;
}

function savePersistentState(){
  try { localStorage.setItem(PERSIST_KEY, JSON.stringify(serializeBoard())); }
  catch(e){ console.warn('Persist save error', e); }
}
function tryRestorePersistentState(){
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    return restoreBoard(state);
  } catch(e){
    console.warn('Persist restore error', e);
    return false;
  }
}

// ---------- Deck depuis localStorage (builder) ----------
function tryLoadDeckFromLocalStorage(){
  const raw = localStorage.getItem('mtg.deck');
  if (!raw) return false;
  try {
    const payload = JSON.parse(raw);
    _deck = [];
    let counter = 0;

    (payload.cards || []).forEach(c => {
      const qty = Math.max(0, Number(c.qty || 0));
      for (let i = 0; i < qty; i++) {
        _deck.push({
          id: `${(c.id || c.name)}-${++counter}`,
          name: c.name,
          type: c.type || '',
          imageSmall: c.imageSmall || null,
          imageNormal: c.imageNormal || c.image || null
        });
      }
    });

    // Commander zone depuis le builder
    const cmdZone = qs('.zone--commander .cards');
    if (cmdZone) {
      cmdZone.innerHTML = '';
      (payload.commanders || []).forEach(c => {
        const el = createCardEl({
          id: `${(c.id || c.name)}-cmd-${Math.random().toString(36).slice(2,7)}`,
          name: c.name,
          type: c.type || '',
          imageSmall: c.imageSmall || null,
          imageNormal: c.imageNormal || c.image || null
        });
        el.classList.remove('tapped','phased','face-down');
        cmdZone.appendChild(el);
      });
    }

    updateDeckCount();

    // Consommer l’import builder
    localStorage.removeItem('mtg.deck');
    return true;
  } catch(e){
    console.error('Deck import error:', e);
    return false;
  }
}

/* =======================
   INIT + PERSIST HOOKS
   ======================= */

// Sécurité : si on relâche la souris ailleurs, on réactive le survol
document.addEventListener('mouseup', () => { __isMouseDown = false; });

export function initCore(){
  // 1) Tenter la restauration complète
  const restored = tryRestorePersistentState();

  if (restored) {
    // ⚠️ État persistant présent MAIS deck vide → tenter l’import deck builder
    if (_deck.length === 0) {
      const imported = tryLoadDeckFromLocalStorage();
      if (imported) {
        updateDeckCount();
        // Sauvegarder immédiatement le nouvel état
        savePersistentState();
      }
    }
  } else {
    // 2) Pas d’état persistant → tenter l’import deck builder
    const imported = tryLoadDeckFromLocalStorage();
    updateDeckCount();
    if(!imported){
      // 3) Fallback de démo si rien à importer
      const main = qs('[data-zone="main"] .cards');
      ['Éclair','Forêt','Ours runegrave'].forEach(name=>{
        const f = _deck.find(c=>c.name===name); if(f) main.appendChild(createCardEl(f));
      });
    }

    // ✅ Mélange automatique une seule fois au démarrage d’une nouvelle partie
    try {
      const alreadyShuffled = sessionStorage.getItem('mtg.shuffleOnce') === '1';
      if (!alreadyShuffled && _deck.length > 0) {
        shuffleDeck();
        sessionStorage.setItem('mtg.shuffleOnce', '1');
        updateDeckCount();
      }
    } catch {}
  }

  // DnD zones
  qsa('.dropzone, .battle-row').forEach(z=>{
    z.addEventListener('dragover',onZoneDragOver);
    z.addEventListener('dragleave',onZoneDragLeave);
    z.addEventListener('drop',onZoneDrop);
  });
  qs('.btn-draw')?.addEventListener('click',spawnTopCardForDrag);

  // Vie
  qs('.zone--life .btn-life-plus')?.addEventListener('click', () => changeLife(1));
  qs('.zone--life .btn-life-minus')?.addEventListener('click', () => changeLife(-1));
  qs('.zone--life .life-value')?.addEventListener('click', () => {
    const cur = _lifeTotal;
    const raw = prompt('Définir les points de vie (entier) :', String(cur));
    if (raw === null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || !/^-?\d+$/.test(String(raw).trim())) {
      alert('Veuillez entrer un entier.');
      return;
    }
    setLife(n);
  });
  updateLifeDisplay();

  // Actions globales
  document.addEventListener('click', (ev) => {
    const el = ev.target;
    if (!el || typeof el.closest !== 'function') return;

    if (el.closest('.zone--pioche .btn-search')) { openSearchModal(); return; }
    if (el.closest('.zone--pioche .btn-scry'))   { openScryPrompt(); return; }
    if (el.closest('.btn-search-exile'))         { openExileSearchModal(); return; }
    if (el.closest('.btn-search-graveyard'))     { openGraveyardSearchModal(); return; }
    if (el.closest('.btn-search-tokens'))        { openTokenDialog(); return; }
  });

  // 🔁 Bouton "Untap all" (défini dans le HTML via .btn-untap-all)
  qs('.btn-untap-all')?.addEventListener('click', untapAllLocal);

  // Boutons loupe (si absents)
  const exilTitle = qs('.zone--exil .zone-title');
  if (exilTitle && !qs('.zone--exil .btn-search-exile')) {
    const btnLoupe = document.createElement('button');
    btnLoupe.className = 'btn-search btn-search-exile';
    btnLoupe.title = 'Chercher dans l’exil';
    btnLoupe.setAttribute('aria-label','Chercher dans l’exil');
    btnLoupe.style.marginLeft = '6px';
    btnLoupe.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" fill="none" stroke-width="2"></circle>
        <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
      </svg>`;
    exilTitle.appendChild(btnLoupe);
  }

  const gyTitle = qs('.zone--cimetiere .zone-title');
  if (gyTitle && !qs('.zone--cimetire .btn-search-graveyard')) {
    const btnLoupe = document.createElement('button');
    btnLoupe.className = 'btn-search btn-search-graveyard';
    btnLoupe.title = 'Chercher dans le cimetière';
    btnLoupe.setAttribute('aria-label','Chercher dans le cimetière');
    btnLoupe.style.marginLeft = '6px';
    btnLoupe.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" fill="none" stroke-width="2"></circle>
        <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
      </svg>`;
    gyTitle.appendChild(btnLoupe);
  }

  const piocheTitle = qs('.zone--pioche .zone-title');
  if (piocheTitle && !qs('.zone--pioche .btn-scry')) {
    const btnEye = document.createElement('button');
    btnEye.className = 'btn-scry';
    btnEye.title = 'Regard (Scry)';
    btnEye.setAttribute('aria-label','Regard (Scry)');
    btnEye.style.marginLeft = '6px';
    btnEye.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
      </svg>`;
    piocheTitle.appendChild(btnEye);
  }

  // Sauvegarde automatique de l’état à la fermeture/refresh
  window.addEventListener('beforeunload', savePersistentState);
}
