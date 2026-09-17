/**
 * Statistiques anonymes (17/09) : RIEN ne part tant que la personne ne les a pas
 * activées, et les valeurs envoyées restent courtes.
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
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.2.0" }));

import { activerStatistiques, CLE_APTABASE, evenementsEnvoyes, fonctionUtilisee, mesurer, statistiquesActivees, tranche } from "./statistiques";

const envois = vi.fn(async () => new Response(null, { status: 200 }));

beforeEach(() => {
  envois.mockClear();
  (globalThis as { fetch?: unknown }).fetch = envois;
  localStorage.removeItem("projekt-statistiques");
});

describe("statistiques anonymes", () => {
  it("désactivées par défaut : aucun envoi", async () => {
    expect(statistiquesActivees()).toBe(false);
    mesurer("lancement", { langue: "fr" });
    fonctionUtilisee("moodboard");
    await new Promise((r) => setTimeout(r, 0));
    expect(envois).not.toHaveBeenCalled();
  });

  it.runIf(CLE_APTABASE !== "")("activées : envoi, avec des textes coupés", async () => {
    activerStatistiques(true);
    mesurer("essai", { texte: "x".repeat(500), n: 1.234 });
    await new Promise((r) => setTimeout(r, 0));
    expect(envois).toHaveBeenCalled();
    const dernier = evenementsEnvoyes().at(-1)!;
    expect(String(dernier.props.texte)).toHaveLength(60);
    expect(dernier.props.n).toBe(1.2);
    activerStatistiques(false);
  });

  it("donne des durées par tranche, jamais la valeur exacte", () => {
    expect(tranche(1.2)).toBe("<3 s");
    expect(tranche(12)).toBe("10-30 s");
    expect(tranche(120)).toBe(">60 s");
  });
});
