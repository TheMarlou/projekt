//! Réception depuis « Projekt Mobile » (demande du 12/09).
//!
//! Le téléphone et le PC se parlent en DIRECT sur le réseau local : Wi-Fi, ou le
//! petit réseau que crée le partage de connexion du téléphone (câble USB compris).
//! Pas de serveur, pas de compte, rien ne sort de chez l'utilisateur.
//!
//! Sécurité : l'appairage se fait par un QR code qui porte une clé secrète de
//! 256 bits. Ensuite, chaque requête est CHIFFRÉE ET AUTHENTIFIÉE (AES-256-GCM) :
//! un inconnu sur le même Wi-Fi ne peut ni lire ce qui passe, ni rien envoyer.
//! Les données associées (route + appareil) empêchent de rejouer un message sur
//! une autre route ; l'heure d'envoi et la liste des éléments déjà reçus
//! empêchent de le rejouer plus tard.
//!
//! Tout ce qui décide (`traiter`) est pur et testé sans Tauri ; le reste du
//! fichier ne fait que brancher le réseau, le disque et les événements.

use aes_gcm::aead::{generic_array::GenericArray, Aead, KeyInit, Payload};
use aes_gcm::Aes256Gcm;
use base64::engine::general_purpose::{STANDARD as B64, URL_SAFE_NO_PAD as B64URL};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::fs;
use std::io::Read;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// Port d'écoute (TCP pour les requêtes, UDP pour la découverte). Si un autre
/// programme l'occupe, les 9 suivants sont essayés.
pub const PORT: u16 = 47821;
const PORTS_ESSAYES: u16 = 10;
/// Une image de galerie ou un MP3, encodés en base64 dans le JSON chiffré.
const TAILLE_MAX_CORPS: usize = 60 * 1024 * 1024;
/// Écart toléré entre l'horloge du téléphone et celle du PC.
const DERIVE_HORLOGE_MS: i64 = 15 * 60 * 1000;
/// Un QR code affiché n'est valable que 10 minutes.
pub const DUREE_APPAIRAGE_MS: i64 = 10 * 60 * 1000;
/// Identifiants des derniers éléments reçus, pour ignorer un renvoi.
const IDS_RETENUS: usize = 1000;
const GENRES: [&str; 4] = ["texte", "lien", "image", "audio"];

// ——— Chiffrement ———————————————————————————————————————————————————————————

/// Paquet = nonce (12 octets) ‖ texte chiffré ‖ étiquette (16 octets) — le même
/// format que `Cipher.getInstance("AES/GCM/NoPadding")` côté Android.
pub fn chiffrer(cle: &[u8], aad: &[u8], clair: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    getrandom::getrandom(&mut nonce).map_err(|e| e.to_string())?;
    chiffrer_avec_nonce(cle, &nonce, aad, clair)
}

pub(crate) fn chiffrer_avec_nonce(cle: &[u8], nonce: &[u8; 12], aad: &[u8], clair: &[u8]) -> Result<Vec<u8>, String> {
    let algo = Aes256Gcm::new_from_slice(cle).map_err(|_| "clé invalide".to_string())?;
    let chiffre = algo
        .encrypt(GenericArray::from_slice(nonce), Payload { msg: clair, aad })
        .map_err(|_| "chiffrement impossible".to_string())?;
    let mut paquet = nonce.to_vec();
    paquet.extend(chiffre);
    Ok(paquet)
}

pub fn dechiffrer(cle: &[u8], aad: &[u8], paquet: &[u8]) -> Option<Vec<u8>> {
    if paquet.len() < 12 + 16 {
        return None;
    }
    let algo = Aes256Gcm::new_from_slice(cle).ok()?;
    algo.decrypt(GenericArray::from_slice(&paquet[..12]), Payload { msg: &paquet[12..], aad })
        .ok()
}

fn aleatoire(n: usize) -> Vec<u8> {
    let mut octets = vec![0u8; n];
    getrandom::getrandom(&mut octets).expect("générateur aléatoire du système indisponible");
    octets
}

// ——— État ——————————————————————————————————————————————————————————————————

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Appareil {
    pub id: String,
    pub nom: String,
    /// Clé de 32 octets en base64url.
    pub cle: String,
    pub ajoute_le: i64,
    #[serde(default)]
    pub vu_le: i64,
}

/// Ce qui est enregistré sur disque (`telephone/registre.json`).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Registre {
    pub pc_id: String,
    #[serde(default)]
    pub appareils: Vec<Appareil>,
    #[serde(default)]
    pub recus: VecDeque<String>,
}

#[derive(Clone, Debug)]
pub struct Attente {
    pub cle: String,
    pub expire_le: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProjetResume {
    pub id: String,
    pub nom: String,
}

pub struct Etat {
    pub registre: Registre,
    pub attente: Option<Attente>,
    /// Liste tenue à jour par l'interface (seule à lire la base).
    pub projets: Vec<ProjetResume>,
    pub nom_pc: String,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ElementEntrant {
    pub id: String,
    /// texte · lien · image · audio
    pub genre: String,
    pub projet: Option<String>,
    pub texte: Option<String>,
    pub url: Option<String>,
    /// Nom d'origine du fichier (image, MP3).
    pub nom: Option<String>,
    pub ext: Option<String>,
    /// Contenu du fichier en base64.
    pub donnees: Option<String>,
    pub cree_le: i64,
}

pub struct Requete<'a> {
    pub methode: &'a str,
    pub chemin: &'a str,
    pub appareil: Option<&'a str>,
    pub corps: &'a [u8],
}

#[derive(Debug)]
pub struct Reponse {
    pub statut: u16,
    pub corps: Vec<u8>,
    pub type_contenu: &'static str,
    /// Le registre a changé : à réécrire sur disque.
    pub sauver: bool,
    /// Un appareil connu vient de se manifester.
    pub contact: Option<String>,
    /// Élément accepté, à enregistrer AVANT de répondre.
    pub recu: Option<ElementEntrant>,
}

impl Reponse {
    fn texte(statut: u16, message: &str) -> Self {
        Reponse {
            statut,
            corps: message.as_bytes().to_vec(),
            type_contenu: "text/plain; charset=utf-8",
            sauver: false,
            contact: None,
            recu: None,
        }
    }
    fn json(statut: u16, valeur: &Value) -> Self {
        Reponse {
            corps: valeur.to_string().into_bytes(),
            type_contenu: "application/json",
            ..Reponse::texte(statut, "")
        }
    }
    fn chiffree(cle: &[u8], route: &str, appareil: &str, valeur: &Value) -> Self {
        let aad = format!("{route}-reponse|{appareil}");
        match chiffrer(cle, aad.as_bytes(), valeur.to_string().as_bytes()) {
            Ok(corps) => Reponse {
                corps,
                type_contenu: "application/octet-stream",
                ..Reponse::texte(200, "")
            },
            Err(e) => Reponse::texte(500, &e),
        }
    }
}

pub fn identifiant_valide(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn cle_de(texte: &str) -> Option<Vec<u8>> {
    B64URL.decode(texte).ok().filter(|c| c.len() == 32)
}

fn envoye_le(clair: &[u8]) -> Option<(Value, i64)> {
    let valeur: Value = serde_json::from_slice(clair).ok()?;
    let quand = valeur.get("envoyeLe")?.as_i64()?;
    Some((valeur, quand))
}

// ——— Décision ——————————————————————————————————————————————————————————————

pub fn traiter(etat: &mut Etat, req: &Requete, maintenant: i64) -> Reponse {
    match (req.methode, req.chemin) {
        ("GET", "/v1/ping") => Reponse::json(200, &json!({ "app": "projekt", "v": 1, "pc": etat.registre.pc_id })),
        ("POST", "/v1/appairer") => appairer(etat, req, maintenant),
        ("POST", "/v1/projets") => match authentifier(etat, req, "projets", maintenant) {
            Ok((i, _)) => {
                let a = &etat.registre.appareils[i];
                let mut r = Reponse::chiffree(
                    &cle_de(&a.cle).unwrap_or_default(),
                    "projets",
                    &a.id,
                    &json!({ "pc": etat.nom_pc, "projets": etat.projets }),
                );
                r.contact = Some(a.id.clone());
                r
            }
            Err(r) => *r,
        },
        ("POST", "/v1/envoi") => envoi(etat, req, maintenant),
        _ => Reponse::texte(404, "introuvable"),
    }
}

fn appairer(etat: &mut Etat, req: &Requete, maintenant: i64) -> Reponse {
    let Some(appareil) = req.appareil.filter(|a| identifiant_valide(a)) else {
        return Reponse::texte(400, "appareil manquant");
    };
    let Some(attente) = etat.attente.clone().filter(|a| a.expire_le > maintenant) else {
        return Reponse::texte(410, "aucun appairage en cours : affiche le QR code sur le PC");
    };
    let Some(cle) = cle_de(&attente.cle) else {
        return Reponse::texte(500, "clé d'appairage abîmée");
    };
    let Some(clair) = dechiffrer(&cle, format!("appairer|{appareil}").as_bytes(), req.corps) else {
        return Reponse::texte(403, "QR code périmé ou d'un autre PC");
    };
    let Some((valeur, quand)) = envoye_le(&clair) else {
        return Reponse::texte(400, "message illisible");
    };
    if (maintenant - quand).abs() > DERIVE_HORLOGE_MS {
        return Reponse::texte(400, "l'heure du téléphone et celle du PC sont trop différentes");
    }
    let nom: String = valeur
        .get("nom")
        .and_then(|n| n.as_str())
        .unwrap_or("Téléphone")
        .chars()
        .take(60)
        .collect();

    etat.registre.appareils.retain(|a| a.id != appareil);
    etat.registre.appareils.push(Appareil {
        id: appareil.to_string(),
        nom,
        cle: attente.cle.clone(),
        ajoute_le: maintenant,
        vu_le: maintenant,
    });
    etat.attente = None;

    let mut r = Reponse::chiffree(
        &cle,
        "appairer",
        appareil,
        &json!({ "pc": etat.nom_pc, "pcId": etat.registre.pc_id, "projets": etat.projets }),
    );
    r.sauver = true;
    r.contact = Some(appareil.to_string());
    r
}

/// Appareil connu + message déchiffré avec SA clé + heure plausible.
fn authentifier(etat: &mut Etat, req: &Requete, route: &str, maintenant: i64) -> Result<(usize, Value), Box<Reponse>> {
    let appareil = req
        .appareil
        .filter(|a| identifiant_valide(a))
        .ok_or_else(|| Box::new(Reponse::texte(400, "appareil manquant")))?;
    let i = etat
        .registre
        .appareils
        .iter()
        .position(|a| a.id == appareil)
        .ok_or_else(|| Box::new(Reponse::texte(401, "téléphone inconnu : appaire-le à nouveau")))?;
    let cle = cle_de(&etat.registre.appareils[i].cle).ok_or_else(|| Box::new(Reponse::texte(500, "clé abîmée")))?;
    let clair = dechiffrer(&cle, format!("{route}|{appareil}").as_bytes(), req.corps)
        .ok_or_else(|| Box::new(Reponse::texte(403, "message refusé")))?;
    let (valeur, quand) = envoye_le(&clair).ok_or_else(|| Box::new(Reponse::texte(400, "message illisible")))?;
    if (maintenant - quand).abs() > DERIVE_HORLOGE_MS {
        return Err(Box::new(Reponse::texte(400, "l'heure du téléphone et celle du PC sont trop différentes")));
    }
    etat.registre.appareils[i].vu_le = maintenant;
    Ok((i, valeur))
}

fn extension_valide(ext: &str) -> bool {
    !ext.is_empty() && ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric())
}

fn envoi(etat: &mut Etat, req: &Requete, maintenant: i64) -> Reponse {
    let (i, valeur) = match authentifier(etat, req, "envoi", maintenant) {
        Ok(v) => v,
        Err(r) => return *r,
    };
    let appareil = etat.registre.appareils[i].clone();
    let cle = cle_de(&appareil.cle).unwrap_or_default();

    let Some(element) = valeur.get("element").and_then(|e| serde_json::from_value::<ElementEntrant>(e.clone()).ok()) else {
        return Reponse::texte(400, "élément illisible");
    };
    if !identifiant_valide(&element.id) || !GENRES.contains(&element.genre.as_str()) {
        return Reponse::texte(400, "élément invalide");
    }
    if element.texte.as_ref().is_some_and(|t| t.len() > 100_000) || element.url.as_ref().is_some_and(|u| u.len() > 4000) {
        return Reponse::texte(413, "texte trop long");
    }
    let a_un_fichier = element.genre == "image" || element.genre == "audio";
    if a_un_fichier && (element.donnees.is_none() || !element.ext.as_deref().is_some_and(extension_valide)) {
        return Reponse::texte(400, "fichier manquant");
    }

    let mut r = Reponse::chiffree(&cle, "envoi", &appareil.id, &json!({ "ok": true }));
    r.contact = Some(appareil.id.clone());
    // Déjà reçu (le téléphone n'a pas eu la réponse et renvoie) : on confirme sans rien refaire.
    if etat.registre.recus.contains(&element.id) {
        return r;
    }
    etat.registre.recus.push_back(element.id.clone());
    while etat.registre.recus.len() > IDS_RETENUS {
        etat.registre.recus.pop_front();
    }
    r.sauver = true;
    r.recu = Some(element);
    r
}

// ——— Branchement : disque, réseau, événements ————————————————————————————————

pub struct Telephone {
    dossier: PathBuf,
    etat: Mutex<Etat>,
    port: Mutex<Option<u16>>,
    app: tauri::AppHandle,
}

fn maintenant_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn encoder_url(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Adresses IPv4 du PC sur les réseaux locaux (Wi-Fi, partage de connexion, câble).
pub fn adresses_locales() -> Vec<String> {
    let mut adresses: Vec<String> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(v4) if !v4.is_link_local() && !v4.is_unspecified() => Some(v4.to_string()),
            _ => None,
        })
        .collect();
    adresses.sort();
    adresses.dedup();
    adresses
}

impl Telephone {
    pub fn charger(app: &tauri::AppHandle) -> Result<Arc<Self>, String> {
        let dossier = app.path().app_data_dir().map_err(|e| e.to_string())?.join("telephone");
        fs::create_dir_all(dossier.join("recus")).map_err(|e| e.to_string())?;
        let registre = fs::read(dossier.join("registre.json"))
            .ok()
            .and_then(|o| serde_json::from_slice::<Registre>(&o).ok())
            .filter(|r| identifiant_valide(&r.pc_id))
            .unwrap_or_else(|| Registre {
                pc_id: aleatoire(8).iter().map(|b| format!("{b:02x}")).collect(),
                ..Registre::default()
            });
        let nom_pc = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into());
        let telephone = Arc::new(Telephone {
            dossier,
            etat: Mutex::new(Etat { registre, attente: None, projets: Vec::new(), nom_pc }),
            port: Mutex::new(None),
            app: app.clone(),
        });
        {
            // Premier lancement : l'identifiant du PC doit rester le même d'une fois sur l'autre.
            let etat = telephone.etat.lock().unwrap();
            telephone.sauver(&etat.registre);
        }
        // Le serveur n'écoute QUE si un téléphone est appairé : sinon, Windows
        // demanderait l'autorisation du pare-feu à des gens qui n'ont pas l'app mobile.
        let appaire = !telephone.etat.lock().unwrap().registre.appareils.is_empty();
        if appaire {
            if let Err(e) = telephone.demarrer() {
                eprintln!("Réception téléphone non démarrée : {e}");
            }
        }
        Ok(telephone)
    }

    fn sauver(&self, registre: &Registre) {
        let chemin = self.dossier.join("registre.json");
        let provisoire = self.dossier.join("registre.json.tmp");
        if let Ok(texte) = serde_json::to_vec_pretty(registre) {
            if fs::write(&provisoire, texte).is_ok() {
                let _ = fs::rename(&provisoire, &chemin);
            }
        }
    }

    pub fn demarrer(self: &Arc<Self>) -> Result<u16, String> {
        let mut port_actif = self.port.lock().unwrap();
        if let Some(p) = *port_actif {
            return Ok(p);
        }
        let mut dernier = String::new();
        for port in PORT..PORT + PORTS_ESSAYES {
            match tiny_http::Server::http(("0.0.0.0", port)) {
                Ok(serveur) => {
                    *port_actif = Some(port);
                    let moi = Arc::clone(self);
                    std::thread::spawn(move || {
                        for requete in serveur.incoming_requests() {
                            moi.repondre(requete);
                        }
                    });
                    let moi = Arc::clone(self);
                    std::thread::spawn(move || moi.decouverte(port));
                    return Ok(port);
                }
                Err(e) => dernier = e.to_string(),
            }
        }
        Err(format!("aucun port libre : {dernier}"))
    }

    /// Le téléphone crie « PROJEKT?<id du PC> » sur le réseau ; le bon PC répond
    /// avec son port. Sert quand l'adresse du PC a changé (partage de connexion).
    fn decouverte(self: Arc<Self>, port: u16) {
        let Ok(socket) = UdpSocket::bind(("0.0.0.0", port)) else {
            return;
        };
        let pc_id = self.etat.lock().unwrap().registre.pc_id.clone();
        let mut tampon = [0u8; 128];
        loop {
            let Ok((n, source)) = socket.recv_from(&mut tampon) else {
                // Windows signale ainsi un envoi précédent qui n'a pas abouti : on
                // souffle un peu pour ne jamais tourner à vide.
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            };
            let message = String::from_utf8_lossy(&tampon[..n]);
            if message.trim() == format!("PROJEKT?{pc_id}") {
                let _ = socket.send_to(format!("PROJEKT!{pc_id}|{port}").as_bytes(), source);
            }
        }
    }

    fn repondre(&self, mut requete: tiny_http::Request) {
        let methode = requete.method().as_str().to_string();
        let chemin = requete.url().split('?').next().unwrap_or("").to_string();

        if methode == "GET" && chemin.starts_with("/v1/mobile/") {
            let reponse = self.fichier_mobile(&chemin);
            let _ = requete.respond(reponse);
            return;
        }

        let appareil = requete
            .headers()
            .iter()
            .find(|h| h.field.equiv("X-Appareil"))
            .map(|h| h.value.as_str().to_string());
        if requete.body_length().unwrap_or(0) > TAILLE_MAX_CORPS {
            let _ = requete.respond(tiny_http::Response::from_string("trop gros").with_status_code(413));
            return;
        }
        let mut corps = Vec::new();
        if requete
            .as_reader()
            .take(TAILLE_MAX_CORPS as u64 + 1)
            .read_to_end(&mut corps)
            .is_err()
            || corps.len() > TAILLE_MAX_CORPS
        {
            let _ = requete.respond(tiny_http::Response::from_string("lecture impossible").with_status_code(400));
            return;
        }

        let mut etat = self.etat.lock().unwrap();
        let mut reponse = traiter(
            &mut etat,
            &Requete { methode: &methode, chemin: &chemin, appareil: appareil.as_deref(), corps: &corps },
            maintenant_ms(),
        );

        if let Some(element) = reponse.recu.take() {
            let nom_appareil = etat
                .registre
                .appareils
                .iter()
                .find(|a| Some(&a.id) == appareil.as_ref())
                .map(|a| a.nom.clone())
                .unwrap_or_default();
            if let Err(e) = self.enregistrer(&element, &nom_appareil) {
                // Rien n'est confirmé : le téléphone garde l'élément et réessaiera.
                etat.registre.recus.retain(|id| id != &element.id);
                reponse = Reponse::texte(500, &format!("enregistrement impossible : {e}"));
            } else {
                let _ = self.app.emit("telephone-recu", &element.id);
            }
        }
        if reponse.sauver {
            self.sauver(&etat.registre);
        }
        drop(etat);
        if let Some(id) = &reponse.contact {
            let _ = self.app.emit("telephone-contact", id);
        }

        let entete = tiny_http::Header::from_bytes(&b"Content-Type"[..], reponse.type_contenu.as_bytes()).unwrap();
        let _ = requete.respond(
            tiny_http::Response::from_data(reponse.corps)
                .with_status_code(reponse.statut)
                .with_header(entete),
        );
    }

    /// Fichier reçu → assets du projet ; fiche JSON → `telephone/recus/`, que
    /// l'interface range puis efface. Écrit AVANT de confirmer au téléphone.
    fn enregistrer(&self, element: &ElementEntrant, nom_appareil: &str) -> Result<(), String> {
        let mut fichier = None;
        if let Some(donnees) = &element.donnees {
            let octets = B64.decode(donnees).map_err(|_| "fichier mal encodé".to_string())?;
            let projet = element.projet.as_deref().filter(|p| identifiant_valide(p)).unwrap_or("telephone");
            let ext = element.ext.as_deref().unwrap_or("bin").to_ascii_lowercase();
            fichier = Some(crate::ecrire_asset(&self.app, projet, &ext, &octets)?);
        }
        let fiche = json!({
            "id": element.id,
            "genre": element.genre,
            "projet": element.projet,
            "texte": element.texte,
            "url": element.url,
            "nom": element.nom,
            "fichier": fichier,
            "creeLe": element.cree_le,
            "recuLe": maintenant_ms(),
            "appareil": nom_appareil,
        });
        let dossier = self.dossier.join("recus");
        fs::create_dir_all(&dossier).map_err(|e| e.to_string())?;
        let provisoire = dossier.join(format!("{}.tmp", element.id));
        fs::write(&provisoire, fiche.to_string()).map_err(|e| e.to_string())?;
        fs::rename(&provisoire, dossier.join(format!("{}.json", element.id))).map_err(|e| e.to_string())
    }

    /// Mise à jour de l'app mobile transmise par le PC : l'APK voyage dans les
    /// ressources de l'app bureau.
    fn fichier_mobile(&self, chemin: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
        let (nom, type_contenu) = match chemin {
            "/v1/mobile/version" => ("version.json", "application/json"),
            "/v1/mobile/apk" => ("projekt-mobile.apk", "application/vnd.android.package-archive"),
            _ => return tiny_http::Response::from_data(b"introuvable".to_vec()).with_status_code(404),
        };
        let lu = self
            .app
            .path()
            .resource_dir()
            .ok()
            .and_then(|d| fs::read(d.join("mobile").join(nom)).ok());
        match lu {
            Some(octets) => tiny_http::Response::from_data(octets)
                .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], type_contenu.as_bytes()).unwrap()),
            None => tiny_http::Response::from_data("pas d'app mobile dans cette version".as_bytes().to_vec())
                .with_status_code(404),
        }
    }
}

// ——— Commandes de l'interface ——————————————————————————————————————————————————

type EtatTelephone<'a> = tauri::State<'a, Arc<Telephone>>;

#[tauri::command]
pub fn telephone_etat(telephone: EtatTelephone<'_>) -> Value {
    let port = *telephone.port.lock().unwrap();
    let etat = telephone.etat.lock().unwrap();
    json!({
        "actif": port.is_some(),
        "port": port,
        "adresses": adresses_locales(),
        "nomPc": etat.nom_pc,
        "appairageEnCours": etat.attente.as_ref().is_some_and(|a| a.expire_le > maintenant_ms()),
        "appareils": etat.registre.appareils.iter().map(|a| json!({
            "id": a.id, "nom": a.nom, "ajouteLe": a.ajoute_le, "vuLe": a.vu_le
        })).collect::<Vec<_>>(),
    })
}

/// Prépare un appairage et renvoie le contenu du QR code.
#[tauri::command]
pub fn telephone_appairer(telephone: EtatTelephone<'_>) -> Result<Value, String> {
    let port = telephone.demarrer()?;
    let mut etat = telephone.etat.lock().unwrap();
    let cle = B64URL.encode(aleatoire(32));
    let expire_le = maintenant_ms() + DUREE_APPAIRAGE_MS;
    etat.attente = Some(Attente { cle: cle.clone(), expire_le });
    let lien = format!(
        "projekt://appairer?v=1&pc={}&n={}&k={}&h={}&p={}",
        etat.registre.pc_id,
        encoder_url(&etat.nom_pc),
        cle,
        adresses_locales().join(","),
        port
    );
    Ok(json!({ "lien": lien, "expireLe": expire_le }))
}

#[tauri::command]
pub fn telephone_annuler_appairage(telephone: EtatTelephone<'_>) {
    telephone.etat.lock().unwrap().attente = None;
}

#[tauri::command]
pub fn telephone_oublier(telephone: EtatTelephone<'_>, id: String) {
    let mut etat = telephone.etat.lock().unwrap();
    etat.registre.appareils.retain(|a| a.id != id);
    telephone.sauver(&etat.registre);
}

#[tauri::command]
pub fn telephone_projets(telephone: EtatTelephone<'_>, projets: Vec<ProjetResume>) {
    telephone.etat.lock().unwrap().projets = projets;
}

/// Éléments reçus pas encore rangés dans l'app, du plus ancien au plus récent.
#[tauri::command]
pub fn telephone_recus(telephone: EtatTelephone<'_>) -> Vec<Value> {
    let mut fiches: Vec<Value> = fs::read_dir(telephone.dossier.join("recus"))
        .map(|lecture| {
            lecture
                .flatten()
                .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
                .filter_map(|e| fs::read(e.path()).ok())
                .filter_map(|o| serde_json::from_slice::<Value>(&o).ok())
                .collect()
        })
        .unwrap_or_default();
    fiches.sort_by_key(|f| f.get("creeLe").and_then(|v| v.as_i64()).unwrap_or(0));
    fiches
}

/// L'interface a rangé l'élément : sa fiche peut disparaître.
#[tauri::command]
pub fn telephone_accuser(telephone: EtatTelephone<'_>, id: String) -> Result<(), String> {
    if !identifiant_valide(&id) {
        return Err("identifiant invalide".into());
    }
    let chemin = telephone.dossier.join("recus").join(format!("{id}.json"));
    match fs::remove_file(chemin) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ——— Pare-feu Windows ——————————————————————————————————————————————————————————
//
// Recette du 13/09 : avec Norton comme pare-feu enregistré, Windows ne demande
// RIEN et bloque le téléphone en silence. Le panneau 📱 vérifie donc la présence
// des règles et propose de les créer, avec la confirmation administrateur de Windows.

fn powershell(commande: &str) -> std::io::Result<std::process::Output> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", commande])
        // Pas de fenêtre de console qui clignote.
        .creation_flags(0x0800_0000)
        .output()
}

/// Les deux règles d'entrée (TCP et UDP) existent et sont actives. Lecture sans droits administrateur.
fn regles_pare_feu_presentes() -> bool {
    powershell(
        "@(Get-NetFirewallRule -DisplayName 'Projekt Mobile (TCP)','Projekt Mobile (UDP)' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' }).Count",
    )
    .ok()
    .and_then(|sortie| String::from_utf8_lossy(&sortie.stdout).trim().parse::<u32>().ok())
    .is_some_and(|n| n >= 2)
}

#[tauri::command]
pub async fn telephone_pare_feu_ok() -> bool {
    tauri::async_runtime::spawn_blocking(regles_pare_feu_presentes).await.unwrap_or(false)
}

/// Crée les règles (ports 47821 à 47830, TCP et UDP) après confirmation administrateur.
/// Renvoie `false` si l'utilisateur refuse, ou si un autre logiciel de sécurité l'empêche.
#[tauri::command]
pub async fn telephone_autoriser_pare_feu() -> bool {
    let script = format!(
        "Remove-NetFirewallRule -DisplayName 'Projekt Mobile (TCP)','Projekt Mobile (UDP)' -ErrorAction SilentlyContinue; \
         New-NetFirewallRule -DisplayName 'Projekt Mobile (TCP)' -Direction Inbound -Protocol TCP -LocalPort {debut}-{fin} -Action Allow -Profile Any | Out-Null; \
         New-NetFirewallRule -DisplayName 'Projekt Mobile (UDP)' -Direction Inbound -Protocol UDP -LocalPort {debut}-{fin} -Action Allow -Profile Any | Out-Null",
        debut = PORT,
        fin = PORT + PORTS_ESSAYES - 1
    );
    // Script encodé (UTF-16LE en base64) : aucun souci de guillemets imbriqués.
    let encode = B64.encode(script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect::<Vec<u8>>());
    let lanceur = format!(
        "try {{ Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-EncodedCommand','{encode}' }} catch {{ exit 1 }}"
    );
    tauri::async_runtime::spawn_blocking(move || {
        let _ = powershell(&lanceur);
        regles_pare_feu_presentes()
    })
    .await
    .unwrap_or(false)
}

// ——— Tests ————————————————————————————————————————————————————————————————————

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_757_700_000_000;

    /// Vecteur partagé avec le test Android `ChiffrementTest` (et recalculé à part
    /// avec le module crypto de Node) : les deux côtés doivent produire les mêmes octets.
    const VECTEUR_COMMUN: &str = "ZGVmZ2hpamtsbW5vMzm7CA+GL/tyB33S6xjJZSb5UVacf4iwF8dfDDfm";

    fn etat_vide() -> Etat {
        Etat {
            registre: Registre { pc_id: "abcdef0123456789".into(), ..Registre::default() },
            attente: None,
            projets: vec![ProjetResume { id: "p1".into(), nom: "Minecraft".into() }],
            nom_pc: "PC-TEST".into(),
        }
    }

    fn post<'a>(chemin: &'a str, appareil: &'a str, corps: &'a [u8]) -> Requete<'a> {
        Requete { methode: "POST", chemin, appareil: Some(appareil), corps }
    }

    fn paquet(cle: &[u8], route: &str, appareil: &str, valeur: Value) -> Vec<u8> {
        chiffrer(cle, format!("{route}|{appareil}").as_bytes(), valeur.to_string().as_bytes()).unwrap()
    }

    fn lire(cle: &[u8], route: &str, appareil: &str, r: &Reponse) -> Value {
        let clair = dechiffrer(cle, format!("{route}-reponse|{appareil}").as_bytes(), &r.corps).expect("réponse lisible");
        serde_json::from_slice(&clair).unwrap()
    }

    /// Appaire « tel1 » et renvoie sa clé.
    fn appaire(etat: &mut Etat) -> Vec<u8> {
        let cle = aleatoire(32);
        etat.attente = Some(Attente { cle: B64URL.encode(&cle), expire_le: T0 + 1000 });
        let corps = paquet(&cle, "appairer", "tel1", json!({ "envoyeLe": T0, "nom": "Galaxy S24" }));
        let r = traiter(etat, &post("/v1/appairer", "tel1", &corps), T0);
        assert_eq!(r.statut, 200, "{}", String::from_utf8_lossy(&r.corps));
        cle
    }

    #[test]
    fn chiffrement_aller_retour_et_falsification() {
        let cle = aleatoire(32);
        let p = chiffrer(&cle, b"envoi|tel1", b"bonjour").unwrap();
        assert_eq!(dechiffrer(&cle, b"envoi|tel1", &p).unwrap(), b"bonjour");
        // Autre route, autre appareil, octet modifié, autre clé : tout est refusé.
        assert!(dechiffrer(&cle, b"projets|tel1", &p).is_none());
        assert!(dechiffrer(&cle, b"envoi|tel2", &p).is_none());
        let mut abime = p.clone();
        let dernier = abime.len() - 1;
        abime[dernier] ^= 1;
        assert!(dechiffrer(&cle, b"envoi|tel1", &abime).is_none());
        assert!(dechiffrer(&aleatoire(32), b"envoi|tel1", &p).is_none());
    }

    #[test]
    fn vecteur_commun_avec_android() {
        let cle: Vec<u8> = (0u8..32).collect();
        let nonce: [u8; 12] = core::array::from_fn(|i| 100 + i as u8);
        let p = chiffrer_avec_nonce(&cle, &nonce, b"envoi|tel1", b"{\"envoyeLe\":1}").unwrap();
        assert_eq!(B64.encode(&p), VECTEUR_COMMUN);
    }

    #[test]
    fn appairage_puis_liste_des_projets() {
        let mut etat = etat_vide();
        let cle = appaire(&mut etat);
        assert_eq!(etat.registre.appareils.len(), 1);
        assert_eq!(etat.registre.appareils[0].nom, "Galaxy S24");
        assert!(etat.attente.is_none(), "un QR code ne sert qu'une fois");

        let corps = paquet(&cle, "projets", "tel1", json!({ "envoyeLe": T0 + 5 }));
        let r = traiter(&mut etat, &post("/v1/projets", "tel1", &corps), T0 + 10);
        assert_eq!(r.statut, 200);
        assert_eq!(lire(&cle, "projets", "tel1", &r)["projets"][0]["nom"], "Minecraft");
    }

    #[test]
    fn appairage_refuse_sans_qr_valide() {
        let mut etat = etat_vide();
        let cle = aleatoire(32);
        let corps = paquet(&cle, "appairer", "tel1", json!({ "envoyeLe": T0 }));
        assert_eq!(traiter(&mut etat, &post("/v1/appairer", "tel1", &corps), T0).statut, 410);

        etat.attente = Some(Attente { cle: B64URL.encode(&cle), expire_le: T0 - 1 });
        assert_eq!(traiter(&mut etat, &post("/v1/appairer", "tel1", &corps), T0).statut, 410, "QR périmé");

        etat.attente = Some(Attente { cle: B64URL.encode(aleatoire(32)), expire_le: T0 + 1000 });
        assert_eq!(traiter(&mut etat, &post("/v1/appairer", "tel1", &corps), T0).statut, 403, "autre clé");
        assert!(etat.registre.appareils.is_empty());
    }

    #[test]
    fn inconnu_ou_mauvaise_cle_ou_mauvaise_heure() {
        let mut etat = etat_vide();
        let cle = appaire(&mut etat);
        let element = json!({ "id": "e1", "genre": "texte", "texte": "idée", "creeLe": T0 });

        let corps = paquet(&cle, "envoi", "tel1", json!({ "envoyeLe": T0, "element": element }));
        assert_eq!(traiter(&mut etat, &post("/v1/envoi", "inconnu", &corps), T0).statut, 401);

        let faux = paquet(&aleatoire(32), "envoi", "tel1", json!({ "envoyeLe": T0, "element": element }));
        assert_eq!(traiter(&mut etat, &post("/v1/envoi", "tel1", &faux), T0).statut, 403);

        // Message capturé et rejoué une heure plus tard.
        assert_eq!(traiter(&mut etat, &post("/v1/envoi", "tel1", &corps), T0 + 3_600_000).statut, 400);

        // Rejoué sur une autre route.
        assert_eq!(traiter(&mut etat, &post("/v1/projets", "tel1", &corps), T0).statut, 403);
    }

    #[test]
    fn envoi_accepte_une_seule_fois() {
        let mut etat = etat_vide();
        let cle = appaire(&mut etat);
        let element = json!({ "id": "e1", "genre": "lien", "projet": "p1", "url": "https://vm.tiktok.com/x", "creeLe": T0 });
        let corps = paquet(&cle, "envoi", "tel1", json!({ "envoyeLe": T0, "element": element }));

        let r = traiter(&mut etat, &post("/v1/envoi", "tel1", &corps), T0);
        assert_eq!(r.statut, 200);
        assert_eq!(lire(&cle, "envoi", "tel1", &r)["ok"], true);
        assert!(r.recu.is_some() && r.sauver);

        let encore = traiter(&mut etat, &post("/v1/envoi", "tel1", &corps), T0 + 50);
        assert_eq!(encore.statut, 200, "le renvoi est confirmé…");
        assert!(encore.recu.is_none(), "…mais rien n'est ajouté deux fois");
    }

    #[test]
    fn elements_invalides_refuses() {
        let mut etat = etat_vide();
        let cle = appaire(&mut etat);
        let cas = [
            json!({ "id": "../x", "genre": "texte", "creeLe": T0 }),
            json!({ "id": "e2", "genre": "video", "creeLe": T0 }),
            json!({ "id": "e3", "genre": "image", "creeLe": T0 }),
            json!({ "id": "e4", "genre": "audio", "ext": "../mp3", "donnees": "AA==", "creeLe": T0 }),
        ];
        for element in cas {
            let corps = paquet(&cle, "envoi", "tel1", json!({ "envoyeLe": T0, "element": element }));
            let r = traiter(&mut etat, &post("/v1/envoi", "tel1", &corps), T0);
            assert_eq!(r.statut, 400, "{element}");
            assert!(r.recu.is_none());
        }
    }

    #[test]
    fn la_liste_des_recus_reste_bornee() {
        let mut etat = etat_vide();
        let cle = appaire(&mut etat);
        for n in 0..(IDS_RETENUS + 5) {
            let element = json!({ "id": format!("e{n}"), "genre": "texte", "texte": "x", "creeLe": T0 });
            let corps = paquet(&cle, "envoi", "tel1", json!({ "envoyeLe": T0, "element": element }));
            traiter(&mut etat, &post("/v1/envoi", "tel1", &corps), T0);
        }
        assert_eq!(etat.registre.recus.len(), IDS_RETENUS);
    }

    #[test]
    fn encodage_du_nom_dans_le_qr() {
        assert_eq!(encoder_url("PC de Marlou"), "PC%20de%20Marlou");
        assert_eq!(encoder_url("é"), "%C3%A9");
    }
}
