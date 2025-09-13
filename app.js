/* app.js — interactions plateau (+ images + retour deck builder)
   - Drag & Drop, Tap/Untap (dblclick / 't'), Phase out (triple-clic)
   - Pioche ordonnée, recherche + "piocher", multi-lignes champ de bataille
   - Charge un deck depuis localStorage ('mtg.deck') si présent (avec images)
*/

const ZONES = {
  PIOCHE: 'pioche',
  MAIN: 'main',
  BATAILLE: 'bataille',
  CIMETIERE: 'cimetiere',
  EXIL: 'exil',
  COMMANDER: 'commander'
};

// ---------- Helpers ----------
const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));

// ---------- Deck helpers ----------
function makeDeck(cards) {
  let counter = 0;
  return cards.map(c => ({
    id: `${c.name}-${++counter}`,
    name: c.name,
    type: c.type,
    image: c.image || null
  }));
}

// Deck par défaut (fallback sans images)
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

// ---------- Création carte (avec image si disponible) ----------
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

  // Phase out (triple clic)
  let clicks = 0, last = 0, timer=null;
  cardEl.addEventListener('click', () => {
    const now = Date.now();
    if (now - last < 350) { clicks++; } else { clicks = 1; }
    last = now;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (clicks >= 3) togglePhased(cardEl);
      clicks = 0;
    }, 360);
  });
}

function toggleTappedOn(cardEl) {
  if (!cardEl.closest('.zone--bataille')) return;
  cardEl.classList.toggle('tapped');
}
function togglePhased(cardEl) {
  if (!cardEl.closest('.zone--bataille')) return; // phase out uniquement sur champ de bataille
  cardEl.classList.toggle('phased');
}

// ---------- Drag & Drop ----------
function handleDragStart(e) {
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.setData('text/plain', e.currentTarget.dataset.cardId || '');
}
function handleDragEnd(e) { e.currentTarget.classList.remove('dragging'); }
function onZoneDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('over'); }
function onZoneDragLeave(e) { e.currentTarget.classList.remove('over'); }
function resolveDropContainer(zone) {
  if (zone.classList.contains('battle-row')) return qs('.cards', zone);
  return zone.querySelector('.cards') || zone;
}
function onZoneDrop(e) {
  e.preventDefault();
  const zone = e.currentTarget;
  zone.classList.remove('over');
  const cardId = e.dataTransfer.getData('text/plain');
  const card = document.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`) || document.querySelector('.card.dragging');
  if (!card) return;
  resolveDropContainer(zone).appendChild(card);

  // Retourner si piochée depuis la pioche
  if (card.classList.contains('face-down')) {
    card.classList.remove('face-down');
  }

  // Untap / unphase hors champ de bataille
  const zoneType = zone.dataset.zone;
  if (
    zoneType === ZONES.MAIN ||
    zoneType === ZONES.CIMETIERE ||
    zoneType === ZONES.EXIL ||
    zoneType === ZONES.COMMANDER
  ) {
    card.classList.remove('tapped', 'phased');
  }
}

// ---------- Pioche ----------
function updateDeckCount() {
  const countEl = qs('.zone--pioche .deck-count [data-count]');
  if (!countEl) return;
  countEl.textContent = deck.length;
}
function spawnTopCardForDrag() {
  if (deck.length === 0) return;
  const top = deck.pop();    // retirer du deck immédiatement
  updateDeckCount();

  const container = qs('.zone--pioche .cards--pioche');
  const temp = createCardEl(top, { faceDown: true });
  container.appendChild(temp);
}

// ---------- Recherche ----------
function openSearchModal() {
  const dialog = qs('.modal-search');
  const input = qs('.search-input', dialog);
  const results = qs('.search-results', dialog);
  results.innerHTML = '';

  // Afficher le deck dans l'ordre : dessus -> bas
  [...deck].slice().reverse().forEach(c => {
    const item = document.createElement('div');
    item.className = 'result-card';
    item.draggable = true;
    item.dataset.cardId = c.id;
    item.innerHTML = `
      <span><strong>${c.name}</strong> <em>${c.type || ''}</em></span>
      <button class="btn-piocher">Piocher</button>
    `;
    item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.id); });
    item.querySelector('.btn-piocher').addEventListener('click', () => {
      const piocheZone = qs('.zone--pioche .cards--pioche');
      const idx = deck.findIndex(d => d.id === c.id);
      if (idx !== -1) { deck.splice(idx, 1); updateDeckCount(); }
      piocheZone.appendChild(createCardEl(c, { faceDown: true }));
    });
    results.appendChild(item);
  });

  input.value = '';
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    Array.from(results.children).forEach(el => {
      const txt = el.textContent.toLowerCase();
      el.style.display = txt.includes(q) ? '' : 'none';
    });
  };

  qs('.btn-shuffle', dialog).onclick = () => { shuffleDeck(); openSearchModal(); };

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', true);
}
function shuffleDeck() {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

// ---------- Chargement depuis Deck Builder (avec images) ----------
function tryLoadDeckFromLocalStorage() {
  const raw = localStorage.getItem('mtg.deck');
  if (!raw) return false;

  try {
    const payload = JSON.parse(raw);
    const expanded = [];
    let counter = 0;
    (payload.cards || []).forEach(c => {
      const qty = Number(c.qty || 0);
      for (let i = 0; i < qty; i++) {
        expanded.push({
          id: `${(c.id || c.name)}-${++counter}`, // id unique
          name: c.name,
          type: c.type || '',
          image: c.image || null
        });
      }
    });
    deck = expanded;

    // Renseigner la zone de commandement (peut en avoir plusieurs)
    const cmdZone = qs('.zone--commander .cards');
    cmdZone.innerHTML = '';
    (payload.commanders || []).forEach(c => {
      const el = createCardEl({
        id: `${(c.id || c.name)}-cmd-${Math.random().toString(36).slice(2,7)}`,
        name: c.name,
        type: c.type || '',
        image: c.image || null
      });
      el.classList.remove('tapped', 'phased', 'face-down');
      cmdZone.appendChild(el);
    });

    updateDeckCount();
    localStorage.removeItem('mtg.deck'); // éviter rechargement à chaque arrivée
    return true;
  } catch (e) {
    console.error('Deck import error:', e);
    return false;
  }
}

// ---------- Init ----------
function init() {
  // DnD zones
  qsa('.dropzone, .battle-row').forEach(zone => {
    zone.addEventListener('dragover', onZoneDragOver);
    zone.addEventListener('dragleave', onZoneDragLeave);
    zone.addEventListener('drop', onZoneDrop);
  });

  // Contrôles pioche / recherche
  qs('.btn-draw')?.addEventListener('click', spawnTopCardForDrag);
  qs('.btn-search')?.addEventListener('click', openSearchModal);

  const imported = tryLoadDeckFromLocalStorage();

  updateDeckCount();

  // Démo en main uniquement si pas de deck importé
  if (!imported) {
    const main = qs('[data-zone="main"] .cards');
    ['Éclair', 'Forêt', 'Ours runegrave'].forEach((name) => {
      const found = deck.find(c => c.name === name);
      if (found) main.appendChild(createCardEl(found));
    });
  }
}
document.addEventListener('DOMContentLoaded', init);
