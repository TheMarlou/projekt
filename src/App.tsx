import { lazy, Suspense, useEffect, useState } from "react";
import TopBar, { ViewId } from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import RightPanel from "./components/RightPanel";
import NotesView from "./components/views/NotesView";
// Moodboard et carte mentale chargés à la première ouverture : l'app s'affiche
// plus vite, et beaucoup de sessions ne passent que par les notes.
const MoodboardView = lazy(() => import("./components/views/MoodboardView"));
const GraphView = lazy(() => import("./components/views/GraphView"));
import AIPanel from "./components/AIPanel";
import Notices from "./components/Notices";
import Recherche from "./components/Recherche";
import { useBlocksStore } from "./store/blocksStore";
import { useCanvasStore } from "./store/canvasStore";
import { useProjectsStore } from "./store/projectsStore";
import { useCarteStore } from "./store/carteStore";
import { demarrerReception } from "./lib/telephone";
import SignalerBug from "./components/SignalerBug";
import { EVENEMENT_SIGNALER } from "./lib/fileActions";
import { annoncerMiseAJour } from "./lib/misesAJour";

export default function App() {
  const { projects, addProject, renameProject, deleteProject, moveProject, hydrate: hydrateProjects } =
    useProjectsStore();
  const {
    blocks: allBlocks,
    addBlock,
    movePageTo,
    updateTitle,
    deleteBlockCascade,
    deleteBlocksByProject,
    addTextBlock,
    updateTextDoc,
    appendImageToPage,
    hydrate: hydrateBlocks,
  } = useBlocksStore();
  const { deleteItemsByProject, hydrate: hydrateCanvas } = useCanvasStore();
  const hydrateCarte = useCarteStore((s) => s.hydrate);

  const [ready, setReady] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("notes");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recherche, setRecherche] = useState(false);
  const [signalement, setSignalement] = useState(false);

  useEffect(() => {
    const ouvrir = () => setSignalement(true);
    window.addEventListener(EVENEMENT_SIGNALER, ouvrir);
    return () => window.removeEventListener(EVENEMENT_SIGNALER, ouvrir);
  }, []);

  // Ctrl+P ouvre la recherche partout (et empêche l'impression de la page, que
  // la vue web ferait sinon).
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setRecherche((o) => !o);
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, []);

  useEffect(() => {
    // Si SQLite est inaccessible (hors contexte Tauri, base corrompue...), l'app démarre
    // quand même en local plutôt que de rester bloquée indéfiniment sur l'écran de chargement.
    // La carte à part : ses tables (v6) manquent tant que l'app n'a pas migré,
    // et son échec ne doit pas faire croire que les pages n'ont pas chargé.
    hydrateCarte().catch((err) => console.error("Carte mentale non chargée :", err));
    Promise.all([hydrateProjects(), hydrateBlocks(), hydrateCanvas()])
      .catch((err) => console.error("Échec de l'hydratation depuis SQLite :", err))
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Réception depuis Projekt Mobile : seulement une fois les données chargées,
  // sinon un élément arrivé pendant le démarrage ne trouverait pas son projet.
  useEffect(() => {
    if (!ready) return;
    void annoncerMiseAJour();
    void demarrerReception((projectId, vue, pageId) => {
      setSelectedProjectId(projectId);
      if (pageId) setSelectedId(pageId);
      setView(vue);
    });
  }, [ready]);

  const project = projects.find((p) => p.id === selectedProjectId) ?? null;
  const pages = selectedProjectId ? allBlocks.filter((b) => b.projectId === selectedProjectId) : [];
  const selected = pages.find((b) => b.id === selectedId) ?? null;

  const handleAddProject = () => {
    const id = addProject();
    setSelectedProjectId(id);
    setSelectedId(null);
    setView("notes");
  };

  // Ouvrir un projet sur un écran vide n'apprend rien : on affiche sa première
  // page racine, celle qui est en tête de l'arborescence à gauche.
  const firstPageOf = (projectId: string): string | null => {
    const inProject = allBlocks.filter((b) => b.projectId === projectId);
    // « En tête » au sens de l'ordre choisi par l'utilisateur, pas de l'ordre en mémoire.
    const racines = inProject.filter((b) => !b.parentId).sort((a, b) => a.position - b.position);
    return (racines[0] ?? inProject[0])?.id ?? null;
  };

  const handleSelectProject = (id: string) => {
    setSelectedProjectId(id);
    setSelectedId(firstPageOf(id));
  };

  const handleDeleteProject = (id: string) => {
    deleteProject(id);
    deleteBlocksByProject(id);
    deleteItemsByProject(id);
    if (selectedProjectId === id) {
      setSelectedProjectId(null);
      setSelectedId(null);
    }
  };

  const handleAddRootPage = () => {
    if (!selectedProjectId) return;
    const id = addBlock(selectedProjectId, null);
    setSelectedId(id);
    setView("notes");
  };

  const handleCreateChildPage = () => {
    if (!selectedProjectId || !selected) return null;
    return addBlock(selectedProjectId, selected.id);
  };

  const handleOpenPage = (id: string) => {
    // La page peut vivre dans un autre projet (citation de l'assistant) : sans
    // changer de projet, elle serait sélectionnée mais introuvable à l'écran.
    const page = allBlocks.find((b) => b.id === id);
    if (page && page.projectId !== selectedProjectId) setSelectedProjectId(page.projectId);
    setSelectedId(id);
    setView("notes");
  };

  const handleDelete = (id: string) => {
    deleteBlockCascade(id);
    if (selectedId === id) setSelectedId(null);
  };

  if (!ready) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "var(--text-dim)",
          fontSize: 13.5,
        }}
      >
        Chargement de Projekt…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar
        view={view}
        onViewChange={setView}
        boardName={project ? project.name : "Aucun projet sélectionné"}
        projectId={selectedProjectId}
        projectName={project?.name ?? null}
        pageId={selected?.id ?? null}
        pageTitle={selected?.title ?? null}
        onRecherche={() => setRecherche(true)}
      />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          onAddProject={handleAddProject}
          onRenameProject={renameProject}
          onDeleteProject={handleDeleteProject}
          onMoveProject={moveProject}
          onMovePage={movePageTo}
          pages={pages}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAddRootPage={handleAddRootPage}
          onDelete={handleDelete}
        />

        {!selectedProjectId && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-dim)",
              fontSize: 13.5,
            }}
          >
            Choisis un projet à gauche, ou crée-en un : chacun a ses pages, son moodboard et son graphe.
          </div>
        )}

        {selectedProjectId && view === "notes" && (
          <NotesView
            page={selected}
            projectId={selectedProjectId}
            pages={pages}
            onTitleChange={(title) => selected && updateTitle(selected.id, title)}
            onTextChange={(contentId, doc) => selected && updateTextDoc(selected.id, contentId, doc)}
            onAddText={() => selected && addTextBlock(selected.id)}
            onCreateChildPage={handleCreateChildPage}
            onDeletePage={handleDelete}
            onOpenPage={handleOpenPage}
            onCreateRootPage={handleAddRootPage}
          />
        )}
        <Suspense fallback={<div style={{ flex: 1 }} />}>
        {selectedProjectId && view === "moodboard" && (
          <MoodboardView
            projectId={selectedProjectId}
            targetPageId={selectedId}
            targetPageTitle={selected?.title ?? null}
            onSendToPage={(assetPath) => selectedId && appendImageToPage(selectedId, assetPath)}
            onSendLinkToPage={(url, libelle) =>
              selectedId &&
              useBlocksStore.getState().appendNodesToPage(selectedId, [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: `▶ TikTok — ${libelle}`, marks: [{ type: "link", attrs: { href: url } }] }],
                },
              ])
            }
          />
        )}
        {selectedProjectId && view === "graph" && (
          <GraphView
            key={selectedProjectId}
            blocks={pages}
            projectId={selectedProjectId}
            projectName={project?.name ?? ""}
            onOpenBlock={handleOpenPage}
            onCreatePage={(parentId) => addBlock(selectedProjectId, parentId)}
            onRenamePage={updateTitle}
            onRenameProject={(nom) => renameProject(selectedProjectId, nom)}
            onMovePage={movePageTo}
          />
        )}
        </Suspense>

        {selectedProjectId && view === "notes" && (
          <RightPanel blocks={pages} selected={selected} onOpenBlock={handleOpenPage} />
        )}
      </div>

      <AIPanel
        activePage={selected}
        projectId={selectedProjectId}
        projectName={project?.name ?? null}
        onOpenPage={handleOpenPage}
      />
      <Notices />
      <SignalerBug ouvert={signalement} onFermer={() => setSignalement(false)} />
      <Recherche
        ouvert={recherche}
        projetCourant={selectedProjectId}
        onFermer={() => setRecherche(false)}
        onOuvrirPage={handleOpenPage}
      />
    </div>
  );
}
