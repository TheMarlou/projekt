import { useSyncExternalStore, type CSSProperties } from "react";
import { enAnglais, localeDates, tr } from "../lib/i18n";
import {
  activerStatistiques,
  CE_QUI_EST_MESURE,
  CE_QUI_NEST_JAMAIS_MESURE,
  evenementsEnvoyes,
  statistiquesActivees,
  suivreStatistiques,
} from "../lib/statistiques";
import Fenetre, { boutonSecondaire, texteDim } from "./Fenetre";

/** ☰ → Aide → Statistiques anonymes : ce qui est mesuré, l'interrupteur, et ce qui est parti. */
export default function StatistiquesFenetre({ onFermer }: { onFermer: () => void }) {
  const activees = useSyncExternalStore(suivreStatistiques, statistiquesActivees);
  // Nouvelle liste à chaque envoi : on la relit à chaque rendu provoqué par l'abonnement.
  const envoyes = evenementsEnvoyes().reverse();

  return (
    <Fenetre titre={tr("Statistiques anonymes", "Anonymous statistics")} largeur={520} onFermer={onFermer}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{tr("Aider à améliorer Projekt", "Help improve Projekt")}</div>
        <DetailStatistiques />

        <label style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={activees}
            onChange={(e) => activerStatistiques(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          {tr("Envoyer des statistiques anonymes", "Send anonymous statistics")}
        </label>

        {activees && (
          <div>
            <div style={{ ...texteDim, fontSize: 11.5, marginBottom: 4 }}>
              {tr("Envoyé depuis l'ouverture de Projekt :", "Sent since Projekt was opened:")}
            </div>
            {envoyes.length === 0 ? (
              <div style={{ ...texteDim, fontSize: 12 }}>{tr("Rien pour l'instant.", "Nothing yet.")}</div>
            ) : (
              <pre style={journal}>
                {envoyes
                  .map(
                    (e) =>
                      `${new Date(e.quand).toLocaleTimeString(localeDates)}  ${e.nom}${
                        Object.keys(e.props).length ? `  ${JSON.stringify(e.props)}` : ""
                      }`
                  )
                  .join("\n")}
              </pre>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button style={boutonSecondaire} onClick={onFermer}>
            {tr("Fermer", "Close")}
          </button>
        </div>
      </div>
    </Fenetre>
  );
}

/** Le détail de ce qui est mesuré : partagé avec l'écran d'accueil. */
export function DetailStatistiques() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <p style={texteDim}>
        {tr(
          "Désactivées par défaut. Si tu les actives, Projekt envoie de courts comptes rendus d'usage (service Aptabase, hébergé en Europe), pour savoir ce qui sert, ce qui coince et ce qui plante :",
          "Off by default. If you turn them on, Projekt sends short usage reports (Aptabase service, hosted in Europe) to learn what's useful, what gets in the way and what crashes:"
        )}
      </p>
      <ul style={{ ...texteDim, margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
        {CE_QUI_EST_MESURE.map((m) => (
          <li key={m.fr}>{enAnglais ? m.en : m.fr}</li>
        ))}
      </ul>
      <p style={{ ...texteDim, color: "var(--text)" }}>{enAnglais ? CE_QUI_NEST_JAMAIS_MESURE.en : CE_QUI_NEST_JAMAIS_MESURE.fr}</p>
    </div>
  );
}

const journal: CSSProperties = {
  margin: 0,
  maxHeight: 160,
  overflow: "auto",
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 8,
  color: "var(--text-dim)",
};
