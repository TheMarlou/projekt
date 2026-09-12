import { create } from "zustand";
import type { JSONContent } from "@tiptap/react";
import { debouncedPersist, fireWrite, getDb } from "../db";
import { appendRowsToTable } from "../lib/docTables";
import { SANS_POSITION, positionSuivante, reparerPositions } from "../lib/reorder";
import { docToText, emptyDoc, textToDoc } from "../lib/richText";
import { useCarteStore } from "./carteStore";

// Un seul type de bloc depuis le retrait du tableau hérité : le tableau vit
// désormais DANS le document, seule forme qui sache être déplacée, redimensionnée
// et habillée par le texte.
export type ContentBlock = { id: string; type: "text"; doc: JSONContent };

export interface Block {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  content: ContentBlock[];
  createdAt: number;
  updatedAt: number;
  /** Ordre parmi les sœurs (même projet, même parent), choisi dans la barre latérale. */
  position: number;
}

interface PageRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  created_at: number;
  updated_at: number;
  content_json: string | null;
  position: number | null;
}

/** Clé d'un groupe de sœurs : deux pages ne s'ordonnent qu'entre elles. */
function groupe(p: { projectId: string; parentId: string | null }): string {
  return `${p.projectId}/${p.parentId ?? ""}`;
}

/** Sœurs d'une page, dans l'ordre d'affichage. */
function soeurs(blocks: Block[], ref: { projectId: string; parentId: string | null }): Block[] {
  const cle = groupe(ref);
  return blocks.filter((b) => groupe(b) === cle).sort((a, b) => a.position - b.position);
}

interface ContentRow {
  id: string;
  page_id: string;
  position: number;
  type: "text" | "table";
  text_value: string | null;
  table_json: string | null;
  doc_json: string | null;
}

interface BlocksState {
  blocks: Block[];
  hydrated: boolean;
  hydrate: () => Promise<void>;

  addBlock: (projectId: string, parentId?: string | null) => string;
  /**
   * Insère une page déjà constituée (import d'une sauvegarde), identifiant
   * compris : les puces de sous-page et de mention se référencent entre elles,
   * donc l'appelant doit maîtriser les identifiants avant d'écrire.
   */
  insertPage: (page: Omit<Block, "position">) => void;
  /**
   * Range la page sous `parentId` (null = à la racine du projet), juste avant
   * `avantId` (null = en fin de groupe). Réordonne entre sœurs OU change de
   * parent — et dans ce cas la puce de sous-page suit. Faux si le déplacement
   * créerait une boucle (une page rangée dans sa propre descendance).
   */
  movePageTo: (id: string, parentId: string | null, avantId: string | null) => boolean;
  updateTitle: (id: string, title: string) => void;
  deleteBlockCascade: (id: string) => void;
  deleteBlocksByProject: (projectId: string) => void;

  addTextBlock: (pageId: string) => void;
  /** Ajoute des lignes au n-ième tableau d'une page ; faux s'il n'existe pas. */
  appendRowsToPageTable: (pageId: string, tableIndex: number, rows: string[][]) => boolean;
  updateTextDoc: (pageId: string, contentId: string, doc: JSONContent) => void;
  /** Ajoute une image (par son chemin d'asset) à la fin d'une page. */
  appendImageToPage: (pageId: string, assetPath: string) => boolean;
  /**
   * Ajoute des nœuds de document à la fin d'une page (dernier bloc de texte).
   * Point de passage commun de tout ce qui s'ajoute « en bas de page » : image
   * venue du moodboard, tableau ou texte proposé par l'IA, puce de sous-page.
   */
  appendNodesToPage: (pageId: string, nodes: JSONContent[]) => boolean;
}

function newTextBlock(): ContentBlock {
  return { id: crypto.randomUUID(), type: "text", doc: emptyDoc() };
}

function compterTableaux(doc: JSONContent | undefined): number {
  if (!doc) return 0;
  if (doc.type === "table") return 1;
  return (doc.content ?? []).reduce((total, n) => total + compterTableaux(n), 0);
}

/**
 * Contenu d'un document sans son éventuel paragraphe vide final — celui que
 * l'éditeur laisse en bas de page. Sans ça, chaque ajout empilerait une ligne
 * blanche de plus au-dessus du nouveau contenu.
 */
function sansParagrapheVideFinal(doc: JSONContent): JSONContent[] {
  const contenu = doc.content ?? [];
  const dernier = contenu[contenu.length - 1];
  const vide = dernier?.type === "paragraph" && !(dernier.content?.length ?? 0);
  return vide ? contenu.slice(0, -1) : contenu;
}

/**
 * La page avec des nœuds ajoutés en fin de son dernier bloc de texte. Fonction
 * pure : sert à l'ajout « en bas de page » ET au déplacement d'une puce de
 * sous-page vers son nouveau parent.
 */
function avecNoeudsEnFin(page: Block, nodes: JSONContent[]): Block {
  // Un paragraphe vide ferme l'ajout : sans lui, le curseur ne pourrait pas se
  // placer APRÈS un tableau ou une image terminant la page.
  const ajout = [...nodes, { type: "paragraph" }];
  const dernier = [...page.content].reverse().find((c) => c.type === "text");
  // Une page sans bloc de texte en reçoit un neuf plutôt que rien.
  if (!dernier) {
    const bloc: ContentBlock = { id: crypto.randomUUID(), type: "text", doc: { type: "doc", content: ajout } };
    return { ...page, content: [...page.content, bloc] };
  }
  return {
    ...page,
    content: page.content.map((c) =>
      c.id === dernier.id ? { ...c, doc: { ...c.doc, content: [...sansParagrapheVideFinal(c.doc), ...ajout] } } : c
    ),
  };
}

/** Le document contient-il déjà un lien vers `cibleId` (puce ou mention) ? */
function pointeVers(n: JSONContent, cibleId: string): boolean {
  if (n.type === "pageLink" && n.attrs?.pageId === cibleId) return true;
  return !!n.content?.some((e) => pointeVers(e, cibleId));
}

/**
 * La page sans la puce de sous-page vers `cibleId` — c'est-à-dire un paragraphe
 * qui ne contient QUE ce lien. Une mention glissée dans une phrase (« voir … »)
 * reste : c'est une citation que l'utilisateur a écrite, pas la filiation.
 */
function sansPuceVers(page: Block, cibleId: string): Block {
  const estLaPuce = (n: JSONContent) =>
    n.type === "paragraph" &&
    !!n.content?.some((e) => e.type === "pageLink" && e.attrs?.pageId === cibleId) &&
    n.content.every((e) => (e.type === "pageLink" && e.attrs?.pageId === cibleId) || (e.type === "text" && !(e.text ?? "").trim()));
  const nettoyer = (n: JSONContent): JSONContent | null => {
    if (estLaPuce(n)) return null;
    if (!n.content) return n;
    return { ...n, content: n.content.map(nettoyer).filter((e): e is JSONContent => e !== null) };
  };
  return {
    ...page,
    content: page.content.map((c) => {
      const doc = nettoyer(c.doc) ?? { type: "doc", content: [] };
      return { ...c, doc: doc.content?.length ? doc : { ...doc, content: [{ type: "paragraph" }] } };
    }),
  };
}

/**
 * Une page supprimée disparaît aussi de la carte mentale : sa bulle placée à la
 * main et ses liens. Écriture SÉPARÉE de la suppression de la page : si elle
 * échouait, la page doit quand même rester supprimée.
 */
function oublierSurLaCarte(pageIds: string[]) {
  if (!pageIds.length) return;
  useCarteStore.getState().oublier(pageIds);
  useCarteStore.getState().oublierLiensDe(pageIds);
}

/** `candidate` est-elle une descendante (à n'importe quelle profondeur) d'`ancetre` ? */
export function estDescendante(blocks: Block[], candidate: string, ancetre: string): boolean {
  const vues = new Set<string>();
  let courante = blocks.find((b) => b.id === candidate);
  while (courante?.parentId && !vues.has(courante.id)) {
    if (courante.parentId === ancetre) return true;
    vues.add(courante.id);
    courante = blocks.find((b) => b.id === courante!.parentId);
  }
  return false;
}

function mapPage(blocks: Block[], pageId: string, fn: (b: Block) => Block): Block[] {
  return blocks.map((b) => (b.id === pageId ? { ...fn(b), updatedAt: Date.now() } : b));
}

// Remplace intégralement les content_blocks d'une page — plus simple et assez rapide
// en local qu'un diff fin, vu le petit nombre de blocs par page.
// Reconstitue un bloc depuis la base. Compatibilité ascendante : un bloc écrit
// avant la migration v2 n'a que text_value, on le convertit en document Tiptap.
function rowToContentBlock(c: ContentRow): ContentBlock {
  if (c.doc_json) {
    try {
      return { id: c.id, type: "text", doc: JSON.parse(c.doc_json) as JSONContent };
    } catch {
      // JSON corrompu : on retombe sur le texte brut plutôt que de perdre le bloc.
    }
  }
  return { id: c.id, type: "text", doc: textToDoc(c.text_value ?? "") };
}

// Contenu d'une page stocké en une seule colonne. Renvoie null si absent ou
// illisible, pour laisser l'appelant retomber sur l'ancien format.
function parsePageContent(raw: string | null): ContentBlock[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Les anciens tableaux-blocs, retirés, n'ont pas de document : on les écarte
    // plutôt que de laisser un bloc sans contenu casser le rendu.
    return (parsed as ContentBlock[]).filter((c) => c?.type === "text" && !!c.doc);
  } catch {
    return null;
  }
}

// Une seule écriture pour tout le contenu d'une page : atomique par nature.
// L'ancien découpage en lignes content_blocks faisait un DELETE puis N INSERT,
// qui pouvait laisser une page tronquée s'il était interrompu en cours de route.
function persistPageContent(pageId: string, content: ContentBlock[]) {
  fireWrite("contenu de page", (db) =>
    db.execute("UPDATE pages SET content_json = $1, updated_at = $2 WHERE id = $3", [
      JSON.stringify(content),
      Date.now(),
      pageId,
    ])
  );
}

export const useBlocksStore = create<BlocksState>()((set, get) => ({
  blocks: [],
  hydrated: false,

  hydrate: async () => {
    const db = await getDb();
    // Les pages sans position passent en dernier : c'est le cas de celles créées
    // par une version d'avant la v5 — l'exécutable du raccourci bureau, notamment.
    const pageRows = await db.select<PageRow[]>(
      "SELECT * FROM pages ORDER BY position IS NULL, position ASC, created_at ASC"
    );
    const contentRows = await db.select<ContentRow[]>("SELECT * FROM content_blocks ORDER BY position ASC");

    const lues: Block[] = pageRows.map((p) => ({
      id: p.id,
      projectId: p.project_id,
      parentId: p.parent_id,
      title: p.title,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      position: p.position ?? SANS_POSITION,
      // Nouveau format : tout le contenu en une colonne. Sinon on reconstitue depuis
      // les anciennes lignes content_blocks, qui restent lisibles indéfiniment.
      content: parsePageContent(p.content_json) ?? contentRows.filter((c) => c.page_id === p.id).map(rowToContentBlock),
    }));

    const { liste: blocks, reparations } = reparerPositions(lues, groupe);
    set({ blocks, hydrated: true });

    // Une page arrivée sans position la reçoit une fois pour toutes, en fin de
    // groupe : sinon elle sauterait d'une place à l'autre à chaque démarrage.
    if (reparations.length) {
      fireWrite("réparation de l'ordre des pages", async (db) => {
        for (const r of reparations) {
          await db.execute("UPDATE pages SET position = $1 WHERE id = $2", [r.position, r.id]);
        }
      });
    }
  },

  addBlock: (projectId, parentId = null) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const block: Block = {
      id,
      projectId,
      parentId,
      title: "Sans titre",
      content: [newTextBlock()],
      createdAt: now,
      updatedAt: now,
      // Toujours en fin de groupe. Avant la v5 une nouvelle page s'affichait en
      // tête, puis passait en bas au redémarrage suivant.
      position: positionSuivante(soeurs(get().blocks, { projectId, parentId }).map((b) => b.position)),
    };
    set({ blocks: [...get().blocks, block] });

    // Page et contenu insérés d'un seul coup : pas d'état intermédiaire possible.
    fireWrite("création de page", (db) =>
      db.execute(
        "INSERT INTO pages (id, project_id, parent_id, title, created_at, updated_at, content_json, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          block.id,
          block.projectId,
          block.parentId,
          block.title,
          block.createdAt,
          block.updatedAt,
          JSON.stringify(block.content),
          block.position,
        ]
      )
    );

    return id;
  },

  insertPage: (entree) => {
    // L'import envoie les pages dans l'ordre d'affichage de la sauvegarde : les
    // ajouter chacune en fin de groupe reproduit donc exactement cet ordre.
    const page: Block = {
      ...entree,
      position: positionSuivante(soeurs(get().blocks, entree).map((b) => b.position)),
    };
    set({ blocks: [...get().blocks, page] });
    fireWrite("import de page", (db) =>
      db.execute(
        "INSERT INTO pages (id, project_id, parent_id, title, created_at, updated_at, content_json, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          page.id,
          page.projectId,
          page.parentId,
          page.title,
          page.createdAt,
          page.updatedAt,
          JSON.stringify(page.content),
          page.position,
        ]
      )
    );
  },

  updateTitle: (id, title) => {
    set({ blocks: mapPage(get().blocks, id, (b) => ({ ...b, title })) });
    debouncedPersist(`title:${id}`, () => {
      fireWrite("renommage de page", (db) =>
        db.execute("UPDATE pages SET title = $1, updated_at = $2 WHERE id = $3", [title, Date.now(), id])
      );
    });
  },

  deleteBlockCascade: (id) => {
    const all = get().blocks;
    const toRemove = new Set<string>();
    const collect = (blockId: string) => {
      toRemove.add(blockId);
      all.filter((b) => b.parentId === blockId).forEach((child) => collect(child.id));
    };
    collect(id);
    set({ blocks: all.filter((b) => !toRemove.has(b.id)) });

    fireWrite("suppression de page", async (db) => {
      for (const pageId of toRemove) {
        // content_blocks n'est plus alimenté mais peut contenir d'anciennes lignes.
        await db.execute("DELETE FROM content_blocks WHERE page_id = $1", [pageId]);
        await db.execute("DELETE FROM pages WHERE id = $1", [pageId]);
      }
    });
    oublierSurLaCarte([...toRemove]);
  },

  deleteBlocksByProject: (projectId) => {
    const removed = get().blocks.filter((b) => b.projectId === projectId);
    set({ blocks: get().blocks.filter((b) => b.projectId !== projectId) });

    fireWrite("suppression des pages d'un projet", async (db) => {
      for (const page of removed) {
        await db.execute("DELETE FROM content_blocks WHERE page_id = $1", [page.id]);
      }
      await db.execute("DELETE FROM pages WHERE project_id = $1", [projectId]);
    });
    oublierSurLaCarte(removed.map((p) => p.id));
  },

  addTextBlock: (pageId) => {
    const blocks = mapPage(get().blocks, pageId, (b) => ({ ...b, content: [...b.content, newTextBlock()] }));
    set({ blocks });
    const page = blocks.find((b) => b.id === pageId)!;
    persistPageContent(pageId, page.content);
  },

  appendNodesToPage: (pageId, nodes) => {
    const target = get().blocks.find((b) => b.id === pageId);
    if (!target || nodes.length === 0) return false;
    const blocks = mapPage(get().blocks, pageId, (b) => avecNoeudsEnFin(b, nodes));
    set({ blocks });
    persistPageContent(pageId, blocks.find((b) => b.id === pageId)!.content);
    return true;
  },

  movePageTo: (id, parentId, avantId) => {
    const blocks = get().blocks;
    const page = blocks.find((b) => b.id === id);
    if (!page) return false;
    // Une page ne peut pas devenir la fille de l'une de ses descendantes : ce
    // serait une boucle, et l'arbre deviendrait impossible à afficher.
    if (parentId && (parentId === id || estDescendante(blocks, parentId, id))) return false;

    const ancienParent = page.parentId;
    const changeDeParent = ancienParent !== parentId;

    // Place parmi les nouvelles sœurs : avant `avantId`, ou en fin de groupe.
    const freres = soeurs(blocks, { projectId: page.projectId, parentId }).filter((b) => b.id !== id);
    const trouve = avantId ? freres.findIndex((b) => b.id === avantId) : -1;
    const index = trouve >= 0 ? trouve : freres.length;
    const ordre = [...freres.slice(0, index), page, ...freres.slice(index)];
    const positions = new Map(ordre.map((b, i) => [b.id, i]));

    const aReecrire = ordre.filter((b) => b.id !== id && b.position !== positions.get(b.id));
    if (!changeDeParent && page.position === positions.get(id) && aReecrire.length === 0) return true;

    let suivant = blocks.map((b) => {
      if (b.id === id) return { ...b, parentId, position: positions.get(id)!, updatedAt: Date.now() };
      const p = positions.get(b.id);
      return p !== undefined && p !== b.position ? { ...b, position: p } : b;
    });

    // La filiation est portée par la puce dans le document du parent (comme dans
    // Notion) : la puce suit la page. Sinon l'ancien parent garderait une puce vers
    // une page qui n'est plus sa fille, et le nouveau n'en aurait aucune.
    const parentsTouches: string[] = [];
    if (changeDeParent) {
      if (ancienParent) {
        suivant = suivant.map((b) => (b.id === ancienParent ? sansPuceVers(b, id) : b));
        parentsTouches.push(ancienParent);
      }
      // Déjà citée chez son nouveau parent : ce lien fait office de puce, on n'en ajoute pas une seconde.
      const dejaCitee = parentId && blocks.find((b) => b.id === parentId)?.content.some((c) => pointeVers(c.doc, id));
      if (parentId && !dejaCitee) {
        const puce = [{ type: "paragraph", content: [{ type: "pageLink", attrs: { pageId: id } }] }];
        suivant = suivant.map((b) => (b.id === parentId ? avecNoeudsEnFin(b, puce) : b));
        parentsTouches.push(parentId);
      }
    }

    set({ blocks: suivant });
    const position = positions.get(id)!;
    fireWrite("déplacement de page", async (db) => {
      await db.execute("UPDATE pages SET parent_id = $1, position = $2, updated_at = $3 WHERE id = $4", [
        parentId,
        position,
        Date.now(),
        id,
      ]);
      for (const b of aReecrire) {
        await db.execute("UPDATE pages SET position = $1 WHERE id = $2", [positions.get(b.id), b.id]);
      }
    });
    for (const pid of parentsTouches) {
      persistPageContent(pid, suivant.find((b) => b.id === pid)!.content);
    }
    return true;
  },

  // L'IA complète un tableau existant. On numérote les tableaux dans l'ordre du
  // document, tous blocs de texte confondus, ce qui correspond à ce que voit
  // l'utilisateur — et donc à ce que l'IA a lu.
  appendRowsToPageTable: (pageId, tableIndex, rows) => {
    const target = get().blocks.find((b) => b.id === pageId);
    if (!target || rows.length === 0) return false;

    let restant = tableIndex;
    let touche = false;
    const contenu = target.content.map((c) => {
      if (touche) return c;
      const modifie = appendRowsToTable(c.doc, restant, rows);
      if (modifie) {
        touche = true;
        return { ...c, doc: modifie };
      }
      // Ce bloc n'avait pas le bon tableau : on décompte ceux qu'il contient.
      restant -= compterTableaux(c.doc);
      return c;
    });
    if (!touche) return false;

    const blocks = mapPage(get().blocks, pageId, (b) => ({ ...b, content: contenu }));
    set({ blocks });
    persistPageContent(pageId, blocks.find((b) => b.id === pageId)!.content);
    return true;
  },

  updateTextDoc: (pageId, contentId, doc) => {
    const blocks = mapPage(get().blocks, pageId, (b) => ({
      ...b,
      content: b.content.map((c) => (c.id === contentId && c.type === "text" ? { ...c, doc } : c)),
    }));
    set({ blocks });
    const page = blocks.find((b) => b.id === pageId)!;
    debouncedPersist(`content:${pageId}`, () => persistPageContent(pageId, page.content));
  },

  // Reprend une image du moodboard dans une page. On ne stocke que le chemin de
  // l'asset, déjà écrit sur disque : les deux vues partagent le même fichier.
  appendImageToPage: (pageId, assetPath) =>
    get().appendNodesToPage(pageId, [{ type: "image", attrs: { src: assetPath, align: "none" } }]),
}));

// Texte brut d'une page, extrait des documents Tiptap. Alimente les backlinks,
// le graphe et le contexte envoyé à l'IA — tous travaillent sur du texte.
export function getBlockText(block: Block): string {
  return block.content
    .filter((c): c is Extract<ContentBlock, { type: "text" }> => c.type === "text")
    .map((c) => docToText(c.doc))
    .join("\n");
}

/**
 * Identifiants des pages référencées par une puce dans le document.
 * Les mentions ne laissent aucune trace dans le texte brut — sans ça, elles
 * seraient invisibles pour les backlinks et pour le graphe.
 */
export function extractPageRefs(block: Block): string[] {
  const ids: string[] = [];
  const walk = (node: JSONContent | undefined) => {
    if (!node) return;
    if (node.type === "pageLink" && typeof node.attrs?.pageId === "string") {
      ids.push(node.attrs.pageId);
    }
    node.content?.forEach(walk);
  };
  block.content
    .filter((c): c is Extract<ContentBlock, { type: "text" }> => c.type === "text")
    .forEach((c) => walk(c.doc));
  return ids;
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export function extractLinks(text: string): string[] {
  const titles: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(text)) !== null) {
    titles.push(match[1].trim());
  }
  return titles;
}
