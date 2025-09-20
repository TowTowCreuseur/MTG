/* app.js — interactions plateau + multi
   - Plateau : drag & drop, pioche, recherche, etc.
   - Multi : partage d’état via WebSocket
   - Sessions : création lien d’invitation + rejoindre
*/

const ZONES = {
  PIOCHE: 'pioche',
  MAIN: 'main',
  BATAILLE: 'bataille',
  CIMETIERE: 'cimetiere',
  EXIL: 'exil',
  COMMANDER: 'commander'
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

function isHoveringPreviewOrSource(srcEl){
  const isOver = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = __pointer.x, y = __pointer.y;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  return isOver(window.__previewHot) || isOver(srcEl);
}

// ✅ Nouveau helper : uniquement "le pointeur est-il dans l'élément source ?"
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
    // plateau : on veut SMALL ; aperçu : NORMAL
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

// ---------- Carte ----------
function createCardEl(card, { faceDown=false } = {}) {
  const el = document.createElement('article');
  el.className = 'card' + (faceDown ? ' face-down' : '');
  el.draggable = true;
  el.dataset.cardId = card.id;
  el.tabIndex = 0;

  // on garde les URL dans data-* pour l’aperçu
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
let __previewDlg = null; // <- nouveau: le dialog d’aperçu au top layer
// 🔒 Empêche le lancement d'un aperçu quand on maintient le clic
let __isMouseDown = false;

function showCardPreview(fromEl){
  // si déjà ouvert pour la même source, ne rien faire
  if (__previewDlg && window.__previewSourceEl === fromEl) return;

  // mémorise la source (ligne Scry OU carte du plateau)
  window.__previewSourceEl = fromEl;

  const name = fromEl.querySelector('.card-name')?.textContent || '';
  const type = fromEl.querySelector('.card-type')?.textContent || '';
  const imgSrc =
    fromEl.dataset.imageNormal ||
    fromEl.querySelector('.card-illust img')?.getAttribute('src') ||
    fromEl.dataset.imageSmall ||
    null;

  if (!__previewDlg) {
    __previewDlg = document.createElement('dialog');
    __previewDlg.className = 'preview-dialog';
    __previewDlg.style.border = 'none';
    __previewDlg.style.outline = 'none';   // ✅ enlève le cadre blanc par défaut
    __previewDlg.style.padding = '0';
    __previewDlg.style.background = 'transparent';
    __previewDlg.style.overflow = 'visible';
    __previewDlg.style.width = '100vw';
    __previewDlg.style.height = '100vh';

    // Backdrop transparent (on garde la modale Scry visible dessous)
    const style = document.createElement('style');
    style.textContent = `.preview-dialog::backdrop{background:transparent !important;}`;
    document.head.appendChild(style);

    // ⚠️ on NE met PAS de mouseleave sur le dialog lui-même
    __previewDlg.addEventListener('mousedown', () => { hideCardPreview(); });
    __previewDlg.addEventListener('cancel', (e) => { e.preventDefault(); hideCardPreview(); }); // Esc
  }

  // (Re)construction du contenu
  __previewDlg.innerHTML = '';
  const outer = document.createElement('div');
  outer.style.position = 'fixed';
  outer.style.inset = '0';
  outer.style.display = 'flex';
  outer.style.alignItems = 'center';
  outer.style.justifyContent = 'center';
  outer.style.pointerEvents = 'none'; // overlay non-interactif

  const cardWrap = document.createElement('div');
  cardWrap.style.pointerEvents = 'auto';
  cardWrap.style.background = '#fff';
  cardWrap.style.borderRadius = '12px';
  cardWrap.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';
  cardWrap.style.padding = '12px';
  cardWrap.style.maxWidth = 'min(90vw, 560px)';
  cardWrap.style.width = 'min(90vw, 560px)';
  cardWrap.style.maxHeight = '90vh';
  cardWrap.style.display = 'grid';
  cardWrap.style.gridTemplateRows = imgSrc ? 'auto auto auto' : 'auto auto';
  cardWrap.style.gap = '8px';
  cardWrap.style.cursor = 'default';

  if (imgSrc) {
    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = name;
    img.style.width = '100%';
    img.style.height = 'auto';
    img.style.objectFit = 'contain';
    cardWrap.appendChild(img);
  }
  const title = document.createElement('div');
  title.textContent = name;
  title.style.fontSize = 'clamp(20px, 3.2vw, 28px)';
  title.style.fontWeight = '700';
  cardWrap.appendChild(title);

  if (type) {
    const ty = document.createElement('div');
    ty.textContent = type;
    ty.style.opacity = '0.8';
    ty.style.fontSize = 'clamp(14px, 2.2vw, 18px)';
    cardWrap.appendChild(ty);
  }

  // zone "chaude" (utilisée pour savoir si on survole l’aperçu)
  window.__previewHot = cardWrap;
  cardWrap.addEventListener('mouseleave', () => {
    // ⛔️ Désormais on ignore l'aperçu : si on n'est plus dans la source, on ferme
    setTimeout(() => {
      if (!isPointerInside(window.__previewSourceEl)) hideCardPreview();
    }, 50);
  });

  outer.appendChild(cardWrap);
  __previewDlg.appendChild(outer);

  if (!__previewDlg.open) {
    document.body.appendChild(__previewDlg);
    __previewDlg.showModal(); // Top Layer au-dessus du Scry
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
      // nettoie les pointeurs de survol
      window.__previewHot = null;
      window.__previewSourceEl = null;
    }, 120);
  }
}



// ---------- Stores invisibles (exil / cimetière) ----------
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
    hideCardPreview(); // ⛔️ Cliquer coupe l’aperçu
    const now = Date.now();
    if (now - last < 350) { clicks++; } else { clicks = 1; }
    last = now;
    clearTimeout(timer);
    timer = setTimeout(() => { if (clicks >= 3) togglePhased(cardEl); clicks=0; }, 360);
  });

  // Empêche le lancement pendant clic maintenu, et coupe si en cours
  cardEl.addEventListener('mousedown', () => {
    __isMouseDown = true;
    clearTimeout(__previewTimer);
    hideCardPreview();
  });
  cardEl.addEventListener('mouseup', () => { __isMouseDown = false; });

  // SURVOL 0.75s => aperçu plein écran
  cardEl.addEventListener('mouseenter', () => {
    clearTimeout(__previewTimer);
    __previewTimer = setTimeout(() => {
      if (__previewDlg && window.__previewSourceEl === cardEl) return; // déjà ouvert pour cette source
      if (!__isMouseDown && cardEl.matches(':hover')) showCardPreview(cardEl);
    }, 750);
  });

  // Plateau : fermer dès que le pointeur sort de la carte (peu importe l'aperçu)
  cardEl.addEventListener('mouseleave', () => {
    clearTimeout(__previewTimer);
    setTimeout(() => {
      if (!isPointerInside(cardEl)) hideCardPreview();
    }, 20);
  });
}



function toggleTappedOn(cardEl) { if (cardEl.closest('.zone--bataille')) cardEl.classList.toggle('tapped'); }
function togglePhased(cardEl) { if (cardEl.closest('.zone--bataille')) cardEl.classList.toggle('phased'); }

// ---------- DnD ----------
function handleDragStart(e) { e.currentTarget.classList.add('dragging'); e.dataTransfer.setData('text/plain', e.currentTarget.dataset.cardId || ''); }
function handleDragEnd(e) { 
  e.currentTarget.classList.remove('dragging'); 
  __isMouseDown = false;            // ✅ relâchement après drag
  hideCardPreview();                 // sécurité
}
function onZoneDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('over'); }
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

  // --- EXIL / CIMETIÈRE : ne pas afficher, stocker en mémoire ---
  if (zoneType === ZONES.EXIL) {
    exileStore.push(cardElToObj(card));
    card.remove();
    return;
  }
  if (zoneType === ZONES.CIMETIERE) {
    graveyardStore.push(cardElToObj(card));
    card.remove();
    return;
  }

  // Autres zones : comportement normal
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

  const top = deck.pop(); // retirer du deck
  updateDeckCount();

  // destination = main du joueur
  const hand = qs('.zone--main .cards--hand') || qs('.zone--main .cards');
  const el = createCardEl(top, { faceDown: false });
  hand.appendChild(el);
  el.scrollIntoView({ block: 'nearest', inline: 'end', behavior: 'smooth' });
}

// ---------- Helpers titre modale ----------
function setSearchTitle(txt){
  const t = qs('.search-title'); if (t) t.textContent = txt;
}

// ---------- Recherche (bibliothèque) ----------
function openSearchModal() {
  const dialog = qs('.modal-search');
  if (!dialog) return;

  const input = qs('.search-input', dialog);
  const results = qs('.search-results', dialog);

  // S'assurer que le bouton "Mélanger" est visible pour la bibliothèque
  const shuffle = qs('.btn-shuffle', dialog);
  if (shuffle) shuffle.style.display = '';

  if (results) results.innerHTML = '';

  setSearchTitle('Recherche dans la bibliothèque');

  // Deck : dessus -> bas
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
    btnShuffle.onclick = () => {
      shuffleDeck();
      openSearchModal(); // reconstruit la liste après mélange
    };
  }

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', 'true');
}

// ---------- Recherche (EXIL) ----------
function openExileSearchModal() {
  const dialog = qs('.modal-search');
  if (!dialog) return;

  const input = qs('.search-input', dialog);
  const results = qs('.search-results', dialog);
  const shuffleBtn = qs('.btn-shuffle', dialog);

  if (results) results.innerHTML = '';
  if (shuffleBtn) shuffleBtn.style.display = 'none'; // pas de mélange pour l’exil

  setSearchTitle('Recherche dans l’exil');

  // Exil : plus récent en haut
  [...exileStore].slice().reverse().forEach((c) => {
    const item = document.createElement('div');
    item.className = 'result-card';
    item.dataset.cardId = c.id;
    item.innerHTML = `
      <span><strong>${c.name}</strong> <em>${c.type || ''}</em></span>
      <button class="btn-piocher" type="button">Piocher</button>
    `;
    // "Piocher" => retire de l'exil et ajoute à la main
    item.querySelector('.btn-piocher')?.addEventListener('click', () => {
      const realIdx = exileStore.findIndex(x => x.id === c.id);
      if (realIdx !== -1) {
        const picked = exileStore.splice(realIdx, 1)[0];
        const hand = qs('.zone--main .cards--hand') || qs('.zone--main .cards');
        hand.appendChild(createCardEl({
          id: picked.id,
          name: picked.name,
          type: picked.type,
          imageSmall: picked.imageSmall,
          imageNormal: picked.imageNormal
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

  // réafficher le bouton "Mélanger" pour les prochaines ouvertures deck
  if (shuffleBtn) {
    setTimeout(() => { shuffleBtn.style.display = ''; }, 0);
  }
}

// ---------- Recherche (CIMETIÈRE) ----------
function openGraveyardSearchModal() {
  const dialog = qs('.modal-search');
  if (!dialog) return;

  const input = qs('.search-input', dialog);
  const results = qs('.search-results', dialog);
  const shuffleBtn = qs('.btn-shuffle', dialog);

  if (results) results.innerHTML = '';
  if (shuffleBtn) shuffleBtn.style.display = 'none'; // pas de mélange pour le cimetière

  setSearchTitle('Recherche dans le cimetière');

  // Cimetière : plus récent en haut
  [...graveyardStore].slice().reverse().forEach((c) => {
    const item = document.createElement('div');
    item.className = 'result-card';
    item.dataset.cardId = c.id;
    item.innerHTML = `
      <span><strong>${c.name}</strong> <em>${c.type || ''}</em></span>
      <button class="btn-piocher" type="button">Piocher</button>
    `;
    // "Piocher" => retire du cimetière et ajoute à la main
    item.querySelector('.btn-piocher')?.addEventListener('click', () => {
      const realIdx = graveyardStore.findIndex(x => x.id === c.id);
      if (realIdx !== -1) {
        const picked = graveyardStore.splice(realIdx, 1)[0];
        const hand = qs('.zone--main .cards--hand') || qs('.zone--main .cards');
        hand.appendChild(createCardEl({
          id: picked.id,
          name: picked.name,
          type: picked.type,
          imageSmall: picked.imageSmall,
          imageNormal: picked.imageNormal
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

  // réafficher le bouton "Mélanger" pour les prochaines ouvertures deck
  if (shuffleBtn) {
    setTimeout(() => { shuffleBtn.style.display = ''; }, 0);
  }
}

// ---------- SCRY / REGARD ----------
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
  // Prendre les n cartes du dessus (fin du tableau)
  const looked = deck.splice(deck.length - n, n);
  updateDeckCount();

  // Éléments d’état (références aux vrais objets cartes du deck)
  const src = looked.slice().reverse();        // "Cartes regardées"
  const toTop = [];                  // "Dessus de pioche"
  const toBottom = [];               // "Dessous de pioche"

  // Helpers rendu
  const renderList = (wrap, arr, {showMoveTo=null}={}) => {
    wrap.innerHTML = '';
    arr.forEach((c, idx) => {
      const row = document.createElement('div');
      row.className = 'scry-row';
      row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px; border:1px solid #ddd; border-radius:8px;';
      // ✅ données pour l’aperçu au survol
      if (c.imageNormal) row.dataset.imageNormal = c.imageNormal;
      if (c.imageSmall)  row.dataset.imageSmall  = c.imageSmall;

      const name = document.createElement('span');
      name.textContent = c.name || '(Carte)';
      name.className = 'card-name';         // ✅ pour que showCardPreview récupère le nom
      name.style.flex = '1';

      const up = btn('↑','btn btn-up'); up.title = 'Remonter';
      const down = btn('↓','btn btn-down'); down.title = 'Descendre';
      const backOrMove = btn(showMoveTo ? showMoveTo.label : '↩','btn btn-swap');

      // actions ↑/↓
      up.onclick = () => { if (idx>0) { [arr[idx-1],arr[idx]] = [arr[idx],arr[idx-1]]; renderAll(); } };
      down.onclick = () => { if (idx<arr.length-1) { [arr[idx+1],arr[idx]] = [arr[idx],arr[idx+1]]; renderAll(); } };

      // action déplacer
      backOrMove.onclick = () => {
        if (showMoveTo) { // depuis src -> vers top/bottom
          arr.splice(idx,1);
          showMoveTo.target.push(c);
        } else { // depuis top/bottom -> retour src
          arr.splice(idx,1);
          src.push(c);
        }
        renderAll();
      };

      // ✅ aperçu au survol (même logique que les cartes du plateau)
      // (dans chaque bloc où tu crées "row", après les boutons)
      row.addEventListener('mouseenter', () => {
        clearTimeout(__previewTimer);
        __previewTimer = setTimeout(() => {
          if (__previewDlg && window.__previewSourceEl === row) return; // déjà ouvert pour cette source
          if (!__isMouseDown && row.matches(':hover')) showCardPreview(row);
        }, 750);
      });

      // Scry : fermer dès qu'on sort de la case (on ignore l'aperçu)
      row.addEventListener('mouseleave', () => {
        clearTimeout(__previewTimer);
        setTimeout(() => {
          if (!isPointerInside(row)) hideCardPreview();
        }, 20);
      });

      row.addEventListener('mousedown', () => {
        __isMouseDown = true;
        clearTimeout(__previewTimer);
        hideCardPreview();
      });
      row.addEventListener('mouseup', () => { __isMouseDown = false; });


      // Dans la colonne source on ne montre pas ↑/↓
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
  };

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

  // Actions « tout envoyer »
  dlg.querySelector('.btn-src-to-top')?.addEventListener('click', () => { toTop.push(...src.splice(0)); renderAll(); });
  dlg.querySelector('.btn-src-to-bottom')?.addEventListener('click', () => { toBottom.push(...src.splice(0)); renderAll(); });

  // Boutons finaux
  dlg.querySelector('.btn-cancel')?.addEventListener('click', () => {
    // remettre les cartes sur le dessus DANS L’ORDRE INITIAL (comme si rien ne s’était passé)
    deck.push(...looked); // le dessus est à la fin => on repousse tel quel
    updateDeckCount();
    dlg.close('cancel');
  });

  dlg.querySelector('.btn-validate')?.addEventListener('click', () => {
    // ----- DESSOUS : a,b,c affichées -> c tout au fond, puis b, puis a
    if (toBottom.length) deck.unshift(...toBottom.slice().reverse());

    // ----- DESSUS : la 1ʳᵉ affichée doit être piochée en premier
    const topReversed = toTop.slice().reverse();
    deck.push(...topReversed);

    // ----- RESTE (src) : reviennent sur le dessus
    const srcReversed = src.slice().reverse();
    deck.push(...srcReversed);

    updateDeckCount();
    dlg.close('ok');
  });

  // Rendu initial + helpers de rendu
  const wrapSrc = dlg.querySelector('.scry-src');
  const wrapTop = dlg.querySelector('.scry-top');
  const wrapBottom = dlg.querySelector('.scry-bottom');

  function renderAll(){
    // Reset
    wrapSrc.innerHTML = '';
    wrapTop.innerHTML = '';
    wrapBottom.innerHTML = '';

    const addEmpty = (wrap) => {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px; opacity:.7; border:1px dashed #ccc; border-radius:8px; text-align:center;';
      empty.textContent = 'Aucune carte';
      wrap.appendChild(empty);
    };

    // ----- Source : Cartes regardées -----
    if (src.length === 0) {
      addEmpty(wrapSrc);
    } else {
      src.forEach((c, i) => {
        const row = document.createElement('div');
        row.className = 'scry-row';
        row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px; border:1px solid #ddd; border-radius:8px;';
        // ✅ données pour l’aperçu
        if (c.imageNormal) row.dataset.imageNormal = c.imageNormal;
        if (c.imageSmall)  row.dataset.imageSmall  = c.imageSmall;

        const name = document.createElement('span');
        name.textContent = c.name || '(Carte)';
        name.className = 'card-name';
        name.style.flex = '1';

        // Envoyer vers "Dessus" ou "Dessous"
        const toTopBtn = btn('→ Haut','btn'); toTopBtn.title = 'Mettre dans "Dessus de pioche"';
        const toBottomBtn = btn('→ Bas','btn'); toBottomBtn.title = 'Mettre dans "Dessous de pioche"';
        toTopBtn.onclick = () => { const x = src.splice(i,1)[0]; toTop.push(x); renderAll(); };
        toBottomBtn.onclick = () => { const x = src.splice(i,1)[0]; toBottom.push(x); renderAll(); };

        // ✅ aperçu au survol
        row.addEventListener('mouseenter', () => {
          clearTimeout(__previewTimer);
          __previewTimer = setTimeout(() => {
            if (__previewDlg && window.__previewSourceEl === row) return; // déjà ouvert pour cette source
            if (!__isMouseDown && row.matches(':hover')) showCardPreview(row);
          }, 750);
        });
        //2222222222222222222222222222222222222
        row.addEventListener('mouseleave', () => {
          clearTimeout(__previewTimer);
          setTimeout(() => {
            if (!isPointerInside(row)) hideCardPreview();
          }, 20);
        });

        row.addEventListener('mousedown', () => { __isMouseDown = true; clearTimeout(__previewTimer); hideCardPreview(); });
        row.addEventListener('mouseup', () => { __isMouseDown = false; });

        row.appendChild(name);
        row.appendChild(toTopBtn);
        row.appendChild(toBottomBtn);
        wrapSrc.appendChild(row);
      });
    }

    // Small helper pour lignes avec ↑/↓ + ↩ Source
    const renderReorderable = (wrap, arr) => {
      if (arr.length === 0) { addEmpty(wrap); return; }
      arr.forEach((c, i) => {
        const row = document.createElement('div');
        row.className = 'scry-row';
        row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px; border:1px solid #ddd; border-radius:8px;';
        // ✅ données pour l’aperçu
        if (c.imageNormal) row.dataset.imageNormal = c.imageNormal;
        if (c.imageSmall)  row.dataset.imageSmall  = c.imageSmall;

        const up = btn('↑','btn btn-up'); up.title = 'Remonter';
        const down = btn('↓','btn btn-down'); down.title = 'Descendre';
        const name = document.createElement('span'); name.textContent = c.name || '(Carte)'; name.className = 'card-name'; name.style.flex = '1';
        const back = btn('↩ Source','btn');

        up.onclick = () => { if (i>0) { [arr[i-1], arr[i]] = [arr[i], arr[i-1]]; renderAll(); } };
        down.onclick = () => { if (i<arr.length-1) { [arr[i+1], arr[i]] = [arr[i], arr[i+1]]; renderAll(); } };
        back.onclick = () => { const x = arr.splice(i,1)[0]; src.push(x); renderAll(); };

        // ✅ aperçu au survol
        row.addEventListener('mouseenter', () => {
          clearTimeout(__previewTimer);
          __previewTimer = setTimeout(() => {
            if (__previewDlg && window.__previewSourceEl === row) return; // déjà ouvert pour cette source
            if (!__isMouseDown && row.matches(':hover')) showCardPreview(row);
          }, 750);
        });
        //33333333333333333333333333333333"
        row.addEventListener('mouseleave', () => {
          clearTimeout(__previewTimer);
          setTimeout(() => {
            if (!isPointerInside(row)) hideCardPreview();
          }, 20);
        });

        row.addEventListener('mousedown', () => { __isMouseDown = true; clearTimeout(__previewTimer); hideCardPreview(); });
        row.addEventListener('mouseup', () => { __isMouseDown = false; });

        row.appendChild(up);
        row.appendChild(down);
        row.appendChild(name);
        row.appendChild(back);
        wrap.appendChild(row);
      });
    };

    // ----- Dessus / Dessous -----
    renderReorderable(wrapTop, toTop);
    renderReorderable(wrapBottom, toBottom);
  }

  dlg.addEventListener('close', () => { dlg.remove(); });
  dlg.showModal();
  renderAll();
}



// ✅ Fermeture auto globale : si l’aperçu est ouvert et le pointeur sort de la source, on ferme
document.addEventListener('pointermove', () => {
  if (__previewDlg && window.__previewSourceEl && !isPointerInside(window.__previewSourceEl)) {
    hideCardPreview();
  }
}, { passive: true });


function shuffleDeck() { for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];} }

// ---------- Deck depuis localStorage ----------
function tryLoadDeckFromLocalStorage(){
  const raw = localStorage.getItem('mtg.deck');
  if (!raw) return false;
  try {
    const payload = JSON.parse(raw);
    deck = [];
    let counter = 0;
    (payload.cards || []).forEach(c => {
      deck.push({
        id: `${(c.id||c.name)}-${++counter}`,
        name: c.name,
        type: c.type || '',
        imageSmall: c.imageSmall || null,
        imageNormal: c.imageNormal || c.image || null
      });
    });
    const cmdZone = qs('.zone--commander .cards');
    if (cmdZone) {
      cmdZone.innerHTML = '';
      (payload.commanders || []).forEach(c => {
        const el = createCardEl({
          id: `${(c.id||c.name)}-cmd-${Math.random().toString(36).slice(2,7)}`,
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
  } catch(e){ console.error('Deck import error:', e); return false; }
}

// ---------- Multi ----------
const ROOM_ID = new URLSearchParams(location.search).get('room') || 'default';
let PLAYER_ID = crypto.randomUUID();
let PLAYER_NAME = "Inconnu";
let socket = null;
const otherStates = {};
let currentView = "self";

function serializeBoard(){ /* sérialise DOM en JSON */ 
  const cardToObj = (el) => ({
    id: el.dataset.cardId,
    name: el.querySelector('.card-name')?.textContent || '',
    type: el.querySelector('.card-type')?.textContent || '',
    imageSmall: el.dataset.imageSmall || null,
    imageNormal: el.dataset.imageNormal || null,
    tapped: el.classList.contains('tapped'),
    phased: el.classList.contains('phased'),
    faceDown: el.classList.contains('face-down'),
  });
  const simpleZone = (sel) => Array.from(document.querySelectorAll(sel + ' .cards .card')).map(cardToObj);
  const battlefield = Array.from(document.querySelectorAll('.battle-row')).map(row =>
    Array.from(row.querySelectorAll('.cards .card')).map(cardToObj)
  );
  return {
    ts: Date.now(),
    zones: {
      pioche: simpleZone('.zone--pioche'),
      commander: simpleZone('.zone--commander'),
      cimetiere: simpleZone('.zone--cimetiere'),
      exil: simpleZone('.zone--exil'),
      main: simpleZone('.zone--main'),
      bataille: battlefield
    }
  };
}
function renderBoard(state,isSelf){
  const container = qs('.board .board-layout') || qs('#zones') || document.body;
  container.innerHTML = '';
  const side = document.createElement('aside');
  side.className = 'side-zones';
  const makeZone = (cls, title, cards=[]) => {
    const z=document.createElement('div'); z.className=`zone ${cls}`; z.innerHTML=`<div class="zone-title">${title}</div><div class="cards"></div>`;
    const holder=z.querySelector('.cards');
    cards.forEach(c=>{
      const el=createCardEl({id:c.id,name:c.name,type:c.type,imageSmall:c.imageSmall||null,imageNormal:c.imageNormal||null},{faceDown:!!c.faceDown});
      el.draggable=false; el.classList.toggle('tapped',!!c.tapped); el.classList.toggle('phased',!!c.phased);
      holder.appendChild(el);
    });
    return z;
  };
  side.appendChild(makeZone('zone--pioche','Pioche', state.zones.pioche||[]));
  side.appendChild(makeZone('zone--commander','Commander', state.zones.commander||[]));
  side.appendChild(makeZone('zone--cimetiere','Cimetière', state.zones.cimetiere||[]));
  side.appendChild(makeZone('zone--exil','Exil', state.zones.exil||[]));
  container.appendChild(side);
  const mid=document.createElement('section'); mid.className='zone zone--bataille'; mid.innerHTML='<div class="zone-title">Champ de bataille</div><div class="battle-rows"></div>';
  const rowsWrap=mid.querySelector('.battle-rows');
  (state.zones.bataille||[]).forEach(row=>{
    const rowEl=document.createElement('div'); rowEl.className='battle-row';
    const holder=document.createElement('div'); holder.className='cards cards--battlefield'; rowEl.appendChild(holder);
    row.forEach(c=>{
      const el=createCardEl({id:c.id,name:c.name,type:c.type,imageSmall:c.imageSmall||null,imageNormal:c.imageNormal||null},{faceDown:!!c.faceDown});
      el.draggable=false; el.classList.toggle('tapped',!!c.tapped); el.classList.toggle('phased',!!c.phased);
      holder.appendChild(el);
    });
    rowsWrap.appendChild(rowEl);
  });
  container.appendChild(mid);
  if(isSelf){
    const mainZ=qs('.zone--main .cards');
    if(mainZ) {
      mainZ.innerHTML='';
      (state.zones.main||[]).forEach(c=>{
        const el=createCardEl({id:c.id,name:c.name,type:c.type,imageSmall:c.imageSmall||null,imageNormal:c.imageNormal||null},{faceDown:!!c.faceDown});
        el.classList.toggle('tapped',!!c.tapped); el.classList.toggle('phased',!!c.phased);
        mainZ.appendChild(el);
      });
    }
  }
}
function setupMultiplayer(){
  const url=`ws://${location.hostname}:8787/?room=${encodeURIComponent(ROOM_ID)}`;
  socket=new WebSocket(url);
  socket.addEventListener('open',()=>{
    setInterval(()=>{
      if(socket?.readyState===WebSocket.OPEN){
        socket.send(JSON.stringify({type:'state',playerId:PLAYER_ID,name:PLAYER_NAME,state:serializeBoard()}));
      }
    },500);
  });
  socket.addEventListener('message',ev=>{
    const msg=JSON.parse(ev.data);
    if(msg.type!=='state'||msg.playerId===PLAYER_ID) return;
    otherStates[msg.playerId]={name:msg.name,state:msg.state};
    refreshDropdown(); refreshView();
  });
}
function refreshDropdown(){
  const sel=qs('#boardSelect'); if(!sel) return;
  const cur=sel.value;
  sel.innerHTML=`<option value="self">Moi (${PLAYER_NAME})</option>`;
  for(const [pid,obj] of Object.entries(otherStates)){
    const opt=document.createElement('option'); opt.value=pid; opt.textContent=obj.name||pid; sel.appendChild(opt);
  }
  if([...sel.options].some(o=>o.value===cur)) sel.value=cur; else {sel.value="self"; currentView="self";}
}
function refreshView(){
  const zonesWrap=qs('.board .board-layout') || qs('#zones');
  if(currentView==="self"){ renderBoard(serializeBoard(),true); }
  else { const o=otherStates[currentView]; if(o) renderBoard(o.state,false); }
}

// ---------- Init ----------
function init(){
  // Auto-préremplir le pseudo depuis le deck builder (localStorage)
  const storedName = localStorage.getItem('mtg.playerName');
  if (storedName) {
    const input = qs('#playerName'); if (input) input.value = storedName;
    PLAYER_NAME = storedName;
  }

  qsa('.dropzone, .battle-row').forEach(z=>{z.addEventListener('dragover',onZoneDragOver);z.addEventListener('dragleave',onZoneDragLeave);z.addEventListener('drop',onZoneDrop);});
  qs('.btn-draw')?.addEventListener('click',spawnTopCardForDrag);

  // --- DÉLÉGATION DE CLICS POUR LES LOUPES (robuste face au re-render de renderBoard) ---
  document.addEventListener('click', (ev) => {
    const el = ev.target;
    if (!el || typeof el.closest !== 'function') return;

    // Pioche (deck)
    if (el.closest('.zone--pioche .btn-search')) {
      setSearchTitle('Recherche dans la bibliothèque');
      openSearchModal();
      return;
    }
    // Scry (Regard)
    if (el.closest('.zone--pioche .btn-scry')) {
      openScryPrompt();
      return;
    }
    // Exil
    if (el.closest('.btn-search-exile')) {
      setSearchTitle('Recherche dans l’exil');
      openExileSearchModal();
      return;
    }
    // Cimetière
    if (el.closest('.btn-search-graveyard')) {
      setSearchTitle('Recherche dans le cimetière');
      openGraveyardSearchModal();
      return;
    }
  });

  // Injection d’une loupe dans la zone EXIL (sans toucher le HTML) — seulement si absente
  const exilTitle = qs('.zone--exil .zone-title');
  if (exilTitle && !qs('.zone--exil .btn-search-exile')) {
    const btn = document.createElement('button');
    btn.className = 'btn-search btn-search-exile'; // même style que la loupe de la pioche
    btn.title = 'Chercher dans l’exil';
    btn.setAttribute('aria-label','Chercher dans l’exil');
    btn.style.marginLeft = '6px';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" fill="none" stroke-width="2"></circle>
        <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
      </svg>`;
    // Pas besoin d'attacher ici : la délégation captera le clic
    exilTitle.appendChild(btn);
  }

  // Injection d’une loupe dans la zone CIMETIÈRE (sans toucher le HTML) — seulement si absente
  const gyTitle = qs('.zone--cimetiere .zone-title');
  if (gyTitle && !qs('.zone--cimetire .btn-search-graveyard')) {
    const btn = document.createElement('button');
    btn.className = 'btn-search btn-search-graveyard'; // même style
    btn.title = 'Chercher dans le cimetière';
    btn.setAttribute('aria-label','Chercher dans le cimetière');
    btn.style.marginLeft = '6px';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" fill="none" stroke-width="2"></circle>
        <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
      </svg>`;
    // Pas besoin d'attacher ici : la délégation captera le clic
    gyTitle.appendChild(btn);
  }

  // Injection d’un œil "Scry" dans la zone PIOCHE (sans toucher le HTML) — seulement si absent
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
    // Délégation captera le clic
    piocheTitle.appendChild(btnEye);
  }

  const imported=tryLoadDeckFromLocalStorage(); updateDeckCount();
  if(!imported){
    const main=qs('[data-zone="main"] .cards');
    ['Éclair','Forêt','Ours runegrave'].forEach(name=>{
      const f=deck.find(c=>c.name===name); if(f) main.appendChild(createCardEl(f));
    });
  }
  setupMultiplayer();
}

// ✅ Sécurité : si on relâche la souris ailleurs, on réactive le survol
document.addEventListener('mouseup', () => { __isMouseDown = false; });

document.addEventListener('DOMContentLoaded',()=>{
  qs('#setNameBtn')?.addEventListener('click',()=>{const val=qs('#playerName')?.value.trim(); if(val){PLAYER_NAME=val; refreshDropdown();}});
  qs('#boardSelect')?.addEventListener('change',e=>{currentView=e.target.value; refreshView();});
  init();
});
