import type { Block } from "../store/blocksStore";
import { texteDePage } from "./suggestionsLiens";

/**
 * Recherche globale (Ctrl+P) : dans les titres et le contenu de toutes les
 * pages, tous projets confondus. Pure : ni React ni store, pour se tester seule.
 *
 * Insensible aux accents et à la casse (« epee » trouve « Épée »), tous les mots
 * doivent être présents (« boss faiblesse » ne ramène pas toutes les pages qui
 * parlent d'un boss).
 */

export interface Extrait {
  avant: string;
  trouve: string;
  apres: string;
}

export interface ResultatRecherche {
  pageId: string;
  projectId: string;
  titre: string;
  /** Où vit la page : « Projet > Parent ». */
  lieu: string;
  /** Passage du contenu autour du premier mot trouvé ; absent si seul le titre correspond. */
  extrait: Extrait | null;
  score: number;
}

const RESULTATS_MAX = 30;
const CONTEXTE = 60;

/** Sans accents, en minuscules — même LONGUEUR que l'original, pour retrouver les positions. */
function plier(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Plier en gardant la correspondance des positions : NFD peut allonger le texte
 * (« é » → « e » + accent), on reconstruit donc caractère par caractère.
 */
function plierAvecPositions(t: string): { plie: string; origine: number[] } {
  let plie = "";
  const origine: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const p = plier(t[i]);
    for (const c of p) {
      plie += c;
      origine.push(i);
    }
  }
  return { plie, origine };
}

export function rechercher(
  pages: Block[],
  nomsProjets: Map<string, string>,
  requete: string,
  projetCourant: string | null
): ResultatRecherche[] {
  const mots = plier(requete)
    .split(/\s+/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  if (!mots.length) return [];

  const parId = new Map(pages.map((p) => [p.id, p]));
  const titreDe = (id: string) => parId.get(id)?.title;
  const resultats: ResultatRecherche[] = [];

  for (const page of pages) {
    const titre = page.title.trim() || "Sans titre";
    const titrePlie = plier(titre);
    const texte = texteDePage(page, titreDe);
    const { plie, origine } = plierAvecPositions(texte);

    // Chaque mot doit apparaître quelque part : dans le titre ou dans le texte.
    if (!mots.every((m) => titrePlie.includes(m) || plie.includes(m))) continue;

    let score = 0;
    for (const m of mots) {
      if (titrePlie === m) score += 60;
      else if (titrePlie.startsWith(m)) score += 35;
      else if (titrePlie.includes(m)) score += 25;
      score += Math.min(10, plie.split(m).length - 1) * 2;
    }
    if (mots.length > 1 && plie.includes(mots.join(" "))) score += 20; // expression exacte
    if (page.projectId === projetCourant) score += 8;

    // Extrait autour du premier mot trouvé dans le TEXTE (le titre est déjà affiché).
    let extrait: Extrait | null = null;
    const premier = mots.map((m) => ({ m, i: plie.indexOf(m) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i)[0];
    if (premier) {
      const debut = origine[premier.i];
      const fin = origine[premier.i + premier.m.length - 1] + 1;
      const d = Math.max(0, debut - CONTEXTE);
      const f = Math.min(texte.length, fin + CONTEXTE * 2);
      extrait = {
        avant: `${d > 0 ? "…" : ""}${texte.slice(d, debut)}`,
        trouve: texte.slice(debut, fin),
        apres: `${texte.slice(fin, f)}${f < texte.length ? "…" : ""}`,
      };
    }

    const ancetres: string[] = [];
    const vus = new Set<string>();
    let parent = page.parentId ? parId.get(page.parentId) : undefined;
    while (parent && !vus.has(parent.id)) {
      vus.add(parent.id);
      ancetres.unshift(parent.title || "Sans titre");
      parent = parent.parentId ? parId.get(parent.parentId) : undefined;
    }
    const lieu = [nomsProjets.get(page.projectId) ?? "Projet", ...ancetres].join(" > ");

    resultats.push({ pageId: page.id, projectId: page.projectId, titre, lieu, extrait, score });
  }

  return resultats.sort((a, b) => b.score - a.score || a.titre.localeCompare(b.titre)).slice(0, RESULTATS_MAX);
}
