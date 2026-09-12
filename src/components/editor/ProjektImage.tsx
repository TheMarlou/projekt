import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Image from "@tiptap/extension-image";
import { cropLayout, isFullCrop, parseCrop, FULL_CROP, type Crop } from "../../lib/crop";
import { openExternal } from "../../lib/external";
import CropEditor from "./CropEditor";
import { requestLink } from "./editorEvents";
import { NodeViewWrapper, ReactNodeViewRenderer, type Editor, type NodeViewProps } from "@tiptap/react";
import { tr } from "../../lib/i18n";

// Le document stocke un CHEMIN de fichier, pas les octets de l'image : une page
// avec dix captures pèserait sinon plusieurs mégaoctets dans SQLite. La vue résout
// le chemin en data-URI à l'affichage, et met le résultat en cache pour la session.
const previewCache = new Map<string, string>();

const MIN_WIDTH = 60;

function isDirectSrc(src: string): boolean {
  return /^(data:|https?:|blob:)/i.test(src);
}

/** Évite un aller-retour disque juste après l'insertion : on connaît déjà l'aperçu. */
export function cachePreview(path: string, dataUri: string) {
  previewCache.set(path, dataUri);
}

/** Coins de redimensionnement : `dir` dit dans quel sens la largeur suit la souris. */
const HANDLES = [
  { corner: "nw", dir: -1, top: -5, left: -5, cursor: "nwse-resize" },
  { corner: "ne", dir: 1, top: -5, right: -5, cursor: "nesw-resize" },
  { corner: "sw", dir: -1, bottom: -5, left: -5, cursor: "nesw-resize" },
  { corner: "se", dir: 1, bottom: -5, right: -5, cursor: "nwse-resize" },
] as const;

const WRAP_MODES = [
  { value: "none", label: tr("Pleine ligne", "Full width"), title: tr("Image seule sur sa ligne", "Image alone on its line") },
  { value: "left", label: tr("Texte à droite", "Text on the right"), title: tr("Image à gauche, le texte l'habille à droite", "Image on the left, text wraps on the right") },
  { value: "center", label: tr("Centrée", "Centred"), title: tr("Image centrée, seule sur sa ligne", "Centred image, alone on its line") },
  { value: "right", label: tr("Texte à gauche", "Text on the left"), title: tr("Image à droite, le texte l'habille à gauche", "Image on the right, text wraps on the left") },
] as const;

function ImageView({ node, selected, updateAttributes }: NodeViewProps) {
  const src = (node.attrs.src as string) ?? "";
  const alt = (node.attrs.alt as string) ?? "";
  const width = (node.attrs.width as number | null) ?? null;
  const align = (node.attrs.align as string) ?? "none";
  const href = (node.attrs.href as string | null) ?? null;
  const crop = parseCrop(node.attrs.crop);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState(() =>
    isDirectSrc(src) ? src : previewCache.get(src) ?? ""
  );
  const [failed, setFailed] = useState(false);
  // Largeur pendant le glissement : on ne touche au document qu'au relâchement,
  // sinon chaque pixel parcouru déclencherait une transaction et une écriture.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // Dimensions réelles du fichier : indispensables pour traduire une zone de
  // rognage exprimée en fractions vers des pixels.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [cropDraft, setCropDraft] = useState<Crop | null>(null);
  const [placementOuvert, setPlacementOuvert] = useState(false);

  useEffect(() => {
    // Un chemin vide ne se résoudra jamais : afficher « Chargement… » indéfiniment
    // serait mensonger, on annonce tout de suite que l'image est indisponible.
    if (!src) {
      setResolved("");
      setFailed(true);
      return;
    }
    if (isDirectSrc(src) || previewCache.has(src)) {
      setResolved(isDirectSrc(src) ? src : previewCache.get(src) ?? "");
      setFailed(false);
      return;
    }
    let alive = true;
    setFailed(false);
    invoke<string>("read_asset_base64", { path: src })
      .then((uri) => {
        previewCache.set(src, uri);
        if (alive) setResolved(uri);
      })
      // Hors contexte Tauri (panneau navigateur) ou fichier déplacé : on montre
      // un cadre explicite plutôt qu'une image cassée silencieuse.
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [src]);

  // Même garde que dans le moodboard : la barre qui permet de sortir du rognage
  // disparaît avec la sélection : sans ça on resterait coincé dans le mode.
  useEffect(() => {
    if (!selected) setCropDraft(null);
  }, [selected]);

  const startResize = (event: React.PointerEvent, dir: number) => {
    event.preventDefault();
    event.stopPropagation();
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const startX = event.clientX;
    const startWidth = wrapper.getBoundingClientRect().width;
    // La borne haute se prend sur la colonne de texte, PAS sur l'enveloppe du
    // nœud : celle-ci épouse l'image (pour qu'un clic à côté la désélectionne),
    // donc s'en servir revenait à interdire tout agrandissement.
    const maxWidth = (wrapper.closest(".tiptap") as HTMLElement | null)?.clientWidth ?? startWidth;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    let latest = startWidth;
    const onMove = (e: PointerEvent) => {
      latest = Math.max(MIN_WIDTH, Math.min(maxWidth, startWidth + (e.clientX - startX) * dir));
      setDragWidth(latest);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      setDragWidth(null);
      updateAttributes({ width: Math.round(latest) });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  };

  const shownWidth = dragWidth ?? width;

  // Sans rognage on laisse le rendu naturel : aucun calcul, et donc aucun risque
  // de décalage tant que les dimensions réelles du fichier sont inconnues.
  const mise = crop && natural && shownWidth ? cropLayout(crop, shownWidth, natural) : null;
  const frameStyle: React.CSSProperties = mise
    ? { display: "block", overflow: "hidden", height: mise.frameHeight, borderRadius: 6 }
    : { display: "block" };
  const imageStyle: React.CSSProperties = mise
    ? {
        position: "relative",
        width: mise.imageWidth,
        maxWidth: "none",
        left: mise.offsetX,
        top: mise.offsetY,
        display: "block",
      }
    : {};

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className="pk-image"
      data-align={align}
      data-selected={selected ? "true" : undefined}
      style={shownWidth ? { width: shownWidth } : undefined}
    >
      {cropDraft && resolved ? (
        <CropEditor
          src={resolved}
          width={shownWidth ?? natural?.width ?? 320}
          value={cropDraft}
          onChange={setCropDraft}
        />
      ) : resolved ? (
        <span className="pk-image-frame" style={frameStyle}>
          <img
            src={resolved}
            alt={alt}
            draggable={false}
            title={href ? tr(`Ctrl+clic pour ouvrir ${href}`, `Ctrl+click to open ${href}`) : undefined}
            onLoad={(e) =>
              setNatural({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            // Même geste que sur un lien de texte : le clic simple reste à l'édition.
            onClick={(e) => href && (e.ctrlKey || e.metaKey) && void openExternal(href)}
            style={imageStyle}
          />
        </span>
      ) : (
        <span className="pk-image-fallback">
          {failed ? tr("⚠ Image introuvable", "⚠ Image not found") : tr("Chargement de l'image…", "Loading image…")}
        </span>
      )}

      {href && <span className="pk-image-link">🔗 {tr("lien", "link")}</span>}

      {selected && resolved && (
        <>
          {/* Pendant un rognage, les poignées de redimensionnement occuperaient les
              MÊMES coins que celles du cadre de rognage et capteraient le geste :
              on les retire le temps du réglage. */}
          {!cropDraft &&
            HANDLES.map((h) => (
            <span
              key={h.corner}
              className="pk-image-handle"
              onPointerDown={(e) => startResize(e, h.dir)}
              style={{
                top: "top" in h ? h.top : undefined,
                bottom: "bottom" in h ? h.bottom : undefined,
                left: "left" in h ? h.left : undefined,
                right: "right" in h ? h.right : undefined,
                    cursor: h.cursor,
                }}
              />
            ))}

          <div className="pk-image-bar" contentEditable={false}>
            {/* Les quatre modes d’habillage tenaient toute la barre : repliés en
                menu, ils laissent la place au lien, au rognage et à la taille. */}
            <div className="pk-image-menu">
              <button
                title={tr("Placement de l’image dans le texte", "Image placement in the text")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPlacementOuvert((v) => !v)}
                data-active={placementOuvert ? "true" : undefined}
              >
                {WRAP_MODES.find((m) => m.value === align)?.label ?? "Placement"} ▾
              </button>
              {placementOuvert && (
                <div className="pk-image-menu-panel">
                  {WRAP_MODES.map((mode) => (
                    <button
                      key={mode.value}
                      title={mode.title}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        updateAttributes({ align: mode.value });
                        setPlacementOuvert(false);
                      }}
                      data-active={align === mode.value ? "true" : undefined}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              title={href ? tr(`Modifier le lien (${href})`, `Edit the link (${href})`) : tr("Poser un lien sur l'image", "Put a link on the image")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={requestLink}
              data-active={href ? "true" : undefined}
            >
              {tr("Lien", "Link")}
            </button>
            {cropDraft ? (
              <>
                <button
                  title={tr("Appliquer la zone choisie", "Apply the selected area")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    updateAttributes({ crop: isFullCrop(cropDraft) ? null : cropDraft });
                    setCropDraft(null);
                  }}
                  data-active="true"
                >
                  {tr("Valider le rognage", "Apply crop")}
                </button>
                <button
                  title={tr("Revenir à la zone précédente", "Go back to the previous area")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setCropDraft(null)}
                >
                  {tr("Annuler", "Cancel")}
                </button>
              </>
            ) : (
              <button
                title={tr("Choisir la partie de l'image à garder", "Choose the part of the image to keep")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setCropDraft(crop ?? FULL_CROP)}
                data-active={crop ? "true" : undefined}
              >
                {tr("Rogner", "Crop")}
              </button>
            )}
            {crop && !cropDraft && (
              <button
                title={tr("Afficher de nouveau l'image entière", "Show the whole image again")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => updateAttributes({ crop: null })}
              >
                {tr("Image entière", "Whole image")}
              </button>
            )}
            <button
              title={tr("Rendre à l'image sa taille d'origine", "Restore the image's original size")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => updateAttributes({ width: null })}
            >
              {tr("Taille d'origine", "Original size")}
            </button>
          </div>
        </>
      )}
    </NodeViewWrapper>
  );
}

export const ProjektImage = Image.extend({
  // Le glisser-déposer natif est désactivé : le déplacement passe par la poignée
  // et la logique commune aux images et aux tableaux (voir blockLayout.ts).
  draggable: false,

  addAttributes() {
    return {
      ...this.parent?.(),
      // Porte l'habillage : c'est une propriété du document, elle doit survivre
      // à l'enregistrement au même titre que la largeur.
      align: {
        default: "none",
        parseHTML: (element) => element.getAttribute("data-align") ?? "none",
        renderHTML: (attributes) => ({ "data-align": attributes.align }),
      },
      // Zone gardée, en fractions de l'image d'origine. Rognage non destructif :
      // le fichier reste intact, le geste est réversible, et l'image partagée avec
      // le moodboard n'est pas altérée.
      crop: {
        default: null,
        parseHTML: (element) => {
          try {
            return JSON.parse(element.getAttribute("data-crop") ?? "null");
          } catch {
            return null;
          }
        },
        renderHTML: (attributes) =>
          attributes.crop ? { "data-crop": JSON.stringify(attributes.crop) } : {},
      },
      // Un lien sur une image ne peut pas être une marque (les marques ne
      // s'appliquent qu'au texte) : c'est un attribut du nœud.
      href: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-href"),
        renderHTML: (attributes) =>
          attributes.href ? { "data-href": attributes.href } : {},
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Sortie clavier de la barre de l'image : sans ça, une image sélectionnée
      // gardait le focus tant qu'on n'avait pas cliqué au bon endroit.
      Escape: () => {
        if (!this.editor.isActive("image")) return false;
        return this.editor.chain().focus().setTextSelection(this.editor.state.selection.to).run();
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
}).configure({ inline: false, allowBase64: true });

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

/**
 * Écrit le fichier dans les assets du projet puis insère le nœud image.
 * Sans projet actif (ou hors Tauri) on retombe sur un data-URI : l'image reste
 * visible, elle est simplement stockée dans le document.
 */
export async function insertImageFile(editor: Editor, projectId: string | null, file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const rawExt = file.name.split(".").pop()?.toLowerCase() ?? "";
  const ext = IMAGE_EXTENSIONS.includes(rawExt) ? rawExt : "png";

  let src = dataUrl;
  if (projectId) {
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const assetPath = await invoke<string>("save_asset", { projectId, ext, bytes });
      cachePreview(assetPath, dataUrl);
      src = assetPath;
    } catch {
      // Écriture disque impossible : le data-URI fait l'affaire.
    }
  }

  editor.chain().focus().setImage({ src, alt: file.name }).run();
}
