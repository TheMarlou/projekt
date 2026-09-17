import { openUrl } from "@tauri-apps/plugin-opener";
import { useRef, useState, type CSSProperties } from "react";
import { tr } from "../lib/i18n";
import { MODELES_CONSEILLES, telechargerModele, type ProgresTelechargement } from "../lib/ollama";

/**
 * Aide intégrée pour démarrer l'assistant sans taper de commande (demande du
 * 17/09, avant la publication) : installer Ollama, puis télécharger les modèles
 * depuis l'app avec une barre de progression.
 */
export default function AideOllama({
  etat,
  erreur,
  onReessayer,
  style,
}: {
  /** absent = Ollama ne répond pas ; sansModele = il répond, mais aucun modèle pour discuter. */
  etat: "absent" | "sansModele";
  erreur: string | null;
  onReessayer: () => void;
  style: CSSProperties;
}) {
  const [avecVision, setAvecVision] = useState(true);
  const [enCours, setEnCours] = useState<{ modele: string; progres: ProgresTelechargement } | null>(null);
  const [echec, setEchec] = useState<string | null>(null);
  const [voirDetail, setVoirDetail] = useState(false);
  const arret = useRef<AbortController | null>(null);

  const telecharger = async () => {
    const controleur = new AbortController();
    arret.current = controleur;
    setEchec(null);
    const modeles = avecVision ? MODELES_CONSEILLES : MODELES_CONSEILLES.slice(0, 1);
    try {
      for (const m of modeles) {
        setEnCours({ modele: m.nom, progres: { statut: "", fait: 0, total: 0 } });
        await telechargerModele(m.nom, (progres) => setEnCours({ modele: m.nom, progres }), controleur.signal);
      }
      setEnCours(null);
      onReessayer();
    } catch (err) {
      setEnCours(null);
      if (!controleur.signal.aborted) setEchec(err instanceof Error ? err.message : String(err));
    } finally {
      arret.current = null;
    }
  };

  if (etat === "absent") {
    return (
      <div style={style}>
        <strong style={{ color: "var(--text)" }}>{tr("L'assistant a besoin d'Ollama", "The assistant needs Ollama")}</strong>
        <span>
          {tr(
            "Ollama fait tourner l'intelligence artificielle sur ton ordinateur : gratuit, sans compte, rien ne part sur internet. Le reste de Projekt marche sans.",
            "Ollama runs the AI on your computer: free, no account, nothing goes online. The rest of Projekt works without it."
          )}
        </span>
        <ol style={etapes}>
          <li>
            <button onClick={() => void openUrl("https://ollama.com/download/windows")} style={boutonPrincipal}>
              {tr("Télécharger Ollama", "Download Ollama")}
            </button>{" "}
            {tr("(site officiel, environ 1 Go)", "(official site, about 1 GB)")}
          </li>
          <li>{tr("Installe-le, puis lance-le : un petit lama apparaît près de l'horloge.", "Install it, then start it: a small llama appears near the clock.")}</li>
          <li>
            <button onClick={onReessayer} style={boutonSecondaire}>
              ↻ {tr("C'est fait, vérifier", "Done, check again")}
            </button>
          </li>
        </ol>
        {erreur && (
          <button onClick={() => setVoirDetail((v) => !v)} style={lien}>
            {voirDetail ? tr("Masquer le détail", "Hide details") : tr("Détail technique", "Technical details")}
          </button>
        )}
        {erreur && voirDetail && <code style={{ fontSize: 11, color: "var(--danger)", wordBreak: "break-word" }}>{erreur}</code>}
      </div>
    );
  }

  const { progres } = enCours ?? { progres: null };
  const pourcent = progres && progres.total > 0 ? Math.floor((progres.fait / progres.total) * 100) : null;
  return (
    <div style={style}>
      <strong style={{ color: "var(--text)" }}>{tr("Ollama est prêt : il manque le modèle", "Ollama is ready: the model is missing")}</strong>
      <span>
        {tr(
          "Un seul téléchargement, depuis les serveurs d'Ollama. Ensuite, tout fonctionne hors ligne.",
          "A single download, from Ollama's servers. After that, everything works offline."
        )}
      </span>
      {MODELES_CONSEILLES.map((m, i) => (
        <label key={m.nom} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={i === 0 || avecVision}
            disabled={i === 0 || !!enCours}
            onChange={(e) => setAvecVision(e.target.checked)}
            style={{ accentColor: "var(--accent)", marginTop: 3 }}
          />
          <span>
            <code>{m.nom}</code> · {m.taille} — {m.role()}
            {i > 0 && ` ${tr("(facultatif)", "(optional)")}`}
          </span>
        </label>
      ))}
      {enCours ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {enCours.modele} — {pourcent !== null ? `${pourcent} % (${go(progres!.fait)} / ${go(progres!.total)})` : libelleStatut(progres!.statut)}
          </span>
          <div style={jauge}>
            <div style={{ ...jaugePleine, width: `${pourcent ?? 0}%` }} />
          </div>
          <button onClick={() => arret.current?.abort()} style={{ ...boutonSecondaire, alignSelf: "flex-start" }}>
            {tr("Interrompre (reprendra plus tard)", "Stop (resumes later)")}
          </button>
        </div>
      ) : (
        <button onClick={() => void telecharger()} style={{ ...boutonPrincipal, alignSelf: "flex-start" }}>
          {tr("Télécharger", "Download")} ({avecVision ? "8,5 Go" : MODELES_CONSEILLES[0].taille})
        </button>
      )}
      {echec && (
        <span style={{ color: "var(--danger)" }}>
          {tr("Téléchargement interrompu", "Download stopped")} : {echec}. {tr("Relance-le : il reprendra où il en était.", "Start it again: it will resume where it stopped.")}
        </span>
      )}
    </div>
  );
}

const go = (octets: number) => `${(octets / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Go`;

function libelleStatut(statut: string): string {
  if (!statut || statut.startsWith("pulling manifest")) return tr("préparation…", "preparing…");
  if (statut.startsWith("verifying")) return tr("vérification…", "verifying…");
  if (statut.startsWith("writing") || statut === "success") return tr("finalisation…", "finishing…");
  return statut;
}

const etapes: CSSProperties = { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 };
const jauge: CSSProperties = { height: 5, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" };
const jaugePleine: CSSProperties = { height: "100%", background: "var(--accent)", transition: "width 0.3s" };
const boutonPrincipal: CSSProperties = {
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--accent)",
  background: "var(--accent-soft)",
  color: "var(--accent)",
  cursor: "pointer",
};
const boutonSecondaire: CSSProperties = {
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
  cursor: "pointer",
};
const lien: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  color: "var(--text-dim)",
  cursor: "pointer",
  fontSize: 11,
  textDecoration: "underline",
  alignSelf: "flex-start",
};
