import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

/**
 * Glisser-déposer dans l'arbre des pages, façon explorateur de fichiers.
 *
 * Selon l'endroit où l'on survole une ligne :
 * — son bord HAUT ou BAS : la page se range À CÔTÉ (même parent que la ligne) ;
 * — son MILIEU : la page se range DEDANS, comme dernière sous-page.
 * Survoler un moment une page repliée la déplie, pour atteindre ses sous-pages
 * — la « petite flèche » demandée pendant la recette du 11/09.
 *
 * Suivi à la souris (pas de glisser-déposer HTML, qui se disputait les
 * événements avec Tauri) ; seuil de 4 px pour qu'un clic reste un clic.
 */

/** Où la page atterrirait : sous `parentId`, juste avant `avantId` (null = en fin). */
export interface DepotArbre {
  parentId: string | null;
  avantId: string | null;
}

/** Ce que l'arbre doit dessiner pendant le geste. */
export type Repere =
  | { type: "ligne"; ancreId: string; cote: "avant" | "apres" }
  | { type: "dans"; id: string }
  | { type: "fin" };

interface Options {
  onDeposer: (id: string, depot: DepotArbre) => void;
  /** Vrai si `cibleId` est la page déplacée ou l'une de ses descendantes : dépôt impossible. */
  estInterdit: (sourceId: string, cibleId: string) => boolean;
  /** Sœur qui suit `id` dans l'ordre d'affichage, hors page déplacée, pour « ranger juste après ». */
  soeurSuivante: (id: string, exclure: string) => string | null;
  /** Survol prolongé d'une page : l'arbre la déplie si elle a des sous-pages. */
  onSurvolProlonge: (id: string) => void;
}

const SEUIL_PX = 4;
const DELAI_DEPLIAGE_MS = 650;

export function useDragArbre(options: Options) {
  const [enCours, setEnCours] = useState<string | null>(null);
  const [repere, setRepere] = useState<Repere | null>(null);
  const suivi = useRef<{ id: string; x: number; y: number; actif: boolean; depot: DepotArbre | null } | null>(null);
  const survol = useRef<{ id: string; minuterie: number } | null>(null);
  const ignorerClic = useRef(false);
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    const oublierSurvol = () => {
      if (survol.current) window.clearTimeout(survol.current.minuterie);
      survol.current = null;
    };

    const terminer = (appliquer: boolean) => {
      const s = suivi.current;
      suivi.current = null;
      oublierSurvol();
      if (!s) return;
      if (s.actif) {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        if (appliquer && s.depot) opts.current.onDeposer(s.id, s.depot);
        // Le clic qui suit le relâchement ne doit pas ouvrir la page lâchée.
        ignorerClic.current = true;
        window.setTimeout(() => (ignorerClic.current = false), 0);
      }
      setEnCours(null);
      setRepere(null);
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

      const lignes = [...document.querySelectorAll<HTMLElement>("[data-arbre-id]")];
      let depot: DepotArbre | null = null;
      let nouveau: Repere | null = null;
      let survolee: string | null = null;

      const touchee = lignes.find((el) => {
        const r = el.getBoundingClientRect();
        return e.clientY >= r.top && e.clientY <= r.bottom;
      });

      if (touchee) {
        const cible = touchee.dataset.arbreId!;
        const parent = touchee.dataset.arbreParent || null;
        if (cible !== s.id && !opts.current.estInterdit(s.id, cible)) {
          const r = touchee.getBoundingClientRect();
          const f = (e.clientY - r.top) / r.height;
          if (f < 0.28) {
            depot = { parentId: parent, avantId: cible };
            nouveau = { type: "ligne", ancreId: cible, cote: "avant" };
          } else if (f > 0.72) {
            // Page dépliée : juste sous elle, visuellement, c'est sa première
            // sous-page — pas la sœur qui suit tout son sous-arbre.
            const sousPages = touchee.dataset.arbreEnfants?.split(",").filter(Boolean) ?? [];
            if (sousPages.length) {
              // La page déplacée peut être elle-même cette première sous-page.
              depot = { parentId: cible, avantId: sousPages.find((p) => p !== s.id) ?? null };
              nouveau = { type: "ligne", ancreId: sousPages[0], cote: "avant" };
            } else {
              depot = { parentId: parent, avantId: opts.current.soeurSuivante(cible, s.id) };
              nouveau = { type: "ligne", ancreId: cible, cote: "apres" };
            }
          } else {
            depot = { parentId: cible, avantId: null };
            nouveau = { type: "dans", id: cible };
            survolee = cible;
          }
        }
      } else if (lignes.length && e.clientY > lignes[lignes.length - 1].getBoundingClientRect().bottom) {
        // Sous la dernière ligne : fin de la liste des pages racines.
        depot = { parentId: null, avantId: null };
        nouveau = { type: "fin" };
      }

      s.depot = depot;
      setRepere(nouveau);

      // Survol prolongé du milieu d'une page : on la déplie.
      if (survolee !== survol.current?.id) {
        oublierSurvol();
        if (survolee) {
          const id = survolee;
          survol.current = { id, minuterie: window.setTimeout(() => opts.current.onSurvolProlonge(id), DELAI_DEPLIAGE_MS) };
        }
      }
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
      oublierSurvol();
    };
  }, []);

  /**
   * Propriétés à poser sur une ligne de l'arbre. `sousPagesVisibles` : ses
   * sous-pages dans l'ordre quand elle est dépliée (sinon rien).
   */
  const poignee = useCallback(
    (id: string, parentId: string | null, sousPagesVisibles: string[] = []) => ({
      "data-arbre-id": id,
      "data-arbre-parent": parentId ?? "",
      "data-arbre-enfants": sousPagesVisibles.join(","),
      onPointerDown: (e: PointerEvent) => {
        if (e.button !== 0) return;
        // Les boutons de la ligne (déplier, supprimer) gardent leur comportement.
        if ((e.target as HTMLElement).closest("button, input")) return;
        suivi.current = { id, x: e.clientX, y: e.clientY, actif: false, depot: null };
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

  return { poignee, enCours, repere };
}
