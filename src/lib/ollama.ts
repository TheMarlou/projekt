import { tr } from "./i18n";

export interface ToolCall {
  id?: string;
  function: { name: string; arguments: Record<string, unknown> };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  /** Images en base64 (sans préfixe `data:`), pour un modèle de vision. */
  images?: string[];
}

const BASE_URL = "http://localhost:11434";

/* --------------------------------------------------------------------------
 * Choix des modèles
 *
 * Mesuré le 2026-09-11 sur une boucle d'agent complète : llama3.1:8b appelle un
 * outil pour un simple « Bonjour » et invente des chemins de page (origine du
 * bug « {} ») ; qwen3:8b fait un sans-faute avec la même invite. On prend donc
 * le premier modèle installé dans l'ordre de préférence, pour que l'app marche
 * aussi sur une machine où seul l'ancien modèle est présent.
 * ------------------------------------------------------------------------ */

export const MODELES_TEXTE = ["qwen3:8b", "llama3.1:8b"];
/** Modèles capables de voir une image, du plus adapté à une carte de 6 Go au moins. */
export const MODELES_VISION = ["gemma3:4b", "qwen2.5vl:7b", "llava:7b"];

let installes: string[] | null = null;

export async function listerModeles(forcer = false): Promise<string[]> {
  if (installes && !forcer) return installes;
  const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Ollama a répondu ${res.status}`);
  const json = (await res.json()) as { models?: { name: string }[] };
  installes = (json.models ?? []).map((m) => m.name);
  return installes;
}

function premierInstalle(preferes: string[], liste: string[]): string | null {
  return preferes.find((m) => liste.includes(m)) ?? null;
}

/** Modèle de texte et d'outils. Repli sur le premier modèle installé qui n'est pas un modèle de vision. */
export async function modeleTexte(): Promise<string> {
  const liste = await listerModeles().catch(() => [] as string[]);
  return (
    premierInstalle(MODELES_TEXTE, liste) ??
    liste.find((m) => !MODELES_VISION.includes(m)) ??
    MODELES_TEXTE[MODELES_TEXTE.length - 1]
  );
}

/** Modèle de vision, ou `null` si aucun n'est installé — l'appelant le dit alors clairement. */
export async function modeleVision(): Promise<string | null> {
  const liste = await listerModeles().catch(() => [] as string[]);
  return premierInstalle(MODELES_VISION, liste);
}

/**
 * Paramètres propres à un modèle. qwen3 « réfléchit » à voix haute par défaut,
 * ce qui multiplie le temps de réponse ; on coupe. On ne l'envoie qu'à lui :
 * d'autres modèles pourraient refuser un paramètre qu'ils ne connaissent pas.
 */
function propresAuModele(model: string, reflechir = false): Record<string, unknown> {
  return model.startsWith("qwen3") ? { think: reflechir } : {};
}

/**
 * Mémoire de travail du modèle (en jetons). Au-delà de 4 096 — la valeur par
 * défaut d'Ollama —, Ollama COUPE LE DÉBUT de la conversation sans prévenir :
 * c'est l'invite système, donc les règles, qui disparaît en premier, et le
 * modèle répond alors n'importe comment. On estime la taille (≈ 3 caractères par
 * jeton en français, JSON des outils compris) et on n'agrandit que si besoin :
 * changer cette taille recharge le modèle (10 à 20 s) et prend de la mémoire.
 */
const CONTEXTE_DEFAUT = 4096;
const CONTEXTE_LARGE = 8192;
// Marge pour la réponse elle-même.
const RESERVE_REPONSE = 700;

function optionsContexte(messages: ChatMessage[], tools?: unknown[]): Record<string, number> {
  const caracteres = messages.reduce((n, m) => n + m.content.length + JSON.stringify(m.tool_calls ?? "").length, 0);
  const jetons = (caracteres + (tools ? JSON.stringify(tools).length : 0)) / 3;
  return jetons + RESERVE_REPONSE > CONTEXTE_DEFAUT ? { num_ctx: CONTEXTE_LARGE } : {};
}

/** Retire un éventuel bloc de réflexion, si le modèle l'a produit malgré tout. */
export function sansReflexion(texte: string): string {
  return texte.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** Modèles conseillés, dans l'ordre où l'aide intégrée propose de les télécharger. */
export const MODELES_CONSEILLES = [
  { nom: "qwen3:8b", taille: "5,2 Go", role: () => tr("discuter, lire et écrire tes pages", "chat, read and write your pages") },
  { nom: "gemma3:4b", taille: "3,3 Go", role: () => tr("analyser les images du moodboard", "analyse moodboard images") },
];

/** Aucun modèle capable de discuter n'est installé : l'assistant ne peut rien faire. */
export function manqueModeleTexte(liste: string[]): boolean {
  return !liste.some((m) => !MODELES_VISION.includes(m));
}

export interface ProgresTelechargement {
  statut: string;
  /** Octets reçus et attendus pour la partie en cours (0 tant qu'Ollama ne les connaît pas). */
  fait: number;
  total: number;
}

/**
 * Télécharge un modèle par Ollama (/api/pull), en suivant sa progression. Un
 * téléchargement interrompu reprend là où il s'était arrêté à l'essai suivant :
 * Ollama garde les morceaux déjà reçus.
 */
export async function telechargerModele(
  nom: string,
  surProgres: (p: ProgresTelechargement) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: nom, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Ollama a répondu ${res.status}`);
  const lecteur = res.body.getReader();
  const decodeur = new TextDecoder();
  let reste = "";
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    reste += decodeur.decode(value, { stream: true });
    const lignes = reste.split("\n");
    reste = lignes.pop() ?? "";
    for (const ligne of lignes) {
      if (!ligne.trim()) continue;
      const j = JSON.parse(ligne) as { status?: string; completed?: number; total?: number; error?: string };
      if (j.error) throw new Error(j.error);
      surProgres({ statut: j.status ?? "", fait: j.completed ?? 0, total: j.total ?? 0 });
    }
  }
  installes = null;
}

export interface OllamaCheckResult {
  ok: boolean;
  error?: string;
}

export async function checkOllamaAvailable(): Promise<OllamaCheckResult> {
  try {
    await listerModeles(true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

/**
 * Charge le modèle en mémoire sans rien lui demander (requête sans message).
 * Appelé à l'ouverture du panneau ou de la bulle : le chargement — 10 à 20 s sur
 * sa carte de 6 Go — se fait pendant qu'il tape, pas après qu'il a envoyé.
 * Ollama le décharge de lui-même après 5 min d'inactivité : on ne le retient pas
 * plus longtemps, la carte graphique sert aussi à ses jeux.
 */
export function prechauffer(model: string): void {
  fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [] }),
  }).catch(() => {
    /* Ollama absent : le panneau le signale déjà par ailleurs */
  });
}

async function poster(corps: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama a répondu ${res.status}${detail ? ` : ${detail.slice(0, 200)}` : ""}`);
  }
  return res;
}

// Streame la réponse d'Ollama token par token (endpoint /api/chat, format NDJSON).
export async function* streamChat(
  messages: ChatMessage[],
  model?: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const m = model ?? (await modeleTexte());
  const res = await poster(
    { model: m, messages, stream: true, options: optionsContexte(messages), ...propresAuModele(m) },
    signal
  );
  if (!res.body) throw new Error("Réponse d'Ollama vide");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Un bloc <think> peut arriver en flux : on le filtre au fil de l'eau.
  let dansReflexion = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const json = JSON.parse(line);
      let morceau: string = json.message?.content ?? "";
      if (morceau) {
        if (morceau.includes("<think>")) dansReflexion = true;
        if (dansReflexion) {
          const fin = morceau.indexOf("</think>");
          if (fin < 0) morceau = "";
          else {
            morceau = morceau.slice(fin + "</think>".length);
            dansReflexion = false;
          }
        }
        if (morceau) yield morceau;
      }
      if (json.done) return;
    }
  }
}

export interface ToolChatResult {
  content: string;
  toolCalls?: ToolCall[];
  /** Vrai si l'appel d'outil a été récupéré dans le texte (le modèle l'avait récité). */
  recupere?: boolean;
}

/**
 * Un petit modèle sort parfois du mode « appel d'outil » et écrit son appel dans
 * le texte : `{"name": "read_tree", "parameters": {}}`. C'était le symptôme du
 * bug « {} ». On le reconnaît et on l'exécute pour de vrai plutôt que de
 * l'afficher à l'utilisateur.
 */
export function appelRecite(contenu: string, outilsConnus: string[]): ToolCall | null {
  const texte = contenu.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (!texte.startsWith("{") || !texte.endsWith("}")) return null;
  try {
    const obj = JSON.parse(texte) as { name?: unknown; parameters?: unknown; arguments?: unknown };
    if (typeof obj.name !== "string" || !outilsConnus.includes(obj.name)) return null;
    const args = (obj.parameters ?? obj.arguments ?? {}) as Record<string, unknown>;
    return { function: { name: obj.name, arguments: typeof args === "object" && args ? args : {} } };
  } catch {
    return null;
  }
}

// Appel avec function-calling : le modèle peut demander l'exécution d'outils
// plutôt que de répondre directement. Toujours non streamé (les tool_calls
// n'arrivent qu'une fois la réponse complète).
export async function chatWithTools(
  messages: ChatMessage[],
  tools: { function: { name: string } }[],
  model?: string,
  signal?: AbortSignal,
  /**
   * Réflexion de qwen3 avant de répondre (demande du 13/09, « équilibre ») : pour
   * les questions sur le contenu du projet seulement. La réflexion arrive à part
   * (champ `thinking`) et n'est jamais montrée ni renvoyée au modèle.
   */
  reflechir = false
): Promise<ToolChatResult> {
  const m = model ?? (await modeleTexte());
  const res = await poster(
    {
      model: m,
      messages,
      tools,
      stream: false,
      // Température recommandée par Qwen en mode réflexion : trop basse, il boucle.
      options: { temperature: reflechir ? 0.6 : 0.4, ...optionsContexte(messages, tools) },
      ...propresAuModele(m, reflechir),
    },
    signal
  );
  const json = await res.json();
  const content = sansReflexion(json.message?.content ?? "");
  const toolCalls: ToolCall[] | undefined = json.message?.tool_calls;
  if (toolCalls?.length) return { content, toolCalls };

  const recite = appelRecite(
    content,
    tools.map((t) => t.function.name)
  );
  if (recite) return { content: "", toolCalls: [recite], recupere: true };
  return { content };
}

/**
 * Réponse en JSON imposée par un schéma (sorties structurées d'Ollama) : le
 * modèle ne peut pas répondre en prose, et le JSON est garanti bien formé.
 */
export async function chatJson(messages: ChatMessage[], schema: object, signal?: AbortSignal): Promise<unknown> {
  const m = await modeleTexte();
  const res = await poster(
    {
      model: m,
      messages,
      stream: false,
      format: schema,
      options: { temperature: 0.3, ...optionsContexte(messages) },
      ...propresAuModele(m),
    },
    signal
  );
  const json = await res.json();
  return JSON.parse(sansReflexion(json.message?.content ?? "") || "{}");
}

/** Analyse d'images par un modèle de vision. Les images sont des data-URI ou du base64 brut. */
export async function voir(
  consigne: string,
  images: string[],
  model: string,
  signal?: AbortSignal
): Promise<AsyncGenerator<string>> {
  const brutes = images.map((i) => i.replace(/^data:[^;]+;base64,/, ""));
  return streamChat([{ role: "user", content: consigne, images: brutes }], model, signal);
}
