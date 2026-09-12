import type { ContextMenuGroup } from "../components/editor/ContextMenu";
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

  return groupes;
}
