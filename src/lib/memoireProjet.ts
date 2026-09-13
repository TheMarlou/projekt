import type { JSONContent } from "@tiptap/react";
import { useBlocksStore, type Block } from "../store/blocksStore";
import { docToMarkdown } from "./markdown";
import { tr } from "./i18n";

/**
 * Mémoire du projet (demande du 13/09) : une VRAIE page, visible et modifiable à
 * la main, que l'assistant relit à chaque question. Il ne l'écrit jamais seul :
 * il propose d'y ajouter une ligne (« retiens que… », bouton « Retenir »), et
 * l'utilisateur valide.
 *
 * Quatre rubriques, choisies par l'utilisateur : résumé du projet, décisions
 * prises, préférences, idées écartées.
 */

export type Rubrique = "resume" | "decision" | "preference" | "idee_ecartee";

export const RUBRIQUES: Rubrique[] = ["resume", "decision", "preference", "idee_ecartee"];

// La page est retrouvée sous son nom français OU anglais : changer la langue de
// l'app ne doit pas faire perdre la mémoire.
const TITRES_MEMOIRE = ["🧠 Mémoire", "🧠 Memory"];

const TITRES_RUBRIQUES: Record<Rubrique, [string, string]> = {
  resume: ["Résumé du projet", "Project summary"],
  decision: ["Décisions prises", "Decisions made"],
  preference: ["Préférences", "Preferences"],
  idee_ecartee: ["Idées écartées", "Rejected ideas"],
};

export function titreMemoire(): string {
  return tr(TITRES_MEMOIRE[0], TITRES_MEMOIRE[1]);
}

export function titreRubrique(r: Rubrique): string {
  return tr(...TITRES_RUBRIQUES[r]);
}

export function pageMemoire(projectId: string | null): Block | null {
  if (!projectId) return null;
  return (
    useBlocksStore
      .getState()
      .blocks.find((b) => b.projectId === projectId && !b.parentId && TITRES_MEMOIRE.includes(b.title.trim())) ?? null
  );
}

/** Le contenu de la mémoire pour l'invite, plafonné (la carte graphique de 6 Go compte chaque caractère). */
export function texteMemoire(projectId: string | null, max = 1500): string | null {
  const page = pageMemoire(projectId);
  if (!page) return null;
  const md = page.content
    .map((c) => docToMarkdown(c.doc, { pageFile: () => null, pageTitle: () => null, assetFile: () => null }))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  // Une mémoire qui ne contient que ses titres de rubriques ne dit rien.
  const utile = md.replace(/^#+ .*$/gm, "").replace(/^_.*_$/gm, "").trim();
  if (!utile) return null;
  return md.length > max ? `${md.slice(0, max)}\n[… mémoire tronquée]` : md;
}

function titre(niveau: number, texte: string): JSONContent {
  return { type: "heading", attrs: { level: niveau }, content: [{ type: "text", text: texte }] };
}

function docVierge(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            marks: [{ type: "italic" }],
            text: tr(
              "Ce que l'assistant retient de ce projet. Il relit cette page à chaque question ; tu peux la modifier librement.",
              "What the assistant remembers about this project. It rereads this page for every question; edit it freely."
            ),
          },
        ],
      },
      ...RUBRIQUES.flatMap((r) => [titre(2, titreRubrique(r)), { type: "paragraph" }]),
    ],
  };
}

/** Crée la page mémoire si elle n'existe pas, et renvoie son identifiant. */
export function assurerPageMemoire(projectId: string): string {
  const existante = pageMemoire(projectId);
  if (existante) return existante.id;
  const store = useBlocksStore.getState();
  const id = store.addBlock(projectId, null);
  store.updateTitle(id, titreMemoire());
  const page = useBlocksStore.getState().blocks.find((b) => b.id === id)!;
  store.updateTextDoc(id, page.content[0].id, docVierge());
  return id;
}

const plier = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function texteDe(noeud: JSONContent): string {
  return (noeud.text ?? "") + (noeud.content ?? []).map(texteDe).join("");
}

/**
 * Ajoute une ligne à puce SOUS la rubrique voulue (et non en fin de page). Une
 * rubrique supprimée à la main est recréée en fin de page.
 */
export function ajouterALaMemoire(projectId: string, rubrique: Rubrique, texte: string): string | null {
  const id = assurerPageMemoire(projectId);
  const page = useBlocksStore.getState().blocks.find((b) => b.id === id);
  if (!page) return tr("la page mémoire a disparu", "the memory page has disappeared");
  const bloc = page.content[0];
  const noeuds = [...(bloc.doc.content ?? [])];
  const cibles = TITRES_RUBRIQUES[rubrique].map(plier);
  const item: JSONContent = { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: texte.trim() }] }] };

  let debut = noeuds.findIndex((n) => n.type === "heading" && cibles.includes(plier(texteDe(n))));
  if (debut < 0) {
    noeuds.push(titre(2, titreRubrique(rubrique)));
    debut = noeuds.length - 1;
  }
  let fin = noeuds.findIndex((n, i) => i > debut && n.type === "heading");
  if (fin < 0) fin = noeuds.length;

  // Une liste existe déjà dans la rubrique : on la prolonge.
  let i = -1;
  for (let k = fin - 1; k > debut; k--) {
    if (noeuds[k].type === "bulletList") {
      i = k;
      break;
    }
  }
  if (i >= 0) {
    noeuds[i] = { ...noeuds[i], content: [...(noeuds[i].content ?? []), item] };
  } else {
    // Le paragraphe vide laissé sous le titre à la création est remplacé.
    const vide = noeuds[debut + 1]?.type === "paragraph" && !(noeuds[debut + 1].content?.length ?? 0);
    noeuds.splice(debut + 1, vide ? 1 : 0, { type: "bulletList", content: [item] });
  }
  useBlocksStore.getState().updateTextDoc(id, bloc.id, { ...bloc.doc, content: noeuds });
  return null;
}
