import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { CATEGORIES, LEVELS, type Category, type Level } from '../shared/protocol';

/** Une question telle qu'écrite dans data/questions.json. */
export interface Question {
  id: string;
  categorie: Category;
  niveau: Level;
  question: string;
  reponses: string[];
  bonne_reponse: number;
  explication: string;
  source: string;
  statut?: 'a_verifier' | 'verifiee';
  /** Présent sur les questions générées automatiquement (ex. « wikipedia »). */
  origine?: string;
}

/** Une question prête à jouer : réponses mélangées, bonne réponse connue du seul serveur. */
export interface DealtQuestion {
  id: string;
  text: string;
  answers: string[];
  correctIndex: number;
  level: Level;
  category: Category;
  explanation: string;
  source: string;
}

/** Questions écrites à la main. */
export const QUESTIONS_FILE = path.resolve(import.meta.dirname, '../data/questions.json');
/** Questions générées depuis Wikipédia (`npm run generer`) ; le fichier peut ne pas exister. */
export const GENERATED_FILE = path.resolve(import.meta.dirname, '../data/questions-generees.json');

const caches = new Map<string, { mtimeMs: number; raw: unknown[] }>();

async function readList(file: string, optional: boolean): Promise<unknown[]> {
  const name = path.relative(path.resolve(import.meta.dirname, '..'), file).replace(/\\/g, '/');
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch (err) {
    if (optional) return [];
    throw err;
  }
  const cached = caches.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.raw;
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('le fichier doit contenir une liste : [ {…}, {…} ]');
    caches.set(file, { mtimeMs, raw });
    return raw;
  } catch (err) {
    console.error(`[questions] ${name} illisible : ${(err as Error).message}`);
    return cached?.raw ?? [];
  }
}

let last: { key: string; questions: Question[] } | null = null;

/**
 * Lit la banque de questions (fichier écrit à la main + fichier généré).
 * Les fichiers sont relus dès qu'ils changent : une question ajoutée est prise en compte
 * à la partie suivante, sans redémarrer. Une question mal formée est ignorée avec un message.
 */
export async function loadQuestions(): Promise<Question[]> {
  const hand = await readList(QUESTIONS_FILE, false);
  const generated = await readList(GENERATED_FILE, true);
  const key = `${hand.length}:${generated.length}:${[...caches.values()].map((c) => c.mtimeMs).join(',')}`;
  if (last && last.key === key) return last.questions;

  const seen = new Set<string>();
  const questions: Question[] = [];
  [...hand, ...generated].forEach((q: any, i) => {
    const problem = validate(q, seen);
    if (problem) {
      const id = typeof q?.id === 'string' ? q.id : 'sans id';
      console.warn(`[questions] Question n°${i + 1} (${id}) ignorée : ${problem}`);
      return;
    }
    seen.add(q.id);
    questions.push(q);
  });

  console.log(`[questions] ${questions.length} questions chargées (${hand.length} écrites, ${generated.length} générées).`);
  last = { key, questions };
  return questions;
}

/** Ce qui empêche une question d'être jouée, ou null si elle est valide. */
export function validate(q: any, seen: Set<string>): string | null {
  if (!q || typeof q !== 'object') return "ce n'est pas un bloc { … }";
  if (typeof q.id !== 'string' || !q.id.trim()) return 'champ "id" manquant';
  if (seen.has(q.id)) return `l'id "${q.id}" est déjà utilisé`;
  if (!CATEGORIES.includes(q.categorie)) return `"categorie" doit valoir ${CATEGORIES.join(', ')}`;
  if (!LEVELS.includes(q.niveau)) return `"niveau" doit valoir ${LEVELS.join(', ')}`;
  if (typeof q.question !== 'string' || !q.question.trim()) return 'champ "question" vide';
  if (!Array.isArray(q.reponses) || q.reponses.length !== 4) return '"reponses" doit contenir exactement 4 réponses';
  if (q.reponses.some((r: unknown) => typeof r !== 'string' || !r.trim())) return 'une des réponses est vide';
  if (new Set(q.reponses).size !== 4) return 'deux réponses sont identiques';
  if (!Number.isInteger(q.bonne_reponse) || q.bonne_reponse < 0 || q.bonne_reponse > 3)
    return '"bonne_reponse" doit valoir 0, 1, 2 ou 3 (position dans "reponses")';
  if (typeof q.explication !== 'string') return 'champ "explication" manquant';
  if (typeof q.source !== 'string') return 'champ "source" manquant';
  return null;
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Mélange les 4 réponses et retient où se trouve la bonne. */
export function deal(q: Question): DealtQuestion {
  const order = shuffle([0, 1, 2, 3]);
  return {
    id: q.id,
    text: q.question,
    answers: order.map((i) => q.reponses[i]),
    correctIndex: order.indexOf(q.bonne_reponse),
    level: q.niveau,
    category: q.categorie,
    explanation: q.explication,
    source: q.source,
  };
}
