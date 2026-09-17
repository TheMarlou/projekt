import { mesurer } from "./statistiques";
import { tr } from "./i18n";

/**
 * Ce que l'assistant a le droit de faire (demande du 13/09 : « vérifier ses
 * permissions dans l'app »). Trois exigences, chacune tenue par le CODE et non
 * par la seule consigne :
 * — un panneau de réglages, avec des interrupteurs ;
 * — rien d'écrit sans validation, sauf si l'utilisateur l'autorise ici ;
 * — l'assistant sait dire ce qu'il peut faire : la liste lui est donnée telle
 *   quelle, construite à partir de ces réglages.
 *
 * Réglages communs à tous les projets, gardés sur ce PC.
 */

export type ModeReflexion = "auto" | "toujours" | "jamais";

export interface ReglagesIa {
  /** Lire les pages du projet (arborescence, pages, recherche) et joindre la page ouverte. */
  lirePages: boolean;
  /** Proposer des modifications : créer des pages, écrire, compléter la mémoire, faire une note. */
  proposerModifications: boolean;
  /** Appliquer les propositions sans les faire valider. Désactivé par défaut (choix du 13/09). */
  ecrireSansValidation: boolean;
  /** Relire la page « 🧠 Mémoire » du projet à chaque question. */
  memoireProjet: boolean;
  /** Enregistrer les conversations dans le projet, pour les retrouver. */
  enregistrerConversations: boolean;
  /** Réfléchir avant de répondre : seulement pour les questions sur le projet (équilibre), toujours, ou jamais. */
  reflexion: ModeReflexion;
}

export const REGLAGES_PAR_DEFAUT: ReglagesIa = {
  lirePages: true,
  proposerModifications: true,
  ecrireSansValidation: false,
  memoireProjet: true,
  enregistrerConversations: true,
  reflexion: "auto",
};

const CLE = "projekt-ia-reglages";
let courant: ReglagesIa = lire();
const auditeurs = new Set<() => void>();

function lire(): ReglagesIa {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) ?? "{}") as Partial<ReglagesIa>;
    const r = { ...REGLAGES_PAR_DEFAUT };
    for (const cle of Object.keys(REGLAGES_PAR_DEFAUT) as (keyof ReglagesIa)[]) {
      if (typeof brut[cle] === typeof REGLAGES_PAR_DEFAUT[cle]) (r as Record<string, unknown>)[cle] = brut[cle];
    }
    if (!["auto", "toujours", "jamais"].includes(r.reflexion)) r.reflexion = "auto";
    return r;
  } catch {
    return { ...REGLAGES_PAR_DEFAUT };
  }
}

export function reglagesIa(): ReglagesIa {
  return courant;
}

export function changerReglagesIa(modif: Partial<ReglagesIa>) {
  courant = { ...courant, ...modif };
  // Écrire sans validation n'a pas de sens si l'assistant ne peut rien proposer.
  if (!courant.proposerModifications) courant.ecrireSansValidation = false;
  try {
    localStorage.setItem(CLE, JSON.stringify(courant));
  } catch {
    // Stockage indisponible : valable pour cette session seulement.
  }
  auditeurs.forEach((a) => a());
  for (const [cle, valeur] of Object.entries(modif)) mesurer("reglage_assistant", { cle, valeur: String(valeur) });
}

export function suivreReglagesIa(auditeur: () => void): () => void {
  auditeurs.add(auditeur);
  return () => {
    auditeurs.delete(auditeur);
  };
}

/**
 * Ce que l'assistant peut et ne peut pas faire, en phrases, pour l'invite. Le
 * modèle n'a pas à deviner ses capacités : s'il en invente une, c'est une faute
 * que le banc d'essai mesure.
 */
export function capacitesPourInvite(r: ReglagesIa, rechercheWeb: boolean): string {
  const peut: string[] = [];
  const nePeutPas: string[] = [];
  (r.lirePages ? peut : nePeutPas).push("lire les pages du projet");
  if (r.proposerModifications) {
    peut.push(
      r.ecrireSansValidation
        ? "créer des pages et y écrire (les modifications s'appliquent directement)"
        : "proposer de créer des pages et d'y écrire, que l'utilisateur valide avant qu'elles s'appliquent"
    );
    peut.push("faire une note qui résume la discussion", "proposer d'ajouter une information à la mémoire du projet");
  } else {
    nePeutPas.push("créer ou modifier des pages");
  }
  (rechercheWeb ? peut : nePeutPas).push("chercher sur Wikipédia");
  nePeutPas.push("supprimer des pages", "voir les images du moodboard depuis cette conversation", "agir en dehors de Projekt");
  return `Ce que tu peux faire : ${peut.join(" ; ")}. Ce que tu ne peux pas faire : ${nePeutPas.join(" ; ")}. Si on te demande ce que tu sais faire, réponds avec cette liste, sans rien ajouter.`;
}

/** Libellés du panneau de réglages. */
export const LIBELLES_REGLAGES: { cle: Exclude<keyof ReglagesIa, "reflexion">; titre: () => string; aide: () => string }[] = [
  {
    cle: "lirePages",
    titre: () => tr("Lire les pages du projet", "Read the project's pages"),
    aide: () => tr("Sans lecture, l'assistant ne connaît rien de ton projet.", "Without reading, the assistant knows nothing about your project."),
  },
  {
    cle: "proposerModifications",
    titre: () => tr("Proposer des modifications", "Suggest changes"),
    aide: () => tr("Créer des pages, écrire, faire des notes, compléter la mémoire.", "Create pages, write, make notes, add to the memory."),
  },
  {
    cle: "ecrireSansValidation",
    titre: () => tr("Écrire sans validation", "Write without approval"),
    aide: () => tr("Les propositions s'appliquent tout de suite, sans carte à valider.", "Suggestions are applied immediately, without a card to approve."),
  },
  {
    cle: "memoireProjet",
    titre: () => tr("Mémoire du projet", "Project memory"),
    aide: () => tr("Relit la page « 🧠 Mémoire » à chaque question.", "Rereads the “🧠 Memory” page for every question."),
  },
  {
    cle: "enregistrerConversations",
    titre: () => tr("Enregistrer les conversations", "Save conversations"),
    aide: () => tr("Pour les retrouver plus tard, dans ce projet.", "To find them again later, in this project."),
  },
];
