/* app.js — interactions plateau + multi + recherche de jetons
   - Plateau : drag & drop, pioche, recherche, etc.
   - Jetons : recherche Scryfall (is:token), ajout quantité, placement auto
   - Multi : partage d’état via WebSocket (overlay lecteur pour adversaire)
   - Sessions : création lien d’invitation + rejoindre
*/

const ZONES = {
  PIOCHE: 'pioche',
  MAIN: 'main',
  BATAILLE: 'bataille',
  CIMETIERE: 'cimetiere',
  EXIL: 'exil',
  COMMANDER: 'commander',
  LIFE: 'life',
  TOKENS: 'tokens'
};

const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));

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

// ---------- Compteur de vie ----------
let lifeTotal = 40;

function updateLifeDisplay(){
  const el = qs('.zone--life .life-value');
  if (el) el.textContent = String(lifeTotal);
}
function setLife(n){
  if (!Number.isFinite(n)) return;
  n = Math.trunc(n);
  lifeTotal = n;
  updateLifeDisplay();
}
function changeLife(delta){
  setLife(lifeTotal + Math.trunc(delta));
}

// ---------- Carte ----------
function createCardEl(card, { faceDown=false, isToken=false } = {}) {
  const el = document.createElement('article');
  el.className = 'card' + (faceDown ? ' face-down' : '') + (isToken ? ' token' : '');
  el.draggable = true;
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
  attachCardListeners(el);
  return el;
}

// ---------- Aperçu au survol ----------
let __previewTimer = null;
let __previewDlg = null; // dialog d’aperçu
let __isMouseDown = false;

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

// ---------- Stores cachés ----------
const exileStore = [];
const graveyardStore = [];

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

// ---------- Listeners carte ----------
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

  cardEl.addEventListener('mousedown', () => { __isMouseDown = true; clearTimeout(__previewTimer); hideCardPreview(); });
  cardEl.addEventListener('mouseup', () => { __isMouseDown = false; });

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

function toggleTappedOn(cardEl) { if (cardEl.closest('.zone--bataille')) cardEl.classList.toggle('tapped'); }
function togglePhased(cardEl)   { if (cardEl.closest('.zone--bataille')) cardEl.classList.toggle('phased'); }

// ---------- DnD ----------
function handleDragStart(e) { e.currentTarget.classList.add('dragging'); e.dataTransfer.setData('text/plain', e.currentTarget.dataset.cardId || ''); }
function handleDragEnd(e)   { e.currentTarget.classList.remove('dragging'); __isMouseDown = false; hideCardPreview(); }
function onZoneDragOver(e)  { e.preventDefault(); e.currentTarget.classList.add('over'); }
function onZoneDragLeave(e) { e.currentTarget.classList.remove('over'); }
function resolveDropContainer(zone) { return zone.classList.contains('battle-row') ? qs('.cards', zone) : zone.querySelector('.cards') || zone; }
function onZoneDrop(e) {
  e.preventDefault();
  const zone = e.currentTarget;
  zone.classList.remove('over');
  const cardId = e.dataTransfer.getData('text/plain');
  const card = document.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`) || document.querySelector('.card.dragging');
  if (!card) return;

  const zoneType = zone.dataset.zone;

  // Jetons : s'ils vont à l'exil/cimetière → disparition pure
  const isToken = card.dataset.isToken === '1';

  if (zoneType === ZONES.EXIL) {
    if (isToken) { card.remove(); return; }
    exileStore.push(cardElToObj(card));
    card.remove();
    return;
  }
  if (zoneType === ZONES.CIMETIERE) {
    if (isToken) { card.remove(); return; }
    graveyardStore.push(cardElToObj(card));
    card.remove();
    return;
  }

  resolveDropContainer(zone).appendChild(card);
  if (card.classList.contains('face-down')) card.classList.remove('face-down');
  if ([ZONES.MAIN, ZONES.CIMETIERE, ZONES.EXIL, ZONES.COMMANDER].includes(zoneType)) {
    card.classList.remove('tapped','phased');
  }
}

// ---------- Pioche ----------
function updateDeckCount() { const c=qs('.zone--pioche .deck-count [data-count]'); if(c) c.textContent=deck.length; }
function spawnTopCardForDrag() {
  if (deck.length === 0) return;
  const top = deck.pop();
  updateDeckCount();
  const hand = qs('.zone--main .cards--hand') || qs('.zone--main .cards');
  const el = createCardEl(top, { faceDown: false });
  hand.appendChild(el);
  el.scrollIntoView({ block: 'nearest', inline: 'end', behavior: 'smooth' });
}

// ---------- Helpers titre modale ----------
function setSearchTitle(txt){ const t = qs('.search-title'); if (t) t.textContent = txt; }

// ---------- Recherche (bibliothèque) ----------
function openSearchModal() {
  const dialog = qs('.modal-search'); if (!dialog) return;
  const input = qs('.search-input', dialog);
  const results = qs('.search-results', dialog);
  const shuffle = qs('.btn-shuffle', dialog);
  if (shuffle) shuffle.style.display = '';
  if (results) results.innerHTML = '';

  setSearchTitle('Recherche dans la bibliothèque');

  [...deck].slice().reverse().forEach(c => {
    const item = document.createElement('div');
    item.className = 'result-card';
    item.dataset.cardId = c.id;
    item.innerHTML = `
      <span><strong>${c.name}</strong> <em>${c.type || ''}</em></span>
      <button class="btn-piocher" type="button">Piocher</button>
    `;
    item.querySelector('.btn-piocher')?.addEventListener('click', () => {
      const idx = deck.findIndex(d => d.id === c.id);
      if (idx !== -1) {
        const picked = deck.splice(idx, 1)[0];
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
    btnShuffle.onclick = () => { shuffleDeck(); openSearchModal(); };
  }

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', 'true');
}

// ---------- Recherche (EXIL) ----------
function openExileSearchModal() {
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
    item.innerHTML = `
      <span><strong>${c.name}</strong> <em>${c.type || ''}</em></span>
      <button class="btn-piocher" type="button">Piocher</button>
    `;
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
function openGraveyardSearchModal() {
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
    item.innerHTML = `
      <span><strong>${c.name}</strong> <em>${c.type || ''}</em></span>
      <button class="btn-piocher" type="button">Piocher</button>
    `;
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

// ---------- SCRY ----------
function openScryPrompt(){
  if (deck.length === 0) { alert("La bibliothèque est vide."); return; }

  const dlg = document.createElement('dialog');
  dlg.className = 'modal-scry-ask';
  dlg.innerHTML = `
    <form method="dialog" style="min-width: 320px; padding: 16px; display:grid; gap:12px">
      <h3 style="margin:0">Scry — combien ?</h3>
      <div>
        <input type="number" min="1" max="${deck.length}" value="1" style="width:100%; padding:8px" aria-label="Nombre de cartes à regarder">
        <small style="opacity:.7">Max : ${deck.length} (cartes restantes)</small>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end">
        <button value="cancel" class="btn btn-cancel">Annuler</button>
        <button value="ok" class="btn btn-primary">Valider</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') {
      const n = Math.max(1, Math.min(deck.length, parseInt(dlg.querySelector('input').value || '1',10)));
      dlg.remove();
      openScryDialog(n);
    } else {
      dlg.remove();
    }
  });
  dlg.showModal();
}

function openScryDialog(n){
  const looked = deck.splice(deck.length - n, n);
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

  function renderList(wrap, arr, {showMoveTo=null}={}) {
    wrap.innerHTML = '';
    arr.forEach((c, idx) => {
      const row = document.createElement('div');
      row.className = 'scry-row';
      row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px; border:1px solid #ddd; border-radius:8px;';
      if (c.imageNormal) row.dataset.imageNormal = c.imageNormal;
      if (c.imageSmall)  row.dataset.imageSmall  = c.imageSmall;

      const name = document.createElement('span');
      name.textContent = c.name || '(Carte)';
      name.className = 'card-name';
      name.style.flex = '1';

      const up = btn('↑','btn btn-up'); up.title = 'Remonter';
      const down = btn('↓','btn btn-down'); down.title = 'Descendre';
      const backOrMove = btn(showMoveTo ? showMoveTo.label : '↩','btn btn-swap');

      up.onclick = () => { if (idx>0) { [arr[idx-1],arr[idx]] = [arr[idx],arr[idx-1]]; renderAll(); } };
      down.onclick = () => { if (idx<arr.length-1) { [arr[idx+1],arr[idx]] = [arr[idx],arr[idx+1]]; renderAll(); } };
      backOrMove.onclick = () => {
        if (showMoveTo) { arr.splice(idx,1); showMoveTo.target.push(c); }
        else { arr.splice(idx,1); src.push(c); }
        renderAll();
      };

      row.addEventListener('mouseenter', () => {
        clearTimeout(__previewTimer);
        __previewTimer = setTimeout(() => {
          if (__previewDlg && window.__previewSourceEl === row) return;
          if (!__isMouseDown && row.matches(':hover')) showCardPreview(row);
        }, 750);
      });
      row.addEventListener('mouseleave', () => {
        clearTimeout(__previewTimer);
        setTimeout(() => { if (!isPointerInside(row)) hideCardPreview(); }, 20);
      });
      row.addEventListener('mousedown', () => { __isMouseDown = true; clearTimeout(__previewTimer); hideCardPreview(); });
      row.addEventListener('mouseup', () => { __isMouseDown = false; });

      if (!showMoveTo) { row.appendChild(up); row.appendChild(down); }
      row.appendChild(name);
      row.appendChild(backOrMove);
      wrap.appendChild(row);
    });

    if (arr.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px; opacity:.7; border:1px dashed #ccc; border-radius:8px; text-align:center;';
      empty.textContent = 'Aucune carte';
      wrap.appendChild(empty);
    }
  }

  function renderReorderable(wrap, arr) {
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
      const back = btn('↩ Source','btn');

      up.onclick = () => { if (i>0) { [arr[i-1], arr[i]] = [arr[i], arr[i-1]]; renderAll(); } };
      down.onclick = () => { if (i<arr.length-1) { [arr[i+1], arr[i]] = [arr[i], arr[i+1]]; renderAll(); } };
      back.onclick = () => { const x = arr.splice(i,1)[0]; src.push(x); renderAll(); };

      row.addEventListener('mouseenter', () => {
        clearTimeout(__previewTimer);
        __previewTimer = setTimeout(() => {
          if (__previewDlg && window.__previewSourceEl === row) return;
          if (!__isMouseDown && row.matches(':hover')) showCardPreview(row);
        }, 750);
      });
      row.addEventListener('mouseleave', () => {
        clearTimeout(__previewTimer);
        setTimeout(() => { if (!isPointerInside(row)) hideCardPreview(); }, 20);
      });
      row.addEventListener('mousedown', () => { __isMouseDown = true; clearTimeout(__previewTimer); hideCardPreview(); });
      row.addEventListener('mouseup', () => { __isMouseDown = false; });

      row.appendChild(up);
      row.appendChild(down);
      row.appendChild(name);
      row.appendChild(back);
      wrap.appendChild(row);
    });
  }

  function renderAll(){
    const wrapSrc   = dlg.querySelector('.scry-src');    wrapSrc.innerHTML = '';
    const wrapTop   = dlg.querySelector('.scry-top');    wrapTop.innerHTML = '';
    const wrapBottom= dlg.querySelector('.scry-bottom'); wrapBottom.innerHTML = '';

    if (src.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px; opacity:.7; border:1px dashed #ccc; border-radius:8px; text-align:center;';
      empty.textContent = 'Aucune carte';
      wrapSrc.appendChild(empty);
    } else {
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

        const toTopBtn = btn('→ Haut','btn');
        const toBottomBtn = btn('→ Bas','btn');
        toTopBtn.onclick = () => { const x = src.splice(i,1)[0]; toTop.push(x); renderAll(); };
        toBottomBtn.onclick = () => { const x = src.splice(i,1)[0]; toBottom.push(x); renderAll(); };

        row.addEventListener('mouseenter', () => {
          clearTimeout(__previewTimer);
          __previewTimer = setTimeout(() => {
            if (__previewDlg && window.__previewSourceEl === row) return;
            if (!__isMouseDown && row.matches(':hover')) showCardPreview(row);
          }, 750);
        });
        row.addEventListener('mouseleave', () => {
          clearTimeout(__previewTimer);
          setTimeout(() => { if (!isPointerInside(row)) hideCardPreview(); }, 20);
        });
        row.addEventListener('mousedown', () => { __isMouseDown = true; clearTimeout(__previewTimer); hideCardPreview(); });
        row.addEventListener('mouseup', () => { __isMouseDown = false; });

        row.appendChild(name);
        row.appendChild(toTopBtn);
        row.appendChild(toBottomBtn);
        wrapSrc.appendChild(row);
      });
    }

    const wrapTop2 = dlg.querySelector('.scry-top');
    const wrapBot2 = dlg.querySelector('.scry-bottom');
    renderReorderable(wrapTop2, toTop);
    renderReorderable(wrapBot2, toBottom);
  }

  dlg.querySelector('.btn-src-to-top')?.addEventListener('click', () => { toTop.push(...src.splice(0)); renderAll(); });
  dlg.querySelector('.btn-src-to-bottom')?.addEventListener('click', () => { toBottom.push(...src.splice(0)); renderAll(); });

  dlg.querySelector('.btn-cancel')?.addEventListener('click', () => {
    deck.push(...looked);
    updateDeckCount();
    dlg.close('cancel');
  });

  dlg.querySelector('.btn-validate')?.addEventListener('click', () => {
    if (toBottom.length) deck.unshift(...toBottom.slice().reverse());
    const topReversed = toTop.slice().reverse();
    deck.push(...topReversed);
    const srcReversed = src.slice().reverse();
    deck.push(...srcReversed);
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

function shuffleDeck() {
  for(let i=deck.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
}

// ---------- Deck depuis localStorage ----------
function tryLoadDeckFromLocalStorage(){
  const raw = localStorage.getItem('mtg.deck');
  if (!raw) return false;
  try {
    const payload = JSON.parse(raw);
    deck = [];
    let counter = 0;

    (payload.cards || []).forEach(c => {
      const qty = Math.max(0, Number(c.qty || 0));
      for (let i = 0; i < qty; i++) {
        deck.push({
          id: `${(c.id || c.name)}-${++counter}`,
          name: c.name,
          type: c.type || '',
          imageSmall: c.imageSmall || null,
          imageNormal: c.imageNormal || c.image || null
        });
      }
    });

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
    localStorage.removeItem('mtg.deck');
    return true;
  } catch(e){
    console.error('Deck import error:', e);
    return false;
  }
}


// ---------- Multi ----------
const ROOM_ID = (() => {
  const raw = new URLSearchParams(location.search).get('room') || 'default';
  const decoded = decodeURIComponent(raw).trim();
  if (/^https?:\/\//i.test(decoded)) {
    try {
      const u = new URL(decoded);
      const inner = u.searchParams.get('room');
      if (inner) return decodeURIComponent(inner).trim();
    } catch {}
  }
  return decoded;
})();

let PLAYER_ID = crypto.randomUUID();
let PLAYER_NAME = "Inconnu";
let socket = null;
const otherStates = {};
let currentView = "self";

// ---------- OVERLAY ADVERSAIRE (grand, au-dessus) ----------
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

  // fermeture
  dlg.querySelector('.opp-close')?.addEventListener('click', () => dlg.close());
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close(); });
  dlg.addEventListener('close', () => {
    if (currentView !== 'self') {
      currentView = 'self';
      const sel = qs('#boardSelect'); if (sel) sel.value = 'self';
    }
  });

  return dlg;
}

function buildOpponentBattlefield(state){
  // --- helpers locaux ---
  const mkLoupeBtn = (title, onClick) => {
    const b = document.createElement('button');
    b.className = 'btn-search';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" fill="none" stroke-width="2"></circle>
        <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
      </svg>`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  };

  const openOppReadonlyList = (title, cards) => {
    const dialog = qs('.modal-search');
    if (!dialog) { alert('Modale de recherche absente du HTML.'); return; }

    const input      = qs('.search-input', dialog);
    const results    = qs('.search-results', dialog);
    const shuffleBtn = qs('.btn-shuffle', dialog);

    if (results) results.innerHTML = '';
    if (shuffleBtn) shuffleBtn.style.display = 'none';
    setSearchTitle(title);

    (cards || []).slice().reverse().forEach((c) => {
      const item = document.createElement('div');
      item.className = 'result-card';
      item.dataset.cardId = c.id;
      item.innerHTML = `
        <span><strong>${c.name || '(Carte)'}</strong> <em>${c.type || ''}</em></span>
      `;
      if (c.imageNormal) item.dataset.imageNormal = c.imageNormal;
      if (c.imageSmall)  item.dataset.imageSmall  = c.imageSmall;

      item.addEventListener('mouseenter', () => {
        clearTimeout(window.__previewTimer);
        window.__previewTimer = setTimeout(() => {
          if (!window.__isMouseDown && item.matches(':hover')) showCardPreview(item);
        }, 750);
      });
      item.addEventListener('mouseleave', () => {
        clearTimeout(window.__previewTimer);
        setTimeout(() => { if (!isPointerInside(item)) hideCardPreview(); }, 20);
      });

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

    const restore = () => { if (shuffleBtn) shuffleBtn.style.display = ''; dialog.removeEventListener('close', restore); };
    dialog.addEventListener('close', restore);

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', 'true');
  };

  // --- LAYOUT overlay ---
  const layout = document.createElement('div');
  layout.className = 'board-layout';

  // ---- Colonne gauche : Vie + Commander + Cimetière + Exil (adversaire) ----
  const aside = document.createElement('aside');
  aside.className = 'side-zones';

  // 🆕 Vie (lecture seule)
  const life = document.createElement('div');
  life.className = 'zone zone--life readonly';
  life.setAttribute('data-zone', 'life');
  life.setAttribute('aria-label', 'Points de vie (adversaire)');
  life.innerHTML = `
    <div class="zone-title">Points de vie</div>
    <div class="life-wrap">
      <div class="life-value readonly" aria-live="polite">${(state?.life ?? 40)}</div>
    </div>`;
  aside.appendChild(life);

  // Commander
  const cmd = document.createElement('div');
  cmd.className = 'zone zone--commander';
  cmd.setAttribute('data-zone', 'commander');
  cmd.setAttribute('aria-label', 'Zone de commandement (adversaire)');
  cmd.innerHTML = `<div class="zone-title">Commander</div><div class="cards"></div>`;
  const cmdHolder = cmd.querySelector('.cards');
  (state?.zones?.commander ?? []).forEach(c => {
    const el = createCardEl({
      id: c.id, name: c.name, type: c.type,
      imageSmall: c.imageSmall || null, imageNormal: c.imageNormal || null
    }, { faceDown: !!c.faceDown, isToken: !!c.isToken });
    el.draggable = false;
    el.classList.toggle('tapped', !!c.tapped);
    el.classList.toggle('phased', !!c.phased);
    cmdHolder.appendChild(el);
  });
  aside.appendChild(cmd);

  // Cimetière (loupe)
  const gy = document.createElement('div');
  gy.className = 'zone zone--cimetiere';
  gy.setAttribute('data-zone', 'cimetiere');
  gy.setAttribute('aria-label', 'Cimetière (adversaire)');
  gy.innerHTML = `<div class="zone-title">Cimetière</div><div class="cards"></div>`;
  gy.querySelector('.zone-title')?.appendChild(
    mkLoupeBtn('Chercher dans le cimetière (adversaire)', () => {
      const list = (state?.stores?.cimetiere ?? state?.zones?.cimetiere ?? []);
      openOppReadonlyList('Cimetière (adversaire)', list);
    })
  );
  aside.appendChild(gy);

  // Exil (loupe)
  const ex = document.createElement('div');
  ex.className = 'zone zone--exil';
  ex.setAttribute('data-zone', 'exil');
  ex.setAttribute('aria-label', 'Exil (adversaire)');
  ex.innerHTML = `<div class="zone-title">Exil</div><div class="cards"></div>`;
  ex.querySelector('.zone-title')?.appendChild(
    mkLoupeBtn('Chercher dans l’exil (adversaire)', () => {
      const list = (state?.stores?.exil ?? state?.zones?.exil ?? []);
      openOppReadonlyList('Exil (adversaire)', list);
    })
  );
  aside.appendChild(ex);

  layout.appendChild(aside);

  // ---- Partie droite : CHAMP DE BATAILLE (3 rangées fixes) ----
  const section = document.createElement('section');
  section.className = 'zone zone--bataille';
  section.setAttribute('data-zone', 'bataille');
  section.setAttribute('aria-label', 'Champ de bataille (adversaire)');
  section.innerHTML = `<div class="zone-title">Champ de bataille</div><div class="battle-rows"></div>`;

  const rowsWrap = section.querySelector('.battle-rows');
  const rows = (state?.zones?.bataille ?? []);

  for (let i = 0; i < 3; i++) {
    const cardsInRow = rows[i] || [];
    const rowEl = document.createElement('div');
    rowEl.className = 'battle-row';
    rowEl.setAttribute('data-subrow', String(i + 1));

    const holder = document.createElement('div');
    holder.className = 'cards cards--battlefield';
    rowEl.appendChild(holder);

    cardsInRow.forEach(c => {
      const el = createCardEl({
        id: c.id, name: c.name, type: c.type,
        imageSmall: c.imageSmall || null, imageNormal: c.imageNormal || null
      }, { faceDown: !!c.faceDown, isToken: !!c.isToken });
      el.draggable = false;
      el.classList.toggle('tapped', !!c.tapped);
      el.classList.toggle('phased', !!c.phased);
      holder.appendChild(el);
    });

    rowsWrap.appendChild(rowEl);
  }

  layout.appendChild(section);
  return layout;
}

function showOpponentOverlay(state, name){
  const dlg = ensureOpponentOverlay();
  const title = dlg.querySelector('.opp-title');
  const body  = dlg.querySelector('.opp-body');
  if (title) title.textContent = `Champ de bataille — ${name || 'Adversaire'}`;
  body.innerHTML = '';
  body.appendChild(buildOpponentBattlefield(state));

  if (!dlg.open) dlg.showModal();
}

function hideOpponentOverlay(){
  const dlg = qs('#opponentOverlay');
  if (dlg?.open) dlg.close();
}

// ---------- sérialisation de mon board ----------
function serializeBoard(){
  // Scope au plateau principal
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
    life: lifeTotal, // 🆕 vie dans l’état partagé
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
    }
  };
}


// ---------- réseau ----------
function setupMultiplayer(){
  const host = location.hostname || '127.0.0.1';
  const protocol = (location.protocol === 'https:' ? 'wss' : 'ws');
  const url = `${protocol}://${host}:8787/?room=${encodeURIComponent(ROOM_ID)}`;

  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    try {
      socket.send(JSON.stringify({
        type: 'state',
        playerId: PLAYER_ID,
        name: PLAYER_NAME,
        state: serializeBoard()
      }));
    } catch {}
    setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'state',
          playerId: PLAYER_ID,
          name: PLAYER_NAME,
          state: serializeBoard()
        }));
      }
    }, 500);
  });

  socket.addEventListener('message', async (ev) => {
    let data = ev.data;
    if (data instanceof Blob) data = await data.text();
    else if (data instanceof ArrayBuffer) data = new TextDecoder().decode(data);

    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type !== 'state' || msg.playerId === PLAYER_ID) return;

    otherStates[msg.playerId] = { name: msg.name, state: msg.state };
    refreshDropdown();

    if (currentView === msg.playerId) {
      showOpponentOverlay(msg.state, msg.name);
    }
  });

  socket.addEventListener('error', (e) => console.warn('[WS] error', e));
  socket.addEventListener('close',  () => console.warn('[WS] closed'));
}

function refreshDropdown(){
  let sel = qs('#boardSelect');
  if (!sel) { ensureBoardViewerDropdown(); sel = qs('#boardSelect'); if (!sel) return; }

  const cur = sel.value;
  sel.innerHTML = `<option value="self">Moi (${PLAYER_NAME})</option>`;

  for (const [pid, obj] of Object.entries(otherStates)) {
    const opt = document.createElement('option');
    opt.value = pid;
    opt.textContent = obj.name || pid;
    sel.appendChild(opt);
  }

  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  else { sel.value = "self"; currentView = "self"; }
}

function refreshView(){
  if (currentView === "self") {
    hideOpponentOverlay();
  } else {
    const o = otherStates[currentView];
    if (o) showOpponentOverlay(o.state, o.name);
  }
}

// ---------- UI: sélecteur de joueur ----------
function ensureBoardViewerDropdown(){
  if (qs('#boardSelect')) return;

  const wrap = document.createElement('div');
  wrap.className = 'viewer-switch';
  wrap.style.cssText = 'position:fixed; top:8px; right:8px; display:flex; gap:6px; align-items:center; z-index:1000;';

  const label = document.createElement('label');
  label.htmlFor = 'boardSelect';
  label.textContent = 'Voir le plateau de :';
  label.style.fontSize = '12px';

  const select = document.createElement('select');
  select.id = 'boardSelect';
  select.style.cssText = 'padding:4px 8px;';
  select.addEventListener('change', (e) => {
    currentView = e.target.value;
    refreshView();
  });

  wrap.appendChild(label);
  wrap.appendChild(select);
  (qs('.board') || document.body).appendChild(wrap);
}

// ---------- Recherche Jetons (Scryfall) ----------
const TOKEN_SEARCH = {
  hasMore: false,
  nextPage: null,
  currentPage: null,
  prevStack: [],
  lastQuery: ''
};

function renderTokenResults(cards){
  const container = qs('.token-results');
  container.innerHTML = '';
  cards.forEach(card => {
    const item = document.createElement('article');
    item.className = 'token-item';
    item.style.cssText = 'border:1px solid #ddd; border-radius:10px; padding:8px; display:grid; gap:6px;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';

    const title = document.createElement('div');
    title.className = 'card-name';
    title.textContent = card.name;

    const actions = document.createElement('div');
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary';
    addBtn.title = 'Ajouter des jetons au champ de bataille';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => askTokenQuantityAndAdd(card));
    actions.appendChild(addBtn);

    head.appendChild(title);
    head.appendChild(actions);
    item.appendChild(head);

    const type = document.createElement('div');
    type.className = 'card-type';
    type.style.opacity = '.8';
    type.textContent = card.type || '';
    item.appendChild(type);

    if (card.imageNormal || card.imageSmall) {
      const img = document.createElement('img');
      img.src = card.imageNormal || card.imageSmall;
      img.alt = card.name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.cssText = 'width:100%; border-radius:8px;';
      item.appendChild(img);
    }

    container.appendChild(item);
  });

  if (!cards.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'opacity:.7; text-align:center; padding:12px;';
    empty.textContent = 'Aucun résultat';
    container.appendChild(empty);
  }

  renderTokenPager();
}

function renderTokenPager(){
  const pager = qs('.token-pager');
  pager.innerHTML = '';

  const btnPrev = document.createElement('button');
  btnPrev.className = 'btn-secondary';
  btnPrev.textContent = '← Précédent';
  btnPrev.disabled = TOKEN_SEARCH.prevStack.length <= 1;
  btnPrev.addEventListener('click', tokenPrevPage);

  const btnNext = document.createElement('button');
  btnNext.className = 'btn-primary';
  btnNext.textContent = 'Suivant →';
  btnNext.disabled = !TOKEN_SEARCH.hasMore;
  btnNext.addEventListener('click', tokenNextPage);

  pager.appendChild(btnPrev);
  pager.appendChild(btnNext);
}

function normalizeTokenCard(c){
  const faces = c.card_faces?.[0];
  const uris  = c.image_uris || faces?.image_uris || {};
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

// Cherche en priorité des jetons FR ; si aucun résultat → fallback sur cartes (FR), puis "toutes langues".
// Conserve la pagination (isNext=true => on suit l’URL Scryfall).
// Recherche prioritaire des jetons ; fallback jetons toutes langues avant les cartes.
// Garde la pagination (isNext => suit l'URL Scryfall).
async function scryfallTokenSearch(queryOrUrl, { isNext=false } = {}) {
  const CARD_LANG = 'fr';

  const makeUrl = (q) =>
    `https://api.scryfall.com/cards/search?order=name&unique=prints&q=${encodeURIComponent(q)}`;

  // --- utils fetch/json ---
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

  // --- pagination directe ---
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

  // Helper: construit un sous-filtre nom (phrase exacte si espaces, sinon simple)
  const nameFilter = q
    ? `(printed_name:"${q}" OR name:"${q}")`
    : '';

  // 1) Jetons FR
  const qTokensFr = `is:token -type:emblem lang:${CARD_LANG} ${nameFilter}`.trim();
  let resp = await fetchJson(makeUrl(qTokensFr));

  // 2) Jetons toutes langues (SEULEMENT si aucun résultat)
  if (isEmpty(resp)) {
    const qTokensAny = `is:token -type:emblem ${nameFilter}`.trim();
    resp = await fetchJson(makeUrl(qTokensAny));
  }

  // Si requête vide : on s’arrête aux jetons (on ne retombe pas vers les cartes)
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

  // 3) Cartes FR (uniquement si aucun jeton trouvé pour une requête donnée)
  if (isEmpty(resp)) {
    const qCardsFr = `lang:${CARD_LANG} ${nameFilter}`.trim();
    resp = await fetchJson(makeUrl(qCardsFr));
  }

  // 4) Cartes toutes langues
  if (isEmpty(resp)) {
    const qCardsAny = `${nameFilter}`.trim() || `"${q}"`;
    resp = await fetchJson(makeUrl(qCardsAny));
  }

  // 5) Dernier essai : match exact oracle
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



async function runTokenSearch(q){
  TOKEN_SEARCH.lastQuery = (q || '').trim();
  TOKEN_SEARCH.prevStack = [];
  const res = await scryfallTokenSearch(TOKEN_SEARCH.lastQuery);
  TOKEN_SEARCH.hasMore = res.hasMore;
  TOKEN_SEARCH.nextPage = res.next;
  TOKEN_SEARCH.currentPage = res.page;
  TOKEN_SEARCH.prevStack.push(res.page);
  renderTokenResults(res.cards);
}

async function tokenNextPage(){
  if (!TOKEN_SEARCH.nextPage) return;
  if (TOKEN_SEARCH.currentPage) {
    const top = TOKEN_SEARCH.prevStack.at(-1);
    if (top !== TOKEN_SEARCH.currentPage) TOKEN_SEARCH.prevStack.push(TOKEN_SEARCH.currentPage);
  }
  const res = await scryfallTokenSearch(TOKEN_SEARCH.nextPage, { isNext:true });
  TOKEN_SEARCH.hasMore = res.hasMore;
  TOKEN_SEARCH.nextPage = res.next;
  TOKEN_SEARCH.currentPage = res.page;
  renderTokenResults(res.cards);
}

async function tokenPrevPage(){
  if (TOKEN_SEARCH.prevStack.length <= 1) return runTokenSearch(TOKEN_SEARCH.lastQuery);
  TOKEN_SEARCH.prevStack.pop();
  const prev = TOKEN_SEARCH.prevStack.at(-1);
  const res = await scryfallTokenSearch(prev, { isNext:true });
  TOKEN_SEARCH.hasMore = res.hasMore;
  TOKEN_SEARCH.nextPage = res.next;
  TOKEN_SEARCH.currentPage = res.page;
  renderTokenResults(res.cards);
}

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
  const rows = qsa('.zone--bataille .battle-row .cards');
  if (!rows.length) return;
  // trouver la rangée la moins chargée
  const counts = rows.map(r => r.querySelectorAll('.card').length);
  for (let i = 0; i < n; i++){
    const minCount = Math.min(...counts);
    const idx = counts.indexOf(minCount);
    const holder = rows[idx];
    const el = createCardEl({
      id: `${card.id}-token-${crypto.randomUUID().slice(0,8)}`,
      name: card.name,
      type: card.type,
      imageSmall: card.imageSmall || null,
      imageNormal: card.imageNormal || null
    }, { faceDown:false, isToken:true });
    holder.appendChild(el);
    counts[idx]++; // mettre à jour localement
  }
}

// Ouvre la modale Tokens
function openTokenDialog(){
  let dlg = qs('#tokenDialog');
  if (!dlg) return;

  const styleInited = document.getElementById('tokenDialogStyles');
  if (!styleInited){
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

  const input = qs('#tokenQuery', dlg);
  const btnSearch = qs('#tokenSearchBtn', dlg);
  const btnClose = qs('#tokenCloseBtn', dlg);

  btnSearch.onclick = () => runTokenSearch(input.value);
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); runTokenSearch(input.value); } };
  btnClose.onclick = () => dlg.close();

  // reset zone
  qs('.token-results', dlg).innerHTML = '';
  runTokenSearch(''); // liste “tous les jetons” triés par nom

  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', 'true');
}

// ---------- Init ----------
function init(){
  ensureBoardViewerDropdown();

  const storedName = localStorage.getItem('mtg.playerName');
  if (storedName) {
    const input = qs('#playerName'); if (input) input.value = storedName;
    PLAYER_NAME = storedName;
  }

  refreshDropdown();

  qsa('.dropzone, .battle-row').forEach(z=>{
    z.addEventListener('dragover',onZoneDragOver);
    z.addEventListener('dragleave',onZoneDragLeave);
    z.addEventListener('drop',onZoneDrop);
  });
  qs('.btn-draw')?.addEventListener('click',spawnTopCardForDrag);

  // 🆕 Listeners vie
  qs('.zone--life .btn-life-plus')?.addEventListener('click', () => changeLife(1));
  qs('.zone--life .btn-life-minus')?.addEventListener('click', () => changeLife(-1));
  qs('.zone--life .life-value')?.addEventListener('click', () => {
    const cur = lifeTotal;
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

  document.addEventListener('click', (ev) => {
    const el = ev.target;
    if (!el || typeof el.closest !== 'function') return;

    if (el.closest('.zone--pioche .btn-search')) { setSearchTitle('Recherche dans la bibliothèque'); openSearchModal(); return; }
    if (el.closest('.zone--pioche .btn-scry'))   { openScryPrompt(); return; }
    if (el.closest('.btn-search-exile'))         { setSearchTitle('Recherche dans l’exil'); openExileSearchModal(); return; }
    if (el.closest('.btn-search-graveyard'))     { setSearchTitle('Recherche dans le cimetière'); openGraveyardSearchModal(); return; }
    if (el.closest('.btn-search-tokens'))        { openTokenDialog(); return; }
  });

  const exilTitle = qs('.zone--exil .zone-title');
  if (exilTitle && !qs('.zone--exil .btn-search-exile')) {
    const btn = document.createElement('button');
    btn.className = 'btn-search btn-search-exile';
    btn.title = 'Chercher dans l’exil';
    btn.setAttribute('aria-label','Chercher dans l’exil');
    btn.style.marginLeft = '6px';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" fill="none" stroke-width="2"></circle>
        <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
      </svg>`;
    exilTitle.appendChild(btn);
  }

  const gyTitle = qs('.zone--cimetiere .zone-title');
  if (gyTitle && !qs('.zone--cimetire .btn-search-graveyard')) {
    const btn = document.createElement('button');
    btn.className = 'btn-search btn-search-graveyard';
    btn.title = 'Chercher dans le cimetière';
    btn.setAttribute('aria-label','Chercher dans le cimetière');
    btn.style.marginLeft = '6px';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" fill="none" stroke-width="2"></circle>
        <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
      </svg>`;
    gyTitle.appendChild(btn);
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

  // Rien de spécial à créer pour la zone Tokens : le HTML la fournit déjà et on branche l’event generic (au dessus)

  const imported = tryLoadDeckFromLocalStorage(); updateDeckCount();
  if(!imported){
    const main = qs('[data-zone="main"] .cards');
    ['Éclair','Forêt','Ours runegrave'].forEach(name=>{
      const f = deck.find(c=>c.name===name); if(f) main.appendChild(createCardEl(f));
    });
  }
  setupMultiplayer();
}

// Sécurité : si on relâche la souris ailleurs, on réactive le survol
document.addEventListener('mouseup', () => { __isMouseDown = false; });

document.addEventListener('DOMContentLoaded',()=>{
  qs('#setNameBtn')?.addEventListener('click',()=>{
    const val=qs('#playerName')?.value.trim();
    if(val){ PLAYER_NAME=val; refreshDropdown(); }
  });
  qs('#boardSelect')?.addEventListener('change',e=>{ currentView=e.target.value; refreshView(); });
  init();
});
