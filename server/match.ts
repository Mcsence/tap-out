import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import type {
  Ack,
  ClientToServerEvents,
  Level,
  MatchConfig,
  MatchSnapshot,
  Phase,
  ServerToClientEvents,
  Standing,
} from '../shared/protocol';
import type { DealtQuestion } from './questions';
import { QUESTION_SECONDS, compareStandings, pointsFor } from './scoring';

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Mode accéléré pour les tests automatiques (TAPOUT_FAST=1) : transitions raccourcies, chrono inchangé. */
export const FAST = process.env.TAPOUT_FAST === '1';

export const TIMING = {
  roundIntroMs: FAST ? 500 : 3000,
  questionMs: QUESTION_SECONDS * 1000,
  revealMs: FAST ? 600 : 7000,
  scorecardMs: FAST ? 600 : 7000,
};

export interface RoundPlan {
  level: Level;
  questions: DealtQuestion[];
}

interface Player {
  id: string;
  pseudo: string;
  score: number;
  roundScores: number[];
  correct: number;
  answered: number;
  /** Temps cumulé (une absence de réponse compte pour 20 s), pour le départage. */
  totalMs: number;
  fastestMs: number | null;
}

interface Answer {
  choice: number;
  ms: number;
}

interface Result {
  choice: number | null;
  correct: boolean;
  points: number;
}

export const playerRoom = (playerId: string) => `player:${playerId}`;

/**
 * Une partie, pilotée entièrement par le serveur : il tire les questions,
 * tient le chrono, reçoit les réponses et calcule les points.
 * Chaque joueur reçoit un « instantané » de l'état qui le concerne.
 */
export class Match {
  readonly id = randomUUID();
  readonly players = new Map<string, Player>();
  phase: Phase = 'round-intro';
  /** Dernière action d'un joueur (réponse, passage…). */
  lastActivity = Date.now();
  /** Dernier moment où au moins un joueur était connecté. */
  lastSeen = Date.now();

  private roundIdx = 0;
  private qIdx = 0;
  private phaseStartedAt = 0;
  private phaseDurationMs = 0;
  private answers = new Map<string, Answer>();
  private results = new Map<string, Result>();
  private timer: NodeJS.Timeout | null = null;

  /** Places à la fin du round précédent, pour afficher l'évolution sur la carte des juges. */
  private prevRanks = new Map<string, number>();
  private lastRanks = new Map<string, number>();
  /** Suivi du leader question après question, pour « AND STILL… » / « AND NEW… ». */
  private leaderId: string | null = null;
  private leaderChanges = 0;

  constructor(
    private readonly io: GameServer,
    readonly kind: 'solo' | 'salon',
    readonly config: MatchConfig,
    private readonly rounds: RoundPlan[],
    /** Joueur présent (connecté) ? Une question se termine dès que tous les présents ont répondu. */
    private readonly isActive: (playerId: string) => boolean = () => true,
    /** Appelé une fois la partie terminée. */
    private readonly onEnd: () => void = () => {},
  ) {}

  /** Un joueur revenu avec un autre identifiant (autre appareil) reprend sa place et ses points. */
  rebind(oldId: string, newId: string) {
    const p = this.players.get(oldId);
    if (!p || oldId === newId) return;
    const move = <T>(m: Map<string, T>) => {
      if (m.has(oldId)) {
        m.set(newId, m.get(oldId)!);
        m.delete(oldId);
      }
    };
    p.id = newId;
    move(this.players);
    move(this.answers);
    move(this.results);
    move(this.prevRanks);
    move(this.lastRanks);
    if (this.leaderId === oldId) this.leaderId = newId;
  }

  /** Joueurs partis du salon : leurs points restent au classement, mais ils ne reçoivent plus rien. */
  private detached = new Set<string>();

  detach(playerId: string) {
    this.detached.add(playerId);
  }

  /** À appeler quand un joueur se déconnecte : les autres n'attendent pas sa réponse. */
  checkEarlyEnd() {
    if (this.phase !== 'question') return;
    const active = [...this.players.keys()].filter(this.isActive);
    if (this.answers.size > 0 && active.every((id) => this.answers.has(id))) this.enterReveal();
    else this.broadcast();
  }

  private activeCount(): number {
    return Math.max(1, [...this.players.keys()].filter(this.isActive).length);
  }

  questionIds(): string[] {
    return this.rounds.flatMap((r) => r.questions.map((q) => q.id));
  }

  addPlayer(id: string, pseudo: string) {
    this.players.set(id, {
      id,
      pseudo,
      score: 0,
      roundScores: this.rounds.map(() => 0),
      correct: 0,
      answered: 0,
      totalMs: 0,
      fastestMs: null,
    });
  }

  start() {
    this.enterRoundIntro(0);
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  answer(playerId: string, seq: unknown, choice: unknown): Ack {
    const now = Date.now();
    if (this.phase !== 'question' || seq !== this.seq())
      return { ok: false, error: 'Trop tard, la question est terminée.' };
    if (!this.players.has(playerId)) return { ok: false, error: "Tu ne fais pas partie de cette partie." };
    if (this.answers.has(playerId)) return { ok: false, error: 'Réponse déjà verrouillée.' };
    if (!Number.isInteger(choice) || (choice as number) < 0 || (choice as number) > 3)
      return { ok: false, error: 'Réponse invalide.' };

    this.answers.set(playerId, { choice: choice as number, ms: now - this.phaseStartedAt });
    this.lastActivity = now;
    this.checkEarlyEnd();
    return { ok: true };
  }

  /** En solo, le joueur peut passer la révélation et la carte des juges. */
  skip(playerId: string) {
    if (this.kind !== 'solo' || !this.players.has(playerId)) return;
    if (this.phase !== 'reveal' && this.phase !== 'scorecard') return;
    this.lastActivity = Date.now();
    if (this.phase === 'reveal') this.advance();
    else this.enterRoundIntro(this.roundIdx + 1);
  }

  snapshotFor(playerId: string): MatchSnapshot {
    const me = this.players.get(playerId);
    const round = this.rounds[this.roundIdx];
    const q = round.questions[this.qIdx];
    const snap: MatchSnapshot = {
      matchId: this.id,
      kind: this.kind,
      config: this.config,
      phase: this.phase,
      phaseRemainingMs: Math.max(0, this.phaseStartedAt + this.phaseDurationMs - Date.now()),
      phaseDurationMs: this.phaseDurationMs,
      round: {
        number: this.roundIdx + 1,
        count: this.rounds.length,
        questionCount: round.questions.length,
        level: round.level,
        championship: this.config.format === 'main-event' && this.roundIdx >= 3,
      },
      totalQuestions: this.rounds.reduce((n, r) => n + r.questions.length, 0),
      me: { pseudo: me?.pseudo ?? '', score: me?.score ?? 0 },
    };

    if (this.phase === 'question' || this.phase === 'reveal') {
      snap.question = {
        seq: this.seq(),
        number: this.qIdx + 1,
        text: q.text,
        answers: q.answers,
        level: q.level,
        category: q.category,
        durationMs: TIMING.questionMs,
        answeredCount: this.answers.size,
        playerCount: this.phase === 'reveal' ? this.players.size : this.activeCount(),
        myChoice: this.answers.get(playerId)?.choice ?? null,
      };
    }

    // La bonne réponse ne quitte le serveur qu'ici, une fois la question terminée.
    if (this.phase === 'reveal') {
      const mine = this.results.get(playerId);
      snap.reveal = {
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        source: q.source,
        choices: [...this.players.values()].map((p) => {
          const r = this.results.get(p.id);
          return { pseudo: p.pseudo, choice: r?.choice ?? null, correct: r?.correct ?? false, points: r?.points ?? 0 };
        }),
        myPoints: mine?.points ?? 0,
        myCorrect: mine?.correct ?? false,
      };
    }

    if (this.phase === 'scorecard' || this.phase === 'end') snap.standings = this.standings();
    if (this.phase === 'end') snap.wireToWire = this.leaderChanges === 0;
    return snap;
  }

  /** Classement actuel, avec la place de chacun à la fin du round précédent. */
  standings(): Standing[] {
    const played = Math.max(1, this.questionsPlayed());
    return this.ranked().map((p, i) => ({
      pseudo: p.pseudo,
      rank: i + 1,
      prevRank: this.prevRanks.get(p.id) ?? null,
      score: p.score,
      roundScores: [...p.roundScores],
      correct: p.correct,
      answered: p.answered,
      fastestMs: p.fastestMs,
      avgMs: Math.round(p.totalMs / played),
    }));
  }

  private ranked(): Player[] {
    const played = Math.max(1, this.questionsPlayed());
    return [...this.players.values()].sort((a, b) =>
      compareStandings(
        { score: a.score, correct: a.correct, avgMs: a.totalMs / played },
        { score: b.score, correct: b.correct, avgMs: b.totalMs / played },
      ),
    );
  }

  // ── Enchaînement des phases ────────────────────────────────────────────

  private enterRoundIntro(roundIdx: number) {
    this.roundIdx = roundIdx;
    this.qIdx = 0;
    this.setPhase('round-intro', TIMING.roundIntroMs, () => this.enterQuestion());
  }

  private enterQuestion() {
    this.answers.clear();
    this.results.clear();
    this.setPhase('question', TIMING.questionMs, () => this.enterReveal());
  }

  private enterReveal() {
    const q = this.rounds[this.roundIdx].questions[this.qIdx];
    for (const p of this.players.values()) {
      const a = this.answers.get(p.id);
      const correct = a?.choice === q.correctIndex;
      const points = a ? pointsFor(correct, a.ms) : 0;
      p.score += points;
      p.roundScores[this.roundIdx] += points;
      p.totalMs += a ? a.ms : TIMING.questionMs;
      if (a) p.answered += 1;
      if (correct) {
        p.correct += 1;
        p.fastestMs = p.fastestMs === null ? a!.ms : Math.min(p.fastestMs, a!.ms);
      }
      this.results.set(p.id, { choice: a?.choice ?? null, correct, points });
    }
    this.trackLeader();
    this.setPhase('reveal', TIMING.revealMs, () => this.advance());
  }

  private trackLeader() {
    const leader = this.ranked()[0];
    if (!leader || leader.score === 0) return; // personne n'a encore marqué
    if (this.leaderId !== null && this.leaderId !== leader.id) this.leaderChanges += 1;
    this.leaderId = leader.id;
  }

  private advance() {
    const round = this.rounds[this.roundIdx];
    if (this.qIdx + 1 < round.questions.length) {
      this.qIdx += 1;
      this.enterQuestion();
      return;
    }
    // Fin du round : on fige les places pour afficher leur évolution.
    this.prevRanks = this.lastRanks;
    this.lastRanks = new Map(this.ranked().map((p, i) => [p.id, i + 1]));
    if (this.roundIdx + 1 < this.rounds.length) {
      this.setPhase('scorecard', TIMING.scorecardMs, () => this.enterRoundIntro(this.roundIdx + 1));
    } else {
      this.setPhase('end', 0, null);
      this.onEnd();
    }
  }

  private setPhase(phase: Phase, durationMs: number, then: (() => void) | null) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.phase = phase;
    this.phaseStartedAt = Date.now();
    this.phaseDurationMs = durationMs;
    if (then) this.timer = setTimeout(then, durationMs);
    this.broadcast();
  }

  /** Numéro de la question en cours dans toute la partie (1, 2, 3…). */
  private seq(): number {
    let n = 0;
    for (let r = 0; r < this.roundIdx; r++) n += this.rounds[r].questions.length;
    return n + this.qIdx + 1;
  }

  /** Nombre de questions terminées (révélées). */
  private questionsPlayed(): number {
    return this.seq() - (this.phase === 'question' || this.phase === 'round-intro' ? 1 : 0);
  }

  broadcast() {
    for (const id of this.players.keys())
      if (!this.detached.has(id)) this.io.to(playerRoom(id)).emit('state', this.snapshotFor(id));
  }
}

/** Toutes les parties en cours, et qui joue où. */
export class MatchRegistry {
  private matches = new Map<string, Match>();
  private byPlayer = new Map<string, string>();

  add(match: Match) {
    this.matches.set(match.id, match);
    for (const id of match.players.keys()) this.byPlayer.set(id, match.id);
  }

  forPlayer(playerId: string): Match | undefined {
    const matchId = this.byPlayer.get(playerId);
    return matchId ? this.matches.get(matchId) : undefined;
  }

  leave(playerId: string) {
    const match = this.forPlayer(playerId);
    this.byPlayer.delete(playerId);
    if (match && match.kind === 'solo') this.remove(match);
  }

  /** Le joueur ne suit plus cette partie (il a quitté son salon). */
  forget(playerId: string) {
    this.byPlayer.delete(playerId);
  }

  rebind(oldId: string, newId: string) {
    const matchId = this.byPlayer.get(oldId);
    if (!matchId) return;
    this.byPlayer.delete(oldId);
    this.byPlayer.set(newId, matchId);
  }

  remove(match: Match) {
    match.dispose();
    this.matches.delete(match.id);
    for (const id of match.players.keys()) if (this.byPlayer.get(id) === match.id) this.byPlayer.delete(id);
  }

  all() {
    return [...this.matches.values()];
  }
}
