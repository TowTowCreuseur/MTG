/* app.js — interactions de base du plateau
   - Drag & drop de cartes entre les zones (sauf la pioche qui n'accepte pas de drop)
   - Visuels de survol des zones
   - Cartes de démonstration déjà incluses dans la 'main' (HTML)
   Remarque : ce fichier ne gère pas encore la pioche, le tap/untap, ni les règles.
*/

const ZONES = {
  PIOCHE: 'pioche',
  MAIN: 'main',
  BATAILLE: 'bataille',
  CIMETIERE: 'cimetiere',
  EXIL: 'exil',
};

function isDropEnabled(zoneEl){
  return zoneEl?.dataset?.zone !== ZONES.PIOCHE; // la pioche ne reçoit rien pour l'instant
}

function getClosestZone(target){
  return target?.closest?.('.zone') ?? null;
}

function handleDragStart(e){
  const card = e.currentTarget;
  card.classList.add('dragging');
  e.dataTransfer.setData('text/plain', card.dataset.cardId || '');
  // Optionnel : image fantôme plus légère
  if (e.dataTransfer.setDragImage){
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    e.dataTransfer.setDragImage(canvas, 0, 0);
  }
}

function handleDragEnd(e){
  e.currentTarget.classList.remove('dragging');
}

function onZoneDragOver(e){
  const zone = getClosestZone(e.target);
  if (!zone) return;
  if (!isDropEnabled(zone)) return;
  e.preventDefault();
  zone.classList.add('over');
}

function onZoneDragLeave(e){
  const zone = getClosestZone(e.target);
  if (!zone) return;
  zone.classList.remove('over');
}

function onZoneDrop(e){
  const zone = getClosestZone(e.target);
  if (!zone) return;
  if (!isDropEnabled(zone)) return;
  e.preventDefault();
  zone.classList.remove('over');

  const cardId = e.dataTransfer.getData('text/plain');
  const card = document.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`) || document.querySelector('.card.dragging');
  if (!card) return;

  const container = zone.querySelector('.cards') || zone;
  container.appendChild(card);
}

// Initialisation
function init(){
  // Gérer le drag & drop pour toutes les cartes présentes (ex : cartes de démo)
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });

  // Activer le drag & drop sur les zones pertinentes
  document.querySelectorAll('.zone').forEach(zone => {
    zone.addEventListener('dragover', onZoneDragOver);
    zone.addEventListener('dragleave', onZoneDragLeave);
    zone.addEventListener('drop', onZoneDrop);
  });
}

document.addEventListener('DOMContentLoaded', init);
