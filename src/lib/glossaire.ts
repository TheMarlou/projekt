/**
 * Glossaire de game design et de graphisme, joint à l'invite quand la question
 * contient l'un de ces termes.
 *
 * Pourquoi : l'utilisateur débute, et le petit modèle local connaît mal ce
 * vocabulaire. Mesuré le 11/09 : « C'est quoi un roguelike ? » → « mort
 * aléatoire » (au lieu de « mort permanente »), « monde ouvert », « combine RPG et
 * stratégie »… Des définitions exactes, écrites une fois pour toutes, lui
 * donnent une base juste — sans internet, comme le reste de Projekt.
 *
 * Chaque définition tient en une ou deux phrases : l'invite est déjà chargée, et
 * un contexte trop long ralentit tout sur une carte de 6 Go.
 */

interface Entree {
  /** Formes sous lesquelles le terme apparaît dans une question (sans accents, minuscules). */
  formes: string[];
  terme: string;
  definition: string;
}

const GLOSSAIRE: Entree[] = [
  { terme: "Roguelike", formes: ["roguelike", "rogue-like", "rogue like"], definition: "jeu où l'on explore des niveaux générés aléatoirement, avec mort permanente : à la mort, on recommence depuis le début sans rien garder. Nommé d'après Rogue (1980). Ex. : Rogue, NetHack, The Binding of Isaac." },
  { terme: "Roguelite", formes: ["roguelite", "rogue-lite", "rogue lite"], definition: "variante plus accessible du roguelike : on meurt et on recommence aussi, mais on garde une progression permanente d'une partie à l'autre (améliorations, déblocages). Ex. : Hades, Dead Cells, Rogue Legacy." },
  { terme: "Mort permanente (permadeath)", formes: ["permadeath", "mort permanente"], definition: "à la mort du personnage, la partie est perdue et il faut tout recommencer ; pas de retour à une sauvegarde." },
  { terme: "Génération procédurale", formes: ["procedural", "procedurale", "generation aleatoire", "generes aleatoirement"], definition: "contenu (niveaux, cartes, objets) créé par un algorithme plutôt qu'à la main, différent à chaque partie." },
  { terme: "Run", formes: [" run ", " runs ", "une run"], definition: "une partie complète, du départ à la mort ou à la victoire, dans un roguelike ou un roguelite." },
  { terme: "Metroidvania", formes: ["metroidvania"], definition: "jeu d'exploration en 2D dans un grand monde interconnecté, où de nouvelles capacités ouvrent l'accès à des zones auparavant bloquées. Ex. : Hollow Knight, Super Metroid, Castlevania: Symphony of the Night." },
  { terme: "Boucle de gameplay (game loop)", formes: ["boucle de gameplay", "boucle de jeu", "game loop", "gameplay loop", "core loop"], definition: "cycle d'actions que le joueur répète en permanence (ex. explorer → combattre → récolter → s'améliorer), qui fait l'intérêt du jeu minute après minute." },
  { terme: "Game design document (GDD)", formes: ["gdd", "game design document", "document de conception"], definition: "document qui décrit le jeu : concept, mécaniques, univers, personnages, niveaux ; il sert de référence à toute l'équipe." },
  { terme: "Pattern d'attaque", formes: ["pattern"], definition: "séquence d'attaques d'un ennemi ou d'un boss, répétée et donc apprenable par le joueur." },
  { terme: "Hitbox", formes: ["hitbox", "hit box"], definition: "zone invisible qui détermine si un coup touche ; elle peut différer de l'apparence du personnage." },
  { terme: "Frames d'invincibilité (i-frames)", formes: ["i-frame", "iframe", "invincibilite"], definition: "court instant où le personnage ne peut pas être touché, souvent pendant une esquive ou juste après un coup reçu." },
  { terme: "Courbe de difficulté", formes: ["courbe de difficulte", "difficulte progressive"], definition: "manière dont la difficulté augmente au fil du jeu pour rester stimulante sans décourager." },
  { terme: "Level design", formes: ["level design", "conception de niveau"], definition: "conception des niveaux : disposition des lieux, obstacles, ennemis et récompenses, et chemin que suit le joueur." },
  { terme: "Lore", formes: ["lore"], definition: "histoire et univers de fond du jeu (passé du monde, peuples, légendes), souvent découverts par petits morceaux." },
  { terme: "PNJ (NPC)", formes: ["pnj", "npc"], definition: "personnage non joueur : tout personnage contrôlé par le jeu (marchand, allié, habitant)." },
  { terme: "Deck-building", formes: ["deck-building", "deckbuilding", "deck building"], definition: "genre où l'on construit son paquet de cartes au fil de la partie. Ex. : Slay the Spire, Balatro." },
  { terme: "Soulslike", formes: ["soulslike", "souls-like", "souls like"], definition: "jeu d'action exigeant inspiré de Dark Souls : combats difficiles basés sur les patterns ennemis, gestion de l'endurance, points de repos espacés." },
  { terme: "Pixel art", formes: ["pixel art", "pixel-art"], definition: "style graphique où l'image est dessinée pixel par pixel, en basse résolution visible. Ex. : Celeste, Stardew Valley." },
  { terme: "Low poly", formes: ["low poly", "low-poly"], definition: "style 3D à peu de polygones, aux formes anguleuses et facettées, souvent en couleurs unies." },
  { terme: "Cel-shading", formes: ["cel-shading", "cel shading", "cell shading"], definition: "rendu 3D qui imite le dessin animé : aplats de couleur, ombres franches, souvent des contours noirs. Ex. : Zelda: The Wind Waker, Borderlands." },
  { terme: "Isométrique", formes: ["isometrique", "isometric"], definition: "vue de dessus en biais, sans perspective (les lignes parallèles restent parallèles). Ex. : Hades, Diablo." },
  { terme: "Sprite", formes: ["sprite"], definition: "image 2D d'un personnage ou d'un objet, souvent animée image par image." },
  { terme: "Tilemap", formes: ["tilemap", "tileset", "tuile"], definition: "niveau 2D construit en assemblant de petites images carrées répétées (les tuiles)." },
  { terme: "Juice (game feel)", formes: ["juice", "game feel"], definition: "petits effets qui rendent une action agréable : secousse d'écran, particules, son, léger ralenti à l'impact." },
];

const sansAccent = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Définitions des termes présents dans la demande (3 au plus), prêtes pour l'invite. */
export function definitionsPour(demande: string, max = 3): string[] {
  const texte = ` ${sansAccent(demande).replace(/[^a-z0-9-]+/g, " ")} `;
  return GLOSSAIRE.filter((e) => e.formes.some((f) => texte.includes(f)))
    .slice(0, max)
    .map((e) => `${e.terme} : ${e.definition}`);
}
