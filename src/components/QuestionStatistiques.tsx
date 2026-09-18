import { tr } from "../lib/i18n";
import { activerStatistiques } from "../lib/statistiques";
import Fenetre, { boutonPrincipal, boutonSecondaire, texteDim } from "./Fenetre";
import { DetailStatistiques } from "./StatistiquesFenetre";

/**
 * Posée UNE fois à qui n'a pas encore choisi (nouvelle installation ou passage
 * depuis la 0.2.0, demande du 18/09). Fermer sans répondre vaut « non » : on ne
 * repose pas la question à chaque lancement.
 */
export default function QuestionStatistiques({ onFermer }: { onFermer: () => void }) {
  const repondre = (oui: boolean) => {
    activerStatistiques(oui);
    onFermer();
  };
  return (
    <Fenetre titre={tr("Aider à améliorer Projekt ?", "Help improve Projekt?")} largeur={500} onFermer={() => repondre(false)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{tr("Aider à améliorer Projekt ?", "Help improve Projekt?")}</div>
        <DetailStatistiques />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={boutonSecondaire} onClick={() => repondre(false)}>
            {tr("Non merci", "No thanks")}
          </button>
          <button style={boutonPrincipal} onClick={() => repondre(true)}>
            {tr("Oui, activer", "Yes, turn on")}
          </button>
        </div>
        <p style={{ ...texteDim, fontSize: 11.5 }}>
          {tr("Tu pourras changer d'avis quand tu veux : ☰ → Aide → Statistiques anonymes.", "You can change your mind anytime: ☰ → Help → Anonymous statistics.")}
        </p>
      </div>
    </Fenetre>
  );
}
