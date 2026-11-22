import { randomInt } from 'node:crypto';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
  cleanCode,
  type Ack,
  type MatchConfig,
  type RoomSnapshot,
} from '../shared/protocol';
import type { RecentlySeen } from './deck';
import { planMatch } from './deck';
import { FAST, Match, playerRoom, type GameServer, type MatchRegistry } from './match';
import { loadQuestions } from './questions';

/** Délai avant de passer le rôle d'hôte quand l'hôte est déconnecté (le temps d'un rechargement de page). */
const HOST_GRACE_MS = FAST ? 1500 : 15_000;
/** Un salon sans activité pendant 30 minutes est supprimé. */
const ROOM_IDLE_MS = 30 * 60_000;

interface Member {
  id: string;
  pseudo: string;
  connected: boolean;
  /** Arrivé pendant un combat : il jouera le suivant. */
  waiting: boolean;
}

class Room {
  /** Ordre d'arrivée conservé : c'est l'ordre de passation du rôle d'hôte. */
  members = new Map<string, Member>();
  config: MatchConfig = { level: 'mix', format: 'classique' };
  match: Match | null = null;
  lastActivity = Date.now();
  hostTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly code: string,
    public hostId: string,
  ) {}

  get playing(): boolean {
    return !!this.match && this.match.phase !== 'end';
  }

  touch() {
    this.lastActivity = Date.now();
  }
}

const samePseudo = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' }) === 0;

/** Tous les salons privés et leurs joueurs. */
export class Rooms {
  private rooms = new Map<string, Room>();
  private byPlayer = new Map<string, string>();

  constructor(
    private readonly io: GameServer,
    private readonly matches: MatchRegistry,
    private readonly recent: RecentlySeen,
  ) {}

  has(playerId: string): boolean {
    return this.byPlayer.has(playerId);
  }

  private roomOf(playerId: string): Room | undefined {
    const code = this.byPlayer.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  private newCode(): string {
    for (;;) {
      const code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  // ── Actions des joueurs ───────────────────────────────────────────────

  create(playerId: string, pseudo: string): string {
    this.leave(playerId);
    const room = new Room(this.newCode(), playerId);
    room.members.set(playerId, { id: playerId, pseudo, connected: true, waiting: false });
    this.rooms.set(room.code, room);
    this.byPlayer.set(playerId, room.code);
    this.broadcast(room);
    return room.code;
  }

  join(playerId: string, rawCode: string, pseudo: string): Ack {
    const code = cleanCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: `Aucun salon avec le code ${code || '…'}. Vérifie le code.` };

    if (room.members.has(playerId)) {
      this.connect(playerId);
      return { ok: true };
    }

    const same = [...room.members.values()].find((m) => samePseudo(m.pseudo, pseudo));
    if (same && same.connected) return { ok: false, error: `Le pseudo « ${same.pseudo} » est déjà pris dans ce salon.` };

    this.leave(playerId);
    if (same) {
      // Retour d'un joueur déconnecté (autre appareil, onglet fermé) : il reprend sa place et ses points.
      this.rebind(room, same.id, playerId);
      room.members.get(playerId)!.connected = true;
    } else {
      if (room.members.size >= ROOM_MAX_PLAYERS) return { ok: false, error: `Le salon est plein (${ROOM_MAX_PLAYERS} joueurs maximum).` };
      room.members.set(playerId, { id: playerId, pseudo, connected: true, waiting: room.playing });
      this.byPlayer.set(playerId, room.code);
    }
    room.touch();
    this.broadcast(room);
    this.sendMatch(room, playerId);
    return { ok: true };
  }

  setConfig(playerId: string, config: MatchConfig) {
    const room = this.roomOf(playerId);
    if (!room || room.hostId !== playerId || room.playing) return;
    room.config = { level: config.level, format: config.format };
    room.touch();
    this.broadcast(room);
  }

  async start(playerId: string): Promise<Ack> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: "Tu n'es dans aucun salon." };
    if (room.hostId !== playerId) return { ok: false, error: "Seul l'hôte peut lancer le combat." };
    if (room.playing) return { ok: false, error: 'Un combat est déjà en cours.' };
    const players = [...room.members.values()].filter((m) => m.connected);
    if (players.length < ROOM_MIN_PLAYERS)
      return { ok: false, error: `Il faut au moins ${ROOM_MIN_PLAYERS} joueurs connectés pour lancer le combat.` };

    const bank = await loadQuestions();
    const seenKey = `salon:${room.code}`;
    const rounds = planMatch(bank, room.config, this.recent.get(seenKey));
    if (!rounds.length) return { ok: false, error: 'La banque de questions est vide.' };

    if (room.match) this.matches.remove(room.match);
    const match = new Match(
      this.io,
      'salon',
      { ...room.config },
      rounds,
      (id) => !!room.members.get(id)?.connected,
      () => this.broadcast(room),
    );
    for (const m of players) {
      m.waiting = false;
      match.addPlayer(m.id, m.pseudo);
    }
    for (const m of room.members.values()) if (!m.connected) m.waiting = true;
    this.recent.add(seenKey, match.questionIds());
    room.match = match;
    room.touch();
    this.matches.add(match);
    this.broadcast(room);
    match.start();
    return { ok: true };
  }

  /** L'hôte ramène tout le monde en salle d'attente (pour changer de niveau ou de format). */
  toLobby(playerId: string) {
    const room = this.roomOf(playerId);
    if (!room || room.hostId !== playerId || room.playing || !room.match) return;
    this.matches.remove(room.match);
    room.match = null;
    for (const m of room.members.values()) m.waiting = false;
    room.touch();
    this.broadcast(room);
  }

  leave(playerId: string) {
    const room = this.roomOf(playerId);
    if (!room) return;
    room.members.delete(playerId);
    this.byPlayer.delete(playerId);
    this.matches.forget(playerId);
    room.match?.detach(playerId);
    this.io.to(playerRoom(playerId)).emit('room', null);
    if (!room.members.size) return this.remove(room);
    if (room.hostId === playerId) this.passHost(room);
    room.match?.checkEarlyEnd();
    room.touch();
    this.broadcast(room);
  }

  // ── Connexion / déconnexion ───────────────────────────────────────────

  /** Le joueur (re)vient : on lui renvoie l'état du salon et du combat en cours. */
  connect(playerId: string) {
    const room = this.roomOf(playerId);
    if (!room) return;
    const m = room.members.get(playerId)!;
    m.connected = true;
    if (room.hostId === playerId && room.hostTimer) {
      clearTimeout(room.hostTimer);
      room.hostTimer = null;
    }
    this.broadcast(room);
    this.sendMatch(room, playerId);
  }

  /** Plus aucun onglet ouvert pour ce joueur. */
  disconnect(playerId: string) {
    const room = this.roomOf(playerId);
    if (!room) return;
    const m = room.members.get(playerId);
    if (!m) return;
    m.connected = false;
    room.match?.checkEarlyEnd();
    if (room.hostId === playerId && !room.hostTimer) {
      room.hostTimer = setTimeout(() => {
        room.hostTimer = null;
        if (!room.members.get(playerId)?.connected) {
          this.passHost(room);
          this.broadcast(room);
        }
      }, HOST_GRACE_MS);
    }
    this.broadcast(room);
  }

  /** Ménage : salons inactifs depuis 30 minutes. */
  sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const last = Math.max(room.lastActivity, room.match?.lastActivity ?? 0);
      const someone = [...room.members.values()].some((m) => m.connected);
      if (now - last > ROOM_IDLE_MS || (!someone && now - last > 5 * 60_000)) {
        for (const id of room.members.keys()) this.io.to(playerRoom(id)).emit('room', null);
        this.remove(room);
      }
    }
  }

  // ── Interne ───────────────────────────────────────────────────────────

  private passHost(room: Room) {
    const next = [...room.members.values()].find((m) => m.connected && m.id !== room.hostId);
    if (next) room.hostId = next.id;
    else if (!room.members.has(room.hostId)) room.hostId = room.members.keys().next().value ?? room.hostId;
  }

  private rebind(room: Room, oldId: string, newId: string) {
    // Recrée la liste pour garder l'ordre d'arrivée avec le nouvel identifiant.
    room.members = new Map([...room.members.entries()].map(([id, m]) => (id === oldId ? [newId, { ...m, id: newId }] : [id, m])));
    if (room.hostId === oldId) room.hostId = newId;
    this.byPlayer.delete(oldId);
    this.byPlayer.set(newId, room.code);
    room.match?.rebind(oldId, newId);
    this.matches.rebind(oldId, newId);
    this.io.to(playerRoom(oldId)).emit('room', null);
  }

  private remove(room: Room) {
    if (room.hostTimer) clearTimeout(room.hostTimer);
    if (room.match) this.matches.remove(room.match);
    for (const id of room.members.keys()) this.byPlayer.delete(id);
    this.rooms.delete(room.code);
  }

  private sendMatch(room: Room, playerId: string) {
    if (room.match?.players.has(playerId)) this.io.to(playerRoom(playerId)).emit('state', room.match.snapshotFor(playerId));
  }

  snapshotFor(room: Room, playerId: string): RoomSnapshot {
    return {
      code: room.code,
      phase: room.match ? 'playing' : 'lobby',
      isHost: room.hostId === playerId,
      config: room.config,
      players: [...room.members.values()].map((m) => ({
        pseudo: m.pseudo,
        connected: m.connected,
        isHost: m.id === room.hostId,
        isMe: m.id === playerId,
        waiting: m.waiting,
      })),
    };
  }

  private broadcast(room: Room) {
    for (const id of room.members.keys()) this.io.to(playerRoom(id)).emit('room', this.snapshotFor(room, id));
  }
}
