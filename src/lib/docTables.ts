import type { JSONContent } from "@tiptap/react";

/**
 * Tableaux au format du document, c'est-à-dire des nœuds Tiptap.
 *
 * L'ancien « tableau bloc » (une grille de champs à part du texte) a été retiré :
 * seul subsiste le tableau qui vit dans le flux, parce que lui seul peut être
 * déplacé, redimensionné et habillé par le texte. L'assistant IA passe donc par
 * ces fonctions plutôt que par une structure séparée. Pour CRÉER un tableau, il
 * écrit du Markdown, converti par `markdownToDoc`.
 */

/** Texte d'une cellule, quel que soit son emboîtement. */
function cellText(cell: JSONContent): string {
  const morceaux: string[] = [];
  const walk = (n: JSONContent | undefined) => {
    if (!n) return;
    if (n.type === "text" && n.text) morceaux.push(n.text);
    n.content?.forEach(walk);
  };
  walk(cell);
  return morceaux.join("");
}

/** Lit tous les tableaux d'un document, dans l'ordre, sous forme de lignes. */
export function readTables(doc: JSONContent | null | undefined): string[][][] {
  const tables: string[][][] = [];
  const walk = (n: JSONContent | null | undefined) => {
    if (!n) return;
    if (n.type === "table") {
      tables.push(
        (n.content ?? []).map((row) => (row.content ?? []).map((cell) => cellText(cell)))
      );
      return; // pas de tableau dans un tableau
    }
    n.content?.forEach(walk);
  };
  walk(doc);
  return tables;
}

/**
 * Ajoute des lignes au n-ième tableau du document (index à partir de 0).
 * Renvoie le document modifié, ou `null` si ce tableau n'existe pas — l'appelant
 * peut alors le signaler au lieu d'écrire dans le vide.
 */
export function appendRowsToTable(
  doc: JSONContent,
  index: number,
  rows: string[][]
): JSONContent | null {
  let rencontres = 0;
  let touche = false;

  const walk = (n: JSONContent): JSONContent => {
    if (n.type === "table") {
      if (rencontres++ !== index) return n;
      touche = true;
      // Des lignes ajoutées sont toujours des lignes de données : jamais d'en-têtes,
      // contrairement à la première ligne d'un tableau créé de zéro.
      const corps = rows.map((cells) => ({
        type: "tableRow",
        content: cells.map((valeur) => ({
          type: "tableCell",
          content: [
            valeur
              ? { type: "paragraph", content: [{ type: "text", text: valeur }] }
              : { type: "paragraph" },
          ],
        })),
      }));
      return { ...n, content: [...(n.content ?? []), ...corps] };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };

  const modifie = walk(doc);
  return touche ? modifie : null;
}
