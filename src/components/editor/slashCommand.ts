import { Extension, type Editor, type Range } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { requestAudio, requestImage, requestLink, requestMention, requestSubPage } from "./editorEvents";

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
    label: "Texte",
    hint: "Paragraphe simple",
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    label: "Titre 1",
    hint: "Grand titre de section",
    run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run(),
  },
  {
    label: "Titre 2",
    hint: "Sous-titre",
    run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run(),
  },
  {
    label: "Titre 3",
    hint: "Sous-sous-titre",
    run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run(),
  },
  {
    label: "Liste à puces",
    hint: "Liste non ordonnée",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    label: "Liste numérotée",
    hint: "Liste ordonnée",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    label: "Cases à cocher",
    hint: "Liste de tâches — Ctrl+Maj+9",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    label: "Citation",
    hint: "Bloc de citation",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    label: "Bloc de code",
    hint: "Code monospace",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    label: "Tableau",
    hint: "Tableau 3×3 avec en-têtes",
    run: (e, r) =>
      e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    label: "Surlignage",
    hint: "Surligner en jaune",
    run: (e, r) => e.chain().focus().deleteRange(r).setHighlight({ color: "#f0c04a59" }).run(),
  },
  {
    label: "Sous-page",
    hint: "Crée une page fille ici",
    // La création appartient à la vue, qui seule connaît la page courante.
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestSubPage();
    },
  },
  {
    label: "Mention de page",
    hint: "Citer une page existante",
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestMention();
    },
  },
  {
    label: "Lien",
    hint: "Insérer une URL — Ctrl+K",
    // La saisie de l'URL appartient à la barre d'outils : on efface le « / »
    // puis on lui passe la main, sinon le texte de commande resterait dans la page.
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestLink();
    },
  },
  {
    label: "Image",
    hint: "Depuis un fichier local",
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestImage();
    },
  },
  {
    label: "Fichier audio",
    hint: "Son, musique, voix — lisible dans la page",
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestAudio();
    },
  },
  {
    label: "Séparateur",
    hint: "Trait horizontal",
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
