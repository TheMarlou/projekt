import { CSSProperties, useCallback, useEffect, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import { Block } from "../../store/blocksStore";
import ConfirmDialog from "../editor/ConfirmDialog";
import ContextMenu from "../editor/ContextMenu";
import {
  DELETE_PAGE_EVENT,
  MENTION_REQUEST_EVENT,
  OPEN_PAGE_EVENT,
  SUBPAGE_REQUEST_EVENT,
  requestAudio,
  requestImage,
  requestLink,
  requestMention,
  requestSubPage,
} from "../editor/editorEvents";
import FormatToolbar from "../editor/FormatToolbar";
import InlineAi from "../editor/InlineAi";
import { setCurrentPageId } from "../editor/PageLink";
import PagePicker from "../editor/PagePicker";
import RichTextBlock from "../editor/RichTextBlock";

interface NotesViewProps {
  page: Block | null;
  projectId: string | null;
  /** Toutes les pages du projet : sert à décrire ce qu'une suppression emporte. */
  pages: Block[];
  onTitleChange: (title: string) => void;
  onTextChange: (contentId: string, doc: JSONContent) => void;
  onAddText: () => void;
  /** Crée une sous-page SANS y naviguer, et renvoie son identifiant. */
  onCreateChildPage: () => string | null;
  onDeletePage: (id: string) => void;
  onOpenPage: (id: string) => void;
  onCreateRootPage: () => void;
}

/** Retire du document toutes les références à une page donnée. */
function removePageLinks(editor: Editor, pageId: string) {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "pageLink" && node.attrs.pageId === pageId) positions.push(pos);
  });
  if (positions.length === 0) return;
  const tr = editor.state.tr;
  // De la fin vers le début : supprimer en avançant décalerait les positions suivantes.
  for (const pos of positions.reverse()) tr.delete(pos, pos + 1);
  editor.view.dispatch(tr);
}

export default function NotesView({
  page,
  projectId,
  pages,
  onTitleChange,
  onTextChange,
  onAddText,
  onCreateChildPage,
  onDeletePage,
  onOpenPage,
  onCreateRootPage,
}: NotesViewProps) {
  // La barre d'outils est unique alors que la page contient plusieurs éditeurs :
  // elle doit savoir lequel piloter. Chaque bloc se signale en prenant le focus.
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);

  const handleActivate = useCallback((editor: Editor, reason: "focus" | "ready") => {
    // « ready » ne s'impose que si aucun bloc n'est encore actif, pour que la barre
    // soit utilisable dès l'ouverture sans voler la cible au bloc en cours d'édition.
    setActiveEditor((current) => (reason === "focus" || !current ? editor : current));
  }, []);

  const handleDeactivate = useCallback((editor: Editor) => {
    setActiveEditor((current) => (current === editor ? null : current));
  }, []);

  // Une sous-page se crée là où est le curseur : on fabrique la page, puis on
  // insère sa référence dans le texte. On reste sur la page parente, comme Notion.
  useEffect(() => {
    const onSubPage = () => {
      if (!activeEditor) return;
      const id = onCreateChildPage();
      if (id) activeEditor.chain().focus().insertPageLink(id).run();
    };
    const onMention = () => activeEditor && setMentionOpen(true);
    const onOpen = (e: Event) => onOpenPage((e as CustomEvent<string>).detail);
    const onDelete = (e: Event) => setPendingDelete((e as CustomEvent<string>).detail);

    window.addEventListener(SUBPAGE_REQUEST_EVENT, onSubPage);
    window.addEventListener(MENTION_REQUEST_EVENT, onMention);
    window.addEventListener(OPEN_PAGE_EVENT, onOpen);
    window.addEventListener(DELETE_PAGE_EVENT, onDelete);
    return () => {
      window.removeEventListener(SUBPAGE_REQUEST_EVENT, onSubPage);
      window.removeEventListener(MENTION_REQUEST_EVENT, onMention);
      window.removeEventListener(OPEN_PAGE_EVENT, onOpen);
      window.removeEventListener(DELETE_PAGE_EVENT, onDelete);
    };
  }, [activeEditor, onCreateChildPage, onOpenPage]);

  // Les puces ont besoin de savoir dans quelle page elles s'affichent pour
  // distinguer une sous-page (leur fille) d'une simple mention.
  useEffect(() => {
    setCurrentPageId(page?.id ?? null);
    return () => setCurrentPageId(null);
  }, [page?.id]);

  const target = pendingDelete ? pages.find((p) => p.id === pendingDelete) ?? null : null;
  const descendants = countDescendants(pages, pendingDelete);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (activeEditor) removePageLinks(activeEditor, pendingDelete);
    onDeletePage(pendingDelete);
    setPendingDelete(null);
  };

  if (!page) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          color: "var(--text-dim)",
        }}
      >
        <p style={{ margin: 0 }}>
          {pages.length === 0
            ? "Ce projet n'a pas encore de page."
            : "Aucune page ouverte — choisis-en une dans la colonne de gauche."}
        </p>
        <button
          onClick={onCreateRootPage}
          style={{
            padding: "7px 14px",
            borderRadius: 6,
            border: "1px solid var(--accent)",
            background: "var(--accent-soft)",
            color: "var(--accent)",
            fontSize: 13,
          }}
        >
          + Créer une page
        </button>
      </div>
    );
  }

  return (
    <div
      style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <FormatToolbar editor={activeEditor} projectId={projectId} />
      <InlineAi editor={activeEditor} titrePage={page.title} />
      <div className="scroll" style={{ flex: 1, padding: "28px 56px 80px", maxWidth: 760 }}>
        <input
          value={page.title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Titre de la page"
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: 26,
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 18,
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {page.content.map((block) => (
            <RichTextBlock
              key={block.id}
              doc={block.doc}
              onChange={(d) => onTextChange(block.id, d)}
              projectId={projectId}
              onActivate={handleActivate}
              onDeactivate={handleDeactivate}
            />
          ))}
        </div>

        {/* L'astuce ne s'affiche que sur une page vide : c'est le seul moment où
            quelqu'un lit vraiment l'interface, et elle deviendrait du bruit ensuite. */}
        {estVide(page) && (
          <div style={hintStyle}>
            Clic droit n'importe où pour insérer une sous-page, une mention, une image, un tableau ou un lien — ou tape
            « / » directement dans le texte. Ctrl+Espace appelle l'IA à l'endroit du curseur.
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          groups={[
            {
              caption: "Insérer ici",
              entries: [
                {
                  label: "Sous-page",
                  hint: "/page",
                  disabled: !activeEditor,
                  run: requestSubPage,
                },
                {
                  label: "Mention de page",
                  hint: "/mention",
                  disabled: !activeEditor,
                  run: requestMention,
                },
                { label: "Hyperlien", hint: "Ctrl+K", disabled: !activeEditor, run: requestLink },
                { label: "Image", disabled: !activeEditor, run: requestImage },
                { label: "Fichier audio", hint: "/audio", disabled: !activeEditor, run: requestAudio },
                {
                  label: "Cases à cocher",
                  hint: "Ctrl+Maj+9",
                  disabled: !activeEditor,
                  run: () => activeEditor?.chain().focus().toggleTaskList().run(),
                },
                {
                  label: "Tableau",
                  disabled: !activeEditor,
                  run: () =>
                    activeEditor
                      ?.chain()
                      .focus()
                      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                      .run(),
                },
                {
                  label: "Séparateur",
                  disabled: !activeEditor,
                  run: () => activeEditor?.chain().focus().setHorizontalRule().run(),
                },
              ],
            },
            {
              caption: "Ajouter à la page",
              entries: [{ label: "Bloc de texte", run: onAddText }],
            },
          ]}
        />
      )}

      {mentionOpen && (
        <PagePicker
          pages={pages}
          excludeId={page.id}
          onCancel={() => setMentionOpen(false)}
          onPick={(id) => {
            setMentionOpen(false);
            activeEditor?.chain().focus().insertPageLink(id).run();
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Supprimer la sous-page « ${target?.title?.trim() || "Sans titre"} » ?`}
          body={
            <>
              {descendants > 0 && (
                <>
                  Elle contient {descendants} sous-page{descendants > 1 ? "s" : ""}, qui ser
                  {descendants > 1 ? "ont" : "a"} supprimée{descendants > 1 ? "s" : ""} aussi.{" "}
                </>
              )}
              Son contenu sera perdu. Cette action est définitive.
            </>
          }
          confirmLabel="Supprimer"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

/**
 * Une page est vide si aucun de ses blocs ne contient autre chose que des
 * paragraphes sans texte. On regarde les nœuds et pas le texte seul : une page
 * qui ne porte qu'une image ou qu'un tableau n'a plus rien à apprendre.
 */
function estVide(page: Block): boolean {
  return !page.content.some((bloc) =>
    (bloc.doc.content ?? []).some(
      (noeud) => noeud.type !== "paragraph" || (noeud.content?.length ?? 0) > 0
    )
  );
}

/** Nombre de pages sous une page donnée, à toute profondeur. */
function countDescendants(pages: Block[], id: string | null): number {
  if (!id) return 0;
  const children = pages.filter((p) => p.parentId === id);
  return children.reduce((total, child) => total + 1 + countDescendants(pages, child.id), 0);
}

const hintStyle: CSSProperties = {
  marginTop: 14,
  fontSize: 12,
  color: "var(--text-dim)",
  fontStyle: "italic",
};

