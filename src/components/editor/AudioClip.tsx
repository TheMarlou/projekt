import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { notify } from "../../lib/notify";
import { tr } from "../../lib/i18n";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    audioClip: {
      /** Insère une puce audio (fichier déjà enregistré dans les assets) au curseur. */
      insertAudioClip: (attrs: { src: string; name: string }) => ReturnType;
    };
  }
}

/**
 * Fichier audio dans une note, présenté comme la puce de sous-page : un élément
 * EN LIGNE, déplaçable dans le texte, et non un bloc à part.
 *
 * Le nœud ne stocke que le chemin de l'asset et le nom d'origine — jamais les
 * octets, même raison que pour les images : la base resterait légère, et une
 * sauvegarde n'embarquerait pas deux fois le même son.
 */

export const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "webm"];

/** Au-delà, le fichier est refusé plutôt que de figer l'app en le chargeant. */
export const AUDIO_MAX_OCTETS = 50 * 1024 * 1024;

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSIONS.includes(ext);
}

// Une seule lecture à la fois : lancer un son coupe le précédent, comme dans
// n'importe quel lecteur. Sans ça, deux puces lancées se superposent.
let lectureEnCours: HTMLAudioElement | null = null;

// Volume commun à tous les sons, retenu d'une session à l'autre (recette du 13/09 :
// « on ne peut pas choisir le volume ni la timeline »).
const CLE_VOLUME = "projekt-volume-audio";
function volumeRetenu(): number {
  try {
    const v = Number(localStorage.getItem(CLE_VOLUME));
    return Number.isFinite(v) && localStorage.getItem(CLE_VOLUME) !== null ? Math.min(1, Math.max(0, v)) : 0.8;
  } catch {
    return 0.8;
  }
}
function retenirVolume(v: number) {
  try {
    localStorage.setItem(CLE_VOLUME, String(v));
  } catch {
    // Stockage indisponible : le volume vaut pour cette session seulement.
  }
}

function formatDuree(secondes: number): string {
  if (!Number.isFinite(secondes) || secondes < 0) return "–:––";
  const m = Math.floor(secondes / 60);
  const s = Math.floor(secondes % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Transforme le data-URI renvoyé par Rust en URL de blob, bien plus légère à garder. */
async function versUrlLecture(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return URL.createObjectURL(blob);
}

function AudioClipView({ node, selected, deleteNode }: NodeViewProps) {
  const src = node.attrs.src as string;
  const name = (node.attrs.name as string) || tr("Fichier audio", "Audio file");

  const audio = useRef<HTMLAudioElement | null>(null);
  const urlBlob = useRef<string | null>(null);
  const [etat, setEtat] = useState<"repos" | "chargement" | "lecture" | "pause" | "erreur">("repos");
  const [position, setPosition] = useState(0);
  const [duree, setDuree] = useState(NaN);
  const [volume, setVolume] = useState(volumeRetenu);

  // Libère le son quand la puce disparaît (suppression, changement de page).
  useEffect(
    () => () => {
      audio.current?.pause();
      if (lectureEnCours === audio.current) lectureEnCours = null;
      if (urlBlob.current) URL.revokeObjectURL(urlBlob.current);
    },
    []
  );

  const preparer = async (): Promise<HTMLAudioElement | null> => {
    if (audio.current) return audio.current;
    setEtat("chargement");
    try {
      // Un data-URI se lit tel quel ; un chemin d'asset passe par Rust. Le fichier
      // n'est lu qu'au PREMIER clic : une page pleine de sons ne les charge pas tous.
      const dataUrl = src.startsWith("data:") ? src : await invoke<string>("read_asset_base64", { path: src });
      urlBlob.current = await versUrlLecture(dataUrl);

      const a = new Audio(urlBlob.current);
      a.volume = volumeRetenu();
      a.addEventListener("timeupdate", () => setPosition(a.currentTime));
      a.addEventListener("loadedmetadata", () => setDuree(a.duration));
      a.addEventListener("ended", () => {
        setEtat("pause");
        setPosition(0);
      });
      a.addEventListener("pause", () => setEtat((e) => (e === "lecture" ? "pause" : e)));
      a.addEventListener("error", () => setEtat("erreur"));
      audio.current = a;
      return a;
    } catch (err) {
      console.error(`Lecture audio impossible (${src}) :`, err);
      setEtat("erreur");
      return null;
    }
  };

  const basculer = async () => {
    if (etat === "lecture") {
      audio.current?.pause();
      return;
    }
    const a = await preparer();
    if (!a) return;
    if (lectureEnCours && lectureEnCours !== a) lectureEnCours.pause();
    lectureEnCours = a;
    try {
      await a.play();
      setEtat("lecture");
    } catch (err) {
      console.error("Lecture refusée :", err);
      setEtat("erreur");
    }
  };

  const icone = etat === "lecture" ? "⏸" : etat === "chargement" ? "…" : etat === "erreur" ? "⚠" : "▶";
  const titre =
    etat === "erreur"
      ? tr(
          "Ce fichier ne peut pas être lu (introuvable ou format non pris en charge)",
          "This file can't be played (missing or unsupported format)"
        )
      : etat === "lecture"
        ? "Pause"
        : tr("Écouter", "Play");

  return (
    <NodeViewWrapper
      as="span"
      className="pk-pagelink pk-audio"
      data-selected={selected ? "true" : undefined}
      data-etat={etat}
      data-drag-handle
    >
      <button
        className="pk-audio-play"
        title={titre}
        // Garder le focus dans l'éditeur : sinon le clic sort de la note.
        onMouseDown={(e) => e.preventDefault()}
        onClick={basculer}
        disabled={etat === "chargement"}
      >
        {icone}
      </button>
      <span className="pk-audio-name" title={name}>
        {name}
      </span>
      {(etat === "lecture" || etat === "pause") && (
        <>
          {/* Barre de lecture et volume (recette du 13/09). Les curseurs gardent la
              souris pour eux : sinon l'éditeur y verrait le début d'un glisser de la puce. */}
          <input
            className="pk-audio-seek"
            type="range"
            min={0}
            max={Number.isFinite(duree) ? duree : 0}
            step={0.1}
            value={Math.min(position, Number.isFinite(duree) ? duree : 0)}
            draggable={false}
            title={tr("Se déplacer dans le son", "Seek")}
            aria-label={tr("Position de lecture", "Playback position")}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const t = Number(e.target.value);
              if (audio.current) audio.current.currentTime = t;
              setPosition(t);
            }}
          />
          <span className="pk-audio-time">
            {formatDuree(position)} / {formatDuree(duree)}
          </span>
          <span className="pk-audio-volume" title={tr("Volume", "Volume")}>
            {volume === 0 ? "🔇" : "🔊"}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              draggable={false}
              aria-label={tr("Volume", "Volume")}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                retenirVolume(v);
                if (audio.current) audio.current.volume = v;
              }}
            />
          </span>
        </>
      )}
      <button
        className="pk-pagelink-remove"
        title={tr("Retirer ce fichier audio", "Remove this audio file")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => deleteNode()}
      >
        ✕
      </button>
    </NodeViewWrapper>
  );
}

export const AudioClip = Node.create({
  name: "audioClip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-audio-src"),
        renderHTML: (attributes) => ({ "data-audio-src": attributes.src }),
      },
      name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-audio-name") ?? "",
        renderHTML: (attributes) => ({ "data-audio-name": attributes.name }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-audio-src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "pk-audio" })];
  },

  addCommands() {
    return {
      insertAudioClip:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs },
            { type: "text", text: " " },
          ]),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioClipView);
  },
});

/**
 * Enregistre le fichier dans les assets du projet puis insère la puce.
 *
 * Contrairement à l'image, AUCUN repli en data-URI : un son de plusieurs
 * mégaoctets recopié dans le document alourdirait la base à chaque frappe. Si
 * l'écriture échoue, on le dit et on n'insère rien.
 */
export async function insertAudioFile(editor: Editor, projectId: string | null, file: File): Promise<boolean> {
  if (file.size > AUDIO_MAX_OCTETS) {
    notify(
      false,
      `« ${file.name} » fait ${(file.size / 1024 / 1024).toFixed(0)} Mo : la limite est de ${
        AUDIO_MAX_OCTETS / 1024 / 1024
      } Mo par fichier audio.`
    );
    return false;
  }
  if (!projectId) {
    notify(false, tr("Ouvre un projet avant d'ajouter un fichier audio.", "Open a project before adding an audio file."));
    return false;
  }

  const brute = file.name.split(".").pop()?.toLowerCase() ?? "";
  const ext = AUDIO_EXTENSIONS.includes(brute) ? brute : "mp3";

  try {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const src = await invoke<string>("save_asset", { projectId, ext, bytes });
    editor.chain().focus().insertAudioClip({ src, name: file.name }).run();
    return true;
  } catch (err) {
    console.error("Enregistrement audio :", err);
    notify(
      false,
      tr(
        `« ${file.name} » n'a pas pu être enregistré : ${err instanceof Error ? err.message : String(err)}`,
        `“${file.name}” couldn't be saved: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return false;
  }
}
