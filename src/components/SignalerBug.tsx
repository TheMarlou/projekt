import { openUrl } from "@tauri-apps/plugin-opener";
import { toPng } from "html-to-image";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { rapportTechnique } from "../lib/journal";
import { DEPOT_GITHUB } from "../lib/misesAJour";
import { notify } from "../lib/notify";

/**
 * « Signaler un problème » (demande du 12/09) : par e-mail ou par ticket GitHub,
 * au choix. RIEN n'est envoyé par l'app : elle prépare le message dans la
 * messagerie ou le navigateur, où l'utilisateur le relit et l'envoie lui-même.
 * Journal technique et capture ne sont joints que s'il les coche, après les
 * avoir vus.
 */

/** Adresse dédiée aux signalements, à créer par Marlou — jamais son adresse perso. Vide = bouton désactivé. */
export const ADRESSE_BUGS = "";

interface Props {
  ouvert: boolean;
  onFermer: () => void;
}

export default function SignalerBug({ ouvert, onFermer }: Props) {
  const [description, setDescription] = useState("");
  const [journal, setJournal] = useState("");
  const [capture, setCapture] = useState<string | null>(null);
  const [joindreJournal, setJoindreJournal] = useState(false);
  const [joindreCapture, setJoindreCapture] = useState(false);
  const [voirJournal, setVoirJournal] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setDescription("");
    setJoindreJournal(false);
    setJoindreCapture(false);
    setVoirJournal(false);
    setCapture(null);
    void rapportTechnique().then(setJournal);
  }, [ouvert]);

  // Capture prise SEULEMENT si la case est cochée : rien n'est photographié pour
  // rien, et un gros moodboard ne ralentit pas l'ouverture de la fenêtre.
  useEffect(() => {
    if (!ouvert || !joindreCapture || capture) return;
    const racine = document.getElementById("root");
    if (!racine) return;
    toPng(racine, {
      pixelRatio: 1,
      // La fenêtre telle qu'elle est, SANS ce panneau de signalement.
      filter: (noeud) => !(noeud instanceof HTMLElement && noeud.dataset.signalement === "oui"),
    })
      .then(setCapture)
      .catch((err) => {
        console.warn("Capture d'écran impossible :", err);
        setJoindreCapture(false);
      });
  }, [ouvert, joindreCapture, capture]);

  useEffect(() => {
    if (!ouvert) return;
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer();
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [ouvert, onFermer]);

  if (!ouvert) return null;

  const titre = () => `Problème : ${description.trim().split("\n")[0].slice(0, 70) || "à décrire"}`;
  // Les adresses mailto: et les liens de ticket ont une longueur limitée.
  const corps = (limite: number) => {
    const parties = [description.trim() || "(pas de description)"];
    if (joindreJournal) parties.push("", "---- Journal technique ----", journal);
    const texte = parties.join("\n");
    return texte.length > limite ? `${texte.slice(0, limite)}\n[… tronqué]` : texte;
  };

  const copierCapture = async () => {
    if (!joindreCapture || !capture) return false;
    try {
      const image = await (await fetch(capture)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
      return true;
    } catch (err) {
      console.warn("Capture non copiée :", err);
      return false;
    }
  };

  const envoyer = async (par: "github" | "email") => {
    const copiee = await copierCapture();
    try {
      if (par === "github") {
        await openUrl(
          `https://github.com/${DEPOT_GITHUB}/issues/new?title=${encodeURIComponent(titre())}&body=${encodeURIComponent(corps(5500))}`
        );
      } else {
        await openUrl(
          `mailto:${ADRESSE_BUGS}?subject=${encodeURIComponent(`[Projekt] ${titre()}`)}&body=${encodeURIComponent(corps(1800))}`
        );
      }
    } catch (err) {
      notify(false, `Impossible d'ouvrir ${par === "github" ? "le navigateur" : "la messagerie"} : ${String(err)}`);
      return;
    }
    const ou = par === "github" ? "le ticket" : "le message";
    notify(
      true,
      copiee
        ? `${par === "github" ? "Ticket ouvert dans ton navigateur" : "Message préparé dans ta messagerie"}. La capture est copiée : colle-la dans ${ou} (Ctrl+V), puis envoie.`
        : `${par === "github" ? "Ticket ouvert dans ton navigateur" : "Message préparé dans ta messagerie"} : relis-le, puis envoie-le.`
    );
    onFermer();
  };

  return (
    <div data-signalement="oui" style={fond} onMouseDown={(e) => e.target === e.currentTarget && onFermer()}>
      <div role="dialog" aria-label="Signaler un problème" style={fenetre}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Signaler un problème</div>
        <p style={dim}>
          Décris ce que tu faisais et ce qui ne s'est pas passé comme prévu. Rien n'est envoyé d'ici : le message s'ouvre
          dans ta messagerie ou ton navigateur, et c'est toi qui l'envoies.
        </p>

        <textarea
          autoFocus
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex. : j'ai glissé une image dans le moodboard, elle a disparu au redémarrage."
          rows={5}
          style={zoneTexte}
        />

        <Case coche={joindreJournal} onChange={setJoindreJournal} titre="Joindre le journal technique">
          Version, système et dernières erreurs de l'app — jamais le contenu de tes pages.{" "}
          <button style={lien} onClick={() => setVoirJournal((v) => !v)}>
            {voirJournal ? "Masquer" : "Voir ce qui sera joint"}
          </button>
        </Case>
        {voirJournal && <pre style={apercuJournal}>{journal || "…"}</pre>}

        <Case
          coche={joindreCapture}
          onChange={setJoindreCapture}
          titre="Joindre une capture de la fenêtre"
        >
          {joindreCapture && !capture
            ? "Capture en cours…"
            : "Elle sera copiée : tu la colleras toi-même dans le message."}
        </Case>
        {capture && joindreCapture && <img src={capture} alt="Capture qui sera jointe" style={apercuCapture} />}

        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button style={boutonPrincipal} onClick={() => void envoyer("github")}>
            Créer un ticket GitHub
          </button>
          <button
            style={{ ...boutonSecondaire, opacity: ADRESSE_BUGS ? 1 : 0.5 }}
            disabled={!ADRESSE_BUGS}
            title={ADRESSE_BUGS ? `À ${ADRESSE_BUGS}` : "L'adresse de signalement n'est pas encore configurée"}
            onClick={() => void envoyer("email")}
          >
            Envoyer par e-mail
          </button>
          <button style={{ ...boutonSecondaire, marginLeft: "auto" }} onClick={onFermer}>
            Annuler
          </button>
        </div>
        <p style={{ ...dim, marginTop: 10, marginBottom: 0, fontSize: 11.5 }}>
          Un ticket GitHub demande un compte GitHub (gratuit) ; l'e-mail, non.
        </p>
      </div>
    </div>
  );
}

function Case({
  coche,
  onChange,
  titre,
  desactive = false,
  children,
}: {
  coche: boolean;
  onChange: (v: boolean) => void;
  titre: string;
  desactive?: boolean;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 12, opacity: desactive ? 0.6 : 1 }}>
      <input
        type="checkbox"
        checked={coche}
        disabled={desactive}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, accentColor: "var(--accent)" }}
      />
      <span style={{ fontSize: 13 }}>
        {titre}
        <span style={{ display: "block", fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{children}</span>
      </span>
    </label>
  );
}

const fond: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 90,
};

const fenetre: CSSProperties = {
  width: "min(520px, calc(100vw - 32px))",
  maxHeight: "calc(100vh - 48px)",
  overflowY: "auto",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 18,
  boxShadow: "0 18px 40px rgba(0,0,0,0.4)",
};

const dim: CSSProperties = { fontSize: 12.5, lineHeight: 1.5, color: "var(--text-dim)", margin: "0 0 12px" };

const zoneTexte: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  resize: "vertical",
  fontSize: 13,
  lineHeight: 1.5,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  fontFamily: "inherit",
};

const apercuJournal: CSSProperties = {
  maxHeight: 180,
  overflow: "auto",
  fontSize: 11,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 8,
  margin: "8px 0 0 25px",
  color: "var(--text-dim)",
};

const apercuCapture: CSSProperties = {
  display: "block",
  maxWidth: "calc(100% - 25px)",
  maxHeight: 160,
  margin: "8px 0 0 25px",
  borderRadius: 6,
  border: "1px solid var(--border)",
};

const lien: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  color: "var(--accent)",
  cursor: "pointer",
  fontSize: 12,
  textDecoration: "underline",
};

const boutonPrincipal: CSSProperties = {
  fontSize: 12.5,
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid var(--accent)",
  background: "var(--accent-soft)",
  color: "var(--accent)",
  cursor: "pointer",
};

const boutonSecondaire: CSSProperties = {
  fontSize: 12.5,
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
  cursor: "pointer",
};
