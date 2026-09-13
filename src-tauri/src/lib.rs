use base64::Engine;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

mod telephone;

const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_blocks (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  text_value TEXT,
  table_json TEXT
);

CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_path TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL
);
";

// Passage du texte brut au JSON Tiptap. On ajoute une colonne au lieu de convertir
// text_value en place : l'ancien contenu reste intact, et la conversion se fait à
// l'hydratation (voir textToDoc côté TS). Aucune donnée n'est perdue si on régresse.
const SCHEMA_V2: &str = "
ALTER TABLE content_blocks ADD COLUMN doc_json TEXT;
";

// Tout le contenu d'une page tient désormais dans une seule colonne JSON : une
// modification devient un UPDATE unique, donc atomique par nature — plus besoin
// de transaction pour éviter un DELETE suivi d'INSERT interrompus à mi-chemin.
// content_blocks reste en place et lisible tant qu'une page n'a pas été réécrite.
const SCHEMA_V3: &str = "
ALTER TABLE pages ADD COLUMN content_json TEXT;
";

// Rognage non destructif du moodboard : on garde la zone visible, en fractions
// de l image d origine, et jamais un fichier decoupe. La colonne reste vide pour
// les images existantes, ce qui signifie « image entiere ».
const SCHEMA_V4: &str = "
ALTER TABLE canvas_items ADD COLUMN crop_json TEXT;
";

// Ordre choisi par l utilisateur dans la barre laterale. Les positions sont
// initialisees sur l ordre de creation, qui est celui qu affichait l app apres
// un redemarrage : la migration ne change donc rien a ce qu il voit.
// Pour les pages, la position vaut parmi les soeurs (meme projet, meme parent) ;
// `IS` compare aussi deux parents NULL, contrairement a `=`.
const SCHEMA_V5: &str = "
ALTER TABLE projects ADD COLUMN position INTEGER;
ALTER TABLE pages ADD COLUMN position INTEGER;
UPDATE projects SET position = (
  SELECT COUNT(*) FROM projects AS p2
  WHERE p2.created_at < projects.created_at
     OR (p2.created_at = projects.created_at AND p2.id < projects.id)
);
UPDATE pages SET position = (
  SELECT COUNT(*) FROM pages AS p2
  WHERE p2.project_id = pages.project_id
    AND p2.parent_id IS pages.parent_id
    AND (p2.created_at < pages.created_at
         OR (p2.created_at = pages.created_at AND p2.id < pages.id))
);
";

// Carte mentale (specifiee avec l utilisateur le 11/09).
// graph_nodes : DECALAGE d une bulle par rapport a sa place automatique (et non
// une position absolue) : ses sous-pages la suivent quand on la deplace, et la
// carte reste coherente quand des pages sont ajoutees.
// graph_links : liens traces a la main ('humain', couleur + etiquette) et liens
// de l IA ('ia' gardes, 'ia_rejete' pour ne plus les proposer). Ils ne vivent
// que sur la carte : l utilisateur ne veut pas qu ils modifient ses pages.
const SCHEMA_V6: &str = "
CREATE TABLE IF NOT EXISTS graph_nodes (
  page_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  dx REAL NOT NULL DEFAULT 0,
  dy REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS graph_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_page TEXT NOT NULL,
  to_page TEXT NOT NULL,
  kind TEXT NOT NULL,
  color TEXT,
  label TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS graph_nodes_projet ON graph_nodes(project_id);
CREATE INDEX IF NOT EXISTS graph_links_projet ON graph_links(project_id);
";

// Moodboard : videos et liens TikTok (demande du 11/09, « je cherche beaucoup
// d inspiration sur TikTok »). `kind` : NULL = image (tout ce qui existait),
// 'video' = fichier video, 'tiktok' = lien (l asset est alors sa miniature).
// `meta_json` : ce qui depend du type (adresse, titre, auteur, image d apercu).
const SCHEMA_V7: &str = "
ALTER TABLE canvas_items ADD COLUMN kind TEXT;
ALTER TABLE canvas_items ADD COLUMN meta_json TEXT;
";

/// Écrit un fichier dans les assets du projet, nommé par l'empreinte de son contenu.
fn ecrire_asset(app: &tauri::AppHandle, project_id: &str, ext: &str, bytes: &[u8]) -> Result<String, String> {
    // Le projet et l'extension viennent de l'interface : rien qui puisse sortir du dossier.
    let sur = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !sur(project_id) || !sur(ext) || ext.len() > 8 {
        return Err("nom de projet ou extension invalide".into());
    }
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hash = format!("{:x}", hasher.finalize());

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("boards")
        .join(project_id)
        .join("assets");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let file_path = dir.join(format!("{hash}.{}", ext.to_ascii_lowercase()));
    if !file_path.exists() {
        let mut f = fs::File::create(&file_path).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
    }
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_asset(app: tauri::AppHandle, project_id: String, ext: String, bytes: Vec<u8>) -> Result<String, String> {
    ecrire_asset(&app, &project_id, &ext, &bytes)
}

/// Même chose, mais le fichier arrive EN BINAIRE (corps brut de la requête) et
/// non comme un tableau JSON de nombres : une vidéo de 20 Mo en JSON pèserait
/// plus de 60 Mo et figerait l'app. Projet et extension passent en en-têtes.
#[tauri::command]
fn save_asset_brut(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("contenu attendu en binaire".into());
    };
    let entete = |nom: &str| {
        request
            .headers()
            .get(nom)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .ok_or(format!("en-tête « {nom} » manquant"))
    };
    ecrire_asset(&app, &entete("x-projet")?, &entete("x-ext")?, bytes)
}

/// Lit un asset EN BINAIRE : l'interface en fait un Blob pour la balise `<video>`
/// (un data-URI base64 d'une vidéo coûterait un tiers de plus et beaucoup de mémoire).
#[tauri::command]
fn lire_asset_brut(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Un lien court TikTok (bouton « Partager » de l'app mobile) : vm.tiktok.com/XXXX,
/// vt.tiktok.com/XXXX ou www.tiktok.com/t/XXXX. Rien d'autre n'est accepté.
fn est_lien_court_tiktok(url: &str) -> bool {
    for prefixe in ["https://vm.tiktok.com/", "https://vt.tiktok.com/", "https://www.tiktok.com/t/"] {
        if let Some(reste) = url.strip_prefix(prefixe) {
            let code = reste.trim_end_matches('/');
            return !code.is_empty() && code.len() <= 32 && code.chars().all(|c| c.is_ascii_alphanumeric());
        }
    }
    false
}

/// Retrouve l'adresse complète d'un lien court TikTok, qui seule contient
/// l'identifiant de la vidéo. L'interface ne peut pas suivre la redirection
/// elle-même (TikTok ne l'autorise pas depuis une page web) : on passe par le
/// `curl` fourni avec Windows, sans aucune dépendance à installer.
#[tauri::command]
fn resoudre_lien_tiktok(url: String) -> Result<String, String> {
    if !est_lien_court_tiktok(&url) {
        return Err("ce n'est pas un lien court TikTok".into());
    }
    let (curl, nul) = if cfg!(windows) { (r"C:\Windows\System32\curl.exe", "NUL") } else { ("curl", "/dev/null") };
    let mut commande = std::process::Command::new(curl);
    commande.args(["-s", "-o", nul, "-w", "%{redirect_url}", "--max-time", "8", &url]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        commande.creation_flags(0x0800_0000); // CREATE_NO_WINDOW : pas de console qui clignote
    }
    let sortie = commande.output().map_err(|e| format!("curl indisponible : {e}"))?;
    let cible = String::from_utf8_lossy(&sortie.stdout).trim().to_string();
    if cible.starts_with("https://www.tiktok.com/") {
        Ok(cible)
    } else {
        Err("TikTok n'a pas donné l'adresse de la vidéo (hors ligne ?)".into())
    }
}

/// Type MIME d'un asset d'après son extension. Un son servi comme `image/png`
/// serait refusé par l'élément `<audio>` : le repli par défaut ne vaut que pour
/// les images, seul type qu'on stockait avant l'arrivée des fichiers audio.
fn mime_pour(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "png" => "image/png",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "webm" => "audio/webm",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "image/png",
    }
}

#[tauri::command]
fn read_asset_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let mime = mime_pour(ext);
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
fn delete_asset(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- Sauvegarde d'un projet -------------------------------------------------
//
// Une archive contient le JSON fidèle, les pages en Markdown et les images. Le
// front prépare tout le contenu ; ici on ne fait qu'écrire et relire le zip.

#[derive(serde::Deserialize)]
struct ArchiveFile {
    path: String,
    contents: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveAsset {
    disk_path: String,
    path: String,
}

/// Écrit l'archive. Renvoie le nombre d'images qui n'ont PAS pu être lues :
/// l'export réussit quand même, mais l'appelant doit pouvoir le dire plutôt que
/// de laisser croire à une sauvegarde complète.
#[tauri::command]
fn write_archive(path: String, files: Vec<ArchiveFile>, assets: Vec<ArchiveAsset>) -> Result<usize, String> {
    let fichier = fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(fichier);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for f in &files {
        zip.start_file(&f.path, options).map_err(|e| e.to_string())?;
        zip.write_all(f.contents.as_bytes()).map_err(|e| e.to_string())?;
    }

    let mut manquantes = 0usize;
    for a in &assets {
        match fs::read(&a.disk_path) {
            Ok(octets) => {
                zip.start_file(&a.path, options).map_err(|e| e.to_string())?;
                zip.write_all(&octets).map_err(|e| e.to_string())?;
            }
            Err(_) => manquantes += 1,
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(manquantes)
}

// Sauvegarde automatique de la base, a chaque ouverture de l app (demande du
// 11/09 : jusque-la, les seules copies etaient faites a la main avant les
// migrations, et l utilisateur avait deja perdu du travail une fois).
// Rust prepare la place (dossier date, rotation) ; l interface fait la copie
// avec `VACUUM INTO`, qui produit un fichier COHERENT meme base ouverte. Une
// copie brute des fichiers ne l est pas si une ecriture tombe pendant la copie —
// et apres un simple rechargement de la fenetre, la base est deja ouverte.
const SAUVEGARDES_GARDEES: usize = 7;

/// Chemin du fichier de sauvegarde à écrire, ou `None` au tout premier lancement.
fn preparer_sauvegarde(dossier_app: &std::path::Path, horodatage: &str, garder: usize) -> Result<Option<std::path::PathBuf>, String> {
    if !dossier_app.join("projekt.sqlite").exists() {
        return Ok(None); // tout premier lancement : rien a sauvegarder
    }
    let nom: String = horodatage
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if nom.is_empty() {
        return Err("horodatage de sauvegarde invalide".into());
    }
    // Un sous-dossier a part : la rotation ne touche JAMAIS aux sauvegardes faites a la main.
    let racine = dossier_app.join("sauvegardes").join("auto");
    let destination = racine.join(&nom);
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    let fichier = destination.join("projekt.sqlite");
    // `VACUUM INTO` refuse d ecrire par-dessus un fichier existant (deux lancements dans la meme seconde).
    if fichier.exists() {
        fs::remove_file(&fichier).map_err(|e| e.to_string())?;
    }
    // Les noms sont des dates « AAAA-MM-JJ_HHMMSS » : l ordre alphabetique est l ordre chronologique.
    let mut dossiers: Vec<std::path::PathBuf> = fs::read_dir(&racine)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dossiers.sort();
    if dossiers.len() > garder {
        for ancien in &dossiers[..dossiers.len() - garder] {
            let _ = fs::remove_dir_all(ancien);
        }
    }
    Ok(Some(fichier))
}

/// Appelée par l'interface à l'ouverture de la base (elle seule connaît l'heure locale).
#[tauri::command]
fn preparer_sauvegarde_automatique(app: tauri::AppHandle, horodatage: String) -> Result<Option<String>, String> {
    // Même dossier que le plugin SQL, qui y range projekt.sqlite.
    let dossier = app.path().app_config_dir().map_err(|e| e.to_string())?;
    preparer_sauvegarde(&dossier, &horodatage, SAUVEGARDES_GARDEES).map(|p| p.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn read_archive_entry(path: String, entry: String) -> Result<String, String> {
    let fichier = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(fichier).map_err(|e| e.to_string())?;
    let mut trouve = archive
        .by_name(&entry)
        .map_err(|_| format!("Ce fichier ne contient pas « {entry} » : ce n'est pas une sauvegarde Projekt."))?;
    let mut texte = String::new();
    trouve.read_to_string(&mut texte).map_err(|e| e.to_string())?;
    Ok(texte)
}

/// Sort les images de l'archive dans le dossier du projet d'accueil et renvoie
/// la correspondance « nom dans l'archive » -> « chemin sur le disque ».
#[tauri::command]
fn extract_archive_assets(
    app: tauri::AppHandle,
    path: String,
    project_id: String,
) -> Result<std::collections::HashMap<String, String>, String> {
    let fichier = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(fichier).map_err(|e| e.to_string())?;

    let dossier = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("boards")
        .join(&project_id)
        .join("assets");

    extraire_assets(&mut archive, &dossier)
}

/// Cœur de l'extraction, séparé de la commande pour être testable sans
/// application : c'est ici que se joue la protection contre une archive forgée.
fn extraire_assets(
    archive: &mut zip::ZipArchive<fs::File>,
    dossier: &std::path::Path,
) -> Result<std::collections::HashMap<String, String>, String> {
    fs::create_dir_all(dossier).map_err(|e| e.to_string())?;

    let mut correspondance = std::collections::HashMap::new();

    for i in 0..archive.len() {
        let mut entree = archive.by_index(i).map_err(|e| e.to_string())?;
        let nom = entree.name().to_string();
        if !nom.starts_with("assets/") || entree.is_dir() {
            continue;
        }

        // On ne garde QUE le dernier segment du nom : une archive forgée dont
        // les entrées remontent l'arborescence (« assets/../../… ») écrirait
        // sinon n'importe où sur le disque.
        let base = match std::path::Path::new(&nom).file_name().and_then(|n| n.to_str()) {
            Some(b) if !b.is_empty() => b.to_string(),
            _ => continue,
        };

        let destination = dossier.join(&base);
        let mut octets = Vec::new();
        entree.read_to_end(&mut octets).map_err(|e| e.to_string())?;
        fs::write(&destination, &octets).map_err(|e| e.to_string())?;

        correspondance.insert(nom, destination.to_string_lossy().to_string());
    }

    Ok(correspondance)
}

pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "init_schema",
            sql: SCHEMA_V1,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "rich_text_doc_json",
            sql: SCHEMA_V2,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "page_content_json",
            sql: SCHEMA_V3,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "canvas_item_crop",
            sql: SCHEMA_V4,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "sidebar_order",
            sql: SCHEMA_V5,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "mind_map",
            sql: SCHEMA_V6,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "moodboard_videos",
            sql: SCHEMA_V7,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:projekt.sqlite", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(telephone::Telephone::charger(app.handle())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_asset,
            save_asset_brut,
            lire_asset_brut,
            resoudre_lien_tiktok,
            read_asset_base64,
            delete_asset,
            write_archive,
            read_archive_entry,
            extract_archive_assets,
            preparer_sauvegarde_automatique,
            telephone::telephone_etat,
            telephone::telephone_appairer,
            telephone::telephone_annuler_appairage,
            telephone::telephone_oublier,
            telephone::telephone_projets,
            telephone::telephone_recus,
            telephone::telephone_accuser,
            telephone::telephone_pare_feu_ok,
            telephone::telephone_autoriser_pare_feu
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Projekt");
}

#[cfg(test)]
mod tests {
    use super::{SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7};

    /// La v7 ajoute le type des éléments du moodboard : tout ce qui existait
    /// reste une image (type vide), intact.
    #[test]
    fn migration_v7_les_images_existantes_restent_des_images() {
        let conn = rusqlite::Connection::open_in_memory().expect("connexion en mémoire");
        for schema in [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6] {
            conn.execute_batch(schema).unwrap();
        }
        conn.execute(
            "INSERT INTO canvas_items (id, project_id, asset_path, x, y, width, height, crop_json) VALUES ('i1', 'p', 'C:/ref.png', 1, 2, 300, 200, '{\"x\":0.1}')",
            [],
        )
        .unwrap();
        conn.execute_batch(SCHEMA_V7).expect("la migration v7 doit s'exécuter sans erreur");
        let (chemin, rognage, genre, meta): (String, String, Option<String>, Option<String>) = conn
            .query_row("SELECT asset_path, crop_json, kind, meta_json FROM canvas_items WHERE id = 'i1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        assert_eq!((chemin.as_str(), rognage.as_str()), ("C:/ref.png", "{\"x\":0.1}"), "l'image et son rognage sont intacts");
        assert_eq!((genre, meta), (None, None), "type vide = image");
    }

    #[test]
    fn seuls_les_liens_courts_tiktok_sont_resolus() {
        use super::est_lien_court_tiktok as court;
        assert!(court("https://vm.tiktok.com/ZMhvqB3xY/"));
        assert!(court("https://vt.tiktok.com/ZSabc123"));
        assert!(court("https://www.tiktok.com/t/ZT8abc/"));
        assert!(!court("https://www.tiktok.com/@scout2015/video/6718335390845095173"), "un lien complet n'a pas à être résolu");
        assert!(!court("https://vm.tiktok.com/abc;calc.exe"), "rien d'autre que des lettres et des chiffres");
        assert!(!court("https://vm.tiktok.com.pirate.fr/abc"), "domaine exact exigé");
        assert!(!court("https://vm.tiktok.com/"), "code vide refusé");
    }

    // Vérifie que le schéma est du SQLite valide, exécuté contre un vrai moteur —
    // utile car `cargo check` ne valide pas la syntaxe des chaînes SQL.
    #[test]
    fn schema_is_valid_sqlite() {
        let conn = rusqlite::Connection::open_in_memory().expect("connexion en mémoire");
        conn.execute_batch(SCHEMA_V1).expect("le schéma doit s'exécuter sans erreur");

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(tables, vec!["canvas_items", "content_blocks", "pages", "projects"]);

        // Vérifie qu'on peut réellement insérer et relire une page imbriquée avec du contenu.
        conn.execute(
            "INSERT INTO projects (id, name, created_at) VALUES ('p1', 'Test', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pages (id, project_id, parent_id, title, created_at, updated_at) VALUES ('page1', 'p1', NULL, 'Racine', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pages (id, project_id, parent_id, title, created_at, updated_at) VALUES ('page2', 'p1', 'page1', 'Enfant', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO content_blocks (id, page_id, position, type, text_value, table_json) VALUES ('c1', 'page1', 0, 'text', 'Bonjour [[Enfant]]', NULL)",
            [],
        )
        .unwrap();

        let child_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM pages WHERE parent_id = 'page1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(child_count, 1);
    }

    // La migration v2 doit s'appliquer sur une base v1 déjà peuplée, sans perdre
    // l'ancien text_value — c'est toute la promesse de compatibilité ascendante.
    #[test]
    fn migration_v2_preserves_existing_text() {
        let conn = rusqlite::Connection::open_in_memory().expect("connexion en mémoire");
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute(
            "INSERT INTO content_blocks (id, page_id, position, type, text_value, table_json) VALUES ('c1', 'page1', 0, 'text', 'Ancien texte brut', NULL)",
            [],
        )
        .unwrap();

        conn.execute_batch(SCHEMA_V2).expect("la migration v2 doit s'exécuter sans erreur");

        let (text, doc): (Option<String>, Option<String>) = conn
            .query_row("SELECT text_value, doc_json FROM content_blocks WHERE id = 'c1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(text.as_deref(), Some("Ancien texte brut"));
        assert_eq!(doc, None, "doc_json doit être vide tant que le bloc n'a pas été réécrit");
    }

    // La v3 doit s'appliquer par-dessus v1+v2 sans toucher aux blocs déjà en base :
    // ils restent lisibles jusqu'à la première réécriture de leur page.
    #[test]
    fn migration_v3_preserves_existing_blocks() {
        let conn = rusqlite::Connection::open_in_memory().expect("connexion en mémoire");
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute_batch(SCHEMA_V2).unwrap();
        conn.execute(
            "INSERT INTO pages (id, project_id, parent_id, title, created_at, updated_at) VALUES ('p1', 'proj', NULL, 'Boss', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO content_blocks (id, page_id, position, type, text_value, table_json, doc_json) VALUES ('c1', 'p1', 0, 'text', NULL, NULL, '{\"type\":\"doc\"}')",
            [],
        )
        .unwrap();

        conn.execute_batch(SCHEMA_V3).expect("la migration v3 doit s'exécuter sans erreur");

        let content: Option<String> = conn
            .query_row("SELECT content_json FROM pages WHERE id = 'p1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(content, None, "content_json est vide tant que la page n'a pas été réécrite");

        let doc: Option<String> = conn
            .query_row("SELECT doc_json FROM content_blocks WHERE id = 'c1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(doc.as_deref(), Some("{\"type\":\"doc\"}"), "l'ancien bloc reste intact");
    }

    // Une image déjà posée sur le moodboard doit survivre à la migration, et son
    // rognage rester vide — ce qui signifie « image entière ».
    #[test]
    fn migration_v4_preserves_existing_canvas_items() {
        let conn = rusqlite::Connection::open_in_memory().expect("connexion en mémoire");
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute_batch(SCHEMA_V2).unwrap();
        conn.execute_batch(SCHEMA_V3).unwrap();
        conn.execute(
            "INSERT INTO canvas_items (id, project_id, asset_path, x, y, width, height) VALUES ('i1', 'proj', 'C:/ref.png', 12.0, 34.0, 200.0, 140.0)",
            [],
        )
        .unwrap();

        conn.execute_batch(SCHEMA_V4).expect("la migration v4 doit s'exécuter sans erreur");

        let (chemin, largeur, rognage): (String, f64, Option<String>) = conn
            .query_row(
                "SELECT asset_path, width, crop_json FROM canvas_items WHERE id = 'i1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();

        assert_eq!(chemin, "C:/ref.png", "le chemin de l'asset est conservé");
        assert_eq!(largeur, 200.0, "les dimensions sont conservées");
        assert_eq!(rognage, None, "sans rognage enregistré, l'image reste entière");
    }

    /// La v5 s'applique sur une base qui contient déjà des projets et des pages :
    /// elle ne doit rien perdre, et l'ordre initial doit être EXACTEMENT celui
    /// que l'utilisateur voyait avant (l'ordre de création), groupe par groupe.
    #[test]
    fn migration_v5_initialise_l_ordre_sans_rien_changer() {
        let conn = rusqlite::Connection::open_in_memory().expect("connexion en mémoire");
        for schema in [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4] {
            conn.execute_batch(schema).unwrap();
        }
        conn.execute_batch(
            "
            INSERT INTO projects (id, name, created_at) VALUES ('B', 'Deuxième', 200), ('A', 'Premier', 100), ('C', 'Troisième', 300);
            -- Deux racines et deux sœurs sous r1, insérées dans le désordre ;
            -- s1 et s2 ont la même date : l'identifiant départage.
            INSERT INTO pages (id, project_id, parent_id, title, created_at, updated_at, content_json) VALUES
              ('r2', 'A', NULL, 'Racine 2', 20, 20, '[]'),
              ('s2', 'A', 'r1', 'Soeur 2',  30, 30, '[{\"garde\":1}]'),
              ('r1', 'A', NULL, 'Racine 1', 10, 10, '[]'),
              ('s1', 'A', 'r1', 'Soeur 1',  30, 30, '[]'),
              ('x1', 'B', NULL, 'Autre projet', 5, 5, '[]');
            ",
        )
        .unwrap();

        conn.execute_batch(SCHEMA_V5).expect("la migration v5 doit s'exécuter sans erreur");

        let ordre = |sql: &str| -> Vec<String> {
            let mut stmt = conn.prepare(sql).unwrap();
            stmt.query_map([], |r| r.get::<_, String>(0)).unwrap().map(Result::unwrap).collect()
        };

        assert_eq!(ordre("SELECT id FROM projects ORDER BY position"), ["A", "B", "C"], "projets dans l'ordre de création");
        assert_eq!(
            ordre("SELECT id FROM pages WHERE project_id = 'A' AND parent_id IS NULL ORDER BY position"),
            ["r1", "r2"],
            "racines dans l'ordre de création"
        );
        assert_eq!(
            ordre("SELECT id FROM pages WHERE parent_id = 'r1' ORDER BY position"),
            ["s1", "s2"],
            "à date égale, l'identifiant départage de façon stable"
        );
        let x1: i64 = conn.query_row("SELECT position FROM pages WHERE id = 'x1'", [], |r| r.get(0)).unwrap();
        assert_eq!(x1, 0, "la seule page d'un projet est en position 0, quels que soient les autres projets");

        let contenu: String = conn.query_row("SELECT content_json FROM pages WHERE id = 's2'", [], |r| r.get(0)).unwrap();
        assert_eq!(contenu, "[{\"garde\":1}]", "le contenu des pages n'est pas touché");
        let nulles: i64 = conn
            .query_row("SELECT COUNT(*) FROM pages WHERE position IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(nulles, 0, "aucune page ne reste sans position");
    }

    /// Applique la v5 à une COPIE de la vraie base de l'utilisateur, désignée par
    /// la variable `PROJEKT_DB_ESSAI`. Ignoré par défaut : il ne tourne que sur
    /// demande explicite, et n'ouvre jamais que le fichier qu'on lui donne.
    /// `cargo test --lib -- --ignored migration_v5_sur_copie_reelle`
    #[test]
    #[ignore]
    fn migration_v5_sur_copie_reelle() {
        let chemin = std::env::var("PROJEKT_DB_ESSAI").expect("PROJEKT_DB_ESSAI doit désigner une COPIE de la base");
        let conn = rusqlite::Connection::open(&chemin).expect("ouverture de la copie");
        let compter = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };

        let pages_avant = compter("SELECT COUNT(*) FROM pages");
        let projets_avant = compter("SELECT COUNT(*) FROM projects");
        let contenu_avant = compter("SELECT COALESCE(SUM(LENGTH(content_json)), 0) FROM pages");

        conn.execute_batch(SCHEMA_V5).expect("la v5 doit passer sur la vraie base");

        assert_eq!(compter("SELECT COUNT(*) FROM pages"), pages_avant, "aucune page perdue");
        assert_eq!(compter("SELECT COUNT(*) FROM projects"), projets_avant, "aucun projet perdu");
        assert_eq!(
            compter("SELECT COALESCE(SUM(LENGTH(content_json)), 0) FROM pages"),
            contenu_avant,
            "le contenu des pages est intact à l'octet près"
        );
        assert_eq!(compter("SELECT COUNT(*) FROM pages WHERE position IS NULL"), 0);
        assert_eq!(compter("SELECT COUNT(*) FROM projects WHERE position IS NULL"), 0);
        // Deux sœurs ne partagent jamais une position : l'ordre est total.
        assert_eq!(
            compter(
                "SELECT COUNT(*) FROM (SELECT project_id, parent_id, position FROM pages
                 GROUP BY project_id, parent_id, position HAVING COUNT(*) > 1)"
            ),
            0,
            "positions uniques parmi les sœurs"
        );
        println!("{projets_avant} projets et {pages_avant} pages migrés sans perte");
    }

    /// La v6 n'ajoute que des tables : tout ce qui existait reste identique, et
    /// les nouvelles tables acceptent un décalage de bulle et un lien de carte.
    #[test]
    fn migration_v6_ajoute_la_carte_sans_rien_toucher() {
        let conn = rusqlite::Connection::open_in_memory().expect("connexion en mémoire");
        for schema in [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5] {
            conn.execute_batch(schema).unwrap();
        }
        conn.execute_batch(
            "INSERT INTO projects (id, name, created_at, position) VALUES ('A', 'Projet', 1, 0);
             INSERT INTO pages (id, project_id, parent_id, title, created_at, updated_at, content_json, position)
               VALUES ('p1', 'A', NULL, 'Boss', 1, 1, '[{\"garde\":1}]', 0);",
        )
        .unwrap();

        conn.execute_batch(SCHEMA_V6).expect("la migration v6 doit s'exécuter sans erreur");

        let contenu: String = conn.query_row("SELECT content_json FROM pages WHERE id = 'p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(contenu, "[{\"garde\":1}]", "les pages ne sont pas touchées");

        conn.execute("INSERT INTO graph_nodes (page_id, project_id, dx, dy) VALUES ('p1', 'A', 12.5, -40)", []).unwrap();
        conn.execute(
            "INSERT INTO graph_links (id, project_id, from_page, to_page, kind, color, label, reason, created_at)
             VALUES ('l1', 'A', 'p1', 'p2', 'humain', '#e8a33d', 'allié', NULL, 5)",
            [],
        )
        .unwrap();
        let (dx, dy): (f64, f64) = conn.query_row("SELECT dx, dy FROM graph_nodes WHERE page_id = 'p1'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((dx, dy), (12.5, -40.0));
        let etiquette: String = conn.query_row("SELECT label FROM graph_links WHERE id = 'l1'", [], |r| r.get(0)).unwrap();
        assert_eq!(etiquette, "allié");

        // Rejouer la migration ne casse rien (CREATE … IF NOT EXISTS).
        conn.execute_batch(SCHEMA_V6).expect("la v6 est rejouable");
    }

    /// La v6 sur une COPIE de la vraie base (déjà en v5) : rien de perdu.
    /// `cargo test --lib -- --ignored migration_v6_sur_copie_reelle`
    #[test]
    #[ignore]
    fn migration_v6_sur_copie_reelle() {
        let chemin = std::env::var("PROJEKT_DB_ESSAI").expect("PROJEKT_DB_ESSAI doit désigner une COPIE de la base");
        let conn = rusqlite::Connection::open(&chemin).expect("ouverture de la copie");
        let compter = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        let pages = compter("SELECT COUNT(*) FROM pages");
        let projets = compter("SELECT COUNT(*) FROM projects");
        let images = compter("SELECT COUNT(*) FROM canvas_items");
        let contenu = compter("SELECT COALESCE(SUM(LENGTH(content_json)), 0) FROM pages");

        conn.execute_batch(SCHEMA_V6).expect("la v6 doit passer sur la vraie base");

        assert_eq!(compter("SELECT COUNT(*) FROM pages"), pages);
        assert_eq!(compter("SELECT COUNT(*) FROM projects"), projets);
        assert_eq!(compter("SELECT COUNT(*) FROM canvas_items"), images);
        assert_eq!(compter("SELECT COALESCE(SUM(LENGTH(content_json)), 0) FROM pages"), contenu);
        assert_eq!(compter("SELECT COUNT(*) FROM graph_nodes"), 0);
        println!("{projets} projets, {pages} pages, {images} images : intacts après la v6");
    }

    // --- Sauvegarde d'un projet ------------------------------------------

    use super::{extraire_assets, mime_pour, read_archive_entry, write_archive, ArchiveAsset, ArchiveFile};

    #[test]
    fn types_mime_des_assets() {
        assert_eq!(mime_pour("mp3"), "audio/mpeg");
        assert_eq!(mime_pour("MP3"), "audio/mpeg", "les extensions en majuscules sont courantes");
        assert_eq!(mime_pour("wav"), "audio/wav");
        assert_eq!(mime_pour("ogg"), "audio/ogg");
        assert_eq!(mime_pour("m4a"), "audio/mp4");
        assert_eq!(mime_pour("jpg"), "image/jpeg");
        assert_eq!(mime_pour("png"), "image/png");
        // Rétrocompatibilité : les images d'avant, sans extension reconnue,
        // continuent d'être servies comme PNG.
        assert_eq!(mime_pour("inconnue"), "image/png");
    }
    use std::fs;
    use std::io::Write;

    /// Dossier de travail isolé, nettoyé d'abord pour ne pas hériter d'un essai
    /// précédent qui aurait échoué en cours de route.
    fn dossier_essai(nom: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join("projekt-tests").join(nom);
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).expect("dossier d'essai");
        d
    }

    /// Sauvegarde automatique : seules les 7 plus récentes gardées, les
    /// sauvegardes faites à la main jamais touchées, et `VACUUM INTO` (ce
    /// qu'exécute l'interface) donne une copie complète d'une base OUVERTE.
    #[test]
    fn sauvegarde_automatique_garde_les_sept_dernieres() {
        use super::preparer_sauvegarde;
        let app = dossier_essai("sauvegarde-auto");
        assert_eq!(preparer_sauvegarde(&app, "2026-09-11_100000", 7).unwrap(), None, "sans base, rien à sauvegarder");

        let base = rusqlite::Connection::open(app.join("projekt.sqlite")).unwrap();
        base.execute_batch("PRAGMA journal_mode = WAL; CREATE TABLE pages (titre TEXT); INSERT INTO pages VALUES ('Boss'), ('Kaela');").unwrap();
        let manuelle = app.join("sauvegardes").join("avant-migration-v6");
        fs::create_dir_all(&manuelle).unwrap();
        fs::write(manuelle.join("projekt.sqlite"), "à ne jamais toucher").unwrap();

        let mut derniere = None;
        for jour in 1..=9 {
            let cible = preparer_sauvegarde(&app, &format!("2026-09-{jour:02}_120000"), 7).unwrap().unwrap();
            // La base reste ouverte pendant la copie, comme dans l'app.
            base.execute("VACUUM INTO ?1", [cible.to_string_lossy()]).unwrap();
            derniere = Some(cible);
        }
        let auto = app.join("sauvegardes").join("auto");
        let mut restantes: Vec<String> = fs::read_dir(&auto).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        restantes.sort();
        assert_eq!(restantes.len(), 7, "seules les 7 dernières restent");
        assert_eq!(restantes[0], "2026-09-03_120000", "les plus anciennes sont parties");
        assert!(manuelle.join("projekt.sqlite").exists(), "une sauvegarde manuelle n'est jamais supprimée");

        let copie = rusqlite::Connection::open(derniere.unwrap()).unwrap();
        let n: i64 = copie.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2, "la copie contient tout, journal WAL compris");
        drop(copie); // Windows refuse de remplacer un fichier encore ouvert

        // Même seconde : l'ancienne copie est remplacée, pas une erreur de VACUUM INTO.
        let meme = preparer_sauvegarde(&app, "2026-09-09_120000", 7).unwrap().unwrap();
        base.execute("VACUUM INTO ?1", [meme.to_string_lossy()]).unwrap();

        // Un horodatage qui tenterait de sortir du dossier est neutralisé.
        let d = preparer_sauvegarde(&app, "../../evasion", 7).unwrap().unwrap();
        assert!(d.starts_with(&auto), "la copie reste dans sauvegardes/auto");
    }

    fn fichier(chemin: &str, contenu: &str) -> ArchiveFile {
        ArchiveFile {
            path: chemin.to_string(),
            contents: contenu.to_string(),
        }
    }

    #[test]
    fn archive_ecrite_puis_relue() {
        let d = dossier_essai("aller-retour");
        let image = d.join("source.png");
        fs::write(&image, b"octets-image").unwrap();
        let zip = d.join("projet.zip");

        let manquantes = write_archive(
            zip.to_string_lossy().to_string(),
            vec![
                fichier("projekt.json", "{\"format\":\"projekt-export\"}"),
                fichier("pages/boss.md", "# Boss"),
            ],
            vec![ArchiveAsset {
                disk_path: image.to_string_lossy().to_string(),
                path: "assets/source.png".to_string(),
            }],
        )
        .expect("l'archive doit s'écrire");
        assert_eq!(manquantes, 0, "l'image existe : rien ne manque");

        let json = read_archive_entry(zip.to_string_lossy().to_string(), "projekt.json".into())
            .expect("l'entrée doit se relire");
        assert_eq!(json, "{\"format\":\"projekt-export\"}", "le JSON revient intact");

        let cible = d.join("accueil");
        let mut archive = zip::ZipArchive::new(fs::File::open(&zip).unwrap()).unwrap();
        let carte = extraire_assets(&mut archive, &cible).expect("extraction");

        let sortie = cible.join("source.png");
        assert_eq!(
            carte.get("assets/source.png").map(String::as_str),
            Some(sortie.to_string_lossy().as_ref()),
            "la correspondance pointe sur le fichier extrait"
        );
        assert_eq!(fs::read(&sortie).unwrap(), b"octets-image", "les octets sont identiques");
    }

    #[test]
    fn image_disparue_du_disque_est_signalee() {
        let d = dossier_essai("image-manquante");
        let zip = d.join("projet.zip");

        // L'export doit réussir malgré tout — mais en DISANT que l'archive est
        // incomplète, plutôt que de laisser croire à une sauvegarde entière.
        let manquantes = write_archive(
            zip.to_string_lossy().to_string(),
            vec![fichier("projekt.json", "{}")],
            vec![ArchiveAsset {
                disk_path: d.join("jamais-ecrite.png").to_string_lossy().to_string(),
                path: "assets/jamais-ecrite.png".to_string(),
            }],
        )
        .expect("l'archive s'écrit quand même");

        assert_eq!(manquantes, 1, "l'image absente est comptée");
        assert!(
            read_archive_entry(zip.to_string_lossy().to_string(), "projekt.json".into()).is_ok(),
            "le reste de la sauvegarde est bien là"
        );
    }

    #[test]
    fn entree_qui_remonte_l_arborescence_reste_confinee() {
        let d = dossier_essai("archive-forgee");
        let zip = d.join("forgee.zip");

        // Une archive fabriquée à la main, dont l'entrée tente de sortir du
        // dossier d'accueil. On n'écrit jamais un tel fichier nous-mêmes : c'est
        // le cas d'une sauvegarde reçue de quelqu'un d'autre.
        {
            let mut w = zip::ZipWriter::new(fs::File::create(&zip).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            w.start_file("assets/../../evade.png", o).unwrap();
            w.write_all(b"charge").unwrap();
            w.finish().unwrap();
        }

        let cible = d.join("accueil");
        let mut archive = zip::ZipArchive::new(fs::File::open(&zip).unwrap()).unwrap();
        extraire_assets(&mut archive, &cible).expect("extraction");

        assert!(
            cible.join("evade.png").exists(),
            "le fichier est écrit dans le dossier d'accueil, pas ailleurs"
        );
        assert!(
            !d.join("evade.png").exists(),
            "et surtout pas au-dessus du dossier d'accueil"
        );
    }
}
