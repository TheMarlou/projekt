import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { JSONContent } from "@tiptap/react";
import { consigneAnalyse, consigneComparaison } from "../../lib/aiPrompts";
import { markdownToDoc } from "../../lib/markdownToDoc";
import { notify } from "../../lib/notify";
import { modeleVision, voir } from "../../lib/ollama";
import { preparerImage } from "../../lib/vision";
import { useBlocksStore } from "../../store/blocksStore";
import type { CanvasItem } from "../../store/canvasStore";
import TexteRiche from "../TexteRiche";
import { tr, enAnglais } from "../../lib/i18n";

/**
 * L'IA regarde les images du moodboard — la partie « PureRef » de l'app.
 *
 * Une image : elle NOMME le style, l'explique, et donne des mots pour chercher
 * d'autres références (le besoin d'un débutant qui veut apprendre le
 * vocabulaire). Plusieurs images : elle les compare et recommande.
 *
 * Même règle que le reste de l'IA : rien n'arrive dans une page sans un clic
 * explicite sur « Ajouter à la page ».
 */

interface Props {
  images: CanvasItem[];
  targetPageId: string | null;
  targetPageTitle: string | null;
  onClose: () => void;
}

type Etat = "attente" | "analyse" | "fini" | "erreur" | "sans-modele";

export default function AnalyseVisuelle({ images, targetPageId, targetPageTitle, onClose }: Props) {
  const comparaison = images.length > 1;
  const [precision, setPrecision] = useState("");
  const [etat, setEtat] = useState<Etat>(comparaison ? "attente" : "analyse");
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState("");
  const [modele, setModele] = useState<string | null>(null);
  const [ajoutee, setAjoutee] = useState(false);
  const arret = useRef<AbortController | null>(null);
  const cle = images.map((i) => i.id).join(",");

  const lancer = async () => {
    arret.current?.abort();
    const controleur = new AbortController();
    arret.current = controleur;
    setTexte("");
    setErreur("");
    setAjoutee(false);

    const m = await modeleVision();
    setModele(m);
    if (!m) {
      setEtat("sans-modele");
      return;
    }
    setEtat("analyse");
    try {
      const preparees = await Promise.all(images.map((i) => preparerImage(i.src, i.crop)));
      const consigne = comparaison
        ? consigneComparaison(images.length, precision.trim())
        : consigneAnalyse(precision.trim());
      let cumul = "";
      for await (const morceau of await voir(consigne, preparees, m, controleur.signal)) {
        cumul += morceau;
        setTexte(sansConsigneRecopiee(cumul, consigne));
      }
      if (!cumul.trim()) throw new Error(tr("Le modèle n'a rien répondu.", "The model gave no answer."));
      setEtat("fini");
    } catch (err) {
      if (controleur.signal.aborted) return;
      setErreur(err instanceof Error ? err.message : String(err));
      setEtat("erreur");
    }
  };

  // Une image seule s'analyse tout de suite ; une comparaison attend qu'on ait pu
  // préciser la direction visée.
  useEffect(() => {
    if (!comparaison) void lancer();
    return () => arret.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  const ajouterALaPage = () => {
    if (!targetPageId || !texte.trim()) return;
    const noeuds: JSONContent[] = [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: comparaison ? tr("Comparaison visuelle", "Visual comparison") : tr("Analyse visuelle", "Visual analysis") }] },
      // Les images elles-mêmes accompagnent l'analyse : un texte qui décrit une
      // image qu'on ne voit plus perd l'essentiel.
      ...images.map((i) => ({ type: "image", attrs: { src: i.assetPath, align: "none", crop: i.crop } })),
      ...(markdownToDoc(texte).content ?? []),
    ];
    if (useBlocksStore.getState().appendNodesToPage(targetPageId, noeuds)) {
      setAjoutee(true);
      notify(true, tr(`Analyse ajoutée à « ${targetPageTitle || "Sans titre"} ».`, `Analysis added to “${targetPageTitle || "Untitled"}”.`));
    } else {
      notify(false, tr("La page visée n'existe plus.", "The target page no longer exists."));
    }
  };

  return (
    <div style={panneau} onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>
            ✦ {comparaison ? tr(`Comparer ${images.length} images`, `Compare ${images.length} images`) : tr("Analyse visuelle", "Visual analysis")}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {modele ? `${modele} · local` : "vision · local"}
          </span>
        </div>
        <button onClick={onClose} style={fermer} title={tr("Fermer", "Close")}>
          ×
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {images.map((i, n) => (
          <div key={i.id} style={{ position: "relative" }}>
            <img src={i.src} alt="" style={vignette} />
            {comparaison && <span style={numero}>{n + 1}</span>}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={precision}
          onChange={(e) => setPrecision(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void lancer()}
          placeholder={
            comparaison
              ? tr("Direction visée (facultatif) : ex. sombre et oppressant", "Target direction (optional): e.g. dark and oppressive")
              : tr("Une question sur l'image ? ex. quels symboles y vois-tu", "A question about the image? e.g. what symbols do you see")
          }
          style={champ}
        />
        <button onClick={() => void lancer()} disabled={etat === "analyse"} style={boutonPrincipal}>
          {etat === "attente" ? "Comparer" : "↻"}
        </button>
      </div>

      <div className="scroll" style={zoneTexte}>
        {etat === "attente" && (
          <p style={dim}>
            {tr(
              "Précise éventuellement l'ambiance que tu cherches, puis lance la comparaison. L'IA nommera le style de chaque image et te dira laquelle sert le mieux ta direction.",
              "Optionally describe the mood you're after, then start the comparison. The AI will name each image's style and tell you which one best serves your direction."
            )}
          </p>
        )}
        {etat === "sans-modele" && (
          <p style={dim}>
            {enAnglais ? (
              <>
                No model able to see images is installed. In a terminal: <code>ollama pull gemma3:4b</code> (3.3 GB, free,
                100% local).
              </>
            ) : (
              <>
                Aucun modèle capable de voir les images n'est installé. Dans un terminal : <code>ollama pull gemma3:4b</code>{" "}
                (3,3 Go, gratuit, 100 % local).
              </>
            )}
          </p>
        )}
        {etat === "erreur" && <p style={{ ...dim, color: "var(--danger)" }}>⚠ {erreur}</p>}
        {(etat === "analyse" || etat === "fini") && (
          <>
            {!texte && (
              <p style={dim}>
                <span className="pk-ia-pulse">●</span>{" "}
                {tr(
                  `L'IA regarde ${comparaison ? "les images" : "l'image"}… (le premier appel charge le modèle, comptez 10 à 30 s)`,
                  `The AI is looking at ${comparaison ? "the images" : "the image"}… (the first call loads the model, allow 10 to 30 s)`
                )}
              </p>
            )}
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              <TexteRiche texte={texte} />
            </div>
          </>
        )}
      </div>

      {etat === "fini" && (
        <button
          onClick={ajouterALaPage}
          disabled={!targetPageId || ajoutee}
          style={targetPageId && !ajoutee ? boutonPrincipal : bouton}
          title={
            targetPageId
              ? tr("Ajoute les images et l'analyse en bas de la page", "Adds the images and the analysis at the bottom of the page")
              : tr("Ouvre d'abord une page dans la vue Notes", "Open a page in the Notes view first")
          }
        >
          {ajoutee
            ? tr("✓ Ajoutée à la page", "✓ Added to the page")
            : targetPageId
              ? tr(`→ Ajouter à « ${targetPageTitle || "Sans titre"} »`, `→ Add to “${targetPageTitle || "Untitled"}”`)
              : tr("Ouvre une page pour y ajouter l'analyse", "Open a page to add the analysis to it")}
        </button>
      )}
    </div>
  );
}

const panneau: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  bottom: 40,
  width: 380,
  maxWidth: "calc(100% - 24px)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  borderRadius: 10,
  border: "1px solid var(--accent)",
  background: "var(--surface)",
  boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
  zIndex: 20,
  cursor: "default",
};

const fermer: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-dim)",
  fontSize: 16,
  width: 26,
  height: 26,
};

const vignette: CSSProperties = {
  width: 64,
  height: 64,
  objectFit: "cover",
  borderRadius: 5,
  border: "1px solid var(--border)",
  display: "block",
};

const numero: CSSProperties = {
  position: "absolute",
  top: 3,
  left: 3,
  minWidth: 16,
  height: 16,
  borderRadius: 8,
  background: "var(--accent)",
  color: "var(--bg)",
  fontSize: 10,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const champ: CSSProperties = {
  flex: 1,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "6px 9px",
  color: "var(--text)",
  fontSize: 12.5,
  outline: "none",
};

const zoneTexte: CSSProperties = {
  flex: 1,
  minHeight: 0,
  padding: "8px 10px",
  borderRadius: 6,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
};

const dim: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--text-dim)" };

const bouton: CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
};

const boutonPrincipal: CSSProperties = {
  ...bouton,
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "var(--bg)",
  fontWeight: 600,
};

/**
 * Un petit modèle recopie parfois une ligne de la consigne dans sa réponse
 * (mesuré : « Laquelle, ou quelle combinaison, sert le mieux la direction visée
 * — et pourquoi, concrètement. » sous le titre Recommandation). On retire toute
 * ligne identique à une ligne de la consigne — assez longue pour ne pas emporter
 * un simple titre comme « Style ».
 */
function sansConsigneRecopiee(texte: string, consigne: string): string {
  const normaliser = (l: string) => l.replace(/^[\s#*•-]+/, "").trim().toLowerCase();
  const recopiables = new Set(
    consigne
      .split("\n")
      .map(normaliser)
      .filter((l) => l.length > 25)
  );
  return texte
    .split("\n")
    .filter((l) => !recopiables.has(normaliser(l)))
    .join("\n");
}
