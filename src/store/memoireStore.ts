import { create } from "zustand";
import { fireWrite, getDb } from "../db";

/**
 * Mémoire de l'assistant, À PART des pages du projet (demande du 13/09 : « une
 * page à part du projet, disponible dans son menu comme les réglages »). Une ligne
 * par information, rangée dans une rubrique. L'assistant la relit à chaque
 * question ; il n'y écrit jamais seul (outil `memoriser` = proposition à valider).
 */

export interface EntreeMemoire {
  id: string;
  projectId: string;
  /** resume | decision | preference | idee_ecartee (voir lib/memoireProjet). */
  rubrique: string;
  texte: string;
  creeLe: number;
}

interface Ligne {
  id: string;
  project_id: string;
  rubrique: string;
  texte: string;
  cree_le: number;
}

interface MemoireState {
  entrees: EntreeMemoire[];
  hydrate: () => Promise<void>;
  ajouter: (projectId: string, rubrique: string, texte: string, creeLe?: number) => string;
  modifier: (id: string, texte: string) => void;
  supprimer: (id: string) => void;
  supprimerDuProjet: (projectId: string) => void;
}

export const useMemoireStore = create<MemoireState>()((set, get) => ({
  entrees: [],

  hydrate: async () => {
    const db = await getDb();
    const lignes = await db.select<Ligne[]>("SELECT * FROM ai_memoire ORDER BY cree_le ASC");
    set({
      entrees: lignes.map((l) => ({ id: l.id, projectId: l.project_id, rubrique: l.rubrique, texte: l.texte, creeLe: l.cree_le })),
    });
  },

  ajouter: (projectId, rubrique, texte, creeLe = Date.now()) => {
    const entree: EntreeMemoire = { id: crypto.randomUUID(), projectId, rubrique, texte, creeLe };
    set({ entrees: [...get().entrees, entree] });
    fireWrite("ajout à la mémoire", (db) =>
      db.execute("INSERT INTO ai_memoire (id, project_id, rubrique, texte, cree_le) VALUES ($1,$2,$3,$4,$5)", [
        entree.id,
        projectId,
        rubrique,
        texte,
        creeLe,
      ])
    );
    return entree.id;
  },

  modifier: (id, texte) => {
    set({ entrees: get().entrees.map((e) => (e.id === id ? { ...e, texte } : e)) });
    fireWrite("modification de la mémoire", (db) => db.execute("UPDATE ai_memoire SET texte = $1 WHERE id = $2", [texte, id]));
  },

  supprimer: (id) => {
    set({ entrees: get().entrees.filter((e) => e.id !== id) });
    fireWrite("suppression d'une ligne de mémoire", (db) => db.execute("DELETE FROM ai_memoire WHERE id = $1", [id]));
  },

  supprimerDuProjet: (projectId) => {
    set({ entrees: get().entrees.filter((e) => e.projectId !== projectId) });
    fireWrite("suppression de la mémoire d'un projet", (db) => db.execute("DELETE FROM ai_memoire WHERE project_id = $1", [projectId]));
  },
}));
