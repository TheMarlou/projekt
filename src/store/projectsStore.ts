import { create } from "zustand";
import { fireWrite, getDb } from "../db";
import { SANS_POSITION, deplacer, positionSuivante, renumeroter, reparerPositions } from "../lib/reorder";
import { tr } from "../lib/i18n";

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  /** Ordre choisi dans la barre latérale (migration v5). */
  position: number;
}

interface ProjectRow {
  id: string;
  name: string;
  created_at: number;
  position: number | null;
}

interface ProjectsState {
  projects: Project[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addProject: (name?: string) => string;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  /** Place le projet à l'index `vers`, compté parmi les AUTRES projets. */
  moveProject: (id: string, vers: number) => void;
}

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
  projects: [],
  hydrated: false,

  hydrate: async () => {
    const db = await getDb();
    // La date de création départage : c'est l'ordre d'avant la v5, et celui de
    // toute ligne qui n'aurait pas encore de position.
    const rows = await db.select<ProjectRow[]>(
      "SELECT id, name, created_at, position FROM projects ORDER BY position IS NULL, position ASC, created_at ASC"
    );
    const { liste, reparations } = reparerPositions(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        position: r.position ?? SANS_POSITION,
      })),
      () => "projets"
    );
    set({ projects: liste, hydrated: true });

    // Un projet créé par une version d'avant la v5 reçoit sa position une fois.
    if (reparations.length) {
      fireWrite("réparation de l'ordre des projets", async (db) => {
        for (const r of reparations) {
          await db.execute("UPDATE projects SET position = $1 WHERE id = $2", [r.position, r.id]);
        }
      });
    }
  },

  addProject: (name) => {
    const id = crypto.randomUUID();
    const project: Project = {
      id,
      name: name?.trim() || tr("Nouveau projet", "New project"),
      createdAt: Date.now(),
      position: positionSuivante(get().projects.map((p) => p.position)),
    };
    set({ projects: [...get().projects, project] });
    fireWrite("création de projet", (db) =>
      db.execute("INSERT INTO projects (id, name, created_at, position) VALUES ($1, $2, $3, $4)", [
        project.id,
        project.name,
        project.createdAt,
        project.position,
      ])
    );
    return id;
  },

  renameProject: (id, name) => {
    set({ projects: get().projects.map((p) => (p.id === id ? { ...p, name } : p)) });
    fireWrite("renommage de projet", (db) =>
      db.execute("UPDATE projects SET name = $1 WHERE id = $2", [name, id])
    );
  },

  deleteProject: (id) => {
    set({ projects: get().projects.filter((p) => p.id !== id) });
    fireWrite("suppression de projet", (db) => db.execute("DELETE FROM projects WHERE id = $1", [id]));
  },

  moveProject: (id, vers) => {
    const reordonnee = deplacer(get().projects, id, vers);
    if (!reordonnee) return;
    const { liste, changes } = renumeroter(reordonnee);
    set({ projects: liste });
    if (changes.length === 0) return;
    fireWrite("réordonnancement des projets", async (db) => {
      for (const c of changes) {
        await db.execute("UPDATE projects SET position = $1 WHERE id = $2", [c.position, c.id]);
      }
    });
  },
}));
