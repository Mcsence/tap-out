// Ce que le serveur et les navigateurs s'échangent.
// Règle d'or : la bonne réponse n'apparaît que dans `reveal`, jamais avant.

export type Level = 'facile' | 'moyen' | 'difficile' | 'expert';
export type Category = 'histoire' | 'champions' | 'records' | 'regles' | 'combats' | 'combattants' | 'cv';

export const LEVELS: Level[] = ['facile', 'moyen', 'difficile', 'expert'];
export const CATEGORIES: Category[] = ['histoire', 'champions', 'records', 'regles', 'combats', 'combattants', 'cv'];

export const LEVEL_LABEL: Record<Level, string> = {
  facile: 'Facile',
  moyen: 'Moyen',
  difficile: 'Difficile',
  expert: 'Expert',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  histoire: 'Histoire & légendes',
  champions: 'Champions & ceintures',
  records: 'Records & stats',
  regles: 'Règles, techniques & événements',
  combats: 'Combats & finishes',
  combattants: 'Surnoms & équipes',
  cv: 'CV des combattants',
};

// ── Configuration d'une partie ─────────────────────────────────────────

/** Niveau choisi pour la partie : un niveau fixe, ou Mix (la difficulté monte à chaque round). */
export type GameLevel = Level | 'mix';
export const GAME_LEVELS: GameLevel[] = [...LEVELS, 'mix'];
export const GAME_LEVEL_LABEL: Record<GameLevel, string> = { ...LEVEL_LABEL, mix: 'Mix' };

export type Format = 'classique' | 'main-event';
export const FORMATS: Format[] = ['classique', 'main-event'];
export const FORMAT_INFO: Record<Format, { label: string; rounds: number; perRound: number }> = {
  classique: { label: 'Combat classique', rounds: 3, perRound: 5 },
  'main-event': { label: 'Main Event', rounds: 5, perRound: 5 },
};

/** Comment le vainqueur est désigné : total des points, ou cartes des juges (10-9 par round). */
export type Scoring = 'points' | 'juges';
export const SCORINGS: Scoring[] = ['points', 'juges'];
export const SCORING_INFO: Record<Scoring, { label: string; text: string }> = {
  points: { label: 'Aux points', text: 'Le plus de points sur toute la partie l’emporte.' },
  juges: {
    label: 'Décision des juges',
    text: 'Chaque round est noté 10-9 comme un vrai combat (10-8 en cas de domination). Le total des cartes l’emporte.',
  },
};

export interface MatchConfig {
  level: GameLevel;
  format: Format;
  /** Absent = aux points. La décision des juges n'existe qu'en salon. */
  scoring?: Scoring;
}

/** Niveau de chaque round. En Mix : Facile, Moyen, Difficile, puis Expert pour les « championship rounds ». */
export function roundLevels(config: MatchConfig): Level[] {
  const { rounds } = FORMAT_INFO[config.format];
  if (config.level !== 'mix') return Array.from({ length: rounds }, () => config.level as Level);
  const ladder: Level[] = ['facile', 'moyen', 'difficile', 'expert', 'expert'];
  return ladder.slice(0, rounds);
}

export function isMatchConfig(value: unknown): value is MatchConfig {
  const v = value as MatchConfig;
  return (
    !!v && GAME_LEVELS.includes(v.level) && FORMATS.includes(v.format) && (v.scoring === undefined || SCORINGS.includes(v.scoring))
  );
}

export const PSEUDO_MIN = 2;
export const PSEUDO_MAX = 16;

// ── Déroulé ────────────────────────────────────────────────────────────

export type Phase = 'round-intro' | 'question' | 'reveal' | 'scorecard' | 'end';

export interface RoundInfo {
  number: number; // 1, 2, 3…
  count: number; // nombre total de rounds
  questionCount: number; // questions dans ce round
  level: Level;
  /** Rounds 4 et 5 d'un Main Event : les « championship rounds ». */
  championship: boolean;
}

export interface QuestionView {
  /** Numéro de la question dans toute la partie : une réponse doit le rappeler. */
  seq: number;
  number: number; // numéro dans le round, à partir de 1
  text: string;
  answers: string[]; // 4 réponses, déjà mélangées par le serveur
  level: Level;
  category: Category;
  durationMs: number;
  answeredCount: number;
  playerCount: number;
  myChoice: number | null;
}

export interface PlayerChoice {
  pseudo: string;
  choice: number | null;
  correct: boolean;
  points: number;
}

export interface RevealView {
  correctIndex: number;
  explanation: string;
  source: string;
  choices: PlayerChoice[];
  myPoints: number;
  myCorrect: boolean;
}

export interface Standing {
  pseudo: string;
  rank: number; // 1 = en tête
  /** Place à la fin du round précédent (null au premier round). */
  prevRank: number | null;
  score: number;
  roundScores: number[];
  /** Notes des juges des rounds terminés (10, 9 ou 8), et leur total. */
  cards: number[];
  cardsTotal: number;
  correct: number;
  answered: number;
  fastestMs: number | null;
  /** Temps de réponse moyen (une absence de réponse compte pour 20 s). */
  avgMs: number;
}

export interface MatchSnapshot {
  matchId: string;
  kind: 'solo' | 'salon';
  config: MatchConfig;
  phase: Phase;
  /** Temps restant dans la phase en cours, au moment de l'envoi. */
  phaseRemainingMs: number;
  phaseDurationMs: number;
  round: RoundInfo;
  totalQuestions: number;
  me: { pseudo: string; score: number };
  question?: QuestionView;
  reveal?: RevealView;
  /** Classement : sur la carte des juges et à la fin. */
  standings?: Standing[];
  /** Fin de partie : le vainqueur a-t-il mené de bout en bout ? (« AND STILL… » sinon « AND NEW… ») */
  wireToWire?: boolean;
}

export type Ack = { ok: true } | { ok: false; error: string };

// ── Salons privés ──────────────────────────────────────────────────────

export const ROOM_MIN_PLAYERS = 2;
export const ROOM_MAX_PLAYERS = 10;
export const ROOM_CODE_LENGTH = 6;
/** Lettres et chiffres sans caractères ambigus (pas de O/0, I/1, L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function cleanCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((c) => ROOM_CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, ROOM_CODE_LENGTH);
}

export interface RoomPlayer {
  pseudo: string;
  connected: boolean;
  isHost: boolean;
  isMe: boolean;
  /** Arrivé pendant un combat : il jouera le suivant. */
  waiting: boolean;
}

export interface RoomSnapshot {
  code: string;
  phase: 'lobby' | 'playing';
  isHost: boolean;
  players: RoomPlayer[];
  config: MatchConfig;
}

export interface ClientToServerEvents {
  'solo:start': (payload: { pseudo: string; config: MatchConfig }, ack: (res: Ack) => void) => void;
  answer: (payload: { seq: number; choice: number }, ack: (res: Ack) => void) => void;
  next: () => void;
  leave: () => void;
  'room:create': (payload: { pseudo: string }, ack: (res: Ack & { code?: string }) => void) => void;
  'room:join': (payload: { code: string; pseudo: string }, ack: (res: Ack) => void) => void;
  'room:config': (payload: { config: MatchConfig }) => void;
  'room:start': (ack: (res: Ack) => void) => void;
  'room:rematch': (ack: (res: Ack) => void) => void;
  'room:lobby': () => void;
  'room:leave': () => void;
}

export interface ServerToClientEvents {
  state: (snapshot: MatchSnapshot) => void;
  left: () => void;
  /** État du salon du joueur, ou null s'il n'est dans aucun salon. */
  room: (snapshot: RoomSnapshot | null) => void;
}

export function cleanPseudo(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, PSEUDO_MAX);
}
