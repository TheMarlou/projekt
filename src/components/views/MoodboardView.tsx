import { useCallback, useEffect, useRef, useState } from "react";
import { cropLayout, isFullCrop, FULL_CROP, type Crop } from "../../lib/crop";
import CropEditor from "../editor/CropEditor";
import { useCanvasStore, type CanvasItem } from "../../store/canvasStore";
import AnalyseVisuelle from "./AnalyseVisuelle";
import { notify } from "../../lib/notify";
import { openExternal } from "../../lib/external";
import {
  apercuVideo,
  enregistrerBrut,
  ErreurTikTok,
  estVideo,
  infosTikTok,
  lecteurTikTok,
  lienTikTok,
  oublierVideos,
  telechargerMiniature,
  urlVideo,
  VIDEO_MAX_OCTETS,
} from "../../lib/mediasMoodboard";

/** Octets → base64, par morceaux (une vidéo entière ferait déborder la pile). */
function enBase64(octets: Uint8Array): string {
  let binaire = "";
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const MIN_ITEM_WIDTH = 60;

/** Coins de redimensionnement : `dir` dit dans quel sens la largeur suit la souris. */
const HANDLES = [
  { corner: "nw", dir: -1, top: true, left: true, cursor: "nwse-resize" },
  { corner: "ne", dir: 1, top: true, left: false, cursor: "nesw-resize" },
  { corner: "sw", dir: -1, top: false, left: true, cursor: "nesw-resize" },
  { corner: "se", dir: 1, top: false, left: false, cursor: "nwse-resize" },
] as const;

interface MoodboardViewProps {
  projectId: string;
  /** Page ouverte côté Notes : cible du bouton « vers la page ». */
  targetPageId: string | null;
  targetPageTitle: string | null;
  onSendToPage: (assetPath: string) => void;
  /** Lien TikTok → la page ouverte reçoit un lien cliquable vers la vidéo. */
  onSendLinkToPage: (url: string, libelle: string) => void;
}

export default function MoodboardView({
  projectId,
  targetPageId,
  targetPageTitle,
  onSendToPage,
  onSendLinkToPage,
}: MoodboardViewProps) {
  const { items: allItems, addItem, moveItem, resizeItem, cropItem, removeItem, chargerImages } = useCanvasStore();
  const items = allItems.filter((it) => it.projectId === projectId);

  // Les images ne sont lues qu'ici, à l'ouverture du moodboard du projet.
  useEffect(() => {
    chargerImages(projectId);
  }, [projectId, chargerImages]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const dragState = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  // Le redimensionnement vit en local le temps du geste : on n'écrit en base
  // qu'au relâchement, sinon chaque pixel parcouru déclencherait une écriture.
  const resizeState = useRef<{ id: string; startX: number; startW: number; ratio: number; dir: number } | null>(null);
  const [previewSize, setPreviewSize] = useState<{ id: string; width: number; height: number } | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [envoyee, setEnvoyee] = useState(false);
  // Rognage en cours : identifiant de l’image et zone provisoire.
  const [cropEnCours, setCropEnCours] = useState<{ id: string; draft: Crop } | null>(null);
  const [naturels, setNaturels] = useState<Record<string, { width: number; height: number }>>({});
  // Ctrl+clic ajoute une image à une sélection multiple, pour les comparer.
  const [multi, setMulti] = useState<string[]>([]);
  // Images soumises à l'analyse visuelle (une seule, ou plusieurs à comparer).
  const [analyse, setAnalyse] = useState<string[] | null>(null);
  // Ajouts en cours (vidéo copiée, lien TikTok interrogé) : quelques secondes sans rien à l'écran sinon.
  const [enAjout, setEnAjout] = useState(0);
  // Lien TikTok dont le lecteur est lancé (un seul à la fois : le son se superposerait).
  const [tiktokEnLecture, setTiktokEnLecture] = useState<string | null>(null);
  // Un geste en cours (déplacer, redimensionner, déplacer la vue) : le lecteur
  // TikTok devient transparent à la souris, sinon il avale mouvements et relâchement.
  const [geste, setGeste] = useState(false);

  // Un rognage ne survit ni à la désélection ni à Échap : les boutons pour en
  // sortir vivent dans la barre de l’élément sélectionné, on restait donc coincé
  // dans le mode dès qu’on cliquait ailleurs.
  useEffect(() => {
    if (cropEnCours && selectedId !== cropEnCours.id) setCropEnCours(null);
  }, [selectedId, cropEnCours]);

  useEffect(() => {
    if (!cropEnCours) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCropEnCours(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cropEnCours]);

  const toCanvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current!.getBoundingClientRect();
      return {
        x: (clientX - rect.left - transform.x) / transform.scale,
        y: (clientY - rect.top - transform.y) / transform.scale,
      };
    },
    [transform]
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, transform.scale * factor));
    const ratio = nextScale / transform.scale;
    setTransform({
      scale: nextScale,
      x: cursorX - (cursorX - transform.x) * ratio,
      y: cursorY - (cursorY - transform.y) * ratio,
    });
  };

  // Clic droit (ou molette) = déplacer la vue, partout et même par-dessus une
  // image. Le clic gauche est réservé à la saisie des images.
  const onContainerMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      panState.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y };
      setGeste(true);
      return;
    }
    if (e.button === 0 && e.target === e.currentTarget) {
      setSelectedId(null);
      setMulti([]);
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (panState.current) {
      const { startX, startY, originX, originY } = panState.current;
      setTransform((t) => ({ ...t, x: originX + (e.clientX - startX), y: originY + (e.clientY - startY) }));
    } else if (resizeState.current) {
      const { id, startX, startW, ratio, dir } = resizeState.current;
      // Le canevas est mis à l'échelle : le déplacement écran doit être ramené
      // à l'échelle du canevas, sinon l'image suit mal la souris quand on a zoomé.
      const delta = ((e.clientX - startX) / transform.scale) * dir;
      const width = Math.max(MIN_ITEM_WIDTH, startW + delta);
      setPreviewSize({ id, width, height: width / ratio });
    } else if (dragState.current) {
      const p = toCanvasPoint(e.clientX, e.clientY);
      moveItem(dragState.current.id, p.x - dragState.current.offsetX, p.y - dragState.current.offsetY);
    }
  };

  const stopInteractions = () => {
    if (resizeState.current && previewSize) {
      resizeItem(previewSize.id, Math.round(previewSize.width), Math.round(previewSize.height));
    }
    panState.current = null;
    dragState.current = null;
    resizeState.current = null;
    setPreviewSize(null);
    setGeste(false);
  };

  // Le relâchement est écouté sur TOUTE la fenêtre : lâché hors du moodboard ou
  // au-dessus du lecteur TikTok (une page de TikTok, qui garde ses événements),
  // il n'arrivait jamais et l'on restait bloqué en redimensionnement (retour du 11/09).
  const stopRef = useRef(stopInteractions);
  stopRef.current = stopInteractions;
  useEffect(() => {
    const arreter = () => stopRef.current();
    window.addEventListener("mouseup", arreter);
    window.addEventListener("blur", arreter); // clic dans le lecteur : la fenêtre perd le focus
    return () => {
      window.removeEventListener("mouseup", arreter);
      window.removeEventListener("blur", arreter);
    };
  }, []);

  const onItemMouseDown = (e: React.MouseEvent, id: string, itemX: number, itemY: number) => {
    if (e.button !== 0) return; // le clic droit doit continuer à déplacer la vue
    e.stopPropagation();
    // Pendant un rognage, le glissement appartient au cadre de sélection : sans
    // cette garde, tirer une poignée de rognage déplaçait l’image entière.
    if ((e.target as HTMLElement).closest(".pk-crop-box")) return;
    // Ctrl (ou Maj) + clic : on compose une sélection à comparer, sans déplacer.
    if (e.ctrlKey || e.shiftKey || e.metaKey) {
      setMulti((m) => {
        const base = m.length === 0 && selectedId && selectedId !== id ? [selectedId] : m;
        return base.includes(id) ? base.filter((x) => x !== id) : [...base, id].slice(-4);
      });
      setSelectedId(null);
      return;
    }
    setMulti([]);
    setSelectedId(id);
    const p = toCanvasPoint(e.clientX, e.clientY);
    dragState.current = { id, offsetX: p.x - itemX, offsetY: p.y - itemY };
    setGeste(true);
  };

  const onHandleMouseDown = (e: React.MouseEvent, id: string, width: number, height: number, dir: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    resizeState.current = { id, startX: e.clientX, startW: width, ratio: width / height, dir };
    setPreviewSize({ id, width, height });
    setGeste(true);
  };

  const envoyerVersPage = (assetPath: string) => {
    onSendToPage(assetPath);
    setEnvoyee(true);
    window.setTimeout(() => setEnvoyee(false), 2200);
  };

  const ajouterImage = async (file: File, point: { x: number; y: number }) => {
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

    const img = new Image();
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.src = dataUrl;
    });

    // Écrit l'image sur disque (voir spec §3.1) au lieu de la garder en base64 dans la base.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = file.name.split(".").pop()?.toLowerCase() || (file.type.split("/")[1] ?? "png");
    // Si l'écriture échoue, on affiche quand même l'image : jusqu'ici l'erreur
    // faisait échouer tout le dépôt, donc rien n'apparaissait et rien ne le disait.
    const assetPath = await enregistrerBrut(projectId, ext === "jpeg" ? "jpg" : ext, bytes).catch((err) => {
      console.error(`Échec de l'écriture de ${file.name} sur disque :`, err);
      return "";
    });

    const maxDim = 260;
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    addItem({
      projectId,
      assetPath,
      src: dataUrl,
      x: point.x - (img.width * ratio) / 2,
      y: point.y - (img.height * ratio) / 2,
      width: img.width * ratio,
      height: img.height * ratio,
      crop: null,
    });
  };

  // Vidéo : copiée dans le projet EN BINAIRE, avec une image d'aperçu (la
  // première demi-seconde) montrée tant qu'elle ne joue pas.
  const ajouterVideo = async (file: File, point: { x: number; y: number }) => {
    if (file.size > VIDEO_MAX_OCTETS) {
      notify(false, `« ${file.name} » dépasse ${Math.round(VIDEO_MAX_OCTETS / 1024 / 1024)} Mo : raccourcis-la ou compresse-la avant de l'ajouter.`);
      return;
    }
    setEnAjout((n) => n + 1);
    try {
      const { jpeg, largeur, hauteur } = await apercuVideo(file);
      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const assetPath = await enregistrerBrut(projectId, ext, new Uint8Array(await file.arrayBuffer()));
      const apercu = await enregistrerBrut(projectId, "jpg", jpeg);
      const ratio = Math.min(1, 300 / Math.max(largeur, hauteur));
      addItem({
        projectId,
        genre: "video",
        assetPath,
        src: `data:image/jpeg;base64,${enBase64(jpeg)}`,
        x: point.x - (largeur * ratio) / 2,
        y: point.y - (hauteur * ratio) / 2,
        width: largeur * ratio,
        height: hauteur * ratio,
        crop: null,
        meta: { apercu, titre: file.name.replace(/\.[^.]+$/, "") },
      });
    } catch (err) {
      notify(false, `« ${file.name} » n'a pas pu être ajoutée : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEnAjout((n) => n - 1);
    }
  };

  // Lien TikTok : la miniature est enregistrée dans le projet (visible hors
  // ligne) ; la vidéo elle-même reste chez TikTok et se lit au clic.
  const ajouterTikTok = async (lien: string, point: { x: number; y: number }) => {
    setEnAjout((n) => n + 1);
    try {
      const infos = await infosTikTok(lien);
      const { octets, ext } = await telechargerMiniature(infos.miniature);
      const assetPath = await enregistrerBrut(projectId, ext, octets);
      const largeur = 180;
      const hauteur = Math.round((largeur * infos.hauteur) / infos.largeur);
      addItem({
        projectId,
        genre: "tiktok",
        assetPath,
        src: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${enBase64(octets)}`,
        x: point.x - largeur / 2,
        y: point.y - hauteur / 2,
        width: largeur,
        height: hauteur,
        crop: null,
        meta: { url: infos.url, videoId: infos.videoId, titre: infos.titre, auteur: infos.auteur },
      });
    } catch (err) {
      notify(false, err instanceof ErreurTikTok ? err.message : `Le lien TikTok n'a pas pu être ajouté : ${String(err)}`);
    } finally {
      setEnAjout((n) => n - 1);
    }
  };

  const ajouterFichiers = (files: File[], point: { x: number; y: number }) => {
    files.forEach((file, i) => {
      const decale = { x: point.x + i * 24, y: point.y + i * 24 };
      if (estVideo(file)) ajouterVideo(file, decale);
      else if (file.type.startsWith("image/")) ajouterImage(file, decale);
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDropTarget(false);
    ajouterFichiers(Array.from(e.dataTransfer.files), toCanvasPoint(e.clientX, e.clientY));
  };

  // Ctrl+V sur le moodboard : une image copiée, ou un lien TikTok (bouton
  // « Copier le lien » dans TikTok). Posé au centre de la vue.
  const collerRef = useRef<(e: ClipboardEvent) => void>(() => {});
  collerRef.current = (e: ClipboardEvent) => {
    const cible = e.target instanceof Element ? e.target : null;
    if (cible?.closest("input, textarea, [contenteditable]")) return;
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return;
    const centre = toCanvasPoint(r.left + r.width / 2, r.top + r.height / 2);
    const fichiers = Array.from(e.clipboardData?.files ?? []);
    if (fichiers.length) {
      e.preventDefault();
      ajouterFichiers(fichiers, centre);
      return;
    }
    const lien = lienTikTok(e.clipboardData?.getData("text") ?? "");
    if (lien) {
      e.preventDefault();
      ajouterTikTok(lien, centre);
    }
  };
  useEffect(() => {
    const coller = (e: ClipboardEvent) => collerRef.current(e);
    window.addEventListener("paste", coller);
    return () => {
      window.removeEventListener("paste", coller);
      oublierVideos(); // la mémoire des vidéos lues est rendue en quittant le moodboard
    };
  }, []);

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onMouseDown={onContainerMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopInteractions}
      onMouseLeave={stopInteractions}
      // Sans ça, le clic droit ouvrirait le menu du navigateur au lieu de déplacer.
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDropTarget(true);
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={onDrop}
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        background: isDropTarget ? "var(--surface-2)" : "var(--bg)",
        backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
        backgroundSize: `${24 * transform.scale}px ${24 * transform.scale}px`,
        backgroundPosition: `${transform.x}px ${transform.y}px`,
        cursor: panState.current ? "grabbing" : "default",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {items.map((it) => {
          const apercu = previewSize?.id === it.id ? previewSize : null;
          const width = apercu?.width ?? it.width;
          const height = apercu?.height ?? it.height;
          const actif = selectedId === it.id;
          const enRognage = cropEnCours?.id === it.id;
          const naturel = naturels[it.id];
          // Même principe que dans les notes : on agrandit l’image et on la décale
          // derrière un cadre qui masque le reste. Le fichier n’est jamais touché.
          const mise = it.crop && naturel ? cropLayout(it.crop, width, naturel) : null;

          return (
            <div
              key={it.id}
              onMouseDown={(e) => onItemMouseDown(e, it.id, it.x, it.y)}
              style={{
                position: "absolute",
                left: it.x,
                top: it.y,
                width,
                height,
                borderRadius: 6,
                border: `1px solid ${actif ? "var(--accent)" : "var(--border)"}`,
                // La sélection multiple (à comparer) se distingue de la sélection simple.
                outline: multi.includes(it.id) ? `${3 / transform.scale}px solid var(--accent2)` : "none",
                outlineOffset: 2 / transform.scale,
                boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
                cursor: dragState.current?.id === it.id ? "grabbing" : "grab",
                userSelect: "none",
              }}
            >
              {/* Cadre interne : c’est LUI qui masque le débordement de l’image
                  rognée. Le mettre sur la boîte extérieure coupait les poignées
                  de redimensionnement, posées à cheval sur son bord. */}
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  // Le masquage sert à l’image rognée. Pendant le RÉGLAGE il doit
                  // céder : les poignées du cadre débordent, et masquer les
                  // couperait exactement comme cela coupait celles du
                  // redimensionnement.
                  overflow: enRognage ? "visible" : "hidden",
                  borderRadius: 5,
                  position: "relative",
                }}
              >
              {!it.src ? (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    padding: 8,
                    fontSize: 12 / transform.scale,
                    color: it.manquante ? "var(--danger)" : "var(--text-dim)",
                    background: "var(--surface-2)",
                    border: "1px dashed var(--border)",
                    borderRadius: 5,
                  }}
                >
                  {it.manquante
                    ? it.genre === "image"
                      ? "Image introuvable sur le disque"
                      : "Aperçu introuvable sur le disque"
                    : "Chargement…"}
                </div>
              ) : it.genre === "video" ? (
                <VideoMoodboard item={it} />
              ) : it.genre === "tiktok" ? (
                <TikTokMoodboard
                  item={it}
                  enLecture={tiktokEnLecture === it.id}
                  geste={geste}
                  onLire={() => {
                    setSelectedId(it.id);
                    setTiktokEnLecture(it.id);
                  }}
                  onArreter={() => setTiktokEnLecture(null)}
                />
              ) : enRognage ? (
                <CropEditor
                  src={it.src}
                  width={width}
                  value={cropEnCours.draft}
                  onChange={(draft) => setCropEnCours({ id: it.id, draft })}
                />
              ) : (
                <img
                  src={it.src}
                  draggable={false}
                  onLoad={(e) => {
                    // Lecture SYNCHRONE : React vide `currentTarget` dès la fin du
                    // gestionnaire, et la fonction de mise à jour s'exécute après.
                    const dims = {
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    };
                    setNaturels((n) => (n[it.id] ? n : { ...n, [it.id]: dims }));
                  }}
                  style={
                    mise
                      ? { position: "absolute", width: mise.imageWidth, maxWidth: "none", left: mise.offsetX, top: mise.offsetY, display: "block" }
                      : { width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: 5 }
                  }
                />
              )}
              </div>

              {actif && (
                <>
                  {!enRognage &&
                    HANDLES.map((h) => (
                    <span
                      key={h.corner}
                      onMouseDown={(e) => onHandleMouseDown(e, it.id, width, height, h.dir)}
                      style={{
                        position: "absolute",
                        // Taille constante à l'écran quel que soit le zoom.
                        width: 10 / transform.scale,
                        height: 10 / transform.scale,
                        top: h.top ? -5 / transform.scale : undefined,
                        bottom: h.top ? undefined : -5 / transform.scale,
                        left: h.left ? -5 / transform.scale : undefined,
                        right: h.left ? undefined : -5 / transform.scale,
                        borderRadius: 2 / transform.scale,
                        background: "var(--accent)",
                        border: `${1 / transform.scale}px solid var(--bg)`,
                        cursor: h.cursor,
                      }}
                    />
                    ))}

                  <div
                    style={{
                      position: "absolute",
                      bottom: `calc(100% + ${8 / transform.scale}px)`,
                      left: 0,
                      display: "flex",
                      gap: 2 / transform.scale,
                      padding: 3 / transform.scale,
                      whiteSpace: "nowrap",
                      borderRadius: 6 / transform.scale,
                      background: "var(--surface-2)",
                      border: `${1 / transform.scale}px solid var(--border)`,
                      transform: `scale(${1 / transform.scale})`,
                      transformOrigin: "bottom left",
                    }}
                  >
                    {it.genre !== "video" && (
                      <button
                        disabled={!targetPageId}
                        title={
                          targetPageId
                            ? it.genre === "tiktok"
                              ? `Ajouter le lien de cette vidéo à « ${targetPageTitle || "Sans titre"} »`
                              : `Ajouter cette image à « ${targetPageTitle || "Sans titre"} »`
                            : "Ouvre d'abord une page dans la vue Notes"
                        }
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          if (it.genre === "tiktok" && it.meta?.url) {
                            onSendLinkToPage(it.meta.url, it.meta.titre || it.meta.auteur || "Vidéo TikTok");
                            setEnvoyee(true);
                            window.setTimeout(() => setEnvoyee(false), 2200);
                          } else envoyerVersPage(it.assetPath);
                        }}
                        style={{ ...barButton, color: targetPageId ? "var(--text-dim)" : "var(--border)" }}
                      >
                        {envoyee ? "✓ Ajouté" : "→ Vers la page"}
                      </button>
                    )}
                    {it.genre === "tiktok" && it.meta?.url && (
                      <button
                        title="Ouvrir la vidéo dans ton navigateur"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => openExternal(it.meta!.url!)}
                        style={barButton}
                      >
                        ↗ Ouvrir dans TikTok
                      </button>
                    )}
                    {it.genre !== "image" ? null : enRognage ? (
                      <>
                        <button
                          title="Appliquer la zone choisie"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => {
                            const zone = cropEnCours.draft;
                            cropItem(it.id, isFullCrop(zone) ? null : zone);
                            // La boîte doit épouser ce qu’elle montre, sinon
                            // l’image rognée serait étirée dans l’ancien cadre.
                            if (naturel) {
                              const h = (width * (zone.h * naturel.height)) / (zone.w * naturel.width);
                              resizeItem(it.id, Math.round(width), Math.round(h));
                            }
                            setCropEnCours(null);
                          }}
                          style={{ ...barButton, color: "var(--accent)" }}
                        >
                          ✓ Valider
                        </button>
                        <button
                          title="Revenir à la zone précédente"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => setCropEnCours(null)}
                          style={barButton}
                        >
                          Annuler
                        </button>
                      </>
                    ) : (
                      <button
                        title="Choisir la partie de l’image à garder"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setCropEnCours({ id: it.id, draft: it.crop ?? FULL_CROP })}
                        style={{ ...barButton, color: it.crop ? "var(--accent)" : "var(--text-dim)" }}
                      >
                        Rogner
                      </button>
                    )}
                    {it.genre === "image" && it.crop && !enRognage && (
                      <button
                        title="Afficher de nouveau l’image entière"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          cropItem(it.id, null);
                          if (naturel) {
                            resizeItem(it.id, Math.round(width), Math.round((width * naturel.height) / naturel.width));
                          }
                        }}
                        style={barButton}
                      >
                        Image entière
                      </button>
                    )}
                    <button
                      title={
                        it.genre === "image"
                          ? "L'IA nomme le style, l'explique et donne des mots pour chercher d'autres références"
                          : "L'IA analyse l'image d'aperçu de la vidéo (elle ne voit pas la vidéo elle-même)"
                      }
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => setAnalyse([it.id])}
                      style={{ ...barButton, color: "var(--accent)" }}
                    >
                      {it.genre === "image" ? "✦ Analyser" : "✦ Analyser l'aperçu"}
                    </button>
                    <button
                      title="Retirer du moodboard"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        removeItem(it.id);
                        setSelectedId(null);
                      }}
                      style={{ ...barButton, color: "var(--danger)" }}
                    >
                      Supprimer
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {items.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-dim)",
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          Glisse-dépose des images ou des vidéos ici, ou colle un lien TikTok (Ctrl+V).
        </div>
      )}

      {enAjout > 0 && (
        <div style={{ ...barreComparaison, pointerEvents: "none" }}>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
            <span className="pk-ia-pulse">●</span> Ajout en cours…
          </span>
        </div>
      )}

      {multi.length > 0 && (
        <div style={barreComparaison} onMouseDown={(e) => e.stopPropagation()}>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {multi.length} image{multi.length > 1 ? "s" : ""} sélectionnée{multi.length > 1 ? "s" : ""}
            {multi.length < 2 ? " — Ctrl+clic sur une autre pour comparer" : ""}
          </span>
          <button
            disabled={multi.length < 2}
            onClick={() => setAnalyse(multi)}
            style={{ ...boutonBarre, ...(multi.length >= 2 ? boutonBarreActif : {}) }}
          >
            ✦ Comparer
          </button>
          <button onClick={() => setMulti([])} style={boutonBarre}>
            Effacer
          </button>
        </div>
      )}

      {analyse && (
        <AnalyseVisuelle
          key={analyse.join(",")}
          images={analyse.map((id) => items.find((i) => i.id === id)).filter((i): i is CanvasItem => !!i)}
          targetPageId={targetPageId}
          targetPageTitle={targetPageTitle}
          onClose={() => setAnalyse(null)}
        />
      )}

      <div style={legend}>
        Clic droit : déplacer la vue · Clic gauche : saisir · Ctrl+clic : comparer · Molette : zoom · Ctrl+V : coller une image ou un lien TikTok
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 14,
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: "var(--text-dim)",
        }}
      >
        {Math.round(transform.scale * 100)}%
      </div>
    </div>
  );
}

/**
 * Vidéo (fichier) : son image d'aperçu au repos ; au SURVOL, elle se lit en
 * boucle sans son, comme un GIF (son choix du 11/09). Le fichier n'est lu qu'au
 * premier survol. Le bouton 🔇 active le son.
 */
function VideoMoodboard({ item }: { item: CanvasItem }) {
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [survol, setSurvol] = useState(false);
  const [son, setSon] = useState(false);
  const [echec, setEchec] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (survol) v.play().catch(() => {});
    else v.pause();
  }, [survol, url]);

  return (
    <div
      onMouseEnter={() => {
        setSurvol(true);
        if (!url && !echec) urlVideo(item.assetPath).then(setUrl).catch(() => setEchec(true));
      }}
      onMouseLeave={() => setSurvol(false)}
      style={{ position: "relative", width: "100%", height: "100%", background: "#000" }}
    >
      <img
        src={item.src}
        draggable={false}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: url && survol ? "none" : "block" }}
      />
      {url && (
        <video
          ref={video}
          src={url}
          muted={!son}
          loop
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", display: survol ? "block" : "none" }}
        />
      )}
      {!survol && <span style={{ ...pastilleMedia, left: 6, bottom: 6 }}>▶ vidéo</span>}
      {echec && <span style={{ ...pastilleMedia, left: 6, top: 6, color: "var(--danger)" }}>Vidéo introuvable sur le disque</span>}
      {survol && url && (
        <button
          title={son ? "Couper le son" : "Activer le son"}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setSon((s) => !s)}
          style={{ ...pastilleMedia, right: 6, top: 6, cursor: "pointer", border: "none" }}
        >
          {son ? "🔊" : "🔇"}
        </button>
      )}
    </div>
  );
}

/**
 * Lien TikTok : sa miniature (enregistrée sur le PC, visible hors ligne) ; un
 * clic sur ▶ lance le lecteur officiel de TikTok à la place (il faut internet).
 * Pendant la lecture, le bandeau du haut sert de poignée pour déplacer.
 */
function TikTokMoodboard({
  item,
  enLecture,
  geste,
  onLire,
  onArreter,
}: {
  item: CanvasItem;
  enLecture: boolean;
  /** Geste en cours dans le moodboard : le lecteur ne doit pas capter la souris. */
  geste: boolean;
  onLire: () => void;
  onArreter: () => void;
}) {
  const meta = item.meta ?? {};
  if (enLecture && meta.videoId) {
    return (
      <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column" }}>
        <div style={bandeauLecture}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>⠿ TikTok · {meta.auteur || "vidéo"}</span>
          <button
            title="Arrêter la lecture"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onArreter}
            style={{ border: "none", background: "transparent", color: "#fff", cursor: "pointer", fontSize: 13, padding: "0 2px" }}
          >
            ✕
          </button>
        </div>
        <iframe
          src={lecteurTikTok(meta.videoId)}
          title={meta.titre || "Vidéo TikTok"}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          style={{ flex: 1, width: "100%", border: 0, display: "block", pointerEvents: geste ? "none" : "auto" }}
        />
      </div>
    );
  }
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <img src={item.src} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      <span style={{ ...pastilleMedia, left: 6, top: 6 }}>♪ TikTok</span>
      <button
        title="Lire la vidéo (il faut internet)"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onLire}
        style={boutonLecture}
      >
        ▶
      </button>
      {(meta.titre || meta.auteur) && (
        <div style={legendeTikTok}>
          {meta.auteur && <div style={{ fontWeight: 600 }}>{meta.auteur}</div>}
          {meta.titre && <div style={{ opacity: 0.85, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{meta.titre}</div>}
        </div>
      )}
    </div>
  );
}

const pastilleMedia: React.CSSProperties = {
  position: "absolute",
  padding: "2px 6px",
  borderRadius: 4,
  background: "rgba(0,0,0,0.6)",
  color: "#fff",
  fontSize: 10.5,
  fontWeight: 600,
  pointerEvents: "auto",
};

const boutonLecture: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: 46,
  height: 46,
  borderRadius: "50%",
  border: "2px solid rgba(255,255,255,0.9)",
  background: "rgba(0,0,0,0.5)",
  color: "#fff",
  fontSize: 18,
  cursor: "pointer",
  paddingLeft: 4,
};

const legendeTikTok: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  padding: "18px 8px 7px",
  background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
  color: "#fff",
  fontSize: 11,
  lineHeight: 1.35,
  pointerEvents: "none",
};

const bandeauLecture: React.CSSProperties = {
  height: 22,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
  padding: "0 6px",
  background: "#111",
  color: "#fff",
  fontSize: 11,
  cursor: "grab",
};

const barButton: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: 11.5,
  padding: "3px 8px",
  border: "none",
  borderRadius: 4,
  background: "transparent",
};

const legend: React.CSSProperties = {
  position: "absolute",
  bottom: 12,
  left: 14,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--text-dim)",
  pointerEvents: "none",
};

const barreComparaison: React.CSSProperties = {
  position: "absolute",
  bottom: 40,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "6px 8px 6px 12px",
  borderRadius: 8,
  border: "1px solid var(--accent2)",
  background: "var(--surface-2)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
  zIndex: 15,
};

const boutonBarre: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
};

const boutonBarreActif: React.CSSProperties = {
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "var(--bg)",
  fontWeight: 600,
};
