import { useState, type CSSProperties } from "react";
import ContextMenu from "./editor/ContextMenu";
import { fileMenuGroups } from "../lib/fileActions";

interface FileMenuButtonProps {
  projectId: string | null;
  projectName: string | null;
  pageId: string | null;
  pageTitle: string | null;
}

/**
 * Menu « Fichier » : trois traits en haut à gauche, à côté du logo, comme dans
 * Word (demande du 11/09 — le bouton texte au milieu des vues prenait de la
 * place pour une action rare). Les entrées vivent dans `fileActions`.
 */
export default function FileMenuButton(props: FileMenuButtonProps) {
  const [ancre, setAncre] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAncre(ancre ? null : { x: r.left, y: r.bottom + 4 });
        }}
        title="Fichier — sauvegarder, importer, exporter"
        aria-label="Menu Fichier"
        aria-expanded={!!ancre}
        style={{ ...boutonStyle, background: ancre ? "var(--surface-2)" : "transparent" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {ancre && (
        <ContextMenu x={ancre.x} y={ancre.y} groups={fileMenuGroups(props)} onClose={() => setAncre(null)} />
      )}
    </>
  );
}

const boutonStyle: CSSProperties = {
  width: 30,
  height: 30,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  borderRadius: 6,
  border: "none",
  color: "var(--text-dim)",
  cursor: "pointer",
};
