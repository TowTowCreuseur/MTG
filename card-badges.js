// card-badges.js — Pastille cliquable + mini-liste par carte
// Raccourci : Ctrl/⌘+C pour ajouter/retirer la pastille sur les cartes sélectionnées
// Clic sur la pastille : ouvre un dialog pour gérer une liste d'items numérotés

(() => {
  /* =======================
     Styles injectés
     ======================= */
  if (!document.getElementById("cardBadgesStyles")) {
    const st = document.createElement("style");
    st.id = "cardBadgesStyles";
    st.textContent = `
      /* La carte ne doit pas rogner la pastille qui dépasse */
      .card.has-badge { position: relative; overflow: visible; z-index: 5; }

      /* Si un parent rogne encore, dé-commente au besoin : */
      /* .cards { overflow: visible !important; } */

      /* Bouton pastille (DOM réel, cliquable indépendamment de la carte) */
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
        grid-template-columns: 1fr auto auto auto;
        align-items: center;
        gap: 8px;
        border: 1px solid #e6e6e6; border-radius: 10px; padding: 8px;
      }
      .badge-name{ font-weight: 600; }
      .badge-qty-wrap{ display: flex; align-items: center; gap: 6px; }
      .badge-qty{
        width: 64px; padding: 6px 8px; border: 1px solid #ccc; border-radius: 8px; text-align: right;
      }
      .badge-step{
        display: inline-flex; gap: 6px;
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
    `;
    document.head.appendChild(st);
  }

  /* =======================
     État (en mémoire)
     ======================= */
  // Données par carte : key = cardId (dataset.cardId) -> { items: [{label, qty}], ... }
  const store = new Map();

  // Dialog global réutilisé
  let dlg = null;
  let dlgCardId = null;

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
          <div class="badge-title">Liste de la carte</div>
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

    // Fermer : nettoyer l'id courant
    dlg.addEventListener('close', () => { dlgCardId = null; });

    return dlg;
  }

  function openDialogForCard(card){
    const cardId = card?.dataset?.cardId;
    if (!cardId) return;
    dlgCardId = cardId;
    ensureDialog();
    // Titre contextualisé
    const title = dlg.querySelector('.badge-title');
    const name = card.querySelector('.card-name')?.textContent || 'Carte';
    title.textContent = `Liste — ${name}`;

    renderList();
    if (!dlg.open) dlg.showModal();
    // Focus input
    setTimeout(() => dlg.querySelector('.badge-input')?.focus(), 0);
  }

  function dataForCard(cardId){
    if (!store.has(cardId)) store.set(cardId, { items: [] });
    return store.get(cardId);
  }

  function renderList(){
    if (!dlgCardId || !dlg) return;
    const list = dlg.querySelector('.badge-list');
    list.innerHTML = '';
    const data = dataForCard(dlgCardId);

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

      // Events
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
    if (!dlgCardId) return;
    const data = dataForCard(dlgCardId);
    // Si libellé déjà présent (insensible à la casse), on incrémente
    const i = data.items.findIndex(x => x.label.toLowerCase() === label.toLowerCase());
    if (i >= 0) data.items[i].qty = (data.items[i].qty ?? 0) + 1;
    else data.items.push({ label, qty: 1 });
    renderList();
  }

  function changeQty(idx, value){
    const data = dataForCard(dlgCardId);
    if (!data.items[idx]) return;
    data.items[idx].qty = Math.max(0, Math.trunc(Number(value || 0)));
    renderList();
  }

  function removeItem(idx){
    const data = dataForCard(dlgCardId);
    if (!data.items[idx]) return;
    data.items.splice(idx, 1);
    renderList();
  }

  /* =======================
     Pastille DOM
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
      // Ne pas laisser ce clic “toucher” la carte (drag/dblclick)
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
    const cardId = card.dataset.cardId;
    if (cardId) {
      store.delete(cardId);                       // ❗ supprime la liste associée
      if (dlgCardId === cardId && dlg?.open) dlg.close(); // ferme si on regardait cette carte
    }
  }

  function toggleBadge(cards){
    cards.forEach(card => {
      if (card.classList.contains('has-badge')) removeBadge(card);
      else ensureBadgeButton(card);
    });
  }

  /* =======================
     Raccourci clavier
     ======================= */
  const isEditable = (el) =>
    el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  document.addEventListener('keydown', (e) => {
    if (isEditable(e.target)) return;
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;

    const selectedCards = Array.from(document.querySelectorAll('.card.selected'));
    if (!selectedCards.length) return; // pas de sélection → on ne bloque pas le copier

    e.preventDefault();
    e.stopPropagation();

    toggleBadge(selectedCards);
  });

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
          const id = c.dataset?.cardId;
          if (id && store.has(id)) {
            store.delete(id);
            if (dlgCardId === id && dlg?.open) dlg.close();
          }
        });
      });
    }
  });
  obs.observe(root, { childList: true, subtree: true });
})();
