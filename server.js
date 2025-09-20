// server.js — serveur WebSocket pour MTG
// npm install ws
//Se lance avec node server.js
//npx serve .

// server.js — serveur WebSocket pour MTG
// 1) npm install ws
// 2) node server.js
// (Servez vos fichiers statiques à part, ex. `npx serve .`)

const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.WS_PORT || 8787);
const rooms = new Map(); // roomId -> Set<ws>

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

function normalizeRoom(raw) {
  try {
    const decoded = decodeURIComponent(raw || '').trim();
    if (!decoded) return 'default';
    // Si une URL complète a été mise dans ?room=..., on récupère son ?room= interne
    if (/^https?:\/\//i.test(decoded)) {
      const innerUrl = new URL(decoded);
      const inner = innerUrl.searchParams.get('room');
      if (inner) return decodeURIComponent(inner).trim() || 'default';
    }
    return decoded;
  } catch {
    return (raw || 'default').toString();
  }
}

// Heartbeat pour nettoyer les connexions mortes
function heartbeat() { this.isAlive = true; }

wss.on('connection', (ws, req) => {
  // Détecte la room depuis ?room=xxx
  const u = new URL(req.url, 'http://localhost');
  const roomId = normalizeRoom(u.searchParams.get('room'));

  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  const peers = rooms.get(roomId);

  ws.isAlive = true;
  ws.on('pong', heartbeat);

  peers.add(ws);
  console.log(`[WS] Client connecté à "${roomId}" — ${peers.size} joueur(s)`);

  // Broadcast aux autres clients de la même room
  // Broadcast aux autres clients de la même room (toujours en texte)
ws.on('message', (raw, isBinary) => {
  const text = isBinary
    ? raw.toString()                         // Buffer -> string
    : (typeof raw === 'string' ? raw : String(raw));

  for (const peer of peers) {
    if (peer !== ws && peer.readyState === WebSocket.OPEN) {
      try { peer.send(text); } catch {}
    }
  }
});


  ws.on('close', () => {
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(roomId);
    console.log(`[WS] Déconnexion de "${roomId}" — ${peers.size} restant(s)`);
  });

  ws.on('error', (err) => {
    console.warn(`[WS] Erreur socket (${roomId}):`, err?.message || err);
  });
});

// Ping régulier pour fermer les clients inactifs
const interval = setInterval(() => {
  for (const [roomId, peers] of rooms.entries()) {
    for (const ws of peers) {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        peers.delete(ws);
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
    // Nettoie les rooms vides (sécurité)
    if (peers.size === 0) rooms.delete(roomId);
  }
}, 30000);

wss.on('close', () => clearInterval(interval));

console.log(`[WS] Serveur WebSocket prêt sur ws://0.0.0.0:${PORT}`);
console.log(`[WS] Conseil : ouvrez vos pages via http://<IP_HOTE>:<PORT_HTTP>/index.html?room=ma-partie`);
