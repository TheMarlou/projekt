import { invoke } from "@tauri-apps/api/core";
import { tr } from "./i18n";

/**
 * Vidéos et liens TikTok dans le moodboard (demande du 11/09 : « je cherche
 * beaucoup d'inspiration sur TikTok »). Ses choix :
 * — les DEUX : glisser un fichier vidéo enregistré depuis TikTok, ou coller un lien ;
 * — un lien affiche sa MINIATURE, enregistrée sur le PC (visible hors ligne), et
 *   ne lance le lecteur TikTok qu'au clic ;
 * — une vidéo (fichier) se lit AU SURVOL, sans son, comme un GIF.
 */

export const EXTENSIONS_VIDEO = ["mp4", "webm", "mov", "m4v"];
/** Au-delà, la copie dans le projet et la lecture en mémoire deviennent pénibles. */
export const VIDEO_MAX_OCTETS = 300 * 1024 * 1024;

export function estVideo(fichier: File): boolean {
  const ext = fichier.name.split(".").pop()?.toLowerCase() ?? "";
  return fichier.type.startsWith("video/") || EXTENSIONS_VIDEO.includes(ext);
}

/** Écrit un fichier dans les assets du projet, EN BINAIRE (voir `save_asset_brut` côté Rust). */
export function enregistrerBrut(projectId: string, ext: string, octets: Uint8Array): Promise<string> {
  return invoke<string>("save_asset_brut", octets, { headers: { "x-projet": projectId, "x-ext": ext } });
}

/**
 * Image d'aperçu d'une vidéo (vers la première demi-seconde), montrée tant
 * qu'elle ne joue pas, et ses dimensions, pour cadrer l'élément.
 */
export async function apercuVideo(fichier: File): Promise<{ jpeg: Uint8Array; largeur: number; hauteur: number }> {
  const url = URL.createObjectURL(fichier);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((ok, ko) => {
      video.onloadedmetadata = () => ok();
      video.onerror = () => ko(new Error(tr("Ce format de vidéo n'est pas lisible ici (essaie un .mp4).", "This video format can't be played here (try an .mp4).")));
    });
    video.currentTime = Math.min(0.5, (video.duration || 1) / 3);
    await new Promise<void>((ok) => (video.onseeked = () => ok()));
    const echelle = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
    const toile = document.createElement("canvas");
    toile.width = Math.round(video.videoWidth * echelle);
    toile.height = Math.round(video.videoHeight * echelle);
    toile.getContext("2d")!.drawImage(video, 0, 0, toile.width, toile.height);
    const blob = await new Promise<Blob>((ok, ko) => toile.toBlob((b) => (b ? ok(b) : ko(new Error("aperçu impossible"))), "image/jpeg", 0.82));
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), largeur: video.videoWidth, hauteur: video.videoHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const TYPES_VIDEO: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
const videosEnMemoire = new Map<string, Promise<string>>();

/**
 * Adresse lisible par `<video>` pour un fichier du projet, chargée à la demande
 * (au premier survol) et gardée ensuite : lue en binaire, pas en base64.
 */
export function urlVideo(chemin: string): Promise<string> {
  let url = videosEnMemoire.get(chemin);
  if (!url) {
    url = invoke<ArrayBuffer>("lire_asset_brut", { path: chemin }).then((octets) => {
      const ext = chemin.split(".").pop()?.toLowerCase() ?? "mp4";
      return URL.createObjectURL(new Blob([octets], { type: TYPES_VIDEO[ext] ?? "video/mp4" }));
    });
    url.catch(() => videosEnMemoire.delete(chemin)); // un échec peut être retenté
    videosEnMemoire.set(chemin, url);
  }
  return url;
}

/** Libère la mémoire des vidéos chargées (en quittant le moodboard). */
export function oublierVideos() {
  for (const url of videosEnMemoire.values()) url.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  videosEnMemoire.clear();
}

/* --------------------------------------------------------------------------
 * TikTok
 * ------------------------------------------------------------------------ */

const LIEN_TIKTOK = /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/[^\s"'<>]+/i;

/** Le premier lien TikTok d'un texte collé, ou `null`. */
export function lienTikTok(texte: string): string | null {
  return texte.match(LIEN_TIKTOK)?.[0] ?? null;
}

export interface InfosTikTok {
  videoId: string;
  url: string;
  titre: string;
  auteur: string;
  miniature: string;
  largeur: number;
  hauteur: number;
}

/** Erreur à montrer telle quelle à l'utilisateur. */
export class ErreurTikTok extends Error {}

/**
 * Tout ce qu'il faut pour afficher un lien : l'identifiant de la vidéo (un lien
 * court est d'abord résolu), puis titre, auteur et miniature via le service
 * public de TikTok (sans compte). Seul ce numéro de vidéo part vers TikTok.
 */
export async function infosTikTok(lien: string): Promise<InfosTikTok> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ErreurTikTok(tr("Mince ! Vous êtes hors ligne : impossible de récupérer la vidéo TikTok.", "Oops! You're offline: the TikTok video can't be fetched."));
  }
  let adresse = lien.replace(/^http:/, "https:");
  if (!/\/video\/\d+/.test(adresse)) {
    // Lien court (« Partager » dans l'app mobile) : seule sa cible contient le numéro de la vidéo.
    adresse = await invoke<string>("resoudre_lien_tiktok", { url: adresse.split("?")[0].replace(/\/?$/, "/") }).catch((e) => {
      throw new ErreurTikTok(tr(`Ce lien TikTok n'a pas pu être ouvert : ${String(e)}`, `This TikTok link couldn't be opened: ${String(e)}`));
    });
  }
  const videoId = adresse.match(/\/video\/(\d+)/)?.[1];
  if (!videoId) throw new ErreurTikTok(
      tr(
        "Ce lien ne mène pas à une vidéo TikTok (un profil ou une musique ne peuvent pas s'ajouter).",
        "This link doesn't lead to a TikTok video (a profile or a sound can't be added)."
      )
    );

  let reponse: Response;
  try {
    reponse = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/video/${videoId}`)}`);
  } catch {
    throw new ErreurTikTok(tr("Mince ! Vous êtes hors ligne : impossible de récupérer la vidéo TikTok.", "Oops! You're offline: the TikTok video can't be fetched."));
  }
  if (!reponse.ok) throw new ErreurTikTok(tr("TikTok ne trouve pas cette vidéo : elle est peut-être privée ou supprimée.", "TikTok can't find this video: it may be private or deleted."));
  const j = (await reponse.json()) as {
    title?: string;
    author_name?: string;
    author_unique_id?: string;
    thumbnail_url?: string;
    thumbnail_width?: number;
    thumbnail_height?: number;
  };
  if (!j.thumbnail_url) throw new ErreurTikTok(tr("TikTok n'a pas fourni d'aperçu pour cette vidéo.", "TikTok didn't provide a preview for this video."));
  return {
    videoId,
    url: j.author_unique_id ? `https://www.tiktok.com/@${j.author_unique_id}/video/${videoId}` : `https://www.tiktok.com/video/${videoId}`,
    titre: (j.title ?? "").trim(),
    auteur: j.author_name || (j.author_unique_id ? `@${j.author_unique_id}` : ""),
    miniature: j.thumbnail_url,
    largeur: j.thumbnail_width || 576,
    hauteur: j.thumbnail_height || 1024,
  };
}

/** Télécharge la miniature, pour l'enregistrer dans le projet (les adresses de TikTok expirent). */
export async function telechargerMiniature(url: string): Promise<{ octets: Uint8Array; ext: string }> {
  const reponse = await fetch(url).catch(() => {
    throw new ErreurTikTok(tr("La miniature de la vidéo n'a pas pu être téléchargée.", "The video thumbnail couldn't be downloaded."));
  });
  if (!reponse.ok) throw new ErreurTikTok(tr("La miniature de la vidéo n'a pas pu être téléchargée.", "The video thumbnail couldn't be downloaded."));
  const type = reponse.headers.get("content-type") ?? "";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  return { octets: new Uint8Array(await reponse.arrayBuffer()), ext };
}

/** Le lecteur officiel de TikTok, lancé au clic (lecture auto, en boucle, sans les infos de la musique). */
export function lecteurTikTok(videoId: string): string {
  return `https://www.tiktok.com/player/v1/${videoId}?autoplay=1&loop=1&music_info=0&description=0&rel=0`;
}
