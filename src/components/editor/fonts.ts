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
  { label: "Par défaut", stack: "", hint: "IBM Plex Sans" },
  { label: "IBM Plex Mono", stack: "'IBM Plex Mono', ui-monospace, monospace", hint: "Chasse fixe" },
  { label: "Segoe UI", stack: "'Segoe UI', system-ui, sans-serif", hint: "Sans-serif Windows" },
  { label: "Verdana", stack: "Verdana, Geneva, sans-serif", hint: "Sans-serif lisible" },
  { label: "Trebuchet MS", stack: "'Trebuchet MS', Tahoma, sans-serif", hint: "Sans-serif humaniste" },
  { label: "Georgia", stack: "Georgia, 'Times New Roman', serif", hint: "Serif à l'écran" },
  { label: "Times New Roman", stack: "'Times New Roman', Times, serif", hint: "Serif classique" },
  { label: "Consolas", stack: "Consolas, 'Courier New', monospace", hint: "Chasse fixe Windows" },
];

/** Retrouve la police appliquée au curseur pour l'afficher dans la barre. */
export function findFontChoice(stack: string | undefined | null): FontChoice {
  if (!stack) return FONT_CHOICES[0];
  return FONT_CHOICES.find((f) => f.stack === stack) ?? FONT_CHOICES[0];
}
