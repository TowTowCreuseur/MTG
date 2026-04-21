/* app-deck.js — Deck Builder Scryfall + Multi-Commander + Import/Export + Ouvrir Plateau
   - Recherche par NOM (name:<query>)
   - 2 colonnes (CSS)
   - + pour deck, + doré pour Commander (si Créature légendaire)
   - Plusieurs Commanders
   - Export JSON (download), Import JSON (file)
   - 🔥 Bouton "Ouvrir le plateau" : sauvegarde en localStorage puis redirige vers index.html
*/

const deckMap = new Map(); // id -> {card, qty}
let commanders = [];

let searchState = {
  query: "",
  prevStack: [],
  hasMore: false,
  nextPageUrl: null,
  currentPageUrl: null,
};

const qs = (s, el=document) => el.querySelector(s);

function isLegendaryCreature(typeLine) {
  if (!typeLine) return false;
  const t = typeLine.toLowerCase();
  return t.includes("legendary") && t.includes("creature");
}
const uniqById = (arr) => {
  const m = new Map();
  arr.forEach(c => m.set(c.id, c));
  return [...m.values()];
};

function normalizeCard(c) {
  const imgNormal = c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? null;
  const imgSmall  = c.image_uris?.small  ?? c.card_faces?.[0]?.image_uris?.small  ?? imgNormal;
  return { id: c.id, name: c.name, type: c.type_line, image: imgSmall || null };
}

/* ---------- Rendu résultats / pagination ---------- */
function renderResults(list) {
  const container = qs('.results');
  container.innerHTML = '';

  list.forEach(card => {
    const item = document.createElement('article');
    item.className = 'card-item';

    const head = document.createElement('div');
    head.className = 'card-head';

    const title = document.createElement('div');
    title.className = 'card-name';
    title.textContent = card.name;

    const actions = document.createElement('div');
    actions.style.display = 'inline-flex';
    actions.style.alignItems = 'center';

    const btnAdd = document.createElement('button');
    btnAdd.className = 'btn-add';
    btnAdd.textContent = '+';
    btnAdd.title = 'Ajouter au deck';
    btnAdd.addEventListener('click', () => addToDeck(card));
    actions.appendChild(btnAdd);

    if (isLegendaryCreature(card.type)) {
      const btnCmd = document.createElement('button');
      btnCmd.className = 'btn-commander';
      btnCmd.textContent = '+';
      btnCmd.title = 'Ajouter en Commander';
      btnCmd.addEventListener('click', () => addCommander(card));
      actions.appendChild(btnCmd);
    }

    head.appendChild(title);
    head.appendChild(actions);
    item.appendChild(head);

    const type = document.createElement('div');
    type.className = 'card-type';
    type.textContent = card.type ?? '';
    item.appendChild(type);

    if (card.image) {
      const img = document.createElement('img');
      img.src = card.image; img.alt = card.name;
      img.style.width = '100%'; img.style.borderRadius = '8px'; img.style.marginTop = '6px';
      item.appendChild(img);
    }

    container.appendChild(item);
  });

  if (!list.length) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--muted)';
    empty.textContent = 'Aucun résultat';
    container.appendChild(empty);
  }

  renderPager();
}
function renderPager() {
  const pager = qs('#pager');
  pager.innerHTML = '';

  const btnPrev = document.createElement('button');
  btnPrev.className = 'btn-secondary';
  btnPrev.textContent = '← Précédent';
  btnPrev.disabled = searchState.prevStack.length <= 1;
  btnPrev.addEventListener('click', goPrevPage);

  const btnNext = document.createElement('button');
  btnNext.className = 'btn-primary';
  btnNext.textContent = 'Suivant →';
  btnNext.disabled = !searchState.hasMore;
  btnNext.addEventListener('click', goNextPage);

  pager.appendChild(btnPrev);
  pager.appendChild(btnNext);
}

/* ---------- Rendu deck / commanders ---------- */
function renderDeck() {
  const list = qs('#deck-list');
  list.innerHTML = '';

  let total = 0;
  for (const [, entry] of deckMap) total += entry.qty;
  qs('#deck-count').textContent = total;

  [...deckMap.values()].sort((a,b)=> a.card.name.localeCompare(b.card.name))
    .forEach(({card, qty}) => {
      const row = document.createElement('div');
      row.className = 'deck-row';
      row.innerHTML = `
        <div class="name">${card.name}<div class="type">${card.type ?? ''}</div></div>
        <div class="qty-controls">
          <button class="btn-qty" data-act="dec">−</button>
          <span class="qty">${qty}</span>
          <button class="btn-qty" data-act="inc">+</button>
        </div>
        <button class="btn-qty" data-act="del">×</button>
      `;
      row.querySelector('[data-act="inc"]').addEventListener('click', () => addToDeck(card));
      row.querySelector('[data-act="dec"]').addEventListener('click', () => addToDeck(card, -1));
      row.querySelector('[data-act="del"]').addEventListener('click', () => { deckMap.delete(card.id); renderDeck(); });
      list.appendChild(row);
    });

  renderCommanders();
}
function renderCommanders() {
  const slot = qs('#commander-slot');
  slot.innerHTML = '';

  if (!commanders.length) {
    slot.classList.add('empty');
    slot.textContent = 'Aucun commander';
    return;
  }
  slot.classList.remove('empty');

  commanders.forEach(c => {
    const row = document.createElement('div');
    row.className = 'cmd-row';
    if (c.image) {
      const img = document.createElement('img');
      img.src = c.image; img.alt = c.name;
      row.appendChild(img);
    }
    const text = document.createElement('div');
    text.innerHTML = `<div class="cmd-name">${c.name}</div><div class="cmd-type">${c.type ?? ''}</div>`;
    row.appendChild(text);
    const btn = document.createElement('button');
    btn.className = 'btn-remove-cmd';
    btn.textContent = 'Retirer';
    btn.addEventListener('click', () => removeCommander(c.id));
    row.appendChild(btn);
    slot.appendChild(row);
  });
}

/* ---------- Actions ---------- */
function addToDeck(card, delta=1) {
  const entry = deckMap.get(card.id) || { card, qty: 0 };
  entry.qty = Math.max(0, entry.qty + delta);
  if (entry.qty === 0) deckMap.delete(card.id);
  else deckMap.set(card.id, entry);
  renderDeck();
}
function addCommander(card) {
  if (!isLegendaryCreature(card.type)) {
    alert("Seules les créatures légendaires peuvent être commandants.");
    return;
  }
  commanders = uniqById([...commanders, { ...card }]);
  renderCommanders();
}
function removeCommander(id) {
  commanders = commanders.filter(c => c.id !== id);
  renderCommanders();
}

/* ---------- Export / Import ---------- */
function buildPayload() {
  return {
    createdAt: new Date().toISOString(),
    cards: [...deckMap.values()].map(({card, qty}) => ({
      id: card.id, name: card.name, type: card.type, image: card.image || null, qty
    })),
    commanders: commanders.map(c => ({
      id: c.id, name: c.name, type: c.type, image: c.image || null
    }))
  };
}
function exportDeck() {
  const payload = buildPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `deck-${Date.now()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function importDeckFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      deckMap.clear();
      if (Array.isArray(obj.cards)) {
        obj.cards.forEach(c => {
          const card = { id: c.id, name: c.name, type: c.type, image: c.image || null };
          deckMap.set(card.id, { card, qty: Number(c.qty || 0) });
        });
      }
      if (Array.isArray(obj.commanders)) {
        commanders = obj.commanders.map(c => ({ id: c.id, name: c.name, type: c.type, image: c.image || null }));
      } else if (obj.commander) {
        commanders = [{ id: obj.commander.id, name: obj.commander.name, type: obj.commander.type, image: obj.commander.image || null }];
      } else commanders = [];
      renderDeck(); renderCommanders();
    } catch (e) { alert("Fichier JSON invalide."); }
  };
  reader.readAsText(file);
}

/* ---------- Scryfall / Pagination / Recherche ---------- */
async function scryfallSearchByName(queryOrUrl, { isNextPage=false } = {}) {
  let url;
  if (isNextPage) url = queryOrUrl;
  else url = `https://api.scryfall.com/cards/search?order=name&q=${encodeURIComponent(`name:${queryOrUrl}`)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { cards: [], hasMore: false, nextPage: null, pageUrl: url };
    const data = await res.json();
    return {
      cards: (data.data || []).map(normalizeCard),
      hasMore: !!data.has_more,
      nextPage: data.next_page || null,
      pageUrl: url
    };
  } catch { return { cards: [], hasMore: false, nextPage: null, pageUrl: null }; }
}
async function goNextPage() {
  if (!searchState.nextPageUrl) return;
  if (searchState.currentPageUrl) {
    const top = searchState.prevStack.at(-1);
    if (top !== searchState.currentPageUrl) searchState.prevStack.push(searchState.currentPageUrl);
  }
  const res = await scryfallSearchByName(searchState.nextPageUrl, { isNextPage: true });
  Object.assign(searchState, { hasMore: res.hasMore, nextPageUrl: res.nextPage, currentPageUrl: res.pageUrl });
  renderResults(res.cards);
}
async function goPrevPage() {
  if (searchState.prevStack.length <= 1) return runSearch(searchState.query);
  searchState.prevStack.pop();
  const prevUrl = searchState.prevStack.at(-1);
  const res = await scryfallSearchByName(prevUrl, { isNextPage: true });
  Object.assign(searchState, { hasMore: res.hasMore, nextPageUrl: res.nextPage, currentPageUrl: res.pageUrl });
  renderResults(res.cards);
}
async function runSearch(q) {
  searchState.query = q.trim();
  searchState.prevStack = [];
  if (!searchState.query) return renderResults([]);
  const res = await scryfallSearchByName(searchState.query);
  Object.assign(searchState, { hasMore: res.hasMore, nextPageUrl: res.nextPage, currentPageUrl: res.pageUrl });
  searchState.prevStack.push(res.pageUrl);
  renderResults(res.cards);
}

/* ---------- Ouvrir le plateau avec le deck courant ---------- */
function openBoardWithDeck() {
  const payload = buildPayload();
  try {
    localStorage.setItem('mtg.deck', JSON.stringify(payload));
  } catch (e) {
    alert("Impossible de sauvegarder le deck dans le navigateur.");
    return;
  }
  // Redirection vers le plateau (même dossier)
  window.location.href = 'plateau.html';
}

/* ---------- Init ---------- */
function init() {
  const input = qs('#q');
  const clearBtn = qs('#btn-clear');
  const exportBtn = qs('#btn-export');
  const importBtn = qs('#btn-import');
  const fileInput = qs('#file-input');
  const openBoardBtn = qs('#btn-open-board');

  renderResults([]);
  renderDeck();
  renderCommanders();

  let t = null;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => runSearch(input.value), 200);
  });

  clearBtn?.addEventListener('click', () => { deckMap.clear(); commanders = []; renderDeck(); renderCommanders(); });
  exportBtn?.addEventListener('click', exportDeck);
  importBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importDeckFromFile(f); e.target.value=''; });

  openBoardBtn?.addEventListener('click', openBoardWithDeck);

  // --- Decklist MTGO ---
  let pendingEnrichedPayload = null;

  qs('#btn-decklist')?.addEventListener('click', () => qs('#dlg-decklist')?.showModal());
  qs('#btn-decklist-cancel')?.addEventListener('click', () => qs('#dlg-decklist')?.close());
  qs('#btn-deckname-cancel')?.addEventListener('click', () => qs('#dlg-deckname')?.close());

  qs('#btn-decklist-generate')?.addEventListener('click', async () => {
    const text = qs('#decklist-input')?.value || '';
    if (!text.trim()) return;
    qs('#dlg-decklist').close();
    const { cards, sideboard } = parseMtgoDecklist(text);
    const enriched = await enrichWithRetry(cards, sideboard);
    pendingEnrichedPayload = {
      createdAt: new Date().toISOString(),
      cards: enriched.cards,
      commanders: enriched.commanders,
    };
    const nameInput = qs('#deck-name-input');
    if (nameInput) nameInput.value = '';
    qs('#dlg-deckname')?.showModal();
  });

  qs('#btn-deckname-download')?.addEventListener('click', () => {
    const name = qs('#deck-name-input')?.value || 'deck';
    if (pendingEnrichedPayload) downloadDeckJson(pendingEnrichedPayload, name);
    qs('#dlg-deckname')?.close();
    pendingEnrichedPayload = null;
  });
}

/* ---------- Decklist MTGO — Parser ---------- */
function parseMtgoDecklist(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const cards = [];
  const sideboard = [];
  let inSideboard = false;

  for (const line of lines) {
    if (/^sideboard/i.test(line)) { inSideboard = true; continue; }
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const qty = parseInt(match[1]);
    const name = match[2].trim();
    (inSideboard ? sideboard : cards).push({ name, qty });
  }
  return { cards, sideboard };
}

/* ---------- Decklist MTGO — Enrichissement Scryfall ---------- */
const ENRICH_DELAY_MS = 120;
const enrichSleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeFromScryFull(card) {
  const face = Array.isArray(card.card_faces) && card.card_faces.length ? card.card_faces[0] : null;
  const uris = card.image_uris || face?.image_uris || {};
  return {
    id: card.id,
    name: card.printed_name || card.name || face?.name,
    type: card.printed_type_line || card.type_line || face?.type_line,
    image: uris.small ?? uris.normal ?? null,
  };
}

async function fetchCardEnrich(name) {
  const base = 'https://api.scryfall.com/cards/search?order=name&unique=prints&q=';
  const queries = [
    `lang:fr (printed_name:"${name}" OR name:"${name}")`,
    `(printed_name:"${name}" OR name:"${name}")`,
    `!"${name}"`,
  ];
  for (const q of queries) {
    try {
      const res = await fetch(base + encodeURIComponent(q));
      const json = await res.json();
      if (!res.ok || json.object === 'error' || !json.data?.length) continue;
      await enrichSleep(ENRICH_DELAY_MS);
      return normalizeFromScryFull(json.data[0]);
    } catch { continue; }
  }
  return null;
}

async function enrichList(items, onProgress) {
  const out = [...items];
  for (let i = 0; i < out.length; i++) {
    if (out[i].image) continue; // déjà enrichi
    if (onProgress) onProgress(`${i + 1} / ${out.length}`);
    const found = await fetchCardEnrich(out[i].name);
    if (found) out[i] = { ...found, ...(out[i].qty !== undefined ? { qty: out[i].qty } : {}) };
  }
  return out;
}

async function enrichWithRetry(cards, sideboard, MAX_TRIES = 4) {
  const overlay = qs('#enrich-overlay');
  const progressEl = qs('#enrich-progress');
  overlay.style.display = 'flex';

  let enrichedCards = cards;
  let enrichedSide = sideboard;

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const missingC = enrichedCards.filter(c => !c.image).length;
    const missingS = enrichedSide.filter(c => !c.image).length;
    if (attempt > 1 && missingC === 0 && missingS === 0) break;

    if (progressEl) progressEl.textContent = `Passe ${attempt}/${MAX_TRIES} — principales (${missingC || enrichedCards.length} cartes)…`;
    enrichedCards = await enrichList(enrichedCards, txt => { if (progressEl) progressEl.textContent = `Passe ${attempt}/${MAX_TRIES} — ${txt}`; });

    if (progressEl) progressEl.textContent = `Passe ${attempt}/${MAX_TRIES} — sideboard (${missingS || enrichedSide.length} cartes)…`;
    enrichedSide = await enrichList(enrichedSide, null);
  }

  overlay.style.display = 'none';
  return { cards: enrichedCards, commanders: enrichedSide };
}

/* ---------- Decklist MTGO — Téléchargement JSON ---------- */
function downloadDeckJson(payload, name) {
  const filename = (name.trim().replace(/\s+/g, '-').toLowerCase() || 'deck') + '.json';
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', init);
