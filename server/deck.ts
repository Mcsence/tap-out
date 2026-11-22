import { FORMAT_INFO, LEVELS, roundLevels, type Level, type MatchConfig } from '../shared/protocol';
import type { RoundPlan } from './match';
import { deal, shuffle, type Question } from './questions';

/** Les niveaux du plus proche au plus éloigné : de quoi compléter un round si la banque manque de questions. */
function levelsByDistance(level: Level): Level[] {
  const i = LEVELS.indexOf(level);
  return [...LEVELS].sort((a, b) => Math.abs(LEVELS.indexOf(a) - i) - Math.abs(LEVELS.indexOf(b) - i));
}

/**
 * Tire les questions d'une partie :
 * - jamais deux fois la même question dans la partie ;
 * - les questions vues récemment passent en dernier dans le tirage ;
 * - si un niveau manque de questions, on complète avec le niveau le plus proche.
 */
export function planMatch(bank: Question[], config: MatchConfig, recent: Set<string>): RoundPlan[] {
  const { perRound } = FORMAT_INFO[config.format];
  const used = new Set<string>();
  // Un même énoncé (ex. « Lequel de ces combattants a battu X ? ») ne sort qu'une fois par partie.
  const usedTexts = new Set<string>();
  let missing = 0;

  const rounds = roundLevels(config).map((level) => {
    const picked: Question[] = [];
    const perCategory = new Map<string, number>();
    for (const l of levelsByDistance(level)) {
      const pool = bank.filter((q) => q.niveau === l && !used.has(q.id) && !usedTexts.has(q.question));
      const ordered = [...shuffle(pool.filter((q) => !recent.has(q.id))), ...shuffle(pool.filter((q) => recent.has(q.id)))];
      // Variété : on prend toujours dans la catégorie la moins représentée du round.
      while (picked.length < perRound && ordered.length) {
        const min = Math.min(...ordered.map((q) => perCategory.get(q.categorie) ?? 0));
        const q = ordered.splice(ordered.findIndex((x) => (perCategory.get(x.categorie) ?? 0) === min), 1)[0];
        if (usedTexts.has(q.question)) continue;
        picked.push(q);
        used.add(q.id);
        usedTexts.add(q.question);
        perCategory.set(q.categorie, (perCategory.get(q.categorie) ?? 0) + 1);
      }
      if (picked.length >= perRound) break;
    }
    missing += perRound - picked.length;
    return { level, questions: picked.map(deal) };
  });

  if (missing > 0) {
    console.warn(`[tirage] Banque trop petite : il manque ${missing} question(s) pour ce format, la partie sera raccourcie.`);
  }
  return rounds.filter((r) => r.questions.length > 0);
}

/** Questions vues récemment, par joueur (solo) ou par salon : elles repassent en fin de tirage. */
export class RecentlySeen {
  private seen = new Map<string, string[]>();
  constructor(private readonly keep = 300) {}

  get(key: string): Set<string> {
    return new Set(this.seen.get(key) ?? []);
  }

  add(key: string, ids: string[]) {
    const list = [...(this.seen.get(key) ?? []).filter((id) => !ids.includes(id)), ...ids];
    this.seen.set(key, list.slice(-this.keep));
  }
}
