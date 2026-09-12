import type { Crop } from "./crop";

/**
 * Préparation d'une image pour le modèle de vision.
 *
 * — On respecte le ROGNAGE : si l'utilisateur a isolé une partie de l'image,
 *   c'est cette partie qui l'intéresse, pas le reste.
 * — On réduit à 1024 px au plus : le modèle redimensionne de toute façon
 *   (gemma3 travaille en 896 px), inutile de lui envoyer plusieurs mégaoctets.
 *
 * Renvoie le base64 d'un JPEG, sans préfixe `data:` — le format qu'attend Ollama.
 */
export async function preparerImage(src: string, crop: Crop | null, cote = 1024): Promise<string> {
  const img = await charger(src);
  const zone = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = zone.x * img.naturalWidth;
  const sy = zone.y * img.naturalHeight;
  const sw = zone.w * img.naturalWidth;
  const sh = zone.h * img.naturalHeight;

  const echelle = Math.min(1, cote / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * echelle));
  canvas.height = Math.max(1, Math.round(sh * echelle));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Impossible de préparer l'image.");
  // Fond blanc : un PNG transparent deviendrait noir en JPEG, et le modèle
  // décrirait un fond qui n'existe pas.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88).replace(/^data:[^;]+;base64,/, "");
}

function charger(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible."));
    img.src = src;
  });
}
