// card-badges.js — Pastille cliquable + mini-listes par carte + bouton “Liste” dans Points de vie
// - Ctrl/⌘+C : toggle pastille sur cartes sélectionnées (la pastille dépasse et est cliquable indépendamment)
// - Clic pastille : ouvre une fenêtre avec liste (items + quantités + suppression)
// - Bouton permanent à côté de “Points de vie” : ouvre une liste IDENTIQUE mais globale (sans pastille)

(() => {
  /* =======================
     Styles injectés
     ======================= */
  if (!document.getElementById("cardBadgesStyles")) {
    const st = document.createElement("style");
    st.id = "cardBadgesStyles";
    st.textContent = `
      /* Pastille carte : la carte ne doit pas rogner ce qui dépasse */
      .card.has-badge { position: relative; overflow: visible; z-index: 5; }

      /* Si un parent rogne encore, dé-commente au besoin : */
      /* .cards { overflow: visible !important; } */

      /* Bouton pastille (DOM réel, cliquable) */
      .card > .badge-button{
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        bottom: -14px;                    /* dépasse franchement */
        width: 20px; height: 20px;
        border-radius: 50%;
        background: #8a8f98;              /* gris */
        border: 0;
        box-shadow: 0 0 0 2px rgba(0,0,0,.25), 0 1px 3px rgba(0,0,0,.35);
        cursor: pointer;
        z-index: 10;
      }
      .card > .badge-button:focus-visible{
        outline: 2px solid #3aa0ff;
        outline-offset: 2px;
      }

      /* -------- Dialog (feuille) -------- */
      #badgeDialog::backdrop{ background: rgba(0,0,0,.45); }
      #badgeDialog{
        border: none; padding: 0; overflow: visible;
        background: transparent;
      }
      .badge-sheet{
        background: #fff; border-radius: 14px;
        box-shadow: 0 18px 60px rgba(0,0,0,.35);
        width: min(520px, 95vw); max-height: 92vh;
        display: grid; grid-template-rows: auto auto 1fr auto; gap: 10px;
        padding: 14px;
      }
      .badge-header{
        display: flex; justify-content: space-between; align-items: center; gap: 8px;
      }
      .badge-title{ font-weight: 700; }
      .badge-close{ border: 0; background: #eee; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
      .badge-searchbar{ display: flex; gap: 8px; align-items: center; }
      .badge-input{
        flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 8px;
      }
      .badge-add{
        padding: 8px 10px; border-radius: 8px; border: 0; background: #3aa0ff; color: #fff; cursor: pointer;
      }

      .badge-list{ overflow: auto; display: grid; gap: 8px; padding-right: 2px; }
      .badge-row{
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: 8px;
        border: 1px solid #e6e6e6; border-radius: 10px; padding: 8px;
      }
      .badge-name{ font-weight: 600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      .badge-qty-wrap{ display: flex; align-items: center; gap: 6px; }
      .badge-qty{
        width: 64px; padding: 6px 8px; border: 1px solid #ccc; border-radius: 8px; text-align: right;
      }
      .badge-btn{
        border: 0; background: #f1f1f1; border-radius: 8px; padding: 6px 10px; cursor: pointer;
      }
      .badge-del{
        border: 0; background: #ffebe9; color: #a40000; border-radius: 8px; padding: 6px 10px; cursor: pointer;
      }

      .badge-footer{
        display: flex; justify-content: flex-end; gap: 8px;
      }
      .badge-footer .badge-close{ background: #efefef; }

      /* --- Bouton “Liste” à côté de Points de vie --- */
      .life-list-btn{
        margin-left: 6px;
        border: 0; border-radius: 8px;
        padding: 4px 8px;
        background: #f1f1f1;
        cursor: pointer;
        font-size: 12px;
      }
      .life-list-btn:focus-visible{
        outline: 2px solid #3aa0ff;
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(st);
  }

  /* =======================
     État (en mémoire)
     ======================= */
  // Données par "clé" : cardId (dataset.cardId) ou clé spéciale pour Points de vie
  const LIFE_KEY = '__life__global__';
  const store = new Map(); // key -> { items: [{label, qty}] }

  // Dialog global réutilisé
  let dlg = null;
  let dlgKey = null; // cardId ou LIFE_KEY

  /* =======================
     Helpers DOM / Dialog
     ======================= */
  function ensureDialog(){
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'badgeDialog';
    dlg.innerHTML = `
      <div class="badge-sheet">
        <header class="badge-header">
          <div class="badge-title">Liste</div>
          <button class="badge-close" type="button" aria-label="Fermer">Fermer</button>
        </header>
        <div class="badge-searchbar">
          <input class="badge-input" type="text" placeholder="Ajouter un item (Entrée pour valider)" aria-label="Nom de l’item">
          <button class="badge-add" type="button">Ajouter</button>
        </div>
        <section class="badge-list" aria-live="polite"></section>
        <footer class="badge-footer">
          <button class="badge-close" type="button">Fermer</button>
        </footer>
      </div>
    `;
    document.body.appendChild(dlg);

    dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close(); });

    dlg.querySelectorAll('.badge-close').forEach(b => {
      b.addEventListener('click', () => dlg.close());
    });

    // Actions d'ajout
    const input = dlg.querySelector('.badge-input');
    const addBtn = dlg.querySelector('.badge-add');
    addBtn.addEventListener('click', () => {
      const label = (input.value || "").trim();
      if (!label) return;
      addItemToCurrent(label);
      input.value = '';
      input.focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const label = (input.value || "").trim();
        if (!label) return;
        addItemToCurrent(label);
        input.value = '';
      }
    });

    // Fermer : nettoyer la clé courante
    dlg.addEventListener('close', () => { dlgKey = null; });

    return dlg;
  }

  function dataForKey(key){
    if (!store.has(key)) store.set(key, { items: [] });
    return store.get(key);
  }

  function openDialogForKey(key, titleText){
    dlgKey = key;
    ensureDialog();
    const title = dlg.querySelector('.badge-title');
    title.textContent = titleText || 'Liste';
    renderList();
    if (!dlg.open) dlg.showModal();
    setTimeout(() => dlg.querySelector('.badge-input')?.focus(), 0);
  }

  function openDialogForCard(card){
    const cardId = card?.dataset?.cardId;
    if (!cardId) return;
    const name = card.querySelector('.card-name')?.textContent || 'Carte';
    openDialogForKey(cardId, `Liste — ${name}`);
  }

  function renderList(){
    if (!dlgKey || !dlg) return;
    const list = dlg.querySelector('.badge-list');
    list.innerHTML = '';
    const data = dataForKey(dlgKey);

    if (!data.items.length){
      const empty = document.createElement('div');
      empty.style.cssText = 'opacity:.7; padding:6px; text-align:center;';
      empty.textContent = 'Aucun item — ajoutez un libellé ci-dessus.';
      list.appendChild(empty);
      return;
    }

    data.items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'badge-row';

      const name = document.createElement('div');
      name.className = 'badge-name';
      name.textContent = it.label;

      const qtyWrap = document.createElement('div');
      qtyWrap.className = 'badge-qty-wrap';
      const minus = document.createElement('button');
      minus.type = 'button'; minus.className = 'badge-btn'; minus.textContent = '−';
      const qty = document.createElement('input');
      qty.type = 'number'; qty.className = 'badge-qty'; qty.value = String(it.qty ?? 0);
      qty.min = '0'; qty.step = '1';
      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'badge-btn'; plus.textContent = '+';

      const del = document.createElement('button');
      del.type = 'button'; del.className = 'badge-del'; del.textContent = '✕';

      minus.addEventListener('click', () => { changeQty(idx, (it.qty ?? 0) - 1); });
      plus.addEventListener('click',  () => { changeQty(idx, (it.qty ?? 0) + 1); });
      qty.addEventListener('change',  () => {
        const n = Math.max(0, Math.trunc(Number(qty.value || '0')));
        changeQty(idx, n);
      });
      qty.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const n = Math.max(0, Math.trunc(Number(qty.value || '0')));
          changeQty(idx, n);
        }
      });
      del.addEventListener('click', () => { removeItem(idx); });

      qtyWrap.appendChild(minus);
      qtyWrap.appendChild(qty);
      qtyWrap.appendChild(plus);

      row.appendChild(name);
      row.appendChild(qtyWrap);
      row.appendChild(del);

      list.appendChild(row);
    });
  }

  function addItemToCurrent(label){
    if (!dlgKey) return;
    const data = dataForKey(dlgKey);
    const i = data.items.findIndex(x => x.label.toLowerCase() === label.toLowerCase());
    if (i >= 0) data.items[i].qty = (data.items[i].qty ?? 0) + 1;
    else data.items.push({ label, qty: 1 });
    renderList();
  }

  function changeQty(idx, value){
    const data = dataForKey(dlgKey);
    if (!data.items[idx]) return;
    data.items[idx].qty = Math.max(0, Math.trunc(Number(value || 0)));
    renderList();
  }

  function removeItem(idx){
    const data = dataForKey(dlgKey);
    if (!data.items[idx]) return;
    data.items.splice(idx, 1);
    renderList();
  }

  /* =======================
     Pastille DOM (par carte)
     ======================= */
  function ensureBadgeButton(card){
    if (!card.classList.contains('has-badge')) card.classList.add('has-badge');
    let btn = card.querySelector(':scope > .badge-button');
    if (!btn){
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'badge-button';
      btn.title = 'Ouvrir la liste';
      btn.setAttribute('aria-label', 'Ouvrir la liste de cette carte');
      // éviter d'interférer avec drag/dblclick de la carte
      btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDialogForCard(card);
      });
      card.appendChild(btn);
    }
    return btn;
  }

  function removeBadge(card){
    card.classList.remove('has-badge');
    card.querySelector(':scope > .badge-button')?.remove();
    const key = card.dataset.cardId;
    if (key) {
      store.delete(key);                                  // ❗ supprime la liste associée
      if (dlgKey === key && dlg?.open) dlg.close();       // ferme si on regardait cette carte
    }
  }

  function toggleBadge(cards){
    cards.forEach(card => {
      if (card.classList.contains('has-badge')) removeBadge(card);
      else ensureBadgeButton(card);
    });
  }

  /* =======================
     Raccourci clavier (cartes)
     ======================= */
  const isEditable = (el) =>
    el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  document.addEventListener('keydown', (e) => {
    if (isEditable(e.target)) return;
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;

    const selectedCards = Array.from(document.querySelectorAll('.card.selected'));
    if (!selectedCards.length) return; // pas de sélection → laisser le copier natif

    e.preventDefault();
    e.stopPropagation();

    toggleBadge(selectedCards);
  });

  /* =======================
     Bouton permanent “Liste” (Points de vie)
     ======================= */
  function ensureLifeButton(){
    const title = document.querySelector('.zone--life .zone-title');
    if (!title) return;
    if (title.querySelector('.life-list-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'life-list-btn';
    btn.textContent = 'Liste'; // tu peux mettre une icône si tu veux
    btn.title = 'Ouvrir la liste Points de vie';
    btn.setAttribute('aria-label', 'Ouvrir la liste Points de vie');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDialogForKey(LIFE_KEY, 'Liste — Points de vie');
    });

    title.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureLifeButton);
  } else {
    ensureLifeButton();
  }

  /* =======================
     Nettoyage si carte retirée du DOM
     ======================= */
  const root = document.querySelector('main.board') || document.body;
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.removedNodes && m.removedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        const cards = node.matches?.('.card') ? [node] : Array.from(node.querySelectorAll?.('.card') || []);
        cards.forEach(c => {
          const key = c.dataset?.cardId;
          if (key && store.has(key)) {
            store.delete(key);
            if (dlgKey === key && dlg?.open) dlg.close();
          }
        });
      });
    }
  });
  obs.observe(root, { childList: true, subtree: true });
})();
