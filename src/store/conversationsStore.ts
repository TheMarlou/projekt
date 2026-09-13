import { create } from "zustand";
import { fireWrite, getDb } from "../db";

/**
 * Conversations avec l'assistant, enregistrées par projet (demande du 13/09 :
 * « des conversations qu'on retrouve » ; toutes gardées, supprimables à la main).
 *
 * On enregistre deux choses distinctes, comme dans le panneau :
 * — `elements` : ce que le panneau AFFICHE (messages, cartes de proposition) ;
 * — `historique` : ce que le modèle RELIT pour reprendre la discussion.
 * Une proposition encore « à valider » ne survit pas à la fermeture : son code
 * d'application n'est pas enregistrable. Elle revient marquée « expirée ».
 */

export interface ConversationEnregistree {
  id: string;
  projectId: string;
  titre: string;
  creeLe: number;
  majLe: number;
  elements: unknown[];
  historique: unknown[];
}

interface Ligne {
  id: string;
  project_id: string;
  titre: string;
  cree_le: number;
  maj_le: number;
  elements_json: string;
  historique_json: string;
}

interface ConversationsState {
  conversations: ConversationEnregistree[];
  hydrate: () => Promise<void>;
  enregistrer: (c: ConversationEnregistree) => void;
  supprimer: (id: string) => void;
  supprimerDuProjet: (projectId: string) => void;
}

function lireJson(texte: string): unknown[] {
  try {
    const v = JSON.parse(texte);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const useConversationsStore = create<ConversationsState>()((set, get) => ({
  conversations: [],

  hydrate: async () => {
    const db = await getDb();
    const lignes = await db.select<Ligne[]>("SELECT * FROM ai_conversations ORDER BY maj_le DESC");
    set({
      conversations: lignes.map((l) => ({
        id: l.id,
        projectId: l.project_id,
        titre: l.titre,
        creeLe: l.cree_le,
        majLe: l.maj_le,
        elements: lireJson(l.elements_json),
        historique: lireJson(l.historique_json),
      })),
    });
  },

  enregistrer: (c) => {
    const autres = get().conversations.filter((x) => x.id !== c.id);
    set({ conversations: [c, ...autres] });
    fireWrite("enregistrement de la conversation", (db) =>
      db.execute(
        `INSERT INTO ai_conversations (id, project_id, titre, cree_le, maj_le, elements_json, historique_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(id) DO UPDATE SET titre = $3, maj_le = $5, elements_json = $6, historique_json = $7`,
        [c.id, c.projectId, c.titre, c.creeLe, c.majLe, JSON.stringify(c.elements), JSON.stringify(c.historique)]
      )
    );
  },

  supprimer: (id) => {
    set({ conversations: get().conversations.filter((c) => c.id !== id) });
    fireWrite("suppression d'une conversation", (db) => db.execute("DELETE FROM ai_conversations WHERE id = $1", [id]));
  },

  supprimerDuProjet: (projectId) => {
    set({ conversations: get().conversations.filter((c) => c.projectId !== projectId) });
    fireWrite("suppression des conversations d'un projet", (db) =>
      db.execute("DELETE FROM ai_conversations WHERE project_id = $1", [projectId])
    );
  },
}));
