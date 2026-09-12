/**
 * Recherche internet de l'assistant : Wikipédia en français.
 *
 * C'est la seule chose de Projekt qui sort de la machine. L'utilisateur l'a
 * voulue (« si possible pouvoir utiliser les recherches internet ») en sachant
 * que Projekt est « 100 % local » : elle s'active d'un clic dans le panneau de
 * l'assistant (coupée par défaut), et quand elle est coupée, le modèle ne sait
 * même pas que l'outil existe. Seule la REQUÊTE part (quelques mots choisis par le modèle),
 * jamais le contenu des pages.
 *
 * Pourquoi Wikipédia : API publique, gratuite, sans compte ni clé, stable — et
 * taillée pour l'inspiration narrative qu'il cherche (mythologies, folklore,
 * histoire, bestiaires, références de jeux).
 */

export interface ResultatWeb {
  titre: string;
  extrait: string;
  url: string;
}

export interface SourceRecherche {
  /** Nom affiché à l'utilisateur, ex. « Wikipédia ». */
  nom: string;
  chercher: (requete: string, signal?: AbortSignal) => Promise<ResultatWeb[]>;
}

/** Pas de connexion : l'assistant le dit, et répond avec ce qu'il a. */
export class HorsLigneErreur extends Error {
  constructor() {
    super("Mince ! Vous êtes hors ligne !");
    this.name = "HorsLigneErreur";
  }
}

const API = "https://fr.wikipedia.org/w/api.php";
const DELAI_MAX_MS = 10_000;
const NB_RESULTATS = 3;
// Juste l'introduction de chaque article : c'est là que tient l'essentiel, et
// le contexte du modèle (4 096 jetons) est déjà bien rempli par le projet.
const LONGUEUR_EXTRAIT = 700;

export const WIKIPEDIA: SourceRecherche = {
  nom: "Wikipédia",
  async chercher(requete, signal) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new HorsLigneErreur();

    const resultats = await interroger(requete, signal);
    // Wikipédia exige TOUS les mots : un seul mot de trop ou mal orthographié et
    // rien ne sort (mesuré : « roguelite differenciation roguelike » → 0 article).
    // Seconde chance avec n'importe lequel des mots, les plus pertinents en tête.
    const mots = requete.split(/\s+/).filter((m) => m.length > 2);
    if (resultats.length === 0 && mots.length > 1) return interroger(mots.join(" OR "), signal);
    return resultats;
  },
};

async function interroger(requete: string, signal?: AbortSignal): Promise<ResultatWeb[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*", // CORS anonyme : sans ce paramètre, la webview est refusée
    generator: "search",
    gsrsearch: requete,
    gsrlimit: String(NB_RESULTATS + 2), // de la marge pour écarter les pages d'homonymie
    prop: "extracts|info|pageprops",
    exintro: "1",
    explaintext: "1",
    exchars: String(LONGUEUR_EXTRAIT),
    inprop: "url",
    ppprop: "disambiguation",
    redirects: "1",
  });

  // Un réseau qui ne répond pas ne doit pas figer l'assistant indéfiniment.
  const minuterie = new AbortController();
  const delai = window.setTimeout(() => minuterie.abort(), DELAI_MAX_MS);
  const arreter = () => minuterie.abort();
  signal?.addEventListener("abort", arreter);

  let reponse: Response;
  try {
    reponse = await fetch(`${API}?${params}`, { signal: minuterie.signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    // `fetch` ne dit pas POURQUOI il échoue : pas de réseau, DNS, pare-feu…
    // Pour l'utilisateur, c'est la même chose — internet n'est pas joignable.
    throw new HorsLigneErreur();
  } finally {
    window.clearTimeout(delai);
    signal?.removeEventListener("abort", arreter);
  }
  if (!reponse.ok) throw new Error(`Wikipédia a répondu ${reponse.status}.`);

  const json = (await reponse.json()) as {
    query?: {
      pages?: { index: number; title: string; extract?: string; fullurl: string; pageprops?: { disambiguation?: string } }[];
    };
  };
  return (json.query?.pages ?? [])
    .filter((p) => !p.pageprops || !("disambiguation" in p.pageprops))
    .sort((a, b) => a.index - b.index)
    .slice(0, NB_RESULTATS)
    .map((p) => ({ titre: p.title, extrait: (p.extract ?? "").trim(), url: p.fullurl }));
}

/* --------------------------------------------------------------------------
 * Interrupteur (panneau de l'assistant)
 * ------------------------------------------------------------------------ */

const CLE = "projekt.rechercheWeb";
const auditeurs = new Set<() => void>();

/**
 * COUPÉE par défaut (son choix du 11/09, une fois la fonction faite) : Projekt
 * reste 100 % local tant qu'il ne l'active pas. Le choix est retenu d'une
 * session à l'autre.
 */
export function rechercheWebActivee(): boolean {
  try {
    return localStorage.getItem(CLE) === "oui";
  } catch {
    return false;
  }
}

export function activerRechercheWeb(oui: boolean) {
  try {
    localStorage.setItem(CLE, oui ? "oui" : "non");
  } catch {
    /* stockage indisponible : le choix vaut pour cette session seulement */
  }
  auditeurs.forEach((f) => f());
}

export function suivreRechercheWeb(f: () => void): () => void {
  auditeurs.add(f);
  return () => {
    auditeurs.delete(f);
  };
}

/** Source active, ou `null` : la recherche internet est coupée. */
export function rechercheWeb(): SourceRecherche | null {
  return rechercheWebActivee() ? WIKIPEDIA : null;
}
