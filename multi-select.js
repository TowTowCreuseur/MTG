// multi-select.js — sélection rectangulaire + raccourcis multi-cartes (FR)
// À charger APRÈS app-core.js / app-multi.js
import { qs, qsa, deck, exileStore, graveyardStore, createCardEl } from "./app-core.js";

/* ---------- Styles (surlignage + rectangle façon Windows) ---------- */
(function injectStyles(){
  if (document.getElementById("multiSelectStyles")) return;
  const st = document.createElement("style");
  st.id = "multiSelectStyles";
  st.textContent = `
    .card.selected{
      outline: 3px solid #3aa0ff;
      outline-offset: -3px;
      box-shadow: 0 0 0 2px rgba(58,160,255,.35) inset;
    }
    .selection-rect{
      position: fixed; z-index: 9999; pointer-events:none;
      border: 2px solid rgba(0,120,215,.9);          /* bleu Windows */
      background: rgba(0,120,215,.15);               /* voile bleu */
      box-shadow: 0 0 0 1px rgba(255,255,255,.5) inset;
    }
  `;
  document.head.appendChild(st);
})();

/* ---------- Utilitaires de sélection ---------- */
const selection = new Set();
const cartes = () => qsa(".zone .cards .card");

const cibleEditable = (el) =>
  el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

function ajouter(el){ if (el && !selection.has(el)) { selection.add(el); el.classList.add("selected"); } }
function retirer(el){ if (el && selection.has(el)) { selection.delete(el); el.classList.remove("selected"); } }
function vider(){ [...selection].forEach(retirer); }
function basculer(el){ selection.has(el) ? retirer(el) : ajouter(el); }

function majCompteurDeck(){
  const c = qs('.zone--pioche .deck-count [data-count]');
  if (c) c.textContent = deck().length;
}

/* ---------- Conversions alignées sur app-core ---------- */
function cardElVersObj(el){
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

/* ---------- Actions (Ctrl/⌘ + X / G / D / H) ---------- */
function versExil(){
  if (selection.size === 0) return;
  [...selection].forEach(card => {
    const isToken = card.dataset.isToken === "1";
    if (!isToken) exileStore.push(cardElVersObj(card));
    card.remove();
  });
  vider();
}

function versCimetiere(){
  if (selection.size === 0) return;
  [...selection].forEach(card => {
    const isToken = card.dataset.isToken === "1";
    if (!isToken) graveyardStore.push(cardElVersObj(card));
    card.remove();
  });
  vider();
}

function versDessusPioche(){
  if (selection.size === 0) return;
  const d = deck(); // haut du deck = fin du tableau (même convention que app-core)
  [...selection].forEach(card => {
    const isToken = card.dataset.isToken === "1";
    if (!isToken) d.push(cardElVersObj(card));
    card.remove();
  });
  majCompteurDeck();
  vider();
}

/* ---------- NOUVEAU : renvoyer dans la main (Ctrl/⌘ + H) ---------- */
function conteneurMain(){
  // Adapte le sélecteur si besoin selon ton markup (zone--main .cards est le plus probable)
  return qs('.zone--main .cards') || qs('.zone-main .cards') || qs('.hand .cards');
}

function nettoyerEtatPourMain(card){
  // La main ne doit pas contenir tap/phased
  card.classList.remove('tapped', 'phased');
  // Nettoyage styles de placement/drag éventuels
  card.style.removeProperty('left');
  card.style.removeProperty('top');
  card.style.removeProperty('transform');
  card.style.removeProperty('z-index');
  card.classList.remove('dragging');
}

function versMain(){
  if (selection.size === 0) return;
  const hand = conteneurMain();
  if (!hand) return; // pas de conteneur de main détecté

  [...selection].forEach(card => {
    nettoyerEtatPourMain(card);
    hand.appendChild(card);
  });
  vider();
}


/* ---------- Ctrl/⌘ + M : dupliquer les cartes sélectionnées en tokens ---------- */
function dupliquerEnToken(){
  if (selection.size === 0) return;

  [...selection].forEach(card => {
    // Récupère les données de la carte source
    const obj = cardElVersObj(card);

    // Crée un token (copie avec isToken = true)
    const token = createCardEl({
      id: `token-${obj.id}-${Math.random().toString(36).slice(2,7)}`,
      name: obj.name,
      type: obj.type,
      imageSmall:  card.dataset.imageSmall  || null,
      imageNormal: card.dataset.imageNormal || null,
      isToken: true
    }, { isToken: true });

    // Place le token dans la même zone que la carte originale
    const container = card.parentElement;
    if (container) container.appendChild(token);
  });
}

/* ---------- Ctrl/⌘ + + : modale P/T + effets ---------- */
function openStatsModal(){
  if (selection.size === 0) return;
  const cardEls = [...selection];
  const firstId = cardEls[0].dataset.cardId;
  const existing = readCardStats(firstId);

  let dlg = qs('#dlg-card-stats');
  if (dlg) { try { dlg.close(); dlg.remove(); } catch {} }

  dlg = document.createElement('dialog');
  dlg.id = 'dlg-card-stats';
  dlg.style.cssText = 'border:none;border-radius:14px;padding:0;background:#111826;color:#e6e9ee;box-shadow:0 20px 60px rgba(0,0,0,.6);width:min(420px,95vw);border:1px solid #22314a;';

  const title = cardEls.length > 1 ? `${cardEls.length} cartes sélectionnées` : (cardEls[0].querySelector('.card-name')?.textContent || 'Carte');

  dlg.innerHTML = `
    <div style="padding:20px 22px;">
      <div style="font-weight:700;font-size:16px;margin-bottom:16px;color:#4f8cff;">${title}</div>

      <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;">
        <div style="flex:1;">
          <div style="font-size:11px;color:#9aa3b2;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Force</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button class="stat-btn" data-stat="power" data-delta="-1" style="padding:4px 10px;border-radius:6px;border:1px solid #22314a;background:#0f1524;color:#e6e9ee;cursor:pointer;font-size:16px;">−</button>
            <input id="stat-power" type="number" value="${existing.power ?? 1}" style="width:60px;text-align:center;padding:6px;border-radius:8px;border:1px solid #22314a;background:#0e1522;color:#e6e9ee;font-size:18px;font-weight:700;">
            <button class="stat-btn" data-stat="power" data-delta="1" style="padding:4px 10px;border-radius:6px;border:1px solid #22314a;background:#0f1524;color:#e6e9ee;cursor:pointer;font-size:16px;">+</button>
          </div>
        </div>
        <div style="font-size:24px;color:#9aa3b2;padding-top:16px;">/</div>
        <div style="flex:1;">
          <div style="font-size:11px;color:#9aa3b2;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Endurance</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button class="stat-btn" data-stat="toughness" data-delta="-1" style="padding:4px 10px;border-radius:6px;border:1px solid #22314a;background:#0f1524;color:#e6e9ee;cursor:pointer;font-size:16px;">−</button>
            <input id="stat-toughness" type="number" value="${existing.toughness ?? 1}" style="width:60px;text-align:center;padding:6px;border-radius:8px;border:1px solid #22314a;background:#0e1522;color:#e6e9ee;font-size:18px;font-weight:700;">
            <button class="stat-btn" data-stat="toughness" data-delta="1" style="padding:4px 10px;border-radius:6px;border:1px solid #22314a;background:#0f1524;color:#e6e9ee;cursor:pointer;font-size:16px;">+</button>
          </div>
        </div>
      </div>

      <div style="font-size:11px;color:#9aa3b2;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Effets</div>
      <div id="stats-effects-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;max-height:200px;overflow-y:auto;"></div>
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <input id="stats-new-effect" type="text" placeholder="Ajouter un effet…" style="flex:1;padding:8px;border-radius:8px;border:1px solid #22314a;background:#0e1522;color:#e6e9ee;">
        <button id="stats-add-effect" style="padding:8px 14px;border-radius:8px;border:1px solid #4f8cff;background:#0f1524;color:#4f8cff;cursor:pointer;font-weight:700;">+</button>
      </div>

      <div style="display:flex;gap:8px;justify-content:space-between;">
        <button id="stats-delete" style="padding:8px 14px;border-radius:8px;border:1px solid #5b1f28;background:#1a0a0f;color:#ff6b6b;cursor:pointer;">Supprimer</button>
        <div style="display:flex;gap:8px;">
          <button id="stats-cancel" style="padding:8px 16px;border-radius:8px;border:1px solid #22314a;background:#0f1524;color:#e6e9ee;cursor:pointer;">Annuler</button>
          <button id="stats-save" style="padding:8px 20px;border-radius:8px;border:1px solid #4f8cff;background:#0f1524;color:#4f8cff;cursor:pointer;font-weight:700;">Valider</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(dlg);

  let effects = [...(existing.effects || [])];

  function renderEffects(){
    const list = dlg.querySelector('#stats-effects-list');
    list.innerHTML = '';
    effects.forEach((eff, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center;';
      const txt = document.createElement('span');
      txt.style.cssText = 'flex:1;font-size:13px;padding:4px 0;';
      txt.textContent = eff;
      const del = document.createElement('button');
      del.textContent = '×';
      del.style.cssText = 'padding:2px 8px;border-radius:6px;border:1px solid #5b1f28;background:#1a0a0f;color:#ff6b6b;cursor:pointer;';
      del.onclick = () => { effects.splice(i, 1); renderEffects(); };
      row.appendChild(txt); row.appendChild(del);
      list.appendChild(row);
    });
  }
  renderEffects();

  // Boutons +/-
  dlg.querySelectorAll('.stat-btn').forEach(b => {
    b.addEventListener('click', () => {
      const inputId = 'stat-' + b.dataset.stat;
      const inp = dlg.querySelector('#' + inputId);
      inp.value = (parseInt(inp.value) || 0) + parseInt(b.dataset.delta);
    });
  });

  // Ajouter effet
  const addEffect = () => {
    const inp = dlg.querySelector('#stats-new-effect');
    const v = inp.value.trim();
    if (!v) return;
    effects.push(v);
    inp.value = '';
    renderEffects();
  };
  dlg.querySelector('#stats-add-effect').addEventListener('click', addEffect);
  dlg.querySelector('#stats-new-effect').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addEffect(); }
  });

  // Valider
  dlg.querySelector('#stats-save').addEventListener('click', () => {
    const power     = parseInt(dlg.querySelector('#stat-power').value) || 0;
    const toughness = parseInt(dlg.querySelector('#stat-toughness').value) || 0;
    cardEls.forEach(el => {
      updateCardStats(el.dataset.cardId, { power, toughness, effects });
    });
    dlg.close(); dlg.remove();
  });

  // Supprimer
  dlg.querySelector('#stats-delete').addEventListener('click', () => {
    cardEls.forEach(el => deleteCardStats(el.dataset.cardId));
    dlg.close(); dlg.remove();
  });

  dlg.querySelector('#stats-cancel').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.addEventListener('cancel', e => { e.preventDefault(); dlg.close(); dlg.remove(); });
  dlg.showModal();
}

/* ---------- Rectangle de sélection (garde la sélection + toggle à l’entrée) ---------- */
let dragDebut = null;
let rect = null;
let modeAdditif = false;              // si Ctrl/⌘ enfoncé au départ, on ajoute à la sélection
let aBouge = false;
let ignorerProchainClick = false;
const SEUIL_DRAG = 3;                 // px pour considérer un “vrai” drag
let touchesDansCeDrag = new Set();    // empêche les bascules multiples pendant un même glisser

function demarrerRect(e){
  if (e.button !== 0) return;                       // clic gauche uniquement
  if (e.target.closest('.card')) return;            // ne pas interférer avec le drag d’une carte
  dragDebut = { x: e.clientX, y: e.clientY };
  modeAdditif = e.ctrlKey || e.metaKey;
  aBouge = false;
  touchesDansCeDrag = new Set();

  if (!modeAdditif) vider();

  window.addEventListener('pointermove', majRect, { passive: true });
  window.addEventListener('pointerup', finRect, { passive: true, once: true });
}

function creerRectSiBesoin(){
  if (rect) return;
  rect = document.createElement('div');
  rect.className = 'selection-rect';
  document.body.appendChild(rect);
}

function majRect(e){
  if (!dragDebut) return;

  const dx = Math.abs(e.clientX - dragDebut.x);
  const dy = Math.abs(e.clientY - dragDebut.y);
  if (!aBouge && (dx > SEUIL_DRAG || dy > SEUIL_DRAG)) { aBouge = true; creerRectSiBesoin(); }
  if (!aBouge) return;

  const x1 = Math.min(dragDebut.x, e.clientX);
  const y1 = Math.min(dragDebut.y, e.clientY);
  const x2 = Math.max(dragDebut.x, e.clientX);
  const y2 = Math.max(dragDebut.y, e.clientY);

  rect.style.left   = x1 + "px";
  rect.style.top    = y1 + "px";
  rect.style.width  = (x2 - x1) + "px";
  rect.style.height = (y2 - y1) + "px";

  // 🟦 Toggle à l’entrée : inverse l’état au premier chevauchement
  cartes().forEach(card => {
    if (touchesDansCeDrag.has(card)) return;
    const r = card.getBoundingClientRect();
    const chevauche = !(r.right < x1 || r.left > x2 || r.bottom < y1 || r.top > y2);
    if (chevauche) {
      basculer(card);
      touchesDansCeDrag.add(card);
    }
  });
}

function finRect(){
  window.removeEventListener('pointermove', majRect, { passive: true });
  if (rect) { rect.remove(); rect = null; }
  dragDebut = null;

  if (aBouge) {
    ignorerProchainClick = true;
    setTimeout(() => { ignorerProchainClick = false; }, 0);
  }
  aBouge = false;
  touchesDansCeDrag.clear();
}

document.addEventListener('pointerdown', demarrerRect);

/* ---------- Clic avec délai 0,5 s (uniquement pour clic simple) ---------- */
const TEMPO_CLIC_MS = 500;
const timersParCarte = new Map(); // Element -> setTimeout id

function annulerTousLesTimers(){
  for (const id of timersParCarte.values()) clearTimeout(id);
  timersParCarte.clear();
}
document.addEventListener('dblclick', annulerTousLesTimers, true);

document.addEventListener('click', (e) => {
  if (ignorerProchainClick) { ignorerProchainClick = false; return; }

  const card = e.target.closest('.card');
  if (!card) {
    if (!e.ctrlKey && !e.metaKey) vider();
    return;
  }

  // Ctrl/⌘+clic : toggle immédiat
  if (e.ctrlKey || e.metaKey) {
    const pending = timersParCarte.get(card);
    if (pending) { clearTimeout(pending); timersParCarte.delete(card); }
    basculer(card);
    return;
  }

  // Clic simple : toggle après 0,5 s
  const exist = timersParCarte.get(card);
  if (exist) { clearTimeout(exist); timersParCarte.delete(card); return; }

  const id = setTimeout(() => {
    timersParCarte.delete(card);
    basculer(card);
  }, TEMPO_CLIC_MS);
  timersParCarte.set(card, id);
}, true);

/* ---------- Raccourcis clavier ---------- */
document.addEventListener('keydown', (e) => {
  if (cibleEditable(e.target)) return;   // laisser les champs texte tranquilles
  const aSel = selection.size > 0;
  const mod = e.ctrlKey || e.metaKey;    // Windows Ctrl / macOS ⌘
  if (!mod || !aSel) return;

  const k = e.key.toLowerCase();
  if (k === 'x') { e.preventDefault(); e.stopPropagation(); versExil(); }
  else if (k === 'g') { e.preventDefault(); e.stopPropagation(); versCimetiere(); }
  else if (k === 'd') { e.preventDefault(); e.stopPropagation(); versDessusPioche(); }
  else if (k === 'h') { e.preventDefault(); e.stopPropagation(); versMain(); }
  else if (k === 'm') { e.preventDefault(); e.stopPropagation(); dupliquerEnToken(); }
  else if (k === 'e') { e.preventDefault(); e.stopPropagation(); openStatsModal(); }
});
