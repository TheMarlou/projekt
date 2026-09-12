import type { JSONContent } from "@tiptap/react";

/**
 * Conversion d'un document Tiptap en Markdown, pour le volet « partage » de
 * l'export : un fichier qu'on peut lire sans Projekt.
 *
 * La conversion est VOLONTAIREMENT à sens unique. Le Markdown ne sait pas
 * exprimer une police, une taille, un habillage d'image ni un rognage : ces
 * réglages sont perdus ici, et c'est pour ça que la sauvegarde fidèle reste le
 * JSON. Ne jamais réimporter depuis ces fichiers.
 */

export interface MarkdownContext {
  /** Nom de fichier Markdown d'une page, pour lier les pages entre elles. */
  pageFile: (pageId: string) => string | null;
  /** Titre d'une page, quand la puce n'a que son identifiant. */
  pageTitle: (pageId: string) => string | null;
  /** Chemin d'archive d'une image, à partir de son chemin sur le disque. */
  assetFile: (diskPath: string) => string | null;
}

/**
 * Neutralise les caractères qui déclencheraient une mise en forme non voulue.
 * Volontairement restreint : échapper tous les points et tirets rendrait le
 * texte illisible dans un éditeur qui n'interprète pas le Markdown, pour un
 * risque quasi nul. On ne protège que ce qui casse vraiment le rendu.
 */
const A_ECHAPPER = new Set(["\\", "`", "*", "_", "[", "]", "|", "<", ">"]);

function echapper(texte: string): string {
  let sortie = "";
  for (const caractere of texte) {
    sortie += A_ECHAPPER.has(caractere) ? "\\" + caractere : caractere;
  }
  return sortie;
}

/**
 * Texte brut et ses marques → Markdown.
 *
 * Les espaces en bordure sortent des marques : un mot mis en gras AVEC l'espace
 * qui le suit donnait `** gras **`, que les lecteurs Markdown n'interprètent pas
 * (mesuré dans l'export du 11/09 : « le** gras **et »).
 */
function appliquerMarques(brut: string, marks: JSONContent["marks"]): string {
  if (!marks?.length) return echapper(brut);
  const avant = brut.match(/^\s*/)![0];
  const apres = brut.slice(avant.length).match(/\s*$/)![0];
  const coeur = brut.slice(avant.length, brut.length - apres.length);
  if (!coeur) return brut;

  const estCode = marks.some((m) => m.type === "code");
  // Dans du code, les échappements Markdown n'ont pas cours : on garde le brut.
  let sortie = estCode ? "`" + coeur.replace(/`/g, "") + "`" : echapper(coeur);
  let lien: string | null = null;

  for (const marque of marks) {
    switch (marque.type) {
      case "bold":
        sortie = `**${sortie}**`;
        break;
      case "italic":
        sortie = `*${sortie}*`;
        break;
      case "strike":
        sortie = `~~${sortie}~~`;
        break;
      case "underline":
        // Pas de souligné en Markdown : la balise HTML est rendue par GitHub,
        // Obsidian et la plupart des lecteurs.
        sortie = `<u>${sortie}</u>`;
        break;
      case "highlight":
        // Pas de surlignage en Markdown standard ; `==` est la convention la plus
        // répandue (Obsidian, Notion), et reste lisible là où elle n'est pas gérée.
        sortie = `==${sortie}==`;
        break;
      case "link":
        lien = typeof marque.attrs?.href === "string" ? marque.attrs.href : null;
        break;
    }
  }

  return avant + (lien ? `[${sortie}](${lien})` : sortie) + apres;
}

function inline(noeuds: JSONContent[] | undefined, ctx: MarkdownContext): string {
  if (!noeuds) return "";
  return noeuds
    .map((n) => {
      if (n.type === "text") return appliquerMarques(n.text ?? "", n.marks);
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "image") {
        const src = typeof n.attrs?.src === "string" ? n.attrs.src : "";
        const fichier = ctx.assetFile(src);
        return fichier ? `![](${fichier})` : "";
      }
      if (n.type === "audioClip") {
        // Le Markdown ne sait pas lire un son : on donne un lien vers le fichier
        // quand il est dans l'archive, sinon au moins son nom, pour qu'on sache
        // qu'il y avait quelque chose à écouter à cet endroit.
        const src = typeof n.attrs?.src === "string" ? n.attrs.src : "";
        const nom = echapper(typeof n.attrs?.name === "string" && n.attrs.name ? n.attrs.name : "fichier audio");
        const fichier = ctx.assetFile(src);
        return fichier ? `[🔊 ${nom}](${fichier})` : `🔊 ${nom}`;
      }
      if (n.type === "pageLink") {
        const id = typeof n.attrs?.pageId === "string" ? n.attrs.pageId : "";
        const titre = ctx.pageTitle(id) ?? "Page supprimée";
        const fichier = ctx.pageFile(id);
        // Une page absente de l'export (mention vers un autre projet) ne doit pas
        // produire un lien mort : on garde le titre en clair.
        return fichier ? `[${echapper(titre)}](${fichier})` : echapper(titre);
      }
      return inline(n.content, ctx);
    })
    .join("");
}

/** Une cellule de tableau doit tenir sur une ligne : les retours cassent la grille. */
function cellule(noeud: JSONContent, ctx: MarkdownContext): string {
  return (noeud.content ?? [])
    .map((p) => inline(p.content, ctx))
    .join(" ")
    .replace(/\n+/g, " ")
    .replace(/\|/g, "\|")
    .trim();
}

function tableau(noeud: JSONContent, ctx: MarkdownContext): string {
  const lignes = (noeud.content ?? []).map((row) => (row.content ?? []).map((c) => cellule(c, ctx)));
  if (lignes.length === 0) return "";
  const colonnes = Math.max(...lignes.map((l) => l.length));
  const normaliser = (l: string[]) => {
    const complete = [...l];
    while (complete.length < colonnes) complete.push("");
    return `| ${complete.join(" | ")} |`;
  };
  const [entete, ...corps] = lignes;
  return [
    normaliser(entete),
    `| ${Array(colonnes).fill("---").join(" | ")} |`,
    ...corps.map(normaliser),
  ].join("\n");
}

function liste(noeud: JSONContent, ctx: MarkdownContext, profondeur: number, ordonnee: boolean): string {
  const marge = "  ".repeat(profondeur);
  return (noeud.content ?? [])
    .map((item, i) => {
      const coche =
        item.type === "taskItem" ? (item.attrs?.checked ? "[x] " : "[ ] ") : "";
      const puce = ordonnee ? `${i + 1}. ` : "- ";
      const contenu = bloc(item.content, ctx, profondeur + 1).trim();
      // Les lignes suivantes d'un même point s'alignent sous son texte, sinon
      // elles sortent de la liste.
      const [premiere, ...suite] = contenu.split("\n");
      const reste = suite.map((l) => (l ? `${marge}  ${l}` : l));
      return [`${marge}${puce}${coche}${premiere}`, ...reste].join("\n");
    })
    .join("\n");
}

function bloc(noeuds: JSONContent[] | undefined, ctx: MarkdownContext, profondeur = 0): string {
  if (!noeuds) return "";
  const morceaux: string[] = [];

  for (const n of noeuds) {
    switch (n.type) {
      case "paragraph":
        morceaux.push(inline(n.content, ctx));
        break;
      case "heading":
        morceaux.push(`${"#".repeat(Number(n.attrs?.level) || 1)} ${inline(n.content, ctx)}`);
        break;
      case "bulletList":
        morceaux.push(liste(n, ctx, profondeur, false));
        break;
      case "orderedList":
        morceaux.push(liste(n, ctx, profondeur, true));
        break;
      case "taskList":
        morceaux.push(liste(n, ctx, profondeur, false));
        break;
      case "blockquote":
        morceaux.push(
          bloc(n.content, ctx, profondeur)
            .split("\n")
            .map((l) => `> ${l}`.trimEnd())
            .join("\n")
        );
        break;
      case "codeBlock": {
        const langue = typeof n.attrs?.language === "string" ? n.attrs.language : "";
        const texte = (n.content ?? []).map((c) => c.text ?? "").join("");
        morceaux.push(`\`\`\`${langue}\n${texte}\n\`\`\``);
        break;
      }
      case "horizontalRule":
        morceaux.push("---");
        break;
      case "table":
        morceaux.push(tableau(n, ctx));
        break;
      case "image": {
        // Une image seule dans le flux : même rendu, mais en bloc.
        const src = typeof n.attrs?.src === "string" ? n.attrs.src : "";
        const fichier = ctx.assetFile(src);
        if (fichier) morceaux.push(`![](${fichier})`);
        break;
      }
      default:
        if (n.content) morceaux.push(bloc(n.content, ctx, profondeur));
    }
  }

  return morceaux.filter((m) => m !== "").join("\n\n");
}

export function docToMarkdown(doc: JSONContent | null | undefined, ctx: MarkdownContext): string {
  if (!doc) return "";
  return bloc(doc.content, ctx).trim();
}
