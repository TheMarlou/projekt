import { useEffect, type CSSProperties, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div style={overlay} onMouseDown={onCancel}>
      <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 16 }}>
          {body}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={neutral}>
            Annuler
          </button>
          {/* L'action destructrice n'est pas celle qui a le focus par défaut. */}
          <button onClick={onConfirm} style={danger}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const panel: CSSProperties = {
  width: 380,
  maxWidth: "calc(100vw - 32px)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
  padding: 18,
};

const neutral: CSSProperties = {
  fontSize: 12.5,
  padding: "7px 14px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
};

const danger: CSSProperties = {
  fontSize: 12.5,
  padding: "7px 14px",
  borderRadius: 6,
  border: "1px solid var(--danger)",
  background: "transparent",
  color: "var(--danger)",
};
