import { useMemoireStore, type EntreeMemoire } from "../store/memoireStore";
import { tr } from "./i18n";

/**
 * Mémoire du projet (demande du 13/09) : À PART des pages, ouverte par le bouton
 * 🧠 du panneau de l'assistant, comme ses réglages. L'assistant la relit à chaque
 * question. Il ne l'écrit jamais seul : il propose d'y ajouter une ligne
 * (« retiens que… », bouton « Retenir »), et l'utilisateur valide.
 *
 * Quatre rubriques, choisies par l'utilisateur : résumé du projet, décisions
 * prises, préférences, idées écartées.
 */

export type Rubrique = "resume" | "decision" | "preference" | "idee_ecartee";

export const RUBRIQUES: Rubrique[] = ["resume", "decision", "preference", "idee_ecartee"];

const TITRES_RUBRIQUES: Record<Rubrique, [string, string]> = {
  resume: ["Résumé du projet", "Project summary"],
  decision: ["Décisions prises", "Decisions made"],
  preference: ["Préférences", "Preferences"],
  idee_ecartee: ["Idées écartées", "Rejected ideas"],
};

export function titreMemoire(): string {
  return tr("🧠 Mémoire", "🧠 Memory");
}

export function titreRubrique(r: Rubrique): string {
  return tr(...TITRES_RUBRIQUES[r]);
}

export function entreesMemoire(projectId: string | null): EntreeMemoire[] {
  if (!projectId) return [];
  return useMemoireStore.getState().entrees.filter((e) => e.projectId === projectId);
}

/** Le contenu de la mémoire pour l'invite, plafonné (la carte graphique de 6 Go compte chaque caractère). */
export function texteMemoire(projectId: string | null, max = 1500): string | null {
  const entrees = entreesMemoire(projectId);
  if (!entrees.length) return null;
  const md = RUBRIQUES.map((r) => {
    const lignes = entrees.filter((e) => e.rubrique === r);
    return lignes.length ? `## ${titreRubrique(r)}\n${lignes.map((e) => `- ${e.texte}`).join("\n")}` : "";
  })
    .filter(Boolean)
    .join("\n");
  return md.length > max ? `${md.slice(0, max)}\n[… mémoire tronquée]` : md;
}

const plier = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Ajoute une ligne sous la rubrique voulue ; une ligne déjà présente n'est pas doublée. */
export function ajouterALaMemoire(projectId: string, rubrique: Rubrique, texte: string): string | null {
  const propre = texte.trim();
  if (!propre) return tr("rien à retenir", "nothing to remember");
  const doublon = entreesMemoire(projectId).some((e) => e.rubrique === rubrique && plier(e.texte) === plier(propre));
  if (!doublon) useMemoireStore.getState().ajouter(projectId, rubrique, propre);
  return null;
}
