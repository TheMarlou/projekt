// Certaines commandes ont besoin d'une saisie que l'éditeur ne peut pas fournir
// (une URL, un fichier), ou d'une action qui n'est pas de son ressort (naviguer,
// créer une page). Le raccourci clavier et le menu « / » se contentent donc de
// réclamer l'action, et la vue qui en a la charge l'exécute.
export const LINK_REQUEST_EVENT = "projekt:request-link";
export const IMAGE_REQUEST_EVENT = "projekt:request-image";
export const AUDIO_REQUEST_EVENT = "projekt:request-audio";
export const SUBPAGE_REQUEST_EVENT = "projekt:request-subpage";
export const MENTION_REQUEST_EVENT = "projekt:request-mention";
export const OPEN_PAGE_EVENT = "projekt:open-page";
export const DELETE_PAGE_EVENT = "projekt:delete-page";

export function requestLink() {
  window.dispatchEvent(new CustomEvent(LINK_REQUEST_EVENT));
}

export function requestImage() {
  window.dispatchEvent(new CustomEvent(IMAGE_REQUEST_EVENT));
}

export function requestAudio() {
  window.dispatchEvent(new CustomEvent(AUDIO_REQUEST_EVENT));
}

/** Ouvre l'IA au curseur ; avec un libellé d'action, elle part tout de suite. */
export const AI_INLINE_EVENT = "projekt:ai-inline";

// La bulle de mise en forme doit s'effacer tant que la fenêtre d'IA est ouverte.
let iaInlineOuverte = false;
export const estIaInlineOuverte = () => iaInlineOuverte;
export function signalerIaOuverte(ouverte: boolean) {
  iaInlineOuverte = ouverte;
}

export function requestInlineAi(action?: string) {
  window.dispatchEvent(new CustomEvent(AI_INLINE_EVENT, { detail: action }));
}

/** Demande la création d'une sous-page et l'insertion de sa référence ici. */
export function requestSubPage() {
  window.dispatchEvent(new CustomEvent(SUBPAGE_REQUEST_EVENT));
}

/** Demande l’ouverture du sélecteur pour citer une page existante. */
export function requestMention() {
  window.dispatchEvent(new CustomEvent(MENTION_REQUEST_EVENT));
}

export function requestOpenPage(pageId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_PAGE_EVENT, { detail: pageId }));
}

/** Ne supprime rien : réclame la confirmation, seule habilitée à décider. */
export function requestDeletePage(pageId: string) {
  window.dispatchEvent(new CustomEvent(DELETE_PAGE_EVENT, { detail: pageId }));
}
