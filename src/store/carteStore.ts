import { create } from "zustand";
import { fireWrite, getDb } from "../db";

/**
 * Mémoire de la carte mentale (migration v6).
 *
 * Une bulle déplacée à la main garde son DÉCALAGE par rapport à sa place
 * automatique, pas une position absolue : ses sous-pages la suivent quand on la
 * déplace, et la disposition reste cohérente quand des pages sont ajoutées.
 */

export interface Decalage {
  dx: number;
  dy: number;
}

/**
 * Lien de la carte, qui n'existe QUE sur la carte (l'utilisateur ne veut pas
 * qu'il modifie ses pages) :
 * — « humain » : tracé à la main, couleur et étiquette au choix ;
 * — « ia » : proposé par l'IA et gardé (étape 4) ; « ia_rejete » : refusé, mémorisé
 *   pour ne plus être proposé.
 */
export interface LienCarte {
  id: string;
  projectId: string;
  de: string;
  vers: string;
  type: "humain" | "ia" | "ia_rejete";
  couleur: string | null;
  etiquette: string;
  raison: string;
  creeLe: number;
}

interface NoeudRow {
  page_id: string;
  project_id: string;
  dx: number;
  dy: number;
}

interface LienRow {
  id: string;
  project_id: string;
  from_page: string;
  to_page: string;
  kind: LienCarte["type"];
  color: string | null;
  label: string | null;
  reason: string | null;
  created_at: number;
}

interface CarteState {
  /** Décalage par page ; une page absente est à sa place automatique. */
  decalages: Record<string, Decalage & { projectId: string }>;
  liens: LienCarte[];
  hydrate: () => Promise<void>;
  deplacer: (pageId: string, projectId: string, d: Decalage) => void;
  /** Remet la page à sa place automatique. */
  oublier: (pageIds: string[]) => void;
  /** « Réorganiser » : toute la carte d'un projet revient à la disposition automatique. */
  reorganiser: (projectId: string) => void;
  ajouterLien: (l: Omit<LienCarte, "id" | "creeLe">) => string;
  /** Couleur, étiquette — ou type : un lien de l'IA peut devenir « à moi », ou rejeté. */
  modifierLien: (id: string, modif: Partial<Pick<LienCarte, "couleur" | "etiquette" | "type">>) => void;
  supprimerLien: (id: string) => void;
  /** Pages supprimées : leurs liens disparaissent avec elles. */
  oublierLiensDe: (pageIds: string[]) => void;
}

export const useCarteStore = create<CarteState>()((set, get) => ({
  decalages: {},
  liens: [],

  hydrate: async () => {
    const db = await getDb();
    const rows = await db.select<NoeudRow[]>("SELECT * FROM graph_nodes");
    const liens = await db.select<LienRow[]>("SELECT * FROM graph_links ORDER BY created_at");
    set({
      decalages: Object.fromEntries(rows.map((r) => [r.page_id, { dx: r.dx, dy: r.dy, projectId: r.project_id }])),
      liens: liens.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        de: r.from_page,
        vers: r.to_page,
        type: r.kind,
        couleur: r.color,
        etiquette: r.label ?? "",
        raison: r.reason ?? "",
        creeLe: r.created_at,
      })),
    });
  },

  ajouterLien: (l) => {
    const lien: LienCarte = { ...l, id: crypto.randomUUID(), creeLe: Date.now() };
    set({ liens: [...get().liens, lien] });
    fireWrite("ajout d'un lien sur la carte", (db) =>
      db.execute(
        "INSERT INTO graph_links (id, project_id, from_page, to_page, kind, color, label, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [lien.id, lien.projectId, lien.de, lien.vers, lien.type, lien.couleur, lien.etiquette || null, lien.raison || null, lien.creeLe]
      )
    );
    return lien.id;
  },

  modifierLien: (id, modif) => {
    const lien = get().liens.find((l) => l.id === id);
    if (!lien) return;
    const suivant = { ...lien, ...modif };
    set({ liens: get().liens.map((l) => (l.id === id ? suivant : l)) });
    fireWrite("modification d'un lien de la carte", (db) =>
      db.execute("UPDATE graph_links SET color = $1, label = $2, kind = $3 WHERE id = $4", [
        suivant.couleur,
        suivant.etiquette || null,
        suivant.type,
        id,
      ])
    );
  },

  supprimerLien: (id) => {
    set({ liens: get().liens.filter((l) => l.id !== id) });
    fireWrite("suppression d'un lien de la carte", (db) => db.execute("DELETE FROM graph_links WHERE id = $1", [id]));
  },

  oublierLiensDe: (pageIds) => {
    const ids = new Set(pageIds);
    if (!get().liens.some((l) => ids.has(l.de) || ids.has(l.vers))) return;
    set({ liens: get().liens.filter((l) => !ids.has(l.de) && !ids.has(l.vers)) });
    fireWrite("nettoyage des liens de la carte", async (db) => {
      for (const id of ids) await db.execute("DELETE FROM graph_links WHERE from_page = $1 OR to_page = $1", [id]);
    });
  },

  deplacer: (pageId, projectId, { dx, dy }) => {
    const x = Math.round(dx), y = Math.round(dy);
    if (x === 0 && y === 0) return get().oublier([pageId]);
    set({ decalages: { ...get().decalages, [pageId]: { dx: x, dy: y, projectId } } });
    fireWrite("placement d'une bulle de la carte", (db) =>
      db.execute(
        "INSERT INTO graph_nodes (page_id, project_id, dx, dy) VALUES ($1, $2, $3, $4) ON CONFLICT(page_id) DO UPDATE SET dx = $3, dy = $4",
        [pageId, projectId, x, y]
      )
    );
  },

  oublier: (pageIds) => {
    const presents = pageIds.filter((id) => id in get().decalages);
    if (!presents.length) return;
    const suivant = { ...get().decalages };
    presents.forEach((id) => delete suivant[id]);
    set({ decalages: suivant });
    fireWrite("placement d'une bulle de la carte", async (db) => {
      for (const id of presents) await db.execute("DELETE FROM graph_nodes WHERE page_id = $1", [id]);
    });
  },

  reorganiser: (projectId) => {
    set({
      decalages: Object.fromEntries(Object.entries(get().decalages).filter(([, d]) => d.projectId !== projectId)),
    });
    fireWrite("réorganisation de la carte", (db) => db.execute("DELETE FROM graph_nodes WHERE project_id = $1", [projectId]));
  },
}));
