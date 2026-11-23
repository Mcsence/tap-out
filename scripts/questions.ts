// Contrôle de la banque de questions : `npm run questions`
//
// - vérifie chaque question (format, 4 réponses distinctes, bonne réponse valide…) ;
// - signale les doublons probables et les formulations à risque ;
// - compte les questions par niveau et par catégorie ;
// - écrit data/a-verifier.md : la liste des questions à relire, Expert en premier.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CATEGORIES, CATEGORY_LABEL, LEVELS, LEVEL_LABEL, type Level } from '../shared/protocol';
import { GENERATED_FILE, QUESTIONS_FILE, validate, type Question } from '../server/questions';

const REVIEW_FILE = path.resolve(import.meta.dirname, '../data/a-verifier.md');
/** En dessous, un niveau se répète trop vite (un Main Event en tire 25 questions). */
const MIN_PER_LEVEL = 150;

type Q = Question & { note?: string };

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP = new Set(
  'le la les un une des de du d l a au aux en et ou qui que quel quelle quels quelles est a t il elle ce cette ces son sa ses lors dans pour par sur avec ufc combien quand comment'.split(
    ' ',
  ),
);
const words = (s: string) => new Set(normalize(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));

function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

async function main() {
  const hand = JSON.parse(await readFile(QUESTIONS_FILE, 'utf8')) as Q[];
  let generated: Q[] = [];
  try {
    generated = JSON.parse(await readFile(GENERATED_FILE, 'utf8')) as Q[];
  } catch {
    /* pas encore de questions générées */
  }
  const raw = [...hand, ...generated];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const valid: Q[] = [];

  raw.forEach((q, i) => {
    const problem = validate(q, seen);
    if (problem) {
      errors.push(`n°${i + 1} (${q?.id ?? 'sans id'}) : ${problem}`);
      return;
    }
    seen.add(q.id);
    valid.push(q);

    const correct = q.reponses[q.bonne_reponse];
    if (!/^https?:\/\//.test(q.source)) warnings.push(`${q.id} : source absente ou qui n'est pas un lien`);
    if (!q.explication.trim()) warnings.push(`${q.id} : explication vide`);
    if (q.question.length > 170) warnings.push(`${q.id} : question longue (${q.question.length} caractères)`);
    if (/\b(actuel|actuelle|actuellement|aujourd'hui)\b/i.test(q.question))
      warnings.push(`${q.id} : « actuel / aujourd'hui » — un fait qui change doit être daté`);
    const lengths = q.reponses.map((r) => r.length);
    const others = lengths.filter((_, j) => j !== q.bonne_reponse);
    if (correct.length > 2 * Math.max(...others) + 6)
      warnings.push(`${q.id} : la bonne réponse est bien plus longue que les autres (elle se devine)`);
    if (q.reponses.some((r) => normalize(r) === normalize(q.question)))
      warnings.push(`${q.id} : une réponse répète la question`);
  });

  // Même question et même bonne réponse (toute la banque). Un même énoncé avec une autre bonne réponse
  // est voulu (ex. les différents vainqueurs d'un combattant) : le jeu ne le sort qu'une fois par partie.
  const byText = new Map<string, string>();
  for (const q of valid) {
    const key = `${normalize(q.question)}→${normalize(q.reponses[q.bonne_reponse])}`;
    const other = byText.get(key);
    if (other) errors.push(`${other} et ${q.id} : même question`);
    else byText.set(key, q.id);
  }

  // Doublons probables parmi les questions écrites à la main : question proche, même bonne réponse.
  const written = valid.filter((q) => !q.origine);
  for (let i = 0; i < written.length; i++) {
    for (let j = i + 1; j < written.length; j++) {
      const a = written[i];
      const b = written[j];
      const sameAnswer = normalize(a.reponses[a.bonne_reponse]) === normalize(b.reponses[b.bonne_reponse]);
      if (sameAnswer && normalize(a.question) !== normalize(b.question) && similarity(a.question, b.question) >= 0.6)
        warnings.push(`${a.id} et ${b.id} : doublon probable (même réponse, question proche)`);
    }
  }

  // Comptage par niveau et catégorie.
  const count = (l: Level, c: string) => valid.filter((q) => q.niveau === l && q.categorie === c).length;
  const header = `| Niveau | ${CATEGORIES.map((c) => CATEGORY_LABEL[c]).join(' | ')} | Total |`;
  const table = [
    header,
    `|---|${CATEGORIES.map(() => '---').join('|')}|---|`,
    ...LEVELS.map(
      (l) =>
        `| ${LEVEL_LABEL[l]} | ${CATEGORIES.map((c) => count(l, c)).join(' | ')} | ${valid.filter((q) => q.niveau === l).length} |`,
    ),
  ].join('\n');

  console.log(
    `\nBanque : ${raw.length} questions (${hand.length} écrites à la main, ${generated.length} générées), ${valid.length} valides.\n`,
  );
  console.log(table + '\n');
  // Un niveau presque vide se ressentirait en jeu (questions qui reviennent vite).
  for (const l of LEVELS)
    if (valid.filter((q) => q.niveau === l).length < MIN_PER_LEVEL)
      warnings.push(`${LEVEL_LABEL[l]} : seulement ${valid.filter((q) => q.niveau === l).length} questions`);

  if (errors.length) console.log(`❌ ${errors.length} erreur(s) — ces questions ne seront pas jouées :\n  - ${errors.join('\n  - ')}\n`);
  if (warnings.length) console.log(`⚠️  ${warnings.length} point(s) à regarder :\n  - ${warnings.join('\n  - ')}\n`);
  if (!errors.length && !warnings.length) console.log('✅ Aucun problème détecté.\n');

  // Liste de relecture : les questions écrites à la main (les générées viennent des fiches Wikipédia).
  const toReview = written.filter((q) => q.statut !== 'verifiee');
  const order: Level[] = ['expert', 'difficile', 'moyen', 'facile'];
  const lines: string[] = [
    '# Questions à vérifier',
    '',
    `Fichier généré par \`npm run questions\` — ${toReview.length} question(s) écrite(s) à la main sur ${written.length} restent à relire.`,
    '',
    'Pour chaque question : vérifier le fait sur la source, puis dans `data/questions.json` passer son `"statut"` de `"a_verifier"` à `"verifiee"` (ou corriger la question). Relancer `npm run questions` pour mettre cette liste à jour.',
    '',
    'Ordre de relecture : Expert d’abord, puis Difficile, Moyen, Facile. Les questions avec une ⚑ note sont à regarder en priorité.',
    '',
    `Les ${valid.length - written.length} questions de \`data/questions-generees.json\` sont tirées automatiquement des pages Wikipédia des événements et des combattants (\`npm run generer\`) : elles ne sont pas listées ici. Une erreur dans l'une d'elles se corrige à la source (la page Wikipédia) ou en la retirant du fichier.`,
    '',
  ];
  for (const level of order) {
    const ofLevel = toReview.filter((q) => q.niveau === level);
    if (!ofLevel.length) continue;
    lines.push(`## ${LEVEL_LABEL[level]} (${ofLevel.length})`, '');
    for (const c of CATEGORIES) {
      const items = ofLevel
        .filter((q) => q.categorie === c)
        .sort((a, b) => Number(!!b.note) - Number(!!a.note) || a.id.localeCompare(b.id));
      if (!items.length) continue;
      lines.push(`### ${CATEGORY_LABEL[c]}`, '');
      for (const q of items) {
        const correct = q.reponses[q.bonne_reponse];
        const wrong = q.reponses.filter((_, i) => i !== q.bonne_reponse).join(' · ');
        lines.push(`- [ ] **${q.id}** — ${q.question}`);
        lines.push(`  - ✓ ${correct}  ✗ ${wrong}`);
        lines.push(`  - ${q.explication} [source](${q.source})`);
        if (q.note) lines.push(`  - ⚑ ${q.note}`);
      }
      lines.push('');
    }
  }
  await writeFile(REVIEW_FILE, lines.join('\n'), 'utf8');
  console.log(`Liste de relecture écrite dans data/a-verifier.md (${toReview.length} questions).`);
  process.exitCode = errors.length ? 1 : 0;
}

main();
