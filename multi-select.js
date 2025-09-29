// multi-select.js — sélection rectangulaire + raccourcis multi-cartes (FR)
// À charger APRÈS app-core.js / app-multi.js
import { qs, qsa, deck, exileStore, graveyardStore } from "./app-core.js";

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

/* ---------- Actions (Ctrl/⌘ + X / G / D) ---------- */
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

// Conversions alignées sur app-core
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

  // 🟦 Toggle à l’entrée : dès qu’une carte entre pour la 1ʳᵉ fois dans le rectangle,
  // on inverse son état sélectionné/désélectionné. Pas d’action à la sortie.
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

  // si c’était un vrai drag, on ignore le “click” synthétique qui suit
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

// Annule tous les timers (utile si un dblclick global survient)
function annulerTousLesTimers(){
  for (const id of timersParCarte.values()) clearTimeout(id);
  timersParCarte.clear();
}
// En cas de double-clic natif, on annule toute sélection différée
document.addEventListener('dblclick', annulerTousLesTimers, true);

document.addEventListener('click', (e) => {
  if (ignorerProchainClick) { ignorerProchainClick = false; return; }

  const card = e.target.closest('.card');
  if (!card) {
    if (!e.ctrlKey && !e.metaKey) vider();
    return;
  }

  // Ctrl/⌘+clic : toggle immédiat (pas de délai)
  if (e.ctrlKey || e.metaKey) {
    const pending = timersParCarte.get(card);
    if (pending) { clearTimeout(pending); timersParCarte.delete(card); }
    basculer(card);
    return;
  }

  // Clic simple : attendre 0,5 s puis basculer la carte cliquée (sans vider la sélection)
  const exist = timersParCarte.get(card);
  if (exist) { clearTimeout(exist); timersParCarte.delete(card); return; }

  const id = setTimeout(() => {
    timersParCarte.delete(card);
    basculer(card); // ⬅️ toggle simple, ne désélectionne pas les autres
  }, TEMPO_CLIC_MS);
  timersParCarte.set(card, id);
}, true);

/* ---------- Raccourcis clavier ---------- */
document.addEventListener('keydown', (e) => {
  if (cibleEditable(e.target)) return;   // laisser les champs texte tranquilles
  const aSel = selection.size > 0;
  const mod = e.ctrlKey || e.metaKey;    // Windows Ctrl / macOS ⌘

  // On n’intercepte ces raccourcis que s’il existe au moins une sélection.
  if (!mod || !aSel) return;

  const k = e.key.toLowerCase();
  if (k === 'x') { e.preventDefault(); e.stopPropagation(); versExil(); }
  else if (k === 'g') { e.preventDefault(); e.stopPropagation(); versCimetiere(); }
  else if (k === 'd') { e.preventDefault(); e.stopPropagation(); versDessusPioche(); }
});
