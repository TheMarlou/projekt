import type { ContextMenuGroup } from "../components/editor/ContextMenu";
import { activerVerification, derniereVersion, verificationActivee } from "./misesAJour";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notify } from "./notify";
import { exportPageMarkdown, exportProject, importProject, type IOResult } from "./projectIO";

/**
 * Entrées « Sauvegarder sous » / « Importer », partagées entre le bouton de la
 * barre du haut et le clic droit sur un projet dans la barre latérale.
 *
 * Le travail réel est dans `projectIO` ; ici on ne fait qu'annoncer le résultat.
 * Ce fichier ne contient aucun composant, pour ne pas casser le rafraîchissement
 * rapide de la vue qui l'utilise.
 */

/** Une opération annulée ne dit rien : ni réussite à féliciter, ni erreur à signaler. */
async function annoncer(travail: Promise<IOResult>) {
  const resultat = await travail;
  if (resultat.annule) return;
  notify(resultat.ok, resultat.message);
}

export function fileMenuGroups(options: {
  projectId: string | null;
  projectName: string | null;
  pageId: string | null;
  pageTitle: string | null;
  /**
   * Faux dans le menu d'un projet de la barre latérale : la page ouverte peut
   * appartenir à un AUTRE projet que celui sur lequel on a fait le clic droit,
   * et proposer de l'exporter là serait ambigu.
   */
  partage?: boolean;
}): ContextMenuGroup[] {
  const { projectId, projectName, pageId, pageTitle, partage = true } = options;

  const groupes: ContextMenuGroup[] = [
    {
      caption: "Sauvegarder",
      entries: [
        {
          label: projectName ? `Sauvegarder « ${projectName} » sous…` : "Sauvegarder le projet sous…",
          hint: ".zip",
          disabled: !projectId,
          run: () => projectId && annoncer(exportProject(projectId)),
        },
        {
          label: "Importer une sauvegarde…",
          run: () => annoncer(importProject()),
        },
      ],
    },
  ];

  if (partage) {
    groupes.push({
      caption: "Partager",
      entries: [
        {
          label: pageTitle ? `Exporter « ${pageTitle} » en Markdown…` : "Exporter la page en Markdown…",
          hint: ".zip",
          disabled: !pageId,
          run: () => pageId && annoncer(exportPageMarkdown(pageId)),
        },
      ],
    });
  }

  if (partage) {
    const active = verificationActivee();
    groupes.push({
      caption: "Aide",
      entries: [
        {
          label: "Signaler un problème…",
          run: () => window.dispatchEvent(new CustomEvent(EVENEMENT_SIGNALER)),
        },
        {
          label: active ? "Mises à jour : vérification activée" : "Mises à jour : vérification désactivée",
          hint: active ? "désactiver" : "activer",
          run: () => {
            activerVerification(!active);
            if (active) {
              notify(true, "Vérification des mises à jour désactivée : Projekt ne contacte plus internet de lui-même.");
              return;
            }
            notify(true, "Vérification activée : Projekt demandera à GitHub, une fois par jour au plus, s'il existe une nouvelle version.");
            void derniereVersion()
              .then((maj) =>
                maj
                  ? notify(true, `Projekt ${maj.version} est disponible.`, { label: "Voir", run: () => void openUrl(maj.url) })
                  : notify(true, "Tu as la dernière version de Projekt.")
              )
              .catch(() => notify(false, "Impossible de joindre GitHub pour l'instant : nouvel essai au prochain démarrage."));
          },
        },
      ],
    });
  }

  return groupes;
}

/** Ouvre la fenêtre « Signaler un problème » (écoutée par App). */
export const EVENEMENT_SIGNALER = "projekt:signaler-probleme";
