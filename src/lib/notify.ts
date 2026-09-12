/**
 * Messages ponctuels adressés à l'utilisateur (export réussi, import refusé…).
 *
 * Même règle que le témoin d'enregistrement : **un succès s'efface tout seul,
 * une erreur reste jusqu'à ce qu'on la ferme**. Un avertissement qui disparaît
 * pendant qu'on regarde ailleurs ne protège de rien.
 */

export interface Notice {
  id: number;
  ok: boolean;
  message: string;
}

const DUREE_SUCCES_MS = 6000;

let notices: Notice[] = [];
let suivant = 1;
const auditeurs = new Set<() => void>();

function publier() {
  auditeurs.forEach((notifier) => notifier());
}

export function notify(ok: boolean, message: string): number {
  const id = suivant++;
  notices = [...notices, { id, ok, message }];
  publier();
  if (ok) setTimeout(() => dismissNotice(id), DUREE_SUCCES_MS);
  return id;
}

export function dismissNotice(id: number) {
  const reste = notices.filter((n) => n.id !== id);
  if (reste.length === notices.length) return;
  notices = reste;
  publier();
}

export function getNotices(): Notice[] {
  return notices;
}

export function subscribeNotices(listener: () => void): () => void {
  auditeurs.add(listener);
  return () => {
    auditeurs.delete(listener);
  };
}
