/* card-badges.js
   - Pastille ronde grise cliquable, indépendante de la carte
   - Ctrl + C : toggle pastille sur cartes sélectionnées (.selected) uniquement
   - Liste associée à la pastille (items {label, qty}) avec persistance
   - Bouton "Liste" à côté de "Points de vie" (mêmes items, persistance)
   - RO/lecture seule si la carte ou la zone est .readonly (overlay adverse)
*/

import {
  qs, qsa,
  readBadgeForCard, updateBadgeForCard, deleteBadgeForCard,
  getLifeListItems, setLifeListItems
} from './app-core.js';

/* ======================
   Styles (injectés une fois)
   ====================== */
(function injectStyles(){
  if (document.getElementById('badgeStyles')) return;
  const s = document.createElement('style');
  s.id = 'badgeStyles';
  s.textContent = `
    .card{ position: relative; }
    .card .badge-dot{
      position:absolute;
      bottom:-10px; /* dépasse vers le bas */
      left:50%;
      transform:translateX(-50%);
      width:18px;height:18px;
      border-radius:50%;
      background:#bdbdbd;
      border:2px solid #fff;
      box-shadow:0 1px 3px rgba(0,0,0,.25);
      cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      z-index:3;
    }
    .card.readonly .badge-dot{ cursor:pointer; }

    /* Bouton Liste */
    .btn-life-list {
      margin-left: 6px;
      background: linear-gradient(180deg, #1a2640, #0f1729);
      border: 1px solid #4f8cff;
      color: #4f8cff;
      border-radius: 8px;
      padding: 3px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .btn-life-list:hover { background: rgba(79,140,255,.2); }

    /* Dialogs */
    .list-dialog::backdrop{ background:rgba(0,0,0,.45); }
    .list-sheet{
      background:#fff; border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.35);
      padding:16px; width:min(560px, 95vw); max-height:92vh; display:grid; gap:12px;
    }
    .list-header{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .list-body{ display:grid; gap:8px; overflow:auto; }
    .list-row{
      display:grid; grid-template-columns: 1fr auto 84px auto; gap:8px; align-items:center;
      border:1px solid #eee; border-radius:10px; padding:8px;
    }
    .list-row.readonly{ opacity:1.5; }
    .list-row input[type="text"]{ width:100%; padding:6px 8px; border:1px solid #ddd; border-radius:8px; }
    .qty-wrap{ display:flex; align-items:center; gap:6px; }
    .qty-wrap input[type="number"]{ width:64px; padding:6px 8px; border:1px solid #ddd; border-radius:8px; }
    .qty-btn{ padding:2px 6px; }
    .remove-btn{ padding:4px 8px; }
    .addbar{ display:flex; gap:8px; align-items:center; }
    .addbar input{ flex:1; padding:8px; border:1px solid #ddd; border-radius:8px; }
    .footer-actions{ display:flex; gap:8px; justify-content:flex-end; }
    .btn{ border:1px solid #ddd; background:#f7f7f7; border-radius:8px; padding:6px 10px; cursor:pointer; }
    .btn-primary{ background:#333; color:#fff; border-color:#333; }
    .btn-danger{ background:#e53935; color:#fff; border-color:#e53935; }
    .btn:disabled{ opacity:.6; cursor:not-allowed; }
  `;
  document.head.appendChild(s);
})();

/* =========================
   Outils
   ========================= */
const isInputLike = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
function isReadonly(el){
  return !!(el && (el.classList?.contains('readonly') ||
                   el.closest?.('.readonly') ||
                   qs('#opponentOverlay')?.open));
}

/* =========================
   BADGE: rendu + wiring
   ========================= */
function ensureBadgeDot(cardEl){
  if (!cardEl || cardEl.querySelector('.badge-dot')) return;
  const dot = document.createElement('div');
  dot.className = 'badge-dot';
  dot.title = 'Ouvrir la liste';
  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    const ro = isReadonly(cardEl);

    // 🔁 RÉCUPÈRE les items depuis le dataset si présents (cartes adverses)
    let itemsFromDataset = [];
    try {
      if (cardEl.dataset.badgeItems) itemsFromDataset = JSON.parse(cardEl.dataset.badgeItems) || [];
    } catch { itemsFromDataset = []; }

    openCardListDialog(cardEl.dataset.cardId, ro, itemsFromDataset);
  });
  // Affichage uniquement si .has-badge
  const updateVis = () => { dot.style.display = cardEl.classList.contains('has-badge') ? '' : 'none'; };
  updateVis();
  const mo = new MutationObserver(() => updateVis());
  mo.observe(cardEl, { attributes:true, attributeFilter:['class'] });

  cardEl.appendChild(dot);
}

function installBadgeForCard(cardEl){
  if (!cardEl?.classList?.contains('card')) return;
  const st = readBadgeForCard(cardEl.dataset.cardId);
  // ⚠️ Ne force pas le visuel si déjà fourni (cartes adverses) :
  if (st.has) cardEl.classList.add('has-badge');
  else if (!cardEl.classList.contains('has-badge')) cardEl.classList.remove('has-badge');
  ensureBadgeDot(cardEl);
}

/* Observe l’apparition de cartes (y compris overlay) */
(function observeCards(){
  const scan = () => qsa('.card').forEach(installBadgeForCard);
  scan();
  const mo = new MutationObserver((muts) => {
    muts.forEach(m => {
      m.addedNodes && m.addedNodes.forEach(n => {
        if (n.nodeType === 1){
          if (n.classList?.contains('card')) installBadgeForCard(n);
          n.querySelectorAll?.('.card')?.forEach(installBadgeForCard);
        }
      });
    });
  });
  mo.observe(document.documentElement, { childList:true, subtree:true });
})();

/* =========================
   Dialog — liste par carte
   ========================= */
function buildListDialog({ title='Liste', items=[], readonly=false, onChange, onClose }={}){
  const dlg = document.createElement('dialog');
  dlg.className = 'list-dialog';
  dlg.innerHTML = `
    <div class="list-sheet">
      <div class="list-header">
        <strong>${title}</strong>
        <div style="display:flex; gap:8px; align-items:center;">
          <button type="button" class="btn btn-close" title="Fermer">×</button>
        </div>
      </div>

      <div class="addbar" ${readonly ? 'style="display:none;"' : ''}>
        <input type="text" class="add-input" placeholder="Ajouter un item… (Entrée pour valider)">
        <button type="button" class="btn btn-primary add-btn">Ajouter</button>
      </div>

      <div class="list-body"></div>

      <div class="footer-actions" ${readonly ? 'style="display:none;"' : ''}>
        <button type="button" class="btn btn-primary btn-save">Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(dlg);

  const body = dlg.querySelector('.list-body');
  const input = dlg.querySelector('.add-input');
  const addBtn = dlg.querySelector('.add-btn');
  const btnClose = dlg.querySelector('.btn-close');
  const btnSave = dlg.querySelector('.btn-save');

  let data = items.map(x => ({ label: String(x.label||'').trim(), qty: Math.max(0, Math.trunc(x.qty||0)) }))
                  .filter(x => x.label);

  function render(){
    body.innerHTML = '';
    if (!data.length){
      const empty = document.createElement('div');
      empty.style.cssText = 'opacity:.7; padding:8px; text-align:center;';
      empty.textContent = 'Aucun item';
      body.appendChild(empty);
      return;
    }
    data.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'list-row' + (readonly ? ' readonly' : '');
      row.innerHTML = `
        <input type="text" class="lbl" value="${it.label.replaceAll('"','&quot;')}" ${readonly?'disabled':''} />
        <div class="qty-wrap">
          <button type="button" class="btn qty-btn btn-inc" ${readonly?'disabled':''}>▲</button>
          <button type="button" class="btn qty-btn btn-dec" ${readonly?'disabled':''}>▼</button>
        </div>
        <input type="number" class="qty" min="0" value="${it.qty}" ${readonly?'disabled':''}/>
        <button type="button" class="btn remove-btn ${readonly?'':'btn-danger'}" ${readonly?'disabled':''}>✕</button>
      `;
      const lbl = row.querySelector('.lbl');
      const qn  = row.querySelector('.qty');
      const inc = row.querySelector('.btn-inc');
      const dec = row.querySelector('.btn-dec');
      const rm  = row.querySelector('.remove-btn');

      if (!readonly){
        lbl.addEventListener('input', () => { data[idx].label = lbl.value.trim(); });
        qn.addEventListener('input', () => {
          const n = Math.max(0, Math.trunc(Number(qn.value||0))); data[idx].qty = n; qn.value = String(n);
        });
        inc.addEventListener('click', () => { data[idx].qty = Math.max(0, (data[idx].qty||0) + 1); qn.value = data[idx].qty; });
        dec.addEventListener('click', () => { data[idx].qty = Math.max(0, (data[idx].qty||0) - 1); qn.value = data[idx].qty; });
        rm.addEventListener('click', () => { data.splice(idx,1); render(); });
      }

      body.appendChild(row);
    });
  }

  function addFromInput(){
    const v = input?.value.trim();
    if (!v) return;
    data.push({ label:v, qty: 1 });
    input.value = '';
    render();
  }

  if (!readonly){
    addBtn?.addEventListener('click', addFromInput);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){ e.preventDefault(); addFromInput(); }
    });
    btnSave?.addEventListener('click', () => { onChange?.(data); dlg.close('ok'); });
  }
  btnClose?.addEventListener('click', () => { dlg.close('cancel'); });

  dlg.addEventListener('close', () => {
    onClose?.();
    setTimeout(() => dlg.remove(), 0);
  });

  dlg.showModal();
  render();
  input?.focus();
  return dlg;
}

/* Ouvre la liste associée à une carte
   - NEW: itemsOverride (utilisé en lecture seule côté adverse via dataset.badgeItems) */
function openCardListDialog(cardId, readonly, itemsOverride){
  const base = readBadgeForCard(cardId);
  const items = (readonly && Array.isArray(itemsOverride) && itemsOverride.length)
    ? itemsOverride
    : (base.items || []);

  buildListDialog({
    title: 'Liste — Carte',
    items,
    readonly,
    onChange: (newItems) => {
      if (!readonly) {
        updateBadgeForCard(cardId, { has: true, items: newItems });
      }
    }
  });
}

/* =========================
   Bouton “Liste” Points de vie (LOCAL UNIQUEMENT)
   ========================= */
function ensureLifeListButton(){
  const zone = qs('.zone--life');
  if (!zone) return;

  // 🚫 Ne pas injecter le bouton dans l’overlay adverse (géré par app-multi.js)
  if (zone.closest?.('#opponentOverlay')) return;

  const title = zone.querySelector('.zone-title');
  if (!title) return;
  if (title.querySelector('.btn-life-list')) return;

  const btn = document.createElement('button');
  btn.className = 'btn btn-life-list';
  btn.textContent = 'Liste';
  btn.style.marginLeft = '6px';
  btn.title = 'Ouvrir la liste (Points de vie)';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const ro = isReadonly(zone);
    buildListDialog({
      title: 'Liste — Points de vie',
      items: getLifeListItems(),
      readonly: ro,
      onChange: (items) => setLifeListItems(items)
    });
  });

  title.appendChild(btn);
}

/* Observer (overlay inclu) */
(function observeLifeZone(){
  ensureLifeListButton();
  const mo = new MutationObserver(() => ensureLifeListButton());
  mo.observe(document.documentElement, { childList:true, subtree:true });
})();

/* =========================
   Ctrl + C : toggle pastille
   -> uniquement sur .card.selected
   -> supprime la liste associée quand on retire la pastille
   ========================= */
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.key.toLowerCase() !== 'c') return;
  if (isInputLike(e.target)) return;

  const cards = qsa('.card.selected');
  if (!cards.length) return;

  e.preventDefault();
  e.stopPropagation();

  cards.forEach(card => {
    const id = card.dataset.cardId;
    const st = readBadgeForCard(id);
    const next = !st.has; // toggle
    if (next) {
      updateBadgeForCard(id, { has: true, items: st.items || [] });
      card.classList.add('has-badge');
    } else {
      deleteBadgeForCard(id); // supprime pastille + liste
      card.classList.remove('has-badge');
    }
  });
});

/* =========================
   Initial pass
   ========================= */
document.addEventListener('DOMContentLoaded', () => {
  qsa('.card').forEach(installBadgeForCard);
  ensureLifeListButton();
});
