import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import { modeleTexte, prechauffer, streamChat } from "../../lib/ollama";
import { markdownToDoc } from "../../lib/markdownToDoc";
import { ACTIONS_CURSEUR, ACTIONS_SELECTION, blocDefinitions, inviteEditeur, type ActionEditeur } from "../../lib/aiPrompts";
import { definitionsPour } from "../../lib/glossaire";
import { AI_INLINE_EVENT, signalerIaOuverte } from "./editorEvents";
import TexteRiche from "../TexteRiche";

/**
 * L'assistant DANS la note, à l'endroit du curseur — comme l'IA de Notion.
 *
 * Ouverture : Ctrl+Espace, Espace sur une ligne vide, ou les menus IA de la
 * bulle et de la barre d'outils. Avec une sélection, on travaille SUR le passage
 * (reformuler, raccourcir…) ; sans sélection, on écrit À PARTIR du curseur
 * (continuer, idées, inspiration narrative…).
 *
 * Rien ne s'écrit sans validation : le résultat s'affiche d'abord en aperçu,
 * puis « Insérer » / « Remplacer » ou « Annuler ». C'est la règle choisie par
 * l'utilisateur pour toute l'IA, et elle vaut aussi pour la réécriture d'une
 * sélection, qui auparavant remplaçait le texte directement.
 */

interface Props {
  editor: Editor | null;
  titrePage: string;
}

type Etat = "choix" | "generation" | "resultat" | "erreur";

const LARGEUR = 460;
// Contexte envoyé au modèle : assez pour rester cohérent avec la note, pas trop
// pour ne pas déborder la mémoire de la carte graphique (6 Go, déjà pleine).
const AVANT_CURSEUR = 1800;
const APRES_CURSEUR = 400;

export default function InlineAi({ editor, titrePage }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [ancre, setAncre] = useState({ left: 0, top: 0 });
  const [plage, setPlage] = useState({ from: 0, to: 0 });
  const [demande, setDemande] = useState("");
  const [etat, setEtat] = useState<Etat>("choix");
  const [resultat, setResultat] = useState("");
  const [erreur, setErreur] = useState("");
  const [derniere, setDerniere] = useState<{ consigne: string; remplace: boolean } | null>(null);
  const boite = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const arret = useRef<AbortController | null>(null);

  const avecSelection = plage.to > plage.from;
  const actions = avecSelection ? ACTIONS_SELECTION : ACTIONS_CURSEUR;
  const filtre = demande.trim().toLowerCase();
  const suggestions = filtre ? actions.filter((a) => a.libelle.toLowerCase().includes(filtre)) : actions;

  const fermer = () => {
    arret.current?.abort();
    setOuvert(false);
    editor?.commands.focus();
  };

  // Ouverture sur demande (raccourci, bulle, barre d'outils).
  useEffect(() => {
    const ouvrir = (e: Event) => {
      if (!editor) return;
      const { from, to } = editor.state.selection;
      const coords = editor.view.coordsAtPos(to);
      setPlage({ from, to });
      setAncre({ left: coords.left, top: coords.bottom + 8 });
      setDemande("");
      setResultat("");
      setErreur("");
      setEtat("choix");
      setOuvert(true);
      // Le modèle se charge pendant qu'on choisit l'action ou qu'on tape la demande.
      modeleTexte().then(prechauffer).catch(() => {});

      // Une action demandée d'emblée (depuis un menu) part tout de suite.
      const libelle = (e as CustomEvent<string | undefined>).detail;
      const toutes = from < to ? ACTIONS_SELECTION : ACTIONS_CURSEUR;
      const action = libelle ? toutes.find((a) => a.libelle === libelle) : undefined;
      if (action) window.setTimeout(() => lancer(action.consigne, !!action.remplace, { from, to }), 0);
      else window.setTimeout(() => champ.current?.focus(), 0);
    };
    window.addEventListener(AI_INLINE_EVENT, ouvrir);
    return () => window.removeEventListener(AI_INLINE_EVENT, ouvrir);
    // `lancer` lit l'éditeur au moment de l'appel : pas besoin de le suivre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // La boîte ne doit jamais sortir de l'écran (curseur près du bas ou du bord droit).
  useLayoutEffect(() => {
    if (!ouvert || !boite.current) return;
    const r = boite.current.getBoundingClientRect();
    const left = Math.max(12, Math.min(ancre.left, window.innerWidth - r.width - 12));
    const top = ancre.top + r.height > window.innerHeight - 12 ? Math.max(12, ancre.top - r.height - 36) : ancre.top;
    if (left !== ancre.left || top !== ancre.top) setAncre({ left, top });
  }, [ouvert, etat, resultat, ancre]);

  // Fermeture : Échap PARTOUT, et clic en dehors — toujours, même pendant que
  // l'IA écrit (on l'arrête). Recette du 11/09, « la bulle reste » : le bouton
  // d'action cliqué disparaît pendant la génération, le focus retombe sur le fond
  // de page, et Échap n'était écouté que dans la fenêtre ; un clic à côté, lui,
  // était ignoré pendant la génération. Plus aucun moyen d'en sortir.
  useEffect(() => {
    if (!ouvert) return;
    const touche = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      arret.current?.abort();
      setOuvert(false);
      editor?.commands.focus();
    };
    const dehors = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) {
        arret.current?.abort();
        setOuvert(false);
      }
    };
    window.addEventListener("keydown", touche, true);
    document.addEventListener("mousedown", dehors);
    return () => {
      window.removeEventListener("keydown", touche, true);
      document.removeEventListener("mousedown", dehors);
    };
  }, [ouvert, editor]);

  // La bulle de mise en forme se superposait à la fenêtre d'IA : on la masque
  // tant que la fenêtre est ouverte. Une transaction vide force l'éditeur à
  // réévaluer l'affichage de la bulle.
  useEffect(() => {
    signalerIaOuverte(ouvert);
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta("pkIaInline", ouvert));
    return () => signalerIaOuverte(false);
  }, [ouvert, editor]);

  function contexte(p: { from: number; to: number }): string {
    const doc = editor!.state.doc;
    if (p.to > p.from) {
      const passage = doc.textBetween(p.from, p.to, "\n");
      const autour = doc.textBetween(0, doc.content.size, "\n").slice(0, 1200);
      return `Titre de la note : ${titrePage || "Sans titre"}\nDébut de la note, pour le contexte :\n"""\n${autour}\n"""\n\nPassage sélectionné :\n"""\n${passage}\n"""`;
    }
    const avant = doc.textBetween(Math.max(0, p.from - AVANT_CURSEUR), p.from, "\n");
    const apres = doc.textBetween(p.from, Math.min(doc.content.size, p.from + APRES_CURSEUR), "\n");
    return `Titre de la note : ${titrePage || "Sans titre"}\nContenu de la note, le curseur est à l'emplacement ⟦ICI⟧ :\n"""\n${avant}⟦ICI⟧${apres}\n"""`;
  }

  async function lancer(consigne: string, remplace: boolean, p = plage) {
    arret.current?.abort();
    const controleur = new AbortController();
    arret.current = controleur;
    setDerniere({ consigne, remplace });
    setResultat("");
    setErreur("");
    setEtat("generation");
    try {
      let texte = "";
      for await (const morceau of streamChat(
        [
          { role: "system", content: inviteEditeur() },
          {
            role: "user",
            content: [`${contexte(p)}\n\nConsigne : ${consigne}`, blocDefinitions(definitionsPour(consigne))]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        undefined,
        controleur.signal
      )) {
        texte += morceau;
        setResultat(texte);
      }
      if (!texte.trim()) throw new Error("La réponse est vide.");
      setEtat("resultat");
    } catch (err) {
      if (controleur.signal.aborted) return;
      setErreur(err instanceof Error ? err.message : String(err));
      setEtat("erreur");
    }
  }

  /** Insère (ou remplace) le résultat dans la note — le seul endroit où l'IA écrit. */
  function appliquer(remplacer: boolean) {
    const noeuds = markdownToDoc(resultat).content ?? [];
    const doc = editor!.state.doc;
    // Le passage tient-il dans une seule ligne de texte ? Alors le résultat doit y
    // entrer comme du TEXTE : un bloc (paragraphe, puce) casserait la ligne en deux
    // ou changerait le paragraphe en liste — mesuré sur « Raccourcir ».
    const $de = doc.resolve(plage.from);
    const $a = doc.resolve(plage.to);
    const dansUneLigne = $de.sameParent($a) && $de.parent.isTextblock;
    const enLigne = dansUneLigne ? texteSeul(noeuds) : null;
    const contenu: JSONContent[] = enLigne ?? noeuds;
    const cible = remplacer ? { from: plage.from, to: plage.to } : plage.to;
    editor!.chain().focus().insertContentAt(cible, contenu).run();
    setOuvert(false);
  }

  const lancerDemande = () => {
    const libre = demande.trim();
    if (!libre) return;
    // La demande libre sur une sélection vise ce passage : on propose de le remplacer.
    lancer(libre, avecSelection);
  };

  const choisir = (a: ActionEditeur) => lancer(a.consigne, !!a.remplace);

  if (!ouvert || !editor) return null;

  return (
    <div
      ref={boite}
      style={{ ...boiteStyle, left: ancre.left, top: ancre.top }}
    >
      {(etat === "choix" || etat === "erreur") && (
        <>
          <input
            ref={champ}
            value={demande}
            onChange={(e) => setDemande(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Entrée sur un filtre qui ne garde qu'une action : on la lance.
                if (suggestions.length === 1 && filtre) choisir(suggestions[0]);
                else lancerDemande();
              }
            }}
            placeholder={avecSelection ? "Que faire de ce passage ? (ou choisis ci-dessous)" : "Demande à l'IA d'écrire ici… (ou choisis ci-dessous)"}
            style={champStyle}
          />
          {etat === "erreur" && <div style={{ fontSize: 12, color: "var(--danger)", padding: "0 4px" }}>⚠ {erreur}</div>}
          <div style={{ display: "flex", flexDirection: "column", maxHeight: 260, overflowY: "auto" }} className="scroll">
            <div style={legende}>{avecSelection ? "Sur la sélection" : "À partir du curseur"}</div>
            {suggestions.map((a) => (
              <button key={a.libelle} onClick={() => choisir(a)} style={itemStyle} title={a.aide}>
                <span>{a.libelle}</span>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{a.aide}</span>
              </button>
            ))}
            {filtre && suggestions.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "6px 8px" }}>Entrée pour envoyer ta demande.</div>
            )}
          </div>
        </>
      )}

      {(etat === "generation" || etat === "resultat") && (
        <>
          <div style={legende}>
            {etat === "generation" ? (
              <>
                <span className="pk-ia-pulse">●</span> L'IA écrit…
              </>
            ) : (
              "Aperçu — rien n'est encore inséré"
            )}
          </div>
          <div style={apercuStyle} className="scroll">
            {/* Même rendu que dans la note (gras, listes, tableaux) : on juge ce
                qu'on va insérer, pas du Markdown brut. */}
            {resultat ? <TexteRiche texte={resultat} /> : "…"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {etat === "generation" ? (
              <button onClick={() => arret.current?.abort()} style={bouton}>
                ■ Arrêter
              </button>
            ) : (
              <>
                {derniere?.remplace && avecSelection && (
                  <button onClick={() => appliquer(true)} style={boutonPrincipal}>
                    Remplacer la sélection
                  </button>
                )}
                <button
                  onClick={() => appliquer(false)}
                  style={derniere?.remplace && avecSelection ? bouton : boutonPrincipal}
                >
                  {avecSelection ? "Insérer après" : "Insérer"}
                </button>
                <button onClick={() => derniere && lancer(derniere.consigne, derniere.remplace)} style={bouton}>
                  ↻ Réessayer
                </button>
                <button onClick={() => setEtat("choix")} style={bouton}>
                  ← Autre demande
                </button>
                <button onClick={fermer} style={{ ...bouton, marginLeft: "auto" }}>
                  Annuler
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const boiteStyle: CSSProperties = {
  position: "fixed",
  zIndex: 70,
  width: LARGEUR,
  maxWidth: "calc(100vw - 24px)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 10,
  borderRadius: 10,
  border: "1px solid var(--accent)",
  background: "var(--surface-2)",
  boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
};

const champStyle: CSSProperties = {
  width: "100%",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 13.5,
  outline: "none",
};

const legende: CSSProperties = {
  fontSize: 10.5,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "var(--text-dim)",
  padding: "2px 4px",
  display: "flex",
  gap: 6,
  alignItems: "center",
};

const itemStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "6px 8px",
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "var(--text)",
  fontSize: 13,
  textAlign: "left",
};

const apercuStyle: CSSProperties = {
  maxHeight: 280,
  overflowY: "auto",
  fontSize: 13,
  lineHeight: 1.55,
  padding: "8px 10px",
  borderRadius: 6,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

const bouton: CSSProperties = {
  padding: "5px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
};

const boutonPrincipal: CSSProperties = {
  ...bouton,
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "var(--bg)",
  fontWeight: 600,
};

/**
 * Contenu en ligne d'un résultat qui ne fait qu'UN bloc — paragraphe, titre, ou
 * liste d'un seul élément (le modèle met parfois une puce devant une simple
 * phrase). `null` si le résultat a vraiment plusieurs blocs : on l'insère alors
 * tel quel, la structure fait partie de la réponse.
 */
function texteSeul(noeuds: JSONContent[]): JSONContent[] | null {
  if (noeuds.length !== 1) return null;
  const [n] = noeuds;
  if (n.type === "paragraph" || n.type === "heading") return n.content ?? [];
  if ((n.type === "bulletList" || n.type === "orderedList" || n.type === "taskList") && n.content?.length === 1) {
    const item = n.content[0];
    if (item.content?.length === 1 && item.content[0].type === "paragraph") return item.content[0].content ?? [];
  }
  return null;
}
