import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { tr } from "../lib/i18n";
import { notify } from "../lib/notify";
import { importerExemple } from "../lib/projectIO";
import Fenetre, { boutonPrincipal, boutonSecondaire, texteDim } from "./Fenetre";
import Logo from "./Logo";
import { DetailStatistiques } from "./StatistiquesFenetre";
import { activerStatistiques, mesurer, statistiquesActivees, statistiquesDisponibles, suivreStatistiques } from "../lib/statistiques";

/** Déjà vu : l'accueil ne s'ouvre plus tout seul (il reste dans ☰ → Aide). */
const CLE_VU = "projekt-accueil-vu";

export function accueilDejaVu(): boolean {
  try {
    return localStorage.getItem(CLE_VU) === "1";
  } catch {
    return true;
  }
}

function marquerVu() {
  try {
    localStorage.setItem(CLE_VU, "1");
  } catch {
    /* stockage indisponible : l'accueil reviendra, sans gravité */
  }
}

/**
 * Accueil du premier lancement (demande du 17/09, avant la publication) : ce que
 * fait Projekt en quatre cartes, puis créer un projet ou ouvrir l'exemple.
 */
export default function Accueil({
  onFermer,
  onCreerProjet,
  onOuvrirProjet,
}: {
  onFermer: () => void;
  onCreerProjet: () => void;
  onOuvrirProjet: (projectId: string) => void;
}) {
  const [import_, setImport] = useState(false);
  const [detail, setDetail] = useState(false);
  const stats = useSyncExternalStore(suivreStatistiques, statistiquesActivees);

  const fermer = (choix: string) => {
    marquerVu();
    mesurer("accueil", { choix });
    onFermer();
  };

  const exemple = async () => {
    setImport(true);
    const r = await importerExemple();
    setImport(false);
    notify(r.ok, r.message);
    if (r.ok && r.projectId) {
      onOuvrirProjet(r.projectId);
      fermer("exemple");
    }
  };

  const cartes = [
    {
      icone: "📝",
      titre: tr("Notes", "Notes"),
      texte: tr("Des pages dans des pages : univers, personnages, mécaniques, avec images, tableaux et sons.", "Pages inside pages: world, characters, mechanics, with images, tables and sounds."),
    },
    {
      icone: "🖼",
      titre: tr("Moodboard", "Moodboard"),
      texte: tr("Une toile infinie pour tes images, vidéos et TikToks d'inspiration.", "An endless canvas for your inspiration images, videos and TikToks."),
    },
    {
      icone: "🕸",
      titre: tr("Carte mentale", "Mind map"),
      texte: tr("Ton projet au centre, tes pages autour, et les liens entre elles.", "Your project in the middle, your pages around it, and the links between them."),
    },
    {
      icone: "✨",
      titre: tr("Assistant (Ctrl+J)", "Assistant (Ctrl+J)"),
      texte: tr("Une IA sur ton PC qui lit tes pages et propose : rien ne change sans ton accord.", "An AI on your PC that reads your pages and suggests: nothing changes without your approval."),
    },
  ];

  return (
    <Fenetre titre={tr("Bienvenue dans Projekt", "Welcome to Projekt")} largeur={600} onFermer={() => fermer("fermee")}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={pastille}>
            <Logo size={26} />
          </span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{tr("Bienvenue dans Projekt", "Welcome to Projekt")}</div>
            <p style={texteDim}>
              {tr("Tout ton projet de jeu au même endroit, et tout reste sur ton ordinateur.", "Your whole game project in one place, and everything stays on your computer.")}
            </p>
          </div>
        </div>

        <div style={grille}>
          {cartes.map((c) => (
            <div key={c.titre} style={carte}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                <span aria-hidden style={{ marginRight: 6 }}>
                  {c.icone}
                </span>
                {c.titre}
              </div>
              <p style={{ ...texteDim, fontSize: 12 }}>{c.texte}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            style={boutonPrincipal}
            onClick={() => {
              onCreerProjet();
              fermer("creer");
            }}
          >
            {tr("Créer mon premier projet", "Create my first project")}
          </button>
          <button style={boutonSecondaire} disabled={import_} onClick={() => void exemple()}>
            {import_ ? tr("Ouverture…", "Opening…") : tr("Découvrir le projet d'exemple", "Explore the sample project")}
          </button>
          <button style={{ ...boutonSecondaire, marginLeft: "auto", border: "none" }} onClick={() => fermer("plus_tard")}>
            {tr("Plus tard", "Later")}
          </button>
        </div>
        {statistiquesDisponibles() && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <label style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={stats}
                onChange={(e) => activerStatistiques(e.target.checked)}
                style={{ accentColor: "var(--accent)" }}
              />
              {tr("Aider à améliorer Projekt avec des statistiques anonymes", "Help improve Projekt with anonymous statistics")}
              <button style={lien} onClick={() => setDetail((d) => !d)}>
                {detail ? tr("masquer", "hide") : tr("voir ce qui est envoyé", "see what is sent")}
              </button>
            </label>
            {detail && <DetailStatistiques />}
          </div>
        )}
        <p style={{ ...texteDim, fontSize: 11.5 }}>
          {tr("Tu retrouveras cet accueil et ce réglage dans ☰ → Aide.", "You'll find this welcome screen and this setting again in ☰ → Help.")}
        </p>
      </div>
    </Fenetre>
  );
}

const pastille: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 11,
  background: "#000",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
const grille: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 };
const carte: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "11px 13px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
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
