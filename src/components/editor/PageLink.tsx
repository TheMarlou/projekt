import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useBlocksStore } from "../../store/blocksStore";
import { requestDeletePage, requestOpenPage } from "./editorEvents";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageLink: {
      /** Insère une référence vers une page existante à la position du curseur. */
      insertPageLink: (pageId: string) => ReturnType;
    };
  }
}

// La puce doit savoir si la page citée est SA fille (sous-page) ou une page qui
// vit ailleurs (mention) : la croix ne propose pas la même chose dans les deux cas.
// L'éditeur ne connaît pas la page qui l'affiche, la vue la lui dépose ici.
let currentPageId: string | null = null;

export function setCurrentPageId(id: string | null) {
  currentPageId = id;
}

function isChildOfCurrentPage(parentId: string | null | undefined): boolean {
  return !!currentPageId && parentId === currentPageId;
}

function PageLinkView({ node, selected, deleteNode }: NodeViewProps) {
  const pageId = node.attrs.pageId as string;
  // Le titre n'est PAS stocké dans le document : on le lit dans le store à
  // l'affichage. C'est ce qui fait qu'un renommage se propage partout tout seul.
  const page = useBlocksStore((s) => s.blocks.find((b) => b.id === pageId));
  const title = page?.title?.trim() || "Sans titre";
  const isSubPage = isChildOfCurrentPage(page?.parentId);

  return (
    <NodeViewWrapper
      as="span"
      className="pk-pagelink"
      data-selected={selected ? "true" : undefined}
      data-kind={isSubPage ? "sous-page" : "mention"}
      // Sans cette marque, `draggable: true` ne suffit pas : dans une vue React,
      // Tiptap n'arme le glissement que sur l'élément désigné comme poignée.
      data-drag-handle
    >
      {page ? (
        <>
          <span
            className="pk-pagelink-open"
            onClick={() => requestOpenPage(pageId)}
            title={isSubPage ? "Ouvrir la sous-page" : "Ouvrir la page mentionnée"}
          >
            <span className="pk-pagelink-icon">{isSubPage ? "▤" : "↗"}</span>
            {title}
          </span>
          <button
            className="pk-pagelink-remove"
            title={isSubPage ? "Supprimer cette sous-page" : "Retirer cette mention"}
            onMouseDown={(e) => e.preventDefault()}
            // Une mention ne possède pas la page : on ne retire que la référence.
            onClick={() => (isSubPage ? requestDeletePage(pageId) : deleteNode())}
          >
            ✕
          </button>
        </>
      ) : (
        <span className="pk-pagelink-missing" title="Cette page n'existe plus">
          ▤ Page supprimée
        </span>
      )}
    </NodeViewWrapper>
  );
}

export const PageLink = Node.create({
  name: "pageLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  // Glisser la puce la déplace dans le texte, au lieu d'obliger à refaire la
  // sous-page ailleurs.
  draggable: true,

  addAttributes() {
    return {
      // On ne garde que l'identifiant : tout le reste (titre, filiation, existence)
      // se déduit du store, donc rien ne peut se désynchroniser dans le document.
      pageId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-page-id"),
        renderHTML: (attributes) => ({ "data-page-id": attributes.pageId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-page-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "pk-pagelink" })];
  },

  addCommands() {
    return {
      insertPageLink:
        (pageId: string) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: { pageId } },
            { type: "text", text: " " },
          ]),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView);
  },

  addKeyboardShortcuts() {
    // Effacer une SOUS-PAGE au clavier ne doit pas emporter la page en silence :
    // on intercepte et on passe par la même confirmation que la croix. Une simple
    // mention, elle, se supprime normalement — la page citée n'est pas concernée.
    const guard = () => {
      const { state } = this.editor;
      const { empty, from } = state.selection;
      const target = empty ? state.doc.nodeAt(from - 1) : state.doc.nodeAt(from);
      if (target?.type.name !== this.name) return false;

      const pageId = target.attrs.pageId as string;
      const page = useBlocksStore.getState().blocks.find((b) => b.id === pageId);
      if (!isChildOfCurrentPage(page?.parentId)) return false;

      requestDeletePage(pageId);
      return true;
    };
    return { Backspace: guard, Delete: guard };
  },
});
