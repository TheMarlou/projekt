import type { JSONContent } from "@tiptap/react";

/**
 * Markdown → document Tiptap, pour insérer ce qu'écrit l'IA.
 *
 * Les modèles écrivent spontanément en Markdown (titres, listes, **gras**,
 * tableaux). Inséré tel quel, ce texte apparaîtrait avec ses astérisques ; passé
 * par ici, il devient de vrais titres, de vraies listes, un vrai tableau — les
 * mêmes nœuds que ceux que l'utilisateur crée à la main.
 *
 * Volontairement tolérant : un Markdown approximatif donne un résultat lisible
 * plutôt qu'une erreur. Les titres sont plafonnés au niveau 3, le plus profond
 * que propose l'éditeur.
 */

const INLINE =
  /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(?<![\p{L}\p{N}])_([^_\s][^_]*)_(?![\p{L}\p{N}])|`([^`]+)`|~~([^~]+)~~|\[([^\]]+)\]\(([^)\s]+)\)/gu;

type Mark = { type: string; attrs?: Record<string, unknown> };

function texte(t: string, marks: Mark[] = []): JSONContent {
  return marks.length ? { type: "text", text: t, marks } : { type: "text", text: t };
}

/** Texte en ligne avec ses marques. Pas d'imbrication : suffisant pour ce qu'écrit un modèle. */
export function inlineMarkdown(source: string): JSONContent[] {
  const sortie: JSONContent[] = [];
  let curseur = 0;
  for (const m of source.matchAll(INLINE)) {
    const debut = m.index ?? 0;
    if (debut > curseur) sortie.push(texte(source.slice(curseur, debut)));
    const [, gras1, gras2, ital1, ital2, code, barre, lienTexte, lienUrl] = m;
    if (gras1 ?? gras2) sortie.push(texte(gras1 ?? gras2, [{ type: "bold" }]));
    else if (ital1 ?? ital2) sortie.push(texte(ital1 ?? ital2, [{ type: "italic" }]));
    else if (code) sortie.push(texte(code, [{ type: "code" }]));
    else if (barre) sortie.push(texte(barre, [{ type: "strike" }]));
    else if (lienTexte) sortie.push(texte(lienTexte, [{ type: "link", attrs: { href: lienUrl } }]));
    curseur = debut + m[0].length;
  }
  if (curseur < source.length) sortie.push(texte(source.slice(curseur)));
  // Un texte vide n'est pas un nœud valide pour ProseMirror.
  return sortie.filter((n) => n.text !== "");
}

function paragraphe(source: string): JSONContent {
  const contenu = inlineMarkdown(source.trim());
  return contenu.length ? { type: "paragraph", content: contenu } : { type: "paragraph" };
}

const RE_TITRE = /^(#{1,6})\s+(.*)$/;
const RE_REGLE = /^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/;
const RE_TACHE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const RE_PUCE = /^\s*[-*+•]\s+(.*)$/;
const RE_NUMERO = /^\s*(\d+)[.)]\s+(.*)$/;
const RE_CITATION = /^\s*>\s?(.*)$/;
const RE_TABLE = /^\s*\|.*\|\s*$/;
const RE_SEPARATEUR_TABLE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cellules(ligne: string): string[] {
  return ligne
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function tableau(lignes: string[]): JSONContent {
  const utiles = lignes.filter((l) => !RE_SEPARATEUR_TABLE.test(l));
  const grille = utiles.map(cellules);
  const largeur = Math.max(...grille.map((r) => r.length));
  return {
    type: "table",
    content: grille.map((cells, i) => ({
      type: "tableRow",
      content: Array.from({ length: largeur }, (_, j) => ({
        type: i === 0 ? "tableHeader" : "tableCell",
        content: [paragraphe(cells[j] ?? "")],
      })),
    })),
  };
}

export function markdownToDoc(markdown: string): JSONContent {
  const lignes = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocs: JSONContent[] = [];
  let i = 0;

  // Regroupe les lignes consécutives qui vérifient `test`.
  const tantQue = (test: (l: string) => boolean): string[] => {
    const lot: string[] = [];
    while (i < lignes.length && test(lignes[i])) lot.push(lignes[i++]);
    return lot;
  };

  while (i < lignes.length) {
    const ligne = lignes[i];
    const net = ligne.trim();

    if (!net) {
      i++;
      continue;
    }

    // Bloc de code : tout jusqu'à la clôture, sans interprétation.
    const cloture = net.match(/^```(\S*)/);
    if (cloture) {
      i++;
      const code = tantQue((l) => !l.trim().startsWith("```"));
      i++; // la clôture
      const contenu = code.join("\n");
      blocs.push({
        type: "codeBlock",
        attrs: { language: cloture[1] || null },
        ...(contenu ? { content: [{ type: "text", text: contenu }] } : {}),
      });
      continue;
    }

    const titre = net.match(RE_TITRE);
    if (titre) {
      blocs.push({
        type: "heading",
        attrs: { level: Math.min(titre[1].length, 3) },
        content: inlineMarkdown(titre[2].replace(/\s+#+\s*$/, "")),
      });
      i++;
      continue;
    }

    if (RE_REGLE.test(net)) {
      blocs.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    if (RE_TABLE.test(ligne)) {
      blocs.push(tableau(tantQue((l) => RE_TABLE.test(l) || RE_SEPARATEUR_TABLE.test(l))));
      continue;
    }

    if (RE_TACHE.test(ligne)) {
      const items = tantQue((l) => RE_TACHE.test(l)).map((l) => {
        const [, coche, contenu] = l.match(RE_TACHE)!;
        return { type: "taskItem", attrs: { checked: coche.toLowerCase() === "x" }, content: [paragraphe(contenu)] };
      });
      blocs.push({ type: "taskList", content: items });
      continue;
    }

    if (RE_PUCE.test(ligne)) {
      const items = tantQue((l) => RE_PUCE.test(l) && !RE_TACHE.test(l)).map((l) => ({
        type: "listItem",
        content: [paragraphe(l.match(RE_PUCE)![1])],
      }));
      blocs.push({ type: "bulletList", content: items });
      continue;
    }

    if (RE_NUMERO.test(ligne)) {
      const lot = tantQue((l) => RE_NUMERO.test(l));
      blocs.push({
        type: "orderedList",
        attrs: { start: Number(lot[0].match(RE_NUMERO)![1]) || 1 },
        content: lot.map((l) => ({ type: "listItem", content: [paragraphe(l.match(RE_NUMERO)![2])] })),
      });
      continue;
    }

    if (RE_CITATION.test(ligne)) {
      const lot = tantQue((l) => RE_CITATION.test(l)).map((l) => l.match(RE_CITATION)![1]);
      blocs.push({ type: "blockquote", content: [paragraphe(lot.join(" "))] });
      continue;
    }

    // Paragraphe : les lignes qui se suivent sans ligne vide forment un seul bloc.
    const lot = tantQue((l) => {
      const t = l.trim();
      return (
        t !== "" &&
        !RE_TITRE.test(t) &&
        !RE_REGLE.test(t) &&
        !RE_TABLE.test(l) &&
        !RE_PUCE.test(l) &&
        !RE_NUMERO.test(l) &&
        !RE_CITATION.test(l) &&
        !t.startsWith("```")
      );
    });
    if (lot.length === 0) {
      // Ligne qu'aucune règle ne revendique : on la garde en texte et on avance,
      // sinon la boucle tournerait sur place.
      blocs.push(paragraphe(lignes[i++]));
      continue;
    }
    blocs.push(paragraphe(lot.join(" ")));
  }

  return { type: "doc", content: blocs.length ? blocs : [{ type: "paragraph" }] };
}
