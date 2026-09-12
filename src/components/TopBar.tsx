import FileMenuButton from "./FileMenu";
import Logo from "./Logo";
import SaveStatus from "./SaveStatus";
import ThemeMenu from "./ThemeMenu";

export type ViewId = "notes" | "moodboard" | "graph";

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "notes", label: "Notes" },
  { id: "moodboard", label: "Moodboard" },
  { id: "graph", label: "Graph" },
];

interface TopBarProps {
  view: ViewId;
  onViewChange: (v: ViewId) => void;
  boardName: string;
  projectId: string | null;
  projectName: string | null;
  pageId: string | null;
  pageTitle: string | null;
  onRecherche: () => void;
}

export default function TopBar({
  view,
  onViewChange,
  boardName,
  projectId,
  projectName,
  pageId,
  pageTitle,
  onRecherche,
}: TopBarProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        height: 48,
        padding: "0 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        flexShrink: 0,
      }}
    >
      {/* Menu Fichier en premier, à gauche du logo, comme dans Word. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: -6 }}>
        <FileMenuButton projectId={projectId} projectName={projectName} pageId={pageId} pageTitle={pageTitle} />
        <span style={{ display: "flex", color: "var(--accent)" }}>
          <Logo size={18} />
        </span>
      </div>
      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{boardName}</span>
      <div style={{ display: "flex", gap: 4, marginLeft: 10 }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => onViewChange(v.id)}
            style={{
              fontSize: 12.5,
              padding: "5px 11px",
              borderRadius: 6,
              border: `1px solid ${view === v.id ? "var(--accent)" : "var(--border)"}`,
              background: view === v.id ? "var(--accent-soft)" : "transparent",
              color: view === v.id ? "var(--accent)" : "var(--text-dim)",
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Le témoin d'enregistrement est ici et non près du titre de page : le
          moodboard écrit lui aussi en base, et c'est même la vue qui écrit le
          plus. Dans la barre du haut, il couvre les trois vues. */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <SaveStatus />
        {/* Ctrl+K sert à insérer un lien dans l'éditeur : la recherche prend Ctrl+P, comme dans Notion. */}
        <button
          onClick={onRecherche}
          title="Rechercher dans toutes les pages — Ctrl+P"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--text-dim)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 8px 4px 10px",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Rechercher
          <kbd style={{ fontSize: 10.5 }}>Ctrl P</kbd>
        </button>
      </div>

      <ThemeMenu />
    </header>
  );
}
