import { getVersion } from "@tauri-apps/api/app";

/**
 * Statistiques d'usage anonymes (demande du 17/09 : « pour pouvoir améliorer
 * l'app, désactivé de base mais activable par le client »).
 *
 * Règles, à ne jamais assouplir sans en parler à Marlou :
 * — DÉSACTIVÉES par défaut ; rien ne part tant que la personne n'a pas coché ;
 * — jamais de contenu : ni texte de page, ni titre, ni nom de projet, ni image,
 *   ni message à l'assistant — seulement des noms d'événements choisis ici et
 *   des nombres ou des valeurs courtes et prévisibles ;
 * — aucun identifiant de personne : un numéro de session tiré au hasard à chaque
 *   lancement, oublié à la fermeture.
 *
 * Service : Aptabase (anonyme, hébergé en Europe), gratuit jusqu'à 20 000
 * événements par mois — d'où la retenue : une fonction n'est comptée qu'une fois
 * par session.
 */

/** Clé de l'app Aptabase (publique par nature). Vide = statistiques indisponibles, réglage masqué. */
export const CLE_APTABASE: string = "A-EU-4219356275";

const CLE_REGLAGE = "projekt-statistiques";
const API = "https://eu.aptabase.com/api/v0/event";
const ERREURS_MAX_PAR_SESSION = 5;

export type Valeur = string | number | boolean;

export interface EvenementEnvoye {
  quand: number;
  nom: string;
  props: Record<string, Valeur>;
}

const session = `${Math.floor(Date.now() / 1000)}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const dejaComptees = new Set<string>();
const envoyes: EvenementEnvoye[] = [];
const auditeurs = new Set<() => void>();
let version: Promise<string> | null = null;
let erreursEnvoyees = 0;

export function statistiquesDisponibles(): boolean {
  return CLE_APTABASE !== "";
}

export function statistiquesActivees(): boolean {
  if (!statistiquesDisponibles()) return false;
  try {
    return localStorage.getItem(CLE_REGLAGE) === "1";
  } catch {
    return false;
  }
}

export function activerStatistiques(oui: boolean) {
  try {
    localStorage.setItem(CLE_REGLAGE, oui ? "1" : "0");
  } catch {
    /* stockage indisponible : le réglage ne tiendra pas, rien ne sera envoyé au prochain lancement */
  }
  auditeurs.forEach((a) => a());
  if (oui) mesurer("statistiques_activees");
}

export function suivreStatistiques(auditeur: () => void): () => void {
  auditeurs.add(auditeur);
  return () => auditeurs.delete(auditeur);
}

/** Ce qui est parti pendant cette session, pour « Voir ce qui est envoyé ». */
export function evenementsEnvoyes(): EvenementEnvoye[] {
  return [...envoyes];
}

function systeme() {
  const windows = navigator.userAgent.match(/Windows NT ([\d.]+)/)?.[1];
  return { osName: windows ? "Windows" : "Autre", osVersion: windows ?? "" };
}

/** Une valeur courte et sans contenu : les textes sont coupés, les nombres arrondis. */
function propre(props: Record<string, Valeur>): Record<string, Valeur> {
  const sortie: Record<string, Valeur> = {};
  for (const [cle, valeur] of Object.entries(props)) {
    if (typeof valeur === "number") sortie[cle] = Number.isFinite(valeur) ? Math.round(valeur * 10) / 10 : 0;
    else if (typeof valeur === "boolean") sortie[cle] = valeur;
    else sortie[cle] = String(valeur).slice(0, 60);
  }
  return sortie;
}

/** Envoie un événement si la personne l'a accepté. Ne lève jamais d'erreur. */
export function mesurer(nom: string, props: Record<string, Valeur> = {}) {
  if (!statistiquesActivees()) return;
  const donnees = propre(props);
  envoyes.push({ quand: Date.now(), nom, props: donnees });
  if (envoyes.length > 50) envoyes.shift();
  auditeurs.forEach((a) => a());
  version ??= getVersion().catch(() => "");
  void version.then((appVersion) =>
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "App-Key": CLE_APTABASE },
      credentials: "omit",
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        sessionId: session,
        eventName: nom,
        systemProps: {
          locale: navigator.language,
          // Serveur de développement (tauri dev) : événements marqués « debug » dans Aptabase.
          isDebug: typeof location !== "undefined" && location.port === "1420",
          appVersion,
          sdkVersion: "projekt-maison@1",
          ...systeme(),
        },
        props: donnees,
      }),
    }).catch(() => {
      /* hors ligne : l'événement est perdu, sans gêne pour la personne */
    })
  );
}

/** Une fonction utilisée n'est comptée qu'une fois par session (on veut savoir QUI s'en sert, pas combien de clics). */
export function fonctionUtilisee(fonction: string) {
  if (dejaComptees.has(fonction)) return;
  dejaComptees.add(fonction);
  mesurer("fonction_utilisee", { fonction });
}

/** Tranche de durée en secondes, pour ne pas envoyer de valeurs trop précises. */
export function tranche(secondes: number): string {
  if (secondes < 3) return "<3 s";
  if (secondes < 10) return "3-10 s";
  if (secondes < 30) return "10-30 s";
  if (secondes < 60) return "30-60 s";
  return ">60 s";
}

/**
 * Erreurs non rattrapées : seulement le TYPE d'erreur et la première ligne de pile
 * (le nom du fichier de l'app), jamais le message, qui peut contenir un titre ou
 * un chemin de fichier.
 */
export function installerMesureErreurs() {
  const envoyer = (erreur: unknown, origine: string) => {
    if (erreursEnvoyees >= ERREURS_MAX_PAR_SESSION) return;
    erreursEnvoyees++;
    const e = erreur instanceof Error ? erreur : null;
    const lieu = e?.stack?.split("\n")[1]?.match(/\/([\w.-]+\.(?:js|ts|tsx))/)?.[1] ?? "";
    mesurer("erreur", { origine, type: e?.name ?? typeof erreur, fichier: lieu });
  };
  window.addEventListener("error", (e) => envoyer(e.error, "erreur"));
  window.addEventListener("unhandledrejection", (e) => envoyer(e.reason, "promesse"));
}

/** Ce qui peut être envoyé, pour l'expliquer à la personne avant qu'elle accepte. */
export const CE_QUI_EST_MESURE: { fr: string; en: string }[] = [
  { fr: "Les lancements : version de Projekt, version de Windows, langue.", en: "Launches: Projekt version, Windows version, language." },
  { fr: "Les fonctions utilisées (notes, moodboard, carte, recherche, export, téléphone…), une fois par session.", en: "Features used (notes, moodboard, map, search, export, phone…), once per session." },
  { fr: "L'assistant : durée de réponse (par tranche), propositions acceptées ou écartées, modèle et réglages.", en: "The assistant: answer time (in ranges), proposals accepted or dismissed, model and settings." },
  { fr: "Les erreurs de l'app : leur type seulement, jamais leur message.", en: "App errors: their type only, never their message." },
];

export const CE_QUI_NEST_JAMAIS_MESURE = {
  fr: "Jamais : le contenu ou le titre de tes pages, tes images, tes messages à l'assistant, tes noms de projets ou ton nom. Ton adresse IP n'est pas conservée par Aptabase.",
  en: "Never: the content or titles of your pages, your images, your messages to the assistant, your project names or your name. Aptabase doesn't store your IP address.",
};
