// Visuels « pixel-art » d'inspiration cubique pour le moodboard du projet
// d'exemple : dessinés ici, pixel par pixel, donc sans aucun souci de droits.
import { deflateSync, crc32 } from "node:zlib";

// --- Petit moteur de dessin ------------------------------------------------
function toile(l, h, fond = [0, 0, 0]) {
  const px = new Uint8Array(l * h * 3);
  for (let i = 0; i < l * h; i++) px.set(fond, i * 3);
  return { l, h, px };
}
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
function point(t, x, y, c) {
  if (x < 0 || y < 0 || x >= t.l || y >= t.h) return;
  t.px.set(c, (y * t.l + x) * 3);
}
function rect(t, x, y, l, h, c) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + l; i++) point(t, i, j, c);
}
// Hasard reproductible : les images sont identiques à chaque génération.
function hasard(graine) {
  let s = graine >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const nuance = (c, d) => c.map((v) => Math.max(0, Math.min(255, Math.round(v + d))));
// Rectangle « texturé » : chaque pixel varie un peu autour de la couleur.
function matiere(t, x, y, l, h, c, amplitude, alea) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + l; i++) point(t, i, j, nuance(c, (alea() - 0.5) * amplitude));
}

// --- Blocs -------------------------------------------------------------------
const C = {
  herbe: hex("#5fa83a"), terre: hex("#8a5a34"), pierre: hex("#7d7d7d"), roche: hex("#6a6a6a"),
  bois: hex("#6e4b2a"), planche: hex("#b38a52"), feuille: hex("#3f8a2e"), sable: hex("#e0cf8e"),
  gres: hex("#d4bd79"), eau: hex("#3f6fd8"), lave: hex("#e8641c"), charbon: hex("#222222"),
  fer: hex("#d8b08c"), or: hex("#f2d33c"), diamant: hex("#5ee6e0"), obsidienne: hex("#1e1530"),
  neige: hex("#f2f5f7"), cactus: hex("#2f7d32"), citrouille: hex("#e38a1d"),
};

function bloc(t, x, y, n, sorte, alea) {
  const base = C[sorte];
  if (sorte === "herbe") {
    matiere(t, x, y, n, n, C.terre, 26, alea);
    matiere(t, x, y, n, Math.ceil(n / 4), C.herbe, 30, alea);
    for (let i = 0; i < n; i++) if (alea() < 0.45) point(t, x + i, y + Math.ceil(n / 4), nuance(C.herbe, -20));
    return;
  }
  if (sorte === "bois") {
    matiere(t, x, y, n, n, base, 14, alea);
    for (let i = 1; i < n; i += 3) for (let j = 0; j < n; j++) if (alea() < 0.7) point(t, x + i, y + j, nuance(base, -28));
    return;
  }
  if (sorte === "planche") {
    matiere(t, x, y, n, n, base, 16, alea);
    for (let j = Math.floor(n / 2); j < n; j += Math.floor(n / 2)) rect(t, x, y + j, n, 1, nuance(base, -45));
    return;
  }
  if (["charbon", "fer", "or", "diamant"].includes(sorte)) {
    matiere(t, x, y, n, n, C.pierre, 24, alea);
    for (let k = 0; k < Math.max(3, n / 2); k++) {
      const i = Math.floor(alea() * (n - 2)), j = Math.floor(alea() * (n - 2));
      rect(t, x + i, y + j, 2, 2, nuance(base, (alea() - 0.5) * 30));
    }
    return;
  }
  matiere(t, x, y, n, n, base, sorte === "eau" || sorte === "lave" ? 20 : 26, alea);
}

// --- Scènes (64 × 40 pixels, agrandies 8 fois) -------------------------------
const L = 64, H = 40, E = 8;

function ciel(t, haut, bas) {
  for (let y = 0; y < t.h; y++) {
    const k = y / t.h;
    rect(t, 0, y, t.l, 1, haut.map((v, i) => Math.round(v + (bas[i] - v) * k)));
  }
}

function arbre(t, x, sol, alea) {
  const tronc = 4 + Math.floor(alea() * 2);
  matiere(t, x, sol - tronc, 2, tronc, C.bois, 18, alea);
  matiere(t, x - 3, sol - tronc - 4, 8, 4, C.feuille, 34, alea);
  matiere(t, x - 2, sol - tronc - 6, 6, 2, C.feuille, 34, alea);
}

function plaine() {
  const alea = hasard(7), t = toile(L, H);
  ciel(t, hex("#6fb3f2"), hex("#bfe3ff"));
  rect(t, 50, 4, 6, 6, hex("#fff6a8"));
  for (const [x, y, l] of [[6, 6, 12], [28, 9, 9], [40, 3, 7]]) rect(t, x, y, l, 2, hex("#ffffff"));
  const sol = (x) => 26 + Math.round(Math.sin(x / 7) * 3 + Math.sin(x / 3.1));
  for (let x = 0; x < L; x++) {
    const s = sol(x);
    matiere(t, x, s, 1, 1, C.herbe, 30, alea);
    matiere(t, x, s + 1, 1, 5, C.terre, 26, alea);
    matiere(t, x, s + 6, 1, H - s - 6, C.pierre, 24, alea);
  }
  for (let x = 10; x < 22; x++) if (sol(x) >= 27) matiere(t, x, sol(x), 1, 2, C.eau, 18, alea);
  for (const x of [4, 30, 45, 58]) arbre(t, x, sol(x), alea);
  return t;
}

function nuit() {
  const alea = hasard(11), t = toile(L, H);
  ciel(t, hex("#0b1030"), hex("#27305e"));
  for (let k = 0; k < 40; k++) point(t, Math.floor(alea() * L), Math.floor(alea() * 22), hex("#e8ecff"));
  rect(t, 8, 4, 5, 5, hex("#e9e9dc"));
  rect(t, 9, 5, 1, 1, hex("#c8c8b8"));
  for (let x = 0; x < L; x++) {
    const s = 28 + Math.round(Math.sin(x / 9) * 2);
    matiere(t, x, s, 1, 1, nuance(C.herbe, -60), 16, alea);
    matiere(t, x, s + 1, 1, H - s - 1, nuance(C.terre, -55), 14, alea);
  }
  // Abri en planches, fenêtre allumée, torches.
  matiere(t, 34, 19, 14, 9, nuance(C.planche, -35), 14, alea);
  for (let i = 0; i < 9; i++) rect(t, 33 + i, 18 - i, 16 - 2 * i, 1, nuance(C.bois, -30));
  rect(t, 37, 22, 3, 3, hex("#ffd36b"));
  rect(t, 43, 23, 3, 5, nuance(C.bois, -40));
  for (const x of [31, 50]) {
    rect(t, x, 24, 1, 4, nuance(C.bois, -20));
    rect(t, x, 23, 1, 1, hex("#ffb13b"));
    point(t, x, 22, hex("#fff1a0"));
  }
  // Silhouettes de monstres qui approchent.
  for (const x of [12, 20]) {
    rect(t, x, 22, 3, 3, hex("#3c7a3a"));
    rect(t, x, 25, 3, 3, hex("#2f5d8a"));
    rect(t, x, 28, 1, 2, hex("#3a3a55"));
    rect(t, x + 2, 28, 1, 2, hex("#3a3a55"));
    point(t, x, 23, hex("#101010"));
    point(t, x + 2, 23, hex("#101010"));
  }
  return t;
}

function grotte() {
  const alea = hasard(23), t = toile(L, H);
  for (let y = 0; y < H; y += 4) for (let x = 0; x < L; x += 4) bloc(t, x, y, 4, alea() < 0.2 ? "roche" : "pierre", alea);
  // La cavité : un tunnel sombre.
  for (let x = 0; x < L; x++) {
    const haut = 12 + Math.round(Math.sin(x / 6) * 3), bas = 28 + Math.round(Math.cos(x / 8) * 2);
    matiere(t, x, haut, 1, bas - haut, hex("#1b1b22"), 10, alea);
  }
  const minerais = [["charbon", 4, 3], ["fer", 20, 30], ["or", 44, 2], ["diamant", 54, 31], ["charbon", 30, 1], ["fer", 1, 30], ["or", 12, 33], ["diamant", 26, 32], ["charbon", 56, 4]];
  for (const [sorte, x, y] of minerais) bloc(t, x, y, 6, sorte, alea);
  matiere(t, 36, 27, 14, 3, C.lave, 40, alea);
  for (let i = 0; i < 6; i++) point(t, 37 + Math.floor(alea() * 12), 27, hex("#ffd24a"));
  rect(t, 18, 21, 1, 3, C.bois);
  rect(t, 18, 20, 1, 1, hex("#ffb13b"));
  return t;
}

function desert() {
  const alea = hasard(31), t = toile(L, H);
  ciel(t, hex("#f2a65a"), hex("#ffe3a3"));
  rect(t, 12, 5, 7, 7, hex("#fff3c4"));
  // Pyramide de grès.
  for (let i = 0; i < 14; i++) matiere(t, 46 - i, 12 + i, 2 + 2 * i, 1, i % 3 === 2 ? nuance(C.gres, -28) : C.gres, 12, alea);
  rect(t, 45, 22, 4, 4, nuance(C.gres, -90));
  for (let x = 0; x < L; x++) {
    const s = 26 + Math.round(Math.sin(x / 5) * 1.5);
    matiere(t, x, s, 1, H - s, C.sable, 22, alea);
  }
  for (const [x, h] of [[8, 6], [26, 4]]) {
    matiere(t, x, 26 - h, 2, h, C.cactus, 20, alea);
    rect(t, x - 1, 26 - h + 1, 1, 2, C.cactus);
  }
  return t;
}

function palette() {
  const alea = hasard(43), t = toile(L, H, hex("#1f1f24"));
  const sortes = ["herbe", "terre", "pierre", "bois", "planche", "feuille", "sable", "gres", "eau", "lave", "neige", "obsidienne", "charbon", "fer", "or", "diamant", "citrouille", "cactus"];
  sortes.forEach((s, k) => bloc(t, 2 + (k % 6) * 10, 2 + Math.floor(k / 6) * 12 + 1, 8, s, alea));
  return t;
}

function fabrication() {
  const alea = hasard(59), t = toile(L, H, hex("#c6c6c6"));
  const caseVide = (x, y) => {
    rect(t, x, y, 9, 9, hex("#8b8b8b"));
    rect(t, x + 1, y + 1, 8, 8, hex("#e2e2e2"));
    rect(t, x + 1, y + 1, 7, 7, hex("#9d9d9d"));
  };
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) caseVide(6 + i * 9, 6 + j * 9);
  // Recette de la pioche : trois planches en haut, deux bâtons au milieu.
  for (let i = 0; i < 3; i++) bloc(t, 8 + i * 9, 8, 5, "planche", alea);
  for (const j of [1, 2]) rect(t, 17 + 2, 8 + j * 9, 2, 5, C.bois);
  // Flèche.
  rect(t, 38, 19, 6, 2, hex("#8b8b8b"));
  for (let i = 0; i < 3; i++) rect(t, 44 + i, 17 + i, 1, 6 - 2 * i, hex("#8b8b8b"));
  caseVide(50, 15);
  // La pioche obtenue.
  rect(t, 52, 17, 5, 1, C.planche);
  rect(t, 51, 18, 2, 1, C.planche);
  rect(t, 56, 18, 2, 1, C.planche);
  for (let i = 0; i < 4; i++) point(t, 54, 18 + i, nuance(C.bois, 10));
  return t;
}

// --- Couvertures des TikToks (format vertical 9:16) ---------------------------
// Dessinées plutôt que téléchargées : les vraies miniatures appartiennent à leurs
// auteurs, et ce projet d'exemple est distribué publiquement. La vidéo, elle, se
// lit dans le lecteur officiel de TikTok.
const LV = 36, HV = 64;

function couvertureCerisiers() {
  const alea = hasard(71), t = toile(LV, HV);
  ciel(t, hex("#f7b2c4"), hex("#ffe6d2"));
  rect(t, 24, 10, 6, 6, hex("#fff4e0"));
  // Lac et reflets.
  for (let y = 40; y < 50; y++) rect(t, 0, y, LV, 1, nuance(hex("#7fa8e0"), (y - 40) * -3));
  for (let k = 0; k < 10; k++) rect(t, Math.floor(alea() * (LV - 3)), 41 + Math.floor(alea() * 8), 3, 1, hex("#ffd9e4"));
  for (let x = 0; x < LV; x++) {
    const s = 50 + Math.round(Math.sin(x / 4) * 1.5);
    matiere(t, x, s, 1, 1, C.herbe, 30, alea);
    matiere(t, x, s + 1, 1, HV - s - 1, C.terre, 24, alea);
  }
  // Deux cerisiers en fleurs.
  for (const [x, sol, haut] of [[7, 50, 12], [27, 50, 16]]) {
    matiere(t, x, sol - haut, 2, haut, hex("#5a3a2a"), 14, alea);
    matiere(t, x - 6, sol - haut - 6, 14, 6, hex("#f48fb1"), 40, alea);
    matiere(t, x - 4, sol - haut - 9, 10, 3, hex("#f8bbd0"), 36, alea);
  }
  for (let k = 0; k < 14; k++) point(t, Math.floor(alea() * LV), 20 + Math.floor(alea() * 30), hex("#fce4ec"));
  return t;
}

function couvertureJukebox() {
  const alea = hasard(83), t = toile(LV, HV);
  // Intérieur de cabane : murs en planches, fenêtre de nuit.
  for (let y = 0; y < 48; y += 4) matiere(t, 0, y, LV, 4, y % 8 ? C.planche : nuance(C.planche, -18), 16, alea);
  rect(t, 4, 8, 12, 12, nuance(C.bois, -30));
  rect(t, 5, 9, 10, 10, hex("#1a2350"));
  point(t, 8, 12, hex("#e8ecff"));
  point(t, 12, 15, hex("#e8ecff"));
  rect(t, 11, 10, 3, 3, hex("#e9e9dc"));
  for (let y = 48; y < HV; y += 4) for (let x = 0; x < LV; x += 4) bloc(t, x, y, 4, "planche", alea);
  // Le jukebox, un disque qui dépasse, et des notes de musique.
  matiere(t, 20, 34, 12, 14, nuance(C.bois, -10), 16, alea);
  rect(t, 21, 35, 10, 3, nuance(C.bois, -40));
  rect(t, 23, 33, 6, 2, hex("#2b2b2b"));
  rect(t, 25, 33, 2, 1, hex("#e04848"));
  rect(t, 22, 40, 8, 1, nuance(C.bois, -35));
  for (const [x, y] of [[18, 26], [24, 21], [30, 25]]) {
    rect(t, x, y, 2, 2, hex("#ffffff"));
    rect(t, x + 1, y - 5, 1, 5, hex("#ffffff"));
    rect(t, x + 2, y - 5, 2, 1, hex("#ffffff"));
  }
  // Une lanterne.
  rect(t, 6, 38, 4, 5, hex("#3a3a3a"));
  rect(t, 7, 39, 2, 3, hex("#ffc94a"));
  return t;
}

// --- PNG -----------------------------------------------------------------------
function png(t, echelle) {
  const l = t.l * echelle, h = t.h * echelle;
  const brut = Buffer.alloc((l * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const ligne = y * (l * 3 + 1);
    brut[ligne] = 0;
    for (let x = 0; x < l; x++) {
      const s = (Math.floor(y / echelle) * t.l + Math.floor(x / echelle)) * 3;
      brut[ligne + 1 + x * 3] = t.px[s];
      brut[ligne + 2 + x * 3] = t.px[s + 1];
      brut[ligne + 3 + x * 3] = t.px[s + 2];
    }
  }
  const morceau = (type, donnees) => {
    const longueur = Buffer.alloc(4);
    longueur.writeUInt32BE(donnees.length);
    const corps = Buffer.concat([Buffer.from(type), donnees]);
    const somme = Buffer.alloc(4);
    somme.writeUInt32BE(crc32(corps));
    return Buffer.concat([longueur, corps, somme]);
  };
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(l, 0);
  entete.writeUInt32BE(h, 4);
  entete.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau("IHDR", entete),
    morceau("IDAT", deflateSync(brut, { level: 9 })),
    morceau("IEND", Buffer.alloc(0)),
  ]);
}

export function dessiner() {
  return [
    ["plaine-au-lever.png", plaine()],
    ["premiere-nuit.png", nuit()],
    ["grotte-et-minerais.png", grotte()],
    ["desert-et-pyramide.png", desert()],
    ["palette-des-blocs.png", palette()],
    ["recette-de-la-pioche.png", fabrication()],
  ].map(([nom, t]) => ({ nom, largeur: t.l * E, hauteur: t.h * E, octets: png(t, E) }));
}

/** Les TikToks choisis par Marlou (17/09), avec une couverture dessinée. */
export function tiktoks() {
  return [
    {
      nom: "tiktok-cerisiers.png",
      toile: couvertureCerisiers(),
      meta: { url: "https://www.tiktok.com/@elsewhere557/video/7679642113310575904", videoId: "7679642113310575904", titre: "", auteur: "@elsewhere557" },
    },
    {
      nom: "tiktok-jukebox.png",
      toile: couvertureJukebox(),
      meta: { url: "https://www.tiktok.com/@yuuzjw/video/7677832836509961492", videoId: "7677832836509961492", titre: "my kind of woman | #macdemarco #minecraft", auteur: "yuji" },
    },
  ].map(({ nom, toile: t, meta }) => ({ nom, meta, largeur: t.l * E, hauteur: t.h * E, octets: png(t, E) }));
}

// --- Zip (sans compression : les PNG le sont déjà) -----------------------------
export function zip(fichiers) {
  const locaux = [], centraux = [];
  let decalage = 0;
  for (const { nom, octets } of fichiers) {
    const n = Buffer.from(nom, "utf8");
    const somme = crc32(octets);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt32LE(somme, 14);
    local.writeUInt32LE(octets.length, 18);
    local.writeUInt32LE(octets.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(somme, 16);
    central.writeUInt32LE(octets.length, 20);
    central.writeUInt32LE(octets.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(decalage, 42);
    locaux.push(local, n, octets);
    centraux.push(central, n);
    decalage += 30 + n.length + octets.length;
  }
  const taille = centraux.reduce((s, b) => s + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(fichiers.length, 8);
  fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(taille, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, ...centraux, fin]);
}
