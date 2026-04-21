// server.js — serveur WebSocket pour MTG
// npm install ws
// Se lance avec node server.js

import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8787;
const rooms = new Map(); // roomId -> Set(ws)

// Serveur HTTP minimal (requis par Render pour les health checks)
const server = createServer((req, res) => {
  res.writeHead(200);
  res.end('MTG WebSocket server is running.');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Récupère l'ID de la room depuis l'URL (?room=xxx)
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.searchParams.get('room') || 'default';

  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  const peers = rooms.get(roomId);
  peers.add(ws);

  console.log(`Client connecté à la room "${roomId}" (${peers.size} joueur[s])`);

  ws.on('message', (raw) => {
    // Diffuse le message à tous les autres joueurs de la même room
    for (const peer of peers) {
      if (peer !== ws && peer.readyState === ws.OPEN) {
        peer.send(raw);
      }
    }
  });

  ws.on('close', () => {
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(roomId);
    console.log(`Client déconnecté de "${roomId}" (${peers.size} restants)`);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur WebSocket lancé sur le port ${PORT}`);
});
