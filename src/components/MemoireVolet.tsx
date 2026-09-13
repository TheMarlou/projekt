import { useRef, useState, type CSSProperties } from "react";
import { tr } from "../lib/i18n";
import { RUBRIQUES, titreRubrique, type Rubrique } from "../lib/memoireProjet";
import { useMemoireStore } from "../store/memoireStore";

/**
 * La mémoire du projet, ouverte par le bouton 🧠 du panneau de l'assistant — à
 * part des pages (choix du 13/09). Tout se modifie à la main : clic sur une ligne
 * pour la corriger, 🗑 pour l'oublier, champ « + Ajouter » sous chaque rubrique.
 */
export default function MemoireVolet({
  projectId,
  active,
  style,
  titreStyle,
}: {
  projectId: string;
  active: boolean;
  style: CSSProperties;
  titreStyle: CSSProperties;
}) {
  const entrees = useMemoireStore((s) => s.entrees);
  const [edition, setEdition] = useState<{ id: string; texte: string } | null>(null);
  const [brouillons, setBrouillons] = useState<Partial<Record<Rubrique, string>>>({});
  // Échap ferme le champ : le « blur » qui suit ne doit pas enregistrer.
  const annule = useRef(false);

  const valider = () => {
    if (!edition) return;
    if (annule.current) {
      annule.current = false;
      return;
    }
    const texte = edition.texte.trim();
    const store = useMemoireStore.getState();
    if (texte) store.modifier(edition.id, texte);
    else store.supprimer(edition.id);
    setEdition(null);
  };

  const ajouter = (r: Rubrique) => {
    const texte = (brouillons[r] ?? "").trim();
    if (!texte) return;
    useMemoireStore.getState().ajouter(projectId, r, texte);
    setBrouillons((b) => ({ ...b, [r]: "" }));
  };

  return (
    <div className="scroll" style={style}>
      <div style={titreStyle}>{tr("Mémoire de ce projet", "This project's memory")}</div>
      <div style={aide}>
        {tr(
          "L'assistant relit cette mémoire à chaque question. Il n'y écrit jamais seul : il propose (« retiens que… », bouton Retenir), tu valides. Clique sur une ligne pour la corriger.",
          "The assistant rereads this memory for every question. It never writes here on its own: it suggests (“remember that…”, Remember button), you approve. Click a line to edit it."
        )}
      </div>
      {!active && (
        <div style={{ fontSize: 11.5, color: "var(--danger)" }}>
          {tr("La mémoire est désactivée dans les réglages (⚙) : l'assistant ne la lit pas.", "Memory is turned off in the settings (⚙): the assistant doesn't read it.")}
        </div>
      )}
      {RUBRIQUES.map((r) => {
        const lignes = entrees.filter((e) => e.projectId === projectId && e.rubrique === r);
        return (
          <div key={r} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={titreRubriqueStyle}>{titreRubrique(r)}</div>
            {lignes.map((e) =>
              edition?.id === e.id ? (
                <input
                  key={e.id}
                  autoFocus
                  value={edition.texte}
                  onChange={(ev) => setEdition({ id: e.id, texte: ev.target.value })}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") valider();
                    if (ev.key === "Escape") {
                      ev.stopPropagation();
                      annule.current = true;
                      setEdition(null);
                    }
                  }}
                  onBlur={valider}
                  style={champ}
                />
              ) : (
                <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                  <button onClick={() => setEdition({ id: e.id, texte: e.texte })} title={tr("Corriger", "Edit")} style={ligne}>
                    • {e.texte}
                  </button>
                  <button
                    onClick={() => useMemoireStore.getState().supprimer(e.id)}
                    title={tr("Oublier cette ligne", "Forget this line")}
                    style={discret}
                  >
                    🗑
                  </button>
                </div>
              )
            )}
            <input
              value={brouillons[r] ?? ""}
              placeholder={tr("+ Ajouter…", "+ Add…")}
              onChange={(ev) => setBrouillons((b) => ({ ...b, [r]: ev.target.value }))}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") ajouter(r);
              }}
              onBlur={() => ajouter(r)}
              style={{ ...champ, borderStyle: "dashed", background: "transparent" }}
            />
          </div>
        );
      })}
    </div>
  );
}

const aide: CSSProperties = { fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 };
const titreRubriqueStyle: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--accent)", marginTop: 4 };
const ligne: CSSProperties = {
  flex: 1,
  textAlign: "left",
  background: "none",
  border: "none",
  padding: "2px 0",
  color: "var(--text)",
  fontSize: 12.5,
  lineHeight: 1.45,
  cursor: "text",
  font: "inherit",
};
const discret: CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--text-dim)", padding: "2px 4px" };
const champ: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "4px 7px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12.5,
};
