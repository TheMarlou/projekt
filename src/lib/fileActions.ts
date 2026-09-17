import type { ContextMenuGroup } from "../components/editor/ContextMenu";
import { openUrl } from "@tauri-apps/plugin-opener";
import { changerLangue, langue, tr } from "./i18n";
import { activerVerification, derniereVersion, verificationActivee } from "./misesAJour";
import { notify } from "./notify";
import { fonctionUtilisee, statistiquesActivees, statistiquesDisponibles } from "./statistiques";
import { exportPageMarkdown, exportProject, importProject, type IOResult } from "./projectIO";

/**
 * Entrées du menu ☰ (sauvegarder, importer, exporter, aide, langue), partagées
 * entre le bouton de la barre du haut et le clic droit sur un projet dans la
 * barre latérale.
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

/** Ouvre la fenêtre « Signaler un problème » (écoutée par App). */
export const EVENEMENT_SIGNALER = "projekt:signaler-probleme";
/** Ouvrent « À propos » et l'accueil (écoutés par App). */
export const EVENEMENT_A_PROPOS = "projekt:a-propos";
export const EVENEMENT_ACCUEIL = "projekt:accueil";
export const EVENEMENT_STATISTIQUES = "projekt:statistiques";

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
      caption: tr("Sauvegarder", "Save"),
      entries: [
        {
          label: projectName
            ? tr(`Sauvegarder « ${projectName} » sous…`, `Save “${projectName}” as…`)
            : tr("Sauvegarder le projet sous…", "Save project as…"),
          hint: ".zip",
          disabled: !projectId,
          run: () => {
            if (!projectId) return;
            fonctionUtilisee("export_projet");
            void annoncer(exportProject(projectId));
          },
        },
        {
          label: tr("Importer une sauvegarde…", "Import a backup…"),
          run: () => {
            fonctionUtilisee("import_projet");
            void annoncer(importProject());
          },
        },
      ],
    },
  ];

  if (!partage) return groupes;

  groupes.push({
    caption: tr("Partager", "Share"),
    entries: [
      {
        label: pageTitle
          ? tr(`Exporter « ${pageTitle} » en Markdown…`, `Export “${pageTitle}” as Markdown…`)
          : tr("Exporter la page en Markdown…", "Export page as Markdown…"),
        hint: ".zip",
        disabled: !pageId,
        run: () => {
          if (!pageId) return;
          fonctionUtilisee("export_markdown");
          void annoncer(exportPageMarkdown(pageId));
        },
      },
    ],
  });

  const active = verificationActivee();
  groupes.push({
    caption: tr("Aide", "Help"),
    entries: [
      {
        label: tr("Accueil et projet d'exemple…", "Welcome and sample project…"),
        run: () => window.dispatchEvent(new CustomEvent(EVENEMENT_ACCUEIL)),
      },
      {
        label: tr("Signaler un problème…", "Report a problem…"),
        run: () => window.dispatchEvent(new CustomEvent(EVENEMENT_SIGNALER)),
      },
      {
        label: active
          ? tr("Mises à jour : vérification activée", "Updates: checking on")
          : tr("Mises à jour : vérification désactivée", "Updates: checking off"),
        hint: active ? tr("désactiver", "turn off") : tr("activer", "turn on"),
        run: () => {
          activerVerification(!active);
          if (active) {
            notify(
              true,
              tr(
                "Vérification des mises à jour désactivée : Projekt ne contacte plus internet de lui-même.",
                "Update checking turned off: Projekt no longer goes online on its own."
              )
            );
            return;
          }
          notify(
            true,
            tr(
              "Vérification activée : Projekt demandera à GitHub, une fois par jour au plus, s'il existe une nouvelle version.",
              "Update checking turned on: at most once a day, Projekt will ask GitHub whether a new version exists."
            )
          );
          void derniereVersion()
            .then((maj) =>
              maj
                ? notify(true, tr(`Projekt ${maj.version} est disponible.`, `Projekt ${maj.version} is available.`), {
                    label: tr("Voir", "View"),
                    run: () => void openUrl(maj.url),
                  })
                : notify(true, tr("Tu as la dernière version de Projekt.", "You have the latest version of Projekt."))
            )
            .catch(() =>
              notify(
                false,
                tr(
                  "Impossible de vérifier les mises à jour pour l'instant (GitHub injoignable, ou dépôt pas encore publié). Nouvel essai au prochain démarrage.",
                  "Can't check for updates right now (GitHub unreachable, or the repository isn't published yet). Projekt will try again next time it starts."
                )
              )
            );
        },
      },
      ...(statistiquesDisponibles()
        ? [
            {
              label: statistiquesActivees()
                ? tr("Statistiques anonymes : activées", "Anonymous statistics: on")
                : tr("Statistiques anonymes : désactivées", "Anonymous statistics: off"),
              hint: tr("détails", "details"),
              run: () => window.dispatchEvent(new CustomEvent(EVENEMENT_STATISTIQUES)),
            },
          ]
        : []),
      {
        label: tr("À propos de Projekt…", "About Projekt…"),
        run: () => window.dispatchEvent(new CustomEvent(EVENEMENT_A_PROPOS)),
      },
    ],
  });

  // Langue : le nom de chaque langue est écrit dans cette langue, pour qu'on la
  // retrouve même si l'interface est dans l'autre.
  groupes.push({
    caption: tr("Langue", "Language"),
    entries: [
      { label: "Français", hint: langue === "fr" ? "✓" : undefined, run: () => changerLangue("fr") },
      { label: "English", hint: langue === "en" ? "✓" : undefined, run: () => changerLangue("en") },
    ],
  });

  return groupes;
}
