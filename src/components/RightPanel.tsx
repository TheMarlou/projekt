import { Block, extractLinks, extractPageRefs, getBlockText } from "../store/blocksStore";
import { tr } from "../lib/i18n";

interface RightPanelProps {
  blocks: Block[];
  selected: Block | null;
  onOpenBlock: (id: string) => void;
}

export default function RightPanel({ blocks, selected, onOpenBlock }: RightPanelProps) {
  // Deux façons de citer une page : la puce insérée dans le texte (par identifiant,
  // fiable) et l ancienne syntaxe [[Titre]] restée du texte brut.
  const backlinks = selected
    ? blocks.filter(
        (b) =>
          b.id !== selected.id &&
          (extractPageRefs(b).includes(selected.id) ||
            extractLinks(getBlockText(b)).includes(selected.title))
      )
    : [];

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        background: "var(--surface)",
        padding: 14,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginBottom: 10,
        }}
      >
        Backlinks
      </div>
      {!selected && (
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>{tr("Sélectionne une page pour voir ses liens entrants.", "Select a page to see its incoming links.")}</p>
      )}
      {selected && backlinks.length === 0 && (
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          {tr(
            "Aucun lien entrant. Depuis une autre page, clic droit → « Mention de page » pour pointer vers celle-ci.",
            "No incoming links. From another page, right-click → “Page mention” to point here."
          )}
        </p>
      )}
      {backlinks.map((b) => (
        <div
          key={b.id}
          onClick={() => onOpenBlock(b.id)}
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            marginBottom: 6,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {b.title || tr("Sans titre", "Untitled")}
        </div>
      ))}
    </aside>
  );
}
