import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { notify } from "../lib/notify";
import {
  annulerAppairage,
  DELAI_CONNECTE_MS,
  etatTelephone,
  oublierTelephone,
  preparerAppairage,
  surContact,
  type EtatTelephone,
} from "../lib/telephone";

/**
 * Bouton 📱 de la barre du haut (choix du 12/09) : appairer Projekt Mobile par
 * QR code, voir les téléphones appairés et s'ils sont connectés.
 */
export default function TelephoneMenu() {
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState<EtatTelephone | null>(null);
  const [qr, setQr] = useState<{ image: string; expireLe: number; depuis: number } | null>(null);
  const [aOublier, setAOublier] = useState<string | null>(null);
  const [maintenant, setMaintenant] = useState(Date.now());
  const ref = useRef<HTMLDivElement>(null);

  const rafraichir = useCallback(() => {
    etatTelephone()
      .then(setEtat)
      .catch(() => setEtat(null));
  }, []);

  useEffect(() => {
    rafraichir();
    return surContact(rafraichir);
  }, [rafraichir]);

  // Pendant qu'un QR code est affiché, on guette l'arrivée du téléphone.
  useEffect(() => {
    const minuterie = window.setInterval(
      () => {
        setMaintenant(Date.now());
        if (qr || ouvert) rafraichir();
      },
      qr ? 2000 : 15000
    );
    return () => window.clearInterval(minuterie);
  }, [qr, ouvert, rafraichir]);

  useEffect(() => {
    if (!qr || !etat) return;
    const nouveau = etat.appareils.find((a) => a.ajouteLe >= qr.depuis);
    if (nouveau) {
      setQr(null);
      notify(true, `« ${nouveau.nom} » est appairé : partage depuis ton téléphone vers Projekt.`);
    }
  }, [etat, qr]);

  useEffect(() => {
    function clicDehors(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOuvert(false);
        setAOublier(null);
      }
    }
    document.addEventListener("mousedown", clicDehors);
    return () => document.removeEventListener("mousedown", clicDehors);
  }, []);

  const afficherQr = async () => {
    try {
      const depuis = Date.now() - 1000;
      const { lien, expireLe } = await preparerAppairage();
      // Noir sur blanc quel que soit le thème : les appareils photo lisent mal un QR inversé.
      const image = await QRCode.toDataURL(lien, {
        margin: 2,
        width: 232,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQr({ image, expireLe, depuis });
      rafraichir();
    } catch (err) {
      notify(false, `Impossible de préparer l'appairage : ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const fermerQr = () => {
    setQr(null);
    void annulerAppairage().catch(() => {});
  };

  const appareils = etat?.appareils ?? [];
  const connecte = appareils.some((a) => maintenant - a.vuLe < DELAI_CONNECTE_MS);
  const qrExpire = qr ? maintenant > qr.expireLe : false;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOuvert((o) => !o)}
        title={connecte ? "Projekt Mobile — téléphone connecté" : "Projekt Mobile"}
        aria-label="Projekt Mobile"
        aria-expanded={ouvert}
        style={{ ...boutonStyle, background: ouvert ? "var(--surface-2)" : "transparent" }}
      >
        <svg width="14" height="15" viewBox="0 0 14 16" fill="none" aria-hidden>
          <rect x="2" y="1" width="10" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 12.5h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {appareils.length > 0 && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: connecte ? "#4ade80" : "var(--text-dim)",
              boxShadow: "0 0 0 2px var(--surface)",
            }}
          />
        )}
      </button>

      {ouvert && (
        <div className="scroll" style={panneau}>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>Projekt Mobile</div>
          <p style={texteDim}>
            Partage un texte, un lien, un TikTok, une image ou un MP3 depuis ton téléphone Android : il arrive dans le
            projet de ton choix, sans internet ni compte.
          </p>

          {etat === null && (
            <p style={{ ...texteDim, color: "var(--danger)" }}>La réception n'est disponible que dans l'application Projekt.</p>
          )}

          {qr ? (
            <div>
              <Titre>Appairer un téléphone</Titre>
              {qrExpire ? (
                <p style={texteDim}>Ce QR code a expiré.</p>
              ) : (
                <>
                  <img
                    src={qr.image}
                    alt="QR code d'appairage"
                    width={232}
                    height={232}
                    style={{ display: "block", margin: "4px auto 8px", borderRadius: 6 }}
                  />
                  <p style={{ ...texteDim, textAlign: "center" }}>
                    Dans Projekt Mobile, touche <b>« Appairer un PC »</b> et scanne ce code.
                    <br />
                    Valable encore {Math.max(1, Math.ceil((qr.expireLe - maintenant) / 60000))} min.
                  </p>
                </>
              )}
              <Astuce>
                Le téléphone et le PC doivent être sur le <b>même réseau</b> : même Wi-Fi, ou le PC branché au partage de
                connexion du téléphone. Si Windows demande l'autorisation, coche aussi <b>« Réseaux publics »</b> : le
                partage de connexion est souvent vu comme public.
              </Astuce>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {qrExpire && (
                  <button style={boutonPrincipal} onClick={afficherQr}>
                    Nouveau QR code
                  </button>
                )}
                <button style={boutonSecondaire} onClick={fermerQr}>
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            etat && (
              <>
                {appareils.length === 0 ? (
                  <ol style={{ ...texteDim, paddingLeft: 18, margin: "8px 0 10px" }}>
                    <li>Installe <b>Projekt Mobile</b> sur ton téléphone (fichier <code>Projekt-Mobile.apk</code>).</li>
                    <li>Mets le téléphone et le PC sur le même réseau.</li>
                    <li>Affiche le QR code ci-dessous et scanne-le depuis l'app.</li>
                  </ol>
                ) : (
                  <>
                    <Titre>Téléphones appairés</Titre>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                      {appareils.map((a) => {
                        const enLigne = maintenant - a.vuLe < DELAI_CONNECTE_MS;
                        return (
                          <div key={a.id} style={ligneAppareil}>
                            <span
                              aria-hidden
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                flexShrink: 0,
                                background: enLigne ? "#4ade80" : "var(--text-dim)",
                              }}
                            />
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: "block", fontSize: 12.5 }}>{a.nom}</span>
                              <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>
                                {enLigne ? "Connecté" : a.vuLe ? `Vu ${depuis(maintenant - a.vuLe)}` : "Jamais vu"}
                              </span>
                            </span>
                            {aOublier === a.id ? (
                              <button
                                style={{ ...boutonSecondaire, color: "var(--danger)", borderColor: "var(--danger)" }}
                                onClick={() => {
                                  void oublierTelephone(a.id).then(rafraichir);
                                  setAOublier(null);
                                }}
                              >
                                Confirmer
                              </button>
                            ) : (
                              <button
                                style={boutonSecondaire}
                                title="Ce téléphone ne pourra plus rien envoyer, jusqu'à un nouvel appairage."
                                onClick={() => setAOublier(a.id)}
                              >
                                Oublier
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                <button style={boutonPrincipal} onClick={afficherQr}>
                  {appareils.length ? "Appairer un autre téléphone" : "Afficher le QR code"}
                </button>
                {etat.actif && etat.adresses.length > 0 && (
                  <p style={{ ...texteDim, marginTop: 10, marginBottom: 0, fontSize: 11 }}>
                    Ce PC : {etat.nomPc} · {etat.adresses.join(", ")} · port {etat.port}
                  </p>
                )}
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}

function depuis(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.round(heures / 24);
  return `il y a ${jours} jour${jours > 1 ? "s" : ""}`;
}

function Titre({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-dim)",
        margin: "10px 0 8px",
      }}
    >
      {children}
    </div>
  );
}

function Astuce({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11.5,
        lineHeight: 1.45,
        color: "var(--text-dim)",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "7px 9px",
      }}
    >
      {children}
    </div>
  );
}

const boutonStyle: CSSProperties = {
  position: "relative",
  width: 28,
  height: 28,
  borderRadius: 6,
  border: "1px solid var(--border)",
  color: "var(--text-dim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

const panneau: CSSProperties = {
  position: "absolute",
  top: 34,
  right: 0,
  width: 300,
  maxHeight: "calc(100vh - 70px)",
  overflowY: "auto",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 12,
  boxShadow: "0 12px 28px rgba(0,0,0,0.35)",
  zIndex: 50,
};

const texteDim: CSSProperties = { fontSize: 12, lineHeight: 1.5, color: "var(--text-dim)", margin: "0 0 8px" };

const ligneAppareil: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
};

const boutonPrincipal: CSSProperties = {
  fontSize: 12,
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid var(--accent)",
  background: "var(--accent-soft)",
  color: "var(--accent)",
  cursor: "pointer",
};

const boutonSecondaire: CSSProperties = {
  fontSize: 11.5,
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
  cursor: "pointer",
};
