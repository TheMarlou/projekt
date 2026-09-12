import { useEffect, useRef, useState } from "react";
import { EditorContent, Extension, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import TextAlign from "@tiptap/extension-text-align";
import { FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { openExternal } from "../../lib/external";
import { estIaInlineOuverte, requestInlineAi, requestLink } from "./editorEvents";
import { TextSelection } from "@tiptap/pm/state";
import { AudioClip, insertAudioFile, isAudioFile } from "./AudioClip";
import { PageLink } from "./PageLink";
import { ProjektImage, insertImageFile } from "./ProjektImage";
import { createSlashCommand, type SlashMenuSnapshot } from "./slashCommand";
import { BlockLayout } from "./blockLayout";
import { tr } from "../../lib/i18n";

// Raccourcis que StarterKit ne fournit pas. Ctrl+K n'agit pas directement :
// il demande à la barre d'outils d'ouvrir son champ d'URL, seul endroit où
// l'utilisateur peut saisir l'adresse.
const ProjektShortcuts = Extension.create({
  name: "projektShortcuts",
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        requestLink();
        return true;
      },
      "Mod-Shift-9": () => this.editor.chain().focus().toggleTaskList().run(),
      // L'IA au curseur, comme dans Notion. Ctrl+Espace marche partout, avec ou
      // sans sélection.
      "Mod-Space": () => {
        requestInlineAi();
        return true;
      },
      // Espace sur une ligne vide l'ouvre aussi — mais seulement pour un
      // paragraphe de premier niveau : dans une liste, une cellule ou une
      // citation, une espace en début de ligne reste une espace.
      Space: () => {
        const { selection } = this.editor.state;
        const { $from, empty } = selection;
        const ligneVide = empty && $from.depth === 1 && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;
        if (!ligneVide) return false;
        requestInlineAi();
        return true;
      },
    };
  },
});

/** Ce qu'un collage ou un dépôt sait insérer : images et sons. */
function estInserable(fichier: File): boolean {
  return fichier.type.startsWith("image/") || isAudioFile(fichier);
}

/**
 * Insère TOUS les fichiers déposés, dans l'ordre — un dépôt de plusieurs images
 * n'en gardait auparavant que la première. Séquentiel à dessein : chaque
 * insertion déplace le curseur après la précédente.
 */
async function insererFichiers(editor: Editor, projectId: string | null, fichiers: File[]) {
  for (const fichier of fichiers) {
    if (fichier.type.startsWith("image/")) await insertImageFile(editor, projectId, fichier);
    else if (isAudioFile(fichier)) await insertAudioFile(editor, projectId, fichier);
  }
}

interface RichTextBlockProps {
  doc: JSONContent;
  onChange: (doc: JSONContent) => void;
  /** Projet courant : les images collées sont écrites dans ses assets. */
  projectId?: string | null;
  /** Signale à la vue parente quel éditeur la barre d'outils doit piloter. */
  onActivate?: (editor: Editor, reason: "focus" | "ready") => void;
  onDeactivate?: (editor: Editor) => void;
}

export default function RichTextBlock({
  doc,
  onChange,
  projectId = null,
  onActivate,
  onDeactivate,
}: RichTextBlockProps) {
  const [slash, setSlash] = useState<SlashMenuSnapshot | null>(null);
  // Mémorise ce qu'on a nous-même émis, pour distinguer une modif externe
  // (écriture par l'IA) d'un simple écho de notre propre frappe.
  const lastEmitted = useRef<string>(JSON.stringify(doc));
  // Les callbacks changent d'identité à chaque rendu du parent ; on les lit via
  // une ref pour ne pas reconstruire l'éditeur (ce qui perdrait le curseur).
  const hooks = useRef({ onActivate, onDeactivate, projectId });
  hooks.current = { onActivate, onDeactivate, projectId };
  // Les callbacks de ProseMirror ne reçoivent pas l'éditeur : on le garde sous la main.
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Suivre le lien détruirait la webview ; l'ouverture passe par le système.
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      Placeholder.configure({
        placeholder: tr("Écris ici. « / » pour insérer un élément, Espace pour demander à l'IA…", "Write here. “/” to insert an element, Space to ask the AI…"),
      }),
      // `allowTableNodeSelection` est indispensable à la poignée de déplacement :
      // sans lui, l’extension convertit aussitôt la sélection du tableau en
      // sélection de cellules, et ProseMirror n’a plus de nœud à déplacer.
      TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true } }),
      BlockLayout,
      Highlight.configure({ multicolor: true }),
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ProjektImage,
      PageLink,
      AudioClip,
      ProjektShortcuts,
      createSlashCommand(setSlash),
    ],
    content: doc,
    editorProps: {
      handleClickOn: (_view, _pos, _node, _nodePos, event) => {
        // Ctrl+clic ouvre le lien : le clic simple reste réservé à l'édition.
        const target = (event.target as HTMLElement | null)?.closest("a");
        const href = target?.getAttribute("href");
        if (!href || !(event.ctrlKey || event.metaKey)) return false;
        void openExternal(href);
        return true;
      },
      handlePaste: (_view, event) => {
        const fichiers = Array.from(event.clipboardData?.files ?? []);
        if (!editorRef.current || !fichiers.some(estInserable)) return false;
        event.preventDefault();
        void insererFichiers(editorRef.current, hooks.current.projectId, fichiers);
        return true;
      },
      handleDrop: (view, event) => {
        const fichiers = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (!editorRef.current || !fichiers.some(estInserable)) return false;
        event.preventDefault();
        // Le fichier arrive là où on le lâche, pas là où était le curseur.
        const cible = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (cible) {
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(cible.pos))));
        }
        void insererFichiers(editorRef.current, hooks.current.projectId, fichiers);
        return true;
      },
    },
    onFocus: ({ editor }) => hooks.current.onActivate?.(editor, "focus"),
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      lastEmitted.current = JSON.stringify(json);
      onChange(json);
    },
  });

  editorRef.current = editor;

  // Enregistrement auprès de la barre d'outils. Passer par un effet plutôt que par
  // le `onCreate` de Tiptap : celui-ci se déclenche pendant le rendu du bloc, donc
  // trop tôt pour que la vue parente accepte la mise à jour d'état.
  useEffect(() => {
    if (!editor) return;
    hooks.current.onActivate?.(editor, "ready");
    return () => hooks.current.onDeactivate?.(editor);
  }, [editor]);

  // Resynchronise si le document change en dehors de l'éditeur (ex. l'assistant IA
  // écrit dans la page). Notre propre frappe revient ici en écho : on la reconnaît
  // à `lastEmitted` et on l'ignore.
  //
  // Auparavant, un éditeur qui avait le focus IGNORAIT la modification extérieure,
  // et la frappe suivante réécrivait l'ancienne version par-dessus : l'ajout de
  // l'IA disparaissait. On l'applique désormais toujours, en rendant au curseur sa
  // place — l'IA ajoute en fin de page, les positions avant elle ne bougent pas.
  useEffect(() => {
    if (!editor) return;
    const incoming = JSON.stringify(doc);
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;

    const avaitFocus = editor.isFocused;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(doc, { emitUpdate: false });
    if (avaitFocus) {
      const max = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
    }
  }, [doc, editor]);

  if (!editor) return null;

  return (
    <div style={{ position: "relative" }}>
      {/* Sur une image sélectionnée, la bulle de mise en forme du texte n'a rien à
          proposer et recouvrirait la barre de l'image. */}
      <BubbleMenu editor={editor} shouldShow={({ editor, from, to }) => from !== to && !editor.isActive("image") && !estIaInlineOuverte()}>
        <div style={bubbleStyle}>
          <>
              <FormatButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label={tr("G", "B")} bold />
              <FormatButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label="I" italic />
              <FormatButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} label={tr("S", "U")} underline />
              <FormatButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} label="S" strike />
              <FormatButton active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight({ color: "#f0c04a59" }).run()} label="A" highlight />
              <FormatButton
                active={editor.isActive("link")}
                onClick={requestLink}
                label="🔗"
              />
              <Separator />
              <FormatButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="H1" />
              <FormatButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="H2" />
              <FormatButton active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="H3" />
              <Separator />
              <FormatButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} label="•" />
              <FormatButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="1." />
              <FormatButton active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} label="☑" />
              <FormatButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="❝" />
              <FormatButton active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} label="{ }" />
              <Separator />
              {/* Une seule entrée : la fenêtre d'IA propose toutes les actions sur la
                  sélection, avec un aperçu à valider — auparavant ces boutons
                  remplaçaient le texte directement. */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => requestInlineAi()}
                style={aiButtonStyle}
                title={tr("Réécrire, raccourcir, structurer… avec aperçu — Ctrl+Espace", "Rewrite, shorten, structure… with a preview — Ctrl+Space")}
              >
                ✦ IA
              </button>
          </>
        </div>
      </BubbleMenu>

      <EditorContent editor={editor} className="rich-text" />

      {slash && slash.items.length > 0 && slash.rect && (
        <div
          style={{
            position: "fixed",
            top: slash.rect.bottom + 6,
            left: slash.rect.left,
            zIndex: 60,
            width: 240,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 12px 28px rgba(0,0,0,0.35)",
            padding: 4,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {slash.items.map((item, i) => (
            <div
              key={item.label}
              // mousedown plutôt que click : évite que l'éditeur perde le focus
              // (et donc la position du curseur) avant l'insertion.
              onMouseDown={(e) => {
                e.preventDefault();
                slash.select(item);
              }}
              style={{
                padding: "6px 9px",
                borderRadius: 5,
                background: i === slash.index ? "var(--accent-soft)" : "transparent",
                color: i === slash.index ? "var(--accent)" : "var(--text)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {item.label}
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{item.hint}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const bubbleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 3,
  boxShadow: "0 6px 16px rgba(0,0,0,0.3)",
};

const aiButtonStyle: React.CSSProperties = {
  fontSize: 11.5,
  padding: "3px 8px",
  borderRadius: 4,
  border: "none",
  background: "transparent",
  color: "var(--text-dim)",
  whiteSpace: "nowrap",
};

function Separator() {
  return <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "2px 3px" }} />;
}

function FormatButton({
  active,
  onClick,
  label,
  bold,
  italic,
  underline,
  strike,
  highlight,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        minWidth: 26,
        fontSize: 12,
        padding: "3px 6px",
        borderRadius: 4,
        border: "none",
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-dim)",
        fontWeight: bold ? 700 : 500,
        fontStyle: italic ? "italic" : "normal",
        textDecoration: underline ? "underline" : strike ? "line-through" : "none",
        borderBottom: highlight ? "3px solid #f0c04a" : undefined,
      }}
    >
      {label}
    </button>
  );
}
