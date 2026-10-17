#!/usr/bin/env node
/**
 * Journal de calibration des aurores : un relevé toutes les 30 minutes.
 *
 * /outils/aurores montre deux modèles qui ne disent pas la même chose :
 * « En direct », la grille OVATION de la NOAA, et « Prévu », le Kp prévu posé
 * sur l'ovale de Starkov. Pour caler le second sur le premier (spec
 * docs/superpowers/specs/2026-10-16-aurores-refonte-design.md, section 9), il
 * faut les voir côte à côte pendant des semaines. Ce script prend une photo de
 * l'activité au-dessus de l'Islande : OVATION découpée, Kp à la minute,
 * créneau en cours de la prévision Kp, Bz moyen sur 15 minutes.
 *
 * Il vit à trois endroits :
 * - ici, dans le dépôt du site, où il est testé (__tests__/aurora/journal.test.ts) ;
 * - en copie dans supabase/functions/journal-aurores/, l'Edge Function que
 *   pg_cron appelle à h07 et h37 et qui range chaque relevé dans la table
 *   journal_aurores. Le test vérifie que la copie est identique ;
 * - dans le dépôt public Thibaroudeur/journal-aurores, où une GitHub Action a
 *   tenu le journal du 16 au 17 octobre 2026, avant que son planning trop
 *   irrégulier ne soit remplacé par Supabase.
 * Mode d'emploi : scripts/journal-aurores/README.md.
 *
 * Un relevé = une ligne JSON ajoutée à <dossier>/AAAA-MM-JJ.ndjson (date UTC).
 * Un flux en panne n'empêche pas d'écrire les autres : sa clé vaut null et la
 * raison est notée dans `pannes`. Ainsi un trou dans les données se voit et se
 * date, au lieu d'être une ligne absente.
 *
 * Aucune dépendance : Node 18 ou plus (fetch intégré).
 *
 *   node releve.mjs [dossier]      dossier par défaut : ./donnees
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCES = {
  ovation: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
  kpMinute: "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
  kpPrevision: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
  vent: "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
};

/** Version du format d'une ligne : à augmenter si une clé change de sens. */
export const VERSION = 1;

/**
 * Rectangle gardé, celui de la spec (5.5) : il couvre la portée de 1 120 km
 * depuis chacune des 24 villes, Groenland compris vers l'ouest. Longitudes
 * négatives à l'ouest (OVATION les numérote de 0 à 359 vers l'est).
 */
export const RECTANGLE = { latMin: 56, latMax: 80, lonMin: -50, lonMax: 10 };
export const LARGEUR = RECTANGLE.lonMax - RECTANGLE.lonMin + 1; // 61
export const HAUTEUR = RECTANGLE.latMax - RECTANGLE.latMin + 1; // 25

export const FENETRE_BZ_MS = 15 * 60_000;
export const CRENEAU_MS = 3 * 3_600_000;

/**
 * Instant UTC d'un horodatage NOAA. Plusieurs flux l'écrivent sans fuseau
 * (« 2026-10-16T17:17:00 ») alors qu'il est en UTC : sans le « Z » ajouté,
 * Date.parse le lirait dans le fuseau de la machine.
 */
export function instantUtc(horodatage) {
  if (typeof horodatage !== "string") return NaN;
  const avecFuseau = /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(horodatage) ? horodatage : `${horodatage}Z`;
  return Date.parse(avecFuseau);
}

/** ISO 8601 en UTC, à la seconde. */
function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isoOuNull(horodatage) {
  const ms = instantUtc(horodatage);
  return Number.isFinite(ms) ? iso(ms) : null;
}

/** `parseFloat` et non `Number` : Number(null) vaut 0, et une valeur absente se lirait comme un ciel calme. */
function nombreOuNull(valeur) {
  const n = parseFloat(String(valeur));
  return Number.isFinite(n) ? n : null;
}

/**
 * Découpe la grille OVATION (360 × 181 cases au degré) sur le rectangle.
 *
 * Tableau plat, rangée par rangée du sud au nord, et dans chaque rangée
 * d'ouest en est : la case (lat, lon) est à l'indice
 * (lat − 56) × 61 + (lon + 50). Une case absente du fichier vaut null, pour
 * ne pas décaler les suivantes.
 */
export function decouperOvation(json) {
  const coordonnees = json?.coordinates;
  if (!Array.isArray(coordonnees)) throw new Error("pas de tableau « coordinates »");

  const { latMin, latMax, lonMin, lonMax } = RECTANGLE;
  const valeurs = new Array(LARGEUR * HAUTEUR).fill(null);
  let trouvees = 0;
  for (const point of coordonnees) {
    if (!Array.isArray(point)) continue;
    const [lon360, lat, intensite] = point;
    if (!Number.isInteger(lon360) || !Number.isInteger(lat) || !Number.isFinite(intensite)) continue;
    const lon = lon360 >= 180 ? lon360 - 360 : lon360;
    if (lat < latMin || lat > latMax || lon < lonMin || lon > lonMax) continue;
    const indice = (lat - latMin) * LARGEUR + (lon - lonMin);
    if (valeurs[indice] === null) trouvees += 1;
    valeurs[indice] = intensite;
  }
  if (trouvees === 0) throw new Error("aucune case dans le rectangle");

  return {
    observation: isoOuNull(json["Observation Time"]),
    prevision: isoOuNull(json["Forecast Time"]),
    origine: { lat: latMin, lon: lonMin },
    pas: 1,
    largeur: LARGEUR,
    hauteur: HAUTEUR,
    valeurs,
  };
}

/**
 * Dernière mesure du Kp à la minute. `estimated_kp` (au tiers près) et non
 * `kp_index` (entier arrondi) : même choix que lib/aurora/kpIndex.ts.
 */
export function lireKpMinute(json) {
  if (!Array.isArray(json) || json.length === 0) throw new Error("flux vide");
  const derniere = json[json.length - 1];
  return { heure: isoOuNull(derniere?.time_tag), estime: nombreOuNull(derniere?.estimated_kp) };
}

/**
 * Créneau de 3 h de la prévision Kp qui contient `maintenant`. `nature` dit ce
 * que la NOAA en sait : « observed », « estimated » ou « predicted ».
 */
export function lireCreneauEnCours(json, maintenant) {
  if (!Array.isArray(json)) throw new Error("pas un tableau");
  const t = maintenant.getTime();
  for (const ligne of json) {
    const debut = instantUtc(ligne?.time_tag);
    if (!Number.isFinite(debut)) continue;
    if (debut <= t && t < debut + CRENEAU_MS) {
      return { debut: iso(debut), kp: nombreOuNull(ligne.kp), nature: ligne.observed ?? null };
    }
  }
  throw new Error(`aucun créneau ne couvre ${iso(t)}`);
}

/**
 * Moyenne du Bz (repère GSM, celui qui compte pour les aurores : négatif, il
 * ouvre la magnétosphère) sur les 15 minutes qui finissent à la dernière
 * mesure. Le flux mêle plusieurs satellites et une seule source est `active`
 * à chaque minute : ce sont celles-là qu'on garde, comme
 * app/api/aurora/route.ts. `a` dit de quand date la mesure : un flux figé se
 * repère à l'écart entre `a` et l'heure du relevé.
 */
export function moyenneBz(json) {
  if (!Array.isArray(json)) throw new Error("pas un tableau");

  const parMinute = new Map();
  for (const ligne of json) {
    if (ligne?.active !== true || !Number.isFinite(ligne.bz_gsm)) continue;
    const t = instantUtc(ligne.time_tag);
    if (Number.isFinite(t) && !parMinute.has(t)) parMinute.set(t, ligne);
  }
  if (parMinute.size === 0) throw new Error("aucune mesure active");

  let fin = -Infinity;
  for (const t of parMinute.keys()) if (t > fin) fin = t;

  let somme = 0;
  let mesures = 0;
  let debut = fin;
  const sources = new Set();
  for (const [t, ligne] of parMinute) {
    if (t <= fin - FENETRE_BZ_MS) continue;
    somme += ligne.bz_gsm;
    mesures += 1;
    if (t < debut) debut = t;
    if (ligne.source) sources.add(ligne.source);
  }

  return {
    moyenne: Math.round((somme / mesures) * 100) / 100,
    mesures,
    de: iso(debut),
    a: iso(fin),
    source: [...sources].join("+") || null,
  };
}

/**
 * Assemble une ligne du journal. Chaque flux arrive déjà lu, ou sous forme
 * d'Error si le téléchargement a échoué.
 */
export function construireReleve({ maintenant, ovation, kpMinute, kpPrevision, vent }) {
  const pannes = {};
  const lire = (cle, entree, lecteur) => {
    if (entree instanceof Error) {
      pannes[cle] = entree.message;
      return null;
    }
    try {
      return lecteur(entree);
    } catch (erreur) {
      pannes[cle] = erreur instanceof Error ? erreur.message : String(erreur);
      return null;
    }
  };

  return {
    version: VERSION,
    releve: iso(maintenant.getTime()),
    ovation: lire("ovation", ovation, decouperOvation),
    kp: lire("kpMinute", kpMinute, lireKpMinute),
    kpPrevu: lire("kpPrevision", kpPrevision, (json) => lireCreneauEnCours(json, maintenant)),
    bz: lire("vent", vent, moyenneBz),
    pannes,
  };
}

async function telecharger(url) {
  const reponse = await fetch(url, {
    headers: { "User-Agent": "journal-aurores (thibaroudeur.com)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
  return reponse.json();
}

/**
 * Télécharge les quatre flux en parallèle et assemble le relevé. `lire` est
 * remplaçable pour les tests.
 */
export async function relever(maintenant = new Date(), lire = telecharger) {
  const cles = Object.keys(SOURCES);
  const reponses = await Promise.all(
    cles.map((cle) =>
      lire(SOURCES[cle]).catch((erreur) => (erreur instanceof Error ? erreur : new Error(String(erreur))))
    )
  );
  const flux = Object.fromEntries(cles.map((cle, i) => [cle, reponses[i]]));
  return construireReleve({ maintenant, ...flux });
}

async function principal() {
  const dossier = resolve(process.argv[2] ?? "donnees");
  const releve = await relever();
  mkdirSync(dossier, { recursive: true });
  const fichier = join(dossier, `${releve.releve.slice(0, 10)}.ndjson`);
  appendFileSync(fichier, `${JSON.stringify(releve)}\n`);

  const enPanne = Object.entries(releve.pannes).map(([cle, raison]) => `${cle} (${raison})`);
  console.log(
    `${releve.releve} : relevé ajouté à ${fichier}` +
      (enPanne.length > 0 ? `, en panne : ${enPanne.join(", ")}` : "")
  );
}

// Lancé en ligne de commande seulement. Importé par l'Edge Function Supabase
// (supabase/functions/journal-aurores), où `process` peut ne pas exister.
const ligneDeCommande = typeof process !== "undefined" ? process.argv?.[1] : undefined;
if (ligneDeCommande && import.meta.url === pathToFileURL(resolve(ligneDeCommande)).href) {
  principal().catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  });
}
