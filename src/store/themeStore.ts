import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyTheme, AccentId, CouleurLienId, ThemeMode } from "../theme";

interface ThemeState {
  mode: ThemeMode;
  accent: AccentId;
  /** Carte mentale : liens basiques (sous-pages, mentions) et liens de l'IA. */
  lienBase: CouleurLienId;
  lienIa: CouleurLienId;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentId) => void;
  setLienBase: (c: CouleurLienId) => void;
  setLienIa: (c: CouleurLienId) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => {
      const changer = (modif: Partial<ThemeState>) => {
        set(modif);
        applyTheme(get());
      };
      return {
        mode: "dark",
        // Blanc : c'est la couleur du logo (son choix du 12/09).
        accent: "mono",
        lienBase: "accent",
        // Cyan vif par défaut : il ne se confond avec aucune couleur principale
        // proposée par défaut, ni avec le blanc du texte.
        lienIa: "cyan",
        setMode: (mode) => changer({ mode }),
        setAccent: (accent) => changer({ accent }),
        setLienBase: (lienBase) => changer({ lienBase }),
        setLienIa: (lienIa) => changer({ lienIa }),
      };
    },
    {
      name: "projekt-theme",
      // Un réglage enregistré avant l'ajout des couleurs de liens n'en a pas :
      // les valeurs par défaut les complètent (fusion du persist).
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state);
      },
    }
  )
);
