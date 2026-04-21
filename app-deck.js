/* app-deck.js — Deck Builder Scryfall (simplifié, sans UI de session)
   - Recherche par NOM (name:<query>), pagination
   - + deck, + commander
   - Import/Export JSON
   - 👉 Bouton unique “Rejoindre la partie” qui :
       • sauvegarde le deck dans localStorage
       • lit room/wsHost/wsPort/wsProto de l’URL
       • redirige vers index.html avec les mêmes paramètres
   - 🔥 Bouton “Réinitialiser le terrain” (efface la sauvegarde précédente du plateau : localStorage 'mtg.persist.state')
   - 🆕 Barre de saisie “Pseudo” au-dessus de “Rejoindre la partie”
       • stockée dans localStorage('mtg.playerName')
       • désactivée s’il existe une partie en mémoire (PERSIST_BOARD_KEY)
*/

const CARD_LANG = 'fr';
const PERSIST_BOARD_KEY = 'mtg.persist.state';
const PLAYER_NAME_KEY = 'mtg.playerName';

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

/* ---------- Utils : deck / urls ---------- */
function buildPayload() {
  return {
    createdAt: new Date().toISOString(),
    cards: [...deckMap.values()].map(({card, qty}) => ({
      id: card.id,
      name: card.name,
      type: card.type,
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
function baseIndexUrl() {
  const base = location.pathname.replace(/[^/]+$/, '');
  return `${location.origin}${base}index.html`;
}

/* ---------- Réinitialisation du terrain ---------- */
function resetBoardState() {
  try {
    localStorage.removeItem(PERSIST_BOARD_KEY);
    return true;
  } catch {
    return false;
  }
}
function confirmAndResetBoardState() {
  const ok = confirm("Réinitialiser le terrain ?\nCela efface la sauvegarde de la partie précédente (plateau, main, cimetière, etc.).");
  if (!ok) return;
  const done = resetBoardState();
  if (done) {
    // ✅ réactiver la saisie du pseudo immédiatement
    setPlayerNameFieldLocked(false);
    alert("Terrain réinitialisé ✅\nLa prochaine ouverture de la table utilisera uniquement le deck choisi ici.");
  } else {
    alert("Impossible d'effacer la sauvegarde locale du terrain.");
  }
}

/* ---------- Aide : partie en mémoire ? ---------- */
function hasOngoingLocalGame(){
  try { return !!localStorage.getItem(PERSIST_BOARD_KEY); } catch { return false; }
}

/* ---------- Pseudo : helpers ---------- */
function setPlayerNameFieldLocked(locked){
  const input = qs('#playerNameBuilder');
  if (!input) return;
  input.disabled = !!locked;
  input.title = locked
    ? "Un plateau est déjà sauvegardé. Réinitialisez le terrain pour changer de pseudo."
    : "";
  input.style.opacity = locked ? '0.6' : '';
  input.style.cursor  = locked ? 'not-allowed' : '';
}

/* ---------- Pseudo : injection au-dessus du bouton GO ---------- */
function ensurePlayerNameField() {
  const btnGoPlay = qs('#btn-go-play');
  if (!btnGoPlay) return;

  // Si déjà injecté, ne rien refaire (mais s'assurer de l'état lock)
  if (qs('#playerNameBuilder')) {
    setPlayerNameFieldLocked(hasOngoingLocalGame());
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'player-name-wrap';
  wrap.style.cssText = 'display:grid; gap:6px; margin:10px 0 14px;';

  const label = document.createElement('label');
  label.setAttribute('for', 'playerNameBuilder');
  label.textContent = 'Votre pseudo (affiché dans la liste des joueurs)';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'playerNameBuilder';
  input.placeholder = 'Ex. “NissaFan42”';
  input.maxLength = 40;
  input.style.cssText = 'padding:8px; border:1px solid #ddd; border-radius:8px;';

  // Valeur initiale : depuis localStorage si dispo
  try {
    const cur = localStorage.getItem(PLAYER_NAME_KEY);
    if (cur) input.value = cur;
  } catch {}

  wrap.appendChild(label);
  wrap.appendChild(input);

  // Injection juste AVANT le bouton "Rejoindre la partie"
  btnGoPlay.parentElement?.insertBefore(wrap, btnGoPlay);

  // État de verrouillage en fonction d’une partie en mémoire
  const locked = hasOngoingLocalGame();
  setPlayerNameFieldLocked(locked);

  // Sauvegarde en direct si non verrouillé
  if (!locked) {
    input.addEventListener('input', () => {
      const v = input.value.trim();
      try { localStorage.setItem(PLAYER_NAME_KEY, v); } catch {}
    });
  }
}

/* ---------- Recherche / rendu ---------- */
function isLegendaryCreature(typeLine) {
  if (!typeLine) return false;
  const t = typeLine.toLowerCase();
  const en = t.includes("legendary") && t.includes("creature");
  const fr = t.includes("légendaire") && t.includes("créature");
  return en || fr;
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

  return {
    id: c.id,
    name: c.printed_name || c.name,
    type: c.printed_type_line || c.type_line,
    image: imgNormal || null,
    imageSmall: imgSmall || null,
    imageNormal: imgNormal || null
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

    if (card.image) {
      const img = document.createElement('img');
      img.src = card.image;
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
      img.src = c.imageNormal || c.image;
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
function sanitizeFileName(name) {
  return String(name || '').replace(/[\/\\?%*:|"<>]/g, "_").trim();
}
function makeDefaultDeckBase() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `deck-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}
function exportDownloadWithName(filenameBase) {
  const safeBase = sanitizeFileName(filenameBase || makeDefaultDeckBase()) || makeDefaultDeckBase();
  const filename = safeBase.toLowerCase().endsWith('.json') ? safeBase : `${safeBase}.json`;
  const payload = buildPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function exportDeck() {
  const dlg = qs('#exportDialog');
  if (!dlg) { exportDownloadWithName(makeDefaultDeckBase()); return; }
  const input = qs('#exportName');
  const err = qs('#exportError');
  if (input) {
    input.value = makeDefaultDeckBase();
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  if (err) err.style.display = 'none';
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', true);
}
function closeExportDialog() {
  const dlg = qs('#exportDialog');
  if (!dlg) return;
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
}
function confirmExportDialog() {
  const input = qs('#exportName');
  const err = qs('#exportError');
  const base = sanitizeFileName(input?.value || '');
  if (!base) {
    if (err) { err.textContent = "Veuillez entrer un nom de fichier."; err.style.display = 'block'; }
    return;
  }
  exportDownloadWithName(base);
  closeExportDialog();
}
function importDeckFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      deckMap.clear();
      if (Array.isArray(obj.cards)) {
        obj.cards.forEach(c => {
          const card = {
            id: c.id,
            name: c.name,
            type: c.type,
            image: c.imageNormal || c.image || null,
            imageSmall: c.imageSmall || null,
            imageNormal: c.imageNormal || c.image || null
          };
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
async function scryfallSearchByName(queryOrUrl, { isNextPage = false } = {}) {
  let url, triedFallback = false;

  const makeUrl = (q) =>
    `https://api.scryfall.com/cards/search?order=name&unique=prints&q=${encodeURIComponent(q)}`;

  const fetchJson = async (u) => {
    try {
      const r = await fetch(u);
      const json = await r.json().catch(() => null);
      return { ok: r.ok, json, url: u };
    } catch {
      return { ok: false, json: null, url: u };
    }
  };
  const isEmptyResult = (resp) => {
    if (!resp || !resp.json) return true;
    if (resp.json.object === 'error') return true;
    const arr = resp.json.data || [];
    return arr.length === 0;
  };

  if (isNextPage) {
    url = queryOrUrl;
    const resp = await fetchJson(url);
    if (!resp.ok || resp.json.object === 'error') {
      return { cards: [], hasMore: false, nextPage: null, pageUrl: url };
    }
    return {
      cards: (resp.json.data || []).map(normalizeCard),
      hasMore: !!resp.json.has_more,
      nextPage: resp.json.next_page || null,
      pageUrl: url
    };
  }

  // 1) langue choisie
  const qLang = `lang:${CARD_LANG} (printed_name:"${queryOrUrl}" OR name:"${queryOrUrl}")`;
  let resp = await fetchJson(makeUrl(qLang));

  // 2) fallback si vide/erreur
  if (!resp.ok || isEmptyResult(resp)) {
    triedFallback = true;
    const qAny = `(printed_name:"${queryOrUrl}" OR name:"${queryOrUrl}")`;
    resp = await fetchJson(makeUrl(qAny));

    if (!resp.ok || isEmptyResult(resp)) {
      const qExact = `!"${queryOrUrl}"`;
      resp = await fetchJson(makeUrl(qExact));
    }
  }

  if (!resp.ok || resp.json.object === 'error') {
    return { cards: [], hasMore: false, nextPage: null, pageUrl: resp.url };
  }

  const warn = qs('#searchWarning');
  if (triedFallback && warn) {
    if (resp.json.data && resp.json.data.length) {
      warn.textContent = `Aucune impression "${CARD_LANG}" trouvée. Affichage des versions disponibles.`;
      warn.style.display = 'block';
    } else {
      warn.style.display = 'none';
    }
  } else if (warn) {
    warn.style.display = 'none';
  }

  return {
    cards: (resp.json.data || []).map(normalizeCard),
    hasMore: !!resp.json.has_more,
    nextPage: resp.json.next_page || null,
    pageUrl: resp.url
  };
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

  const btnGoPlay = qs('#btn-go-play');
  const btnResetBoard = qs('#btn-reset-board');

  const exportConfirmBtn = qs('#exportConfirmBtn');
  const exportCancelBtn  = qs('#exportCancelBtn');
  const exportNameInput  = qs('#exportName');
  const exportDialog     = qs('#exportDialog');

  // 🆕 Champ “Pseudo” au-dessus de “Rejoindre la partie”
  ensurePlayerNameField();

  renderResults([]);
  renderDeck();
  renderCommanders();

  let t = null;
  input?.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => runSearch(input.value), 200);
  });

  clearBtn?.addEventListener('click', () => { deckMap.clear(); commanders = []; renderDeck(); renderCommanders(); });
  exportBtn?.addEventListener('click', exportDeck);
  importBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importDeckFromFile(f); e.target.value=''; });

  // —— Réinitialiser le terrain —— //
  btnResetBoard?.addEventListener('click', confirmAndResetBoardState);

  // —— Rejoindre la partie —— //
  btnGoPlay?.addEventListener('click', () => {
    if (!saveDeckToLocalStorage()) return;

    // Récupérer/sauvegarder le pseudo
    const nameInput = qs('#playerNameBuilder');
    let playerName = '';
    if (nameInput && !nameInput.disabled) {
      playerName = (nameInput.value || '').trim();
      try { localStorage.setItem(PLAYER_NAME_KEY, playerName); } catch {}
    } else {
      try { playerName = (localStorage.getItem(PLAYER_NAME_KEY) || '').trim(); } catch {}
    }

    const urlp   = new URLSearchParams(location.search);
    const room   = urlp.get('room')   || '';
    const wsHost = urlp.get('wsHost') || location.hostname;
    const wsPort = urlp.get('wsPort') || '8787';
    const wsProto= urlp.get('wsProto')|| (location.protocol === 'https:' ? 'wss' : 'ws');

    if (!room) {
      alert("Paramètre 'room' manquant dans l'URL. Ouvrez le builder via le lien d'invitation généré par l'hôte.");
      return;
    }

    const params = new URLSearchParams({ room, wsHost, wsPort, wsProto });
    if (playerName) params.set('playerName', playerName); // ✅ passer le pseudo à la table

    window.location.href = `${baseIndexUrl()}?${params.toString()}`;
  });

  // —— Modale d'export —— //
  exportConfirmBtn?.addEventListener('click', confirmExportDialog);
  exportCancelBtn?.addEventListener('click', closeExportDialog);
  exportNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmExportDialog(); }
  });
  exportDialog?.addEventListener('cancel', (e) => { e.preventDefault(); closeExportDialog(); });

  // —— Decklist MTGO —— //
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
    pendingEnrichedPayload = { createdAt: new Date().toISOString(), cards: enriched.cards, commanders: enriched.commanders };
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
  const cards = [], sideboard = [];
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
    if (out[i].image) continue;
    if (onProgress) onProgress(`${i + 1} / ${out.length}`);
    const found = await fetchCardEnrich(out[i].name);
    if (found) out[i] = { ...found, ...(out[i].qty !== undefined ? { qty: out[i].qty } : {}) };
  }
  return out;
}

async function enrichWithRetry(cards, sideboard, MAX_TRIES = 4) {
  const overlay = qs('#enrich-overlay');
  const progressEl = qs('#enrich-progress');
  if (overlay) overlay.style.display = 'flex';

  let enrichedCards = cards;
  let enrichedSide = sideboard;

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const missingC = enrichedCards.filter(c => !c.image).length;
    const missingS = enrichedSide.filter(c => !c.image).length;
    if (attempt > 1 && missingC === 0 && missingS === 0) break;
    if (progressEl) progressEl.textContent = `Passe ${attempt}/${MAX_TRIES} — principales (${attempt === 1 ? enrichedCards.length : missingC} cartes)…`;
    enrichedCards = await enrichList(enrichedCards, txt => { if (progressEl) progressEl.textContent = `Passe ${attempt}/${MAX_TRIES} — ${txt}`; });
    if (progressEl) progressEl.textContent = `Passe ${attempt}/${MAX_TRIES} — sideboard…`;
    enrichedSide = await enrichList(enrichedSide, null);
  }

  if (overlay) overlay.style.display = 'none';
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
