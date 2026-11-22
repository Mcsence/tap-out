import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { PSEUDO_MIN, cleanPseudo, isMatchConfig, type Ack } from '../shared/protocol';
import { RecentlySeen, planMatch } from './deck';
import { Match, MatchRegistry, playerRoom, type GameServer } from './match';
import { loadQuestions } from './questions';
import { Rooms } from './room';

const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
// En local, on n'écoute que sur cet ordinateur ; en ligne, sur toutes les interfaces.
const HOST = process.env.HOST ?? (isProd ? '0.0.0.0' : '127.0.0.1');
const ROOT = path.resolve(import.meta.dirname, '..');

const app = express();
const httpServer = createServer(app);
const io: GameServer = new Server(httpServer);
const matches = new MatchRegistry();
const recent = new RecentlySeen();
const rooms = new Rooms(io, matches, recent);

/** Abandonne la partie solo en cours (jamais une partie de salon). */
function leaveSolo(playerId: string) {
  if (matches.forPlayer(playerId)?.kind === 'solo') matches.leave(playerId);
}

const reply = (ack: unknown, res: Ack) => {
  if (typeof ack === 'function') ack(res);
};

io.on('connection', (socket) => {
  const playerId = socket.handshake.auth?.playerId;
  if (typeof playerId !== 'string' || !/^[\w-]{8,64}$/.test(playerId)) {
    socket.disconnect(true);
    return;
  }
  socket.join(playerRoom(playerId));

  // Reprise : un joueur qui recharge sa page retrouve son salon ou sa partie en cours.
  // Sans rien en cours (serveur redémarré, partie expirée), son écran repart à l'accueil.
  if (rooms.has(playerId)) {
    rooms.connect(playerId);
  } else {
    socket.emit('room', null);
    const current = matches.forPlayer(playerId);
    if (current) socket.emit('state', current.snapshotFor(playerId));
    else socket.emit('left');
  }

  socket.on('disconnect', () => {
    if (!io.sockets.adapter.rooms.get(playerRoom(playerId))?.size) rooms.disconnect(playerId);
  });

  // ── Salons privés ───────────────────────────────────────────────────
  socket.on('room:create', (payload, ack) => {
    const pseudo = cleanPseudo(String(payload?.pseudo ?? ''));
    if (pseudo.length < PSEUDO_MIN) return reply(ack, { ok: false, error: 'Choisis un pseudo d’au moins 2 caractères.' });
    leaveSolo(playerId);
    const code = rooms.create(playerId, pseudo);
    if (typeof ack === 'function') ack({ ok: true, code });
  });

  socket.on('room:join', (payload, ack) => {
    const pseudo = cleanPseudo(String(payload?.pseudo ?? ''));
    if (pseudo.length < PSEUDO_MIN) return reply(ack, { ok: false, error: 'Choisis un pseudo d’au moins 2 caractères.' });
    const solo = matches.forPlayer(playerId)?.kind === 'solo';
    const res = rooms.join(playerId, String(payload?.code ?? ''), pseudo);
    if (res.ok && solo) leaveSolo(playerId);
    reply(ack, res);
  });

  socket.on('room:config', (payload) => {
    if (isMatchConfig(payload?.config)) rooms.setConfig(playerId, payload.config);
  });

  socket.on('room:start', async (ack) => reply(ack, await rooms.start(playerId)));
  socket.on('room:rematch', async (ack) => reply(ack, await rooms.start(playerId)));
  socket.on('room:lobby', () => rooms.toLobby(playerId));
  socket.on('room:leave', () => rooms.leave(playerId));

  // ── Solo ────────────────────────────────────────────────────────────
  socket.on('solo:start', async (payload, ack) => {
    const pseudo = cleanPseudo(String(payload?.pseudo ?? ''));
    if (pseudo.length < PSEUDO_MIN) return reply(ack, { ok: false, error: 'Choisis un pseudo d’au moins 2 caractères.' });
    rooms.leave(playerId);
    const config = payload?.config;
    if (!isMatchConfig(config)) return reply(ack, { ok: false, error: 'Choisis un niveau et un format.' });

    const bank = await loadQuestions();
    if (bank.length === 0) return reply(ack, { ok: false, error: 'La banque de questions est vide.' });

    // En solo, les questions déjà vues par ce pseudo passent en dernier.
    const seenKey = `solo:${pseudo.toLowerCase()}`;
    const rounds = planMatch(bank, { level: config.level, format: config.format }, recent.get(seenKey));

    matches.leave(playerId);
    const match = new Match(io, 'solo', { level: config.level, format: config.format }, rounds);
    recent.add(seenKey, match.questionIds());
    match.addPlayer(playerId, pseudo);
    matches.add(match);
    reply(ack, { ok: true });
    match.start();
  });

  socket.on('answer', (payload, ack) => {
    const match = matches.forPlayer(playerId);
    if (!match) return reply(ack, { ok: false, error: 'Aucune partie en cours.' });
    reply(ack, match.answer(playerId, payload?.seq, payload?.choice));
  });

  socket.on('next', () => matches.forPlayer(playerId)?.skip(playerId));

  socket.on('leave', () => {
    if (rooms.has(playerId)) return rooms.leave(playerId);
    matches.leave(playerId);
    io.to(playerRoom(playerId)).emit('left');
  });
});

// Ménage : une partie solo abandonnée (plus personne de connecté depuis 2 min)
// ou inactive depuis 30 min est supprimée ; les salons font leur propre ménage.
setInterval(() => {
  const now = Date.now();
  rooms.sweep();
  for (const match of matches.all().filter((m) => m.kind === 'solo')) {
    const someoneConnected = [...match.players.keys()].some((id) => io.sockets.adapter.rooms.get(playerRoom(id))?.size);
    if (someoneConnected) match.lastSeen = now;
    if (now - match.lastSeen > 2 * 60_000 || now - match.lastActivity > 30 * 60_000) matches.remove(match);
  }
}, 30_000).unref();

if (isProd) {
  const dist = path.join(ROOT, 'dist');
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: ROOT,
    appType: 'spa',
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);
}

await loadQuestions();
httpServer.listen(PORT, HOST, () => {
  const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`\n  🥊 TAP OUT est lancé : ${url}\n`);
});
