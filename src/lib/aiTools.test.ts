/**
 * Garantie demandée le 13/09 : « rien sans moi ». L'assistant ne peut RIEN écrire
 * avant que l'utilisateur valide, et un outil interdit dans les réglages est
 * refusé par le code, quoi que le modèle ait appelé.
 *
 *   npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Sous Node, pas de localStorage (langue, réglages) ni de base SQLite : on les simule.
vi.hoisted(() => {
  const memoire = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memoire.get(k) ?? null,
    setItem: (k: string, v: string) => void memoire.set(k, v),
    removeItem: (k: string) => void memoire.delete(k),
  };
});
vi.mock("../db", () => ({
  getDb: async () => ({ execute: async () => ({}), select: async () => [] }),
  fireWrite: () => {},
  debouncedPersist: (_cle: string, fn: () => void) => fn(),
}));

import { useBlocksStore, type Block } from "../store/blocksStore";
import { useProjectsStore } from "../store/projectsStore";
import { appliquerPlan, executeTool, outilsDisponibles, OUTILS_ECRITURE, OUTILS_LECTURE, Plan, setAiContextProject } from "./aiTools";
import { changerReglagesIa, REGLAGES_PAR_DEFAUT } from "./iaReglages";
import { pageMemoire } from "./memoireProjet";

function page(id: string, titre: string, texte: string, parentId: string | null = null): Block {
  return {
    id,
    projectId: "p1",
    parentId,
    title: titre,
    content: [{ id: `c-${id}`, type: "text", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: texte }] }] } }],
    createdAt: 1,
    updatedAt: 1,
    position: 0,
  };
}

const empreinte = () => JSON.stringify(useBlocksStore.getState().blocks);

beforeEach(() => {
  changerReglagesIa({ ...REGLAGES_PAR_DEFAUT });
  useProjectsStore.setState({ projects: [{ id: "p1", name: "Mon jeu", createdAt: 1, position: 0 }] });
  useBlocksStore.setState({ blocks: [page("b1", "Boss", "Le boss s'appelle NÉMÉSIS.")] });
  setAiContextProject("p1");
});

describe("rien n'est écrit avant validation", () => {
  it("create_page propose seulement, puis crée à l'application", async () => {
    const plan = new Plan();
    const avant = empreinte();
    const r = await executeTool("create_page", { title: "Phase 2", parent_path: "Mon jeu > Boss" }, plan);
    expect(r.ok).toBe(true);
    expect(empreinte()).toBe(avant);
    expect(plan.actions).toHaveLength(1);

    expect(appliquerPlan(plan).erreurs).toEqual([]);
    expect(useBlocksStore.getState().blocks.some((b) => b.title === "Phase 2")).toBe(true);
  });

  it("add_content ne touche pas la page avant l'application", async () => {
    const plan = new Plan();
    const avant = empreinte();
    await executeTool("add_content", { page_path: "Mon jeu > Boss", markdown: "- Faiblesse : les conduits" }, plan);
    expect(empreinte()).toBe(avant);
    appliquerPlan(plan);
    expect(empreinte()).not.toBe(avant);
  });

  it("memoriser ne crée la page 🧠 Mémoire qu'à l'application, sous la bonne rubrique", async () => {
    const plan = new Plan();
    await executeTool("memoriser", { rubrique: "decision", texte: "Pas de magie dans cet univers." }, plan);
    expect(pageMemoire("p1")).toBeNull();

    appliquerPlan(plan);
    const memoire = pageMemoire("p1");
    expect(memoire).not.toBeNull();
    const noeuds = memoire!.content[0].doc.content ?? [];
    const titre = noeuds.findIndex((n) => n.type === "heading" && JSON.stringify(n).includes("Décisions prises"));
    expect(titre).toBeGreaterThanOrEqual(0);
    expect(noeuds[titre + 1].type).toBe("bulletList");
    expect(JSON.stringify(noeuds[titre + 1])).toContain("Pas de magie");
  });

  it("note_discussion ne crée la note qu'à l'application, rangée dans « 💬 Discussions »", async () => {
    const plan = new Plan();
    const avant = empreinte();
    await executeTool("note_discussion", { titre: "Boss final", markdown: "## Décisions\n- Le boss a trois phases" }, plan);
    expect(empreinte()).toBe(avant);

    appliquerPlan(plan);
    const blocs = useBlocksStore.getState().blocks;
    const discussions = blocs.find((b) => b.title === "💬 Discussions" && !b.parentId);
    expect(discussions).toBeDefined();
    const note = blocs.find((b) => b.parentId === discussions!.id);
    expect(note?.title).toMatch(/^\d{4}-\d{2}-\d{2} — Boss final$/);
  });

  it("une proposition ne s'applique qu'une fois", async () => {
    const plan = new Plan();
    await executeTool("create_page", { title: "Unique", project: "Mon jeu" }, plan);
    appliquerPlan(plan);
    expect(appliquerPlan(plan).reussies).toBe(0);
    expect(useBlocksStore.getState().blocks.filter((b) => b.title === "Unique")).toHaveLength(1);
  });
});

describe("les réglages sont tenus par le code", () => {
  it("modifications désactivées : outils d'écriture ni proposés, ni exécutés", async () => {
    changerReglagesIa({ proposerModifications: false });
    const noms = outilsDisponibles().map((o) => o.function.name);
    expect(noms.some((n) => OUTILS_ECRITURE.has(n))).toBe(false);

    for (const [nom, args] of [
      ["create_page", { title: "Interdit", project: "Mon jeu" }],
      ["add_content", { page_path: "Mon jeu > Boss", markdown: "interdit" }],
      ["memoriser", { rubrique: "decision", texte: "interdit" }],
      ["note_discussion", { titre: "interdit", markdown: "interdit" }],
    ] as const) {
      const plan = new Plan();
      const r = await executeTool(nom, args, plan);
      expect(r.ok, nom).toBe(false);
      expect(plan.actions, nom).toHaveLength(0);
    }
  });

  it("lecture désactivée : les pages ne sont ni lues ni cherchées", async () => {
    changerReglagesIa({ lirePages: false });
    expect(outilsDisponibles().some((o) => OUTILS_LECTURE.has(o.function.name))).toBe(false);
    const r = await executeTool("read_page", { path: "Mon jeu > Boss" }, new Plan());
    expect(r.ok).toBe(false);
    expect(r.payload).not.toContain("NÉMÉSIS");
  });

  it("« écrire sans validation » ne peut pas rester actif sans droit de proposer", () => {
    changerReglagesIa({ ecrireSansValidation: true, proposerModifications: false });
    expect(JSON.parse(localStorage.getItem("projekt-ia-reglages")!).ecrireSansValidation).toBe(false);
  });
});
