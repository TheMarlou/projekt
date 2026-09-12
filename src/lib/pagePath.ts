import { useBlocksStore, type Block } from "../store/blocksStore";
import { useProjectsStore } from "../store/projectsStore";

export const PATH_SEPARATOR = ">";

export type PathResolution =
  | { status: "ok"; pageId: string; projectId: string }
  | { status: "not_found"; message: string }
  | { status: "ambiguous"; message: string; candidates: string[] };

function normalize(segment: string): string {
  return segment.trim().toLowerCase();
}

export function splitPath(path: string): string[] {
  return path
    .split(PATH_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Chemin lisible d'une page, projet inclus : "Projet > Parent > Page". */
export function pageToPath(pageId: string): string {
  const blocks = useBlocksStore.getState().blocks;
  const projects = useProjectsStore.getState().projects;

  const page = blocks.find((b) => b.id === pageId);
  if (!page) return "";

  const segments: string[] = [];
  let current: Block | undefined = page;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    segments.unshift(current.title || "Sans titre");
    current = current.parentId ? blocks.find((b) => b.id === current!.parentId) : undefined;
  }

  const project = projects.find((p) => p.id === page.projectId);
  if (project) segments.unshift(project.name || "Sans titre");
  return segments.join(` ${PATH_SEPARATOR} `);
}

/** Descend une suite de titres à l'intérieur d'un projet donné. */
function walkSegments(projectId: string, pageSegments: string[]): PathResolution {
  const blocks = useBlocksStore.getState().blocks;
  let parentId: string | null = null;
  let pageId = "";

  for (const segment of pageSegments) {
    const matches = blocks.filter(
      (b) => b.projectId === projectId && b.parentId === parentId && normalize(b.title) === normalize(segment)
    );

    if (matches.length === 0) {
      const freres = blocks
        .filter((b) => b.projectId === projectId && b.parentId === parentId)
        .map((b) => b.title || "Sans titre")
        .join(", ");
      return {
        status: "not_found",
        message: `Page « ${segment} » introuvable à cet endroit. Pages disponibles ici : ${freres || "aucune"}.`,
      };
    }
    if (matches.length > 1) {
      return {
        status: "ambiguous",
        message: `Plusieurs pages s'appellent « ${segment} » au même niveau. Précise le chemin complet.`,
        candidates: matches.map((b) => pageToPath(b.id)),
      };
    }

    pageId = matches[0].id;
    parentId = pageId;
  }

  return { status: "ok", pageId, projectId };
}

/** Cherche une page par son seul titre dans tout un projet, quel que soit son niveau. */
function findByTitleInProject(projectId: string, title: string): PathResolution | null {
  const matches = useBlocksStore
    .getState()
    .blocks.filter((b) => b.projectId === projectId && normalize(b.title) === normalize(title));

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      message: `Plusieurs pages s'appellent « ${title} » dans ce projet. Donne le chemin complet.`,
      candidates: matches.map((b) => pageToPath(b.id)),
    };
  }
  return { status: "ok", pageId: matches[0].id, projectId };
}

export interface ResolveOptions {
  /** Projet de repli quand le modèle omet le préfixe projet dans le chemin. */
  fallbackProjectId?: string | null;
}

/**
 * Résout "Projet > Parent > Page" en identifiants réels. Le modèle ne manipule
 * jamais d'UUID : il décrit un chemin, et c'est ici qu'on retrouve la page.
 *
 * Tolérant par conception : un modèle 8B oublie régulièrement le préfixe projet
 * (« Boss Design » au lieu de « Mon jeu > Boss Design »). On tente donc aussi
 * d'interpréter le chemin comme relatif à un projet connu, plutôt que d'échouer.
 */
export function resolvePagePath(path: string, options: ResolveOptions = {}): PathResolution {
  const segments = splitPath(path);
  if (segments.length === 0) return { status: "not_found", message: "Chemin vide." };

  const projects = useProjectsStore.getState().projects;

  // On cherche le segment qui nomme un projet, pas forcément le premier : le modèle
  // ajoute parfois un préfixe littéral (« Projet > Mon jeu > … ») en recopiant le
  // format de la documentation.
  const projectIndex = segments.findIndex((seg) =>
    projects.some((p) => normalize(p.name) === normalize(seg))
  );

  if (projectIndex !== -1) {
    const nom = segments[projectIndex];
    const homonymes = projects.filter((p) => normalize(p.name) === normalize(nom));
    if (homonymes.length > 1) {
      return {
        status: "ambiguous",
        message: `Plusieurs projets s'appellent « ${nom} ». Précise lequel.`,
        candidates: homonymes.map((p) => p.name),
      };
    }

    const rest = segments.slice(projectIndex + 1);
    if (rest.length === 0) {
      return {
        status: "not_found",
        message: `« ${nom} » est un projet, pas une page. Ajoute un titre de page au chemin.`,
      };
    }

    const strict = walkSegments(homonymes[0].id, rest);
    if (strict.status === "ok") return strict;

    // Chemin incomplet (« Mon jeu > Mécaniques » alors que la page est sous
    // « Boss Design ») : on cherche le titre partout dans le projet. Un seul
    // homonyme suffit à lever le doute ; sinon on demande de préciser.
    const parTitre = findByTitleInProject(homonymes[0].id, rest[rest.length - 1]);
    if (parTitre) return parTitre;
    return strict;
  }

  // Repli : chemin relatif à un projet déduit du contexte, ou au projet unique.
  const fallbackId =
    options.fallbackProjectId ?? (projects.length === 1 ? projects[0].id : null);
  if (fallbackId) {
    const relative = walkSegments(fallbackId, segments);
    if (relative.status === "ok") return relative;
  }

  const connus = projects.map((p) => p.name).join(", ") || "aucun";
  return {
    status: "not_found",
    message: `Chemin « ${path} » introuvable. Projets existants : ${connus}. Utilise read_tree pour voir les chemins valides.`,
  };
}

/** Arborescence à plat (chemins uniquement) — sert au modèle pour se repérer sans lire le contenu. */
/** Retrouve le projet nommé dans une chaîne libre (« Projet > Mon jeu » -> Mon jeu). */
export function findProjectByName(raw: string): { id: string; name: string } | null {
  const projects = useProjectsStore.getState().projects;
  for (const seg of splitPath(raw)) {
    const found = projects.find((p) => normalize(p.name) === normalize(seg));
    if (found) return { id: found.id, name: found.name };
  }
  return null;
}

/**
 * Chemins de toutes les pages, dans l'ORDRE DE L'ARBRE — parents avant enfants,
 * sœurs dans l'ordre choisi par l'utilisateur. Un tri alphabétique séparait une
 * page de ses sous-pages dès qu'un titre commençait par une autre lettre.
 * Le projet courant passe en premier : c'est presque toujours de lui qu'on parle.
 */
export function readTreePaths(projetCourant: string | null = null): string[] {
  const blocks = useBlocksStore.getState().blocks;
  const projets = [...useProjectsStore.getState().projects].sort(
    (a, b) => Number(b.id === projetCourant) - Number(a.id === projetCourant) || a.position - b.position
  );

  const chemins: string[] = [];
  const parcourir = (projectId: string, parentId: string | null) => {
    for (const page of blocks
      .filter((b) => b.projectId === projectId && b.parentId === parentId)
      .sort((a, b) => a.position - b.position)) {
      chemins.push(pageToPath(page.id));
      parcourir(projectId, page.id);
    }
  };
  for (const projet of projets) parcourir(projet.id, null);
  return chemins.filter((p) => p.length > 0);
}
