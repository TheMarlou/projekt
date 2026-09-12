import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export interface ContextMenuEntry {
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

export interface ContextMenuGroup {
  caption: string;
  entries: ContextMenuEntry[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  groups: ContextMenuGroup[];
  onClose: () => void;
}

const WIDTH = 236;

export default function ContextMenu({ x, y, groups, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Replie le menu vers l'intérieur s'il déborde : un clic droit près du bord bas
  // ou droit de la fenêtre le rendrait sinon partiellement inaccessible.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: x + width > window.innerWidth - 8 ? Math.max(8, window.innerWidth - width - 8) : x,
      top: y + height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - height - 8) : y,
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} style={{ ...panel, left: pos.left, top: pos.top }}>
      {groups.map((group, gi) => (
        <div key={group.caption}>
          {gi > 0 && <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />}
          <div style={caption}>{group.caption}</div>
          {group.entries.map((entry) => (
            <div
              key={entry.label}
              // mousedown neutralisé : la sélection de l'éditeur doit survivre au clic,
              // sinon « Insérer un lien » n'aurait plus rien sur quoi s'appliquer.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (entry.disabled) return;
                entry.run();
                onClose();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 9px",
                borderRadius: 5,
                fontSize: 12.5,
                cursor: entry.disabled ? "default" : "pointer",
                color: entry.disabled ? "var(--border)" : "var(--text)",
              }}
            >
              <span style={{ flex: 1 }}>{entry.label}</span>
              {entry.hint && (
                <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
                  {entry.hint}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const panel: CSSProperties = {
  position: "fixed",
  zIndex: 80,
  width: WIDTH,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  boxShadow: "0 14px 32px rgba(0,0,0,0.45)",
  padding: 4,
};

const caption: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
  padding: "5px 9px 3px",
};
