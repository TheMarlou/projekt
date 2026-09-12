import { tr } from "../../lib/i18n";

export interface FontChoice {
  label: string;
  /** Pile CSS stockée telle quelle dans le document. */
  stack: string;
  hint: string;
}

// Polices retenues : les deux IBM Plex déjà chargées par l'app, plus des polices
// livrées avec Windows. Pas de nouvelle police web — l'app doit rester utilisable
// hors ligne, et chaque import Google Fonts supplémentaire se paie au démarrage.
export const FONT_CHOICES: FontChoice[] = [
  { label: tr("Par défaut", "Default"), stack: "", hint: "IBM Plex Sans" },
  { label: "IBM Plex Mono", stack: "'IBM Plex Mono', ui-monospace, monospace", hint: tr("Chasse fixe", "Monospaced") },
  { label: "Segoe UI", stack: "'Segoe UI', system-ui, sans-serif", hint: "Sans-serif Windows" },
  { label: "Verdana", stack: "Verdana, Geneva, sans-serif", hint: tr("Sans-serif lisible", "Readable sans-serif") },
  { label: "Trebuchet MS", stack: "'Trebuchet MS', Tahoma, sans-serif", hint: tr("Sans-serif humaniste", "Humanist sans-serif") },
  { label: "Georgia", stack: "Georgia, 'Times New Roman', serif", hint: tr("Serif à l'écran", "Screen serif") },
  { label: "Times New Roman", stack: "'Times New Roman', Times, serif", hint: tr("Serif classique", "Classic serif") },
  { label: "Consolas", stack: "Consolas, 'Courier New', monospace", hint: "Chasse fixe Windows" },
];

/** Retrouve la police appliquée au curseur pour l'afficher dans la barre. */
export function findFontChoice(stack: string | undefined | null): FontChoice {
  if (!stack) return FONT_CHOICES[0];
  return FONT_CHOICES.find((f) => f.stack === stack) ?? FONT_CHOICES[0];
}
