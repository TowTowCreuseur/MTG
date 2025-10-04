// host.js — Génère le lien d’invitation et ouvre le builder (hébergé par l’hôte)

const $ = (s, el=document)=> el.querySelector(s);
const makeRoom = () => Math.random().toString(36).slice(2,8);

function currentBase() {
  // Exemple: http://192.168.0.12:3000/
  const base = location.pathname.replace(/[^/]+$/, '');
  return `${location.origin}${base}`;
}

function buildBuilderUrl(host, room) {
  const params = new URLSearchParams({
    room,
    wsHost: host,
    wsPort: '8787',
    wsProto: 'ws'
  });
  return `${currentBase()}deck-builder.html?${params.toString()}`;
}

function setInviteLink() {
  const host = $('#serverHost').value.trim();
  const room = $('#roomId').value.trim();
  $('#inviteLink').value = (host && room) ? buildBuilderUrl(host, room) : '';
}

async function checkWebSocketUp(host, { timeoutMs=1500 } = {}) {
  return new Promise((resolve) => {
    let done = false, ws, t;
    const end = (ok) => { if (!done) { done = true; try{ ws && ws.close(); }catch{}; clearTimeout(t); resolve(ok); } };
    try {
      ws = new WebSocket(`ws://${host}:8787/?room=poke`);
    } catch {
      return end(false);
    }
    t = setTimeout(()=> end(false), timeoutMs);
    ws.onopen  = ()=> end(true);
    ws.onerror = ()=> end(false);
  });
}

// --- Copie presse-papiers (HTTPS/localhost + fallback HTTP/file://) ---
async function copyToClipboard(text){
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  // Fallback compatible HTTP / file://
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly','');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function init() {
  // Pré-remplir host avec location.hostname mais éditable (Option A)
  $('#serverHost').value = location.hostname;
  $('#roomId').value = makeRoom();
  setInviteLink();

  $('#regenRoom').onclick = ()=> { $('#roomId').value = makeRoom(); setInviteLink(); };
  $('#serverHost').oninput = setInviteLink;
  $('#roomId').oninput = setInviteLink;

  $('#copyLink').onclick = async ()=> {
    const link = $('#inviteLink').value;
    if (!link) return;
    const ok = await copyToClipboard(link);
    const btn = $('#copyLink');
    const old = btn.textContent;
    btn.textContent = ok ? 'Copié !' : 'Échec';
    setTimeout(()=> btn.textContent = old || 'Copier le lien', 1000);
  };

  $('#checkWs').onclick = async ()=> {
    const host = $('#serverHost').value.trim();
    const ok = await checkWebSocketUp(host);
    $('#wsStatus').innerHTML = ok ? '<span class="ok">WS : OK</span>' : 'WS : indisponible';
    const err = $('#hostError');
    if (err) {
      err.style.display = ok ? 'none' : 'block';
      if (!ok) err.textContent = `Le serveur n'est pas démarré (ws://${host}:8787). Lancez "node server.js".`;
    }
  };

  // Le créateur part aussi via le builder (même lien que les invités)
  $('#openBuilder').onclick = ()=> {
    const link = $('#inviteLink').value;
    if (link) window.location.href = link;
  };
}

document.addEventListener('DOMContentLoaded', init);
