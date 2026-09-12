/**
 * Langue de l'interface : français (par défaut) ou anglais, réglée dans le
 * menu ☰ (choix du 12/09).
 *
 * Chaque texte est écrit dans les deux langues à l'endroit même où il s'affiche
 * — `tr("Rechercher", "Search")` — plutôt que dans un catalogue de clés : on lit
 * la phrase française en lisant le code, et une traduction oubliée se voit.
 *
 * La langue est lue une fois au lancement ; en changer recharge la fenêtre.
 * Rien n'est perdu : tout est déjà enregistré en base au fil de la frappe.
 */

export type Langue = "fr" | "en";

const CLE = "projekt-langue";

function lire(): Langue {
  try {
    return localStorage.getItem(CLE) === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

export const langue: Langue = lire();
export const enAnglais = langue === "en";

/** Pour `toLocaleString` et compagnie. */
export const localeDates = enAnglais ? "en-GB" : "fr-FR";

if (typeof document !== "undefined") document.documentElement.lang = langue;

/** Le texte dans la langue de l'app. */
export function tr(fr: string, en: string): string {
  return enAnglais ? en : fr;
}

/** Accord en nombre : `pluriel(n, ["page", "pages"], ["page", "pages"])`. */
export function pluriel(n: number, fr: [string, string], en: [string, string]): string {
  const formes = enAnglais ? en : fr;
  // En français, 0 et 1 sont au singulier ; en anglais, seul 1 l'est.
  const singulier = enAnglais ? n === 1 : n < 2;
  return singulier ? formes[0] : formes[1];
}

export function changerLangue(nouvelle: Langue) {
  if (nouvelle === langue) return;
  try {
    localStorage.setItem(CLE, nouvelle);
  } catch {
    return;
  }
  window.location.reload();
}
