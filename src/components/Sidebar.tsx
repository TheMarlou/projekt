import { Fragment, useState } from "react";
import { Block, estDescendante } from "../store/blocksStore";
import { Project } from "../store/projectsStore";
import ContextMenu from "./editor/ContextMenu";
import { fileMenuGroups } from "../lib/fileActions";
import { useDragReorder, type Indicateur } from "./useDragReorder";
import { useDragArbre, type Repere } from "./useDragArbre";

interface SidebarProps {
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onMoveProject: (id: string, vers: number) => void;

  pages: Block[]; // toutes les pages du projet sélectionné
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddRootPage: () => void;
  onDelete: (id: string) => void;
  /** Range la page sous `parentId` (null = racine), avant `avantId` (null = en fin). */
  onMovePage: (id: string, parentId: string | null, avantId: string | null) => boolean;
}

const GROUPE_PROJETS = "projets";

/** Sous-pages de `parentId`, dans l'ordre choisi par l'utilisateur. */
const enfants = (pages: Block[], parentId: string | null) =>
  pages.filter((p) => p.parentId === parentId).sort((a, b) => a.position - b.position);

/** Trait qui montre où la ligne tombera si on la lâche maintenant. */
function LigneDepot({ retrait = 0 }: { retrait?: number }) {
  return (
    <div
      aria-hidden
      style={{
        height: 2,
        margin: `1px 4px 1px ${4 + retrait}px`,
        borderRadius: 1,
        background: "var(--accent)",
        boxShadow: "0 0 6px var(--accent)",
      }}
    />
  );
}

export default function Sidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onRenameProject,
  onDeleteProject,
  onMoveProject,
  pages,
  selectedId,
  onSelect,
  onAddRootPage,
  onDelete,
  onMovePage,
}: SidebarProps) {
  const { poignee, enCours, indicateur } = useDragReorder((id, _groupe, vers) => onMoveProject(id, vers));
  // Clic droit sur un projet : c'est le seul moyen de sauvegarder un projet
  // qu'on n'a pas ouvert, le bouton de la barre du haut agissant sur le courant.
  const [menuProjet, setMenuProjet] = useState<{ x: number; y: number; id: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const deplier = (id: string) => {
    if (!pages.some((p) => p.parentId === id)) return;
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  const arbre = useDragArbre({
    onDeposer: (id, { parentId, avantId }) => {
      // Rangée dans une page repliée, la page disparaîtrait de la vue : on
      // déplie son nouveau parent pour qu'on la voie arriver.
      if (onMovePage(id, parentId, avantId) && parentId) {
        setExpanded((prev) => (prev.has(parentId) ? prev : new Set(prev).add(parentId)));
      }
    },
    estInterdit: (source, cible) => cible === source || estDescendante(pages, cible, source),
    soeurSuivante: (id, exclure) => {
      const page = pages.find((p) => p.id === id);
      if (!page) return null;
      const soeurs = enfants(pages, page.parentId).filter((p) => p.id !== exclure);
      return soeurs[soeurs.findIndex((p) => p.id === id) + 1]?.id ?? null;
    },
    onSurvolProlonge: deplier,
  });

  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SectionHeader label={`Projets (${projects.length})`} onAdd={onAddProject} addTitle="Nouveau projet" />
      <div className="scroll" style={{ padding: "0 8px 6px", maxHeight: 168, overflowY: "auto" }}>
        {projects.length === 0 && (
          <p style={{ color: "var(--text-dim)", fontSize: 13, padding: "8px 6px" }}>
            Aucun projet. Le + ci-dessus en crée un.
          </p>
        )}
        {projects.map((p) => (
          <Fragment key={p.id}>
            {tombeAvant(indicateur, GROUPE_PROJETS, p.id) && <LigneDepot />}
            <Row
              label={p.name || "Sans titre"}
              active={selectedProjectId === p.id}
              onClick={() => onSelectProject(p.id)}
              onRename={(name) => onRenameProject(p.id, name)}
              onDelete={() => onDeleteProject(p.id)}
              onContextMenu={(x, y) => setMenuProjet({ x, y, id: p.id, name: p.name })}
              deplacement={poignee(p.id, GROUPE_PROJETS)}
              enDeplacement={enCours === p.id}
            />
          </Fragment>
        ))}
        {tombeAvant(indicateur, GROUPE_PROJETS, null) && <LigneDepot />}
      </div>

      <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

      <SectionHeader
        label={`Pages (${pages.length})`}
        onAdd={selectedProjectId ? onAddRootPage : undefined}
        addTitle="Nouvelle page"
      />
      <div className="scroll" style={{ flex: 1, padding: "0 8px 8px" }}>
        {!selectedProjectId && (
          <p style={{ color: "var(--text-dim)", fontSize: 13, padding: "8px 6px" }}>
            Sélectionne un projet pour voir ses pages.
          </p>
        )}
        {selectedProjectId && pages.length === 0 && (
          <p style={{ color: "var(--text-dim)", fontSize: 13, padding: "8px 6px" }}>
            Aucune page. Le + ci-dessus en crée une.
          </p>
        )}
        {selectedProjectId && (
          <PageTree
            pages={pages}
            parentId={null}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            onDelete={onDelete}
            expanded={expanded}
            toggleExpand={toggleExpand}
            glisser={arbre}
          />
        )}
        {arbre.repere?.type === "fin" && <LigneDepot />}
      </div>

      {menuProjet && (
        <ContextMenu
          x={menuProjet.x}
          y={menuProjet.y}
          onClose={() => setMenuProjet(null)}
          groups={fileMenuGroups({
            projectId: menuProjet.id,
            projectName: menuProjet.name,
            pageId: null,
            pageTitle: null,
            partage: false,
          })}
        />
      )}
    </aside>
  );
}

type Glisser = ReturnType<typeof useDragArbre>;

/** Vrai si le trait de dépôt doit s'afficher avant `avantId` (ou en fin de groupe si `null`). */
function tombeAvant(indicateur: Indicateur | null, groupe: string, avantId: string | null): boolean {
  return !!indicateur && indicateur.groupe === groupe && indicateur.avantId === avantId;
}

const traitIci = (repere: Repere | null, id: string, cote: "avant" | "apres") =>
  repere?.type === "ligne" && repere.ancreId === id && repere.cote === cote;

function PageTree({
  pages,
  parentId,
  depth,
  selectedId,
  onSelect,
  onDelete,
  expanded,
  toggleExpand,
  glisser,
}: {
  pages: Block[];
  parentId: string | null;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  glisser: Glisser;
}) {
  // Tri explicite par position : l'ordre du tableau en mémoire n'est pas une
  // garantie, seul l'ordre choisi par l'utilisateur fait foi.
  const children = enfants(pages, parentId);
  if (children.length === 0) return null;

  const retrait = depth * 14;

  return (
    <>
      {children.map((page) => {
        const sousPages = enfants(pages, page.id);
        const hasChildren = sousPages.length > 0;
        const isOpen = expanded.has(page.id);
        // Lâcher ici ferait de la page déplacée une sous-page de celle-ci.
        const cibleDedans = glisser.repere?.type === "dans" && glisser.repere.id === page.id;
        return (
          <div key={page.id}>
            {traitIci(glisser.repere, page.id, "avant") && <LigneDepot retrait={retrait} />}
            <div
              {...glisser.poignee(page.id, parentId, isOpen ? sousPages.map((p) => p.id) : [])}
              onClick={() => onSelect(page.id)}
              title="Glisser pour déplacer · lâcher au milieu d'une page pour en faire une sous-page"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                paddingLeft: 8 + retrait,
                paddingRight: 8,
                paddingTop: 7,
                paddingBottom: 7,
                borderRadius: 6,
                cursor: "pointer",
                background: cibleDedans
                  ? "var(--accent-soft)"
                  : selectedId === page.id
                    ? "var(--surface-2)"
                    : "transparent",
                outline: cibleDedans ? "1px solid var(--accent)" : "none",
                outlineOffset: -1,
                color: selectedId === page.id || cibleDedans ? "var(--text)" : "var(--text-dim)",
                fontSize: 13,
                marginBottom: 1,
                opacity: glisser.enCours === page.id ? 0.4 : 1,
              }}
            >
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(page.id);
                  }}
                  title={isOpen ? "Replier les sous-pages" : `Déplier les sous-pages (${sousPages.length})`}
                  style={{
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "transparent",
                    border: "none",
                    borderRadius: 3,
                    color: "var(--text-dim)",
                    fontSize: 12,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  {isOpen ? "▾" : "▸"}
                </button>
              ) : (
                <span style={{ width: 16, flexShrink: 0 }} />
              )}
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {page.title || "Sans titre"}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(page.id);
                }}
                title="Supprimer"
                style={{ background: "transparent", border: "none", color: "var(--text-dim)", fontSize: 13, padding: "0 3px" }}
              >
                ×
              </button>
            </div>
            {hasChildren && isOpen && (
              <PageTree
                pages={pages}
                parentId={page.id}
                depth={depth + 1}
                selectedId={selectedId}
                onSelect={onSelect}
                onDelete={onDelete}
                expanded={expanded}
                toggleExpand={toggleExpand}
                glisser={glisser}
              />
            )}
            {traitIci(glisser.repere, page.id, "apres") && <LigneDepot retrait={retrait} />}
          </div>
        );
      })}
    </>
  );
}

function SectionHeader({ label, onAdd, addTitle }: { label: string; onAdd?: () => void; addTitle: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 12px 8px" }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
        }}
      >
        {label}
      </span>
      {onAdd && (
        <button
          onClick={onAdd}
          title={addTitle}
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-dim)",
            lineHeight: 1,
            fontSize: 15,
          }}
        >
          +
        </button>
      )}
    </div>
  );
}

function Row({
  label,
  active,
  onClick,
  onRename,
  onDelete,
  onContextMenu,
  deplacement,
  enDeplacement = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onContextMenu?: (x: number, y: number) => void;
  /** Propriétés du geste de réordonnancement (voir `useDragReorder`). */
  deplacement?: ReturnType<ReturnType<typeof useDragReorder>["poignee"]>;
  enDeplacement?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  const startEditing = () => {
    setDraft(label);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== label) onRename(trimmed);
  };

  return (
    <div
      // Pendant le renommage, le champ garde la main : pas de glissement.
      {...(editing ? {} : deplacement)}
      onClick={editing ? undefined : onClick}
      onDoubleClick={editing ? undefined : startEditing}
      onContextMenu={
        onContextMenu && !editing
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(e.clientX, e.clientY);
            }
          : undefined
      }
      title={editing ? undefined : "Double-clic pour renommer, clic droit pour sauvegarder, glisser pour réordonner"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 8px",
        borderRadius: 6,
        cursor: editing ? "text" : "pointer",
        background: active ? "var(--surface-2)" : "transparent",
        color: active ? "var(--text)" : "var(--text-dim)",
        fontSize: 13,
        marginBottom: 2,
        opacity: enDeplacement ? 0.4 : 1,
      }}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          style={{
            flex: 1,
            background: "var(--surface)",
            border: "1px solid var(--accent)",
            borderRadius: 4,
            padding: "2px 5px",
            fontSize: 13,
            color: "var(--text)",
            outline: "none",
          }}
        />
      ) : (
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Supprimer"
        style={{ background: "transparent", border: "none", color: "var(--text-dim)", fontSize: 13, padding: "0 3px" }}
      >
        ×
      </button>
    </div>
  );
}
