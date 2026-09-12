import { useSyncExternalStore, type CSSProperties } from "react";
import { dismissNotice, getNotices, subscribeNotices } from "../lib/notify";

/** Pile de messages en bas à droite, au-dessus du bouton de l'assistant. */
export default function Notices() {
  const notices = useSyncExternalStore(subscribeNotices, getNotices);
  if (notices.length === 0) return null;

  return (
    <div style={pileStyle}>
      {notices.map((n) => (
        <div
          key={n.id}
          style={{
            ...carteStyle,
            borderColor: n.ok ? "var(--border)" : "var(--danger)",
            color: n.ok ? "var(--text)" : "var(--danger)",
          }}
        >
          <span style={{ flex: 1 }}>{n.message}</span>
          {n.action && (
            <button
              onClick={() => {
                n.action?.run();
                dismissNotice(n.id);
              }}
              style={{
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--accent)",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 12,
                padding: "1px 8px",
                flexShrink: 0,
              }}
            >
              {n.action.label}
            </button>
          )}
          <button
            onClick={() => dismissNotice(n.id)}
            title="Fermer"
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              opacity: 0.65,
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

const pileStyle: CSSProperties = {
  position: "fixed",
  right: 16,
  // Assez haut pour ne pas recouvrir le bouton rond de l'assistant IA.
  bottom: 76,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  zIndex: 60,
  maxWidth: 380,
};

const carteStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  fontSize: 12.5,
  lineHeight: 1.45,
  boxShadow: "0 8px 24px rgba(0,0,0,.35)",
};
