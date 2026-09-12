import { CSSProperties, useEffect, useState, useSyncExternalStore } from "react";
import { getSaveState, subscribeSaveState } from "../db";

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
          ⚠ Échec d'enregistrement
        </button>
        {detail && (
          <div style={panneauStyle}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Opération : {etat.label}</div>
            <div style={{ color: "var(--text-dim)", marginBottom: 8, wordBreak: "break-word" }}>
              {etat.message}
            </div>
            <div style={{ color: "var(--text-dim)" }}>
              À {heure(etat.at)}. Tes modifications sont encore à l'écran mais pas sur le disque —
              ne ferme pas l'application tant que ce message est affiché.
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
          ? "Modification en attente d'écriture sur le disque"
          : `Dernière écriture réussie à ${heure(etat.at)}`
      }
    >
      {etat.kind === "pending" ? "⋯ Enregistrement…" : "✓ Enregistré"}
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
