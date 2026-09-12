import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Ouvre un lien dans le navigateur du système.
 * Indispensable : dans la webview Tauri, suivre le lien remplacerait l'application
 * elle-même par la page web. Hors Tauri (panneau de test), on retombe sur un onglet.
 */
export async function openExternal(href: string) {
  try {
    await openUrl(href);
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}
