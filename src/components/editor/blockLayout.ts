import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { tr } from "../../lib/i18n";

const PLACEMENT_KEY = new PluginKey<PlacementState>("blockPlacement");
const ROW_KEY = new PluginKey<RowState>("tableRowResizing");

/** Marge, en pixels, pour attraper le bord bas d'une ligne de tableau. */
const GRAB_ZONE = 5;
const MIN_ROW_HEIGHT = 24;
/** Côté du carré, en haut à gauche du bloc, qui sert de poignée. */
const GRIP_SIZE = 18;
/** Nœuds qu'on sait déplacer et faire habiller par le texte. */
const MOVABLE = ["table", "image"];

type Align = "none" | "left" | "right";

interface PlacementState {
  /** Position du bloc dont la poignée est survolée. */
  grabbable: number | null;
  /** Point d'insertion visé pendant un déplacement. */
  dropAt: number | null;
  /** Habillage qui sera appliqué au dépôt, déduit du côté visé. */
  dropAlign: Align;
  /** Encombrement du bloc déplacé, pour dessiner l'aperçu à sa taille. */
  ghost: { width: number; height: number } | null;
}

interface RowState {
  hovered: number | null;
}

/** Remonte du point visé jusqu'à la cellule de tableau qui le contient. */
function cellAround(target: EventTarget | null): HTMLElement | null {
  let el = target as HTMLElement | null;
  while (el && el.nodeName !== "TD" && el.nodeName !== "TH") {
    if (el.classList?.contains("ProseMirror")) return null;
    el = el.parentElement;
  }
  return el;
}

/** Position d'un nœud d'un type donné à partir d'un élément du DOM qu'il rend. */
function posOfNodeAround(view: EditorView, dom: HTMLElement, typeName: string): number | null {
  try {
    const $pos = view.state.doc.resolve(view.posAtDOM(dom, 0));
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === typeName) return $pos.before(depth);
    }
  } catch {
    // posAtDOM lève si le DOM n'appartient plus au document.
  }
  return null;
}

/**
 * Position d'un bloc déplaçable à partir de n'importe quel élément qu'il rend.
 * Les images sont des nœuds sans contenu : `posAtDOM` n'y suffit pas, on compare
 * donc directement au DOM que la vue associe à chaque nœud candidat.
 */
function movablePosForDom(view: EditorView, dom: HTMLElement): number | null {
  let found: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found !== null || !MOVABLE.includes(node.type.name)) return;
    const nodeDom = view.nodeDOM(pos) as HTMLElement | null;
    if (nodeDom && (nodeDom === dom || nodeDom.contains(dom) || dom.contains(nodeDom))) {
      found = pos;
    }
  });
  return found;
}

/**
 * Point d'insertion de premier niveau le plus proche d'un point de l'écran.
 * On vise avant ou après le bloc survolé selon la moitié où l'on se trouve.
 */
function topLevelDropPos(view: EditorView, clientX: number, clientY: number): number | null {
  const found = view.posAtCoords({ left: clientX, top: clientY });
  if (!found) return null;
  const $pos = view.state.doc.resolve(found.pos);
  if ($pos.depth === 0) return found.pos;

  const before = $pos.before(1);
  const node = view.state.doc.nodeAt(before);
  if (!node) return before;

  const dom = view.nodeDOM(before) as HTMLElement | null;
  if (!dom?.getBoundingClientRect) return before;
  const rect = dom.getBoundingClientRect();
  return clientY > rect.top + rect.height / 2 ? before + node.nodeSize : before;
}

/**
 * Habillage déduit de l'endroit où l'on relâche, horizontalement.
 * Déposer à gauche de la colonne colle le bloc à gauche et fait couler le texte
 * à sa droite ; au milieu, le bloc occupe sa ligne entière.
 */
function alignFromX(view: EditorView, clientX: number): Align {
  const rect = view.dom.getBoundingClientRect();
  if (rect.width === 0) return "none";
  const ratio = (clientX - rect.left) / rect.width;
  if (ratio < 0.33) return "left";
  if (ratio > 0.67) return "right";
  return "none";
}

export const BlockLayout = Extension.create({
  name: "blockLayout",

  addGlobalAttributes() {
    return [
      {
        types: ["table"],
        attributes: {
          align: {
            default: "none",
            parseHTML: (element: HTMLElement) => element.getAttribute("data-align") ?? "none",
            renderHTML: (attributes: Record<string, unknown>) => ({ "data-align": attributes.align }),
          },
        },
      },
      {
        types: ["tableRow"],
        attributes: {
          // Les lignes sont rendues normalement par ProseMirror : un style en
          // ligne suffit, pas besoin de décoration.
          height: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const h = parseInt(element.style.height, 10);
              return Number.isFinite(h) ? h : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.height ? { style: `height: ${attributes.height}px` } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [placementPlugin(), rowResizingPlugin()];
  },
});

/**
 * Déplacement libre des images et tableaux, avec habillage du texte.
 *
 * Le placement est libre au geste, pas au stockage : on ne peut pas poser un
 * bloc à des coordonnées absolues ET faire couler le texte autour, aucun
 * navigateur ne sait le faire (les exclusions CSS n'ont jamais été implémentées).
 * On reprend donc le modèle de Word : au dépôt, le bloc s'ancre au paragraphe
 * le plus proche et flotte du côté visé — c'est le flottement qui produit
 * l'habillage, réel celui-là.
 *
 * Le geste est piloté à la souris et non par le glisser-déposer du navigateur,
 * qui nous a coûté trois détours sur ce projet.
 */
function placementPlugin() {
  return new Plugin<PlacementState>({
    key: PLACEMENT_KEY,

    state: {
      init: () => ({ grabbable: null, dropAt: null, dropAlign: "none", ghost: null }),
      apply: (tr, value) => ({ ...value, ...(tr.getMeta(PLACEMENT_KEY) ?? {}) }),
    },

    props: {
      decorations: (state) => {
        const placement = PLACEMENT_KEY.getState(state);
        if (!placement) return null;
        const { grabbable, dropAt, dropAlign, ghost } = placement;
        const decorations: Decoration[] = [];

        state.doc.descendants((node, pos) => {
          if (node.type.name === "table") {
            const attrs: Record<string, string> = {
              "data-align": (node.attrs.align as string) ?? "none",
            };
            if (pos === grabbable) attrs.class = "pk-grabbable";
            decorations.push(Decoration.node(pos, pos + node.nodeSize, attrs));
          } else if (node.type.name === "image" && pos === grabbable) {
            decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "pk-grabbable" }));
          }
        });

        if (dropAt !== null) {
          decorations.push(
            Decoration.widget(dropAt, () => buildPreview(dropAlign, ghost), {
              key: `pk-drop-${dropAlign}-${ghost?.width ?? 0}`,
            })
          );
        }

        return DecorationSet.create(state.doc, decorations);
      },

      handleDOMEvents: {
        mousemove: (view, event) => {
          const target = event.target as HTMLElement | null;
          const holder = target?.closest?.(".tableWrapper, .pk-image") as HTMLElement | null;
          const previous = PLACEMENT_KEY.getState(view.state)?.grabbable ?? null;
          let next: number | null = null;

          // Plusieurs contrôles tombent dans la zone de préhension : la poignée de
          // redimensionnement du coin haut-gauche, et surtout le cadre de rognage,
          // qui couvre toute l'image. Sans cette exception on déplaçait le bloc au
          // lieu de le redimensionner ou de le rogner.
          const surUnControle = !!target?.closest?.(
            ".pk-image-handle, .pk-image-bar, .pk-crop-box"
          );

          if (holder && !surUnControle) {
            const rect = holder.getBoundingClientRect();
            const dansLaPoignee =
              event.clientX - rect.left <= GRIP_SIZE && event.clientY - rect.top <= GRIP_SIZE;
            if (dansLaPoignee) next = movablePosForDom(view, holder);
          }

          if (next !== previous) {
            view.dispatch(view.state.tr.setMeta(PLACEMENT_KEY, { grabbable: next }));
          }
          return false;
        },

        mousedown: (view, event) => {
          const from = PLACEMENT_KEY.getState(view.state)?.grabbable ?? null;
          if (from === null) return false;
          event.preventDefault();

          const dom = view.nodeDOM(from) as HTMLElement | null;
          const rect = dom?.getBoundingClientRect();
          const ghost = rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null;

          const onMove = (e: MouseEvent) => {
            const cible = topLevelDropPos(view, e.clientX, e.clientY);
            const node = view.state.doc.nodeAt(from);
            // Une cible située dans le bloc lui-même n'a pas de sens.
            const dedans =
              node !== null && cible !== null && cible > from && cible < from + node.nodeSize;
            view.dispatch(
              view.state.tr.setMeta(PLACEMENT_KEY, {
                dropAt: dedans ? null : cible,
                dropAlign: alignFromX(view, e.clientX),
                ghost,
              })
            );
          };

          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            const placement = PLACEMENT_KEY.getState(view.state);
            const to = placement?.dropAt ?? null;
            const align = placement?.dropAlign ?? "none";
            const node = view.state.doc.nodeAt(from);
            const efface = view.state.tr.setMeta(PLACEMENT_KEY, {
              dropAt: null,
              ghost: null,
              grabbable: null,
            });

            if (node && to !== null && (to < from || to > from + node.nodeSize)) {
              const tr = view.state.tr;
              tr.delete(from, from + node.nodeSize);
              const replace = node.type.create({ ...node.attrs, align }, node.content, node.marks);
              tr.insert(tr.mapping.map(to), replace);
              tr.setMeta(PLACEMENT_KEY, { dropAt: null, ghost: null, grabbable: null });
              view.dispatch(tr);
            } else {
              view.dispatch(efface);
            }
          };

          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
          return true;
        },
      },
    },
  });
}

/** Aperçu : le trait d'insertion, plus une empreinte du bloc du côté visé. */
function buildPreview(align: Align, ghost: { width: number; height: number } | null): HTMLElement {
  const bloc = document.createElement("div");
  bloc.className = "pk-drop-preview";
  bloc.dataset.align = align;

  if (ghost) {
    const empreinte = document.createElement("div");
    empreinte.className = "pk-drop-ghost";
    // Bornée : une empreinte à la taille réelle d'une grande image masquerait
    // la page au lieu de renseigner.
    empreinte.style.width = `${Math.min(ghost.width, 260)}px`;
    empreinte.style.height = `${Math.min(ghost.height, 160)}px`;
    empreinte.textContent =
      align === "left" ? tr("texte à droite →", "text on the right →") : align === "right" ? tr("← texte à gauche", "← text on the left") : tr("pleine ligne", "full width");
    bloc.appendChild(empreinte);
  }

  const trait = document.createElement("div");
  trait.className = "pk-drop-line";
  bloc.appendChild(trait);
  return bloc;
}

/**
 * Redimensionnement des lignes de tableau, absent de l'extension : on reproduit
 * le principe du redimensionnement de colonnes, mais sur le bord bas des cellules.
 */
function rowResizingPlugin() {
  return new Plugin<RowState>({
    key: ROW_KEY,
    state: {
      init: () => ({ hovered: null }),
      apply: (tr, value) => tr.getMeta(ROW_KEY) ?? value,
    },
    props: {
      decorations: (state) => {
        const { hovered } = ROW_KEY.getState(state) ?? { hovered: null };
        if (hovered === null) return null;
        const node = state.doc.nodeAt(hovered);
        if (!node) return null;
        return DecorationSet.create(state.doc, [
          Decoration.node(hovered, hovered + node.nodeSize, { class: "pk-row-resizing" }),
        ]);
      },
      handleDOMEvents: {
        mousemove: (view, event) => {
          const cell = cellAround(event.target);
          const previous = ROW_KEY.getState(view.state)?.hovered ?? null;
          let next: number | null = null;

          if (cell) {
            const rect = cell.getBoundingClientRect();
            if (Math.abs(event.clientY - rect.bottom) <= GRAB_ZONE) {
              next = posOfNodeAround(view, cell.parentElement as HTMLElement, "tableRow");
            }
          }
          if (next !== previous) {
            view.dispatch(view.state.tr.setMeta(ROW_KEY, { hovered: next }));
          }
          return false;
        },

        mousedown: (view, event) => {
          const rowPos = ROW_KEY.getState(view.state)?.hovered ?? null;
          if (rowPos === null) return false;

          const cell = cellAround(event.target);
          const rowDom = cell?.parentElement as HTMLElement | undefined;
          if (!rowDom) return false;

          event.preventDefault();
          const startY = event.clientY;
          const startHeight = rowDom.getBoundingClientRect().height;
          let latest = startHeight;

          const onMove = (e: MouseEvent) => {
            latest = Math.max(MIN_ROW_HEIGHT, startHeight + (e.clientY - startY));
            // Retour visuel immédiat sans passer par le document : on n'écrit
            // qu'au relâchement, sinon chaque pixel produirait une transaction.
            rowDom.style.height = `${latest}px`;
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            const node = view.state.doc.nodeAt(rowPos);
            if (node) {
              view.dispatch(
                view.state.tr.setNodeMarkup(rowPos, undefined, {
                  ...node.attrs,
                  height: Math.round(latest),
                })
              );
            }
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
          return true;
        },
      },
    },
  });
}
