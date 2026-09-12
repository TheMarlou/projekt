import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { JSONContent } from "@tiptap/react";
import { useBlocksStore } from "../store/blocksStore";
import { useCanvasStore } from "../store/canvasStore";
import { useProjectsStore } from "../store/projectsStore";
import { enregistrerBrut, infosTikTok, lienTikTok, telechargerMiniature } from "./mediasMoodboard";
import { notify } from "./notify";

/**
 * Réception depuis Projekt Mobile, côté interface (demande du 12/09).
 *
 * La couche Rust (`telephone.rs`) reçoit, déchiffre et écrit chaque élément sur
 * disque AVANT de le confirmer au téléphone. Ici, on le range là où il a été
 * demandé, puis on efface sa fiche :
 * — images et vidéos TikTok → moodboard du projet choisi sur le téléphone ;
 * — texte, liens, MP3 → page « 📥 Reçu du téléphone » du projet, créée au besoin.
 * Une fiche qui n'a pas pu être rangée reste sur disque et sera reprise au
 * prochain démarrage : rien ne se perd.
 */

export const TITRE_PAGE_RECUS = "📥 Reçu du téléphone";
/** Un téléphone qui s'est manifesté plus récemment est affiché « connecté ». */
export const DELAI_CONNECTE_MS = 2 * 60 * 1000;

export interface AppareilAppaire {
  id: string;
  nom: string;
  ajouteLe: number;
  vuLe: number;
}

export interface EtatTelephone {
  actif: boolean;
  port: number | null;
  adresses: string[];
  nomPc: string;
  appairageEnCours: boolean;
  appareils: AppareilAppaire[];
}

export interface FicheRecue {
  id: string;
  genre: "texte" | "lien" | "image" | "audio";
  projet: string | null;
  texte: string | null;
  url: string | null;
  /** Nom d'origine du fichier (image, MP3). */
  nom: string | null;
  /** Chemin du fichier déjà écrit dans les assets du projet. */
  fichier: string | null;
  creeLe: number;
  recuLe: number;
  appareil: string;
}

export type VueReception = "notes" | "moodboard";
export type OuvrirReception = (projectId: string, vue: VueReception, pageId?: string) => void;

export const etatTelephone = () => invoke<EtatTelephone>("telephone_etat");
export const preparerAppairage = () => invoke<{ lien: string; expireLe: number }>("telephone_appairer");
export const annulerAppairage = () => invoke<void>("telephone_annuler_appairage");
export const oublierTelephone = (id: string) => invoke<void>("telephone_oublier", { id });

// Un téléphone vient de se manifester : le bouton 📱 met à jour son point vert.
const auditeursContact = new Set<() => void>();
export function surContact(auditeur: () => void): () => void {
  auditeursContact.add(auditeur);
  return () => {
    auditeursContact.delete(auditeur);
  };
}

function projetsTries() {
  return [...useProjectsStore.getState().projects].sort((a, b) => a.position - b.position);
}

/** Le projet choisi sur le téléphone ; s'il a été supprimé entre-temps, le premier projet. */
function projetDestination(id: string | null): string {
  const projets = projetsTries();
  if (id && projets.some((p) => p.id === id)) return id;
  return projets[0]?.id ?? useProjectsStore.getState().addProject("Reçu du téléphone");
}

function pageRecus(projectId: string): string {
  const existante = useBlocksStore
    .getState()
    .blocks.find((b) => b.projectId === projectId && !b.parentId && b.title === TITRE_PAGE_RECUS);
  if (existante) return existante.id;
  const id = useBlocksStore.getState().addBlock(projectId, null);
  useBlocksStore.getState().updateTitle(id, TITRE_PAGE_RECUS);
  return id;
}

// ——— Contenu de la page « Reçu du téléphone » ———————————————————————————————

const URL_DANS_TEXTE = /(https?:\/\/[^\s]+)/g;

/** Une ligne de texte, avec ses adresses web rendues cliquables. */
function enLigne(ligne: string): JSONContent[] {
  return ligne
    .split(URL_DANS_TEXTE)
    .filter((morceau) => morceau !== "")
    .map((morceau, i) =>
      // `split` avec un groupe capturant place les adresses aux rangs impairs.
      i % 2 === 1 || /^https?:\/\//.test(morceau)
        ? { type: "text", text: morceau, marks: [{ type: "link", attrs: { href: morceau } }] }
        : { type: "text", text: morceau }
    );
}

function paragraphe(contenu: JSONContent[]): JSONContent {
  return contenu.length ? { type: "paragraph", content: contenu } : { type: "paragraph" };
}

export function noeudsPourPage(fiche: FicheRecue): JSONContent[] {
  const quand = new Date(fiche.creeLe).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const noeuds: JSONContent[] = [
    paragraphe([
      { type: "text", text: `📱 ${quand}${fiche.appareil ? ` · ${fiche.appareil}` : ""}`, marks: [{ type: "italic" }] },
    ]),
  ];
  const texte = (fiche.texte ?? "").trim();
  if (texte) for (const ligne of texte.split(/\r?\n/)) noeuds.push(paragraphe(enLigne(ligne)));
  if (fiche.url && !texte.includes(fiche.url)) noeuds.push(paragraphe(enLigne(fiche.url)));
  if (fiche.genre === "audio" && fiche.fichier) {
    noeuds.push(paragraphe([{ type: "audioClip", attrs: { src: fiche.fichier, name: fiche.nom ?? "Son" } }]));
  }
  // Une image n'arrive ici que si le moodboard n'a pas pu la lire.
  if (fiche.genre === "image" && fiche.fichier) noeuds.push({ type: "image", attrs: { src: fiche.fichier, align: "none" } });
  return noeuds;
}

// ——— Moodboard ———————————————————————————————————————————————————————————————

/** À droite de tout ce qui est déjà posé : rien ne recouvre le travail en cours. */
function pointLibre(projectId: string): { x: number; y: number } {
  const items = useCanvasStore.getState().items.filter((i) => i.projectId === projectId);
  if (!items.length) return { x: 0, y: 0 };
  return {
    x: Math.max(...items.map((i) => i.x + i.width)) + 40,
    y: Math.min(...items.map((i) => i.y)),
  };
}

function enBase64(octets: Uint8Array): string {
  let binaire = "";
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

async function imageAuMoodboard(fichier: string, projectId: string) {
  const src = await invoke<string>("read_asset_base64", { path: fichier });
  const img = new Image();
  await new Promise<void>((ok, echec) => {
    img.onload = () => ok();
    img.onerror = () => echec(new Error("image illisible"));
    img.src = src;
  });
  const ratio = Math.min(1, 260 / Math.max(img.width, img.height));
  const point = pointLibre(projectId);
  useCanvasStore.getState().addItem({
    projectId,
    assetPath: fichier,
    src,
    x: point.x,
    y: point.y,
    width: img.width * ratio,
    height: img.height * ratio,
    crop: null,
  });
}

async function tiktokAuMoodboard(lien: string, projectId: string) {
  const infos = await infosTikTok(lien);
  const { octets, ext } = await telechargerMiniature(infos.miniature);
  const assetPath = await enregistrerBrut(projectId, ext, octets);
  const largeur = 180;
  const point = pointLibre(projectId);
  useCanvasStore.getState().addItem({
    projectId,
    genre: "tiktok",
    assetPath,
    src: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${enBase64(octets)}`,
    x: point.x,
    y: point.y,
    width: largeur,
    height: Math.round((largeur * infos.hauteur) / infos.largeur),
    crop: null,
    meta: { url: infos.url, videoId: infos.videoId, titre: infos.titre, auteur: infos.auteur },
  });
}

// ——— Rangement ———————————————————————————————————————————————————————————————

type Quoi = "image" | "vidéo TikTok" | "son" | "lien" | "note";
const PLURIELS: Record<Quoi, string> = {
  image: "images",
  "vidéo TikTok": "vidéos TikTok",
  son: "sons",
  lien: "liens",
  note: "notes",
};

interface Rangement {
  projectId: string;
  vue: VueReception;
  pageId?: string;
  quoi: Quoi;
}

async function ranger(fiche: FicheRecue): Promise<Rangement> {
  const projectId = projetDestination(fiche.projet);

  if (fiche.genre === "image" && fiche.fichier) {
    try {
      await imageAuMoodboard(fiche.fichier, projectId);
      return { projectId, vue: "moodboard", quoi: "image" };
    } catch (err) {
      console.warn("Image reçue rangée dans la page, le moodboard n'a pas pu la lire :", err);
    }
  }

  const tiktok = fiche.genre === "lien" || fiche.genre === "texte" ? lienTikTok(fiche.url ?? fiche.texte ?? "") : null;
  if (tiktok) {
    try {
      await tiktokAuMoodboard(tiktok, projectId);
      return { projectId, vue: "moodboard", quoi: "vidéo TikTok" };
    } catch (err) {
      // Hors ligne, vidéo privée… le lien reste utile dans la page.
      console.warn("TikTok reçu gardé en lien :", err);
    }
  }

  const pageId = pageRecus(projectId);
  useBlocksStore.getState().appendNodesToPage(pageId, noeudsPourPage(fiche));
  const quoi: Quoi =
    fiche.genre === "audio" ? "son" : fiche.genre === "image" ? "image" : fiche.genre === "lien" || tiktok ? "lien" : "note";
  return { projectId, vue: "notes", pageId, quoi };
}

let file: Promise<void> = Promise.resolve();
const dejaRanges = new Set<string>();
let ouvrir: OuvrirReception = () => {};

/** Range tout ce qui attend. Les appels s'enchaînent : jamais deux rangements en même temps. */
export function rangerRecus(): Promise<void> {
  file = file.then(async () => {
    const fiches = await invoke<FicheRecue[]>("telephone_recus").catch(() => [] as FicheRecue[]);
    const bilans = new Map<string, { vue: VueReception; pageId?: string; comptes: Map<Quoi, number> }>();

    for (const fiche of fiches) {
      if (dejaRanges.has(fiche.id)) continue;
      dejaRanges.add(fiche.id);
      try {
        const r = await ranger(fiche);
        await invoke("telephone_accuser", { id: fiche.id });
        const bilan = bilans.get(r.projectId) ?? { vue: r.vue, comptes: new Map<Quoi, number>() };
        bilan.vue = r.vue;
        bilan.pageId = r.pageId ?? bilan.pageId;
        bilan.comptes.set(r.quoi, (bilan.comptes.get(r.quoi) ?? 0) + 1);
        bilans.set(r.projectId, bilan);
      } catch (err) {
        dejaRanges.delete(fiche.id);
        console.error("Élément reçu non rangé :", err);
        notify(false, `Un élément reçu du téléphone n'a pas pu être rangé : ${err instanceof Error ? err.message : String(err)}. Il sera repris au prochain démarrage.`);
      }
    }

    for (const [projectId, bilan] of bilans) {
      const nom = useProjectsStore.getState().projects.find((p) => p.id === projectId)?.name ?? "ton projet";
      const resume = [...bilan.comptes]
        .map(([quoi, n]) => `${n} ${n > 1 ? PLURIELS[quoi] : quoi}`)
        .join(", ");
      notify(true, `Reçu du téléphone : ${resume} dans « ${nom} ».`, {
        label: "Voir",
        run: () => ouvrir(projectId, bilan.vue, bilan.pageId),
      });
    }
  });
  return file;
}

let demarree = false;

/** À appeler une fois les données chargées : sinon les projets et les pages seraient encore vides. */
export async function demarrerReception(ouvrirReception: OuvrirReception) {
  ouvrir = ouvrirReception;
  if (demarree) return;
  demarree = true;

  // Le téléphone affiche la liste des projets : la couche Rust ne lit pas la base.
  const envoyerProjets = () =>
    invoke("telephone_projets", { projets: projetsTries().map((p) => ({ id: p.id, nom: p.name })) }).catch(() => {});
  void envoyerProjets();
  useProjectsStore.subscribe((etat, avant) => {
    if (etat.projects !== avant.projects) void envoyerProjets();
  });

  try {
    await listen("telephone-recu", () => void rangerRecus());
    await listen("telephone-contact", () => auditeursContact.forEach((a) => a()));
  } catch {
    // Hors de la fenêtre Tauri (test dans un navigateur) : pas de réception.
    return;
  }
  // Ce qui est arrivé pendant que l'app était fermée ou pas encore prête.
  void rangerRecus();
}
