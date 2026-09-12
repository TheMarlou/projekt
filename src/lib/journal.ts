import { getVersion } from "@tauri-apps/api/app";

/**
 * Journal technique pour « Signaler un problème » (demande du 12/09).
 *
 * Garde en mémoire les dernières erreurs et avertissements de l'app — jamais le
 * contenu des pages — et rien ne part sans que l'utilisateur l'ait vu et coché.
 * Rien n'est écrit sur disque : le journal repart à zéro à chaque lancement.
 */

export interface EntreeJournal {
  quand: number;
  niveau: "erreur" | "avertissement";
  message: string;
}

const ENTREES_MAX = 200;
const TAILLE_MESSAGE = 600;
const entrees: EntreeJournal[] = [];
let installe = false;

function texteDe(valeur: unknown): string {
  if (valeur instanceof Error) {
    const pile = valeur.stack?.split("\n").slice(1, 4).join("\n");
    return `${valeur.name}: ${valeur.message}${pile ? `\n${pile}` : ""}`;
  }
  if (typeof valeur === "string") return valeur;
  try {
    return JSON.stringify(valeur);
  } catch {
    return String(valeur);
  }
}

function noter(niveau: EntreeJournal["niveau"], valeurs: unknown[]) {
  entrees.push({ quand: Date.now(), niveau, message: valeurs.map(texteDe).join(" ").slice(0, TAILLE_MESSAGE) });
  if (entrees.length > ENTREES_MAX) entrees.splice(0, entrees.length - ENTREES_MAX);
}

/** À appeler une fois, au démarrage. */
export function installerJournal() {
  if (installe) return;
  installe = true;
  const erreur = console.error.bind(console);
  const avertissement = console.warn.bind(console);
  console.error = (...valeurs: unknown[]) => {
    noter("erreur", valeurs);
    erreur(...valeurs);
  };
  console.warn = (...valeurs: unknown[]) => {
    noter("avertissement", valeurs);
    avertissement(...valeurs);
  };
  window.addEventListener("error", (e) => noter("erreur", [e.error ?? e.message]));
  window.addEventListener("unhandledrejection", (e) => noter("erreur", ["Promesse rejetée :", e.reason]));
}

export function nombreErreurs(): number {
  return entrees.filter((e) => e.niveau === "erreur").length;
}

/** Le texte exact qui serait joint au signalement, montré tel quel à l'utilisateur. */
export async function rapportTechnique(): Promise<string> {
  let version = "?";
  try {
    version = await getVersion();
  } catch {
    // Hors de la fenêtre Tauri.
  }
  const lignes = [
    `Projekt ${version}`,
    `Système : ${navigator.userAgent}`,
    `Fenêtre : ${window.innerWidth} × ${window.innerHeight}`,
    `Date : ${new Date().toISOString()}`,
    "",
    entrees.length ? `Dernières erreurs et avertissements (${entrees.length}) :` : "Aucune erreur enregistrée depuis le lancement.",
  ];
  for (const e of entrees.slice(-40)) {
    lignes.push(`[${new Date(e.quand).toLocaleTimeString("fr-FR")}] ${e.niveau === "erreur" ? "ERREUR" : "avert."} ${e.message}`);
  }
  return lignes.join("\n");
}
