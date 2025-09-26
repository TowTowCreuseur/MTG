/* app-deck.js — Deck Builder Scryfall (simplifié, sans UI de session)
   - Recherche par NOM (name:<query>), pagination
   - + deck, + commander
   - Import/Export JSON
   - 👉 Bouton unique “Rejoindre la partie” qui :
       • sauvegarde le deck dans localStorage
       • lit room/wsHost/wsPort/wsProto de l’URL
       • redirige vers index.html avec les mêmes paramètres
*/

// --- Langue d'affichage des impressions Scryfall ---
const CARD_LANG = 'fr';

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

  // Bouton unique “Rejoindre la partie”
  const btnGoPlay = qs('#btn-go-play');

  // Éléments de la modale d'export
  const exportConfirmBtn = qs('#exportConfirmBtn');
  const exportCancelBtn  = qs('#exportCancelBtn');
  const exportNameInput  = qs('#exportName');
  const exportDialog     = qs('#exportDialog');

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

  // —— Rejoindre la partie : sauvegarde le deck puis redirige vers index.html avec les mêmes paramètres —— //
  btnGoPlay?.addEventListener('click', () => {
    if (!saveDeckToLocalStorage()) return;

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
    window.location.href = `${baseIndexUrl()}?${params.toString()}`;
  });

  // —— Wiring de la modale d'export —— //
  exportConfirmBtn?.addEventListener('click', confirmExportDialog);
  exportCancelBtn?.addEventListener('click', closeExportDialog);
  exportNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmExportDialog(); }
  });
  exportDialog?.addEventListener('cancel', (e) => { e.preventDefault(); closeExportDialog(); }); // ESC sur <dialog>
}
document.addEventListener('DOMContentLoaded', init);
