import type { JSONContent } from "@tiptap/react";

// Document Tiptap vide (un paragraphe, comme en ouvrant une page blanche).
export function emptyDoc(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

// Convertit du texte brut en document Tiptap minimal : une ligne = un paragraphe.
// Utilisé pour migrer l'ancien contenu stocké en TEXT et pour le texte produit par l'IA.
export function textToDoc(text: string): JSONContent {
  const paragraphs = text.split("\n").map((line) =>
    line.trim() === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] }
  );
  return { type: "doc", content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }] };
}

// Extrait le texte brut d'un document Tiptap. Indispensable : les backlinks,
// le graphe et le contexte envoyé à l'IA travaillent sur du texte, pas sur des nœuds.
export function docToText(doc: JSONContent | null | undefined): string {
  if (!doc) return "";

  const lines: string[] = [];

  const walkInline = (nodes: JSONContent[] | undefined): string =>
    (nodes ?? [])
      .map((node) => {
        if (node.type === "text") return node.text ?? "";
        if (node.type === "hardBreak") return "\n";
        return walkInline(node.content);
      })
      .join("");

  const walkBlock = (nodes: JSONContent[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "text" || node.type === "hardBreak") {
        lines.push(walkInline([node]));
        continue;
      }
      // Un nœud dont les enfants sont du texte forme une ligne ; sinon on descend.
      const hasInlineChildren = (node.content ?? []).some((c) => c.type === "text" || c.type === "hardBreak");
      if (hasInlineChildren) {
        lines.push(walkInline(node.content));
      } else {
        walkBlock(node.content);
      }
    }
  };

  walkBlock(doc.content);
  return lines.join("\n");
}
