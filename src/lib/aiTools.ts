import { z } from "zod";
import type { JSONContent } from "@tiptap/react";
import { useProjectsStore } from "../store/projectsStore";
import { readTables } from "./docTables";
import { useBlocksStore, getBlockText } from "../store/blocksStore";
import { docToMarkdown } from "./markdown";
import { markdownToDoc } from "./markdownToDoc";
import { findProjectByName, pageToPath, readTreePaths, resolvePagePath, splitPath } from "./pagePath";
import { HorsLigneErreur, rechercheWeb, type ResultatWeb } from "./rechercheWeb";
import { tr } from "./i18n";
import { reglagesIa } from "./iaReglages";
import { ajouterALaMemoire, RUBRIQUES, titreMemoire, titreRubrique, type Rubrique } from "./memoireProjet";

/**
 * Outils de l'assistant.
 *
 * Deux familles, et c'est toute l'architecture :
 * — les outils de LECTURE (arborescence, page, recherche) s'exécutent tout de
 *   suite : ils ne changent rien ;
 * — les outils d'ÉCRITURE ne touchent à rien. Ils vérifient leurs arguments et
 *   ajoutent une action à un PLAN que l'utilisateur voit, puis applique ou
 *   rejette. C'est son choix explicite : « elle propose, je valide ».
 *
 * Le modèle peut quand même enchaîner (« crée la page Phase 2 puis écris-y un
 * tableau ») : une page créée plus tôt dans le plan est reconnue comme cible,
 * et les actions sont rejouées dans l'ordre au moment de l'application.
 *
 * Le modèle ne manipule jamais d'identifiant : il désigne les pages par leur
 * chemin (« Projet > Parent > Page »). Toute la fiabilité tient ici — validation
 * stricte des arguments, résolution du chemin en identifiant réel.
 */

/** Page où se rangent les notes de discussion (choix du 13/09). Même nom dans les deux langues. */
export const TITRE_DISCUSSIONS = "💬 Discussions";

const pathSchema = z.string().min(1, "chemin requis");

// Projet courant de l'utilisateur : sert de repli quand le modèle omet le préfixe
// projet dans un chemin. Renseigné par le panneau IA avant chaque tour.
let contextProjectId: string | null = null;

export function setAiContextProject(projectId: string | null) {
  contextProjectId = projectId;
}

function resolve(path: string) {
  return resolvePagePath(path, { fallbackProjectId: contextProjectId });
}

/* --------------------------------------------------------------------------
 * Plan d'actions proposées
 * ------------------------------------------------------------------------ */

export interface ActionProposee {
  /** Ce que l'action fera, en une phrase. */
  resume: string;
  /** Contenu ajouté, en Markdown, pour que l'utilisateur voie ce qu'il valide. */
  apercu?: string;
  /** Exécute l'action pour de vrai. Renvoie un message d'erreur, ou `null` si tout va bien. */
  appliquer: () => string | null;
}

export class Plan {
  actions: ActionProposee[] = [];
  /** Pages que le plan créera, par chemin normalisé → chemin affiché. */
  pagesEnAttente = new Map<string, string>();
  /** Un plan ne s'applique qu'une fois, même sur un double-clic. */
  applique = false;
}

function normaliserChemin(chemin: string): string {
  return chemin
    .split(">")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .join(" > ");
}

type Cible = { ok: true; chemin: string; enAttente: boolean } | { ok: false; message: string };

/** Page visée par une écriture : une page réelle, ou une page que le plan va créer. */
function cible(chemin: string, plan: Plan): Cible {
  const r = resolve(chemin);
  if (r.status === "ok") return { ok: true, chemin: pageToPath(r.pageId), enAttente: false };

  const cle = normaliserChemin(chemin);
  for (const [attente, affiche] of plan.pagesEnAttente) {
    // Le modèle omet souvent le nom du projet : on accepte la fin du chemin.
    if (attente === cle || attente.endsWith(` > ${cle}`)) return { ok: true, chemin: affiche, enAttente: true };
  }
  return { ok: false, message: r.message };
}

/** Applique toutes les actions dans l'ordre et rend compte de chacune. */
export function appliquerPlan(plan: Plan): { reussies: number; erreurs: string[] } {
  if (plan.applique) return { reussies: 0, erreurs: [tr("Cette proposition a déjà été appliquée.", "This proposal has already been applied.")] };
  plan.applique = true;
  const erreurs: string[] = [];
  let reussies = 0;
  for (const action of plan.actions) {
    try {
      const erreur = action.appliquer();
      if (erreur) erreurs.push(`${action.resume} — ${erreur}`);
      else reussies++;
    } catch (err) {
      erreurs.push(`${action.resume} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { reussies, erreurs };
}

/* --------------------------------------------------------------------------
 * Validation des arguments
 * ------------------------------------------------------------------------ */

/**
 * Un modèle 8B envoie régulièrement `rows` sous une forme approximative : chaîne
 * JSON au lieu d'un tableau, guillemets simples, ou une seule ligne à plat.
 * On rattrape ces formes avant validation — la fiabilité tient au code, pas au modèle.
 */
function coerceRows(value: unknown): unknown {
  let v = value;

  if (typeof v === "string") {
    const texte = v.trim();
    try {
      v = JSON.parse(texte);
    } catch {
      // Guillemets simples : fréquent, et invalide en JSON.
      try {
        v = JSON.parse(texte.replace(/'/g, '"'));
      } catch {
        return value;
      }
    }
  }

  if (!Array.isArray(v)) return value;
  // Une seule ligne fournie à plat : ["A","B"] -> [["A","B"]]
  if (v.every((cell) => typeof cell === "string" || typeof cell === "number")) {
    return [v.map(String)];
  }
  return v.map((row) => (Array.isArray(row) ? row.map(String) : [String(row)]));
}

const nonEmptyRowsSchema = z.preprocess(coerceRows, z.array(z.array(z.string())).min(1, "au moins une ligne"));

const schemas = {
  read_tree: z.object({}).loose(),
  read_page: z.object({ path: pathSchema }),
  search_pages: z.object({ query: z.string().min(1, "requête requise") }),
  create_page: z.object({
    parent_path: z.string().nullish(),
    title: z.string().min(1, "titre requis"),
    project: z.string().nullish(),
  }),
  add_content: z.object({
    page_path: pathSchema,
    markdown: z.string().min(1, "contenu requis"),
  }),
  add_table_rows: z.object({
    page_path: pathSchema,
    table_index: z.number().int().positive().nullish(),
    rows: nonEmptyRowsSchema,
  }),
  web_search: z.object({ query: z.string().min(1, "requête requise") }),
  memoriser: z.object({
    rubrique: z.enum(RUBRIQUES as [Rubrique, ...Rubrique[]]),
    texte: z.string().min(1, "texte requis").max(400, "une phrase courte suffit"),
  }),
  note_discussion: z.object({
    titre: z.string().min(1, "titre requis").max(80, "titre trop long"),
    markdown: z.string().min(1, "contenu requis"),
  }),
} as const;

export type ToolName = keyof typeof schemas;

/** Outils qui modifient le projet : ils passent tous par un plan à valider. */
// Écritures : elles ne font que PROPOSER (plan à valider), et seulement si les réglages le permettent.
export const OUTILS_ECRITURE = new Set<string>(["create_page", "add_content", "add_table_rows", "memoriser", "note_discussion"]);
export const OUTILS_LECTURE = new Set<string>(["read_tree", "read_page", "search_pages"]);

const DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "read_tree",
      description: "Liste les pages existantes sous forme de chemins (« Mon jeu > Boss Design > Mécaniques »), sans leur contenu.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_page",
      description: "Lit le contenu complet d'une page (texte, listes, tableaux) à partir de son chemin.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Chemin exact de la page, tel que renvoyé par read_tree ou search_pages" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_pages",
      description:
        "Cherche un mot ou une idée dans toutes les pages du projet. Renvoie les pages qui en parlent, avec des extraits. Pour les détails, lis ensuite la page avec read_page.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Mots-clés à chercher, ex. « faiblesse boss »" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_page",
      description:
        "Propose de créer une page. Pour une sous-page, donner parent_path. Pour une page racine, donner project et laisser parent_path vide.",
      parameters: {
        type: "object",
        properties: {
          parent_path: { type: "string", description: "Chemin de la page parente, ou vide pour une page racine" },
          project: { type: "string", description: "Nom du projet, si parent_path est vide" },
          title: { type: "string", description: "Titre de la nouvelle page" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_content",
      description:
        "Propose d'ajouter du contenu à la fin d'une page. Écris en Markdown : titres ##, listes -, **gras**, tableaux | a | b |.",
      parameters: {
        type: "object",
        properties: {
          page_path: { type: "string", description: "Chemin de la page" },
          markdown: { type: "string", description: "Contenu à ajouter, en Markdown" },
        },
        required: ["page_path", "markdown"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_table_rows",
      description: "Propose d'ajouter des lignes à un tableau existant d'une page. table_index = 1 pour le premier tableau.",
      parameters: {
        type: "object",
        properties: {
          page_path: { type: "string", description: "Chemin de la page" },
          table_index: { type: "number", description: "Position du tableau dans la page (1 = le premier)" },
          rows: { type: "array", description: "Lignes à ajouter", items: { type: "array", items: { type: "string" } } },
        },
        required: ["page_path", "rows"],
      },
    },
  },
];

const DEFINITION_RECHERCHE_WEB = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Cherche dans Wikipédia (en français) des informations sur le monde réel : mythologies, folklore, histoire, sciences, œuvres et jeux existants, vocabulaire. Jamais pour le contenu du projet : pour lui, utilise search_pages.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Deux à quatre mots-clés, pas une phrase" } },
      required: ["query"],
    },
  },
};

/**
 * Outils proposés au modèle. La recherche internet n'y figure QUE si une source
 * est activée : elle touche à la contrainte « 100 % local », c'est à
 * l'utilisateur d'en décider (voir `rechercheWeb.ts`).
 */
const DEFINITIONS_MEMOIRE_ET_NOTE = [
  {
    type: "function",
    function: {
      name: "memoriser",
      description:
        "Propose d'ajouter une information à la page « 🧠 Mémoire » du projet, que tu relis à chaque conversation. À utiliser quand l'utilisateur te demande de retenir quelque chose. rubrique : resume (ce qu'est le projet), decision (un choix arrêté), preference (un goût ou une façon de travailler de l'utilisateur), idee_ecartee (une idée refusée, à ne plus proposer). Un appel par information.",
      parameters: {
        type: "object",
        properties: {
          rubrique: { type: "string", enum: RUBRIQUES, description: "resume, decision, preference ou idee_ecartee" },
          texte: { type: "string", description: "Une phrase courte et factuelle, telle que l'utilisateur l'a dite" },
        },
        required: ["rubrique", "texte"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "note_discussion",
      description:
        "Propose de créer une note qui résume la discussion, rangée dans la page « 💬 Discussions » du projet. N'y mets que ce qui a vraiment été dit : idées retenues, décisions, questions encore ouvertes.",
      parameters: {
        type: "object",
        properties: {
          titre: { type: "string", description: "Titre court (moins de 8 mots)" },
          markdown: { type: "string", description: "Le résumé en Markdown : ## titres, listes -" },
        },
        required: ["titre", "markdown"],
      },
    },
  },
];

/**
 * Outils proposés au modèle, filtrés par les réglages de l'assistant : un outil
 * interdit n'est même pas montré. (Et s'il l'appelait quand même, `executeTool`
 * refuserait : la permission est vérifiée des deux côtés.)
 */
export function outilsDisponibles() {
  const r = reglagesIa();
  const tous = [...DEFINITIONS, ...DEFINITIONS_MEMOIRE_ET_NOTE, ...(rechercheWeb() ? [DEFINITION_RECHERCHE_WEB] : [])];
  return tous.filter((d) => {
    const nom = d.function.name;
    if (OUTILS_LECTURE.has(nom)) return r.lirePages;
    if (OUTILS_ECRITURE.has(nom)) return r.proposerModifications;
    return true;
  });
}

export function describeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "read_tree":
      return tr("Lecture de l'arborescence…", "Reading the page tree…");
    case "read_page":
      return tr(`Lecture de « ${args.path} »…`, `Reading “${args.path}”…`);
    case "search_pages":
      return tr(`Recherche de « ${args.query} » dans le projet…`, `Searching the project for “${args.query}”…`);
    case "create_page":
      return tr(`Proposition : page « ${args.title} »`, `Proposal: page “${args.title}”`);
    case "add_content":
      return tr(`Proposition : contenu pour « ${args.page_path} »`, `Proposal: content for “${args.page_path}”`);
    case "add_table_rows":
      return tr(
        `Proposition : ${Array.isArray(args.rows) ? args.rows.length : 0} ligne(s) de tableau`,
        `Proposal: ${Array.isArray(args.rows) ? args.rows.length : 0} table row(s)`
      );
    case "web_search":
      return tr(`Recherche Wikipédia : « ${args.query} »…`, `Wikipedia search: “${args.query}”…`);
    default:
      return tr(`Exécution de « ${name} »…`, `Running “${name}”…`);
  }
}

export interface ToolOutcome {
  /** false = le modèle doit corriger son appel (erreur de validation ou chemin non résolu). */
  ok: boolean;
  payload: string;
  /** Recherche internet : articles consultés, à montrer comme sources sous la réponse. */
  sources?: ResultatWeb[];
  /** Recherche internet impossible faute de connexion. */
  horsLigne?: boolean;
}

function fail(message: string): ToolOutcome {
  return { ok: false, payload: JSON.stringify({ ok: false, error: message }) };
}

function succeed(data: Record<string, unknown>): ToolOutcome {
  return { ok: true, payload: JSON.stringify({ ok: true, ...data }) };
}

/**
 * Réponse d'un outil d'écriture. La formulation compte, mesurée au banc d'essai :
 * « l'utilisateur doit valider avant… » faisait CROIRE au modèle qu'il devait
 * attendre, et il s'arrêtait après la première étape (la page créée, jamais
 * remplie). Dire qu'il peut continuer règle ça.
 */
function propose(data: Record<string, unknown>): ToolOutcome {
  return succeed({
    statut:
      "ajouté au plan de modifications, PAS encore appliqué — continue si la demande comporte d'autres étapes ; l'utilisateur validera l'ensemble à la fin",
    ...data,
  });
}

/* --------------------------------------------------------------------------
 * Recherche dans le projet
 * ------------------------------------------------------------------------ */

function sansAccent(texte: string): string {
  return texte.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Mots trop courants pour départager deux pages.
const MOTS_VIDES = new Set(
  "le la les un une des de du d l et ou a au aux en dans sur pour par avec sans ce cette ces mon ma mes ton ta tes son sa ses qui que quoi est sont".split(" ")
);

export interface ResultatRecherche {
  chemin: string;
  extrait: string;
  score: number;
}

/**
 * Recherche plein texte, insensible aux accents. Le titre pèse plus lourd que le
 * corps : une page « Boss » répond mieux à « boss » qu'une page qui le cite.
 */
export function chercherDansPages(requete: string, projectId: string | null): ResultatRecherche[] {
  const mots = sansAccent(requete)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((m) => m.length > 1 && !MOTS_VIDES.has(m));
  if (mots.length === 0) return [];

  const pages = useBlocksStore.getState().blocks.filter((b) => !projectId || b.projectId === projectId);
  const resultats: ResultatRecherche[] = [];

  for (const page of pages) {
    const titre = sansAccent(page.title ?? "");
    const brut = getBlockText(page);
    const corps = sansAccent(brut);
    let score = 0;
    for (const mot of mots) {
      if (titre.includes(mot)) score += 3;
      const n = corps.split(mot).length - 1;
      if (n > 0) score += 1 + Math.min(n - 1, 3) * 0.25;
    }
    if (score === 0) continue;

    resultats.push({ chemin: pageToPath(page.id), extrait: meilleursExtraits(brut, corps, mots), score });
  }

  return resultats.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * Le projet d'un coup d'œil : chaque page (ordre de l'arbre) avec le début de
 * son texte. Joint à chaque demande du panneau — sans lui, « propose un
 * personnage » ignorait l'univers du jeu (recette du 11/09). Plafonné : qwen3:8b
 * déborde déjà de la carte graphique, chaque caractère de contexte se paie.
 */
export function apercuProjet(projectId: string | null, exclureId: string | null, max = 1400): string | null {
  if (!projectId) return null;
  const blocks = useBlocksStore.getState().blocks;
  const lignes: string[] = [];
  let taille = 0;
  let omises = 0;

  const parcourir = (parentId: string | null) => {
    for (const page of blocks
      .filter((b) => b.projectId === projectId && b.parentId === parentId)
      .sort((a, b) => a.position - b.position)) {
      if (page.id !== exclureId) {
        const debut = aplatir(getBlockText(page)).slice(0, 110);
        const ligne = `« ${pageToPath(page.id)} »${debut ? ` : ${debut}${debut.length === 110 ? "…" : ""}` : " (vide)"}`;
        if (taille + ligne.length > max) omises++;
        else {
          lignes.push(ligne);
          taille += ligne.length;
        }
      }
      parcourir(page.id);
    }
  };
  parcourir(null);

  if (lignes.length === 0) return null;
  if (omises) lignes.push(`… et ${omises} autre${omises > 1 ? "s" : ""} page${omises > 1 ? "s" : ""} (search_pages pour les trouver).`);
  return lignes.join("\n");
}

const AVANT = 70;
const APRES = 150;

/**
 * Extraits là où les mots cherchés se REGROUPENT, et non autour de la première
 * occurrence : sur « faiblesse boss », la première occurrence de « boss » est
 * souvent le titre, et l'extrait ratait la phrase qui répondait. Un modèle qui
 * ne voit pas la réponse la devine — c'est ce qui s'est produit en test.
 *
 * `corps` est `brut` sans accents : la normalisation ne change pas la longueur
 * des lettres usuelles, donc les positions de l'un valent pour l'autre.
 */
function meilleursExtraits(brut: string, corps: string, mots: string[]): string {
  const positions: number[] = [];
  for (const mot of mots) {
    let pos = corps.indexOf(mot);
    for (let k = 0; pos >= 0 && k < 4; k++) {
      positions.push(pos);
      pos = corps.indexOf(mot, pos + mot.length);
    }
  }
  if (positions.length === 0) return aplatir(brut.slice(0, APRES));

  // Chaque fenêtre vaut le nombre de mots DIFFÉRENTS qu'elle contient.
  const fenetres = positions.map((p) => {
    const debut = Math.max(0, p - AVANT);
    const fin = Math.min(corps.length, p + APRES);
    const zone = corps.slice(debut, fin);
    return { debut, fin, valeur: mots.filter((m) => zone.includes(m)).length };
  });
  fenetres.sort((a, b) => b.valeur - a.valeur || a.debut - b.debut);

  const retenues = [fenetres[0]];
  const seconde = fenetres.find((f) => f.fin < fenetres[0].debut || f.debut > fenetres[0].fin);
  if (seconde) retenues.push(seconde);

  return retenues
    .sort((a, b) => a.debut - b.debut)
    .map((f) => `${f.debut > 0 ? "…" : ""}${aplatir(brut.slice(f.debut, f.fin))}${f.fin < brut.length ? "…" : ""}`)
    .join(" ");
}

/**
 * Met un extrait sur une ligne en GARDANT la frontière entre les lignes. Les
 * fondre en espaces faisait de « - Kaela, pilote / - Doc Varn, ingénieur » la
 * phrase « Kaela, pilote Doc Varn, ingénieur » — et le modèle en a déduit que
 * Kaela commandait un vaisseau nommé Doc Varn.
 */
function aplatir(texte: string): string {
  return texte
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
}

/* --------------------------------------------------------------------------
 * Exécution
 * ------------------------------------------------------------------------ */

export async function executeTool(
  name: string,
  rawArgs: Record<string, unknown>,
  plan: Plan,
  signal?: AbortSignal
): Promise<ToolOutcome> {
  const schema = schemas[name as ToolName];
  if (!schema) return fail(`Outil inconnu : « ${name} ». Outils disponibles : ${Object.keys(schemas).join(", ")}.`);

  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".") || "(racine)"} : ${i.message}`).join(" ; ");
    return fail(`Arguments invalides pour « ${name} » — ${details}`);
  }
  const args = parsed.data as Record<string, unknown>;

  // Permissions (demande du 13/09) : vérifiées ICI, quoi que le modèle ait appelé.
  const permissions = reglagesIa();
  if (OUTILS_ECRITURE.has(name) && !permissions.proposerModifications) {
    return fail("Les modifications sont désactivées dans les réglages de l'assistant : explique-le à l'utilisateur, sans rien proposer.");
  }
  if (OUTILS_LECTURE.has(name) && !permissions.lirePages) {
    return fail("La lecture des pages est désactivée dans les réglages de l'assistant : dis à l'utilisateur que tu ne peux pas lire ses pages.");
  }

  try {
    switch (name) {
      case "read_tree": {
        const projets = useProjectsStore.getState().projects.map((p) => p.name);
        return succeed({ projets, pages: readTreePaths(contextProjectId) });
      }

      case "read_page": {
        const resolved = resolve(String(args.path));
        if (resolved.status !== "ok") return fail(resolved.message);
        const page = useBlocksStore.getState().blocks.find((b) => b.id === resolved.pageId)!;
        // Le Markdown garde la structure (titres, listes, tableaux) que le texte
        // brut écrasait : le modèle comprend mieux une page qu'il voit organisée.
        const contenu = page.content
          .map((c) =>
            docToMarkdown(c.doc, {
              pageFile: () => null,
              pageTitle: (id) => useBlocksStore.getState().blocks.find((b) => b.id === id)?.title ?? null,
              assetFile: () => null,
            })
          )
          .filter(Boolean)
          .join("\n\n");
        return succeed({
          path: pageToPath(page.id),
          contenu: contenu || "(page vide)",
          nombre_de_tableaux: page.content.flatMap((c) => readTables(c.doc)).length,
        });
      }

      case "search_pages": {
        const resultats = chercherDansPages(String(args.query), contextProjectId);
        if (resultats.length === 0) {
          return succeed({ resultats: [], note: "Aucune page ne mentionne ces mots. Essaie d'autres mots-clés, ou read_tree." });
        }
        return succeed({ resultats: resultats.map(({ chemin, extrait }) => ({ chemin, extrait })) });
      }

      case "web_search": {
        const source = rechercheWeb();
        if (!source) return fail("La recherche internet est désactivée dans Projekt.");
        try {
          const resultats = await source.chercher(String(args.query), signal);
          if (resultats.length === 0) {
            return succeed({ resultats: [], note: `Aucun article ${source.nom} trouvé. Essaie d'autres mots-clés, plus simples.` });
          }
          return { ...succeed({ source: source.nom, resultats }), sources: resultats };
        } catch (err) {
          if (!(err instanceof HorsLigneErreur)) throw err;
          // Un succès, pas un échec : le modèle ne doit pas réessayer en boucle,
          // mais répondre avec ce qu'il a — et dire que la recherche n'a pas pu se faire.
          return {
            ...succeed({
              resultats: [],
              note: "Pas de connexion internet : la recherche est impossible. Réponds sans elle, avec les pages du projet et tes connaissances, et précise que tu n'as pas pu vérifier sur internet.",
            }),
            horsLigne: true,
          };
        }
      }

      case "create_page": {
        const titre = String(args.title).trim();
        let parentPath = typeof args.parent_path === "string" && args.parent_path.trim() ? args.parent_path : null;
        let projetDemande = typeof args.project === "string" ? args.project : "";

        // Recette du 11/09 : le modèle a donné le NOM DU PROJET comme parent, deux
        // fois de suite, et l'appel échouait (« c'est un projet, pas une page »).
        // Un parent qui n'est qu'un nom de projet veut dire : page racine de ce projet.
        if (parentPath && splitPath(parentPath).length === 1 && findProjectByName(parentPath)) {
          projetDemande = parentPath;
          parentPath = null;
        }

        if (parentPath) {
          const parent = cible(parentPath, plan);
          if (!parent.ok) return fail(parent.message);
          const chemin = `${parent.chemin} > ${titre}`;
          plan.pagesEnAttente.set(normaliserChemin(chemin), chemin);
          plan.actions.push({
            resume: tr(`Créer la sous-page « ${titre} » dans « ${parent.chemin} »`, `Create the sub-page “${titre}” in “${parent.chemin}”`),
            appliquer: () => {
              const r = resolve(parent.chemin);
              if (r.status !== "ok") return r.message;
              const store = useBlocksStore.getState();
              const id = store.addBlock(r.projectId, r.pageId);
              store.updateTitle(id, titre);
              // Une sous-page vit dans le document de son parent, comme dans
              // Notion : on y dépose sa puce pour qu'elle soit visible et cliquable.
              store.appendNodesToPage(r.pageId, [{ type: "paragraph", content: [{ type: "pageLink", attrs: { pageId: id } }] }]);
              return null;
            },
          });
          return propose({ path: chemin });
        }

        // Page racine : le projet vient du champ `project`, sinon du projet courant.
        const nom = projetDemande;
        const projet =
          (nom ? findProjectByName(nom) : null) ??
          useProjectsStore.getState().projects.find((p) => p.id === contextProjectId) ??
          null;
        if (!projet) {
          const connus = useProjectsStore.getState().projects.map((p) => p.name).join(", ") || "aucun";
          return fail(
            nom ? `Projet « ${nom} » introuvable. Projets existants : ${connus}.` : `Indique le projet dans « project ». Projets existants : ${connus}.`
          );
        }
        const chemin = `${projet.name} > ${titre}`;
        plan.pagesEnAttente.set(normaliserChemin(chemin), chemin);
        plan.actions.push({
          resume: tr(`Créer la page « ${titre} » dans le projet « ${projet.name} »`, `Create the page “${titre}” in the project “${projet.name}”`),
          appliquer: () => {
            const store = useBlocksStore.getState();
            const id = store.addBlock(projet.id, null);
            store.updateTitle(id, titre);
            return null;
          },
        });
        return propose({ path: chemin });
      }

      case "add_content": {
        const page = cible(String(args.page_path), plan);
        if (!page.ok) return fail(page.message);
        const markdown = String(args.markdown).trim();
        const noeuds: JSONContent[] = markdownToDoc(markdown).content ?? [];
        if (noeuds.length === 0) return fail("Le contenu est vide.");

        plan.actions.push({
          resume: tr(`Ajouter du contenu à « ${page.chemin} »`, `Add content to “${page.chemin}”`),
          apercu: markdown,
          appliquer: () => {
            const r = resolve(page.chemin);
            if (r.status !== "ok") return r.message;
            return useBlocksStore.getState().appendNodesToPage(r.pageId, noeuds) ? null : tr("la page a disparu entre-temps", "the page has disappeared in the meantime");
          },
        });
        return propose({ path: page.chemin });
      }

      case "add_table_rows": {
        const page = cible(String(args.page_path), plan);
        if (!page.ok) return fail(page.message);
        const rows = args.rows as string[][];
        const index = typeof args.table_index === "number" ? args.table_index : 1;

        // Une page réelle doit avoir ce tableau ; une page à créer n'en a encore aucun.
        if (!page.enAttente) {
          const r = resolve(page.chemin);
          if (r.status !== "ok") return fail(r.message);
          const existante = useBlocksStore.getState().blocks.find((b) => b.id === r.pageId)!;
          const nb = existante.content.reduce((t, c) => t + readTables(c.doc).length, 0);
          if (nb === 0) return fail(`« ${page.chemin} » ne contient aucun tableau. Utilise add_content avec un tableau Markdown.`);
          if (index < 1 || index > nb) return fail(`Cette page n'a que ${nb} tableau(x) ; index ${index} inexistant.`);
        } else {
          return fail("Cette page n'existe pas encore : mets directement le tableau complet dans add_content.");
        }

        plan.actions.push({
          resume: tr(
            `Ajouter ${rows.length} ligne(s) au tableau ${index} de « ${page.chemin} »`,
            `Add ${rows.length} row(s) to table ${index} of “${page.chemin}”`
          ),
          apercu: rows.map((r) => `| ${r.join(" | ")} |`).join("\n"),
          appliquer: () => {
            const r = resolve(page.chemin);
            if (r.status !== "ok") return r.message;
            return useBlocksStore.getState().appendRowsToPageTable(r.pageId, index - 1, rows)
              ? null
              : tr("le tableau n'existe plus", "the table no longer exists");
          },
        });
        return propose({ path: page.chemin, lignes: rows.length });
      }

      case "memoriser": {
        const projet = contextProjectId;
        if (!projet) return fail("Aucun projet ouvert : la mémoire appartient à un projet.");
        const rubrique = args.rubrique as Rubrique;
        const texte = String(args.texte).trim();
        plan.actions.push({
          resume: tr(
            `Retenir dans « ${titreMemoire()} » (${titreRubrique(rubrique)}) : ${texte}`,
            `Remember in “${titreMemoire()}” (${titreRubrique(rubrique)}): ${texte}`
          ),
          apercu: `- ${texte}`,
          appliquer: () => ajouterALaMemoire(projet, rubrique, texte),
        });
        return propose({ rubrique, texte });
      }

      case "note_discussion": {
        const projet = contextProjectId;
        if (!projet) return fail("Aucun projet ouvert : la note se range dans un projet.");
        const markdown = String(args.markdown).trim();
        const noeuds: JSONContent[] = markdownToDoc(markdown).content ?? [];
        if (noeuds.length === 0) return fail("Le contenu de la note est vide.");
        const d = new Date();
        const n = (x: number) => String(x).padStart(2, "0");
        const titreNote = `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())} — ${String(args.titre).trim()}`;
        plan.actions.push({
          resume: tr(`Créer la note « ${titreNote} » dans « ${TITRE_DISCUSSIONS} »`, `Create the note “${titreNote}” in “${TITRE_DISCUSSIONS}”`),
          apercu: markdown,
          appliquer: () => {
            const store = useBlocksStore.getState();
            let parent = store.blocks.find((b) => b.projectId === projet && !b.parentId && b.title.trim() === TITRE_DISCUSSIONS)?.id;
            if (!parent) {
              parent = store.addBlock(projet, null);
              store.updateTitle(parent, TITRE_DISCUSSIONS);
            }
            const id = useBlocksStore.getState().addBlock(projet, parent);
            useBlocksStore.getState().updateTitle(id, titreNote);
            // La puce de la note dans « 💬 Discussions », comme pour toute sous-page.
            useBlocksStore.getState().appendNodesToPage(parent, [{ type: "paragraph", content: [{ type: "pageLink", attrs: { pageId: id } }] }]);
            return useBlocksStore.getState().appendNodesToPage(id, noeuds) ? null : tr("la note n'a pas pu être remplie", "the note couldn't be filled");
          },
        });
        return propose({ titre: titreNote });
      }

      default:
        return fail(`Outil non implémenté : ${name}`);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
