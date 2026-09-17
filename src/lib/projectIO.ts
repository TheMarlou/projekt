import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { JSONContent } from "@tiptap/react";
import { useBlocksStore, type Block, type ContentBlock } from "../store/blocksStore";
import { useCanvasStore } from "../store/canvasStore";
import { useCarteStore } from "../store/carteStore";
import { useConversationsStore } from "../store/conversationsStore";
import { useMemoireStore } from "../store/memoireStore";
import { useProjectsStore } from "../store/projectsStore";
import { docToMarkdown, type MarkdownContext } from "./markdown";
import { parPosition } from "./reorder";
import {
  ARCHIVE_JSON,
  pourChaqueAsset,
  NOEUDS_A_FICHIER,
  baseName,
  buildArchive,
  estIntegre,
  nomDisponible,
  parseArchive,
  slug,
  type ArchivePage,
} from "./projectArchive";
import { tr } from "./i18n";

/**
 * « Sauvegarder sous » et son pendant import.
 *
 * Règle qui gouverne tout ce fichier : **un import ne remplace jamais rien**.
 * La sauvegarde est validée AVANT que quoi que ce soit soit créé, et le projet
 * restauré arrive à côté de l'existant. On n'a pas de corbeille ; un écrasement
 * serait définitif.
 */

export interface IOResult {
  ok: boolean;
  /** Message destiné à l'utilisateur, déjà rédigé. */
  message: string;
  /** Vrai quand l'utilisateur a simplement fermé le sélecteur de fichier. */
  annule?: boolean;
  /** Projet créé par un import réussi, pour l'ouvrir aussitôt. */
  projectId?: string;
}

const annulation: IOResult = { ok: true, message: "", annule: true };

function echec(quoi: string, err: unknown): IOResult {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`${quoi} :`, err);
  return { ok: false, message: `${quoi} : ${detail}` };
}

/* --------------------------------------------------------------------------
 * Export d'un projet entier
 * ------------------------------------------------------------------------ */

export async function exportProject(projectId: string): Promise<IOResult> {
  const archive = buildArchive(projectId);
  if (!archive) return { ok: false, message: tr("Ce projet est introuvable.", "This project can't be found.") };

  let destination: string | null;
  try {
    destination = await save({
      title: tr("Sauvegarder le projet sous…", "Save project as…"),
      defaultPath: archive.fileName,
      filters: [{ name: tr("Sauvegarde Projekt", "Projekt backup"), extensions: ["zip"] }],
    });
  } catch (err) {
    return echec(tr("Impossible d'ouvrir la fenêtre d'enregistrement", "Couldn't open the save window"), err);
  }
  if (!destination) return annulation;

  let manquantes = 0;
  try {
    manquantes = await invoke<number>("write_archive", {
      path: destination,
      files: archive.files,
      assets: archive.assets,
    });
  } catch (err) {
    return echec(tr("La sauvegarde n'a pas pu être écrite", "The backup couldn't be written"), err);
  }

  // Les « fichiers joints » regroupent images et sons : tous passent par le
  // même dossier d'assets.
  const joints = archive.assets.length - manquantes;
  const pages = archive.files.filter((f) => f.path.startsWith("pages/")).length;

  // Un fichier qui a disparu du disque ne doit pas passer inaperçu : la
  // sauvegarde existe, mais elle est incomplète, et seul l'utilisateur peut
  // décider quoi en faire.
  if (manquantes > 0) {
    return {
      ok: false,
      message: tr(
        `Projet sauvegardé dans ${baseName(destination)}, mais ${manquantes} fichier${
          manquantes > 1 ? "s joints sont introuvables" : " joint est introuvable"
        } sur le disque et n'y figure${manquantes > 1 ? "nt" : ""} pas.`,
        `Project saved to ${baseName(destination)}, but ${manquantes} attached file${manquantes > 1 ? "s are" : " is"} missing from disk and not included.`
      ),
    };
  }

  return {
    ok: true,
    message: tr(
      `Projet sauvegardé : ${pages} page${pages > 1 ? "s" : ""}${
        joints ? `, ${joints} fichier${joints > 1 ? "s" : ""} joint${joints > 1 ? "s" : ""}` : ""
      } dans ${baseName(destination)}.`,
      `Project saved: ${pages} page${pages > 1 ? "s" : ""}${
        joints ? `, ${joints} attached file${joints > 1 ? "s" : ""}` : ""
      } in ${baseName(destination)}.`
    ),
  };
}

/* --------------------------------------------------------------------------
 * Export d'une page seule, en Markdown lisible
 * ------------------------------------------------------------------------ */

/** Une page et toute sa descendance, dans l'ordre d'affichage. */
function branche(pages: Block[], racineId: string): Block[] {
  const enfants = (id: string): Block[] =>
    pages
      .filter((p) => p.parentId === id)
      .sort(parPosition)
      .flatMap((p) => [p, ...enfants(p.id)]);
  const racine = pages.find((p) => p.id === racineId);
  return racine ? [racine, ...enfants(racineId)] : [];
}

export async function exportPageMarkdown(pageId: string): Promise<IOResult> {
  const toutes = useBlocksStore.getState().blocks;
  const pages = branche(toutes, pageId);
  if (pages.length === 0) return { ok: false, message: tr("Cette page est introuvable.", "This page can't be found.") };

  // Les fichiers (images, sons) partent À CÔTÉ du texte, dans `assets/` — comme
  // l'export Markdown de Notion. La première version les intégrait en base64 dans
  // le .md : une seule image a donné une ligne de 2,1 millions de caractères,
  // qu'aucun éditeur n'ouvrait (recette du 11/09).
  const assets = new Map<string, string>();
  for (const page of pages) {
    for (const bloc of page.content) {
      pourChaqueAsset(bloc.doc, (noeud) => {
        const src = typeof noeud.attrs?.src === "string" ? noeud.attrs.src : "";
        if (src && !estIntegre(src) && !assets.has(src)) assets.set(src, `assets/${baseName(src)}`);
      });
    }
  }

  const titres = new Map(toutes.map((p) => [p.id, p.title || tr("Sans titre", "Untitled")]));
  const dansLeFichier = new Set(pages.map((p) => p.id));
  const contexte: MarkdownContext = {
    // Tout tient dans un seul fichier : une page de la branche devient une ancre
    // interne, une page hors branche reste du texte.
    pageFile: (id) => (dansLeFichier.has(id) ? `#${ancre(titres.get(id) ?? "")}` : null),
    pageTitle: (id) => titres.get(id) ?? null,
    assetFile: (src) => (estIntegre(src) ? src : assets.get(src) ?? null),
  };

  const corps = pages
    .map((page) => {
      const niveau = profondeur(toutes, page.id, pageId);
      const titre = `${"#".repeat(Math.min(niveau + 1, 6))} ${page.title || tr("Sans titre", "Untitled")}`;
      const texte = page.content
        .map((bloc) => docToMarkdown(bloc.doc, contexte))
        .filter((m) => m !== "")
        .join("\n\n");
      return `${titre}\n\n${texte}`.trim();
    })
    .join("\n\n");

  const nom = slug(pages[0].title || "page");
  let destination: string | null;
  try {
    destination = await save({
      title: tr("Exporter la page en Markdown", "Export page as Markdown"),
      defaultPath: `${nom}.zip`,
      filters: [{ name: tr("Markdown et fichiers joints", "Markdown and attached files"), extensions: ["zip"] }],
    });
  } catch (err) {
    return echec(tr("Impossible d'ouvrir la fenêtre d'enregistrement", "Couldn't open the save window"), err);
  }
  if (!destination) return annulation;

  let manquants = 0;
  try {
    manquants = await invoke<number>("write_archive", {
      path: destination,
      files: [{ path: `${nom}.md`, contents: `${corps}\n` }],
      assets: [...assets].map(([diskPath, path]) => ({ diskPath, path })),
    });
  } catch (err) {
    return echec(tr("Le fichier n'a pas pu être écrit", "The file couldn't be written"), err);
  }

  const sous = pages.length - 1;
  const joints = assets.size - manquants;
  const detail = [
    sous ? `${sous} sous-page${sous > 1 ? "s" : ""}` : "",
    joints ? `${joints} fichier${joints > 1 ? "s" : ""} joint${joints > 1 ? "s" : ""}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (manquants > 0) {
    return {
      ok: false,
      message: tr(
        `Page exportée dans ${baseName(destination)}, mais ${manquants} fichier${
          manquants > 1 ? "s joints sont introuvables" : " joint est introuvable"
        } sur le disque.`,
        `Page exported to ${baseName(destination)}, but ${manquants} attached file${manquants > 1 ? "s are" : " is"} missing from disk.`
      ),
    };
  }
  return {
    ok: true,
    message: tr(
      `Page exportée${detail ? ` (${detail})` : ""} dans ${baseName(destination)}.`,
      `Page exported${detail ? ` (${detail})` : ""} to ${baseName(destination)}.`
    ),
  };
}

/**
 * Ancre d'un titre Markdown, selon la convention de GitHub, reprise par la
 * plupart des lecteurs : minuscules, ponctuation retirée, espaces changés en
 * tirets — mais les ACCENTS CONSERVÉS. Un `slug` sans accents produirait un
 * lien mort vers « Épée légendaire ».
 */
function ancre(titre: string): string {
  return titre
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Nombre de niveaux entre une page et la racine de l'export. */
function profondeur(pages: Block[], id: string, racineId: string): number {
  let niveau = 0;
  let courant = pages.find((p) => p.id === id);
  while (courant && courant.id !== racineId && courant.parentId) {
    niveau++;
    courant = pages.find((p) => p.id === courant!.parentId);
  }
  return niveau;
}

/* --------------------------------------------------------------------------
 * Import
 * ------------------------------------------------------------------------ */

/** Copie un document en remplaçant les chemins d'image et les pages visées. */
function retracer(
  doc: JSONContent,
  assets: Record<string, string>,
  pages: Map<string, string>
): JSONContent {
  const copie = JSON.parse(JSON.stringify(doc)) as JSONContent;
  const parcourir = (n: JSONContent) => {
    if (n.type && NOEUDS_A_FICHIER.has(n.type) && n.attrs && typeof n.attrs.src === "string") {
      const remis = assets[n.attrs.src];
      if (remis) n.attrs.src = remis;
    }
    if (n.type === "pageLink" && n.attrs && typeof n.attrs.pageId === "string") {
      const remis = pages.get(n.attrs.pageId);
      // Une mention vers une page absente de la sauvegarde garde son ancien
      // identifiant : la puce affichera « Page supprimée » plutôt que de pointer
      // par erreur sur une page du projet importé.
      if (remis) n.attrs.pageId = remis;
    }
    n.content?.forEach(parcourir);
  };
  parcourir(copie);
  return copie;
}

export async function importProject(): Promise<IOResult> {
  let source: string | string[] | null;
  try {
    source = await open({
      title: tr("Ouvrir une sauvegarde Projekt", "Open a Projekt backup"),
      multiple: false,
      filters: [{ name: tr("Sauvegarde Projekt", "Projekt backup"), extensions: ["zip"] }],
    });
  } catch (err) {
    return echec(tr("Impossible d'ouvrir la fenêtre de sélection", "Couldn't open the file picker"), err);
  }
  if (!source || Array.isArray(source)) return annulation;
  return importerFichier(source);
}

/**
 * Projet d'exemple livré avec l'app (accueil du premier lancement) : une
 * sauvegarde .zip ordinaire, importée comme les autres.
 */
export async function importerExemple(): Promise<IOResult> {
  try {
    return await importerFichier(await resolveResource(CHEMIN_EXEMPLE));
  } catch (err) {
    return echec(tr("Projet d'exemple introuvable", "Sample project not found"), err);
  }
}

export const CHEMIN_EXEMPLE = "exemples/projet-exemple.zip";

export async function importerFichier(source: string): Promise<IOResult> {
  // 1. Lire et VALIDER avant de créer quoi que ce soit : un fichier étranger ne
  //    doit pas laisser derrière lui un projet à moitié construit.
  let brut: string;
  try {
    brut = await invoke<string>("read_archive_entry", { path: source, entry: ARCHIVE_JSON });
  } catch (err) {
    return echec(tr("Ce fichier ne peut pas être lu", "This file can't be read"), err);
  }

  let payload;
  try {
    payload = parseArchive(brut);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  // 2. Créer le projet, jamais à la place d'un autre.
  const nom = nomDisponible(payload.project.name);
  const projectId = useProjectsStore.getState().addProject(nom);

  // 3. Sortir les images dans le dossier du nouveau projet.
  let assets: Record<string, string> = {};
  try {
    assets = await invoke<Record<string, string>>("extract_archive_assets", {
      path: source,
      projectId,
    });
  } catch (err) {
    console.error("Extraction des images :", err);
  }

  // 4. Recréer les pages avec de nouveaux identifiants, puis rebrancher les
  //    puces entre elles.
  const nouveaux = new Map<string, string>(payload.pages.map((p: ArchivePage) => [p.id, crypto.randomUUID()]));
  const maintenant = Date.now();

  for (const page of payload.pages) {
    const contenu: ContentBlock[] = (page.content ?? [])
      .filter((c) => c?.doc)
      .map((c) => ({
        id: crypto.randomUUID(),
        type: "text" as const,
        doc: retracer(c.doc, assets, nouveaux),
      }));

    useBlocksStore.getState().insertPage({
      id: nouveaux.get(page.id)!,
      projectId,
      parentId: page.parentId ? nouveaux.get(page.parentId) ?? null : null,
      title: page.title ?? tr("Sans titre", "Untitled"),
      content: contenu.length ? contenu : [{ id: crypto.randomUUID(), type: "text", doc: { type: "doc", content: [] } }],
      createdAt: typeof page.createdAt === "number" ? page.createdAt : maintenant,
      updatedAt: typeof page.updatedAt === "number" ? page.updatedAt : maintenant,
    });
  }

  // 5. Le moodboard.
  let imagesMoodboard = 0;
  for (const item of payload.canvas) {
    const chemin = assets[item.asset];
    if (!chemin) continue;
    const genre = item.genre === "video" || item.genre === "tiktok" ? item.genre : "image";
    // L'aperçu d'une vidéo est un fichier de l'archive, lui aussi à retraduire.
    const meta = item.meta ? { ...item.meta, apercu: item.meta.apercu ? assets[item.meta.apercu] : undefined } : null;
    // Rien n'est lu ici : le moodboard lit ses images à son ouverture.
    useCanvasStore.getState().addItem({
      projectId,
      genre,
      assetPath: chemin,
      src: "",
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      crop: (item.crop as never) ?? null,
      meta,
    });
    imagesMoodboard++;
  }

  // 6. La carte mentale : bulles placées à la main, liens (identifiants de pages retraduits).
  const carte = useCarteStore.getState();
  for (const d of payload.carte.decalages) {
    const page = nouveaux.get(d.page);
    if (page) carte.deplacer(page, projectId, { dx: d.dx, dy: d.dy });
  }
  let liensCarte = 0;
  for (const l of payload.carte.liens) {
    const de = nouveaux.get(l.de), vers = nouveaux.get(l.vers);
    if (!de || !vers) continue;
    carte.ajouterLien({ projectId, de, vers, type: l.type, couleur: l.couleur, etiquette: l.etiquette, raison: l.raison });
    if (l.type !== "ia_rejete") liensCarte++;
  }

  // 7. Les conversations avec l'assistant (nouveaux identifiants : un import ne remplace rien).
  for (const c of payload.conversations) {
    useConversationsStore.getState().enregistrer({ id: crypto.randomUUID(), projectId, ...c });
  }

  // 8. La mémoire de l'assistant.
  for (const m of payload.memoire) {
    useMemoireStore.getState().ajouter(projectId, m.rubrique, m.texte, m.creeLe);
  }

  const pages = payload.pages.length;
  return {
    ok: true,
    message: tr(
      `« ${nom} » importé : ${pages} page${pages > 1 ? "s" : ""}${
        imagesMoodboard ? `, ${imagesMoodboard} élément${imagesMoodboard > 1 ? "s" : ""} au moodboard` : ""
      }${liensCarte ? `, ${liensCarte} lien${liensCarte > 1 ? "s" : ""} de carte` : ""}.`,
      `“${nom}” imported: ${pages} page${pages > 1 ? "s" : ""}${
        imagesMoodboard ? `, ${imagesMoodboard} moodboard item${imagesMoodboard > 1 ? "s" : ""}` : ""
      }${liensCarte ? `, ${liensCarte} map link${liensCarte > 1 ? "s" : ""}` : ""}.`
    ),
    projectId,
  };
}
