import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notify } from "./notify";

/**
 * Notification de mise à jour (choix du 12/09) : une simple annonce, sans
 * téléchargement automatique, et DÉSACTIVÉE PAR DÉFAUT — c'est la seule
 * fonction de l'app qui interroge internet d'elle-même. Une fois activée, elle
 * demande au plus une fois par jour à GitHub le numéro de la dernière version,
 * et n'envoie rien d'autre.
 */

export const DEPOT_GITHUB = "TheMarlou/projekt";
const CLE_ACTIVE = "projekt-maj-active";
const CLE_DERNIERE = "projekt-maj-derniere-verification";
const UN_JOUR_MS = 24 * 60 * 60 * 1000;

export function verificationActivee(): boolean {
  try {
    return localStorage.getItem(CLE_ACTIVE) === "oui";
  } catch {
    return false;
  }
}

export function activerVerification(active: boolean) {
  try {
    localStorage.setItem(CLE_ACTIVE, active ? "oui" : "non");
    if (active) localStorage.removeItem(CLE_DERNIERE);
  } catch {
    // Stockage indisponible : le réglage ne sera pas retenu.
  }
}

/** « v0.2.0 » est-elle plus récente que « 0.1.0 » ? (majeure.mineure.correctif) */
export function plusRecente(distante: string, locale: string): boolean {
  const morceaux = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .slice(0, 3)
      .map((x) => parseInt(x, 10) || 0);
  const a = morceaux(distante);
  const b = morceaux(locale);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function derniereVersion(): Promise<{ version: string; url: string } | null> {
  const reponse = await fetch(`https://api.github.com/repos/${DEPOT_GITHUB}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!reponse.ok) return null;
  const donnees = (await reponse.json()) as { tag_name?: string; html_url?: string };
  if (!donnees.tag_name || !donnees.html_url) return null;
  const locale = await getVersion();
  return plusRecente(donnees.tag_name, locale)
    ? { version: donnees.tag_name.replace(/^v/i, ""), url: donnees.html_url }
    : null;
}

/** Au démarrage : ne fait rien si c'est désactivé, déjà vérifié aujourd'hui, ou hors ligne. */
export async function annoncerMiseAJour() {
  if (!verificationActivee()) return;
  try {
    const derniere = Number(localStorage.getItem(CLE_DERNIERE) ?? 0);
    if (Date.now() - derniere < UN_JOUR_MS) return;
    localStorage.setItem(CLE_DERNIERE, String(Date.now()));
    const maj = await derniereVersion();
    if (maj) {
      notify(true, `Projekt ${maj.version} est disponible.`, { label: "Voir", run: () => void openUrl(maj.url) });
    }
  } catch {
    // Hors ligne ou GitHub injoignable : on réessaiera demain, sans déranger.
  }
}
