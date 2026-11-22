# TAP OUT · le quiz MMA entre potes

Quiz web sur l'UFC à 4 réponses, en solo ou entre potes dans un salon privé. Les parties se jouent comme un combat :
des rounds de questions, une carte des juges entre les rounds, et un vainqueur annoncé à la fin.

- **Solo** : choisis un niveau (Facile, Moyen, Difficile, Expert ou Mix) et un format (Combat classique 3×5 ou Main Event 5×5). Ton record est gardé dans ton navigateur.
- **Salon privé** : crée un salon, envoie le code ou le lien à tes potes (2 à 10 joueurs), et tout le monde a la même question au même moment.
- **Score** : de 1000 points (réponse immédiate) à 500 points (à 20 s) par bonne réponse, 0 sinon.

Jeu de fans non officiel, sans lien avec l'UFC.

---

## Jouer sur son ordinateur

Il faut [Node.js](https://nodejs.org) en version 22 ou plus récente (la version « LTS » du site convient).

Dans un terminal, dans le dossier du jeu :

```
npm install
npm run dev
```

Puis ouvre **http://localhost:3000**. Pour tester un salon seul, ouvre plusieurs onglets : chaque onglet est un joueur différent.

`npm install` n'est à faire qu'une fois (et après chaque mise à jour des dépendances).

---

## Mettre le jeu en ligne (gratuit)

Le jeu tourne sur [Render](https://render.com), dont l'offre gratuite suffit. Il faut deux comptes **personnels** : GitHub (pour héberger le code) et Render (pour faire tourner le jeu).

### 1. Mettre le code sur GitHub

1. Crée un compte sur [github.com](https://github.com) si tu n'en as pas.
2. Crée un nouveau dépôt (bouton **New**) : nom `tap-out`, visibilité **Private** si tu veux, **sans** cocher « Add a README ».
3. Dans le dossier du jeu, envoie le code (GitHub affiche ces commandes sur la page du dépôt vide) :

   ```
   git remote add origin https://github.com/TON-PSEUDO/tap-out.git
   git push -u origin main
   ```

   La première fois, git ouvre une fenêtre pour te connecter à GitHub.

### 2. Lancer le jeu sur Render

1. Crée un compte sur [render.com](https://render.com) (le plus simple : « Sign in with GitHub »).
2. Clique **New +** → **Blueprint**, choisis le dépôt `tap-out` et valide. Render lit le fichier `render.yaml` du projet et configure tout seul le service (offre gratuite, compilation, démarrage).
3. Attends la fin du premier déploiement (2 à 4 minutes). Render affiche l'adresse du jeu, du type `https://tap-out-xxxx.onrender.com`. C'est ce lien que tu partages.

Chaque `git push` sur GitHub remet automatiquement le jeu à jour en ligne.

### À savoir sur l'offre gratuite

- Après **15 minutes sans joueur**, le serveur s'endort. Le premier qui ouvre le lien attend environ **1 minute** qu'il se réveille. Ensuite, tout est fluide.
- Render peut redémarrer le serveur à tout moment : les salons en cours sont alors fermés (il suffit d'en recréer un). Les records solo, eux, sont gardés dans chaque navigateur.
- 750 heures gratuites par mois : largement assez, le serveur ne compte pas quand il dort.

---

## Ajouter ou corriger des questions

Les questions écrites à la main sont dans **`data/questions.json`**. Ajouter une question = ajouter un bloc dans la liste, sans toucher au code :

```json
{
  "id": "hist-moy-026",
  "categorie": "histoire",
  "niveau": "moyen",
  "question": "Qui a remporté le tournoi de l'UFC 1 en 1993 ?",
  "reponses": ["Royce Gracie", "Ken Shamrock", "Gerard Gordeau", "Dan Severn"],
  "bonne_reponse": 0,
  "explication": "Royce Gracie a battu Gerard Gordeau en finale, par soumission.",
  "source": "https://fr.wikipedia.org/wiki/UFC_1",
  "statut": "a_verifier"
}
```

- `id` : unique (catégorie-niveau-numéro).
- `categorie` : `histoire`, `champions`, `records` ou `regles`.
- `niveau` : `facile`, `moyen`, `difficile` ou `expert`.
- `reponses` : exactement 4 réponses ; `bonne_reponse` est la position de la bonne (0 = la première). Le jeu mélange les réponses à l'affichage.
- `statut` : `a_verifier` tant que personne n'a relu, `verifiee` ensuite.
- Un fait qui change avec le temps (champion, record) doit être daté dans la question : « En 2025, … ».

Le jeu relit le fichier tout seul : la question est jouable dès la partie suivante.

Pour contrôler la banque après une modification :

```
npm run questions
```

Cette commande signale les erreurs (question mal formée, doublon), compte les questions par niveau et par catégorie, et met à jour **`data/a-verifier.md`**, la liste des questions à relire (Expert en premier).

### Questions générées depuis Wikipédia

Le fichier **`data/questions-generees.json`** contient environ 6 000 questions générées automatiquement à partir des pages Wikipédia des UFC numérotés et des combattants : main events, finishes, rounds, soumissions, surnoms, équipes, CV et palmarès (bilans, « qui a battu X »…). Ne le modifie pas à la main : il est réécrit à chaque génération.

```
npm run generer                  # régénère à partir des pages déjà téléchargées
npm run generer -- --rafraichir  # retélécharge les pages (nouveaux UFC, bilans à jour)
```

Les bilans et palmarès sont datés dans la question (« En novembre 2026, … ») avec la date du téléchargement.

---

## Commandes utiles

| Commande | Rôle |
|---|---|
| `npm run dev` | Lance le jeu en local sur http://localhost:3000 |
| `npm run build` | Prépare la version de production (dossier `dist/`) |
| `npm start` | Lance la version de production |
| `npm run check` | Vérifie le code TypeScript |
| `npm run questions` | Contrôle la banque de questions et écrit `data/a-verifier.md` |
| `npm run generer` | Régénère les questions depuis Wikipédia |

## Organisation du code

| Dossier | Contenu |
|---|---|
| `src/` | Les écrans du jeu (React) et la charte graphique (`src/styles/`) |
| `server/` | Le serveur : parties, chrono, score, salons (Node.js + Socket.IO) |
| `shared/` | Ce que le serveur et les navigateurs s'échangent |
| `data/` | Les questions |
| `scripts/` | Contrôle et génération des questions |

Le serveur fait foi : il tire les questions, tient le chrono, reçoit les réponses et calcule les points. Les navigateurs ne reçoivent la bonne réponse qu'au moment de la révélation.
