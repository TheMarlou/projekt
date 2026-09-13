/**
 * Les conversations avec l'assistant partent dans la sauvegarde .zip et en reviennent
 * (choix du 13/09) ; une sauvegarde d'avant, sans conversations, se relit toujours.
 *
 *   npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { useBlocksStore } from "../store/blocksStore";
import { useConversationsStore } from "../store/conversationsStore";
import { useProjectsStore } from "../store/projectsStore";
import { ARCHIVE_FORMAT, buildArchive, parseArchive } from "./projectArchive";

beforeEach(() => {
  useProjectsStore.setState({ projects: [{ id: "p1", name: "Mon jeu", createdAt: 1, position: 0 }] });
  useBlocksStore.setState({ blocks: [] });
  useConversationsStore.setState({
    conversations: [
      { id: "c1", projectId: "p1", titre: "Boss final", creeLe: 10, majLe: 20, elements: [{ role: "user", text: "Et le boss ?" }], historique: [{ role: "user", content: "Et le boss ?" }] },
      { id: "c2", projectId: "autre", titre: "Pas à moi", creeLe: 1, majLe: 1, elements: [], historique: [] },
    ],
  });
});

describe("conversations dans la sauvegarde", () => {
  it("n'exporte que celles du projet, et les relit", () => {
    const bundle = buildArchive("p1");
    expect(bundle).not.toBeNull();
    const json = String(bundle!.files.find((f) => f.path === "projekt.json")?.contents);
    const relu = parseArchive(json);
    expect(relu.conversations).toHaveLength(1);
    expect(relu.conversations[0].titre).toBe("Boss final");
    expect(relu.conversations[0].historique).toHaveLength(1);
  });

  it("relit une ancienne sauvegarde sans conversations", () => {
    const ancienne = JSON.stringify({ format: ARCHIVE_FORMAT, version: 1, project: { name: "Vieux" }, pages: [] });
    expect(parseArchive(ancienne).conversations).toEqual([]);
  });
});
