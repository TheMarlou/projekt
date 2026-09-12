import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Block } from "../../store/blocksStore";
import { useCarteStore, type LienCarte } from "../../store/carteStore";
import { chatJson, checkOllamaAvailable } from "../../lib/ollama";
import {
  demandeSuggestions,
  lirePropositions,
  paire,
  SCHEMA_SUGGESTIONS,
  texteDePage,
  type PropositionLien,
} from "../../lib/suggestionsLiens";
import {
  ancetreVisible,
  branche,
  bulleSous,
  construireCarte,
  courbeArbre,
  courbeLien,
  courbeMention,
  limites,
  PALETTE_LIENS,
  RACINE,
  titreCourt,
  type Noeud,
} from "../../lib/carteMentale";

/**
 * Carte mentale du projet (refonte spécifiée avec l'utilisateur le 11/09).
 * Étape 1 : disposition radiale en direct, zoom, déplacement, replis, aperçu.
 * Étape 2 : bulles placées à la main (décalage retenu en base, v6), création
 * et renommage depuis la carte, rangement d'une bulle en la lâchant sur une autre.
 * À venir : liens tracés à la main (3), liens proposés par l'IA (4).
 */

interface GraphViewProps {
  blocks: Block[];
  projectId: string;
  projectName: string;
  onOpenBlock: (id: string) => void;
  /** Crée une page (sous `parentId`, ou à la racine) et renvoie son identifiant. */
  onCreatePage: (parentId: string | null) => string;
  onRenamePage: (id: string, titre: string) => void;
  onRenameProject: (nom: string) => void;
  onMovePage: (id: string, parentId: string | null, avantId: string | null) => boolean;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const SEUIL_GLISSER = 4;

/** Branches repliées, retenues par projet (confort d'affichage, pas une donnée). */
function lireReplies(projectId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`projekt.carte.replies.${projectId}`) ?? "[]"));
  } catch {
    return new Set();
  }
}
function ecrireReplies(projectId: string, replies: Set<string>) {
  try {
    localStorage.setItem(`projekt.carte.replies.${projectId}`, JSON.stringify([...replies]));
  } catch {
    /* stockage indisponible : le repli vaut pour la session */
  }
}

/** Dernière couleur choisie pour un lien : le prochain la reprend. */
function lireCouleur(): string {
  try {
    return localStorage.getItem("projekt.carte.couleur") ?? PALETTE_LIENS[5].valeur;
  } catch {
    return PALETTE_LIENS[5].valeur;
  }
}
function ecrireCouleur(c: string) {
  try {
    localStorage.setItem("projekt.carte.couleur", c);
  } catch {
    /* rien : simple confort */
  }
}

/** Un trait de la carte hors arbre et mentions : ton lien, un lien de l'IA gardé, ou une proposition en attente. */
interface TraitCarte {
  cle: string;
  a: string; // bulles affichées
  b: string;
  rang: number;
  type: "humain" | "ia" | "proposition";
  lien?: LienCarte;
  proposition?: number; // indice dans la liste des propositions
}

/** État de « ✦ Suggérer des liens ». */
interface Suggestion {
  etat: "recherche" | "pret" | "erreur";
  propositions: PropositionLien[];
  message?: string;
  debut: number;
  gardes: number;
}

/** Lien en train d'être tiré depuis la poignée ● d'une bulle. */
interface TraceLien {
  de: string;
  x: number;
  y: number;
  cible: string | null;
}

/** Une bulle en train d'être glissée : sa branche suit, `cible` est la bulle survolée pour y ranger. */
interface GlisseBulle {
  id: string;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  bouge: boolean;
  cible: string | null;
}

export default function GraphView({
  blocks,
  projectId,
  projectName,
  onOpenBlock,
  onCreatePage,
  onRenamePage,
  onRenameProject,
  onMovePage,
}: GraphViewProps) {
  const [replies, setReplies] = useState<Set<string>>(() => lireReplies(projectId));
  const [vue, setVue] = useState({ x: 0, y: 0, k: 1 });
  const [selection, setSelection] = useState<string | null>(null);
  const [survol, setSurvol] = useState<{ id: string; x: number; y: number } | null>(null);
  const [glisseBulle, setGlisseBulle] = useState<GlisseBulle | null>(null);
  const [edition, setEdition] = useState<{ id: string; valeur: string } | null>(null);
  const [confirmerReorg, setConfirmerReorg] = useState(false);
  const [trace, setTrace] = useState<TraceLien | null>(null);
  const traceRef = useRef<TraceLien | null>(null);
  const [lienEdite, setLienEdite] = useState<string | null>(null);
  const [couleur, setCouleur] = useState(lireCouleur);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [propSurvol, setPropSurvol] = useState<number | null>(null);
  const arretSuggestion = useRef<AbortController | null>(null);
  const [, setTic] = useState(0);
  const cadre = useRef<HTMLDivElement>(null);
  const glisse = useRef<{ x: number; y: number; ox: number; oy: number; bouge: boolean } | null>(null);
  const glisseRef = useRef<GlisseBulle | null>(null);
  const aPlacer = useRef<{ id: string; x: number; y: number } | null>(null);
  const recadree = useRef(false);

  const decalages = useCarteStore((s) => s.decalages);
  const tousLesLiens = useCarteStore((s) => s.liens);
  const { deplacer, oublier, reorganiser, ajouterLien, modifierLien, supprimerLien } = useCarteStore.getState();
  const carte = useMemo(
    () => construireCarte(blocks, projectName, replies, decalages),
    [blocks, projectName, replies, decalages]
  );
  const pages = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const aDesDecalages = blocks.some((b) => b.id in decalages);

  // Tes liens, rattachés aux bulles affichées (une page cachée par un repli est
  // représentée par sa branche repliée).
  const traits = useMemo(() => {
    const bruts: (Omit<TraitCarte, "a" | "b" | "rang"> & { de: string; vers: string })[] = [];
    for (const lien of tousLesLiens) {
      if (lien.projectId !== projectId || lien.type === "ia_rejete") continue;
      bruts.push({ cle: lien.id, type: lien.type, lien, de: lien.de, vers: lien.vers });
    }
    suggestion?.propositions.forEach((p, i) =>
      bruts.push({ cle: `prop:${i}`, type: "proposition", proposition: i, de: p.de, vers: p.vers })
    );
    const vus = new Map<string, number>();
    const sortie: TraitCarte[] = [];
    for (const { de, vers, ...t } of bruts) {
      const a = ancetreVisible(carte.noeuds, pages, de);
      const b = ancetreVisible(carte.noeuds, pages, vers);
      if (!a || !b || a === b) continue;
      // Rang parmi les traits qui relient déjà ces deux bulles, dans un sens ou dans l'autre.
      const cle = paire(a, b);
      const rang = vus.get(cle) ?? 0;
      vus.set(cle, rang + 1);
      sortie.push({ ...t, a, b, rang });
    }
    return sortie;
  }, [tousLesLiens, projectId, carte, pages, suggestion?.propositions]);

  const basculer = (id: string, ouvrir?: boolean) => {
    setReplies((prev) => {
      if (ouvrir && !prev.has(id)) return prev;
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      ecrireReplies(projectId, next);
      return next;
    });
  };

  // Toute la carte dans le cadre, sans dépasser 110 % : une petite carte n'a pas
  // à s'afficher en géant.
  const recadrer = useCallback(() => {
    const el = cadre.current;
    if (!el || carte.noeuds.size === 0) return;
    const { minX, minY, maxX, maxY } = limites(carte.noeuds.values());
    const marge = 60;
    const k = Math.min(
      1.1,
      Math.max(ZOOM_MIN, Math.min((el.clientWidth - marge * 2) / (maxX - minX || 1), (el.clientHeight - marge * 2) / (maxY - minY || 1)))
    );
    setVue({
      k,
      x: el.clientWidth / 2 - ((minX + maxX) / 2) * k,
      y: el.clientHeight / 2 - ((minY + maxY) / 2) * k,
    });
  }, [carte]);

  // Recadrage à l'ouverture, dès que le cadre a une taille : mesurée trop tôt
  // (vue encore masquée, mise en page pas finie), elle vaut 0 et la carte
  // restait collée en haut à gauche.
  const recadrerRef = useRef(recadrer);
  recadrerRef.current = recadrer;
  useLayoutEffect(() => {
    const el = cadre.current;
    if (!el) return;
    const essayer = () => {
      if (recadree.current || el.clientWidth === 0 || el.clientHeight === 0) return;
      recadree.current = true;
      recadrerRef.current();
    };
    essayer();
    const obs = new ResizeObserver(essayer);
    obs.observe(el);
    return () => obs.disconnect();
    // Le cadre n'existe pas tant que le projet n'a aucune page : on réessaie à la première.
  }, [blocks.length === 0]);

  // Molette : zoom autour du pointeur. Écouteur natif non passif, sinon le
  // navigateur refuse `preventDefault` et la page défilerait en plus.
  useEffect(() => {
    const el = cadre.current;
    if (!el) return;
    const surMolette = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      setVue((v) => {
        const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * (e.deltaY > 0 ? 0.9 : 1.1)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", surMolette, { passive: false });
    return () => el.removeEventListener("wheel", surMolette);
  }, [blocks.length === 0]);

  // Échap désélectionne (ou annule le glissement), Entrée ouvre la page sélectionnée.
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      // La cible n'est pas toujours un élément (touche reçue par la fenêtre elle-même).
      if (e.target instanceof Element && e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Escape") {
        if (traceRef.current) {
          traceRef.current = null;
          setTrace(null);
        } else if (glisseRef.current) {
          glisseRef.current = null;
          setGlisseBulle(null);
        } else if (lienEdite) setLienEdite(null);
        else setSelection(null);
      }
      if (e.key === "Enter" && selection && selection !== RACINE) onOpenBlock(selection);
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [selection, onOpenBlock, lienEdite]);

  // Une page supprimée ou cachée par un repli ne reste pas sélectionnée.
  useEffect(() => {
    if (selection && !carte.noeuds.has(selection)) setSelection(null);
  }, [carte, selection]);

  // Page créée par double-clic sur le fond : une fois placée automatiquement, on
  // la décale jusqu'à l'endroit du clic.
  useEffect(() => {
    const p = aPlacer.current;
    if (!p) return;
    const n = carte.noeuds.get(p.id);
    if (!n) return;
    aPlacer.current = null;
    deplacer(p.id, projectId, { dx: p.x - n.x, dy: p.y - n.y });
  }, [carte, deplacer, projectId]);

  /** Point de l'écran → point de la carte. */
  const versCarte = (clientX: number, clientY: number) => {
    const r = cadre.current!.getBoundingClientRect();
    return { x: (clientX - r.left - vue.x) / vue.k, y: (clientY - r.top - vue.y) / vue.k };
  };

  // --- Glisser le fond : déplacer la vue. Un simple clic sur le fond désélectionne.
  const surAppui = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-bulle]") && e.button === 0) return;
    glisse.current = { x: e.clientX, y: e.clientY, ox: vue.x, oy: vue.y, bouge: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const surDeplacement = (e: React.PointerEvent) => {
    const g = glisse.current;
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.bouge && Math.hypot(dx, dy) < SEUIL_GLISSER) return;
    g.bouge = true;
    setSurvol(null);
    setVue((v) => ({ ...v, x: g.ox + dx, y: g.oy + dy }));
  };
  const surRelache = () => {
    if (glisse.current && !glisse.current.bouge) {
      setSelection(null);
      setLienEdite(null);
    }
    glisse.current = null;
  };

  // --- Glisser une bulle : la placer, ou la ranger dans une autre en la lâchant dessus.
  const vueRef = useRef(vue);
  vueRef.current = vue;
  const carteRef = useRef(carte);
  carteRef.current = carte;
  useEffect(() => {
    const bouger = (e: PointerEvent) => {
      const t = traceRef.current;
      if (t) {
        const r = cadre.current!.getBoundingClientRect();
        const v = vueRef.current;
        const x = (e.clientX - r.left - v.x) / v.k, y = (e.clientY - r.top - v.y) / v.k;
        // Cible : une page (pas le projet, pas la bulle de départ).
        const sous = bulleSous(carteRef.current, x, y, new Set([t.de, RACINE]));
        const suivant = { ...t, x, y, cible: sous?.id ?? null };
        traceRef.current = suivant;
        setTrace(suivant);
        return;
      }
      const g = glisseRef.current;
      if (!g) return;
      const k = vueRef.current.k;
      const dx = (e.clientX - g.cx) / k, dy = (e.clientY - g.cy) / k;
      if (!g.bouge && Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < SEUIL_GLISSER) return;
      const c = carteRef.current;
      const n = c.noeuds.get(g.id)!;
      // La bulle sous le pointeur, hors de la branche qu'on déplace (on ne range
      // pas une page dans ses propres sous-pages).
      const sous = bulleSous(c, n.x + dx, n.y + dy, branche(c, g.id));
      const suivant = { ...g, dx, dy, bouge: true, cible: sous?.id ?? null };
      glisseRef.current = suivant;
      setGlisseBulle(suivant);
      setSurvol(null);
    };
    const lacher = () => {
      const t = traceRef.current;
      if (t) {
        traceRef.current = null;
        setTrace(null);
        if (!t.cible) return;
        // Toujours un NOUVEAU lien, même entre pages déjà reliées : une relation
        // n'est pas forcément réciproque (« ami » dans un sens, « ennemi » dans
        // l'autre — sa demande du 11/09). Un lien existant se rouvre d'un clic.
        const id = ajouterLien({ projectId, de: t.de, vers: t.cible, type: "humain", couleur, etiquette: "", raison: "" });
        setSelection(null);
        setLienEdite(id);
        return;
      }
      const g = glisseRef.current;
      glisseRef.current = null;
      setGlisseBulle(null);
      if (!g?.bouge) return;
      const c = carteRef.current;
      const n = c.noeuds.get(g.id);
      if (!n) return;
      if (g.cible) {
        const nouveauParent = g.cible === RACINE ? null : g.cible;
        // Lâchée sur son propre parent : elle retourne simplement à sa place.
        if (nouveauParent !== pages.get(g.id)?.parentId) {
          onMovePage(g.id, nouveauParent, null);
          if (nouveauParent) basculer(nouveauParent, true);
        }
        oublier([g.id]);
      } else {
        const actuel = decalages[g.id] ?? { dx: 0, dy: 0 };
        deplacer(g.id, projectId, { dx: actuel.dx + g.dx, dy: actuel.dy + g.dy });
      }
    };
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
    window.addEventListener("pointercancel", lacher);
    return () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      window.removeEventListener("pointercancel", lacher);
    };
  });

  const commencerLien = (de: string, e: React.PointerEvent) => {
    const p = versCarte(e.clientX, e.clientY);
    const t = { de, x: p.x, y: p.y, cible: null };
    traceRef.current = t;
    setTrace(t);
    setSurvol(null);
    setLienEdite(null);
  };

  const commencerGlisser = (id: string, e: React.PointerEvent) => {
    if (id === RACINE) return; // le projet reste au centre : c'est la vue qu'on déplace
    const g = { id, cx: e.clientX, cy: e.clientY, dx: 0, dy: 0, bouge: false, cible: null };
    glisseRef.current = g;
  };

  // --- Création et renommage.
  const nouvellePage = (parentId: string | null, a?: { x: number; y: number }) => {
    const id = onCreatePage(parentId);
    if (parentId) basculer(parentId, true);
    if (a) aPlacer.current = { id, ...a };
    setSelection(id);
    setEdition({ id, valeur: "" });
  };

  const validerEdition = () => {
    if (!edition) return;
    const titre = edition.valeur.trim();
    if (edition.id === RACINE) {
      if (titre && titre !== projectName) onRenameProject(titre);
    } else if (titre !== (pages.get(edition.id)?.title ?? "")) {
      onRenamePage(edition.id, titre);
    }
    setEdition(null);
  };

  // --- « ✦ Suggérer des liens » : l'IA propose, l'utilisateur garde ou rejette.
  useEffect(() => {
    if (suggestion?.etat !== "recherche") return;
    const t = window.setInterval(() => setTic((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [suggestion?.etat]);
  useEffect(() => () => arretSuggestion.current?.abort(), []);

  const suggerer = async () => {
    arretSuggestion.current?.abort();
    const controleur = new AbortController();
    arretSuggestion.current = controleur;
    const erreur = (message: string) =>
      setSuggestion({ etat: "erreur", propositions: [], message, debut: Date.now(), gardes: 0 });

    const titreDe = (id: string) => pages.get(id)?.title;
    if (blocks.filter((p) => texteDePage(p, titreDe).length > 20).length < 2) {
      return erreur("Écris un peu dans au moins deux pages : l'IA s'appuie sur leur contenu pour trouver des liens.");
    }
    setSuggestion({ etat: "recherche", propositions: [], debut: Date.now(), gardes: 0 });
    setLienEdite(null);

    const disponible = await checkOllamaAvailable();
    if (!disponible.ok) {
      return erreur("L'IA locale (Ollama) ne répond pas. Lance-la, puis réessaie.");
    }
    // Paires à ne pas reproposer : l'arbre, les mentions, tes liens, ceux de
    // l'IA déjà gardés… et ceux qu'il a déjà rejetés.
    const deja = new Set<string>();
    for (const p of blocks) if (p.parentId) deja.add(paire(p.id, p.parentId));
    for (const l of carte.liens) if (l.type === "mention") deja.add(paire(l.de, l.vers));
    for (const l of tousLesLiens) if (l.projectId === projectId) deja.add(paire(l.de, l.vers));

    try {
      const reponse = await chatJson(demandeSuggestions(blocks, projectName, deja), SCHEMA_SUGGESTIONS, controleur.signal);
      const propositions = lirePropositions(reponse, blocks, deja);
      setSuggestion({ etat: "pret", propositions, debut: Date.now(), gardes: 0 });
    } catch (err) {
      if (controleur.signal.aborted) return;
      erreur(`L'IA n'a pas pu répondre : ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const deciderProposition = (i: number, garder: boolean) => {
    if (!suggestion) return;
    const p = suggestion.propositions[i];
    if (!p) return;
    // Même rejeté, le lien est enregistré (« ia_rejete ») : c'est ce qui empêche l'IA de le reproposer.
    ajouterLien({ projectId, de: p.de, vers: p.vers, type: garder ? "ia" : "ia_rejete", couleur: null, etiquette: "", raison: p.raison });
    setPropSurvol(null);
    setSuggestion({
      ...suggestion,
      propositions: suggestion.propositions.filter((_, j) => j !== i),
      gardes: suggestion.gardes + (garder ? 1 : 0),
    });
  };

  const toutDecider = (garder: boolean) => {
    if (!suggestion) return;
    for (const p of suggestion.propositions) {
      ajouterLien({ projectId, de: p.de, vers: p.vers, type: garder ? "ia" : "ia_rejete", couleur: null, etiquette: "", raison: p.raison });
    }
    setPropSurvol(null);
    setSuggestion({ ...suggestion, propositions: [], gardes: suggestion.gardes + (garder ? suggestion.propositions.length : 0) });
  };

  // Positions AFFICHÉES : la branche glissée suit le pointeur.
  const enDeplacement = useMemo(
    () => (glisseBulle?.bouge ? branche(carte, glisseBulle.id) : null),
    [carte, glisseBulle?.id, glisseBulle?.bouge]
  );
  const affiche = (n: Noeud): Noeud =>
    enDeplacement?.has(n.id) && glisseBulle ? { ...n, x: n.x + glisseBulle.dx, y: n.y + glisseBulle.dy } : n;

  const noeudSel = selection ? carte.noeuds.get(selection) : undefined;
  const lies = useMemo(() => {
    if (!selection) return null;
    const s = new Set([selection]);
    for (const l of [...carte.liens, ...traits.filter((t) => t.type !== "proposition").map(({ a, b }) => ({ de: a, vers: b }))]) {
      if (l.de === selection) s.add(l.vers);
      if (l.vers === selection) s.add(l.de);
    }
    return s;
  }, [selection, carte, traits]);
  const lienOuvert = lienEdite ? traits.find((t) => t.lien?.id === lienEdite) : undefined;
  const nbMentions = carte.liens.filter((l) => l.type === "mention").length;
  const noeudEdite = edition ? carte.noeuds.get(edition.id) : undefined;

  if (blocks.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--text-dim)", fontSize: 13, padding: 24, textAlign: "center" }}>
        La carte se dessine à partir de tes pages, autour de « {projectName || "ton projet"} ».
        <button onClick={() => nouvellePage(null)} style={boutonAccent}>
          + Créer une première page
        </button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={barre}>
        {suggestion?.etat === "recherche" ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-dim)" }}>
            <span className="pk-ia-pulse">●</span> L'IA lit tes pages… {Math.max(0, Math.round((Date.now() - suggestion.debut) / 1000))} s
            <button
              onClick={() => {
                arretSuggestion.current?.abort();
                setSuggestion(null);
              }}
              style={bouton}
            >
              Annuler
            </button>
          </span>
        ) : (
          <button
            onClick={suggerer}
            title="L'IA lit tes pages et propose des liens entre elles ; tu gardes ou rejettes chacun."
            style={boutonAccent}
          >
            ✦ Suggérer des liens
          </button>
        )}
        <button onClick={recadrer} title="Afficher toute la carte" style={bouton}>
          ⤢ Recentrer
        </button>
        {aDesDecalages &&
          (confirmerReorg ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              Remettre toutes les bulles à leur place ?
              <button
                onClick={() => {
                  reorganiser(projectId);
                  setConfirmerReorg(false);
                }}
                style={boutonAccent}
              >
                Oui
              </button>
              <button onClick={() => setConfirmerReorg(false)} style={bouton}>
                Non
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmerReorg(true)} title="Oublier les bulles placées à la main" style={bouton}>
              ⟲ Réorganiser
            </button>
          ))}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: 8, fontSize: 11.5, color: "var(--text-dim)" }}>
          <Legende pointille={false} texte="sous-page" />
          <Legende pointille texte="mention" />
          <Legende pointille={false} texte="tes liens" couleur={couleur} />
          <Legende pointille={false} texte="liens de l'IA" couleur="var(--lien-ia)" />
        </div>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {blocks.length} page{blocks.length > 1 ? "s" : ""} · {nbMentions} mention{nbMentions > 1 ? "s" : ""} · {Math.round(vue.k * 100)} %
        </span>
      </div>

      <div
        ref={cadre}
        onPointerDown={surAppui}
        onPointerMove={surDeplacement}
        onPointerUp={surRelache}
        onPointerCancel={surRelache}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest("[data-bulle], [data-hors-carte]")) return;
          nouvellePage(null, versCarte(e.clientX, e.clientY));
        }}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          cursor: glisseBulle?.bouge ? "grabbing" : "grab",
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: `${24 * vue.k}px ${24 * vue.k}px`,
          backgroundPosition: `${vue.x}px ${vue.y}px`,
          touchAction: "none",
        }}
      >
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, display: "block" }}>
          <defs>
            {/* Pointe de flèche de la couleur du trait qui la porte. */}
            <marker id="pk-fleche" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9 z" fill="context-stroke" />
            </marker>
          </defs>
          <g transform={`translate(${vue.x},${vue.y}) scale(${vue.k})`}>
            {carte.liens.map((l) => {
              const a = affiche(carte.noeuds.get(l.de)!), b = affiche(carte.noeuds.get(l.vers)!);
              const actif = !lies || (lies.has(l.de) && lies.has(l.vers) && (l.de === selection || l.vers === selection));
              return (
                <path
                  key={`${l.type}:${l.de}>${l.vers}`}
                  d={l.type === "arbre" ? courbeArbre(a, b) : courbeMention(a, b)}
                  fill="none"
                  stroke="var(--lien-base)"
                  strokeWidth={(l.type === "arbre" ? 2 : 1.5) * (actif && lies ? 1.4 : 1)}
                  strokeDasharray={l.type === "mention" ? "5 5" : undefined}
                  strokeLinecap="round"
                  opacity={actif ? (l.type === "arbre" ? 0.75 : 0.85) : 0.15}
                />
              );
            })}
            {traits.map(({ cle, lien, a, b, rang, type, proposition }) => {
              const { d, milieu } = courbeLien(affiche(carte.noeuds.get(a)!), affiche(carte.noeuds.get(b)!), rang);
              const actif = !lies || ((a === selection || b === selection) && lies.has(a) && lies.has(b));
              const ouvert = (lien && lien.id === lienEdite) || (type === "proposition" && propSurvol === proposition);
              // Liens de l'IA : leur couleur se règle dans le menu Thème (cyan par
              // défaut). En blanc à l'origine, ils se confondaient avec les liens
              // basiques quand la couleur principale était « Monochrome ».
              const teinte = type === "humain" ? (lien?.couleur ?? couleur) : "var(--lien-ia)";
              const etiquette = type === "humain" ? lien?.etiquette : "";
              return (
                <g
                  key={cle}
                  opacity={type === "proposition" ? (ouvert ? 1 : 0.6) : actif || ouvert ? 1 : 0.2}
                  onPointerEnter={() => type === "proposition" && setPropSurvol(proposition!)}
                  onPointerLeave={() => type === "proposition" && setPropSurvol(null)}
                >
                  <path
                    d={d}
                    fill="none"
                    stroke={teinte}
                    strokeWidth={ouvert ? 3.2 : type === "proposition" ? 1.8 : 2.4}
                    strokeDasharray={type === "proposition" ? "6 5" : undefined}
                    strokeLinecap="round"
                    markerEnd="url(#pk-fleche)"
                  />
                  {/* Zone de clic large : un trait de 2 px est difficile à attraper. */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ cursor: "pointer" }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      setSelection(null);
                      if (lien) setLienEdite(lien.id);
                    }}
                  >
                    <title>
                      {type === "proposition"
                        ? `Proposé par l'IA : ${suggestion?.propositions[proposition!]?.raison ?? ""}`
                        : type === "ia"
                          ? `Lien de l'IA : ${lien?.raison}`
                          : lien?.etiquette || "Clic : couleur, étiquette, supprimer"}
                    </title>
                  </path>
                  {type === "proposition" && ouvert && (
                    <text
                      x={milieu.x}
                      y={milieu.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="var(--lien-ia)"
                      stroke="var(--bg)"
                      strokeWidth={4}
                      paintOrder="stroke"
                      fontSize={12}
                      fontWeight={700}
                      fontFamily="var(--font-body)"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      ?
                    </text>
                  )}
                  {etiquette && lien && (
                    <text
                      x={milieu.x}
                      y={milieu.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={teinte}
                      stroke="var(--bg)"
                      strokeWidth={4}
                      paintOrder="stroke"
                      fontSize={11.5}
                      fontWeight={600}
                      fontFamily="var(--font-body)"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {etiquette}
                    </text>
                  )}
                </g>
              );
            })}
            {trace && carte.noeuds.get(trace.de) && (
              <line
                x1={carte.noeuds.get(trace.de)!.x}
                y1={carte.noeuds.get(trace.de)!.y}
                x2={trace.cible ? carte.noeuds.get(trace.cible)!.x : trace.x}
                y2={trace.cible ? carte.noeuds.get(trace.cible)!.y : trace.y}
                stroke={couleur}
                strokeWidth={2.2}
                strokeDasharray="6 4"
                strokeLinecap="round"
                style={{ pointerEvents: "none" }}
              />
            )}
            {[...carte.noeuds.values()].map((n) => (
              <Bulle
                key={n.id}
                noeud={affiche(n)}
                selectionnee={selection === n.id}
                cible={glisseBulle?.cible === n.id || trace?.cible === n.id}
                estompee={!!lies && !lies.has(n.id)}
                enEdition={edition?.id === n.id}
                poignee={n.id !== RACINE && !trace && !glisseBulle?.bouge && (survol?.id === n.id || selection === n.id)}
                couleurLien={couleur}
                onDebutLien={(e) => commencerLien(n.id, e)}
                onAppui={(e) => {
                  setLienEdite(null);
                  setSelection(n.id);
                  commencerGlisser(n.id, e);
                }}
                onDoubleClic={() => setEdition({ id: n.id, valeur: n.id === RACINE ? projectName : pages.get(n.id)?.title ?? "" })}
                onBasculer={() => basculer(n.id)}
                onSurvol={(entre, e) =>
                  setSurvol(entre && n.id !== RACINE && !glisse.current && !glisseRef.current ? { id: n.id, x: e.clientX, y: e.clientY } : null)
                }
              />
            ))}
          </g>
        </svg>

        {glisseBulle?.bouge && (
          <div style={{ ...barreSelection, pointerEvents: "none" }}>
            {glisseBulle.cible
              ? glisseBulle.cible === pages.get(glisseBulle.id)?.parentId ||
                (glisseBulle.cible === RACINE && !pages.get(glisseBulle.id)?.parentId)
                ? "Lâcher ici : remettre à sa place"
                : `Lâcher ici : ranger dans « ${titreCourt(carte.noeuds.get(glisseBulle.cible)?.titre ?? "")} »`
              : "Lâcher : placer la bulle ici · sur une autre bulle : l'y ranger · Échap : annuler"}
          </div>
        )}

        {noeudSel && !glisseBulle?.bouge && !edition && (
          <div data-hors-carte style={barreSelection} onPointerDown={(e) => e.stopPropagation()}>
            <strong style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {noeudSel.titre || "Sans titre"}
            </strong>
            {selection !== RACINE && (
              <button onClick={() => onOpenBlock(noeudSel.id)} style={boutonAccent} title="Ouvrir la page — Entrée">
                Ouvrir la page
              </button>
            )}
            <button
              onClick={() => nouvellePage(selection === RACINE ? null : noeudSel.id)}
              style={bouton}
              title={selection === RACINE ? "Nouvelle page du projet" : "Nouvelle sous-page de celle-ci"}
            >
              {selection === RACINE ? "+ Page" : "+ Sous-page"}
            </button>
            <button
              onClick={() => setEdition({ id: noeudSel.id, valeur: selection === RACINE ? projectName : pages.get(noeudSel.id)?.title ?? "" })}
              style={bouton}
              title="Double-clic sur la bulle, aussi"
            >
              Renommer
            </button>
            {noeudSel.aDesEnfants && selection !== RACINE && (
              <button onClick={() => basculer(noeudSel.id)} style={bouton}>
                {noeudSel.caches ? `Déplier (${noeudSel.caches})` : "Replier"}
              </button>
            )}
            {noeudSel.decalee && (
              <button onClick={() => oublier([noeudSel.id])} style={bouton} title="Revenir à la place automatique">
                ↺ Remettre en place
              </button>
            )}
          </div>
        )}

        {edition && noeudEdite && (
          <input
            data-hors-carte
            autoFocus
            // Titre entièrement sélectionné : taper le remplace, comme dans un explorateur.
            onFocus={(e) => e.currentTarget.select()}
            value={edition.valeur}
            placeholder={edition.id === RACINE ? "Nom du projet" : "Titre de la page"}
            onChange={(e) => setEdition({ ...edition, valeur: e.target.value })}
            onBlur={validerEdition}
            onKeyDown={(e) => {
              if (e.key === "Enter") validerEdition();
              if (e.key === "Escape") setEdition(null);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              ...champEdition,
              left: vue.x + noeudEdite.x * vue.k,
              top: vue.y + noeudEdite.y * vue.k,
              width: Math.max(170, noeudEdite.largeur * vue.k + 30),
            }}
          />
        )}

        {lienOuvert?.lien && (() => {
          const { milieu } = courbeLien(carte.noeuds.get(lienOuvert.a)!, carte.noeuds.get(lienOuvert.b)!, lienOuvert.rang);
          const lien = lienOuvert.lien!;
          if (lien.type === "ia") {
            return (
              <div
                key={lien.id}
                data-hors-carte
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                style={{ ...editeurStyle, left: vue.x + milieu.x * vue.k, top: vue.y + milieu.y * vue.k }}
              >
                <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
                  Lien de l'IA · « {titreCourt(pages.get(lien.de)?.title ?? "")} » → « {titreCourt(pages.get(lien.vers)?.title ?? "")} »
                </div>
                <div>{lien.raison}</div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <button
                    onClick={() => {
                      // Supprimé = rejeté : l'IA ne le reproposera pas.
                      modifierLien(lien.id, { type: "ia_rejete" });
                      setLienEdite(null);
                    }}
                    style={{ ...bouton, color: "var(--danger)", borderColor: "transparent", padding: "4px 6px" }}
                  >
                    Supprimer
                  </button>
                  <button
                    onClick={() => modifierLien(lien.id, { type: "humain", couleur })}
                    style={boutonAccent}
                    title="Il devient un de tes liens : couleur et étiquette au choix"
                  >
                    En faire un de mes liens
                  </button>
                </div>
              </div>
            );
          }
          return (
            <EditeurLien
              key={lien.id}
              x={vue.x + milieu.x * vue.k}
              y={vue.y + milieu.y * vue.k}
              de={pages.get(lien.de)?.title ?? ""}
              vers={pages.get(lien.vers)?.title ?? ""}
              couleur={lien.couleur ?? couleur}
              etiquette={lien.etiquette}
              onCouleur={(c) => {
                modifierLien(lien.id, { couleur: c });
                setCouleur(c);
                ecrireCouleur(c);
              }}
              onEtiquette={(t) => modifierLien(lien.id, { etiquette: t })}
              onSupprimer={() => {
                supprimerLien(lien.id);
                setLienEdite(null);
              }}
              onFermer={() => setLienEdite(null)}
            />
          );
        })()}

        {suggestion && suggestion.etat !== "recherche" && (
          <div data-hors-carte style={panneauPropositions} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ fontSize: 12.5 }}>✦ Liens proposés par l'IA</strong>
              <button onClick={() => setSuggestion(null)} style={{ ...bouton, border: "none", padding: "0 4px" }} title="Fermer">
                ×
              </button>
            </div>
            {suggestion.etat === "erreur" && <div style={{ color: "var(--danger)" }}>{suggestion.message}</div>}
            {suggestion.etat === "pret" && suggestion.propositions.length === 0 && (
              <div style={{ color: "var(--text-dim)" }}>
                {suggestion.gardes
                  ? `${suggestion.gardes} lien${suggestion.gardes > 1 ? "s" : ""} gardé${suggestion.gardes > 1 ? "s" : ""} : ce sont les traits « liens de l'IA » sur la carte.`
                  : suggestion.message ?? "Aucun nouveau lien évident : l'IA n'en invente pas."}
              </div>
            )}
            {suggestion.propositions.length > 0 && (
              <>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
                  Rien n'est ajouté sans toi : garde ou rejette chaque lien. Un lien rejeté ne sera plus proposé.
                </div>
                <div className="scroll" style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 320 }}>
                  {suggestion.propositions.map((p, i) => (
                    <div
                      key={`${p.de}>${p.vers}`}
                      onPointerEnter={() => setPropSurvol(i)}
                      onPointerLeave={() => setPropSurvol(null)}
                      style={{
                        ...carteProposition,
                        borderColor: propSurvol === i ? "var(--text-dim)" : "var(--border)",
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 12 }}>
                        {titreCourt(pages.get(p.de)?.title ?? "")} → {titreCourt(pages.get(p.vers)?.title ?? "")}
                      </div>
                      <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{p.raison}</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                        <button onClick={() => deciderProposition(i, true)} style={boutonAccent}>
                          ✓ Garder
                        </button>
                        <button onClick={() => deciderProposition(i, false)} style={bouton}>
                          ✕ Rejeter
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => toutDecider(true)} style={bouton}>
                    Tout garder
                  </button>
                  <button onClick={() => toutDecider(false)} style={bouton}>
                    Tout rejeter
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {trace && (
          <div style={{ ...barreSelection, pointerEvents: "none" }}>
            {trace.cible
              ? `Lâcher : relier à « ${titreCourt(carte.noeuds.get(trace.cible)?.titre ?? "")} »`
              : "Tire jusqu'à une autre page pour les relier · Échap : annuler"}
          </div>
        )}

        {survol && pages.get(survol.id) && !edition && !trace && (
          <Apercu
            page={pages.get(survol.id)!}
            x={survol.x}
            y={survol.y}
            cadre={cadre.current}
            titreDe={(id) => pages.get(id)?.title}
          />
        )}

        <div style={aide}>
          Glisser le fond : se déplacer · Molette : zoom · Glisser une bulle : la placer, ou la lâcher sur une autre pour l'y ranger ·
          Tirer le ● d'une bulle : relier deux pages · Double-clic : renommer · Double-clic sur le fond : nouvelle page
        </div>
      </div>
    </div>
  );
}

function Bulle({
  noeud: n,
  selectionnee,
  cible,
  estompee,
  enEdition,
  poignee,
  couleurLien,
  onDebutLien,
  onAppui,
  onDoubleClic,
  onBasculer,
  onSurvol,
}: {
  noeud: Noeud;
  selectionnee: boolean;
  cible: boolean;
  estompee: boolean;
  enEdition: boolean;
  /** Afficher la poignée ● d'où l'on tire un lien vers une autre page. */
  poignee: boolean;
  couleurLien: string;
  onDebutLien: (e: React.PointerEvent) => void;
  onAppui: (e: React.PointerEvent) => void;
  onDoubleClic: () => void;
  onBasculer: () => void;
  onSurvol: (entre: boolean, e: React.PointerEvent) => void;
}) {
  const racine = n.id === RACINE;
  // Le bouton de repli se place côté extérieur de la bulle, dans l'axe de sa branche.
  const bx = Math.cos(n.angle) >= 0 ? n.largeur / 2 + 11 : -n.largeur / 2 - 11;
  return (
    <g
      data-bulle={n.id}
      transform={`translate(${n.x},${n.y})`}
      opacity={estompee ? 0.35 : enEdition ? 0 : 1}
      style={{ cursor: racine ? "pointer" : "grab" }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onAppui(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClic();
      }}
      onPointerEnter={(e) => onSurvol(true, e)}
      onPointerLeave={(e) => onSurvol(false, e)}
    >
      {cible && (
        <rect
          x={-n.largeur / 2 - 6}
          y={-n.hauteur / 2 - 6}
          width={n.largeur + 12}
          height={n.hauteur + 12}
          rx={n.hauteur / 2 + 6}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeDasharray="4 3"
        />
      )}
      <rect
        x={-n.largeur / 2}
        y={-n.hauteur / 2}
        width={n.largeur}
        height={n.hauteur}
        rx={n.hauteur / 2}
        fill={racine ? "var(--accent)" : selectionnee || cible ? "var(--accent-soft)" : "var(--surface-2)"}
        stroke={racine || selectionnee || cible ? "var(--accent)" : "var(--border)"}
        strokeWidth={selectionnee ? 2 : 1}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill={racine ? "var(--bg)" : n.titre.trim() ? "var(--text)" : "var(--text-dim)"}
        fontSize={racine ? 14 : 12.5}
        fontWeight={racine ? 700 : 500}
        fontStyle={n.titre.trim() ? "normal" : "italic"}
        fontFamily="var(--font-body)"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {titreCourt(n.titre)}
      </text>
      {!racine && n.aDesEnfants && (
        <g
          transform={`translate(${bx},0)`}
          style={{ cursor: "pointer" }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button === 0) onBasculer();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <title>{n.caches ? `Déplier : ${n.caches} page${n.caches > 1 ? "s" : ""} cachée${n.caches > 1 ? "s" : ""}` : "Replier cette branche"}</title>
          <circle r={n.caches ? 10 : 7.5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={1.2} />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--accent)"
            fontSize={n.caches ? 9.5 : 11}
            fontWeight={700}
            fontFamily="var(--font-mono)"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {n.caches ? `+${n.caches}` : "−"}
          </text>
        </g>
      )}
      {poignee && (
        <g
          transform={`translate(${n.largeur / 2 - 8},${-n.hauteur / 2 - 2})`}
          style={{ cursor: "crosshair" }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onDebutLien(e);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <title>Tirer jusqu'à une autre page pour les relier</title>
          {/* Zone de prise plus large que le point visible. */}
          <circle r={10} fill="transparent" />
          <circle r={5.5} fill={couleurLien} stroke="var(--bg)" strokeWidth={1.5} />
        </g>
      )}
    </g>
  );
}

/** Réglages d'un lien tracé à la main : couleur, étiquette, suppression. */
function EditeurLien({
  x,
  y,
  de,
  vers,
  couleur,
  etiquette,
  onCouleur,
  onEtiquette,
  onSupprimer,
  onFermer,
}: {
  x: number;
  y: number;
  de: string;
  vers: string;
  couleur: string;
  etiquette: string;
  onCouleur: (c: string) => void;
  onEtiquette: (t: string) => void;
  onSupprimer: () => void;
  onFermer: () => void;
}) {
  const [texte, setTexte] = useState(etiquette);
  const valider = () => {
    if (texte.trim() !== etiquette) onEtiquette(texte.trim());
    onFermer();
  };
  return (
    <div
      data-hors-carte
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ ...editeurStyle, left: x, top: y }}
    >
      <div style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        « {titreCourt(de)} » → « {titreCourt(vers)} »
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {PALETTE_LIENS.map((c) => (
          <button
            key={c.valeur}
            onClick={() => onCouleur(c.valeur)}
            title={c.nom}
            aria-label={c.nom}
            aria-pressed={c.valeur === couleur}
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              padding: 0,
              background: c.valeur,
              border: c.valeur === couleur ? "2px solid var(--text)" : "2px solid transparent",
              boxShadow: c.valeur === couleur ? "0 0 0 2px var(--bg) inset" : "none",
              cursor: "pointer",
            }}
          />
        ))}
      </div>
      <input
        autoFocus
        value={texte}
        maxLength={40}
        placeholder="Étiquette (facultative) : allié, ennemi, se trouve à…"
        onChange={(e) => setTexte(e.target.value)}
        onBlur={() => texte.trim() !== etiquette && onEtiquette(texte.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") valider();
          if (e.key === "Escape") onFermer();
        }}
        style={champEtiquette}
      />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button onClick={onSupprimer} style={{ ...bouton, color: "var(--danger)", borderColor: "transparent", padding: "4px 6px" }}>
          Supprimer le lien
        </button>
        <button onClick={valider} style={boutonAccent}>
          OK
        </button>
      </div>
    </div>
  );
}

/** Aperçu d'une page au survol : ses premières lignes, pour la reconnaître sans l'ouvrir. */
function Apercu({
  page,
  x,
  y,
  cadre,
  titreDe,
}: {
  page: Block;
  x: number;
  y: number;
  cadre: HTMLDivElement | null;
  titreDe: (id: string) => string | undefined;
}) {
  const r = cadre?.getBoundingClientRect();
  if (!r) return null;
  // Mentions comprises : `getBlockText` les perdait (« Pilotée par à la fin. »).
  const texte = texteDePage(page, titreDe);
  const gauche = Math.min(x - r.left + 14, r.width - 270);
  const haut = Math.min(y - r.top + 16, r.height - 110);
  return (
    <div style={{ ...apercuStyle, left: Math.max(8, gauche), top: Math.max(8, haut) }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{page.title || "Sans titre"}</div>
      <div style={{ color: "var(--text-dim)" }}>
        {texte ? (texte.length > 180 ? `${texte.slice(0, 179)}…` : texte) : "Page vide."}
      </div>
    </div>
  );
}

function Legende({ pointille, texte, couleur = "var(--lien-base)" }: { pointille: boolean; texte: string; couleur?: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <svg width="22" height="6" aria-hidden>
        <line x1="1" y1="3" x2="21" y2="3" stroke={couleur} strokeWidth="2" strokeDasharray={pointille ? "4 3" : undefined} />
      </svg>
      {texte}
    </span>
  );
}

const barre: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
  flexShrink: 0,
  flexWrap: "wrap",
};

const bouton: CSSProperties = {
  fontSize: 12.5,
  padding: "5px 11px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
};

const boutonAccent: CSSProperties = {
  ...bouton,
  border: "1px solid var(--accent)",
  background: "var(--accent-soft)",
  color: "var(--accent)",
};

const barreSelection: CSSProperties = {
  position: "absolute",
  top: 12,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px 6px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
  fontSize: 12.5,
  cursor: "default",
  whiteSpace: "nowrap",
  zIndex: 3,
};

const champEdition: CSSProperties = {
  position: "absolute",
  transform: "translate(-50%, -50%)",
  padding: "5px 12px",
  borderRadius: 999,
  border: "1px solid var(--accent)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: 13,
  textAlign: "center",
  outline: "none",
  boxShadow: "0 0 0 3px var(--accent-soft)",
  zIndex: 4,
};

const panneauPropositions: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  width: 300,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  fontSize: 12.5,
  cursor: "default",
  zIndex: 5,
};

const carteProposition: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
};

const editeurStyle: CSSProperties = {
  position: "absolute",
  transform: "translate(-50%, 12px)",
  width: 260,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  fontSize: 12.5,
  cursor: "default",
  zIndex: 5,
};

const champEtiquette: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "5px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  fontSize: 12.5,
  outline: "none",
};

const apercuStyle: CSSProperties = {
  position: "absolute",
  width: 250,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
  fontSize: 12,
  lineHeight: 1.45,
  pointerEvents: "none",
  zIndex: 2,
};

const aide: CSSProperties = {
  position: "absolute",
  left: 12,
  right: 12,
  bottom: 10,
  fontSize: 11,
  color: "var(--text-dim)",
  pointerEvents: "none",
  userSelect: "none",
};
