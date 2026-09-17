// Génère une sauvegarde Projekt d'exemple : cahier des charges inspiré de
// Minecraft : c'est le projet d'exemple livré avec l'app (accueil du premier lancement).
//   node outils/exemple/exemple-minecraft.mjs <dossier-de-travail> src-tauri/exemples/projet-exemple.zip
// Markdown converti par le VRAI convertisseur de l'app ; « @[Titre] » devient
// une mention de page ; chaque parent reçoit la puce de ses sous-pages.
import { writeFileSync, mkdirSync } from "node:fs";
import { dessiner, zip } from "./pixel-art.mjs";
import { markdownToDoc } from "../../src/lib/markdownToDoc.ts";

const PAGES = [
  ["Cahier des charges", null, `
## Pitch
Un jeu de **survie et de construction** dans un monde infini fait de cubes. Le joueur arrive seul, sans rien, et doit récolter, fabriquer et bâtir pour survivre à sa première nuit — puis façonner le monde à son idée.

## Public et plateformes
- Tout public, dès 8 ans ; très fort potentiel chez les 10-16 ans.
- PC d'abord, puis consoles et mobile.
- Solo et multijoueur.

## Piliers du jeu
1. **Liberté totale** : aucun objectif imposé, le joueur se fixe ses propres buts.
2. **Tout est modifiable** : chaque bloc du monde peut être cassé, ramassé et reposé.
3. **Découverte** : un monde généré à l'infini, jamais deux fois le même.
4. **Créativité** : la construction est aussi importante que la survie.

## Où lire la suite
Le cœur du jeu est décrit dans @[Boucle de jeu] ; l'identité visuelle dans @[Direction artistique] ; le fil conducteur facultatif dans @[Progression et objectifs].
`],
  ["Gameplay", null, `
Tout ce que fait le joueur, minute après minute. Les règles doivent se comprendre sans tutoriel : on apprend en essayant.
`],
  ["Boucle de jeu", "Gameplay", `
## La boucle principale
**Explorer → récolter → fabriquer → construire → survivre**, puis recommencer avec de meilleurs outils.

- **Explorer** : le monde s'étend dans toutes les directions, avec des grottes sous les pieds.
- **Récolter** : frapper un arbre donne du bois ; creuser donne de la pierre, puis des minerais.
- **Fabriquer** : les ressources se combinent en outils, armes, blocs et objets (voir @[Craft et outils]).
- **Construire** : un abri pour la nuit, puis des maisons, des fermes, des machines.
- **Survivre** : la nuit tombe au bout de dix minutes, et les monstres sortent.

## Le rythme jour / nuit
Un cycle complet dure **20 minutes** : 10 de jour, 7 de nuit, et des transitions. Le jour sert à explorer, la nuit oblige à se mettre à l'abri ou à combattre.
`],
  ["Craft et outils", "Gameplay", `
## Principe
Une **grille de fabrication** 2×2 dans l'inventaire, puis 3×3 sur une **table de craft**. Les recettes sont des formes : poser les ingrédients dans le bon motif crée l'objet.

## Paliers d'outils
| Matériau | Durabilité | Peut miner |
|---|---|---|
| Bois | Faible | Pierre, charbon |
| Pierre | Moyenne | Fer |
| Fer | Bonne | Or, diamant, redstone |
| Diamant | Très bonne | Obsidienne |

Chaque palier ouvre l'accès au suivant : c'est la colonne vertébrale de la progression.

## Autres fabrications
- **Four** : cuire la nourriture et fondre les minerais en lingots.
- **Coffres** pour stocker, **lits** pour passer la nuit, **torches** pour éclairer.
`],
  ["Survie", "Gameplay", `
## Jauges
- **Santé** : 10 cœurs. Elle remonte seule si la faim est pleine.
- **Faim** : 10 cuisses de poulet. Elle baisse en courant, en sautant, en combattant.

## Dangers
- Les **monstres** apparaissent dans l'obscurité : la nuit, et dans les grottes non éclairées.
- La **chute**, la **lave**, la **noyade**.
- Mourir fait perdre tout son inventaire à l'endroit de la mort : on peut revenir le chercher.

## Se protéger
Un abri éclairé par des torches empêche les monstres d'apparaître à l'intérieur. Dormir dans un lit fait passer la nuit.
`],
  ["Modes de jeu", "Gameplay", `
- **Survie** : le mode principal décrit dans ce document.
- **Créatif** : ressources illimitées, vol, aucun danger. Pour construire librement.
- **Hardcore** : comme Survie, mais une seule vie. Mourir supprime le monde.
- **Aventure** : pour les cartes créées par les joueurs ; on ne casse que certains blocs.
`],
  ["Redstone", "Gameplay", `
La **redstone** est une poussière qu'on trouve sous terre. Posée au sol, elle transporte un **signal électrique**.

- Avec des **leviers**, **boutons**, **pistons** et **répéteurs**, les joueurs construisent des portes automatiques, des pièges, des fermes automatiques… et même des ordinateurs.
- C'est la mécanique « ingénieur » du jeu : profonde, mais entièrement facultative.
`],
  ["Monde", null, `
Un monde **infini**, découpé en tronçons de 16×16 blocs chargés autour du joueur. Trois dimensions : la surface, @[Le Nether] et @[L'End].
`],
  ["Génération procédurale", "Monde", `
- Chaque monde naît d'une **graine** (un nombre) : la même graine redonne exactement le même monde, ce qui permet de partager ses mondes préférés.
- Relief, rivières, **grottes**, ravins et gisements sont calculés par des algorithmes de bruit.
- Des **structures** sont semées au hasard : villages, temples, puits de mine abandonnés, forts souterrains.
`],
  ["Biomes", "Monde", `
Chaque région a son climat, sa végétation et ses créatures.

| Biome | Particularité |
|---|---|
| Plaines | Herbe, chevaux, villages fréquents |
| Forêt | Bois abondant, sombre la nuit |
| Désert | Cactus, temples piégés, pas d'eau |
| Jungle | Arbres géants, perroquets, temples cachés |
| Toundra | Neige, glace, ours polaires |
| Océan | Monuments sous-marins, noyés |
`],
  ["Le Nether", "Monde", `
Une dimension infernale de lave et de roche rouge, sans eau ni jour.

- On y accède par un **portail** : un cadre de blocs d'**obsidienne** allumé avec un briquet.
- On y trouve des **forteresses** gardées par des **blazes**, dont la poudre sert à fabriquer des potions et les yeux de l'Ender.
- 1 bloc parcouru dans le Nether = 8 blocs à la surface : un raccourci pour voyager.
`],
  ["L'End", "Monde", `
La dimension finale : des îles flottantes au-dessus du vide, sous un ciel noir.

- Son **portail** se trouve dans un **fort souterrain** de la surface, et doit être complété avec des yeux de l'Ender.
- Elle abrite le boss final et, après sa défaite, des villes flottantes avec les meilleurs trésors du jeu.
`],
  ["Créatures", null, `
Les créatures (appelées « mobs ») donnent vie au monde : certaines sont pacifiques, d'autres hostiles, d'autres neutres tant qu'on ne les provoque pas.
`],
  ["Creeper", "Créatures", `
Le monstre emblématique du jeu : **vert, silencieux**, il s'approche du joueur et **explose**, détruisant les blocs autour de lui.

- Il n'apparaît que dans l'obscurité, comme les autres monstres hostiles.
- Il **fuit les chats et les ocelots**.
- Son explosion peut ruiner une construction : il pousse le joueur à bâtir en pierre et à éclairer.
`],
  ["Zombie et squelette", "Créatures", `
- **Zombie** : lent, en groupe, il brûle au soleil. Il attaque les **villages** et peut transformer un villageois en zombie.
- **Squelette** : tire des flèches de loin, brûle aussi au soleil. Il laisse tomber des os et des flèches.

Tous deux sont les premières menaces de la première nuit.
`],
  ["Enderman", "Créatures", `
Une grande silhouette noire aux yeux violets.

- **Neutre** : il n'attaque que si le joueur **le regarde dans les yeux**.
- Il se **téléporte** et déplace des blocs.
- Il craint l'eau.
- En mourant, il laisse tomber une **perle de l'Ender**.
`],
  ["Villageois", "Créatures", `
Les habitants pacifiques des villages. Chacun a un **métier** (fermier, forgeron, bibliothécaire…) lié à un bloc de travail.

- On **commerce** avec eux en **émeraudes** : ils vendent des outils, des livres d'enchantement, de la nourriture.
- Leurs villages sont attaqués la nuit : le joueur peut les protéger avec des **golems de fer**.
`],
  ["Ender Dragon", "Créatures", `
Le **boss final**, qui attend le joueur dans l'End.

- Il vole autour d'une île centrale et se **soigne grâce à des cristaux** posés sur des piliers : il faut d'abord les détruire.
- Sa défaite fait apparaître le générique de fin… puis le jeu continue.
`],
  ["Ressources et objets", null, `
Tout ce que le joueur ramasse, stocke et transforme.
`],
  ["Minerais", "Ressources et objets", `
| Minerai | Profondeur | Usage |
|---|---|---|
| Charbon | Partout | Torches, carburant du four |
| Fer | Moyenne | Outils, armures, seaux, rails |
| Or | Profonde | Objets de luxe, pommes dorées |
| Redstone | Très profonde | Circuits électriques |
| Diamant | Très profonde | Meilleurs outils et armures |
| Émeraude | Montagnes, rare | Monnaie d'échange |

L'**obsidienne** n'est pas un minerai : elle naît quand l'eau touche la lave, et seule une pioche en diamant peut la miner.
`],
  ["Objets de l'Ender", "Ressources et objets", `
- **Perle de l'Ender** : lancée, elle **téléporte** le joueur là où elle tombe.
- **Œil de l'Ender** : une perle combinée à de la **poudre de blaze**. Lancé en l'air, il vole vers le **fort** le plus proche. Il en faut douze pour activer le portail de l'End.
`],
  ["Direction artistique", null, `
## Intention
Un monde **simple, lisible et chaleureux**, où tout est fait de cubes : la contrainte devient un style. Le joueur doit comprendre d'un coup d'œil de quoi est fait chaque bloc.

## Références
Jeux de construction en briques, pixel art des années 90, jouets en bois.
`],
  ["Palette et textures", "Direction artistique", `
- Style **voxel** : chaque bloc est un cube d'un mètre.
- **Textures 16×16 pixels**, sans lissage : le rendu est volontairement pixelisé (pixel art appliqué en 3D).
- Couleurs **saturées mais naturelles** : vert herbe, brun terre, gris pierre.
- **Éclairage par blocs** : la lumière des torches se diffuse case par case, et l'obscurité fait apparaître les monstres.
- Les créatures sont faites de pavés : lisibles de loin, faciles à animer.
`],
  ["Son et musique", "Direction artistique", `
- **Musique discrète** au piano et aux nappes, qui revient par moments puis se tait : elle accompagne l'exploration sans la presser.
- **Sons des créatures** très reconnaissables : le sifflement avant une explosion, les grognements des zombies, les cliquetis des squelettes.
- Les bruits de pas changent selon le bloc : herbe, pierre, bois, sable.
`],
  ["Progression et objectifs", null, `
Aucun objectif n'est obligatoire, mais un **fil conducteur** guide ceux qui le souhaitent :

1. Survivre à la première nuit.
2. Passer des outils en bois aux outils en fer, puis trouver des **diamants** (voir @[Minerais]).
3. Construire un portail d'obsidienne et explorer @[Le Nether].
4. Vaincre des blazes, puis fabriquer des yeux de l'Ender pour trouver le fort.
5. Traverser le portail de l'End et affronter l'@[Ender Dragon].

Des **succès** récompensent chaque étape, pour que le joueur sente qu'il avance.
`],
  ["Idées en vrac", null, `
- Des **animaux à apprivoiser** : loups, chats, chevaux.
- Un système d'**enchantement** avec une table et des livres, alimenté par l'expérience.
- Des **cartes** qui se dessinent à mesure qu'on explore.
- Des **météos** : pluie, orages avec éclairs qui transforment les créatures.
- Un **mode histoire** court pour les débutants ?
`],
];

// --- Pages ---------------------------------------------------------------
const maintenant = Date.now();
const ids = new Map(PAGES.map(([t]) => [t, crypto.randomUUID()]));
const enfants = new Map();
for (const [t, parent] of PAGES) if (parent) enfants.set(parent, [...(enfants.get(parent) ?? []), t]);

/** « @[Titre] » dans un texte → mention de page (nœud pageLink de l'éditeur). */
function mentions(noeud) {
  if (!noeud.content) return noeud;
  const contenu = [];
  for (const enfant of noeud.content) {
    if (enfant.type !== "text" || !enfant.text.includes("@[")) {
      contenu.push(mentions(enfant));
      continue;
    }
    for (const morceau of enfant.text.split(/(@\[[^\]]+\])/)) {
      const m = morceau.match(/^@\[([^\]]+)\]$/);
      if (m) {
        const id = ids.get(m[1]);
        if (!id) throw new Error(`Mention vers une page inconnue : ${m[1]}`);
        contenu.push({ type: "pageLink", attrs: { pageId: id } });
      } else if (morceau) contenu.push({ ...enfant, text: morceau });
    }
  }
  return { ...noeud, content: contenu };
}

const pages = PAGES.map(([titre, parent, md], i) => {
  const doc = mentions(markdownToDoc(md.trim()));
  // Comme dans l'app : le parent porte la puce de chacune de ses sous-pages.
  for (const e of enfants.get(titre) ?? []) doc.content.push({ type: "paragraph", content: [{ type: "pageLink", attrs: { pageId: ids.get(e) } }] });
  return {
    id: ids.get(titre),
    parentId: parent ? ids.get(parent) : null,
    title: titre,
    content: [{ id: crypto.randomUUID(), type: "text", doc }],
    createdAt: maintenant + i,
    updatedAt: maintenant + i,
  };
});

// Moodboard : visuels pixel-art dessinés par pixel-art.mjs, disposés en mosaïque.
const images = dessiner();
const DISPO = [[0, 0, 420], [440, 30, 360], [0, 300, 360], [380, 270, 420], [820, 0, 300], [820, 220, 300]];
const canvas = images.map((im, i) => {
  const [x, y, l] = DISPO[i];
  return { asset: "assets/" + im.nom, x, y, width: l, height: Math.round((l * im.hauteur) / im.largeur), crop: null, genre: "image", meta: null };
});
const payload = { format: "projekt-export", version: 1, exportedAt: maintenant, project: { name: "Minecraft (exemple)" }, pages, canvas, carte: { decalages: [], liens: [] } };
const dossier = process.argv[2];
mkdirSync(dossier, { recursive: true });
writeFileSync(`${dossier}/projekt.json`, JSON.stringify(payload, null, 2));
for (const im of images) writeFileSync(`${dossier}/${im.nom}`, im.octets);
if (process.argv[3]) {
  writeFileSync(process.argv[3], zip([{ nom: "projekt.json", octets: Buffer.from(JSON.stringify(payload, null, 2)) }, ...images.map((im) => ({ nom: "assets/" + im.nom, octets: im.octets }))]));
  console.log("sauvegarde écrite :", process.argv[3]);
}
const nbMentions = JSON.stringify(pages).split('"pageLink"').length - 1;
console.log(`${pages.length} pages, ${nbMentions} puces et mentions → ${dossier}/projekt.json`);
