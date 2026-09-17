import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { notify } from "../lib/notify";
import {
  annulerAppairage,
  autoriserPareFeu,
  pareFeuOk,
  DELAI_CONNECTE_MS,
  etatTelephone,
  oublierTelephone,
  preparerAppairage,
  surContact,
  type EtatTelephone,
} from "../lib/telephone";
import { enAnglais, tr } from "../lib/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DEPOT_GITHUB } from "../lib/misesAJour";

const ouvrirVersions = () =>
  void openUrl(`https://github.com/${DEPOT_GITHUB}/releases/latest`).catch((err) =>
    notify(false, `${tr("Impossible d'ouvrir le navigateur", "Couldn't open the browser")} : ${String(err)}`)
  );
const lienVersions: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  color: "var(--accent)",
  cursor: "pointer",
  font: "inherit",
  textDecoration: "underline",
};

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
      notify(
        true,
        tr(
          `« ${nouveau.nom} » est appairé : partage depuis ton téléphone vers Projekt.`,
          `“${nouveau.nom}” is paired: share from your phone to Projekt.`
        )
      );
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
      notify(false, `${tr("Impossible de préparer l'appairage", "Couldn't prepare pairing")} : ${err instanceof Error ? err.message : String(err)}`);
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
        title={connecte ? tr("Projekt Mobile — téléphone connecté", "Projekt Mobile — phone connected") : "Projekt Mobile"}
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
            {tr(
              "Partage un texte, un lien, un TikTok, une image ou un MP3 depuis ton téléphone Android : il arrive dans le projet de ton choix, sans internet ni compte.",
              "Share text, a link, a TikTok, an image or an MP3 from your Android phone: it lands in the project of your choice, with no internet and no account."
            )}
          </p>

          {etat && <PareFeu />}

          {etat === null && (
            <p style={{ ...texteDim, color: "var(--danger)" }}>
              {tr("La réception n'est disponible que dans l'application Projekt.", "Receiving only works in the Projekt app.")}
            </p>
          )}

          {qr ? (
            <div>
              <Titre>{tr("Appairer un téléphone", "Pair a phone")}</Titre>
              {qrExpire ? (
                <p style={texteDim}>{tr("Ce QR code a expiré.", "This QR code has expired.")}</p>
              ) : (
                <>
                  <img
                    src={qr.image}
                    alt={tr("QR code d'appairage", "Pairing QR code")}
                    width={232}
                    height={232}
                    style={{ display: "block", margin: "4px auto 8px", borderRadius: 6 }}
                  />
                  <p style={{ ...texteDim, textAlign: "center" }}>
                    {enAnglais ? (
                      <>
                        In Projekt Mobile, tap <b>“Pair a PC”</b> and scan this code.
                      </>
                    ) : (
                      <>
                        Dans Projekt Mobile, touche <b>« Appairer un PC »</b> et scanne ce code.
                      </>
                    )}
                    <br />
                    {tr("Valable encore", "Valid for")} {Math.max(1, Math.ceil((qr.expireLe - maintenant) / 60000))} min.
                  </p>
                </>
              )}
              <Astuce>
                {enAnglais ? (
                  <>
                    The phone and the PC must be on the <b>same network</b>: the same Wi-Fi, or the PC connected to the
                    phone's hotspot. If Windows asks for permission, also tick <b>“Public networks”</b>: a hotspot is often
                    treated as public.
                  </>
                ) : (
                  <>
                    Le téléphone et le PC doivent être sur le <b>même réseau</b> : même Wi-Fi, ou le PC branché au
                    partage de connexion du téléphone. Si Windows demande l'autorisation, coche aussi{" "}
                    <b>« Réseaux publics »</b> : le partage de connexion est souvent vu comme public.
                  </>
                )}
              </Astuce>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {qrExpire && (
                  <button style={boutonPrincipal} onClick={afficherQr}>
                    {tr("Nouveau QR code", "New QR code")}
                  </button>
                )}
                <button style={boutonSecondaire} onClick={fermerQr}>
                  {tr("Annuler", "Cancel")}
                </button>
              </div>
            </div>
          ) : (
            etat && (
              <>
                {appareils.length === 0 ? (
                  <ol style={{ ...texteDim, paddingLeft: 18, margin: "8px 0 10px" }}>
                    {enAnglais ? (
                      <>
                        <li>
                          Install <b>Projekt Mobile</b> on your Android phone: the file <code>Projekt-Mobile.apk</code> is on{" "}
                          <button style={lienVersions} onClick={ouvrirVersions}>
                            the releases page
                          </button>
                          .
                        </li>
                        <li>Put the phone and the PC on the same network.</li>
                        <li>Show the QR code below and scan it from the app.</li>
                      </>
                    ) : (
                      <>
                        <li>
                          Installe <b>Projekt Mobile</b> sur ton téléphone Android : le fichier <code>Projekt-Mobile.apk</code> est sur{" "}
                          <button style={lienVersions} onClick={ouvrirVersions}>
                            la page des versions
                          </button>
                          .
                        </li>
                        <li>Mets le téléphone et le PC sur le même réseau.</li>
                        <li>Affiche le QR code ci-dessous et scanne-le depuis l'app.</li>
                      </>
                    )}
                  </ol>
                ) : (
                  <>
                    <Titre>{tr("Téléphones appairés", "Paired phones")}</Titre>
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
                                {enLigne
                                  ? tr("Connecté", "Connected")
                                  : a.vuLe
                                    ? tr(`Vu ${depuis(maintenant - a.vuLe)}`, `Seen ${depuis(maintenant - a.vuLe)}`)
                                    : tr("Jamais vu", "Never seen")}
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
                                {tr("Confirmer", "Confirm")}
                              </button>
                            ) : (
                              <button
                                style={boutonSecondaire}
                                title={tr("Ce téléphone ne pourra plus rien envoyer, jusqu'à un nouvel appairage.", "This phone won't be able to send anything until it is paired again.")}
                                onClick={() => setAOublier(a.id)}
                              >
                                {tr("Oublier", "Forget")}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                <button style={boutonPrincipal} onClick={afficherQr}>
                  {appareils.length ? tr("Appairer un autre téléphone", "Pair another phone") : tr("Afficher le QR code", "Show QR code")}
                </button>
                {etat.actif && etat.adresses.length > 0 && (
                  <p style={{ ...texteDim, marginTop: 10, marginBottom: 0, fontSize: 11 }}>
                    {tr("Ce PC", "This PC")} : {etat.nomPc} · {etat.adresses.join(", ")} · port {etat.port}
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

/**
 * Recette du 13/09 : avec Norton comme pare-feu enregistré, Windows bloque le
 * téléphone sans rien demander. On vérifie donc les règles, et on propose de les
 * créer (confirmation administrateur de Windows) seulement s'il en manque.
 */
function PareFeu() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    pareFeuOk()
      .then(setOk)
      .catch(() => setOk(null));
  }, []);

  if (ok === null) return null;
  if (ok) {
    return (
      <p style={{ ...texteDim, fontSize: 11.5 }}>
        ✓ {tr("Pare-feu : Projekt Mobile est autorisé.", "Firewall: Projekt Mobile is allowed.")}
      </p>
    );
  }

  const autoriser = async () => {
    setEnCours(true);
    const reussi = await autoriserPareFeu().catch(() => false);
    setEnCours(false);
    setOk(reussi);
    notify(
      reussi,
      reussi
        ? tr("Projekt est autorisé dans le pare-feu : le téléphone peut maintenant le joindre.", "Projekt is allowed through the firewall: the phone can now reach it.")
        : tr(
            "Autorisation non accordée. Si tu utilises Norton ou un autre antivirus, autorise projekt.exe dans son pare-feu.",
            "Permission not granted. If you use Norton or another antivirus, allow projekt.exe in its firewall."
          )
    );
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <Astuce>
        {tr(
          "Le pare-feu de Windows bloque les connexions du téléphone. Autorise Projekt une fois : Windows te demandera une confirmation administrateur.",
          "The Windows firewall blocks connections from the phone. Allow Projekt once: Windows will ask for administrator confirmation."
        )}
      </Astuce>
      <button style={{ ...boutonPrincipal, marginTop: 8 }} disabled={enCours} onClick={() => void autoriser()}>
        {enCours ? tr("Confirmation en attente…", "Waiting for confirmation…") : tr("Autoriser Projekt dans le pare-feu", "Allow Projekt through the firewall")}
      </button>
    </div>
  );
}

function depuis(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return tr(`il y a ${minutes} min`, `${minutes} min ago`);
  const heures = Math.round(minutes / 60);
  if (heures < 24) return tr(`il y a ${heures} h`, `${heures} h ago`);
  const jours = Math.round(heures / 24);
  return tr(`il y a ${jours} jour${jours > 1 ? "s" : ""}`, `${jours} day${jours > 1 ? "s" : ""} ago`);
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
