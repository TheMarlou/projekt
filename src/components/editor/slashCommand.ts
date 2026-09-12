import { Extension, type Editor, type Range } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { requestAudio, requestImage, requestLink, requestMention, requestSubPage } from "./editorEvents";
import { tr } from "../../lib/i18n";

function sansAccent(texte: string): string {
  return texte.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export interface SlashItem {
  label: string;
  hint: string;
  run: (editor: Editor, range: Range) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    label: tr("Texte", "Text"),
    hint: tr("Paragraphe simple", "Plain paragraph"),
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    label: tr("Titre 1", "Heading 1"),
    hint: tr("Grand titre de section", "Large section heading"),
    run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run(),
  },
  {
    label: tr("Titre 2", "Heading 2"),
    hint: tr("Sous-titre", "Subheading"),
    run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run(),
  },
  {
    label: tr("Titre 3", "Heading 3"),
    hint: tr("Sous-sous-titre", "Smaller subheading"),
    run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run(),
  },
  {
    label: tr("Liste à puces", "Bulleted list"),
    hint: tr("Liste non ordonnée", "Unordered list"),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    label: tr("Liste numérotée", "Numbered list"),
    hint: tr("Liste ordonnée", "Ordered list"),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    label: tr("Cases à cocher", "Checkboxes"),
    hint: tr("Liste de tâches — Ctrl+Maj+9", "Task list — Ctrl+Shift+9"),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    label: tr("Citation", "Quote"),
    hint: tr("Bloc de citation", "Quote block"),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    label: tr("Bloc de code", "Code block"),
    hint: tr("Code monospace", "Monospaced code"),
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    label: tr("Tableau", "Table"),
    hint: tr("Tableau 3×3 avec en-têtes", "3×3 table with headers"),
    run: (e, r) =>
      e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    label: tr("Surlignage", "Highlight"),
    hint: tr("Surligner en jaune", "Highlight in yellow"),
    run: (e, r) => e.chain().focus().deleteRange(r).setHighlight({ color: "#f0c04a59" }).run(),
  },
  {
    label: tr("Sous-page", "Sub-page"),
    hint: tr("Crée une page fille ici", "Creates a child page here"),
    // La création appartient à la vue, qui seule connaît la page courante.
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestSubPage();
    },
  },
  {
    label: tr("Mention de page", "Page mention"),
    hint: tr("Citer une page existante", "Refer to an existing page"),
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestMention();
    },
  },
  {
    label: tr("Lien", "Link"),
    hint: tr("Insérer une URL — Ctrl+K", "Insert a URL — Ctrl+K"),
    // La saisie de l'URL appartient à la barre d'outils : on efface le « / »
    // puis on lui passe la main, sinon le texte de commande resterait dans la page.
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestLink();
    },
  },
  {
    label: "Image",
    hint: tr("Depuis un fichier local", "From a local file"),
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestImage();
    },
  },
  {
    label: tr("Fichier audio", "Audio file"),
    hint: tr("Son, musique, voix — lisible dans la page", "Sound, music, voice — playable in the page"),
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestAudio();
    },
  },
  {
    label: tr("Séparateur", "Divider"),
    hint: tr("Trait horizontal", "Horizontal line"),
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
];

export interface SlashMenuSnapshot {
  items: SlashItem[];
  index: number;
  rect: DOMRect | null;
  /** Applique un item — utilisé par le clic souris, le clavier étant géré ici. */
  select: (item: SlashItem) => void;
}

// Le menu slash vit dans ProseMirror (détection du "/", filtrage, navigation clavier)
// et pousse un instantané à React, qui n'a plus qu'à dessiner la liste.
export function createSlashCommand(onChange: (snapshot: SlashMenuSnapshot | null) => void) {
  return Extension.create({
    name: "slashCommand",

    addProseMirrorPlugins() {
      let items: SlashItem[] = [];
      let index = 0;
      let rect: DOMRect | null = null;
      let select: ((item: SlashItem) => void) | null = null;

      const push = () =>
        onChange(select ? { items, index, rect, select: (item) => select?.(item) } : null);

      return [
        Suggestion({
          editor: this.editor,
          char: "/",
          allowSpaces: false,
          startOfLine: false,
          // Par défaut le déclencheur n'est reconnu qu'en début de ligne ou après
          // un espace ; on l'autorise partout, y compris collé au texte précédent.
          allowedPrefixes: null,
          // Sans accents des deux côtés : « /separateur » doit trouver « Séparateur »,
          // on tape rarement les accents dans une commande.
          items: ({ query }) =>
            SLASH_ITEMS.filter((item) => sansAccent(item.label).includes(sansAccent(query))),
          command: ({ editor, range, props }) => (props as SlashItem).run(editor, range),
          render: () => ({
            onStart: (props) => {
              items = props.items as SlashItem[];
              index = 0;
              rect = props.clientRect?.() ?? null;
              select = (item) => props.command(item);
              push();
            },
            onUpdate: (props) => {
              items = props.items as SlashItem[];
              index = 0;
              rect = props.clientRect?.() ?? null;
              select = (item) => props.command(item);
              push();
            },
            onKeyDown: ({ event }) => {
              if (!select || items.length === 0) return false;
              if (event.key === "ArrowDown") {
                index = (index + 1) % items.length;
                push();
                return true;
              }
              if (event.key === "ArrowUp") {
                index = (index - 1 + items.length) % items.length;
                push();
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                select(items[index]);
                return true;
            }
              if (event.key === "Escape") {
                select = null;
                push();
                return true;
              }
              return false;
            },
            onExit: () => {
              select = null;
              push();
            },
          }),
        }),
      ];
    },
  });
}
