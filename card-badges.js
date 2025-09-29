// card-badges.js — Ctrl/⌘+C : toggle d’une pastille grise persistante sous chaque carte sélectionnée
// À charger après app-multi.js et multi-select.js

(() => {
  /* ---------- Styles ---------- */
  if (!document.getElementById("cardBadgesStyles")) {
    const st = document.createElement("style");
    st.id = "cardBadgesStyles";
    st.textContent = `
      /* La carte ne doit pas rogner la pastille qui dépasse */
      .card.has-badge { position: relative; overflow: visible; z-index: 5; }

      /* Si un parent rogne encore, dé-commente au besoin : */
      /* .cards { overflow: visible !important; } */

      /* Pastille grise centrée, qui dépasse franchement */
      .card.has-badge::after{
        content:"";
        position:absolute;
        left:50%;
        transform: translateX(-50%) scale(1);
        bottom:-14px;                   /* dépasse sous la carte */
        width:18px; height:18px;
        border-radius:50%;
        background:#8a8f98;
        box-shadow: 0 0 0 2px rgba(0,0,0,.25), 0 1px 3px rgba(0,0,0,.35);
        pointer-events:none;
        z-index:10;
        opacity:0; transform-origin:center;
        animation: badgePop .18s ease-out forwards;
      }
      @keyframes badgePop{
        from { opacity:0; transform: translateX(-50%) scale(.7); }
        to   { opacity:1; transform: translateX(-50%) scale(1);  }
      }
    `;
    document.head.appendChild(st);
  }

  const isEditable = (el) =>
    el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  /* ---------- Raccourci : Ctrl/⌘ + C (toggle pastille) ---------- */
  document.addEventListener('keydown', (e) => {
    if (isEditable(e.target)) return;                       // laisser le copier dans les champs
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;

    const cards = Array.from(document.querySelectorAll('.card.selected'));
    if (cards.length === 0) return;                         // rien de sélectionné → ne bloque pas

    e.preventDefault();
    e.stopPropagation();

    // Toggle de la pastille via une classe persistante
    cards.forEach(card => {
      if (card.classList.contains('has-badge')) {
        card.classList.remove('has-badge');                 // 2e Ctrl+C : supprime
      } else {
        card.classList.add('has-badge');                    // 1er Ctrl+C : ajoute
      }
    });
  });
})();
