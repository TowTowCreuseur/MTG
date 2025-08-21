/* app.js — interactions étendues
   - Pioche : clic sur 'Piocher' -> crée la carte du dessus (face-down).
   - Recherche : chaque carte a un bouton "Piocher".
   - Tap/Untap : double-clic ou touche 't'.
   - Champ de bataille multi-rangées.
   - Chaque carte a un identifiant UNIQUE.
*/

const ZONES = {
  PIOCHE: 'pioche',
  MAIN: 'main',
  BATAILLE: 'bataille',
  CIMETIERE: 'cimetiere',
  EXIL: 'exil',
};

// ---------- Deck ----------
function makeDeck(cards) {
  let counter = 0;
  return cards.map(c => ({
    id: `${c.name}-${++counter}`,
    name: c.name,
    type: c.type
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

// ---------- Helpers ----------
const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));

// ---------- Création carte ----------
function createCardEl(card, { faceDown=false } = {}) {
  const el = document.createElement('article');
  el.className = 'card' + (faceDown ? ' face-down' : '');
  el.draggable = true;
  el.dataset.cardId = card.id;
  el.tabIndex = 0;
  el.innerHTML = `
    <div class="card-name">${card.name}</div>
    <div class="card-type">${card.type}</div>
  `;
  attachCardListeners(el);
  return el;
}

function attachCardListeners(cardEl) {
  cardEl.addEventListener('dragstart', handleDragStart);
  cardEl.addEventListener('dragend', handleDragEnd);
  cardEl.addEventListener('dblclick', () => toggleTappedOn(cardEl));
  cardEl.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 't') toggleTappedOn(cardEl);
  });
}

function toggleTappedOn(cardEl) {
  if (!cardEl.closest('.zone--bataille')) return;
  cardEl.classList.toggle('tapped');
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
  if (card.classList.contains('face-down')) {
    const idx = deck.findIndex(c => c.id === cardId);
    if (idx !== -1) {
      card.classList.remove('face-down');
      updateDeckCount(-1);
      deck.splice(idx, 1);
    } else {
      deck.pop();
      updateDeckCount(-1);
      card.classList.remove('face-down');
    }
  }
}

// ---------- Pioche ----------
function updateDeckCount(delta=0) {
  const countEl = qs('.zone--pioche .deck-count [data-count]');
  if (!countEl) return;
  let current = parseInt(countEl.textContent, 10) || deck.length;
  if (delta !== 0) current = Math.max(0, current + delta);
  else current = deck.length;
  countEl.textContent = current;
}
function spawnTopCardForDrag() {
  if (deck.length === 0) return;
  const top = deck[deck.length - 1];
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

  deck.forEach(c => {
    const item = document.createElement('div');
    item.className = 'result-card';
    item.draggable = true;
    item.dataset.cardId = c.id;
    item.innerHTML = `
      <span><strong>${c.name}</strong> <em>${c.type}</em></span>
      <button class="btn-piocher">Piocher</button>
    `;

    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', c.id);
    });

    // bouton "Piocher"
    item.querySelector('.btn-piocher').addEventListener('click', () => {
      const piocheZone = qs('.zone--pioche .cards--pioche');
      const cardEl = createCardEl(c, { faceDown: true });
      piocheZone.appendChild(cardEl);
    });

    results.appendChild(item);
  });

  input.value = '';
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    qsa('.result-card', results).forEach(el => {
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

// ---------- Init ----------
function init() {
  qsa('.dropzone, .battle-row').forEach(zone => {
    zone.addEventListener('dragover', onZoneDragOver);
    zone.addEventListener('dragleave', onZoneDragLeave);
    zone.addEventListener('drop', onZoneDrop);
  });

  qs('.btn-draw')?.addEventListener('click', spawnTopCardForDrag);
  qs('.btn-search')?.addEventListener('click', openSearchModal);

  updateDeckCount();

  const main = qs('[data-zone="main"] .cards');
  ['Éclair', 'Forêt', 'Ours runegrave'].forEach((name) => {
    const found = deck.find(c => c.name === name);
    if (!found) return;
    main.appendChild(createCardEl(found));
  });
}

document.addEventListener('DOMContentLoaded', init);
