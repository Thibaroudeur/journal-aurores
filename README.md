# Journal de calibration des aurores

Toutes les 30 minutes, une GitHub Action relève l'activité aurorale au-dessus
de l'Islande et l'ajoute à un fichier du jour. Le but : caler le modèle
« Prévu » de [/outils/aurores](https://thibaroudeur.com/outils/aurores) (Kp
prévu posé sur l'ovale de Starkov) sur le modèle « En direct » de la NOAA
(OVATION), en les comparant sur des semaines de relevés. Contexte : spec
`docs/superpowers/specs/2026-10-16-aurores-refonte-design.md`, section 9, dans
le dépôt du site.

Ce fichier existe à deux endroits, identiques :

| Où | Rôle |
|---|---|
| Dépôt du site, `scripts/journal-aurores/` | La source : le script y est testé (`__tests__/aurora/journal.test.ts`). |
| Dépôt public [Thibaroudeur/journal-aurores](https://github.com/Thibaroudeur/journal-aurores) | Là où le journal tourne et où s'accumulent les données. |

Pourquoi un dépôt public à part : les minutes d'Actions y sont gratuites et
illimitées. Dans le dépôt du site, privé, le journal aurait consommé environ
1 490 des 2 000 minutes gratuites par mois (GitHub compte chaque passage pour
une minute entière), au risque de bloquer les contrôles du site. Les données
publiées sont celles de la NOAA, déjà publiques.

## Lancer, arrêter, vérifier

Le journal tourne dès que le workflow est actif. Il n'a pas de date de fin :
c'est à toi de l'arrêter quand il y a assez de nuits pour l'analyse.

Arrêter le journal (les données restent) :

```bash
gh workflow disable releve.yml -R Thibaroudeur/journal-aurores
```

Le relancer :

```bash
gh workflow enable releve.yml -R Thibaroudeur/journal-aurores
```

Faire un relevé tout de suite, hors planning :

```bash
gh workflow run releve.yml -R Thibaroudeur/journal-aurores
```

Voir les derniers passages et leur résultat :

```bash
gh run list -R Thibaroudeur/journal-aurores --limit 10
```

Sans terminal : sur GitHub, onglet **Actions**, workflow **Relevé**, menu
« ⋯ » en haut à droite, **Disable workflow** (ou **Enable workflow**). Le
bouton **Run workflow** fait un relevé immédiat.

Une fois l'analyse faite, le dépôt peut être archivé (Settings, tout en bas,
**Archive this repository**) : il passe en lecture seule et plus rien ne tourne.
Penser aussi à couper le déclencheur externe et à supprimer son jeton (section
suivante).

## Le déclencheur externe : cron-job.org

Le planning de GitHub seul ne suffit pas. La première nuit (16 au 17 octobre
2026), il n'a lancé que 4 relevés en 13 heures au lieu de 27 : 20 h 53,
23 h 26, 1 h 28 et 6 h 03 UTC. GitHub ne garantit pas ses tâches planifiées.
Un lancement par l'API, lui, démarre en quelques secondes. Le service gratuit
[cron-job.org](https://cron-job.org) appelle donc l'API toutes les 30 minutes.
Le planning de GitHub reste en place comme filet de sécurité.

À faire une fois, à la main (un compte et un jeton ne se créent que par
leur propriétaire).

**1. Un jeton GitHub limité à ce dépôt.** Sur GitHub : Settings, Developer
settings, Personal access tokens, **Fine-grained tokens**, **Generate new
token**.

| Champ | Valeur |
|---|---|
| Token name | `journal-aurores cron` |
| Expiration | 90 jours (au-delà, le journal retombe sur le seul planning de GitHub) |
| Repository access | **Only select repositories**, `Thibaroudeur/journal-aurores` |
| Permissions, Repository permissions | **Actions : Read and write** (rien d'autre) |

Ce jeton ne peut que lancer et lire les workflows de ce dépôt public : ni le
code, ni le dépôt du site.

**2. La tâche sur cron-job.org.** Créer un compte, puis **Create cronjob** :

| Champ | Valeur |
|---|---|
| Title | `Relevé aurores` |
| URL | `https://api.github.com/repos/Thibaroudeur/journal-aurores/actions/workflows/releve.yml/dispatches` |
| Execution schedule | Custom : toutes les heures, minutes `7` et `37` |
| Advanced, Request method | `POST` |
| Advanced, Headers | `Authorization` : `Bearer <le jeton>` |
| | `Accept` : `application/vnd.github+json` |
| | `X-GitHub-Api-Version` : `2022-11-28` |
| | `Content-Type` : `application/json` |
| Advanced, Request body | `{"ref":"main"}` |

**Test run** doit répondre 200 ou 204, et un passage `workflow_dispatch`
apparaît dans `gh run list` dans la minute.

Pour couper le déclencheur : désactiver la tâche sur cron-job.org, puis
supprimer le jeton sur GitHub. `gh workflow disable` suffit aussi à tout
arrêter, puisqu'un workflow désactivé refuse les lancements par l'API.

## Ce qu'il faut savoir

- **Relevés en double.** Quand le planning de GitHub se réveille en même temps
  que cron-job.org, deux relevés tombent à une minute d'écart. Ce n'est pas
  gênant : chaque ligne porte son heure exacte, et deux lignes qui ont la même
  `ovation.observation` décrivent la même grille.
- **Pannes de la NOAA.** Si un flux ne répond pas, la ligne est écrite quand
  même : la clé de ce flux vaut `null` et `pannes` dit pourquoi.
- **Inactivité.** GitHub désactive les tâches planifiées d'un dépôt public
  après 60 jours sans activité. Les commits du journal devraient compter comme
  activité, mais je ne l'ai pas vérifié. Si le journal s'arrête seul,
  `gh workflow enable` le relance.
- **Volume.** Environ 4 Ko par relevé, 200 Ko par jour, 8 Mo pour six semaines.

## Récupérer les données

```bash
git clone https://github.com/Thibaroudeur/journal-aurores
```

puis `git pull` dans ce dossier pour les relevés suivants. Un fichier par jour
UTC, `donnees/AAAA-MM-JJ.ndjson`, une ligne JSON par relevé.

## Format d'une ligne (version 1)

```json
{
  "version": 1,
  "releve": "2026-10-16T17:49:26Z",
  "ovation": {
    "observation": "2026-10-16T17:39:00Z",
    "prevision": "2026-10-16T18:40:00Z",
    "origine": { "lat": 56, "lon": -50 },
    "pas": 1,
    "largeur": 61,
    "hauteur": 25,
    "valeurs": [0, 0, 3, "… 1 525 entiers de 0 à 100"]
  },
  "kp": { "heure": "2026-10-16T17:46:00Z", "estime": 2.67 },
  "kpPrevu": { "debut": "2026-10-16T15:00:00Z", "kp": 3, "nature": "estimated" },
  "bz": { "moyenne": -5.2, "mesures": 15, "de": "2026-10-16T17:29:00Z", "a": "2026-10-16T17:43:00Z", "source": "SOLAR1" },
  "pannes": {}
}
```

| Clé | Contenu | Source NOAA |
|---|---|---|
| `releve` | Heure UTC du relevé. | |
| `ovation.observation`, `ovation.prevision` | Champs « Observation Time » et « Forecast Time » du fichier : la grille vaut pour cette fenêtre. | `json/ovation_aurora_latest.json` |
| `ovation.valeurs` | La grille découpée de 56 à 80° N et de 50° O à 10° E, au degré. Rangées du sud au nord, d'ouest en est dans chaque rangée : la case (lat, lon) est à l'indice `(lat − 56) × 61 + (lon + 50)`, longitude négative à l'ouest. `null` si la case manquait. | idem |
| `kp` | Dernière ligne du Kp à la minute : `estimated_kp` (au tiers près) et son heure. | `json/planetary_k_index_1m.json` |
| `kpPrevu` | Créneau de 3 h de la prévision qui contient l'heure du relevé : son début, son Kp, et `nature` (`observed`, `estimated` ou `predicted`). | `products/noaa-planetary-k-index-forecast.json` |
| `bz` | Moyenne du Bz (GSM, en nT) des mesures de la source `active`, sur les 15 minutes qui finissent à la dernière mesure (`a`). Un écart entre `a` et `releve` signale un flux figé. | `json/rtsw/rtsw_mag_1m.json` |
| `pannes` | Flux en échec et raison, `{}` si tout a répondu. | |

Exemple de lecture, Node, valeur OVATION au-dessus de Reykjavík (64° N, 22° O)
pour chaque relevé d'une journée :

```js
import { readFileSync } from "node:fs";
const lignes = readFileSync("donnees/2026-10-16.ndjson", "utf8").trim().split("\n").map(JSON.parse);
const indice = (lat, lon) => (lat - 56) * 61 + (lon + 50);
for (const l of lignes) console.log(l.releve, l.ovation?.valeurs[indice(64, -22)], l.kpPrevu?.kp);
```

## Modifier le script

On modifie toujours dans le dépôt du site, on teste, puis on recopie dans le
dépôt public. Depuis la racine du dépôt du site (ou de son worktree) :

```bash
npx vitest run __tests__/aurora/journal.test.ts
git clone https://github.com/Thibaroudeur/journal-aurores ../journal-aurores
cp scripts/journal-aurores/releve.mjs ../journal-aurores/releve.mjs
cp scripts/journal-aurores/releve.yml ../journal-aurores/.github/workflows/releve.yml
cp scripts/journal-aurores/README.md ../journal-aurores/README.md
git -C ../journal-aurores add -A
git -C ../journal-aurores commit -m "<ce qui change>"
git -C ../journal-aurores pull --rebase
git -C ../journal-aurores push
```

Si une clé change de sens, augmenter `VERSION` dans `releve.mjs` : les lignes
déjà écrites gardent leur ancien numéro, l'analyse saura les distinguer.
