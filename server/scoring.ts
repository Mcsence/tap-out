export const QUESTION_SECONDS = 20;

/**
 * Bonne réponse : de 1000 points (instantanée) à 500 points (à 20 s).
 * Mauvaise réponse ou pas de réponse : 0.
 * points = round(1000 - 500 × t / 20), t mesuré par le serveur.
 */
export function pointsFor(correct: boolean, answerMs: number): number {
  if (!correct) return 0;
  const t = Math.min(Math.max(answerMs / 1000, 0), QUESTION_SECONDS);
  return Math.round(1000 - (500 * t) / QUESTION_SECONDS);
}

interface Rankable {
  score: number;
  correct: number;
  avgMs: number;
}

/** Classement : total, puis bonnes réponses, puis temps de réponse moyen le plus court. */
export function compareStandings(a: Rankable, b: Rankable): number {
  return b.score - a.score || b.correct - a.correct || a.avgMs - b.avgMs;
}
