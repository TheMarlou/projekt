import { extractLinks, extractPageRefs, getBlockText, type Block } from "../store/blocksStore";
import { tr } from "./i18n";

/**
 * Carte mentale : calculs purs (arbre, disposition radiale, liens), sans React.
 *
 * Spécifiée avec l'utilisateur le 11/09 : le projet au centre, les pages en
 * branches tout autour, les sous-pages au bout de leur parent ; les mentions
 * entre pages en pointillé. L'ancienne vue posait toutes les pages sur un
 * cercle, sans hiérarchie — c'était sa critique (« la disposition »).
 */

export const RACINE = "__projet__";

export interface Noeud {
  id: string; // RACINE pour le projet
  titre: string;
  parent: string | null;
  profondeur: number;
  /** Enfants AFFICHÉS (vide si la branche est repliée). */
  enfants: string[];
  /** Nombre de descendants cachés par un repli de ce nœud. */
  caches: number;
  aDesEnfants: boolean;
  x: number;
  y: number;
  angle: number;
  largeur: number;
  hauteur: number;
  /** Placée à la main (décalage enregistré sur ELLE, pas seulement sur un parent). */
  decalee: boolean;
}

export interface Lien {
  de: string;
  vers: string;
  type: "arbre" | "mention";
}

export interface Carte {
  noeuds: Map<string, Noeud>;
  liens: Lien[];
}

// Géométrie, en unités de la carte (1 = 1 px à 100 %).
const RAYON_MIN = 200;
const ECART_NIVEAUX = 175;
const HAUTEUR_BULLE = 30;
// Décalage d'une bulle sur deux : plus que la hauteur d'une bulle (30) et sa marge.
const QUINCONCE = 48;
const TITRE_MAX = 24;

export function titreCourt(titre: string): string {
  const t = titre.trim() || tr("Sans titre", "Untitled");
  return t.length > TITRE_MAX ? `${t.slice(0, TITRE_MAX - 1)}…` : t;
}

/** Largeur approximative d'une bulle : pas de mesure du DOM, la carte se calcule hors écran. */
function largeurBulle(titre: string, racine: boolean): number {
  const parCaractere = racine ? 8.4 : 7.1;
  return Math.round(Math.min(racine ? 240 : 190, Math.max(64, titreCourt(titre).length * parCaractere + 28)));
}

export function construireCarte(
  pages: Block[],
  nomProjet: string,
  replies: Set<string>,
  decalages: Record<string, { dx: number; dy: number }> = {}
): Carte {
  const parId = new Map(pages.map((p) => [p.id, p]));
  // Un parent introuvable (page d'un autre projet, donnée abîmée) : la page
  // remonte à la racine plutôt que de disparaître de la carte.
  const parentDe = (p: Block) => (p.parentId && parId.has(p.parentId) ? p.parentId : RACINE);

  const enfantsDe = new Map<string, Block[]>();
  for (const p of pages) {
    const par = parentDe(p);
    enfantsDe.set(par, [...(enfantsDe.get(par) ?? []), p]);
  }
  for (const l of enfantsDe.values()) l.sort((a, b) => a.position - b.position);

  const noeuds = new Map<string, Noeud>();
  const nbDescendants = (id: string, vus = new Set<string>()): number => {
    if (vus.has(id)) return 0;
    vus.add(id);
    return (enfantsDe.get(id) ?? []).reduce((n, e) => n + 1 + nbDescendants(e.id, vus), 0);
  };

  // Parcours depuis la racine ; `vus` protège d'une boucle parent ↔ enfant.
  const vus = new Set<string>();
  const creer = (id: string, titre: string, parent: string | null, profondeur: number) => {
    vus.add(id);
    const tous = (enfantsDe.get(id) ?? []).filter((e) => !vus.has(e.id));
    const replie = id !== RACINE && replies.has(id) && tous.length > 0;
    const noeud: Noeud = {
      id,
      titre,
      parent,
      profondeur,
      enfants: replie ? [] : tous.map((e) => e.id),
      caches: replie ? nbDescendants(id) : 0,
      aDesEnfants: tous.length > 0,
      x: 0,
      y: 0,
      angle: 0,
      largeur: largeurBulle(titre, id === RACINE),
      hauteur: id === RACINE ? HAUTEUR_BULLE + 10 : HAUTEUR_BULLE,
      decalee: id in decalages,
    };
    noeuds.set(id, noeud);
    if (!replie) for (const e of tous) creer(e.id, e.title, id, profondeur + 1);
  };
  creer(RACINE, nomProjet || "Projet", null, 0);
  // Pages hors de l'arbre (boucle de parents) : rattachées à la racine.
  for (const p of pages) {
    if (!vus.has(p.id) && !estCacheParRepli(p, parId, replies)) {
      noeuds.get(RACINE)!.enfants.push(p.id);
      creer(p.id, p.title, RACINE, 1);
    }
  }

  disposer(noeuds);
  appliquerDecalages(noeuds, decalages);

  const liens: Lien[] = [];
  for (const n of noeuds.values()) for (const e of n.enfants) liens.push({ de: n.id, vers: e, type: "arbre" });
  liens.push(...liensDeMention(pages, noeuds));
  return { noeuds, liens };
}

function estCacheParRepli(p: Block, parId: Map<string, Block>, replies: Set<string>): boolean {
  const vus = new Set<string>();
  let c = p.parentId ? parId.get(p.parentId) : undefined;
  while (c && !vus.has(c.id)) {
    if (replies.has(c.id)) return true;
    vus.add(c.id);
    c = c.parentId ? parId.get(c.parentId) : undefined;
  }
  return false;
}

/**
 * Arbre radial : chaque branche reçoit une part du cercle proportionnelle à son
 * nombre de feuilles, et chaque niveau vit sur un cercle plus grand que le
 * précédent — assez grand pour que les bulles de ce niveau ne se chevauchent pas.
 */
function disposer(noeuds: Map<string, Noeud>) {
  const feuilles = new Map<string, number>();
  const compter = (id: string): number => {
    const n = noeuds.get(id)!;
    const f = n.enfants.length ? n.enfants.reduce((s, e) => s + compter(e), 0) : 1;
    feuilles.set(id, f);
    return f;
  };
  compter(RACINE);

  // 1. Les angles : chaque nœud reçoit une part du cercle proportionnelle à ses feuilles.
  const parts = new Map<string, number>();
  const angles = (id: string, debut: number, fin: number) => {
    const n = noeuds.get(id)!;
    n.angle = (debut + fin) / 2;
    parts.set(id, fin - debut);
    const total = feuilles.get(id)!;
    let a = debut;
    for (const e of n.enfants) {
      const part = ((fin - debut) * feuilles.get(e)!) / total;
      angles(e, a, a + part);
      a += part;
    }
  };
  // Première branche en haut, puis dans le sens des aiguilles d'une montre.
  angles(RACINE, -Math.PI / 2, (3 * Math.PI) / 2);

  // 2. Les rayons : chaque niveau assez loin du centre pour que CHAQUE bulle
  // tienne dans sa part d'arc. Compter les bulles par niveau ne suffisait pas :
  // une page sans sous-page, à côté de grosses branches, n'a qu'une part étroite
  // (vu sur un projet de 26 pages : trois bulles superposées en haut de la carte).
  // En haut et en bas, les bulles sont côte à côte (il faut leur largeur) ; sur
  // les côtés, elles sont empilées (leur hauteur suffit).
  //
  // Et une bulle sur deux est décalée vers l'extérieur (en quinconce) : deux
  // voisines ne sont plus côte à côte mais l'une au-dessus de l'autre, ce qui
  // divise par deux la largeur d'arc nécessaire. Sans ça, 21 bulles terminales
  // sur un cercle donnaient une carte à 30 % de zoom.
  const rayons: number[] = [0];
  const quinconce = new Map<string, number>();
  const profMax = Math.max(...[...noeuds.values()].map((n) => n.profondeur));
  for (let d = 1; d <= profMax; d++) {
    const niveau = [...noeuds.values()].filter((n) => n.profondeur === d).sort((a, b) => a.angle - b.angle);
    const alterne = niveau.length > 2;
    let r = d === 1 ? RAYON_MIN : rayons[d - 1] + ECART_NIVEAUX + (alterne ? QUINCONCE : 0);
    for (const n of niveau) {
      const largeur = (n.largeur + 18) / (alterne ? 2 : 1);
      const encombrement = Math.abs(Math.sin(n.angle)) * largeur + Math.abs(Math.cos(n.angle)) * (n.hauteur + 14);
      r = Math.max(r, encombrement / Math.max(parts.get(n.id)!, 0.01));
    }
    rayons[d] = Math.min(r, (rayons[d - 1] || RAYON_MIN) + 900);
    if (alterne) {
      niveau.forEach((n, i) => {
        // Nombre impair : la dernière et la première se touchent (en haut du
        // cercle) avec la même parité — la dernière part un cran plus loin.
        const cran = niveau.length % 2 && i === niveau.length - 1 ? 2 : i % 2;
        quinconce.set(n.id, cran * QUINCONCE);
      });
    }
  }

  for (const n of noeuds.values()) {
    const r = rayons[n.profondeur] + (quinconce.get(n.id) ?? 0);
    n.x = Math.round(r * Math.cos(n.angle));
    n.y = Math.round(r * Math.sin(n.angle));
  }
}

/**
 * Bulles placées à la main : chacune est décalée de son propre décalage PLUS
 * ceux de ses ancêtres — déplacer une page emmène toute sa branche.
 */
function appliquerDecalages(noeuds: Map<string, Noeud>, decalages: Record<string, { dx: number; dy: number }>) {
  const deplacer = (id: string, ox: number, oy: number) => {
    const n = noeuds.get(id)!;
    const d = decalages[id];
    const x = ox + (d?.dx ?? 0), y = oy + (d?.dy ?? 0);
    n.x += x;
    n.y += y;
    for (const e of n.enfants) deplacer(e, x, y);
  };
  deplacer(RACINE, 0, 0);
}

/** Toutes les bulles d'une branche (la bulle comprise), telles qu'affichées. */
export function branche(carte: Carte, id: string): Set<string> {
  const s = new Set<string>();
  const parcourir = (x: string) => {
    s.add(x);
    carte.noeuds.get(x)?.enfants.forEach(parcourir);
  };
  parcourir(id);
  return s;
}

/** La bulle sous un point de la carte, en ignorant celles de `exclues`. */
export function bulleSous(carte: Carte, x: number, y: number, exclues: Set<string>): Noeud | null {
  for (const n of carte.noeuds.values()) {
    if (exclues.has(n.id)) continue;
    if (Math.abs(x - n.x) <= n.largeur / 2 + 4 && Math.abs(y - n.y) <= n.hauteur / 2 + 4) return n;
  }
  return null;
}

/**
 * Mentions : les liens vers une page écrits dans une autre (puce de mention, ou
 * ancienne syntaxe [[titre]]). La puce de sous-page n'en est pas une : elle
 * double le trait de l'arbre. Un lien vers une page cachée par un repli est
 * redirigé vers la branche repliée, pour qu'on voie qu'il y a quelque chose dedans.
 */
function liensDeMention(pages: Block[], noeuds: Map<string, Noeud>): Lien[] {
  const parId = new Map(pages.map((p) => [p.id, p]));
  const parTitre = new Map(pages.map((p) => [p.title.trim(), p.id]));
  const visible = (id: string) => ancetreVisible(noeuds, parId, id);

  const vus = new Set<string>();
  const liens: Lien[] = [];
  for (const p of pages) {
    const cibles = [
      ...extractPageRefs(p),
      ...extractLinks(getBlockText(p))
        .map((t) => parTitre.get(t))
        .filter((id): id is string => !!id),
    ];
    for (const cible of cibles) {
      if (!parId.has(cible) || parId.get(cible)!.parentId === p.id) continue; // puce de sous-page
      const de = visible(p.id);
      const vers = visible(cible);
      if (!de || !vers || de === vers) continue;
      const cle = de < vers ? `${de}|${vers}` : `${vers}|${de}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      liens.push({ de, vers, type: "mention" });
    }
  }
  return liens;
}

/**
 * La bulle AFFICHÉE qui représente une page : elle-même, ou la branche repliée
 * qui la contient. `null` si la page n'est pas sur la carte.
 */
export function ancetreVisible(noeuds: Map<string, Noeud>, parId: Map<string, Block>, id: string): string | null {
  const vus = new Set<string>();
  let c: string | null = id;
  while (c && !noeuds.has(c) && !vus.has(c)) {
    vus.add(c);
    c = parId.get(c)?.parentId ?? null;
  }
  return c && noeuds.has(c) ? c : null;
}

/**
 * Palette des liens tracés à la main (étape 3) : lisible sur fond sombre comme
 * clair. Ni blanc ni noir : le blanc est réservé aux liens de l'IA.
 */
export const PALETTE_LIENS = [
  { nom: "Rouge", valeur: "#e5534b" },
  { nom: "Orange", valeur: "#f0883e" },
  { nom: "Jaune", valeur: "#d4b82a" },
  { nom: "Vert", valeur: "#57ab5a" },
  { nom: "Turquoise", valeur: "#39c5cf" },
  { nom: "Bleu", valeur: "#539bf5" },
  { nom: "Violet", valeur: "#b083f0" },
  { nom: "Rose", valeur: "#ec6cb9" },
];

/** Point où une droite partant du centre d'une bulle vers (x, y) sort de la bulle. */
function auBord(n: Noeud, x: number, y: number, marge: number): { x: number; y: number } {
  const dx = x - n.x, dy = y - n.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const t = Math.min(ux ? n.largeur / 2 / Math.abs(ux) : Infinity, uy ? n.hauteur / 2 / Math.abs(uy) : Infinity) + marge;
  return { x: n.x + ux * t, y: n.y + uy * t };
}

/**
 * Tracé d'un lien tracé à la main : bombé sur le côté, vers l'EXTÉRIEUR de la
 * carte — bombé vers le centre, il frôlait la bulle du projet. Arrêté
 * au bord de la bulle d'arrivée pour que sa flèche reste visible ; renvoie
 * aussi le milieu, où s'affiche l'étiquette.
 */
export function courbeLien(a: Noeud, b: Noeud, rang = 0): { d: string; milieu: { x: number; y: number } } {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const longueur = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // Plusieurs liens entre les mêmes pages (« ami » dans un sens, « ennemi » dans
  // l'autre) : chacun s'écarte un peu plus, pour que traits et étiquettes se lisent.
  // (Le milieu d'une courbe ne s'écarte que de la MOITIÉ de la bombe : 60 → 30 px d'écart entre étiquettes.)
  const bombe = Math.min(70, longueur * 0.16) + rang * 60;
  let nx = -(b.y - a.y) / longueur, ny = (b.x - a.x) / longueur;
  // Toujours du côté opposé au centre : c'est là qu'il y a de la place.
  if (nx * mx + ny * my < 0) {
    nx = -nx;
    ny = -ny;
  }
  const cx = mx + nx * bombe, cy = my + ny * bombe;
  const debut = auBord(a, cx, cy, 2);
  const fin = auBord(b, cx, cy, 7);
  // Milieu de la courbe de Bézier quadratique (t = 0,5).
  const milieu = { x: 0.25 * debut.x + 0.5 * cx + 0.25 * fin.x, y: 0.25 * debut.y + 0.5 * cy + 0.25 * fin.y };
  return { d: `M${debut.x.toFixed(1)},${debut.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${fin.x.toFixed(1)},${fin.y.toFixed(1)}`, milieu };
}

/** Rectangle englobant, pour recadrer la vue sur toute la carte. */
export function limites(noeuds: Iterable<Noeud>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of noeuds) {
    minX = Math.min(minX, n.x - n.largeur / 2);
    maxX = Math.max(maxX, n.x + n.largeur / 2);
    minY = Math.min(minY, n.y - n.hauteur / 2);
    maxY = Math.max(maxY, n.y + n.hauteur / 2);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Tracé d'un trait de l'arbre : une courbe qui part dans l'axe du parent et
 * arrive dans l'axe de l'enfant, comme les branches d'une carte mentale.
 */
export function courbeArbre(parent: Noeud, enfant: Noeud): string {
  // Les tangentes partent de la direction parent → enfant, infléchies vers l'axe
  // radial : une branche reste une branche même quand une bulle a été déplacée.
  const dx = enfant.x - parent.x, dy = enfant.y - parent.y;
  const longueur = Math.hypot(dx, dy) || 1;
  const aP = parent.id === RACINE ? Math.atan2(dy, dx) : Math.atan2(parent.y, parent.x);
  const aE = Math.atan2(dy, dx);
  const t = longueur * 0.4;
  const c1x = parent.x + t * Math.cos(aP), c1y = parent.y + t * Math.sin(aP);
  const c2x = enfant.x - t * Math.cos(aE), c2y = enfant.y - t * Math.sin(aE);
  return `M${parent.x},${parent.y} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${enfant.x},${enfant.y}`;
}

/** Tracé d'une mention : une courbe douce, bombée vers l'extérieur pour ne pas couper le centre. */
export function courbeMention(a: Noeud, b: Noeud): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const d = Math.hypot(mx, my) || 1;
  const bombe = Math.min(120, Math.hypot(b.x - a.x, b.y - a.y) * 0.25);
  const cx = mx + (mx / d) * bombe, cy = my + (my / d) * bombe;
  return `M${a.x},${a.y} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x},${b.y}`;
}
