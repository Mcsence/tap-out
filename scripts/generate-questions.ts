// Génère des questions « en masse » à partir de Wikipédia (en anglais) : `npm run generer`
//
// Sources : les pages des événements numérotés (UFC 1, UFC 2…) et les fiches des combattants.
// Modèles de questions :
//   - main event d'un UFC, et UFC d'un main event ;
//   - comment s'est terminé un combat (vainqueur + K.-O./soumission/décision) ;
//   - à quel round s'est terminé un combat ;
//   - quelle soumission, quelle frappe ;
//   - surnoms (dans les deux sens) et équipe d'entraînement.
//
// Résultat : data/questions-generees.json (le fichier écrit à la main, data/questions.json, n'est pas touché).
// Les pages téléchargées sont gardées dans .cache/wikipedia : relancer le script ne retélécharge rien.
// Pour forcer une mise à jour (nouveaux événements) : `npm run generer -- --rafraichir`.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Category, Level } from '../shared/protocol';
import type { Question } from '../server/questions';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'wikipedia');
const OUT_FILE = path.join(ROOT, 'data', 'questions-generees.json');
const HAND_FILE = path.join(ROOT, 'data', 'questions.json');
const API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'TapOutQuiz/0.1 (generateur de quiz personnel)';
const REFRESH = process.argv.includes('--rafraichir');
const MAX_EVENT = 400;

type GenQuestion = Question & { origine: 'wikipedia' };

// ── Téléchargement (par lots de 20 pages, poliment) ─────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Appel à l'API, en respectant les demandes de ralentissement de Wikipédia (429). */
async function apiGet(params: URLSearchParams): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}?${params}`, { headers: { 'user-agent': USER_AGENT } });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`Wikipédia a répondu ${res.status}`);
    const wait = (Number(res.headers.get('retry-after')) || 10 * (attempt + 1)) * 1000;
    process.stdout.write(`\n  Wikipédia demande de ralentir (${res.status}) : pause de ${wait / 1000} s…`);
    await sleep(wait);
  }
  throw new Error('Wikipédia refuse encore après plusieurs essais. Réessaie plus tard : les pages déjà reçues sont gardées.');
}

async function fetchPages(titles: string[], cacheName: string): Promise<Map<string, string>> {
  const cacheFile = path.join(CACHE_DIR, `${cacheName}.json`);
  const doneFile = path.join(CACHE_DIR, `${cacheName}.demandes.json`);
  let pages = new Map<string, string>();
  let asked = new Set<string>();
  if (!REFRESH) {
    try {
      pages = new Map(Object.entries(JSON.parse(await readFile(cacheFile, 'utf8'))));
      asked = new Set(JSON.parse(await readFile(doneFile, 'utf8')));
    } catch {
      /* pas de cache : on télécharge */
    }
  }
  const save = async () => {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(Object.fromEntries(pages)), 'utf8');
    await writeFile(doneFile, JSON.stringify([...asked]), 'utf8');
  };
  const todo = titles.filter((t) => !asked.has(t));
  if (!todo.length) return pages;

  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    let cont: Record<string, string> = {};
    do {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        prop: 'revisions',
        rvprop: 'content',
        rvslots: 'main',
        redirects: '1',
        titles: batch.join('|'),
        ...cont,
      });
      const json = await apiGet(params);
      // Les redirections : on garde la page sous le titre demandé.
      const back = new Map<string, string>();
      for (const r of json.query?.redirects ?? []) back.set(r.to, r.from);
      for (const n of json.query?.normalized ?? []) back.set(n.to, back.get(n.to) ?? n.from);
      for (const p of json.query?.pages ?? []) {
        const content = p.revisions?.[0]?.slots?.main?.content;
        if (typeof content === 'string') pages.set(back.get(p.title) ?? p.title, content);
      }
      cont = json.continue ?? {};
      await sleep(1200);
    } while (Object.keys(cont).length);
    for (const t of batch) asked.add(t);
    await save();
    process.stdout.write(`\r  ${cacheName} : ${Math.min(i + 10, todo.length)}/${todo.length} pages`);
  }
  process.stdout.write('\n');
  return pages;
}

// ── Lecture du wikitexte ─────────────────────────────────────────────────

/** Contenu des modèles {{Nom|…}} (imbrication gérée). */
function templates(text: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\{\\{\\s*${name}\\s*\\|`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 0;
    let i = m.index;
    for (; i < text.length - 1; i++) {
      if (text[i] === '{' && text[i + 1] === '{') { depth++; i++; }
      else if (text[i] === '}' && text[i + 1] === '}') { depth--; i++; if (depth === 0) break; }
    }
    out.push(text.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

/** Découpe les paramètres d'un modèle sur les « | » de premier niveau. */
function splitParams(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; cur += two; i++; continue; }
    if (two === ']]' || two === '}}') { depth--; cur += two; i++; continue; }
    if (body[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

/** Texte lisible : sans références, modèles, liens ni balises. */
function plain(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Titre de la page liée (premier lien), pour aller chercher la fiche du combattant. */
const linkTitle = (s: string) => s.match(/\[\[([^|\]#]+)/)?.[1]?.trim() ?? null;

interface Fighter {
  name: string;
  page: string | null;
}

interface Bout {
  event: number;
  order: number; // 0 = main event
  weight: string;
  winner: Fighter;
  loser: Fighter;
  method: 'ko' | 'sub' | 'dec';
  decision?: 'unanime' | 'partagée' | 'majoritaire';
  detail: string; // ex. « punches », « rear-naked choke »
  round: number;
  time: string;
  title: boolean;
  interim: boolean;
  maxRounds: number;
}

function fighter(raw: string): Fighter {
  const name = plain(raw).replace(/\((?:c|ic|uc)\)/gi, '').replace(/\s+/g, ' ').trim();
  return { name, page: linkTitle(raw) };
}

function parseEvent(event: number, text: string): Bout[] {
  const bouts: Bout[] = [];
  templates(text, 'MMAevent bout').forEach((body, order) => {
    const p = splitParams(body);
    if (p.length < 7) return;
    const [weight, f1, verdict, f2, methodRaw, roundRaw, timeRaw, ...rest] = p;
    if (!/^def\.?$/i.test(plain(verdict))) return; // nul, no contest, combat à venir
    const method = plain(methodRaw);
    const detail = method.match(/\(([^)]*)\)/)?.[1]?.toLowerCase().trim() ?? '';
    let kind: Bout['method'];
    let decision: Bout['decision'];
    if (/^(t?ko)\b/i.test(method)) kind = 'ko';
    else if (/^(technical )?submission/i.test(method)) kind = 'sub';
    else if (/^decision/i.test(method)) {
      kind = 'dec';
      decision = /split/i.test(method) ? 'partagée' : /majority/i.test(method) ? 'majoritaire' : 'unanime';
    } else return; // disqualification, etc.
    const round = Number.parseInt(plain(roundRaw), 10);
    if (!round || round > 5) return;
    const notes = rest.join(' ');
    const title = /championship/i.test(notes) && !/tournament/i.test(notes);
    const winner = fighter(f1);
    const loser = fighter(f2);
    if (!winner.name || !loser.name || winner.name === loser.name) return;
    bouts.push({
      event,
      order,
      weight: plain(weight),
      winner,
      loser,
      method: kind,
      decision,
      detail,
      round,
      time: plain(timeRaw),
      title,
      interim: /interim/i.test(notes),
      maxRounds: title || (order === 0 && event >= 138) ? 5 : 3,
    });
  });
  return bouts;
}

/** Valeur d'un champ d'infobox, y compris sur plusieurs lignes (listes {{plainlist|…}}). */
function infobox(text: string, field: string): string | null {
  const start = text.search(new RegExp(`\\n\\s*\\|\\s*${field}\\s*=`, 'i'));
  if (start < 0) return null;
  const from = text.indexOf('=', start) + 1;
  let depth = 0;
  let i = from;
  for (; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; i++; continue; }
    if (two === '}}' || two === ']]') {
      if (depth === 0) break; // fin de l'infobox
      depth--; i++; continue;
    }
    if (depth === 0 && text[i] === '\n' && /^\n\s*\|/.test(text.slice(i, i + 40))) break; // champ suivant
  }
  return text.slice(from, i).trim();
}

/** Éléments d'une liste d'infobox : {{plainlist|* A * B}}, <br />, retours à la ligne. */
function listItems(raw: string): string[] {
  const inner = raw.replace(/^\{\{\s*(plain|flat|unbulleted )?list\s*\|/i, '').replace(/\}\}\s*$/, '');
  return inner
    .split(/<br\s*\/?>|\n|\*|\|(?![^[]*\]\])/i)
    .map(plain)
    .map((s) => s.trim())
    .filter((s) => s && !/[{}|=]/.test(s));
}

// ── Hasard reproductible (mêmes questions à chaque génération) ──────────

function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], n: number, rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// ── Traductions ──────────────────────────────────────────────────────────

const SUBMISSIONS: [RegExp, string][] = [
  [/rear[- ]naked choke/, 'Étranglement arrière'],
  [/arm[- ]triangle/, 'Arm-triangle'],
  [/^triangle( choke)?$/, 'Triangle'],
  [/^(standing )?guillotine( choke)?$/, 'Guillotine'],
  [/^armbar$/, 'Clé de bras (armbar)'],
  [/^kimura$/, 'Kimura'],
  [/anaconda/, 'Anaconda'],
  [/d'arce/, "D'Arce"],
  [/^heel hook$/, 'Heel hook'],
  [/^kneebar$/, 'Kneebar'],
  [/americana|keylock/, 'Americana'],
  [/north[- ]south choke/, 'Étranglement nord-sud'],
  [/von flue/, 'Von Flue'],
  [/^neck crank$/, 'Neck crank'],
  [/^calf slicer$/, 'Calf slicer'],
  [/^ankle lock$/, 'Clé de cheville'],
  [/^triangle armbar$/, 'Triangle armbar'],
  [/^peruvian necktie$/, 'Peruvian necktie'],
  [/^bulldog choke$/, 'Bulldog choke'],
  [/^ezekiel choke$/, 'Ezekiel'],
];
const SUB_POOL = ['Étranglement arrière', 'Guillotine', 'Clé de bras (armbar)', 'Triangle', 'Arm-triangle', 'Kimura', "D'Arce", 'Anaconda', 'Heel hook', 'Americana'];

const STRIKES: [RegExp, string][] = [
  [/^punch(es)?$/, 'Coups de poing'],
  [/^head kick$/, 'Coup de pied à la tête'],
  [/^(flying )?knee$/, 'Coup de genou'],
  [/^knees$/, 'Coup de genou'],
  [/^elbows?$/, 'Coups de coude'],
  [/^body kick$/, 'Coup de pied au corps'],
  [/^spinning back fist$/, 'Revers tourné'],
  [/^spinning (back|wheel) kick$/, 'Coup de pied retourné'],
  [/^front kick$/, 'Front kick'],
  [/^slam$/, 'Projection (slam)'],
  [/^leg kicks?$/, 'Low kicks'],
];
const STRIKE_POOL = ['Coups de poing', 'Coup de pied à la tête', 'Coup de genou', 'Coups de coude', 'Coup de pied au corps', 'Low kicks'];

const translate = (table: [RegExp, string][], detail: string) => table.find(([re]) => re.test(detail))?.[1] ?? null;

// ── Palmarès : le tableau « Mixed martial arts record » des fiches ───────

interface Fight {
  result: 'win' | 'loss' | 'draw' | 'nc';
  opponent: string;
  event: string;
  date: number; // horodatage, pour trier
  ufc: boolean;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Valeur d'une cellule de tableau wiki, sans « align=center| » ni mise en forme. */
function cell(raw: string): string {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < raw.length; i++) {
    const two = raw.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; i++; continue; }
    if (two === ']]' || two === '}}') { depth--; i++; continue; }
    if (raw[i] === '|' && depth === 0) cut = i;
  }
  return cut >= 0 ? raw.slice(cut + 1) : raw;
}

function fightDate(raw: string): number {
  const m = raw.match(/(\d{4})\s*\|\s*([A-Za-z]+|\d{1,2})\s*\|\s*(\d{1,2})/);
  if (m) {
    const month = /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : MONTHS.indexOf(m[2].toLowerCase());
    return Date.UTC(Number(m[1]), Math.max(0, month), Number(m[3]));
  }
  const y = raw.match(/\b(19[89]\d|20[0-3]\d)\b/);
  return y ? Date.UTC(Number(y[1]), 0, 1) : 0;
}

interface Record_ {
  fights: Fight[]; // du plus ancien au plus récent
  wins: number;
  losses: number;
  draws: number;
  nc: number;
}

/** Lit le tableau des combats pros ; null si le tableau et le bilan affiché ne concordent pas. */
function mmaRecord(text: string): Record_ | null {
  const sectionAt = text.search(/==\s*Mixed martial arts record\s*==/i);
  if (sectionAt < 0) return null;
  const tableAt = text.indexOf('{{MMA record start}}', sectionAt);
  if (tableAt < 0) return null;
  const endCandidates = [text.indexOf('{{end}}', tableAt), text.indexOf('\n|}', tableAt)].filter((i) => i > 0);
  const body = text.slice(tableAt, endCandidates.length ? Math.min(...endCandidates) : undefined).replace(/<!--[\s\S]*?-->/g, '');
  const rows = body.split(/\n\|-+/).slice(1);
  const fights: Fight[] = [];
  let shown: number[] | null = null;
  for (const row of rows) {
    const cells = row.split(/\n\|(?!-)/).map((c) => c.trim()).filter((c, i) => i > 0 || c);
    const parts = cells[0] === '' ? cells.slice(1) : cells;
    if (parts.length < 6) continue;
    const res = plain(cell(parts[0])).toLowerCase();
    const result: Fight['result'] | null = /^win/.test(res) ? 'win' : /^loss/.test(res) ? 'loss' : /^draw/.test(res) ? 'draw' : /^(nc|no contest)/.test(res) ? 'nc' : null;
    if (!result) continue;
    if (!shown) {
      const r = cell(parts[1]).match(/(\d+)\s*[–-]\s*(\d+)/);
      if (r) shown = [Number(r[1]), Number(r[2])];
    }
    const opponent = plain(cell(parts[2])).replace(/\s*\(fighter\)$/i, '');
    const event = plain(cell(parts[4]));
    fights.push({
      result,
      opponent,
      event,
      date: fightDate(cell(parts[5])),
      ufc: /\bUFC\b|Ultimate Fighter.*Finale/i.test(event),
    });
  }
  if (!fights.length || !shown) return null;
  // Le tableau va du plus récent au plus ancien : on le retourne, puis tri stable par date.
  fights.reverse().sort((a, b) => a.date - b.date);
  const count = (r: Fight['result']) => fights.filter((f) => f.result === r).length;
  const rec = { fights, wins: count('win'), losses: count('loss'), draws: count('draw'), nc: count('nc') };
  // Contrôle : le décompte des lignes doit retomber sur le bilan affiché de la ligne la plus récente.
  if (rec.wins !== shown[0] || rec.losses !== shown[1]) return null;
  if (fights.some((f) => !f.date || !f.opponent)) return null;
  return rec;
}

/** 1 victoire, 2 victoires… */
const n = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;

const recordLabel = (w: number, l: number, d: number) => (d ? `${w}-${l}-${d}` : `${w}-${l}`);

// ── CV : pays, mensurations, grades, catégories ─────────────────────────

const COUNTRIES: Record<string, string> = {
  'u.s.': 'États-Unis', 'u.s': 'États-Unis', us: 'États-Unis', usa: 'États-Unis', 'united states': 'États-Unis',
  brazil: 'Brésil', canada: 'Canada', japan: 'Japon', england: 'Angleterre', scotland: 'Écosse', wales: 'Pays de Galles',
  'united kingdom': 'Royaume-Uni', uk: 'Royaume-Uni', 'northern ireland': 'Irlande du Nord', australia: 'Australie',
  poland: 'Pologne', mexico: 'Mexique', russia: 'Russie', netherlands: 'Pays-Bas', france: 'France',
  'new zealand': 'Nouvelle-Zélande', china: 'Chine', 'south korea': 'Corée du Sud', nigeria: 'Nigeria', italy: 'Italie',
  cameroon: 'Cameroun', iran: 'Iran', sweden: 'Suède', jamaica: 'Jamaïque', argentina: 'Argentine', ecuador: 'Équateur',
  bahamas: 'Bahamas', 'south africa': 'Afrique du Sud', cyprus: 'Chypre', denmark: 'Danemark', norway: 'Norvège',
  cuba: 'Cuba', ireland: 'Irlande', 'republic of ireland': 'Irlande', moldova: 'Moldavie', germany: 'Allemagne',
  'west germany': 'Allemagne', uzbekistan: 'Ouzbékistan', belarus: 'Biélorussie', hungary: 'Hongrie', croatia: 'Croatie',
  kazakhstan: 'Kazakhstan', kyrgyzstan: 'Kirghizistan', ukraine: 'Ukraine', lithuania: 'Lituanie',
  'czech republic': 'Tchéquie', czechia: 'Tchéquie', spain: 'Espagne', portugal: 'Portugal', switzerland: 'Suisse',
  austria: 'Autriche', belgium: 'Belgique', philippines: 'Philippines', thailand: 'Thaïlande', peru: 'Pérou',
  chile: 'Chili', colombia: 'Colombie', venezuela: 'Venezuela', 'dominican republic': 'République dominicaine',
  'puerto rico': 'Porto Rico', haiti: 'Haïti', morocco: 'Maroc', tunisia: 'Tunisie', egypt: 'Égypte',
  armenia: 'Arménie', azerbaijan: 'Azerbaïdjan', tajikistan: 'Tadjikistan', mongolia: 'Mongolie', iceland: 'Islande',
  finland: 'Finlande', turkey: 'Turquie', bulgaria: 'Bulgarie', romania: 'Roumanie', serbia: 'Serbie',
  'democratic republic of the congo': 'RD Congo', 'dr congo': 'RD Congo', ghana: 'Ghana', senegal: 'Sénégal',
  'bosnia and herzegovina': 'Bosnie-Herzégovine', slovakia: 'Slovaquie', latvia: 'Lettonie', estonia: 'Estonie',
};
const SSR: [RegExp, string][] = [
  [/russian sfsr|dagestan|chechen|kabardino|ingush|bashkir|tatar assr/i, 'Russie'],
  [/ukrainian ssr/i, 'Ukraine'], [/byelorussian ssr/i, 'Biélorussie'], [/georgian ssr/i, 'Géorgie'],
  [/armenian ssr/i, 'Arménie'], [/azerbaijan ssr/i, 'Azerbaïdjan'], [/kazakh ssr/i, 'Kazakhstan'],
  [/uzbek ssr/i, 'Ouzbékistan'], [/kirghiz ssr|kyrgyz ssr/i, 'Kirghizistan'], [/tajik ssr/i, 'Tadjikistan'],
  [/moldavian ssr/i, 'Moldavie'], [/lithuanian ssr/i, 'Lituanie'], [/latvian ssr/i, 'Lettonie'], [/estonian ssr/i, 'Estonie'],
];
/** Pays de naissance (en français) à partir des morceaux « ville, région, pays ». */
function birthCountry(segments: string[]): string | null {
  for (const [re, fr] of SSR) if (segments.some((s) => re.test(s))) return fr;
  return COUNTRIES[(segments.at(-1) ?? '').toLowerCase().replace(/\.$/, '.')] ?? null;
}
const COUNTRY_POOL = ['États-Unis', 'Brésil', 'Canada', 'Russie', 'Japon', 'Angleterre', 'Australie', 'Mexique', 'Pologne',
  'Pays-Bas', 'France', 'Nouvelle-Zélande', 'Chine', 'Corée du Sud', 'Nigeria', 'Kazakhstan', 'Irlande', 'Suède',
  'Cameroun', 'Ukraine', 'Argentine', 'Allemagne', 'Croatie', 'Géorgie'];

function heightCm(raw: string): number | null {
  const t = raw.replace(/<ref[\s\S]*/i, '');
  const ftIn =
    t.match(/(\d)\s*ft\s*(\d{1,2}(?:\.\d+)?)\s*in/i) ??
    t.match(/ft\s*=\s*(\d)\s*\|\s*in\s*=\s*(\d{1,2}(?:\.\d+)?)/i) ??
    t.match(/convert\s*\|\s*(\d)\s*\|\s*ft\s*\|\s*(\d{1,2}(?:\.\d+)?)\s*\|\s*in/i);
  let cm: number | null = ftIn ? (Number(ftIn[1]) * 12 + Number(ftIn[2])) * 2.54 : null;
  if (cm === null) {
    const m = t.match(/\bm\s*=\s*(1\.\d{1,2})/) ?? t.match(/(1\.\d{2})\s*m\b/);
    const c = t.match(/\b(1[5-9]\d|20\d)\s*cm/);
    cm = m ? Number(m[1]) * 100 : c ? Number(c[1]) : null;
  }
  return cm && cm >= 150 && cm <= 215 ? Math.round(cm) : null;
}

/** 3 événements proches, avec la bonne réponse à une position aléatoire une fois les 4 numéros triés. */
function spreadEvents(event: number, near: number[], rand: () => number): number[] {
  const below = Math.floor(rand() * 4);
  const lows = pick(near.filter((e) => e < event), near.length, rand);
  const highs = pick(near.filter((e) => e > event), near.length, rand);
  const takeLow = Math.min(below, lows.length);
  const takeHigh = Math.min(3 - takeLow, highs.length);
  return [...lows.slice(0, takeLow + (3 - takeLow - takeHigh)), ...highs.slice(0, takeHigh)];
}

/**
 * 3 fausses valeurs autour de `value`, placées pour que la bonne réponse tombe au hasard
 * en 1re, 2e, 3e ou 4e position une fois les 4 triées (et pas presque toujours au milieu).
 */
function spread(value: number, offsets: number[], rand: () => number, valid: (v: number) => boolean): number[] {
  const below = Math.floor(rand() * 4); // combien de fausses valeurs sous la bonne
  const lows = pick(offsets, offsets.length, rand).map((o) => value - o).filter(valid);
  const highs = pick(offsets, offsets.length, rand).map((o) => value + o).filter(valid);
  // Si un côté manque de valeurs possibles (ex. 0 défaite), on complète par l'autre.
  const takeLow = Math.min(below, lows.length, 3);
  const takeHigh = Math.min(3 - takeLow, highs.length);
  const result = [...lows.slice(0, takeLow + (3 - takeLow - takeHigh)), ...highs.slice(0, takeHigh)];
  return [...new Set(result)].slice(0, 3);
}

const WEIGHT_FR: Record<string, string> = {
  flyweight: 'Poids mouches', bantamweight: 'Poids coqs', featherweight: 'Poids plumes', lightweight: 'Poids légers',
  welterweight: 'Poids welters', middleweight: 'Poids moyens', 'light heavyweight': 'Poids mi-lourds', heavyweight: 'Poids lourds',
  "women's strawweight": 'Poids pailles', "women's flyweight": 'Poids mouches', "women's bantamweight": 'Poids coqs',
  "women's featherweight": 'Poids plumes',
};
const MEN_ORDER = ['flyweight', 'bantamweight', 'featherweight', 'lightweight', 'welterweight', 'middleweight', 'light heavyweight', 'heavyweight'];
const WOMEN_ORDER = ["women's strawweight", "women's flyweight", "women's bantamweight", "women's featherweight"];

const isWomen = (weight: string) => /^women/i.test(weight);
const pronoun = (weight: string) => (isWomen(weight) ? 'elle' : 'il');

const ordinal = (n: number) => (n === 1 ? '1er round' : `${n}e round`);
const vs = (b: Bout, rand: () => number) =>
  rand() < 0.5 ? `${b.winner.name} contre ${b.loser.name}` : `${b.loser.name} contre ${b.winner.name}`;
const pairKey = (b: Bout) => [b.winner.name, b.loser.name].sort().join(' / ');
const wiki = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
const slug = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Détail d'une finition en français ; mot à mot pour les combinaisons (« head kick and punches »). */
const WORDS: [RegExp, string][] = [
  [/\bspinning back kick\b/g, 'coup de pied retourné'],
  [/\bspinning back fist\b/g, 'revers tourné'],
  [/\bhead kick\b/g, 'coup de pied à la tête'],
  [/\bbody kick\b/g, 'coup de pied au corps'],
  [/\bleg kicks?\b/g, 'low kicks'],
  [/\bflying knee\b/g, 'genou sauté'],
  [/\bknees?\b/g, 'genou'],
  [/\belbows?\b/g, 'coudes'],
  [/\bpunch(es)?\b/g, 'coups de poing'],
  [/\bkicks?\b/g, 'coups de pied'],
  [/\bstrikes?\b/g, 'frappes'],
  [/\breferee stoppage\b/g, "arrêt de l'arbitre"],
  [/\bdue to\b/g, 'sur'],
  [/\bground and pound\b/g, 'frappes au sol'],
  [/\bcut\b/g, 'coupure'],
  [/\bcorner stoppage\b/g, 'arrêt par le coin'],
  [/\bdoctor stoppage\b/g, 'arrêt médical'],
  [/\bretirement\b/g, 'abandon entre les rounds'],
  [/\binjury\b/g, 'blessure'],
  [/\bslam\b/g, 'projection'],
  [/\bto the body\b/g, 'au corps'],
  [/\bto the head\b/g, 'à la tête'],
  [/\bwith\b/g, 'avec'],
  [/\band\b/g, 'et'],
];
const detailFr = (table: [RegExp, string][], detail: string) =>
  translate(table, detail) ?? WORDS.reduce((s, [re, fr]) => s.replace(re, fr), detail);

function describe(b: Bout): string {
  const how =
    b.method === 'dec'
      ? `par décision ${b.decision}`
      : b.method === 'sub'
        ? `par soumission${b.detail ? ` (${detailFr(SUBMISSIONS, b.detail)})` : ''}`
        : `par K.-O./TKO${b.detail ? ` (${detailFr(STRIKES, b.detail)})` : ''}`;
  const when = b.method === 'dec' ? `après ${b.maxRounds} rounds` : `au ${ordinal(b.round)} (${b.time})`;
  return `${b.winner.name} a battu ${b.loser.name} ${how} ${when}.`;
}

/** Niveau selon l'affiche : un combat pour le titre en main event est plus connu qu'un combat de sous-carte. */

// ── Génération ───────────────────────────────────────────────────────────

async function main() {
  console.log('Téléchargement des pages d’événements…');
  const eventTitles = Array.from({ length: MAX_EVENT }, (_, i) => `UFC ${i + 1}`);
  const eventPages = await fetchPages(eventTitles, 'evenements');

  const bouts: Bout[] = [];
  for (let n = 1; n <= MAX_EVENT; n++) {
    const text = eventPages.get(`UFC ${n}`);
    if (text) bouts.push(...parseEvent(n, text));
  }
  const events = [...new Set(bouts.map((b) => b.event))].sort((a, b) => a - b);
  console.log(`${events.length} événements lus, ${bouts.length} combats terminés.`);

  // Fiches des combattants des cartes principales (5 premiers combats de chaque UFC).
  const fighterTitles = [
    ...new Set(bouts.filter((b) => b.order < 5).flatMap((b) => [b.winner.page, b.loser.page]).filter(Boolean) as string[]),
  ];
  console.log('Téléchargement des fiches des combattants…');
  const fighterPages = await fetchPages(fighterTitles, 'combattants');

  // Questions déjà écrites à la main : on évite de reposer les mêmes surnoms.
  const hand = JSON.parse(await readFile(HAND_FILE, 'utf8')) as Question[];
  const handText = hand.map((q) => `${q.question} ${q.reponses.join(' ')}`.toLowerCase()).join('\n');

  // ── Niveau d'une question : type de question + notoriété des combattants + époque ──
  // Notoriété : 2 points par combat pour le titre, 1 par main event (UFC numérotés).
  const popularity = new Map<string, number>();
  const lastEvent = new Map<string, number>();
  for (const b of bouts) {
    for (const f of [b.winner, b.loser]) {
      popularity.set(f.name, (popularity.get(f.name) ?? 0) + (b.title ? 2 : 0) + (b.order === 0 ? 1 : 0));
      lastEvent.set(f.name, Math.max(lastEvent.get(f.name) ?? 0, b.event));
    }
  }
  /** 0 = superstar, 1 = star, 2 = connu, 3 = peu connu */
  const fameTier = (name: string) => {
    const p = popularity.get(name) ?? 0;
    return p >= 12 ? 0 : p >= 6 ? 1 : p >= 2 ? 2 : 4; // un inconnu pèse plus lourd
  };
  /** 0 = depuis 2015 (UFC 181+), 1 = 2005-2014, 2 = avant 2005 (avant l'UFC 52) */
  const eraTier = (event: number) => (event >= 181 ? 0 : event >= 52 ? 1 : 2);
  /** Difficulté propre à chaque type de question. */
  const BASE: Record<string, number> = {
    nick: 0, surnom: 0, pays: 1, titre: 0, bat: 0, pasbat: 1, fin: 1, team: 2, rnd: 2, ko: 2, sub: 2,
    me: 3, ev: 3, ville: 3, retraite: 3, bilan: 3, bilanufc: 3, premdef: 3, debutufc: 3, taille: 4,
  };
  interface Ctx {
    subjects: string[];
    event?: number;
    /** Combat pour le titre en main event : un cran plus connu. */
    titleMain?: boolean;
    /** Combat hors main event : un cran moins connu. */
    undercard?: boolean;
  }
  let ctx: Ctx = { subjects: [] };
  const levelOf = (template: string, c: Ctx): Level => {
    const tiers: number[] = c.subjects.map(fameTier);
    // Un combat est aussi connu que son combattant le plus connu ; une question « qui a battu X » dépend des deux.
    const fame = c.event !== undefined && c.subjects.length === 2 && !['bat', 'pasbat'].includes(template)
      ? Math.max(0, Math.min(...tiers) - (c.titleMain ? 1 : 0) + (c.undercard ? 1 : 0))
      : Math.ceil(tiers.reduce((a, b) => a + b, 0) / Math.max(1, tiers.length));
    const event = c.event ?? Math.max(0, ...c.subjects.map((s) => lastEvent.get(s) ?? 0));
    const score = (BASE[template] ?? 3) + fame + eraTier(event);
    return score <= 1 ? 'facile' : score <= 3 ? 'moyen' : score <= 5 ? 'difficile' : 'expert';
  };

  const out: GenQuestion[] = [];
  const add = (q: Omit<GenQuestion, 'statut' | 'origine' | 'bonne_reponse'>) => {
    const template = q.id.split('-')[1];
    out.push({ ...q, niveau: levelOf(template, ctx), bonne_reponse: 0, statut: 'a_verifier', origine: 'wikipedia' });
  };

  const mainEvents = new Map<number, Bout>();
  for (const b of bouts) if (b.order === 0) mainEvents.set(b.event, b);

  for (const b of bouts) {
    ctx = { subjects: [b.winner.name, b.loser.name], event: b.event, titleMain: b.title && b.order === 0, undercard: b.order > 0 };
    const rand = seeded(`${b.event}-${b.order}`);
    const src = wiki(`UFC ${b.event}`);
    const card = b.order === 0 ? 'main event' : b.order === 1 ? 'co-main event' : 'carte principale';

    // 1. Main event d'un UFC, et UFC d'un main event.
    if (b.order === 0) {
      // Une revanche en main event donnerait deux bonnes réponses : on écarte ces affiches.
      const pairing = pairKey(b);
      const rematch = [...mainEvents.values()].filter((m) => pairKey(m) === pairing).length > 1;
      const near = events.filter(
        (e) => e !== b.event && Math.abs(e - b.event) <= 8 && mainEvents.has(e) && pairKey(mainEvents.get(e)!) !== pairing,
      );
      const others = pick(near, 3, rand).map((e) => {
        const m = mainEvents.get(e)!;
        return `${m.winner.name} vs ${m.loser.name}`;
      });
      if (others.length === 3) {
        const level: Level = b.title && b.event >= 100 ? 'difficile' : 'expert';
        add({
          id: `gen-me-${b.event}`,
          categorie: 'combats',
          niveau: level,
          question: `Quel combat était le main event de l'UFC ${b.event} ?`,
          reponses: [`${b.winner.name} vs ${b.loser.name}`, ...others],
          explication: describe(b),
          source: src,
        });
        if (!rematch) add({
          id: `gen-ev-${b.event}`,
          categorie: 'combats',
          niveau: 'expert',
          question: `Lors de quel événement s'est tenu le main event ${vs(b, rand)} ?`,
          reponses: [`UFC ${b.event}`, ...spreadEvents(b.event, near, rand).map((e) => `UFC ${e}`)],
          explication: describe(b),
          source: src,
        });
      }
    }

    // 2. Comment s'est terminé le combat (main event et co-main event).
    if (b.order <= 1) {
      // 2 méthodes × 2 combattants : chaque nom et chaque méthode apparaissent deux fois, rien ne trahit la bonne réponse.
      const label = (f: Fighter, m: string) =>
        `${f.name} par ${m === 'ko' ? 'K.-O./TKO' : m === 'sub' ? 'soumission' : 'décision'}`;
      const other = pick((['ko', 'sub', 'dec'] as const).filter((m) => m !== b.method), 1, rand)[0];
      add({
        id: `gen-fin-${b.event}-${b.order}`,
        categorie: 'combats',
        niveau: 'expert',
        question: `Comment s'est terminé ${vs(b, rand)}, ${card} de l'UFC ${b.event} ?`,
        reponses: [label(b.winner, b.method), label(b.loser, b.method), label(b.winner, other), label(b.loser, other)],
        explication: describe(b),
        source: src,
      });
    }

    // 3. À quel round s'est terminé le combat (finitions des combats principaux).
    // Équilibre des réponses : la plupart des finitions arrivent au 1er round ; on en garde un peu plus de la moitié
    // pour que « 1er round » ne soit pas la bonne réponse presque une fois sur deux.
    const keepRound = b.round !== 1 || seeded(`rnd-${b.event}-${b.order}`)() < 0.55;
    if (b.order <= 1 && b.method !== 'dec' && keepRound) {
      const rounds = Array.from({ length: b.maxRounds }, (_, i) => i + 1).filter((r) => r !== b.round);
      const wrong = pick(rounds, 3, rand).map(ordinal);
      if (wrong.length < 3) wrong.push('Il est allé à la décision');
      add({
        id: `gen-rnd-${b.event}-${b.order}`,
        categorie: 'combats',
        niveau: 'expert',
        question: `À quel round s'est terminé ${vs(b, rand)} (UFC ${b.event}) ?`,
        reponses: [ordinal(b.round), ...wrong],
        explication: describe(b),
        source: src,
      });
    }

    // 4. Quelle soumission (toute la carte principale).
    if (b.order < 5 && b.method === 'sub') {
      const sub = translate(SUBMISSIONS, b.detail);
      // L'étranglement arrière est la soumission la plus fréquente : on n'en garde qu'une partie.
      const keepSub = sub !== 'Étranglement arrière' || seeded(`sub-${b.event}-${b.order}`)() < 0.6;
      if (sub && keepSub) {
        add({
          id: `gen-sub-${b.event}-${b.order}`,
          categorie: 'combats',
          niveau: 'expert',
          question: `Par quelle soumission ${b.winner.name} a-t-${pronoun(b.weight)} battu ${b.loser.name} à l'UFC ${b.event} ?`,
          reponses: [sub, ...pick(SUB_POOL.filter((s) => s !== sub), 3, rand)],
          explication: describe(b),
          source: src,
        });
      }
    }

    // 5. Quelle frappe (toute la carte principale).
    if (b.order < 5 && b.method === 'ko') {
      const strike = translate(STRIKES, b.detail);
      // Presque tous les K.-O. sont aux poings : on n'en garde qu'une petite part, sinon la réponse se devine.
      const keepStrike = strike !== 'Coups de poing' || seeded(`ko-${b.event}-${b.order}`)() < 0.07;
      if (strike && keepStrike) {
        add({
          id: `gen-ko-${b.event}-${b.order}`,
          categorie: 'combats',
          niveau: 'expert',
          question: `Avec quelle arme ${b.winner.name} a-t-${pronoun(b.weight)} mis fin au combat contre ${b.loser.name} (UFC ${b.event}) ?`,
          reponses: [strike, ...pick(STRIKE_POOL.filter((s) => s !== strike), 3, rand)],
          explication: describe(b),
          source: src,
        });
      }
    }
  }

  // 6 et 7. Surnoms et équipes des combattants des cartes principales.
  interface Profile {
    name: string;
    page: string;
    weight: string;
    nickname: string | null;
    team: string | null;
    fame: number; // 2 = combat pour le titre, 1 = main event, 0 = carte principale
  }
  const profiles = new Map<string, Profile>();
  for (const b of bouts.filter((x) => x.order < 5)) {
    for (const f of [b.winner, b.loser]) {
      if (!f.page) continue;
      const text = fighterPages.get(f.page);
      if (!text) continue;
      const fame = b.title ? 2 : b.order === 0 ? 1 : 0;
      const prev = profiles.get(f.name);
      if (prev) { prev.fame = Math.max(prev.fame, fame); continue; }
      const nickRaw = infobox(text, 'nickname');
      const nick = nickRaw ? plain(nickRaw).replace(/^["“”«»]+|["“”«»]+$/g, '').trim() : '';
      const teamRaw = infobox(text, 'team');
      let team: string | null = null;
      if (teamRaw) {
        const items = listItems(teamRaw);
        const present = items.filter((t) => /present/i.test(t));
        const chosen = present.length === 1 ? present[0] : items.length === 1 ? items[0] : null;
        team = chosen ? chosen.replace(/\([^)]*\)/g, '').replace(/\s*[-–—]\s*$/, '').trim() : null;
        if (team && (/[{}|=<>]/.test(team) || team.length < 3)) team = null;
      }
      profiles.set(f.name, {
        name: f.name,
        page: f.page,
        weight: b.weight,
        nickname: nick && nick.length <= 30 && !/[,;/]| or |\bet\b/i.test(nick) ? nick : null,
        team: team && team.length <= 40 ? team : null,
        fame,
      });
    }
  }
  const people = [...profiles.values()];

  const withNick = people.filter((p) => p.nickname && !handText.includes(p.nickname.toLowerCase()));
  for (const p of withNick) {
    ctx = { subjects: [p.name] };
    const rand = seeded(`nick-${p.page}`);
    const sameWeight = withNick.filter((o) => o !== p && o.weight === p.weight && o.nickname !== p.nickname);
    const pool = sameWeight.length >= 3 ? sameWeight : withNick.filter((o) => o !== p && o.nickname !== p.nickname);
    const s = slug(p.page);
    add({
      id: `gen-nick-${s}`,
      categorie: 'combattants',
      niveau: 'moyen',
      question: `${isWomen(p.weight) ? 'Quelle combattante est surnommée' : 'Quel combattant est surnommé'} « ${p.nickname} » ?`,
      reponses: [p.name, ...pick(pool.filter((o) => o.name !== p.name), 3, rand).map((o) => o.name)],
      explication: `${p.name} combat sous le surnom « ${p.nickname} ».`,
      source: wiki(p.page),
    });
    add({
      id: `gen-surnom-${s}`,
      categorie: 'combattants',
      niveau: 'moyen',
      question: `Quel est le surnom de ${p.name} ?`,
      reponses: [p.nickname!, ...pick(pool, 3, rand).map((o) => o.nickname!)],
      explication: `${p.name} combat sous le surnom « ${p.nickname} ».`,
      source: wiki(p.page),
    });
  }

  // Équipes : seulement celles qui reviennent souvent (de vraies salles connues), pour des fausses réponses crédibles.
  const teamCount = new Map<string, number>();
  for (const p of people) if (p.team) teamCount.set(p.team, (teamCount.get(p.team) ?? 0) + 1);
  const knownTeams = [...teamCount.entries()].filter(([, n]) => n >= 3).map(([t]) => t);
  for (const p of people.filter((x) => x.team && knownTeams.includes(x.team) && x.fame >= 1)) {
    ctx = { subjects: [p.name] };
    const rand = seeded(`team-${p.page}`);
    add({
      id: `gen-team-${slug(p.page)}`,
      categorie: 'combattants',
      niveau: 'difficile',
      question: `Dans quelle équipe s'entraîne (ou s'entraînait) ${p.name} ?`,
      reponses: [p.team!, ...pick(knownTeams.filter((t) => t !== p.team), 3, rand)],
      explication: `${p.name} est ${isWomen(p.weight) ? 'rattachée' : 'rattaché'} à l'équipe ${p.team} selon sa fiche Wikipédia.`,
      source: wiki(p.page),
    });
  }

  // 8. CV des combattants : pays et ville de naissance, taille, fin de carrière.
  const cvPeople = people.map((p) => ({ ...p, text: fighterPages.get(p.page) ?? '', women: isWomen(p.weight) }));
  const facts = cvPeople.map((p) => {
    const place = plain(infobox(p.text, 'birth_place') ?? '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
    const segments = place.split(',').map((s) => s.trim()).filter(Boolean);
    const country = birthCountry(segments);
    const city = segments.length >= 2 && country ? segments[0] : null;
    // Années d'activité : seulement si elles ne concernent que le MMA (pas de boxe, kickboxing, catch…).
    const years = plain(infobox(p.text, 'years_active') ?? '').replace(/\(MMA\)/gi, '').trim();
    const mmaOnly = /^(19[89]\d|20[0-2]\d)\s*[–-]\s*(19[89]\d|20[0-2]\d|present)$/i.exec(years);
    const start = mmaOnly ? Number(mmaOnly[1]) : null;
    const single = mmaOnly && /^\d{4}$/.test(mmaOnly[2]) ? mmaOnly : null;
    return {
      ...p,
      country,
      city,
      height: heightCm(infobox(p.text, 'height') ?? ''),
      start,
      retired: single && Number(single[2]) <= 2024 ? Number(single[2]) : null,
    };
  });
  const ne = (w: boolean) => (w ? 'née' : 'né');
  const il = (w: boolean) => (w ? 'elle' : 'il');

  for (const f of facts) {
    ctx = { subjects: [f.name] };
    const rand = seeded(`cv-${f.page}`);
    const s = slug(f.page);
    const src = wiki(f.page);
    // Les détails de CV n'ont d'intérêt que pour les combattants connus (main event ou combat pour le titre).
    const known = f.fame >= 1;

    // Pays : « États-Unis » serait trop souvent la réponse ; on le garde pour les combattants titrés.
    if (f.country && (f.country !== 'États-Unis' || f.fame === 2)) {
      const others = pick(COUNTRY_POOL.filter((c) => c !== f.country), 3, rand);
      add({ id: `gen-pays-${s}`, categorie: 'cv', niveau: 'moyen',
        question: `Dans quel pays ${f.name} est-${il(f.women)} ${ne(f.women)} ?`,
        reponses: [f.country, ...others],
        explication: `${f.name} est ${ne(f.women)} à ${f.city ?? f.country} (${f.country}).`, source: src });
    }
    if (known && f.city && f.country) {
      const sameCountry = facts.filter((o) => o.country === f.country && o.city && o.city !== f.city).map((o) => o.city!);
      const others = pick([...new Set(sameCountry)], 3, rand);
      if (others.length === 3)
        add({ id: `gen-ville-${s}`, categorie: 'cv', niveau: 'difficile',
          question: `Dans quelle ville ${f.name} est-${il(f.women)} ${ne(f.women)} (${f.country}) ?`,
          reponses: [f.city, ...others],
          explication: `${f.name} est ${ne(f.women)} à ${f.city} (${f.country}).`, source: src });
    }
    if (known && f.height) {
      const m = (cm: number) => `${(cm / 100).toFixed(2).replace('.', ',')} m`;
      const wrong = spread(f.height, [2, 3, 4, 5, 6, 8, 10], rand, (v) => v >= 150 && v <= 215);
      if (wrong.length === 3)
        add({ id: `gen-taille-${s}`, categorie: 'cv', niveau: 'expert',
          question: `Quelle est la taille de ${f.name} ?`,
          reponses: [m(f.height), ...wrong.map(m)],
          explication: `${f.name} mesure ${m(f.height)} selon sa fiche.`, source: src });
    }
    if (f.retired && f.start && f.retired > f.start) {
      const wrong = spread(f.retired, [1, 2, 3, 4, 5], rand, (y) => y > f.start! && y <= 2025);
      if (wrong.length === 3)
        add({ id: `gen-retraite-${s}`, categorie: 'cv', niveau: 'difficile',
          question: `En quelle année ${f.name} a-t-${il(f.women)} disputé son dernier combat de MMA ?`,
          reponses: [String(f.retired), ...wrong.map(String)],
          explication: `${f.name} a combattu en MMA de ${f.start} à ${f.retired}.`, source: src });
    }
  }

  // 9. Palmarès : bilans (datés, ils bougent), « qui a battu X », première défaite, premier adversaire à l'UFC.
  const asOf = (await stat(path.join(CACHE_DIR, 'combattants.json'))).mtime;
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const asOfMonth = `${MOIS[asOf.getMonth()]} ${asOf.getFullYear()}`;
  const asOfDay = asOf.toLocaleDateString('fr-FR');
  const knownNames = new Set(people.filter((p) => p.fame >= 1).map((p) => p.name));
  /**
   * Bilans proposés : le nombre de victoires de la bonne réponse tombe au hasard
   * en 1re, 2e, 3e ou 4e position une fois les 4 triées (pas toujours au milieu).
   */
  const recordChoices = (w: number, l: number, d: number, rand: () => number) => {
    const wins = spread(w, [1, 2, 3, 4], rand, (v) => v >= 0);
    return wins.map((v) => recordLabel(v, Math.max(0, l + Math.floor(rand() * 3) - 1), d));
  };
  const famousFirst = (names: string[], rand: () => number) => [
    ...pick(names.filter((n) => knownNames.has(n)), names.length, rand),
    ...pick(names.filter((n) => !knownNames.has(n)), names.length, rand),
  ];

  // Catégorie de poids : celle du combat s'il figure dans un UFC numéroté, sinon la catégorie habituelle de l'adversaire.
  const pairWeight = new Map<string, string>();
  const usualWeights = new Map<string, Map<string, number>>();
  for (const b of bouts) {
    const w = b.weight.toLowerCase();
    if (!WEIGHT_FR[w]) continue; // catchweight, open weight…
    pairWeight.set([b.winner.name, b.loser.name].sort().join('|'), w);
    for (const name of [b.winner.name, b.loser.name]) {
      const m = usualWeights.get(name) ?? new Map<string, number>();
      m.set(w, (m.get(w) ?? 0) + 1);
      usualWeights.set(name, m);
    }
  }
  const usualWeight = (name: string) => {
    const m = usualWeights.get(name);
    return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
  };
  const fightWeight = (x: string, opponent: string) =>
    pairWeight.get([x, opponent].sort().join('|')) ?? usualWeight(opponent);

  for (const f of facts.filter((x) => x.fame >= 1)) {
    const rec = mmaRecord(f.text);
    if (!rec) continue;
    ctx = { subjects: [f.name] };
    const rand = seeded(`palmares-${f.page}`);
    const s = slug(f.page);
    const src = wiki(f.page);

    add({ id: `gen-bilan-${s}`, categorie: 'cv', niveau: 'difficile',
      question: `En ${asOfMonth}, quel est le bilan de ${f.name} en MMA (victoires-défaites${rec.draws ? '-nuls' : ''}) ?`,
      reponses: [recordLabel(rec.wins, rec.losses, rec.draws), ...recordChoices(rec.wins, rec.losses, rec.draws, rand)],
      explication: `Au ${asOfDay}, ${f.name} compte ${n(rec.wins, 'victoire')}, ${n(rec.losses, 'défaite')}${rec.draws ? `, ${n(rec.draws, 'nul')}` : ''}${rec.nc ? ` et ${rec.nc} no contest` : ''} en MMA professionnel.`,
      source: src });

    const ufc = rec.fights.filter((x) => x.ufc);
    const uw = ufc.filter((x) => x.result === 'win').length;
    const ul = ufc.filter((x) => x.result === 'loss').length;
    const ud = ufc.filter((x) => x.result === 'draw').length;
    if (ufc.length >= 3)
      add({ id: `gen-bilanufc-${s}`, categorie: 'cv', niveau: 'difficile',
        question: `En ${asOfMonth}, quel est le bilan de ${f.name} à l'UFC (victoires-défaites${ud ? '-nuls' : ''}) ?`,
        reponses: [recordLabel(uw, ul, ud), ...recordChoices(uw, ul, ud, rand)],
        explication: `Au ${asOfDay}, ${f.name} compte ${n(uw, 'victoire')} et ${n(ul, 'défaite')}${ud ? ` (et ${n(ud, 'nul')})` : ''} à l'UFC.`,
        source: src });

    const beatX = [...new Set(rec.fights.filter((x) => x.result === 'loss').map((x) => x.opponent))];
    const drawnOrNc = new Set(rec.fights.filter((x) => x.result === 'draw' || x.result === 'nc').map((x) => x.opponent));
    const onlyBeaten = [...new Set(rec.fights.filter((x) => x.result === 'win').map((x) => x.opponent))].filter(
      (n) => !beatX.includes(n) && !drawnOrNc.has(n),
    );

    // Les 4 réponses doivent être des adversaires affrontés dans la même catégorie de poids.
    const sameWeight = (names: string[], weight: string) => names.filter((n) => fightWeight(f.name, n) === weight);

    // « Lequel de ces combattants a battu X ? » : un vainqueur, et 3 adversaires que X a toujours battus.
    if (onlyBeaten.length >= 3) {
      let made = 0;
      for (const winner of famousFirst(beatX, rand)) {
        if (made >= 3) break;
        const weight = fightWeight(f.name, winner);
        const pool = weight ? sameWeight(onlyBeaten, weight) : [];
        if (pool.length < 3) continue;
        made++;
        ctx = { subjects: [f.name, winner] };
        const fight = rec.fights.find((x) => x.result === 'loss' && x.opponent === winner)!;
        add({ id: `gen-bat-${s}-${slug(winner)}`, categorie: 'cv', niveau: 'moyen',
          question: `En ${asOfMonth}, lequel de ces combattants avait déjà battu ${f.name} ?`,
          reponses: [winner, ...famousFirst(pool, rand).slice(0, 6).sort(() => rand() - 0.5).slice(0, 3)],
          explication: `${winner} a battu ${f.name} (${fight.event}). Les trois autres ont tous perdu contre ${f.women ? 'elle' : 'lui'}.`,
          source: src });
      }
    }

    // « Lequel n'a jamais battu X ? » : un adversaire que X a toujours battu, parmi 3 qui l'ont battu.
    if (beatX.length >= 3) {
      let made = 0;
      for (const survivor of famousFirst(onlyBeaten, rand)) {
        if (made >= 2) break;
        const weight = fightWeight(f.name, survivor);
        const pool = weight ? sameWeight(beatX, weight) : [];
        if (pool.length < 3) continue;
        made++;
        ctx = { subjects: [f.name, survivor] };
        add({ id: `gen-pasbat-${s}-${slug(survivor)}`, categorie: 'cv', niveau: 'moyen',
          question: `En ${asOfMonth}, lequel de ces combattants n'avait jamais battu ${f.name} ?`,
          reponses: [survivor, ...famousFirst(pool, rand).slice(0, 5).sort(() => rand() - 0.5).slice(0, 3)],
          explication: `${survivor} a affronté ${f.name} sans jamais ${f.women ? 'la' : 'le'} battre ; les trois autres ${f.women ? "l'ont toutes" : "l'ont tous"} battu${f.women ? 'e' : ''}.`,
          source: src });
      }
    }

    ctx = { subjects: [f.name] };
    if (onlyBeaten.length >= 3) {
      // Première défaite en carrière (un fait qui ne bouge plus).
      const firstLoss = rec.fights.find((x) => x.result === 'loss');
      if (firstLoss && !rec.fights.some((x) => x !== firstLoss && x.date === firstLoss.date))
        add({ id: `gen-premdef-${s}`, categorie: 'cv', niveau: 'difficile',
          question: `Qui a infligé à ${f.name} sa première défaite en MMA professionnel ?`,
          reponses: [firstLoss.opponent, ...famousFirst(onlyBeaten.filter((n) => n !== firstLoss.opponent), rand).slice(0, 6).sort(() => rand() - 0.5).slice(0, 3)],
          explication: `${f.name} a connu sa première défaite contre ${firstLoss.opponent} (${firstLoss.event}).`,
          source: src });
    }

    // Premier adversaire à l'UFC.
    const debut = ufc[0];
    const otherUfc = [...new Set(ufc.slice(1).map((x) => x.opponent))].filter((n) => n !== debut?.opponent);
    if (debut && otherUfc.length >= 3 && !ufc.some((x) => x !== debut && x.date === debut.date))
      add({ id: `gen-debutufc-${s}`, categorie: 'cv', niveau: 'difficile',
        question: `Contre qui ${f.name} a-t-${f.women ? 'elle' : 'il'} disputé son premier combat à l'UFC ?`,
        reponses: [debut.opponent, ...pick(otherUfc, 3, rand)],
        explication: `${f.name} a fait ses débuts à l'UFC contre ${debut.opponent} (${debut.event}), ${debut.result === 'win' ? `et ${f.women ? 'l’a emporté' : 'l’a emporté'}` : debut.result === 'loss' ? 'et a perdu' : 'sans vainqueur'}.`,
        source: src });
  }

  // Champion de quelle catégorie (combats pour le titre incontesté des UFC numérotés).
  const titles = new Map<string, Set<string>>();
  // À partir de l'UFC 31 seulement : avant, les catégories portaient d'autres noms (« middleweight » = mi-lourds…).
  for (const b of bouts.filter((x) => x.event >= 31 && x.title && !x.interim && WEIGHT_FR[x.weight.toLowerCase()]))
    (titles.get(b.winner.name) ?? titles.set(b.winner.name, new Set()).get(b.winner.name)!).add(b.weight.toLowerCase());
  for (const [name, set] of titles) {
    if (set.size !== 1) continue; // double champion : réponse multiple, on ne pose pas
    const weight = [...set][0];
    const women = weight.startsWith('women');
    const order = women ? WOMEN_ORDER : MEN_ORDER;
    const i = order.indexOf(weight);
    const others = order.filter((w) => w !== weight).sort((a, b) => Math.abs(order.indexOf(a) - i) - Math.abs(order.indexOf(b) - i)).slice(0, 3);
    if (others.length < 3) continue;
    const page = bouts.find((b) => b.winner.name === name)?.winner.page ?? name;
    ctx = { subjects: [name] };
    add({ id: `gen-titre-${slug(name)}`, categorie: 'cv', niveau: 'moyen',
      question: `Dans quelle catégorie ${name} a-t-${women ? 'elle' : 'il'} été ${women ? 'championne' : 'champion'} de l'UFC ?`,
      reponses: [WEIGHT_FR[weight], ...others.map((w) => WEIGHT_FR[w])],
      explication: `${name} a remporté la ceinture des ${WEIGHT_FR[weight]} lors d'un UFC numéroté.`, source: wiki(page) });
  }

  // Contrôle final : 4 réponses distinctes, sinon la question est écartée.
  const kept = out.filter((q) => q.reponses.length === 4 && new Set(q.reponses).size === 4);
  const ids = new Set<string>();
  const unique = kept.filter((q) => (ids.has(q.id) ? false : (ids.add(q.id), true)));
  await writeFile(OUT_FILE, JSON.stringify(unique, null, 2) + '\n', 'utf8');

  const by = (key: (q: GenQuestion) => string) => {
    const m = new Map<string, number>();
    for (const q of unique) m.set(key(q), (m.get(key(q)) ?? 0) + 1);
    return [...m.entries()].map(([k, v]) => `${k} ${v}`).join(' · ');
  };
  console.log(`\n${unique.length} questions générées dans data/questions-generees.json`);
  console.log(`  par modèle : ${by((q) => q.id.split('-')[1])}`);
  console.log(`  par niveau : ${by((q) => q.niveau)}`);
  console.log(`  par catégorie : ${by((q) => q.categorie as Category)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
