import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { notify } from "../../lib/notify";

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
  const name = (node.attrs.name as string) || "Fichier audio";

  const audio = useRef<HTMLAudioElement | null>(null);
  const urlBlob = useRef<string | null>(null);
  const [etat, setEtat] = useState<"repos" | "chargement" | "lecture" | "pause" | "erreur">("repos");
  const [position, setPosition] = useState(0);
  const [duree, setDuree] = useState(NaN);

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
      ? "Ce fichier ne peut pas être lu (introuvable ou format non pris en charge)"
      : etat === "lecture"
        ? "Pause"
        : "Écouter";

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
        <span className="pk-audio-time">
          {formatDuree(position)} / {formatDuree(duree)}
        </span>
      )}
      <button
        className="pk-pagelink-remove"
        title="Retirer ce fichier audio"
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
    notify(false, "Ouvre un projet avant d'ajouter un fichier audio.");
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
    notify(false, `« ${file.name} » n'a pas pu être enregistré : ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
