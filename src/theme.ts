import { tr } from "./lib/i18n";
/**
 * Thèmes de Projekt : un FOND (sombre, clair, ou l'une des variantes colorées)
 * × une COULEUR PRINCIPALE × les deux couleurs de liens de la carte mentale.
 *
 * Fonds colorés et couleurs supplémentaires ajoutés le 11/09 à sa demande
 * (« rajouter des thèmes de personnalisation »). Les couleurs de liens aussi :
 * avec la couleur principale « Monochrome », les liens basiques (sous-pages,
 * mentions) et ceux de l'IA étaient tous deux blancs — impossibles à distinguer.
 */

export type ThemeMode = "dark" | "light" | "nuit" | "foret" | "prune" | "papier" | "menthe";
export type AccentId = "orange" | "violet" | "blue" | "mono" | "vert" | "rose" | "rouge" | "cyan" | "jaune";
/** Couleur d'un type de lien de la carte. « accent » = la couleur principale ; « texte » = blanc sur fond sombre, noir sur fond clair. */
export type CouleurLienId = "accent" | "texte" | "cyan" | "violet" | "rose" | "vert" | "jaune" | "orange";

interface ModePalette {
  label: string;
  /** Fond clair : décide de la variante des couleurs principales et des liens. */
  clair: boolean;
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textDim: string;
  accent2: string;
  accent2Soft: string;
}

export const PALETTES: Record<ThemeMode, ModePalette> = {
  dark: {
    label: tr("Sombre", "Dark"),
    clair: false,
    bg: "#14161c",
    surface: "#1b1e26",
    surface2: "#20232c",
    border: "#2b2f3a",
    text: "#e9e7e0",
    textDim: "#9599a9",
    accent2: "#64b8a8",
    accent2Soft: "#17302b",
  },
  nuit: {
    label: tr("Nuit bleue", "Night blue"),
    clair: false,
    bg: "#0f1626",
    surface: "#151e31",
    surface2: "#1b2539",
    border: "#26324a",
    text: "#e6e9f2",
    textDim: "#8f9ab3",
    accent2: "#64b8a8",
    accent2Soft: "#16302f",
  },
  foret: {
    label: tr("Forêt", "Forest"),
    clair: false,
    bg: "#111a15",
    surface: "#16221b",
    surface2: "#1c2a21",
    border: "#27382d",
    text: "#e4ebe3",
    textDim: "#8fa596",
    accent2: "#6cb6d6",
    accent2Soft: "#173040",
  },
  prune: {
    label: tr("Prune", "Plum"),
    clair: false,
    bg: "#1a1320",
    surface: "#211828",
    surface2: "#281d30",
    border: "#372a42",
    text: "#ece4ef",
    textDim: "#a393ad",
    accent2: "#64b8a8",
    accent2Soft: "#173030",
  },
  light: {
    label: tr("Clair", "Light"),
    clair: true,
    bg: "#f2f3f6",
    surface: "#ffffff",
    surface2: "#f5f6f9",
    border: "#dde0e6",
    text: "#1c1e26",
    textDim: "#6b7080",
    accent2: "#276e5f",
    accent2Soft: "#dbede8",
  },
  papier: {
    label: tr("Papier", "Paper"),
    clair: true,
    bg: "#f4efe4",
    surface: "#fbf8f1",
    surface2: "#f1eadb",
    border: "#e0d6c2",
    text: "#2b261d",
    textDim: "#7a6f5c",
    accent2: "#2f7466",
    accent2Soft: "#dbece5",
  },
  menthe: {
    label: tr("Menthe", "Mint"),
    clair: true,
    bg: "#eef6f2",
    surface: "#fbfefc",
    surface2: "#eff7f3",
    border: "#d3e5dc",
    text: "#1b2622",
    textDim: "#62776e",
    accent2: "#7a4fb0",
    accent2Soft: "#ece3f7",
  },
};

export const MODE_LIST = Object.entries(PALETTES).map(([id, v]) => ({ id: id as ThemeMode, ...v }));

interface Paire {
  accent: string;
  accentSoft: string;
}

export const ACCENTS: Record<AccentId, { label: string; swatch: string; dark: Paire; light: Paire }> = {
  orange: {
    label: "Orange",
    swatch: "#e8a33d",
    dark: { accent: "#e8a33d", accentSoft: "#3a2f18" },
    light: { accent: "#a86a08", accentSoft: "#f3e3c4" },
  },
  jaune: {
    label: tr("Jaune", "Yellow"),
    swatch: "#e3c345",
    dark: { accent: "#e3c345", accentSoft: "#3a3217" },
    light: { accent: "#8a6d00", accentSoft: "#f3ead0" },
  },
  rouge: {
    label: tr("Rouge", "Red"),
    swatch: "#e5655c",
    dark: { accent: "#e5655c", accentSoft: "#3a1c1a" },
    light: { accent: "#b3261e", accentSoft: "#f6dcda" },
  },
  rose: {
    label: tr("Rose", "Pink"),
    swatch: "#ec7fb4",
    dark: { accent: "#ec7fb4", accentSoft: "#3a1d2d" },
    light: { accent: "#b8336f", accentSoft: "#f7dce9" },
  },
  violet: {
    label: tr("Violet", "Purple"),
    swatch: "#a98cf0",
    dark: { accent: "#a98cf0", accentSoft: "#2a2440" },
    light: { accent: "#6d43d6", accentSoft: "#e7defb" },
  },
  blue: {
    label: tr("Bleu", "Blue"),
    swatch: "#5fa8ea",
    dark: { accent: "#5fa8ea", accentSoft: "#182a3d" },
    light: { accent: "#1f66c9", accentSoft: "#dae8fb" },
  },
  cyan: {
    label: "Cyan",
    swatch: "#3cc6d6",
    dark: { accent: "#3cc6d6", accentSoft: "#123238" },
    light: { accent: "#0a7c8c", accentSoft: "#d3eff2" },
  },
  vert: {
    label: tr("Vert", "Green"),
    swatch: "#5fbf77",
    dark: { accent: "#5fbf77", accentSoft: "#1b3222" },
    light: { accent: "#1f7a3a", accentSoft: "#d9efe0" },
  },
  mono: {
    label: "Monochrome",
    swatch: "#c7c7cf",
    dark: { accent: "#e7e7ea", accentSoft: "#33343a" },
    light: { accent: "#22232a", accentSoft: "#e6e6e9" },
  },
};

export const ACCENT_LIST = Object.entries(ACCENTS).map(([id, v]) => ({ id: id as AccentId, ...v }));

/** Couleurs proposées pour les liens de la carte, en version fond sombre / fond clair. */
export const COULEURS_LIENS: Record<CouleurLienId, { label: string; sombre: string; clair: string }> = {
  accent: { label: tr("Couleur principale", "Main colour"), sombre: "var(--accent)", clair: "var(--accent)" },
  cyan: { label: "Cyan", sombre: "#22d3ee", clair: "#0e7490" },
  violet: { label: tr("Violet", "Purple"), sombre: "#a78bfa", clair: "#6d28d9" },
  rose: { label: tr("Rose", "Pink"), sombre: "#f472b6", clair: "#be185d" },
  vert: { label: tr("Vert", "Green"), sombre: "#4ade80", clair: "#15803d" },
  jaune: { label: tr("Jaune", "Yellow"), sombre: "#facc15", clair: "#a16207" },
  orange: { label: "Orange", sombre: "#fb923c", clair: "#c2410c" },
  texte: { label: tr("Blanc (noir sur fond clair)", "White (black on light backgrounds)"), sombre: "var(--text)", clair: "var(--text)" },
};

export const COULEUR_LIEN_LIST = Object.entries(COULEURS_LIENS).map(([id, v]) => ({ id: id as CouleurLienId, ...v }));

export interface ReglagesTheme {
  mode: ThemeMode;
  accent: AccentId;
  lienBase: CouleurLienId;
  lienIa: CouleurLienId;
}

/** Couleur réellement affichée (sert aussi à prévenir quand deux types de liens se confondent). */
export function couleurResolue(id: CouleurLienId, r: ReglagesTheme): string {
  const clair = (PALETTES[r.mode] ?? PALETTES.dark).clair;
  if (id === "accent") return ACCENTS[r.accent]?.[clair ? "light" : "dark"].accent ?? "#e8a33d";
  if (id === "texte") return (PALETTES[r.mode] ?? PALETTES.dark).text;
  return COULEURS_LIENS[id][clair ? "clair" : "sombre"];
}

export function applyTheme(r: ReglagesTheme) {
  // Une valeur inconnue (réglage d'une future version, stockage abîmé) retombe
  // sur le thème par défaut plutôt que de casser l'affichage.
  const palette = PALETTES[r.mode] ?? PALETTES.dark;
  const paire = (ACCENTS[r.accent] ?? ACCENTS.orange)[palette.clair ? "light" : "dark"];
  const root = document.documentElement.style;
  root.setProperty("--bg", palette.bg);
  root.setProperty("--surface", palette.surface);
  root.setProperty("--surface-2", palette.surface2);
  root.setProperty("--border", palette.border);
  root.setProperty("--text", palette.text);
  root.setProperty("--text-dim", palette.textDim);
  root.setProperty("--accent2", palette.accent2);
  root.setProperty("--accent2-soft", palette.accent2Soft);
  root.setProperty("--accent", paire.accent);
  root.setProperty("--accent-soft", paire.accentSoft);
  root.setProperty("--lien-base", couleurResolue(COULEURS_LIENS[r.lienBase] ? r.lienBase : "accent", r));
  root.setProperty("--lien-ia", couleurResolue(COULEURS_LIENS[r.lienIa] ? r.lienIa : "cyan", r));
  document.documentElement.style.colorScheme = palette.clair ? "light" : "dark";
}
