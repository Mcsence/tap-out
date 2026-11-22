import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol';
import { read, write } from './storage';

// Identifiant de joueur propre à chaque onglet : il survit à un rechargement de page
// (pour retrouver sa partie), et deux onglets = deux joueurs (pratique pour tester).
function playerId(): string {
  const KEY = 'tapout.playerId';
  let id = read(KEY, 'session');
  if (!id) {
    id = crypto.randomUUID();
    write(KEY, id, 'session');
  }
  return id;
}

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  auth: { playerId: playerId() },
});
