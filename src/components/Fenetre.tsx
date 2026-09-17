import { useEffect, type CSSProperties, type ReactNode } from "react";

/**
 * Fenêtre par-dessus l'app (À propos, accueil), même allure que « Signaler un
 * problème » : fond assombri, Échap ou clic à côté pour fermer.
 */
export default function Fenetre({
  titre,
  largeur = 520,
  onFermer,
  children,
}: {
  titre: string;
  largeur?: number;
  onFermer: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer();
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [onFermer]);

  return (
    <div style={fond} onMouseDown={(e) => e.target === e.currentTarget && onFermer()}>
      <div role="dialog" aria-label={titre} style={{ ...fenetre, width: `min(${largeur}px, calc(100vw - 32px))` }}>
        {children}
      </div>
    </div>
  );
}

const fond: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 90,
};

const fenetre: CSSProperties = {
  maxHeight: "calc(100vh - 48px)",
  overflowY: "auto",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 20,
  boxShadow: "0 18px 40px rgba(0,0,0,0.4)",
};

export const texteDim: CSSProperties = { fontSize: 12.5, lineHeight: 1.55, color: "var(--text-dim)", margin: 0 };

export const boutonPrincipal: CSSProperties = {
  fontSize: 12.5,
  padding: "7px 13px",
  borderRadius: 6,
  border: "1px solid var(--accent)",
  background: "var(--accent-soft)",
  color: "var(--accent)",
  cursor: "pointer",
};

export const boutonSecondaire: CSSProperties = {
  fontSize: 12.5,
  padding: "7px 13px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
  cursor: "pointer",
};
