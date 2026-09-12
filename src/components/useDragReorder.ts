import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

/**
 * Réordonnancement d'une liste au geste, pour la barre latérale.
 *
 * Suivi à la souris plutôt que par le glisser-déposer HTML : c'est ce qui a fini
 * par fonctionner de façon fiable pour les images et les tableaux, là où le
 * mécanisme natif se disputait les événements avec Tauri. Le glissement ne
 * commence qu'au-delà de quelques pixels, pour qu'un clic reste un clic et un
 * double-clic un renommage.
 */

/** Où la ligne tomberait : avant l'élément `avantId`, ou en fin de groupe si `null`. */
export interface Indicateur {
  groupe: string;
  avantId: string | null;
}

const SEUIL_PX = 4;

interface Suivi {
  id: string;
  groupe: string;
  x: number;
  y: number;
  actif: boolean;
  vers: number;
}

export function useDragReorder(onDeplacer: (id: string, groupe: string, vers: number) => void) {
  const [enCours, setEnCours] = useState<string | null>(null);
  const [indicateur, setIndicateur] = useState<Indicateur | null>(null);
  const suivi = useRef<Suivi | null>(null);
  const ignorerClic = useRef(false);
  const rappel = useRef(onDeplacer);
  rappel.current = onDeplacer;

  useEffect(() => {
    const terminer = (appliquer: boolean) => {
      const s = suivi.current;
      suivi.current = null;
      if (!s) return;
      if (s.actif) {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        if (appliquer) rappel.current(s.id, s.groupe, s.vers);
        // Le clic qui suit le relâchement ne doit pas ouvrir la page lâchée. Il est
        // émis juste après `pointerup`, avant tout minuteur : on ne l'ignore donc
        // que le temps de ce tour, sinon on avalerait le prochain vrai clic.
        ignorerClic.current = true;
        window.setTimeout(() => (ignorerClic.current = false), 0);
      }
      setEnCours(null);
      setIndicateur(null);
    };

    const bouger = (e: globalThis.PointerEvent) => {
      const s = suivi.current;
      if (!s) return;
      if (!s.actif) {
        if (Math.abs(e.clientX - s.x) < SEUIL_PX && Math.abs(e.clientY - s.y) < SEUIL_PX) return;
        s.actif = true;
        setEnCours(s.id);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }

      // Place parmi les AUTRES lignes du groupe : on s'insère avant la première
      // dont le milieu est sous le pointeur.
      const autres = [...document.querySelectorAll<HTMLElement>("[data-reorder-groupe]")].filter(
        (el) => el.dataset.reorderGroupe === s.groupe && el.dataset.reorderId !== s.id
      );
      let vers = autres.length;
      for (let i = 0; i < autres.length; i++) {
        const r = autres[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) {
          vers = i;
          break;
        }
      }
      s.vers = vers;
      setIndicateur({ groupe: s.groupe, avantId: autres[vers]?.dataset.reorderId ?? null });
    };

    const relacher = () => terminer(true);
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape" && suivi.current?.actif) terminer(false);
    };

    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", relacher);
    window.addEventListener("pointercancel", relacher);
    window.addEventListener("keydown", touche);
    return () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", relacher);
      window.removeEventListener("pointercancel", relacher);
      window.removeEventListener("keydown", touche);
    };
  }, []);

  /** Propriétés à poser sur une ligne déplaçable. */
  const poignee = useCallback(
    (id: string, groupe: string) => ({
      "data-reorder-id": id,
      "data-reorder-groupe": groupe,
      onPointerDown: (e: PointerEvent) => {
        if (e.button !== 0) return;
        // Les boutons de la ligne (déplier, supprimer) et le champ de renommage
        // gardent leur comportement.
        if ((e.target as HTMLElement).closest("button, input")) return;
        suivi.current = { id, groupe, x: e.clientX, y: e.clientY, actif: false, vers: 0 };
      },
      onClickCapture: (e: MouseEvent) => {
        if (!ignorerClic.current) return;
        ignorerClic.current = false;
        e.stopPropagation();
        e.preventDefault();
      },
    }),
    []
  );

  return { poignee, enCours, indicateur };
}
