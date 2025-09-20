// server.js — serveur WebSocket pour MTG
// npm install ws
//Se lance avec node server.js
//npx serve .

// server.js — WebSocket (CommonJS) pour MTG
// 1) npm i ws
// 2) node server.js

const { WebSocketServer } = require('ws');

const PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 8787;
const rooms = new Map(); // roomId -> Set(ws)

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

// Heartbeat pour nettoyer les connexions mortes
function heartbeat() { this.isAlive = true; }
wss.on('connection', (ws, req) => {
  // Detecte la room depuis ?room=xxx
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.searchParams.get('room') || 'default';

  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  const peers = rooms.get(roomId);

  ws.isAlive = true;
  ws.on('pong', heartbeat);

  peers.add(ws);
  console.log(`[WS] Client connecté à "${roomId}" — ${peers.size} joueur(s)`);

  // Broadcast aux autres clients de la même room
  ws.on('message', (raw) => {
    for (const peer of peers) {
      if (peer !== ws && peer.readyState === peer.OPEN) {
        peer.send(raw);
      }
    }
  });

  ws.on('close', () => {
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(roomId);
    console.log(`[WS] Déconnexion de "${roomId}" — ${peers.size} restant(s)`);
  });
});

// Ping régulier pour fermer les clients inactifs
const interval = setInterval(() => {
  for (const peers of rooms.values()) {
    for (const ws of peers) {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        peers.delete(ws);
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }
  // Nettoie les rooms vides (sécurité)
  for (const [roomId, peers] of rooms.entries()) {
    if (peers.size === 0) rooms.delete(roomId);
  }
}, 30000);

wss.on('close', () => clearInterval(interval));

console.log(`[WS] Serveur WebSocket prêt sur ws://0.0.0.0:${PORT}`);
console.log(`[WS] Conseil : ouvrez vos pages via http://<IP_HOTE>:<PORT_HTTP>/index.html?room=ma-partie`);
