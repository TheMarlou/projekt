import { getVersion } from "@tauri-apps/api/app";
import { appDataDir } from "@tauri-apps/api/path";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState, type CSSProperties } from "react";
import { EVENEMENT_SIGNALER } from "../lib/fileActions";
import { tr } from "../lib/i18n";
import { DEPOT_GITHUB } from "../lib/misesAJour";
import { notify } from "../lib/notify";
import Fenetre, { boutonSecondaire, texteDim } from "./Fenetre";
import Logo from "./Logo";

export const LIEN_SOUTIEN = "https://ko-fi.com/themarlou";

/** ☰ → Aide → À propos de Projekt (demande du 17/09, avant la publication). */
export default function APropos({ onFermer }: { onFermer: () => void }) {
  const [version, setVersion] = useState("");
  const [dossier, setDossier] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("?"));
    appDataDir().then(setDossier).catch(() => setDossier(""));
  }, []);

  const ouvrir = (url: string) =>
    void openUrl(url).catch((err) => notify(false, `${tr("Impossible d'ouvrir le navigateur", "Couldn't open the browser")} : ${String(err)}`));

  return (
    <Fenetre titre={tr("À propos de Projekt", "About Projekt")} largeur={460} onFermer={onFermer}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={pastille}>
            <Logo size={30} />
          </span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Projekt</div>
            <div style={{ ...texteDim, fontVariantNumeric: "tabular-nums" }}>
              {tr("Version", "Version")} {version} · {tr("par", "by")} TheMarlou
            </div>
          </div>
        </div>

        <p style={texteDim}>
          {tr(
            "Carnet de brainstorming pour créateurs de jeux vidéo : notes, moodboard, carte mentale et assistant IA qui tourne sur ton ordinateur. Sans compte, sans abonnement.",
            "A brainstorming notebook for game creators: notes, moodboard, mind map and an AI assistant that runs on your computer. No account, no subscription."
          )}
        </p>

        <div style={grille}>
          <span style={etiquette}>{tr("Licence", "Licence")}</span>
          <span>
            PolyForm Shield 1.0.0 —{" "}
            <button style={lien} onClick={() => ouvrir(`https://github.com/${DEPOT_GITHUB}/blob/main/LICENSE`)}>
              {tr("lire", "read")}
            </button>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--text-dim)" }}>
              {tr(
                "Libre d'utilisation, même pour un usage pro. Interdit d'en faire un logiciel concurrent.",
                "Free to use, including professionally. You may not build a competing product from it."
              )}
            </span>
          </span>

          <span style={etiquette}>{tr("Code source", "Source code")}</span>
          <button style={lien} onClick={() => ouvrir(`https://github.com/${DEPOT_GITHUB}`)}>
            github.com/{DEPOT_GITHUB}
          </button>

          <span style={etiquette}>{tr("Tes données", "Your data")}</span>
          <span style={{ minWidth: 0 }}>
            <code style={chemin}>{dossier || "…"}</code>
            <button
              style={{ ...lien, display: "block", marginTop: 3 }}
              disabled={!dossier}
              onClick={() =>
                void revealItemInDir(dossier).catch((err) =>
                  notify(false, `${tr("Impossible d'ouvrir le dossier", "Couldn't open the folder")} : ${String(err)}`)
                )
              }
            >
              {tr("Ouvrir le dossier", "Open the folder")}
            </button>
          </span>

          <span style={etiquette}>{tr("Merci à", "Thanks to")}</span>
          <span style={{ fontSize: 12.5 }}>Tauri, React, Tiptap, SQLite, Ollama, Qwen, Gemma</span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={boutonSecondaire} onClick={() => ouvrir(LIEN_SOUTIEN)}>
            ☕ {tr("Soutenir Projekt", "Support Projekt")}
          </button>
          <button
            style={boutonSecondaire}
            onClick={() => {
              onFermer();
              window.dispatchEvent(new CustomEvent(EVENEMENT_SIGNALER));
            }}
          >
            {tr("Signaler un problème", "Report a problem")}
          </button>
          <button style={{ ...boutonSecondaire, marginLeft: "auto" }} onClick={onFermer}>
            {tr("Fermer", "Close")}
          </button>
        </div>
      </div>
    </Fenetre>
  );
}

const pastille: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 12,
  background: "#000",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
const grille: CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 14px", fontSize: 12.5, alignItems: "baseline" };
const etiquette: CSSProperties = { fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" };
const chemin: CSSProperties = { fontSize: 11, wordBreak: "break-all", color: "var(--text)" };
const lien: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  color: "var(--accent)",
  cursor: "pointer",
  fontSize: 12.5,
  textDecoration: "underline",
  textAlign: "left",
};
