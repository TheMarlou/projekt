import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useBlocksStore } from "../store/blocksStore";
import { useProjectsStore } from "../store/projectsStore";
import { rechercher } from "../lib/recherche";

/**
 * Recherche globale (Ctrl+P, ou le bouton de la barre du haut) : toutes les
 * pages de tous les projets, résultats pendant la frappe, ↑ ↓ pour choisir,
 * Entrée pour ouvrir. Le projet ouvert passe en premier à score égal.
 */
export default function Recherche({
  ouvert,
  projetCourant,
  onFermer,
  onOuvrirPage,
}: {
  ouvert: boolean;
  projetCourant: string | null;
  onFermer: () => void;
  onOuvrirPage: (id: string) => void;
}) {
  const [requete, setRequete] = useState("");
  const [choisi, setChoisi] = useState(0);
  const pages = useBlocksStore((s) => s.blocks);
  const projets = useProjectsStore((s) => s.projects);
  const liste = useRef<HTMLDivElement>(null);

  const noms = useMemo(() => new Map(projets.map((p) => [p.id, p.name || "Sans titre"])), [projets]);
  const resultats = useMemo(
    () => (ouvert ? rechercher(pages, noms, requete, projetCourant) : []),
    [ouvert, pages, noms, requete, projetCourant]
  );

  useEffect(() => {
    if (ouvert) {
      setRequete("");
      setChoisi(0);
    }
  }, [ouvert]);
  useEffect(() => setChoisi(0), [requete]);
  // Le résultat choisi au clavier reste visible dans la liste.
  useEffect(() => {
    liste.current?.querySelector(`[data-rang="${choisi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [choisi]);

  if (!ouvert) return null;

  const ouvrir = (i: number) => {
    const r = resultats[i];
    if (!r) return;
    onOuvrirPage(r.pageId);
    onFermer();
  };

  return (
    <div style={voile} onMouseDown={onFermer}>
      <div style={boite} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Rechercher dans les pages">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden style={{ color: "var(--text-dim)", flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            value={requete}
            onChange={(e) => setRequete(e.target.value)}
            placeholder="Rechercher dans toutes les pages…"
            onKeyDown={(e) => {
              if (e.key === "Escape") onFermer();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setChoisi((c) => Math.min(c + 1, resultats.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setChoisi((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                ouvrir(choisi);
              }
            }}
            style={champ}
          />
          <kbd style={{ fontSize: 10.5 }}>Échap</kbd>
        </div>

        <div ref={liste} className="scroll" style={{ maxHeight: "min(60vh, 460px)", overflowY: "auto", padding: 6 }}>
          {!requete.trim() && (
            <div style={vide}>Tape un mot : titre ou contenu, sans te soucier des accents ni des majuscules.</div>
          )}
          {requete.trim() && resultats.length === 0 && <div style={vide}>Aucune page ne contient « {requete.trim()} ».</div>}
          {resultats.map((r, i) => (
            <button
              key={r.pageId}
              data-rang={i}
              onMouseEnter={() => setChoisi(i)}
              onClick={() => ouvrir(i)}
              style={{ ...ligne, background: i === choisi ? "var(--surface-2)" : "transparent" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.titre}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.lieu}
                </span>
              </div>
              {r.extrait && (
                <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, marginTop: 2 }}>
                  {r.extrait.avant}
                  <mark style={surligne}>{r.extrait.trouve}</mark>
                  {r.extrait.apres}
                </div>
              )}
            </button>
          ))}
        </div>

        {resultats.length > 0 && (
          <div style={{ padding: "7px 14px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-dim)" }}>
            {resultats.length} page{resultats.length > 1 ? "s" : ""} · <kbd>↑</kbd> <kbd>↓</kbd> choisir · <kbd>Entrée</kbd> ouvrir
          </div>
        )}
      </div>
    </div>
  );
}

const voile: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-start",
  paddingTop: "12vh",
  zIndex: 100,
};

const boite: CSSProperties = {
  width: "min(620px, calc(100vw - 40px))",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
  overflow: "hidden",
};

const champ: CSSProperties = {
  flex: 1,
  border: "none",
  background: "transparent",
  color: "var(--text)",
  fontSize: 15,
  outline: "none",
};

const ligne: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const vide: CSSProperties = { padding: "14px 10px", fontSize: 12.5, color: "var(--text-dim)" };

const surligne: CSSProperties = {
  background: "var(--accent-soft)",
  color: "var(--accent)",
  borderRadius: 3,
  padding: "0 2px",
};
