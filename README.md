# Journal de calibration des aurores

> **Journal arrêté ici le 17 octobre 2026.** Le planning de GitHub n'a lancé
> que 4 relevés sur 27 la première nuit : GitHub ne garantit pas ses tâches
> planifiées. Le journal continue ailleurs, toutes les 30 minutes, avec le même
> script et le même format. Le workflow « Relevé » est désactivé.

Ce dépôt a relevé l'activité aurorale au-dessus de l'Islande du 16 octobre
2026, 17 h 51 UTC, au 17 octobre 2026, 7 h 39 UTC : 7 relevés, dans
`donnees/AAAA-MM-JJ.ndjson`, une ligne JSON par relevé. Le but : caler le
modèle « Prévu » de [/outils/aurores](https://thibaroudeur.com/outils/aurores)
(Kp prévu posé sur l'ovale de Starkov) sur le modèle « En direct » de la NOAA
(OVATION).

`releve.mjs` est le script qui faisait les relevés (Node 18 ou plus, aucune
dépendance) : `node releve.mjs donnees`.

## Format d'une ligne (version 1)

| Clé | Contenu | Source NOAA |
|---|---|---|
| `releve` | Heure UTC du relevé. | |
| `ovation.observation`, `ovation.prevision` | Champs « Observation Time » et « Forecast Time » du fichier : la grille vaut pour cette fenêtre. | `json/ovation_aurora_latest.json` |
| `ovation.valeurs` | La grille découpée de 56 à 80° N et de 50° O à 10° E, au degré. Rangées du sud au nord, d'ouest en est dans chaque rangée : la case (lat, lon) est à l'indice `(lat − 56) × 61 + (lon + 50)`, longitude négative à l'ouest. `null` si la case manquait. | idem |
| `kp` | Dernière ligne du Kp à la minute : `estimated_kp` (au tiers près) et son heure. | `json/planetary_k_index_1m.json` |
| `kpPrevu` | Créneau de 3 h de la prévision qui contient l'heure du relevé : son début, son Kp, et `nature` (`observed`, `estimated` ou `predicted`). | `products/noaa-planetary-k-index-forecast.json` |
| `bz` | Moyenne du Bz (GSM, en nT) des mesures de la source `active`, sur les 15 minutes qui finissent à la dernière mesure (`a`). | `json/rtsw/rtsw_mag_1m.json` |
| `pannes` | Flux en échec et raison, `{}` si tout a répondu. | |
