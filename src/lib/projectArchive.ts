import type { JSONContent } from "@tiptap/react";
import { useBlocksStore, type Block, type ContentBlock } from "../store/blocksStore";
import { fichiersElement, useCanvasStore, type MetaElement } from "../store/canvasStore";
import { useCarteStore } from "../store/carteStore";
import { useProjectsStore } from "../store/projectsStore";
import { docToMarkdown, type MarkdownContext } from "./markdown";
import { parPosition } from "./reorder";

/**
 * Assemblage d'une archive de projet.
 *
 * Une archive contient DEUX lectures des mêmes données :
 * — `projekt.json`, fidèle et réimportable, la vraie sauvegarde ;
 * — un dossier `pages/` en Markdown, lisible sans Projekt, pour partager.
 *
 * Les images sont copiées dans `assets/` et les chemins disque sont réécrits en
 * noms d'archive : une sauvegarde qui référence « C:\\Users\\... » ne serait
 * restaurable que sur la machine qui l'a produite.
 */

export const ARCHIVE_JSON = "projekt.json";
export const ARCHIVE_FORMAT = "projekt-export";
export const ARCHIVE_VERSION = 1;

export interface ArchivePage {
  id: string;
  parentId: string | null;
  title: string;
  content: ContentBlock[];
  createdAt: number;
  updatedAt: number;
}

export interface ArchiveCanvasItem {
  asset: string;
  x: number;
  y: number;
  width: number;
  height: number;
  crop: unknown;
  /** Facultatifs (v7) : absents = image, comme dans les sauvegardes d'avant. */
  genre?: "image" | "video" | "tiktok";
  /** Méta de l'élément ; pour une vidéo, `apercu` est un nom de fichier de l'archive. */
  meta?: MetaElement | null;
}

/**
 * Carte mentale (v6) : bulles placées à la main et liens de la carte. Champ
 * FACULTATIF, sans changer la version du format : une sauvegarde d'avant se
 * relit telle quelle, et une copie plus ancienne de Projekt l'ignore.
 */
export interface ArchiveCarte {
  decalages: { page: string; dx: number; dy: number }[];
  liens: { de: string; vers: string; type: "humain" | "ia" | "ia_rejete"; couleur: string | null; etiquette: string; raison: string }[];
}

export interface ArchivePayload {
  format: string;
  version: number;
  exportedAt: number;
  project: { name: string };
  pages: ArchivePage[];
  canvas: ArchiveCanvasItem[];
  carte: ArchiveCarte;
}

/** Ce que l'archiveur remet à la couche Rust, qui n'a plus qu'à écrire le zip. */
export interface ArchiveBundle {
  /** Nom de fichier suggéré, sans dossier. */
  fileName: string;
  /** Fichiers texte à écrire, chemin d'archive → contenu. */
  files: { path: string; contents: string }[];
  /** Images à copier, chemin disque → chemin d'archive. */
  assets: { diskPath: string; path: string }[];
}

const SEPARATEURS = /[\\/]/;

/** Dernier segment d'un chemin, quel que soit le séparateur. */
export function baseName(chemin: string): string {
  const morceaux = chemin.split(SEPARATEURS);
  return morceaux[morceaux.length - 1] || chemin;
}

/** Nom de fichier sûr sur Windows, sans accent ni caractère interdit. */
export function slug(texte: string): string {
  const sans = texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sans || "sans-titre";
}

/**
 * Nœuds dont l'attribut `src` désigne un fichier du dossier d'assets. Tout type
 * ajouté ici part dans la sauvegarde et revient à l'import ; en oublier un
 * produirait une sauvegarde qui perd ses fichiers en silence.
 */
export const NOEUDS_A_FICHIER = new Set(["image", "audioClip"]);

/** Parcourt un document et remet chaque nœud porteur d'un fichier à l'appelant. */
export function pourChaqueAsset(doc: JSONContent | undefined, visiter: (noeud: JSONContent) => void) {
  if (!doc) return;
  if (doc.type && NOEUDS_A_FICHIER.has(doc.type)) visiter(doc);
  doc.content?.forEach((n) => pourChaqueAsset(n, visiter));
}

/** Vrai si le fichier est contenu dans le document lui-même, sans fichier sur disque. */
export function estIntegre(src: string): boolean {
  return src.startsWith("data:");
}

/** Copie profonde d'un document en réécrivant le chemin des fichiers. */
function reecrireAssets(doc: JSONContent, traduire: (src: string) => string): JSONContent {
  const copie = JSON.parse(JSON.stringify(doc)) as JSONContent;
  pourChaqueAsset(copie, (noeud) => {
    const src = typeof noeud.attrs?.src === "string" ? noeud.attrs.src : "";
    if (src && noeud.attrs) noeud.attrs.src = traduire(src);
  });
  return copie;
}

/** Pages d'un projet, parents avant enfants, dans l'ordre d'affichage. */
function ordonner(pages: Block[], parentId: string | null = null): Block[] {
  return pages
    .filter((p) => p.parentId === parentId)
    .sort(parPosition)
    .flatMap((p) => [p, ...ordonner(pages, p.id)]);
}

/**
 * Construit l'archive d'un projet. Renvoie `null` si le projet n'existe pas —
 * l'appelant le signale plutôt que d'écrire un fichier vide.
 */
export function buildArchive(projectId: string): ArchiveBundle | null {
  const projet = useProjectsStore.getState().projects.find((p) => p.id === projectId);
  if (!projet) return null;

  const pages = ordonner(useBlocksStore.getState().blocks.filter((b) => b.projectId === projectId));
  const items = useCanvasStore.getState().items.filter((i) => i.projectId === projectId);

  // --- Images : chemin disque -> nom dans l'archive -------------------------
  // Les fichiers d'assets sont déjà nommés par l'empreinte de leur contenu, donc
  // deux images identiques partagent un nom et ne sont copiées qu'une fois.
  const assets = new Map<string, string>();
  const enregistrerAsset = (diskPath: string): string => {
    const existant = assets.get(diskPath);
    if (existant) return existant;
    const nom = `assets/${baseName(diskPath)}`;
    assets.set(diskPath, nom);
    return nom;
  };

  for (const page of pages) {
    for (const bloc of page.content) {
      pourChaqueAsset(bloc.doc, (noeud) => {
        const src = typeof noeud.attrs?.src === "string" ? noeud.attrs.src : "";
        // Un data-URI est déjà DANS le document (image insérée quand l'écriture
        // disque avait échoué) : il voyage avec le JSON, il n'y a rien à copier.
        // Le traiter comme un fichier le ferait annoncer « introuvable » à tort.
        if (src && !estIntegre(src)) enregistrerAsset(src);
      });
    }
  }
  for (const item of items) {
    // L'image, la vidéo ou la miniature TikTok, et l'aperçu d'une vidéo.
    fichiersElement(item).forEach(enregistrerAsset);
  }

  // --- Sauvegarde fidèle ----------------------------------------------------
  const payload: ArchivePayload = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: Date.now(),
    project: { name: projet.name },
    pages: pages.map((page) => ({
      id: page.id,
      parentId: page.parentId,
      title: page.title,
      content: page.content.map((bloc) => ({
        ...bloc,
        doc: reecrireAssets(bloc.doc, (src) => assets.get(src) ?? src),
      })),
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    })),
    canvas: items.map((item) => ({
      asset: assets.get(item.assetPath) ?? baseName(item.assetPath),
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      crop: item.crop,
      genre: item.genre,
      meta: item.meta
        ? { ...item.meta, apercu: item.meta.apercu ? assets.get(item.meta.apercu) ?? baseName(item.meta.apercu) : undefined }
        : null,
    })),
    carte: carteDuProjet(projectId, new Set(pages.map((p) => p.id))),
  };

  // --- Lecture partageable --------------------------------------------------
  const fichiersPages = new Map<string, string>();
  const compteNoms = new Map<string, number>();
  for (const page of pages) {
    // Deux pages peuvent porter le même titre : on suffixe plutôt que d'écraser.
    const base = slug(page.title || "Sans titre");
    const vus = compteNoms.get(base) ?? 0;
    compteNoms.set(base, vus + 1);
    fichiersPages.set(page.id, `pages/${base}${vus ? `-${vus + 1}` : ""}.md`);
  }

  // Les titres se lisent sur TOUTES les pages, pas seulement celles exportées :
  // une mention vers un autre projet existe bel et bien, elle est simplement
  // hors de l'archive. L'annoncer « supprimée » serait faux.
  const titres = new Map(useBlocksStore.getState().blocks.map((p) => [p.id, p.title || "Sans titre"]));
  const contexte: MarkdownContext = {
    // Les liens Markdown sont relatifs au fichier qui les contient : deux pages
    // voisines dans `pages/` se citent par leur seul nom de fichier.
    pageFile: (id) => {
      const chemin = fichiersPages.get(id);
      return chemin ? baseName(chemin) : null;
    },
    pageTitle: (id) => titres.get(id) ?? null,
    assetFile: (src) => {
      if (estIntegre(src)) return src;
      const nom = assets.get(src);
      return nom ? `../${nom}` : null;
    },
  };

  const files: ArchiveBundle["files"] = [{ path: ARCHIVE_JSON, contents: JSON.stringify(payload, null, 2) }];

  for (const page of pages) {
    const corps = page.content
      .map((bloc) => docToMarkdown(bloc.doc, contexte))
      .filter((m) => m !== "")
      .join("\n\n");
    files.push({
      path: fichiersPages.get(page.id)!,
      contents: `# ${page.title || "Sans titre"}\n\n${corps}\n`,
    });
  }

  files.push({ path: "SOMMAIRE.md", contents: sommaire(projet.name, pages, fichiersPages) });

  return {
    fileName: `${slug(projet.name)}.projekt.zip`,
    files,
    assets: [...assets.entries()].map(([diskPath, path]) => ({ diskPath, path })),
  };
}

/** La carte d'un projet, limitée à ses pages (un lien vers une page disparue ne voyage pas). */
function carteDuProjet(projectId: string, pagesDuProjet: Set<string>): ArchiveCarte {
  const { decalages, liens } = useCarteStore.getState();
  return {
    decalages: Object.entries(decalages)
      .filter(([page, d]) => d.projectId === projectId && pagesDuProjet.has(page))
      .map(([page, d]) => ({ page, dx: d.dx, dy: d.dy })),
    liens: liens
      .filter((l) => l.projectId === projectId && pagesDuProjet.has(l.de) && pagesDuProjet.has(l.vers))
      .map(({ de, vers, type, couleur, etiquette, raison }) => ({ de, vers, type, couleur, etiquette, raison })),
  };
}

/** Relit la carte d'une sauvegarde ; ce qui est mal formé est ignoré, pas fatal. */
function lireCarte(brut: unknown): ArchiveCarte {
  const c = (brut ?? {}) as Partial<ArchiveCarte>;
  const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const texte = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    decalages: (Array.isArray(c.decalages) ? c.decalages : [])
      .filter((d) => typeof d?.page === "string")
      .map((d) => ({ page: d.page, dx: nombre(d.dx), dy: nombre(d.dy) })),
    liens: (Array.isArray(c.liens) ? c.liens : [])
      .filter((l) => typeof l?.de === "string" && typeof l?.vers === "string" && ["humain", "ia", "ia_rejete"].includes(l?.type))
      .map((l) => ({
        de: l.de,
        vers: l.vers,
        type: l.type,
        couleur: typeof l.couleur === "string" ? l.couleur : null,
        etiquette: texte(l.etiquette),
        raison: texte(l.raison),
      })),
  };
}

/** Table des matières : c'est elle qui rend l'arborescence lisible hors de l'app. */
function sommaire(nomProjet: string, pages: Block[], fichiers: Map<string, string>): string {
  const lignes: string[] = [`# ${nomProjet}`, ""];

  const parcourir = (parentId: string | null, profondeur: number) => {
    for (const page of pages.filter((p) => p.parentId === parentId).sort(parPosition)) {
      const marge = "  ".repeat(profondeur);
      lignes.push(`${marge}- [${page.title || "Sans titre"}](${fichiers.get(page.id)})`);
      parcourir(page.id, profondeur + 1);
    }
  };
  parcourir(null, 0);

  if (lignes.length === 2) lignes.push("_Ce projet ne contient aucune page._");
  lignes.push(
    "",
    "---",
    "",
    "_Export Projekt. Les fichiers Markdown de ce dossier servent à lire et partager :",
    "la mise en forme fine (polices, tailles, placement des images, rognage) n'y figure pas._",
    "_Pour restaurer le projet dans Projekt, importer `projekt.json`, pas ces fichiers._"
  );
  return lignes.join("\n");
}

/**
 * Relit une sauvegarde. Lève une erreur explicite plutôt que de laisser un
 * fichier étranger produire un projet à moitié construit.
 */
export function parseArchive(brut: string): ArchivePayload {
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return refuser("Ce fichier n'est pas un JSON valide.");
  }

  const p = donnees as Partial<ArchivePayload>;
  if (!p || typeof p !== "object") return refuser("Contenu illisible.");
  if (p.format !== ARCHIVE_FORMAT) {
    return refuser("Ce fichier n'est pas une sauvegarde Projekt.");
  }
  if (typeof p.version !== "number" || p.version > ARCHIVE_VERSION) {
    return refuser(
      `Sauvegarde en version ${String(p.version)}, plus récente que cette copie de Projekt (${ARCHIVE_VERSION}).`
    );
  }
  if (!Array.isArray(p.pages)) return refuser("La sauvegarde ne contient aucune page.");

  return {
    format: ARCHIVE_FORMAT,
    version: p.version,
    exportedAt: typeof p.exportedAt === "number" ? p.exportedAt : Date.now(),
    project: { name: p.project?.name?.trim() || "Projet importé" },
    pages: p.pages,
    canvas: Array.isArray(p.canvas) ? p.canvas : [],
    carte: lireCarte(p.carte),
  };
}

function refuser(message: string): never {
  throw new Error(message);
}

/** Nom libre pour un projet importé : on n'écrase jamais un projet existant. */
export function nomDisponible(souhaite: string): string {
  const pris = new Set(useProjectsStore.getState().projects.map((p) => p.name));
  if (!pris.has(souhaite)) return souhaite;
  const base = `${souhaite} (importé)`;
  if (!pris.has(base)) return base;
  for (let i = 2; ; i++) {
    const essai = `${souhaite} (importé ${i})`;
    if (!pris.has(essai)) return essai;
  }
}
