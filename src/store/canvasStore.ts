import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { debouncedPersist, fireWrite, getDb } from "../db";
import { parseCrop, type Crop } from "../lib/crop";

/**
 * Élément du moodboard : une image, une vidéo (fichier), ou un lien TikTok
 * (migration v7, demande du 11/09 : « je cherche beaucoup d'inspiration sur TikTok »).
 */
export type GenreElement = "image" | "video" | "tiktok";

export interface MetaElement {
  /** Vidéo : image d'aperçu (première image), montrée tant que la vidéo ne joue pas. */
  apercu?: string;
  /** TikTok : adresse complète de la vidéo, son identifiant, son titre et son auteur. */
  url?: string;
  videoId?: string;
  titre?: string;
  auteur?: string;
}

export interface CanvasItem {
  id: string;
  projectId: string;
  genre: GenreElement;
  /**
   * Fichier sur disque (voir spec §3.1) — la source de vérité persistée :
   * l'image, le fichier vidéo, ou la miniature d'un lien TikTok.
   */
  assetPath: string;
  /** Image affichée, en mémoire (data URL) : l'image elle-même, l'aperçu d'une vidéo, la miniature d'un TikTok. */
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Zone gardée, en fractions de l’image d’origine. `null` = image entière. */
  crop: Crop | null;
  meta: MetaElement | null;
  /** Le fichier n'a pas pu être lu (déplacé, supprimé hors de l'app). */
  manquante?: boolean;
}

interface CanvasRow {
  id: string;
  project_id: string;
  asset_path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  crop_json: string | null;
  kind: string | null;
  meta_json: string | null;
}

interface CanvasState {
  items: CanvasItem[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Lit les images d'UN projet, à l'ouverture de son moodboard. */
  chargerImages: (projectId: string) => Promise<void>;
  addItem: (item: Omit<CanvasItem, "id" | "genre" | "meta"> & { genre?: GenreElement; meta?: MetaElement | null }) => void;
  moveItem: (id: string, x: number, y: number) => void;
  resizeItem: (id: string, width: number, height: number) => void;
  cropItem: (id: string, crop: Crop | null) => void;
  removeItem: (id: string) => void;
  deleteItemsByProject: (projectId: string) => void;
}

function safeParse(brut: string): unknown {
  try {
    return JSON.parse(brut);
  } catch {
    return null;
  }
}

/** Le fichier qui donne l'image affichée d'un élément. */
export function fichierImage(it: Pick<CanvasItem, "genre" | "assetPath" | "meta">): string {
  return it.genre === "video" ? it.meta?.apercu ?? "" : it.assetPath;
}

/** Tous les fichiers d'un élément (à supprimer avec lui, à copier dans une sauvegarde). */
export function fichiersElement(it: Pick<CanvasItem, "genre" | "assetPath" | "meta">): string[] {
  return [it.assetPath, it.genre === "video" ? it.meta?.apercu : undefined].filter((f): f is string => !!f);
}

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  items: [],
  hydrated: false,

  // Au démarrage, seulement les positions : AUCUNE image n'est lue. Avant, l'app
  // lisait toutes les images de tous les moodboards (13,7 Mo le 11/09, et un
  // moodboard façon PureRef grossit vite) avant même d'afficher quoi que ce soit.
  hydrate: async () => {
    const db = await getDb();
    const rows = await db.select<CanvasRow[]>("SELECT * FROM canvas_items");
    const items: CanvasItem[] = rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      // Type vide = image : c'est tout ce qui existait avant la v7.
      genre: r.kind === "video" || r.kind === "tiktok" ? r.kind : "image",
      assetPath: r.asset_path,
      src: "",
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      // La colonne est vide pour tout ce qui existait avant la migration v4 :
      // absence de rognage vaut « image entière ».
      crop: r.crop_json ? parseCrop(safeParse(r.crop_json)) : null,
      meta: r.meta_json ? (safeParse(r.meta_json) as MetaElement | null) : null,
    }));
    set({ items, hydrated: true });
  },

  chargerImages: async (projectId) => {
    const aLire = get().items.filter((it) => it.projectId === projectId && !it.src && !it.manquante && fichierImage(it));
    // Quatre lectures à la fois : assez pour aller vite, sans saturer le disque
    // ni le pont avec Rust sur un gros moodboard.
    for (let i = 0; i < aLire.length; i += 4) {
      const lot = await Promise.all(
        aLire.slice(i, i + 4).map(async (it) => ({
          id: it.id,
          src: await invoke<string>("read_asset_base64", { path: fichierImage(it) }).catch(() => ""),
        }))
      );
      const lus = new Map(lot.map((l) => [l.id, l.src]));
      set({
        items: get().items.map((it) =>
          lus.has(it.id) ? (lus.get(it.id) ? { ...it, src: lus.get(it.id)! } : { ...it, manquante: true }) : it
        ),
      });
    }
  },

  addItem: (item) => {
    const newItem: CanvasItem = { genre: "image", meta: null, ...item, id: crypto.randomUUID() };
    set({ items: [...get().items, newItem] });
    fireWrite("ajout au moodboard", (db) =>
      db.execute(
        // Le rognage part dès l'insertion : une image déposée n'en a jamais, mais
        // une image restaurée depuis une sauvegarde arrive déjà rognée.
        "INSERT INTO canvas_items (id, project_id, asset_path, x, y, width, height, crop_json, kind, meta_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          newItem.id,
          newItem.projectId,
          newItem.assetPath,
          newItem.x,
          newItem.y,
          newItem.width,
          newItem.height,
          newItem.crop ? JSON.stringify(newItem.crop) : null,
          newItem.genre === "image" ? null : newItem.genre,
          newItem.meta ? JSON.stringify(newItem.meta) : null,
        ]
      )
    );
  },

  moveItem: (id, x, y) => {
    set({ items: get().items.map((it) => (it.id === id ? { ...it, x, y } : it)) });
    debouncedPersist(`canvas-move:${id}`, () => {
      fireWrite("déplacement d'image", (db) =>
        db.execute("UPDATE canvas_items SET x = $1, y = $2 WHERE id = $3", [x, y, id])
      );
    });
  },

  cropItem: (id, crop) => {
    set({ items: get().items.map((it) => (it.id === id ? { ...it, crop } : it)) });
    fireWrite("rognage d’image", (db) =>
      db.execute("UPDATE canvas_items SET crop_json = $1 WHERE id = $2", [
        crop ? JSON.stringify(crop) : null,
        id,
      ])
    );
  },

  resizeItem: (id, width, height) => {
    set({ items: get().items.map((it) => (it.id === id ? { ...it, width, height } : it)) });
    debouncedPersist(`canvas-resize:${id}`, () => {
      fireWrite("redimensionnement d'image", (db) =>
        db.execute("UPDATE canvas_items SET width = $1, height = $2 WHERE id = $3", [width, height, id])
      );
    });
  },

  removeItem: (id) => {
    const item = get().items.find((it) => it.id === id);
    set({ items: get().items.filter((it) => it.id !== id) });
    if (item) fichiersElement(item).forEach((f) => invoke("delete_asset", { path: f }).catch(() => {}));
    fireWrite("suppression d'un élément du moodboard", (db) => db.execute("DELETE FROM canvas_items WHERE id = $1", [id]));
  },

  deleteItemsByProject: (projectId) => {
    const removed = get().items.filter((it) => it.projectId === projectId);
    set({ items: get().items.filter((it) => it.projectId !== projectId) });
    removed.forEach((it) => fichiersElement(it).forEach((f) => invoke("delete_asset", { path: f }).catch(() => {})));
    fireWrite("suppression du moodboard d'un projet", (db) =>
      db.execute("DELETE FROM canvas_items WHERE project_id = $1", [projectId])
    );
  },
}));
