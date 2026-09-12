import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Block } from "../../store/blocksStore";

interface PagePickerProps {
  pages: Block[];
  /** Page courante : se citer soi-même n'aurait aucun sens. */
  excludeId: string | null;
  onPick: (pageId: string) => void;
  onCancel: () => void;
}

/** Chemin lisible d'une page, pour distinguer deux pages de même titre. */
function pathOf(pages: Block[], page: Block): string {
  const segments: string[] = [];
  let current: Block | undefined = page;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    segments.unshift(current.title?.trim() || "Sans titre");
    current = current.parentId ? pages.find((p) => p.id === current!.parentId) : undefined;
  }
  return segments.join(" › ");
}

export default function PagePicker({ pages, excludeId, onPick, onCancel }: PagePickerProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pages
      .filter((p) => p.id !== excludeId)
      .map((p) => ({ page: p, path: pathOf(pages, p) }))
      .filter((r) => !q || r.path.toLowerCase().includes(q))
      .slice(0, 50);
  }, [pages, excludeId, query]);

  useEffect(() => setIndex(0), [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return onCancel();
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onPick(results[index].page.id);
    }
  };

  return (
    <div style={overlay} onMouseDown={onCancel}>
      <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Chercher une page…"
          style={search}
        />
        <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
          {results.length === 0 ? (
            <div style={{ padding: "10px 9px", fontSize: 12.5, color: "var(--text-dim)" }}>
              {pages.length <= 1
                ? "Ce projet ne contient aucune autre page à mentionner."
                : "Aucune page ne correspond."}
            </div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.page.id}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(r.page.id)}
                style={{
                  padding: "7px 9px",
                  borderRadius: 5,
                  fontSize: 13,
                  cursor: "pointer",
                  background: i === index ? "var(--accent-soft)" : "transparent",
                  color: i === index ? "var(--accent)" : "var(--text)",
                }}
              >
                {r.page.title?.trim() || "Sans titre"}
                {r.path.includes("›") && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{r.path}</div>
                )}
              </div>
            ))
          )}
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
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: "14vh",
};

const panel: CSSProperties = {
  width: 420,
  maxWidth: "calc(100vw - 32px)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
  padding: 10,
};

const search: CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 13,
  outline: "none",
};
