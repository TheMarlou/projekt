import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useThemeStore } from "../store/themeStore";
import { ACCENT_LIST, COULEUR_LIEN_LIST, couleurResolue, MODE_LIST, type CouleurLienId } from "../theme";

export default function ThemeMenu() {
  const theme = useThemeStore();
  const { mode, accent, lienBase, lienIa, setMode, setAccent, setLienBase, setLienIa } = theme;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Les deux types de liens de la carte ne doivent pas se confondre : c'est tout
  // l'intérêt de ce réglage (demande du 11/09).
  const confondus = couleurResolue(lienBase, theme) === couleurResolue(lienIa, theme);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Thème"
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: open ? "var(--surface-2)" : "transparent",
          color: "var(--text-dim)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div className="scroll" style={panneau}>
          <Titre>Fond</Titre>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
            {MODE_LIST.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 12,
                  padding: "5px 7px",
                  borderRadius: 6,
                  border: `1px solid ${mode === m.id ? "var(--accent)" : "var(--border)"}`,
                  background: mode === m.id ? "var(--accent-soft)" : "transparent",
                  color: mode === m.id ? "var(--accent)" : "var(--text-dim)",
                  textAlign: "left",
                }}
              >
                {/* Aperçu du fond : le fond lui-même, avec une bande de sa surface. */}
                <span
                  aria-hidden
                  style={{
                    width: 18,
                    height: 14,
                    flexShrink: 0,
                    borderRadius: 3,
                    border: `1px solid ${m.border}`,
                    background: `linear-gradient(90deg, ${m.bg} 55%, ${m.surface2} 55%)`,
                  }}
                />
                {m.label}
              </button>
            ))}
          </div>

          <Titre>Couleur principale</Titre>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 14 }}>
            {ACCENT_LIST.map((a) => (
              <Pastille key={a.id} couleur={a.swatch} titre={a.label} actif={accent === a.id} onClick={() => setAccent(a.id)} />
            ))}
          </div>

          <Titre>Carte mentale</Titre>
          <LigneLiens
            libelle="Liens basiques (sous-pages, mentions)"
            valeur={lienBase}
            onChange={setLienBase}
            resoudre={(id) => couleurResolue(id, theme)}
          />
          <LigneLiens
            libelle="Liens de l'IA"
            valeur={lienIa}
            onChange={setLienIa}
            resoudre={(id) => couleurResolue(id, theme)}
            sansPrincipale
          />
          {confondus && (
            <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 4 }}>
              Ces deux couleurs sont identiques : les liens de l'IA ne se distingueront pas des autres.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Titre({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-dim)",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function Pastille({ couleur, titre, actif, onClick, contenu }: { couleur: string; titre: string; actif: boolean; onClick: () => void; contenu?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={titre}
      aria-label={titre}
      aria-pressed={actif}
      style={{
        width: 22,
        height: 22,
        padding: 0,
        borderRadius: "50%",
        background: couleur,
        border: actif ? "2px solid var(--text)" : "1px solid var(--border)",
        boxShadow: actif ? "0 0 0 2px var(--surface)" : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 700,
        color: "var(--bg)",
      }}
    >
      {contenu}
    </button>
  );
}

function LigneLiens({
  libelle,
  valeur,
  onChange,
  resoudre,
  sansPrincipale = false,
}: {
  libelle: string;
  valeur: CouleurLienId;
  onChange: (c: CouleurLienId) => void;
  resoudre: (id: CouleurLienId) => string;
  /** La couleur principale sert déjà aux liens basiques : pas pour l'IA. */
  sansPrincipale?: boolean;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text)", marginBottom: 6 }}>
        <svg width="22" height="6" aria-hidden>
          <line x1="1" y1="3" x2="21" y2="3" stroke={resoudre(valeur)} strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        {libelle}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {COULEUR_LIEN_LIST.filter((c) => !(sansPrincipale && c.id === "accent")).map((c) => (
          <Pastille
            key={c.id}
            couleur={resoudre(c.id)}
            titre={c.label}
            actif={valeur === c.id}
            onClick={() => onChange(c.id)}
            // « A » marque la couleur principale, qui suit le thème.
            contenu={c.id === "accent" ? "A" : undefined}
          />
        ))}
      </div>
    </div>
  );
}

const panneau: CSSProperties = {
  position: "absolute",
  top: 34,
  right: 0,
  width: 272,
  maxHeight: "calc(100vh - 70px)",
  overflowY: "auto",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 12,
  boxShadow: "0 12px 28px rgba(0,0,0,0.35)",
  zIndex: 50,
};
