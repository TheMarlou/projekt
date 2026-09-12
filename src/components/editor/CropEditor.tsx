import { useRef, useState } from "react";
import { clampCrop, type Crop } from "../../lib/crop";

/** Poignées de la zone gardée : chaque coin déplace deux bords à la fois. */
const CORNERS = [
  { key: "nw", dx: -1, dy: -1 },
  { key: "ne", dx: 1, dy: -1 },
  { key: "sw", dx: -1, dy: 1 },
  { key: "se", dx: 1, dy: 1 },
] as const;

interface CropEditorProps {
  src: string;
  /** Largeur d'affichage de l'image entière pendant le réglage. */
  width: number;
  value: Crop;
  onChange: (crop: Crop) => void;
}

/**
 * Réglage de la zone gardée : on affiche l'image ENTIÈRE, assombrie hors de la
 * zone, avec un cadre déplaçable. Montrer l'image entière est le seul moyen de
 * choisir ce qu'on garde — un aperçu déjà rogné ne le permettrait pas.
 */
export default function CropEditor({ src, width, value, onChange }: CropEditorProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const height = ratio ? width * ratio : null;

  const suivre = (
    event: React.PointerEvent,
    calcul: (dxFraction: number, dyFraction: number, depart: Crop) => Crop
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const box = boxRef.current;
    if (!box || !height) return;
    const rect = box.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const depart = value;

    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - startX) / rect.width;
      const dy = (e.clientY - startY) / rect.height;
      onChange(clampCrop(calcul(dx, dy, depart)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const deplacer = (e: React.PointerEvent) =>
    suivre(e, (dx, dy, d) => ({ ...d, x: d.x + dx, y: d.y + dy }));

  const redimensionner = (e: React.PointerEvent, dx: number, dy: number) =>
    suivre(e, (fx, fy, d) => {
      // Un coin « nord » ou « ouest » déplace l'origine autant qu'il change la taille.
      const w = dx < 0 ? d.w - fx : d.w + fx;
      const h = dy < 0 ? d.h - fy : d.h + fy;
      return {
        x: dx < 0 ? d.x + fx : d.x,
        y: dy < 0 ? d.y + fy : d.y,
        w,
        h,
      };
    });

  return (
    <div
      ref={boxRef}
      className="pk-crop-box"
      style={{ width, height: height ?? undefined }}
      // On coupe les DEUX familles d'événements : les vues autour écoutent tantôt
      // « pointerdown », tantôt « mousedown », et arrêter l'un ne fait rien à l'autre.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <img
        src={src}
        draggable={false}
        onLoad={(e) => {
          const el = e.currentTarget;
          setRatio(el.naturalHeight / el.naturalWidth);
        }}
        style={{ width: "100%", display: "block" }}
      />

      {height && (
        <>
          {/* Voile sombre : tout ce qui sera coupé, en un seul élément évidé. */}
          <div
            className="pk-crop-shade"
            style={{
              clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${pct(value.x)} ${pct(
                value.y
              )}, ${pct(value.x)} ${pct(value.y + value.h)}, ${pct(value.x + value.w)} ${pct(
                value.y + value.h
              )}, ${pct(value.x + value.w)} ${pct(value.y)}, ${pct(value.x)} ${pct(value.y)})`,
            }}
          />
          <div
            className="pk-crop-rect"
            onPointerDown={deplacer}
            style={{
              left: pct(value.x),
              top: pct(value.y),
              width: pct(value.w),
              height: pct(value.h),
            }}
          >
            {CORNERS.map((c) => (
              <span
                key={c.key}
                className="pk-crop-handle"
                onPointerDown={(e) => redimensionner(e, c.dx, c.dy)}
                style={{
                  left: c.dx < 0 ? -5 : undefined,
                  right: c.dx > 0 ? -5 : undefined,
                  top: c.dy < 0 ? -5 : undefined,
                  bottom: c.dy > 0 ? -5 : undefined,
                  cursor: c.dx === c.dy ? "nwse-resize" : "nesw-resize",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function pct(v: number): string {
  return `${(v * 100).toFixed(3)}%`;
}
