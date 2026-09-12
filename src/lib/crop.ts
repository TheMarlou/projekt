/**
 * Rognage NON destructif : on ne découpe jamais le fichier, on mémorise la zone
 * visible en fractions de l'image d'origine. Le fichier étant partagé entre le
 * moodboard et les pages (une image envoyée vers une note pointe le même asset),
 * un rognage destructif modifierait toutes les occurrences d'un coup.
 */
export interface Crop {
  /** Coin haut-gauche de la zone gardée, en fraction de la largeur/hauteur. */
  x: number;
  y: number;
  /** Taille de la zone gardée, en fraction. 1 = image entière. */
  w: number;
  h: number;
}

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };

/** Taille minimale d'une zone gardée, pour éviter les rognages dégénérés. */
const MIN_FRACTION = 0.05;

export function isFullCrop(crop: Crop | null | undefined): boolean {
  return !crop || (crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1);
}

/** Relit une valeur venue du document ou de la base, sans lui faire confiance. */
export function parseCrop(value: unknown): Crop | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, w, h } = value as Partial<Crop>;
  const nombres = [x, y, w, h];
  if (nombres.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  const crop = clampCrop({ x: x as number, y: y as number, w: w as number, h: h as number });
  return isFullCrop(crop) ? null : crop;
}

/** Ramène une zone dans les limites de l'image et lui impose une taille minimale. */
export function clampCrop(crop: Crop): Crop {
  const w = Math.min(1, Math.max(MIN_FRACTION, crop.w));
  const h = Math.min(1, Math.max(MIN_FRACTION, crop.h));
  return {
    w,
    h,
    x: Math.min(1 - w, Math.max(0, crop.x)),
    y: Math.min(1 - h, Math.max(0, crop.y)),
  };
}

export interface CropLayout {
  /** Dimensions du cadre visible. */
  frameWidth: number;
  frameHeight: number;
  /** Dimensions et décalage de l'image à l'intérieur du cadre. */
  imageWidth: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Traduit une zone en positionnement CSS : on agrandit l'image puis on la décale
 * derrière un cadre qui masque le reste. Aucun retraitement du fichier.
 */
export function cropLayout(
  crop: Crop,
  frameWidth: number,
  natural: { width: number; height: number }
): CropLayout {
  const imageWidth = frameWidth / crop.w;
  const imageHeight = imageWidth * (natural.height / natural.width);
  return {
    frameWidth,
    frameHeight: imageHeight * crop.h,
    imageWidth,
    offsetX: -crop.x * imageWidth,
    offsetY: -crop.y * imageHeight,
  };
}
