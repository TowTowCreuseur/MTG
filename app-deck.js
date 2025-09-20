/* app-deck.js — Deck Builder Scryfall + Sessions (Créer/Rejoindre depuis le builder)
   - Recherche par NOM (name:<query>), pagination
   - + deck, + commander
   - Import/Export JSON
   - 🔥 Sessions dans le builder :
       • Rejoindre : pseudo + numéro de session → vérifie WS → enregistre deck+pseudo → ouvre le plateau
       • Créer : pseudo + génération lien → vérifie WS → affiche lien → "Commencer la partie" ouvre le plateau
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

/* ---------- Utils : deck / joueur / urls ---------- */
function buildPayload() {
  return {
    createdAt: new Date().toISOString(),
    cards: [...deckMap.values()].map(({card, qty}) => ({
      id: card.id,
      name: card.name,
      type: card.type,
      // 👇 on stocke les deux tailles pour le plateau
      imageSmall: card.imageSmall || null,
      imageNormal: card.imageNormal || card.image || null,
      qty
    })),
    commanders: commanders.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      imageSmall: c.imageSmall || null,
      imageNormal: c.imageNormal || c.image || null
    }))
  };
}
function saveDeckToLocalStorage() {
  try {
    localStorage.setItem('mtg.deck', JSON.stringify(buildPayload()));
    return true;
  } catch {
    alert("Impossible de sauvegarder le deck dans le navigateur.");
    return false;
  }
}
function savePlayerName(name) {
  try { localStorage.setItem('mtg.playerName', String(name||'')); } catch {}
}
function baseIndexUrl() {
  const base = location.pathname.replace(/[^/]+$/, '');
  return `${location.origin}${base}index.html`;
}
function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

/* ---------- Vérif serveur WebSocket (port 8787) ---------- */
function checkWebSocketUp(hostname, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let done = false, ws;
    const end = (ok) => { if (!done) { done = true; try{ ws && ws.close(); }catch{} resolve(ok); } };
    const t = setTimeout(() => end(false), timeoutMs);
    try {
      ws = new WebSocket(`ws://${hostname}:8787/?room=poke`);
    } catch {
      clearTimeout(t); return end(false);
    }
    ws.onopen  = () => { clearTimeout(t); end(true);  };
    ws.onerror = () => { clearTimeout(t); end(false); };
  });
}

/* ---------- UI Sessions ---------- */
function openJoinDialog() {
  const dlg = qs('#joinDialog');
  if (!dlg) return;
  const err = qs('#joinError'); if (err) err.style.display = 'none';
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', true);
}

function openCreateDialog() {
  const dlg = qs('#createDialog');
  if (!dlg) return;
  const err = qs('#createError'); if (err) err.style.display = 'none';

  const roomId = makeRoomId();
  const link = `${baseIndexUrl()}?room=${roomId}`;
  const input = qs('#inviteLink');
  if (input) input.value = link;

  // pré-remplir pseudo avec dernier connu
  const storedName = localStorage.getItem('mtg.playerName') || '';
  const pseudoInput = qs('#createPseudo');
  if (pseudoInput) pseudoInput.value = storedName;

  // Vérifie que le WS répond avant de montrer le lien comme "valide"
  checkWebSocketUp(location.hostname).then(ok => {
    if (!ok && err) {
      err.textContent = "Le serveur n'est pas démarré (ws://"+location.hostname+":8787). Lancez `node server.js` puis réessayez.";
      err.style.display = 'block';
    }
  });

  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', true);

  // Stocke le lien sur le bouton "Commencer la partie"
  const startBtn = qs('#startGameBtn');
  if (startBtn) startBtn.dataset.link = link;
}

/* ---------- Recherche / rendu existants ---------- */
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
  const faces = c.card_faces?.[0];
  const uris  = c.image_uris || faces?.image_uris || {};
  const imgSmall  = uris.small  ?? null;
  const imgNormal = uris.normal ?? imgSmall;

  // 👉 Deck builder : on veut afficher "normal" (plus net)
  return {
    id: c.id,
    name: c.name,
    type: c.type_line,
    image: imgNormal || null,       // utilisé uniquement dans le builder (vignette résultats)
    imageSmall: imgSmall || null,   // pour le plateau
    imageNormal: imgNormal || null  // pour le plateau (aperçu)
  };
}

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

    // 👉 dans le builder on affiche la version "normal"
    if (card.image) {
      const img = document.createElement('img');
      img.src = card.image; // normal
      img.alt = card.name;
      img.style.width = '100%';
      img.style.borderRadius = '8px';
      img.style.marginTop = '6px';
      img.loading = 'lazy';
      img.decoding = 'async';
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
    if (c.imageNormal || c.image) {
      const img = document.createElement('img');
      img.src = c.imageNormal || c.image; // builder => normal
      img.alt = c.name;
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

/* ---------- Actions deck ---------- */
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
          // rétrocompat : si ancien format {image} ou {imageLarge}
          const card = {
            id: c.id,
            name: c.name,
            type: c.type,
            image: c.imageNormal || c.image || null,
            imageSmall: c.imageSmall || null,
            imageNormal: c.imageNormal || c.image || null
          };
            // NB: "image" n'est utilisé que pour l’aperçu dans le builder
          deckMap.set(card.id, { card, qty: Number(c.qty || 0) });
        });
      }
      if (Array.isArray(obj.commanders)) {
        commanders = obj.commanders.map(c => ({
          id: c.id,
          name: c.name,
          type: c.type,
          image: c.imageNormal || c.image || null,
          imageSmall: c.imageSmall || null,
          imageNormal: c.imageNormal || c.image || null
        }));
      } else if (obj.commander) {
        commanders = [{
          id: obj.commander.id,
          name: obj.commander.name,
          type: obj.commander.type,
          image: obj.commander.imageNormal || obj.commander.image || null,
          imageSmall: obj.commander.imageSmall || null,
          imageNormal: obj.commander.imageNormal || obj.commander.image || null
        }];
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

/* ---------- Init ---------- */
function init() {
  const input = qs('#q');
  const clearBtn = qs('#btn-clear');
  const exportBtn = qs('#btn-export');
  const importBtn = qs('#btn-import');
  const fileInput = qs('#file-input');

  const btnJoin = qs('#btn-join-session');
  const btnCreate = qs('#btn-create-session');
  const joinConfirmBtn = qs('#joinConfirmBtn');
  const copyInviteBtn = qs('#copyInviteBtn');
  const startGameBtn = qs('#startGameBtn');

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

  // 🔥 Sessions
  btnJoin?.addEventListener('click', openJoinDialog);
  btnCreate?.addEventListener('click', openCreateDialog);

  joinConfirmBtn?.addEventListener('click', async () => {
    const pseudo = (qs('#joinPseudo')?.value || '').trim();
    const sessionId = (qs('#joinSessionId')?.value || '').trim();
    const err = qs('#joinError');
    if (err) err.style.display = 'none';

    if (!sessionId) { if (err){ err.textContent = "Veuillez entrer un numéro de session."; err.style.display='block'; } return; }

    const ok = await checkWebSocketUp(location.hostname);
    if (!ok) { if (err){ err.textContent = "Le serveur n'est pas démarré (ws://"+location.hostname+":8787). Lancez `node server.js` puis réessayez."; err.style.display='block'; } return; }

    if (!saveDeckToLocalStorage()) return;
    if (pseudo) savePlayerName(pseudo);

    window.location.href = `${baseIndexUrl()}?room=${encodeURIComponent(sessionId)}`;
  });

  copyInviteBtn?.addEventListener('click', () => {
    const link = qs('#inviteLink')?.value || '';
    if (!link) return;
    navigator.clipboard.writeText(link).catch(()=>{});
  });

  startGameBtn?.addEventListener('click', async () => {
    const link = startGameBtn.dataset.link;
    const pseudo = (qs('#createPseudo')?.value || '').trim();
    const err = qs('#createError');
    if (err) err.style.display = 'none';

    const ok = await checkWebSocketUp(location.hostname);
    if (!ok) { if (err){ err.textContent = "Le serveur n'est pas démarré (ws://"+location.hostname+":8787). Lancez `node server.js` puis réessayez."; err.style.display='block'; } return; }

    if (!saveDeckToLocalStorage()) return;
    if (pseudo) savePlayerName(pseudo);

    if (link) window.location.href = link;
  });
}
document.addEventListener('DOMContentLoaded', init);
