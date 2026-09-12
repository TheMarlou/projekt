/**
 * Réordonnancement d'une liste, commun aux projets et aux pages de la barre
 * latérale. Fonctions pures : aucune écriture, testables telles quelles.
 */

/**
 * Déplace l'élément `id` pour qu'il occupe l'index `vers`, compté dans la liste
 * SANS l'élément déplacé — c'est ce que mesure le glisser-déposer, qui calcule la
 * place parmi les autres lignes. Renvoie `null` si l'ordre ne change pas, pour
 * qu'aucune écriture ne parte pour rien.
 */
export function deplacer<T extends { id: string }>(liste: T[], id: string, vers: number): T[] | null {
  const depart = liste.findIndex((e) => e.id === id);
  if (depart < 0) return null;

  const sans = liste.filter((e) => e.id !== id);
  const cible = Math.max(0, Math.min(vers, sans.length));
  if (cible === depart) return null;

  return [...sans.slice(0, cible), liste[depart], ...sans.slice(cible)];
}

/**
 * Positions 0..n-1 dans l'ordre de la liste, et la liste des seuls éléments dont
 * la position change : ce sont les seules lignes à réécrire en base.
 */
export function renumeroter<T extends { id: string; position: number }>(
  liste: T[]
): { liste: T[]; changes: { id: string; position: number }[] } {
  const changes: { id: string; position: number }[] = [];
  const renumerotee = liste.map((e, i) => {
    if (e.position === i) return e;
    changes.push({ id: e.id, position: i });
    return { ...e, position: i };
  });
  return { liste: renumerotee, changes };
}

/** Comparateur pour `sort` : l'ordre choisi par l'utilisateur. */
export function parPosition(a: { position: number }, b: { position: number }): number {
  return a.position - b.position;
}

/** Position suivante dans un groupe : on ajoute toujours en fin de liste. */
export function positionSuivante(positions: number[]): number {
  const valides = positions.filter((p) => p !== SANS_POSITION);
  return valides.length ? Math.max(...valides) + 1 : 0;
}

/** Marque une ligne lue en base sans position (créée avant la migration v5). */
export const SANS_POSITION = -1;

/**
 * Donne une position aux éléments qui n'en ont pas, à la suite des autres de
 * leur groupe et dans l'ordre de la liste reçue. Les éléments déjà positionnés
 * ne bougent pas : on ne réécrit que ce qui manquait.
 */
export function reparerPositions<T extends { id: string; position: number }>(
  liste: T[],
  cle: (e: T) => string
): { liste: T[]; reparations: { id: string; position: number }[] } {
  const max = new Map<string, number>();
  for (const e of liste) {
    if (e.position === SANS_POSITION) continue;
    max.set(cle(e), Math.max(max.get(cle(e)) ?? -1, e.position));
  }

  const reparations: { id: string; position: number }[] = [];
  const reparee = liste.map((e) => {
    if (e.position !== SANS_POSITION) return e;
    const position = (max.get(cle(e)) ?? -1) + 1;
    max.set(cle(e), position);
    reparations.push({ id: e.id, position });
    return { ...e, position };
  });
  return { liste: reparee, reparations };
}
