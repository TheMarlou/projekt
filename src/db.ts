import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let dbPromise: Promise<Database> | null = null;

/** « 2026-09-11_143205 », à l'heure locale : le nom du dossier de sauvegarde. */
function horodatage(): string {
  const d = new Date();
  const n = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())}_${n(d.getHours())}${n(d.getMinutes())}${n(d.getSeconds())}`;
}

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load("sqlite:projekt.sqlite");
      // Sauvegarde automatique à chaque ouverture (7 dernières gardées, dans
      // sauvegardes/auto). `VACUUM INTO` écrit une copie cohérente même base
      // ouverte. Un échec ne doit jamais empêcher l'app de démarrer.
      try {
        const cible = await invoke<string | null>("preparer_sauvegarde_automatique", { horodatage: horodatage() });
        if (cible) await db.execute("VACUUM INTO $1", [cible]);
      } catch (err) {
        console.error("Sauvegarde automatique impossible :", err);
      }
      return db;
    })();
  }
  return dbPromise;
}

/* --------------------------------------------------------------------------
 * État d'enregistrement
 *
 * Toutes les écritures passent par `fireWrite`, et toutes les frappes clavier
 * par `debouncedPersist` : ces deux fonctions suffisent donc à connaître l'état
 * réel du disque, sans avoir à instrumenter les stores un par un.
 *
 * L'échec était déjà attrapé et étiqueté ici, mais n'allait que dans la console
 * — c'est ainsi qu'une panne de permissions a pu faire perdre du travail sans
 * le moindre signe à l'écran.
 * ------------------------------------------------------------------------ */

export type SaveState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saved"; at: number }
  | { kind: "failed"; label: string; message: string; at: number };

let enAttente = 0; // modifications retardées par l'anti-rebond : rien n'est encore parti
let enVol = 0; // écritures parties, réponse non revenue
let echec: { label: string; message: string; at: number } | null = null;
let dernierSucces = 0;

let etat: SaveState = { kind: "idle" };
const auditeurs = new Set<() => void>();

function calculer(): SaveState {
  // Un échec reste affiché jusqu'à la prochaine écriture réussie : un
  // avertissement qui s'efface tout seul ne protège de rien.
  if (echec) return { kind: "failed", ...echec };
  if (enAttente + enVol > 0) return { kind: "pending" };
  if (dernierSucces) return { kind: "saved", at: dernierSucces };
  return { kind: "idle" };
}

function publier() {
  const suivant = calculer();
  // `useSyncExternalStore` compare les instantanés par identité : ne remplacer
  // l'objet que si son contenu change, sinon React re-rend à chaque frappe.
  const inchange =
    suivant.kind === etat.kind &&
    (suivant as { at?: number }).at === (etat as { at?: number }).at &&
    (suivant as { message?: string }).message === (etat as { message?: string }).message;
  if (inchange) return;
  etat = suivant;
  auditeurs.forEach((notifier) => notifier());
}

export function getSaveState(): SaveState {
  return etat;
}

export function subscribeSaveState(listener: () => void): () => void {
  auditeurs.add(listener);
  return () => {
    auditeurs.delete(listener);
  };
}

/**
 * Écriture en tâche de fond : l'interface n'attend pas la base. Le .catch est
 * indispensable — sans lui, un échec d'écriture part en rejet non capturé et
 * l'utilisateur perd des données sans le moindre message.
 */
export function fireWrite(label: string, run: (db: Awaited<ReturnType<typeof getDb>>) => Promise<unknown>) {
  enVol++;
  publier();
  getDb()
    .then(run)
    .then(() => {
      echec = null;
      dernierSucces = Date.now();
    })
    .catch((err) => {
      echec = { label, message: err instanceof Error ? err.message : String(err), at: Date.now() };
      console.error(`Échec d'écriture SQLite — ${label} :`, err);
    })
    .finally(() => {
      enVol--;
      publier();
    });
}

// Persiste avec un léger retard pour éviter une écriture disque à chaque frappe clavier.
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function debouncedPersist(key: string, fn: () => void, delayMs = 400) {
  const existing = debounceTimers.get(key);
  // Une clé déjà en attente ne compte qu'une fois : la reprogrammer ne crée pas
  // une deuxième modification en souffrance, elle repousse la même.
  if (existing) clearTimeout(existing);
  else enAttente++;

  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      enAttente--;
      fn(); // appelle fireWrite, qui reprend la main sur l'état
      publier();
    }, delayMs)
  );
  publier();
}
