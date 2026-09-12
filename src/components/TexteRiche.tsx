import { Fragment, type CSSProperties, type ReactNode } from "react";
import { resolvePagePath } from "../lib/pagePath";
import { tr } from "../lib/i18n";

/**
 * Rendu léger de la réponse : **gras**, listes, titres, et surtout les pages
 * citées entre « » deviennent cliquables — l'assistant répond, et on remonte à
 * la source en un clic.
 */
export default function TexteRiche({
  texte,
  projectId,
  onOpenPage,
}: {
  texte: string;
  projectId?: string | null;
  /** Sans lui, les pages citées restent du texte. */
  onOpenPage?: (id: string) => void;
}) {
  const enLigne = (ligne: string, cle: string): ReactNode[] =>
    ligne.split(/(«[^»]{1,160}»|\*\*[^*]+\*\*)/g).map((morceau, i) => {
      if (morceau.startsWith("**") && morceau.endsWith("**")) return <strong key={`${cle}-${i}`}>{morceau.slice(2, -2)}</strong>;
      if (morceau.startsWith("«") && morceau.endsWith("»")) {
        const interieur = morceau.slice(1, -1).trim();
        const r = resolvePagePath(interieur, { fallbackProjectId: projectId });
        if (r.status === "ok" && onOpenPage) {
          return (
            <button key={`${cle}-${i}`} onClick={() => onOpenPage(r.pageId)} style={citation} title={tr("Ouvrir la page", "Open page")}>
              ↗ {interieur.split(">").pop()?.trim()}
            </button>
          );
        }
      }
      return <Fragment key={`${cle}-${i}`}>{morceau}</Fragment>;
    });

  // Les lignes d'un tableau Markdown se regroupent en un vrai tableau : affichées
  // telles quelles, « | Attaque | Dégâts | » était illisible dans une bulle.
  const lignes = texte.split("\n");
  const blocs: ReactNode[] = [];
  for (let i = 0; i < lignes.length; i++) {
    if (/^\s*\|.*\|\s*$/.test(lignes[i])) {
      const debut = i;
      const rangs: string[][] = [];
      while (i < lignes.length && /^\s*\|.*\|\s*$/.test(lignes[i])) {
        if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lignes[i])) {
          rangs.push(lignes[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        }
        i++;
      }
      i--;
      blocs.push(
        <table key={`t${debut}`} style={tableStyle}>
          <tbody>
            {rangs.map((r, n) => (
              <tr key={n}>
                {r.map((c, k) =>
                  n === 0 ? (
                    <th key={k} style={celluleStyle}>{enLigne(c, `t${debut}-${n}-${k}`)}</th>
                  ) : (
                    <td key={k} style={celluleStyle}>{enLigne(c, `t${debut}-${n}-${k}`)}</td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }
    blocs.push(<Fragment key={`l${i}`}>{ligneSimple(lignes[i], `l${i}`)}</Fragment>);
  }
  return <>{blocs}</>;

  function ligneSimple(ligne: string, cle: string): ReactNode {
        const titre = ligne.match(/^#{1,4}\s+(.*)$/);
        if (titre) return <div key={cle} style={{ fontWeight: 600, marginTop: 6 }}>{enLigne(titre[1], cle)}</div>;
        const puceListe = ligne.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (puceListe) {
          return (
            <div key={cle} style={{ display: "flex", gap: 6, paddingLeft: 4 }}>
              <span style={{ color: "var(--text-dim)" }}>•</span>
              <span>{enLigne(puceListe[1], cle)}</span>
            </div>
          );
        }
        if (!ligne.trim()) return <div key={cle} style={{ height: 6 }} />;
        return <div key={cle}>{enLigne(ligne, cle)}</div>;
  }
}

const tableStyle: CSSProperties = {
  borderCollapse: "collapse",
  margin: "6px 0",
  fontSize: 12,
  width: "100%",
};

const celluleStyle: CSSProperties = {
  border: "1px solid var(--border)",
  padding: "3px 6px",
  textAlign: "left",
  verticalAlign: "top",
};

const citation: CSSProperties = {
  display: "inline",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--accent)",
  borderRadius: 4,
  padding: "0 5px",
  fontSize: 12,
  cursor: "pointer",
};
