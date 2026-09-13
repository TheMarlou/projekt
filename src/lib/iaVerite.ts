/**
 * Garde-fous de VÉRACITÉ de l'assistant (demande du 13/09 : « optimise un max
 * l'IA sur la véracité de ses réponses »). Fonctions pures : le code de l'app ET
 * le banc d'essai (scratchpad/banc-verite.mjs) les utilisent telles quelles.
 *
 * Principe, comme le 11/09 : un petit modèle suit mal une consigne, mais le code
 * peut VÉRIFIER sa réponse et le relancer une fois avec la raison précise.
 */

/**
 * Question sur le CONTENU du projet — là où la réflexion (plus lente) paie. Pas
 * pour une demande d'idées, d'écriture ou un simple bonjour : il n'y a rien à
 * vérifier dans les pages, et la réflexion doublerait l'attente pour rien.
 */
export function questionSurLeProjet(demande: string): boolean {
  const d = demande.trim();
  if (d.length < 6 || demandeSurCapacites(d)) return false;
  if (/(id[ée]es?\b|invente|imagine|propose|sugg[èe]re|trouve[- ]moi|cr[ée]e|[ée]cri[st]|ajoute|r[ée]dige|fais une note|retiens)/i.test(d)) return false;
  return /\?\s*$/.test(d) || /^(qui|que|qu'|quoi|quel|quelle|quels|quelles|comment|combien|pourquoi|o[uù]|est-ce|y a-t-il|r[ée]sume|explique|liste|dis-moi)\b/i.test(d);
}

/**
 * « Qu'est-ce que tu peux faire ? », « tes permissions ? ». Banc du 13/09 : sans
 * aide, le modèle y répondait en listant les PAGES du projet (2 fois sur 2).
 * « Est-ce que tu peux créer une page ? » n'en est pas une : c'est une demande.
 */
export function demandeSurCapacites(demande: string): boolean {
  return /(qu'est-ce que tu (peux|sais)|que (peux|sais)-tu|(tu (peux|sais)|peux-tu|sais-tu|es-tu capable de) (faire|m'aider)\b|quoi (tu (peux|sers)|sers-tu)|tes (capacit[ée]s|fonctions|droits|permissions|limites)|what can you do|your (capabilities|permissions))/i.test(demande);
}

/** Ajouté à la demande quand elle porte sur les capacités. */
export const INDICE_CAPACITES =
  "(Reprends un par un les points de la liste « Ce que tu peux faire / Ce que tu ne peux pas faire » de tes consignes, fidèlement et sans rien ajouter, à la première personne (« Je peux… », « Je ne peux pas… »). N'utilise aucun outil et ne liste pas les pages.)";

/** Demande d'écrire dans les pages : créer, ajouter, modifier, noter, retenir. */
export function demandeDeModification(demande: string): boolean {
  return /\b(cr[ée]e[rsz]?|ajoute[rsz]?|[ée]cri[srtv]|modifie[rsz]?|r[ée]dige[rsz]?|compl[èe]te[rsz]?|renomme[rsz]?|d[ée]place[rsz]?|note[rsz]?|retiens|m[ée]morise)\b/i.test(demande);
}

/** Ajouté à une demande de modification quand le réglage l'interdit. */
export const INDICE_SANS_MODIFICATION =
  "(Dans les réglages, tu n'as PAS le droit de créer ni de modifier des pages : ne propose rien. Dis-le simplement, et indique que ça se réactive avec le bouton ⚙ du panneau.)";

/** « Je propose de créer… » alors qu'aucun outil d'écriture n'est permis. */
const PRETEND_MODIFIER = /\bje (te )?(propose|vais|peux|m'occupe)[^.!?\n]{0,25}(cr[ée]er|ajouter|[ée]crire|modifier|r[ée]diger|compl[ée]ter)/i;

const CHEMIN_CITE = /«\s*([^«»]*>[^«»]*)\s*»/g;

/** Phrase où un chemin est cité comme page À CRÉER, pas comme page existante. */
const PAGE_A_CREER = /(n'existe pas|pas encore|cr[ée]er|cr[ée]ation|nouvelle page|propos|ajouter une page)/i;

/** Chemins de page (« Projet > Page ») cités dans une réponse. */
export function cheminsCites(texte: string): string[] {
  return [...texte.matchAll(CHEMIN_CITE)].map((m) => m[1].trim());
}

/** « Ce n'est pas mentionné dans les pages », « aucune information »… */
export function affirmeUneAbsence(texte: string): boolean {
  return /(n'est pas (mentionn|pr[ée]cis|indiqu|d[ée]fini|renseign)|ne (figure|contient|mentionne|pr[ée]cise|donne) pas|aucune (information|mention|donn[ée]e|page)|pas d'information|je ne trouve pas|introuvable dans)/i.test(texte);
}

export interface ContexteVerification {
  /** Le chemin cité désigne-t-il une page réelle (ou une page que le plan crée) ? */
  cheminExiste: (chemin: string) => boolean;
  /** L'assistant a-t-il lu ou cherché pendant ce tour (read_page, search_pages) ? */
  aLu: boolean;
  /** Le code avait-il déjà joint des extraits d'autres pages à la demande ? */
  extraitsFournis: boolean;
  /** La page ouverte a-t-elle été coupée dans l'invite ? */
  pageTronquee?: boolean;
  /** Chemin de la page ouverte, pour la relance. */
  pageOuverte?: string | null;
  /** Réglage « proposer des modifications » (absent = permis). */
  peutModifier?: boolean;
}

/**
 * Le contenu de la page ouverte pour l'invite. Banc du 13/09 : quand la page
 * dépassait le plafond, l'IA voyait « page tronquée » et répondait qu'elle ne
 * savait pas (2 fois sur 2), sans jamais lire la suite. On garde donc le début de
 * la page ET, dans la partie coupée, les passages qui contiennent les mots de la
 * question.
 */
export function contenuPourQuestion(markdown: string, question: string, max = 2500): { texte: string; tronque: boolean } {
  if (markdown.length <= max) return { texte: markdown, tronque: false };
  const debut = markdown.slice(0, Math.round(max * 0.6));
  const reste = markdown.slice(debut.length);
  const plier = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const mots = plier(question)
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length > 3);
  const resteMin = plier(reste);
  // Découpe en paragraphes (titres compris) : on garde ceux qui parlent de la question.
  const paragraphes = reste.split(/\n(?=#|\n)/);
  let position = 0;
  const choisis: string[] = [];
  let taille = 0;
  const budget = max - debut.length;
  for (const p of paragraphes) {
    const zone = resteMin.slice(position, position + p.length);
    position += p.length + 1;
    if (mots.some((m) => zone.includes(m)) && taille + p.length <= budget) {
      choisis.push(p.trim());
      taille += p.length;
    }
  }
  const milieu = choisis.length ? `\n[… passage coupé …]\n${choisis.join("\n[…]\n")}` : "";
  return { texte: `${debut}${milieu}\n[… page tronquée : lis la suite avec read_page]`, tronque: true };
}

/**
 * Relit la réponse. Renvoie le message de relance à envoyer au modèle, ou `null`
 * si rien ne cloche. Une seule relance par tour : c'est l'appelant qui la compte.
 */
export function verifierReponse(texte: string, ctx: ContexteVerification): string | null {
  if (ctx.peutModifier === false && PRETEND_MODIFIER.test(texte) && !/ne (peux|pourrai|vais) pas|pas (le droit|autoris)/i.test(texte)) {
    return "Tu n'as pas le droit de créer ni de modifier des pages (réglage désactivé) : tu ne peux rien proposer. Réponds à nouveau en le disant simplement, et indique que ça se réactive avec le bouton ⚙ du panneau.";
  }
  const phrases = texte.split(/(?<=[.!?\n])\s+/);
  const inventes = cheminsCites(texte).filter(
    (c) => !ctx.cheminExiste(c) && !phrases.some((p) => p.includes(c) && PAGE_A_CREER.test(p))
  );
  if (inventes.length) {
    return `Ces pages n'existent pas : ${inventes.map((c) => `« ${c} »`).join(", ")}. Ne cite que des pages réelles (utilise read_tree ou search_pages si besoin), puis réponds à nouveau.`;
  }
  if (ctx.pageTronquee && !ctx.aLu && /(tronqu|coup[ée]e?\b|incompl[èe]t|pas (le|tout le) contenu|suite de la page)/i.test(texte)) {
    return `Lis la page complète avec read_page${ctx.pageOuverte ? ` (« ${ctx.pageOuverte} »)` : ""}, puis réponds à nouveau à partir de ce qu'elle contient.`;
  }
  if (affirmeUneAbsence(texte) && !ctx.aLu) {
    return "Tu affirmes que l'information n'est pas dans le projet sans avoir cherché. Cherche d'abord avec search_pages (essaie aussi des synonymes), lis la page trouvée avec read_page, puis réponds à nouveau.";
  }
  return null;
}

/** « Fais une note de notre discussion », « résume notre échange dans une page »… */
export function demandeUneNoteDeDiscussion(demande: string): boolean {
  return /(note|page|r[ée]sum|compte[- ]rendu|synth[èe]se)[^.?!]{0,40}(discussion|conversation|[ée]change|ce qu'on (a|s'est) dit|nos id[ée]es)|(discussion|conversation|[ée]change)[^.?!]{0,30}(en|dans une) (note|page)/i.test(demande);
}

/** « Retiens que… », « souviens-toi que… », « ajoute à la mémoire… ». */
export function demandeDeMemoriser(demande: string): boolean {
  return /(retiens|souviens-toi|n'oublie pas|m[ée]morise|garde en (t[êe]te|m[ée]moire)|(ajoute|note)[^.?!]{0,20}m[ée]moire)/i.test(demande);
}

export interface EchangeTranscrit {
  qui: "utilisateur" | "assistant";
  texte: string;
}

/**
 * La discussion en texte, pour la note ou la mémoire. Les plus anciens échanges
 * sont coupés en premier si c'est trop long : la carte graphique de 6 Go ne
 * supporte pas un contexte illimité.
 */
export function transcrire(echanges: EchangeTranscrit[], max = 6000): string {
  const lignes = echanges
    .filter((e) => e.texte.trim())
    .map((e) => `${e.qui === "utilisateur" ? "Utilisateur" : "Assistant"} : ${e.texte.trim()}`);
  let taille = 0;
  const gardees: string[] = [];
  for (let i = lignes.length - 1; i >= 0; i--) {
    if (taille + lignes[i].length > max && gardees.length) break;
    gardees.unshift(lignes[i].slice(0, max));
    taille += lignes[i].length;
  }
  if (gardees.length < lignes.length) gardees.unshift("[… début de la discussion omis]");
  return gardees.join("\n\n");
}
