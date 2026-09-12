import type { JSONContent } from "@tiptap/react";
import type { Block } from "../store/blocksStore";
import { tr } from "./i18n";

/**
 * « ✦ Suggérer des liens » (étape 4 de la carte mentale, spécifiée le 11/09) :
 * l'IA lit les titres et débuts des pages, et propose des liens qui n'existent
 * pas encore, chacun avec une raison. Règle de toute l'IA de Projekt : elle
 * propose, l'utilisateur garde ou rejette — rien n'est ajouté sans lui.
 *
 * Ce fichier est pur (ni React ni réseau) : il se teste seul, contre Ollama.
 */

export interface PropositionLien {
  de: string; // identifiant de page
  vers: string;
  raison: string;
}

// Le modèle ne voit qu'un extrait de chaque page. Taille fixe de 170 car. : sur
// un projet de 26 pages, les faits utiles étaient souvent plus loin (« en
// mourant, il laisse tomber une perle de l'Ender », à la fin de la page). Le
// budget total est donc réparti entre les pages, dans ces bornes.
const BUDGET_EXTRAITS = 7000;
const EXTRAIT_MIN = 140;
const EXTRAIT_MAX = 420;
const PAGES_MAX = 45;
const PROPOSITIONS_MAX = 8;
const NOTIONS_MAX = 8;

/**
 * Les mots en GRAS d'une page : l'auteur y met ses notions clés (« perle de
 * l'Ender », « émeraudes »). Joints à l'extrait, ils montrent au modèle ce que
 * la page contient au-delà de ses premières lignes.
 */
export function notionsEnGras(page: Block): string[] {
  const vues = new Set<string>();
  const sortie: string[] = [];
  const visiter = (n: JSONContent) => {
    if (n.type === "text" && n.marks?.some((m) => m.type === "bold")) {
      const t = (n.text ?? "").trim().replace(/[.,;:!?]+$/, "");
      const cle = t.toLowerCase();
      if (t.length > 1 && t.length <= 40 && !vues.has(cle)) {
        vues.add(cle);
        sortie.push(t);
      }
    }
    n.content?.forEach(visiter);
  };
  page.content.forEach((c) => c.type === "text" && visiter(c.doc));
  return sortie.slice(0, NOTIONS_MAX);
}

/** Texte d'une page, mentions comprises (avec le titre de la page citée). */
export function texteDePage(page: Block, titreDe: (id: string) => string | undefined): string {
  const lire = (n: JSONContent): string => {
    if (n.type === "text") return n.text ?? "";
    if (n.type === "pageLink") return titreDe(String(n.attrs?.pageId)) ?? "";
    if (n.type === "audioClip") return `🔊 ${n.attrs?.name ?? ""}`;
    const dedans = (n.content ?? []).map(lire).join(n.type === "paragraph" || n.type === "heading" ? "" : " ");
    return n.type === "paragraph" || n.type === "heading" ? `${dedans} ` : dedans;
  };
  return page.content
    .map((c) => (c.type === "text" ? lire(c.doc) : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clé d'une paire de pages, sans sens : « A–B » et « B–A » ne font qu'un. */
export const paire = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Nom sous lequel le modèle voit chaque page. Le titre seul, sauf s'il est
 * porté par plusieurs pages : on précise alors le parent (« Boss > IA »).
 */
function etiquettes(pages: Block[]): Map<string, string> {
  const parId = new Map(pages.map((p) => [p.id, p]));
  const compte = new Map<string, number>();
  for (const p of pages) compte.set(p.title.trim(), (compte.get(p.title.trim()) ?? 0) + 1);
  return new Map(
    pages.map((p) => {
      const t = p.title.trim() || "Sans titre";
      const parent = p.parentId ? parId.get(p.parentId)?.title.trim() : "";
      return [p.id, (compte.get(p.title.trim()) ?? 0) > 1 && parent ? `${parent} > ${t}` : t];
    })
  );
}

/** Schéma de la réponse, imposé au modèle par Ollama (sorties structurées). */
export const SCHEMA_SUGGESTIONS = {
  type: "object",
  properties: {
    liens: {
      type: "array",
      items: {
        type: "object",
        properties: { de: { type: "string" }, vers: { type: "string" }, raison: { type: "string" } },
        required: ["de", "vers", "raison"],
      },
    },
  },
  required: ["liens"],
};

/** La demande envoyée au modèle. `dejaRelies` : paires à ne pas reproposer (existantes ou déjà rejetées). */
export function demandeSuggestions(pages: Block[], nomProjet: string, dejaRelies: Set<string>) {
  const noms = etiquettes(pages);
  const titreDe = (id: string) => pages.find((p) => p.id === id)?.title;
  // Les pages qui ont du contenu d'abord : ce sont elles qui portent des relations.
  const retenues = [...pages]
    .map((p) => ({ p, texte: texteDePage(p, titreDe) }))
    .sort((a, b) => Number(!!b.texte) - Number(!!a.texte))
    .slice(0, PAGES_MAX);
  const taille = Math.max(EXTRAIT_MIN, Math.min(EXTRAIT_MAX, Math.floor(BUDGET_EXTRAITS / Math.max(1, retenues.length))));
  const lignes = retenues.map(({ p, texte }) => {
    const extrait = texte.length > taille ? `${texte.slice(0, taille - 1)}…` : texte;
    const notions = notionsEnGras(p);
    return `- « ${noms.get(p.id)} »${extrait ? ` : ${extrait}` : " (page vide)"}${notions.length ? ` [notions clés : ${notions.join(", ")}]` : ""}`;
  });
  const existants = [...dejaRelies]
    .map((k) => k.split("|"))
    .filter(([a, b]) => noms.has(a) && noms.has(b))
    .slice(0, 40)
    .map(([a, b]) => `- « ${noms.get(a)} » — « ${noms.get(b)} »`);

  return [
    {
      role: "system" as const,
      content:
        tr(
          "Tu aides l'auteur d'un jeu vidéo à voir les relations entre les pages de son projet de game design. Tu réponds uniquement en JSON.",
          "Tu aides l'auteur d'un jeu vidéo à voir les relations entre les pages de son projet de game design. Tu réponds uniquement en JSON, et tu écris les « raison » en anglais (English)."
        ),
    },
    {
      role: "user" as const,
      content: [
        `Projet « ${nomProjet || "sans nom"} ». Ses pages (titre exact, puis début du contenu) :`,
        ...lignes,
        existants.length ? `\nLiens qui existent déjà — ne les propose pas :\n${existants.join("\n")}` : "",
        `\nPropose jusqu'à ${PROPOSITIONS_MAX} NOUVEAUX liens entre deux pages de cette liste, là où leur contenu montre une vraie relation : un personnage et un lieu, un boss et une quête, une ressource et une mécanique, deux personnages qui se connaissent…`,
        "Pour chaque lien : « de » et « vers » sont des titres EXACTS de la liste ; « raison » est une phrase courte (moins de 15 mots).",
        // Banc du 11/09 : « Kaela le suspecte », « les plans sont cachés là-bas » —
        // des intentions et des faits inventés. La raison doit tenir à ce qui est ÉCRIT.
        "La raison repose sur un fait écrit dans les deux pages (un nom, un lieu, un objet ou une ressource qu'elles partagent) ; n'invente ni intention, ni sentiment, ni événement.",
        "Classe les liens du plus évident au moins évident. Si peu de pages sont vraiment liées, propose moins de liens, voire aucun : un lien inventé est pire que pas de lien.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[«»"']/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Réponse du modèle → propositions sûres : titres retrouvés parmi les pages
 * (exactement, puis sans accents ni guillemets, puis par la fin d'un chemin),
 * ni boucle, ni lien déjà existant ou déjà rejeté, ni doublon.
 */
export function lirePropositions(reponse: unknown, pages: Block[], dejaRelies: Set<string>): PropositionLien[] {
  const noms = etiquettes(pages);
  const parNom = new Map<string, string>();
  for (const [id, nom] of noms) {
    parNom.set(norm(nom), id);
    if (!parNom.has(norm(nom.split(">").pop() ?? nom))) parNom.set(norm(nom.split(">").pop() ?? nom), id);
  }
  const trouver = (t: unknown) => {
    if (typeof t !== "string") return null;
    return parNom.get(norm(t)) ?? parNom.get(norm(t.split(">").pop() ?? t)) ?? null;
  };

  const liens = (reponse as { liens?: unknown })?.liens;
  if (!Array.isArray(liens)) return [];
  const vues = new Set(dejaRelies);
  const sortie: PropositionLien[] = [];
  for (const l of liens) {
    const de = trouver((l as { de?: unknown }).de);
    const vers = trouver((l as { vers?: unknown }).vers);
    const raison = String((l as { raison?: unknown }).raison ?? "").trim();
    if (!de || !vers || de === vers || !raison) continue;
    if (vues.has(paire(de, vers))) continue;
    vues.add(paire(de, vers));
    sortie.push({ de, vers, raison: raison.length > 140 ? `${raison.slice(0, 139)}…` : raison });
    if (sortie.length >= PROPOSITIONS_MAX) break;
  }
  return sortie;
}
