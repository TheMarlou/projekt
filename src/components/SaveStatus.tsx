import { CSSProperties, useEffect, useState, useSyncExternalStore } from "react";
import { getSaveState, subscribeSaveState } from "../db";
import { tr } from "../lib/i18n";

function heure(ms: number) {
  return new Date(ms).toLocaleTimeString("fr-FR");
}

/**
 * Témoin d'enregistrement. Il ne prétend jamais « Enregistré » tant qu'une
 * modification attend encore le disque : l'anti-rebond retarde l'écriture de
 * 400 ms, et c'est exactement pendant ce délai qu'une panne passe inaperçue.
 */
export default function SaveStatus() {
  const etat = useSyncExternalStore(subscribeSaveState, getSaveState);
  const [detail, setDetail] = useState(false);

  // Le détail ne parle que d'un échec : il se referme dès que l'écriture repasse.
  useEffect(() => {
    if (etat.kind !== "failed") setDetail(false);
  }, [etat.kind]);

  // Rien n'a encore été écrit dans cette session : annoncer un enregistrement
  // serait une affirmation sans objet.
  if (etat.kind === "idle") return null;

  if (etat.kind === "failed") {
    return (
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setDetail((d) => !d)}
          style={{
            ...badgeStyle,
            borderColor: "var(--danger)",
            color: "var(--danger)",
            cursor: "pointer",
          }}
        >
          ⚠ {tr("Échec d'enregistrement", "Save failed")}
        </button>
        {detail && (
          <div style={panneauStyle}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{tr("Opération", "Operation")} : {etat.label}</div>
            <div style={{ color: "var(--text-dim)", marginBottom: 8, wordBreak: "break-word" }}>
              {etat.message}
            </div>
            <div style={{ color: "var(--text-dim)" }}>
              {tr(
                `À ${heure(etat.at)}. Tes modifications sont encore à l'écran mais pas sur le disque — ne ferme pas l'application tant que ce message est affiché.`,
                `At ${heure(etat.at)}. Your changes are still on screen but not on disk — don't close the app while this message is shown.`
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{ ...badgeStyle, color: "var(--text-dim)" }}
      title={
        etat.kind === "pending"
          ? tr("Modification en attente d'écriture sur le disque", "Change waiting to be written to disk")
          : tr(`Dernière écriture réussie à ${heure(etat.at)}`, `Last saved at ${heure(etat.at)}`)
      }
    >
      {etat.kind === "pending" ? `⋯ ${tr("Enregistrement…", "Saving…")}` : `✓ ${tr("Enregistré", "Saved")}`}
    </div>
  );
}

const badgeStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  border: "1px solid var(--border)",
  borderRadius: 5,
  padding: "3px 8px",
  background: "transparent",
  whiteSpace: "nowrap",
};

const panneauStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  right: 0,
  width: 320,
  padding: "10px 12px",
  borderRadius: 7,
  border: "1px solid var(--danger)",
  background: "var(--surface-2)",
  color: "var(--text)",
  fontSize: 12,
  lineHeight: 1.5,
  zIndex: 50,
  boxShadow: "0 8px 24px rgba(0,0,0,.35)",
};
