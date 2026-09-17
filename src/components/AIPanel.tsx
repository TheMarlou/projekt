import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { checkOllamaAvailable, chatWithTools, listerModeles, manqueModeleTexte, modeleTexte, prechauffer, ChatMessage } from "../lib/ollama";
import AideOllama from "./AideOllama";
import {
  Plan,
  appliquerPlan,
  apercuProjet,
  chercherDansPages,
  describeToolCall,
  executeTool,
  OUTILS_ECRITURE,
  outilsDisponibles,
  setAiContextProject,
} from "../lib/aiTools";
import { invitePanneau, INSPIRATIONS } from "../lib/aiPrompts";
import { definitionsPour } from "../lib/glossaire";
import { pageToPath } from "../lib/pagePath";
import TexteRiche from "./TexteRiche";
import { docToMarkdown } from "../lib/markdown";
import { openExternal } from "../lib/external";
import {
  activerRechercheWeb,
  rechercheWeb,
  rechercheWebActivee,
  suivreRechercheWeb,
  type ResultatWeb,
} from "../lib/rechercheWeb";
import { Block, getBlockText, useBlocksStore } from "../store/blocksStore";
import { tr, enAnglais, localeDates } from "../lib/i18n";
import { capacitesPourInvite, changerReglagesIa, LIBELLES_REGLAGES, reglagesIa, suivreReglagesIa, type ModeReflexion } from "../lib/iaReglages";
import { contenuPourQuestion, demandeDeMemoriser, demandeDeModification, demandeSurCapacites, demandeUneNoteDeDiscussion, INDICE_CAPACITES, INDICE_SANS_MODIFICATION, questionSurLeProjet, transcrire, verifierReponse, type EchangeTranscrit } from "../lib/iaVerite";
import { texteMemoire } from "../lib/memoireProjet";
import MemoireVolet from "./MemoireVolet";
import { resolvePagePath } from "../lib/pagePath";
import { useConversationsStore, type ConversationEnregistree } from "../store/conversationsStore";

// Contenu de la page ouverte transmis au modèle. Plafonné : qwen3:8b déborde déjà
// de la carte graphique de 6 Go, et un contexte plus long le ralentit encore.
// Banc « véracité » du 13/09 : à 2 500, une page longue était coupée et l'IA répondait
// qu'elle ne savait pas (0/2) ; à 6 000 : 22/22, et pas plus lent (2,3 s au lieu de 2,9 s).
// Au-delà, `contenuPourQuestion` garde le début ET les passages liés à la question.
const CONTENU_PAGE_MAX = 6000;

/** La page ouverte en Markdown, pour que le modèle en voie la structure (titres, tableaux). */
function contenuPourIa(page: Block, question: string): { texte: string; tronque: boolean } {
  const titres = (id: string) => useBlocksStore.getState().blocks.find((b) => b.id === id)?.title ?? null;
  const md = page.content
    .map((c) => docToMarkdown(c.doc, { pageFile: () => null, pageTitle: titres, assetFile: () => null }))
    .filter(Boolean)
    .join("\n\n");
  return contenuPourQuestion(md, question, CONTENU_PAGE_MAX);
}

// Plafond d'enchaînements d'outils par tour — au-delà, un modèle 8B tourne en rond.
const MAX_TOOL_ITERATIONS = 6;
// Au-delà, les vieux échanges coûtent du temps de calcul sans aider le modèle —
// et l'invite porte désormais la page ouverte ET l'aperçu du projet : le
// contexte de 4 096 jetons se remplit vite.
const HISTORIQUE_MAX = 8;

/** L'utilisateur demande-t-il d'écrire, d'ajouter ou de créer quelque chose ? */
function demandeUneEcriture(demande: string): boolean {
  return /(écri|ecri|ajout|créer|crée|cree|insèr|inser|rempli|rédig|redig|\bmets\b|\bmet\b)/i.test(demande);
}

/** Demande d'idées, d'invention ? */
function demandeCreative(demande: string): boolean {
  return /(id[ée]es?\b|invente|imagine|trouve[- ]moi|noms? pour)/i.test(demande);
}

/** « a été créée », « ont été ajoutés » : une action présentée comme FAITE. */
function affirmeUnFait(reponse: string): boolean {
  return /(a été|ont été|est maintenant|sont maintenant)\s+(\S+\s+)?(ajouté|créé|cree|écrit|inséré|rédigé|mis\b|rempli)/i.test(reponse);
}

/** L'utilisateur demande-t-il explicitement de chercher sur internet ? */
function demandeUneRecherche(demande: string): boolean {
  return /(internet|wikip[ée]dia|\bweb\b|en ligne|v[ée]rifie sur)/i.test(demande);
}

/** La réponse affirme-t-elle qu'une modification a eu lieu ? */
function affirmeUneAction(reponse: string): boolean {
  return /(a été|ont été|j'ai|je viens d')\s+(\S+\s+)?(ajout|créé|cré|cree|écrit|ecrit|insér|inser|rédig|mis\b|rempli)/i.test(reponse);
}

/**
 * Ce que le panneau AFFICHE. Distinct de ce que le modèle REÇOIT (`historique`) :
 * auparavant, les lignes « 🔧 Lecture de… » et les avertissements étaient renvoyés
 * au modèle comme s'il les avait écrits lui-même, ce qui polluait son contexte.
 */
type Element =
  | { type: "utilisateur"; texte: string }
  | { type: "assistant"; texte: string; proposition?: boolean; rienFait?: boolean; sources?: ResultatWeb[] }
  | { type: "outil"; texte: string; echec?: boolean }
  | { type: "plan"; plan: Plan; etat: "attente" | "applique" | "ecarte"; bilan?: string }
  | { type: "info"; texte: string; erreur?: boolean }
  | { type: "horsLigne" }
  // Proposition relue depuis une conversation enregistrée : son code d'application
  // ne s'enregistre pas, elle ne peut plus être appliquée.
  | { type: "planArchive"; etat: "attente" | "applique" | "ecarte" | "expire"; bilan?: string; actions: { resume: string; apercu?: string }[] };

interface AIPanelProps {
  activePage: Block | null;
  projectId: string | null;
  projectName: string | null;
  onOpenPage: (id: string) => void;
}

export default function AIPanel({ activePage, projectId, projectName, onOpenPage }: AIPanelProps) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [sansModele, setSansModele] = useState(false);
  const [modele, setModele] = useState<string | null>(null);
  const [elements, setElements] = useState<Element[]>([]);
  const historique = useRef<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [debut, setDebut] = useState(0);
  const [, setTic] = useState(0);
  const arret = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLTextAreaElement>(null);
  const web = useSyncExternalStore(suivreRechercheWeb, rechercheWebActivee);
  const reglages = useSyncExternalStore(suivreReglagesIa, reglagesIa);
  const [vueReglages, setVueReglages] = useState(false);
  const [vueMemoire, setVueMemoire] = useState(false);
  const [vueConversations, setVueConversations] = useState(false);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);
  const conversations = useConversationsStore((s) => s.conversations);
  // Conversation en cours : son identifiant et sa date, pour l'enregistrer au fil de l'eau.
  const conversationId = useRef<string>(crypto.randomUUID());
  const creeLe = useRef<number>(Date.now());
  const dernierEnregistre = useRef("");

  const ajouter =(e: Element) => setElements((prev) => [...prev, e]);

  // Ctrl+J bascule l'assistant depuis n'importe où dans l'app, comme sur Notion.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Revérifie la connexion à chaque ouverture du panneau — Ollama a pu démarrer
  // (ou s'arrêter) entre deux ouvertures, un statut mis en cache serait trompeur.
  const verifierOllama = async () => {
    const res = await checkOllamaAvailable();
    setAvailable(res.ok);
    setConnectionError(res.error ?? null);
    if (!res.ok) return;
    const manque = manqueModeleTexte(await listerModeles().catch(() => [] as string[]));
    setSansModele(manque);
    if (manque) return;
    const m = await modeleTexte();
    setModele(m);
    prechauffer(m);
  };

  useEffect(() => {
    if (!open) return;
    void verifierOllama();
    window.setTimeout(() => champ.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [elements, enCours]);

  // Compteur de secondes pendant la réflexion : un modèle local peut mettre
  // 10 à 20 s, et un panneau figé ressemble à un plantage.
  useEffect(() => {
    if (!enCours) return;
    const t = window.setInterval(() => setTic((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [enCours]);

  const memoriser = (...msgs: ChatMessage[]) => {
    historique.current = [...historique.current, ...msgs].slice(-HISTORIQUE_MAX);
  };

  const nouvelleConversation = () => {
    setElements([]);
    historique.current = [];
    conversationId.current = crypto.randomUUID();
    creeLe.current = Date.now();
    dernierEnregistre.current = "";
  };

  const ouvrirConversation = (c: ConversationEnregistree) => {
    const relus = (c.elements as Element[]).map((e) =>
      e.type === "planArchive" && e.etat === "attente" ? { ...e, etat: "expire" as const } : e
    );
    conversationId.current = c.id;
    creeLe.current = c.creeLe;
    dernierEnregistre.current = JSON.stringify(relus);
    historique.current = (c.historique as ChatMessage[]).slice(-HISTORIQUE_MAX);
    setElements(relus);
    setVueConversations(false);
  };

  // Chaque projet a ses conversations : changer de projet en ouvre une neuve.
  useEffect(() => {
    nouvelleConversation();
    setVueConversations(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Enregistrement au fil de l'eau, une fois le tour terminé (demande du 13/09 :
  // « des conversations qu'on retrouve »). Les propositions sont archivées en texte.
  useEffect(() => {
    if (enCours || !projectId || !reglages.enregistrerConversations) return;
    const premier = elements.find((e) => e.type === "utilisateur");
    if (!premier || premier.type !== "utilisateur") return;
    const archive = elements.map((e) =>
      e.type === "plan"
        ? { type: "planArchive" as const, etat: e.etat, bilan: e.bilan, actions: e.plan.actions.map((a) => ({ resume: a.resume, apercu: a.apercu })) }
        : e
    );
    const json = JSON.stringify(archive);
    if (json === dernierEnregistre.current) return;
    dernierEnregistre.current = json;
    useConversationsStore.getState().enregistrer({
      id: conversationId.current,
      projectId,
      titre: premier.texte.replace(/\s+/g, " ").slice(0, 70),
      creeLe: creeLe.current,
      majLe: Date.now(),
      elements: archive,
      historique: historique.current,
    });
  }, [elements, enCours, projectId, reglages.enregistrerConversations]);

  // Boucle d'agent : le modèle peut enchaîner des lectures, et PROPOSER des
  // écritures qui s'accumulent dans un plan soumis à l'utilisateur.
  const send = async (text: string, affiche?: string, options: { transcription?: boolean } = {}) => {
    if (!text.trim() || enCours) return;

    ajouter({ type: "utilisateur", texte: affiche ?? text });
    setInput("");
    setEnCours(true);
    setDebut(Date.now());
    setAiContextProject(projectId);
    const controleur = new AbortController();
    arret.current = controleur;

    // Demande créative : le rappel va DANS le message, où un petit modèle l'écoute.
    // La règle de l'invite seule n'a pas suffi (« NÉMÉSIS » proposé comme idée de nom
    // pour le boss NÉMÉSIS, 6 fois sur 6 ; 0 sur 3 avec ce rappel).
    const permis = reglagesIa();
    // Note de discussion, « Retenir » : le modèle ne relit que les derniers messages,
    // la discussion ENTIÈRE lui est donc jointe par le code.
    const joindreDiscussion = options.transcription || demandeUneNoteDeDiscussion(text);
    const discussion = joindreDiscussion
      ? transcrire(
          elements.flatMap((e): EchangeTranscrit[] =>
            e.type === "utilisateur"
              ? [{ qui: "utilisateur" as const, texte: e.texte }]
              : e.type === "assistant"
                ? [{ qui: "assistant" as const, texte: e.texte }]
                : []
          )
        )
      : "";
    let contenuDemande = demandeCreative(text) ? `${text}\n(Uniquement des idées nouvelles : rien qui existe déjà dans mes pages.)` : text;
    if (discussion) contenuDemande += `\n\nLa discussion jusqu'ici :\n"""\n${discussion}\n"""`;
    if (demandeUneNoteDeDiscussion(text)) contenuDemande += "\n(Utilise l'outil note_discussion, sans rien inventer.)";
    else if (demandeDeMemoriser(text)) contenuDemande += "\n(Utilise l'outil memoriser : un appel par information, rien d'inventé.)";
    else if (demandeSurCapacites(text)) contenuDemande += `\n${INDICE_CAPACITES}`;
    else if (!permis.proposerModifications && demandeDeModification(text)) contenuDemande += `\n${INDICE_SANS_MODIFICATION}`;
    const userMsg: ChatMessage = { role: "user", content: contenuDemande };
    const page = activePage && permis.lirePages ? contenuPourIa(activePage, text) : null;
    // Réflexion « équilibre » (choix du 13/09) : pour les questions sur le contenu du projet.
    const reflechir = permis.reflexion === "toujours" || (permis.reflexion === "auto" && questionSurLeProjet(text));
    const system: ChatMessage = {
      role: "system",
      content: invitePanneau({
        projet: projectName,
        pageOuverte: activePage ? pageToPath(activePage.id) : null,
        contenuPage: page ? page.texte : activePage ? "(lecture des pages désactivée dans les réglages)" : null,
        // Recherche faite par le code AVANT le modèle : les extraits des autres
        // pages qui contiennent les mots de la question lui sont joints.
        extraits: permis.lirePages
          ? chercherDansPages(text, projectId)
              .filter((r) => !activePage || r.chemin !== pageToPath(activePage.id))
              .slice(0, 3)
              .map((r) => `« ${r.chemin} » : ${r.extrait}`)
          : [],
        apercu: permis.lirePages ? apercuProjet(projectId, activePage?.id ?? null) : null,
        rechercheWeb: rechercheWeb() !== null,
        definitions: definitionsPour(text),
        capacites: capacitesPourInvite(permis, rechercheWeb() !== null),
        memoire: permis.memoireProjet ? texteMemoire(projectId) : null,
      }),
    };
    let working: ChatMessage[] = [system, ...historique.current, userMsg];
    const plan = new Plan();
    // Un appel mal formé donne droit à une correction, pas davantage : sinon un 8B
    // s'enferme à répéter la même erreur jusqu'au plafond d'itérations.
    const retried = new Set<string>();
    let outils = outilsDisponibles();
    const sources = new Map<string, ResultatWeb>();

    try {
      let reponse: string | null = null;
      let relancee = false;
      let aCherche = false;
      let aLu = false;

      for (let i = 0; i < MAX_TOOL_ITERATIONS && reponse === null; i++) {
        const result = await chatWithTools(working, outils, undefined, controleur.signal, reflechir);

        if (!result.toolCalls || result.toolCalls.length === 0) {
          const texte = result.content.trim();
          // Garde-fou, recette du 11/09 : « écris Hello World dedans » → « le
          // contenu a été ajouté », sans aucun appel d'outil. Une demande d'écriture,
          // un plan vide et une action affirmée : on le lui dit et on relance, une fois.
          if (!relancee && plan.actions.length === 0 && demandeUneEcriture(text) && affirmeUneAction(texte)) {
            relancee = true;
            ajouter({ type: "outil", texte: tr("Réponse sans action réelle : je la relance.", "Answer without any real action: retrying."), echec: true });
            working = [
              ...working,
              { role: "assistant", content: texte },
              {
                role: "user",
                content:
                  "Tu n'as appelé aucun outil : rien n'a été créé ni ajouté. Appelle maintenant l'outil qui convient (create_page, add_content) pour faire ce que je t'ai demandé.",
              },
            ];
            continue;
          }
          // Même idée pour la recherche : « cherche sur internet ce qu'est le
          // Kraken » → réponse de mémoire, sans chercher (vu dans le panneau).
          if (!relancee && !aCherche && outils.some((o) => o.function.name === "web_search") && demandeUneRecherche(text)) {
            relancee = true;
            working = [
              ...working,
              { role: "assistant", content: texte },
              { role: "user", content: "Tu n'as pas cherché. Appelle maintenant web_search, puis réponds à partir des articles trouvés." },
            ];
            continue;
          }
          // Véracité (13/09) : le code relit la réponse — page citée qui n'existe pas,
          // « ce n'est pas dans les pages » sans avoir cherché, page tronquée non lue —
          // et relance une fois, avec la raison précise.
          const verdict =
            relancee || !permis.lirePages
              ? null
              : verifierReponse(texte, {
                  cheminExiste: (c) =>
                    resolvePagePath(c, { fallbackProjectId: projectId }).status === "ok" ||
                    [...plan.pagesEnAttente.values()].some((p) => p.toLowerCase().endsWith(c.toLowerCase())),
                  peutModifier: permis.proposerModifications,
                  aLu,
                  extraitsFournis: false,
                  pageTronquee: page?.tronque ?? false,
                  pageOuverte: activePage ? pageToPath(activePage.id) : null,
                });
          if (verdict) {
            relancee = true;
            ajouter({ type: "outil", texte: tr("Vérification de la réponse : je relis les pages.", "Checking the answer: rereading the pages.") });
            working = [...working, { role: "assistant", content: texte }, { role: "user", content: verdict }];
            continue;
          }
          reponse = texte;
          break;
        }

        working = [...working, { role: "assistant", content: result.content, tool_calls: result.toolCalls }];

        for (const call of result.toolCalls) {
          const { name, arguments: args } = call.function;
          if (name === "web_search") aCherche = true;
          if (name === "read_page" || name === "search_pages" || name === "read_tree") aLu = true;
          // Les écritures s'affichent dans la carte de proposition, pas en double ici.
          if (!OUTILS_ECRITURE.has(name)) ajouter({ type: "outil", texte: describeToolCall(name, args) });

          const outcome = await executeTool(name, args, plan, controleur.signal);
          working = [...working, { role: "tool", content: outcome.payload, tool_call_id: call.id }];
          outcome.sources?.forEach((s) => sources.set(s.url, s));
          if (outcome.horsLigne) {
            ajouter({ type: "horsLigne" });
            // Inutile de le laisser réessayer : sans réseau, il tournerait en rond.
            outils = outils.filter((o) => o.function.name !== "web_search");
          }

          if (!outcome.ok) {
            const raison = JSON.parse(outcome.payload).error as string;
            ajouter({ type: "outil", texte: `${name} — ${raison}`, echec: true });
            if (retried.has(name)) {
              reponse = tr(`Je n'ai pas réussi à faire ça : ${raison}`, `I couldn't do that: ${raison}`);
              break;
            }
            retried.add(name);
          }
        }
      }

      if (reponse === null) {
        reponse = tr(
          "J'ai enchaîné trop d'actions sans aboutir — reformule en demandant une étape à la fois.",
          "I chained too many actions without getting there — rephrase and ask for one step at a time."
        );
      }
      // Un contenu vide ou « {} » n'est jamais une réponse à montrer : c'était le
      // symptôme visible du bug d'origine.
      if (!reponse || reponse === "{}") {
        reponse = plan.actions.length
          ? tr("Voici ce que je propose :", "Here is what I suggest:")
          : tr(
              "Je n'ai pas su quoi répondre. Reformule ta demande, ou précise la page concernée.",
              "I didn't know what to answer. Rephrase your request, or say which page it's about."
            );
      }
      // « Hello World a été ajouté » alors que tout attend sa validation : mesuré 3 fois
      // sur 3 malgré la consigne. Le détail est dans la carte juste en dessous (et le
      // bandeau dit que rien n'est appliqué) ; la phrase fausse est remplacée.
      if (plan.actions.length && affirmeUnFait(reponse)) {
        reponse = tr("Voici ce que je propose :", "Here is what I suggest:");
      }

      // Même relancé, il peut persister : on ne laisse pas croire à une action.
      const rienFait = plan.actions.length === 0 && demandeUneEcriture(text) && affirmeUneAction(reponse);
      ajouter({
        type: "assistant",
        texte: reponse,
        proposition: plan.actions.length > 0 && !permis.ecrireSansValidation,
        rienFait,
        sources: sources.size ? [...sources.values()] : undefined,
      });
      let appliqueAuto = false;
      if (plan.actions.length) {
        if (permis.ecrireSansValidation) {
          // Réglage « écrire sans validation » (désactivé par défaut) : appliqué tout de suite.
          const { reussies, erreurs } = appliquerPlan(plan);
          appliqueAuto = true;
          ajouter({
            type: "plan",
            plan,
            etat: "applique",
            bilan: erreurs.length
              ? `${reussies} ${tr("action(s) appliquée(s)", "action(s) applied")}, ${erreurs.length} ${tr("en échec", "failed")} :\n${erreurs.join("\n")}`
              : tr("Appliqué directement (réglage « écrire sans validation »).", "Applied directly (“write without approval” setting)."),
          });
        } else {
          ajouter({ type: "plan", plan, etat: "attente" });
        }
      }
      // L'historique garde la demande telle que tapée : la discussion jointe le gonflerait à chaque tour.
      memoriser({ role: "user", content: text }, { role: "assistant", content: reponse });
      if (appliqueAuto) memoriser({ role: "user", content: "(Ta proposition a été appliquée automatiquement.)" });
      // Sans cette mise au point, le tour suivant repartirait de sa fausse affirmation.
      if (rienFait) memoriser({ role: "user", content: "(Rien n'a été modifié : tu n'avais appelé aucun outil.)" });
      setAvailable(true);
    } catch (err) {
      if (controleur.signal.aborted) {
        ajouter({ type: "info", texte: tr("Réponse interrompue.", "Answer stopped.") });
      } else {
        ajouter({
          type: "info",
          erreur: true,
          texte: `${tr("Impossible de joindre Ollama en local (localhost:11434).", "Can't reach the local Ollama (localhost:11434).")} ${err instanceof Error ? err.message : ""}`,
        });
        setAvailable(false);
      }
    } finally {
      setEnCours(false);
      arret.current = null;
    }
  };

  const decider = (index: number, appliquer: boolean) => {
    const element = elements[index];
    if (!element || element.type !== "plan" || element.etat !== "attente") return;

    // L'application se fait ICI, jamais dans une fonction de mise à jour d'état :
    // React l'appelle deux fois en développement, et le plan était appliqué deux
    // fois (deux pages « Phase 2 » créées, la seconde vide).
    let maj: Element;
    if (!appliquer) {
      maj = { ...element, etat: "ecarte" };
    } else {
      const { reussies, erreurs } = appliquerPlan(element.plan);
      const bilan = erreurs.length
        ? `${reussies} ${tr("action(s) appliquée(s)", "action(s) applied")}, ${erreurs.length} ${tr("en échec", "failed")} :\n${erreurs.join("\n")}`
        : tr(
            `${reussies} action${reussies > 1 ? "s" : ""} appliquée${reussies > 1 ? "s" : ""}.`,
            `${reussies} action${reussies > 1 ? "s" : ""} applied.`
          );
      maj = { ...element, etat: "applique", bilan };
    }
    setElements((prev) => prev.map((e, i) => (i === index ? maj : e)));
    // Le modèle doit savoir ce qu'il est advenu de sa proposition au tour suivant.
    memoriser({
      role: "user",
      content: appliquer ? "(J'ai appliqué ta proposition.)" : "(J'ai écarté ta proposition, ne l'applique pas.)",
    });
  };

  // La page ouverte est déjà dans l'invite système : la recopier ici la ferait
  // envoyer deux fois, sur une carte graphique où chaque mot de contexte coûte.
  const inspirer = (consigne: string, libelle: string) => send(consigne, libelle);

  const resumer = () => {
    if (!activePage) return;
    if (getBlockText(activePage).trim().length < 10) {
      ajouter({ type: "info", texte: tr(
          `« ${activePage.title} » est vide (ou presque) — rien à résumer pour l'instant.`,
          `“${activePage.title}” is empty (or nearly) — nothing to summarise yet.`
        ) });
      return;
    }
    send(`Lis la page « ${pageToPath(activePage.id)} » et résume-la en quelques points clés.`, tr(`Résumer « ${activePage.title} »`, `Summarise “${activePage.title}”`));
  };

  const structurer = () => {
    if (!activePage) return;
    if (getBlockText(activePage).trim().length < 10) {
      ajouter({
        type: "info",
        texte: tr(
          `« ${activePage.title} » est vide (ou presque) — ajoute d'abord du texte à structurer, sinon l'IA invente un contenu sans rapport.`,
          `“${activePage.title}” is empty (or nearly) — add some text to structure first, otherwise the AI makes up unrelated content.`
        ),
      });
      return;
    }
    const chemin = pageToPath(activePage.id);
    send(
      `Lis la page « ${chemin} », puis propose avec add_content un tableau Markdown qui en structure les informations (première ligne = en-têtes).`,
      tr(`Structurer « ${activePage.title} » en tableau`, `Turn “${activePage.title}” into a table`)
    );
  };

  const secondes = Math.max(0, Math.round((Date.now() - debut) / 1000));

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} title={tr("Assistant IA — Ctrl J", "AI assistant — Ctrl J")} style={boutonRond}>
          ✦
        </button>
      )}

      {open && (
        <div style={panneau}>
          <div style={entete}>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Assistant</span>
              <span style={{ fontSize: 10.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                {modele ? `${modele} · local` : "Ollama · local"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {/* Seule sortie de Projekt vers internet : visible et coupable d'un clic. */}
              <button
                onClick={() => activerRechercheWeb(!web)}
                aria-pressed={web}
                title={
                  web
                    ? tr(
                        "Recherche Wikipédia activée : l'assistant peut y chercher des faits réels (seuls quelques mots-clés sortent de ton ordinateur, jamais tes pages). Clique pour la couper.",
                        "Wikipedia search on: the assistant can look up real facts there (only a few keywords leave your computer, never your pages). Click to turn it off."
                      )
                    : tr(
                        "Recherche Wikipédia coupée : l'assistant reste 100 % local. Clique pour l'activer.",
                        "Wikipedia search off: the assistant stays 100% local. Click to turn it on."
                      )
                }
                style={{
                  ...puce,
                  padding: "3px 8px",
                  fontSize: 11,
                  color: web ? "var(--accent2)" : "var(--text-dim)",
                  borderColor: web ? "var(--accent2)" : "var(--border)",
                  background: web ? "var(--accent2-soft)" : "transparent",
                }}
              >
                {web ? tr("🌐 Wikipédia", "🌐 Wikipedia") : tr("🔒 100 % local", "🔒 100% local")}
              </button>
              <button
                onClick={() => {
                  setVueReglages((v) => !v);
                  setVueConversations(false);
                  setVueMemoire(false);
                }}
                aria-pressed={vueReglages}
                title={tr("Réglages de l'assistant", "Assistant settings")}
                style={{ ...boutonDiscret, color: vueReglages ? "var(--accent)" : "var(--text-dim)" }}
              >
                ⚙
              </button>
              {projectId && (
                <button
                  onClick={() => {
                    setVueConversations((v) => !v);
                    setVueReglages(false);
                    setVueMemoire(false);
                  }}
                  aria-pressed={vueConversations}
                  title={tr("Conversations enregistrées", "Saved conversations")}
                  style={{ ...boutonDiscret, fontSize: 14, color: vueConversations ? "var(--accent)" : "var(--text-dim)" }}
                >
                  🗂
                </button>
              )}
              {projectId && (
                <button
                  onClick={() => {
                    setVueMemoire((v) => !v);
                    setVueReglages(false);
                    setVueConversations(false);
                  }}
                  aria-pressed={vueMemoire}
                  title={tr("Mémoire du projet", "Project memory")}
                  style={{ ...boutonDiscret, fontSize: 14, opacity: vueMemoire ? 1 : 0.7 }}
                >
                  🧠
                </button>
              )}
              {elements.length > 0 && (
                <button
                  onClick={nouvelleConversation}
                  disabled={enCours}
                  title={tr("Nouvelle conversation", "New conversation")}
                  style={boutonDiscret}
                >
                  ⟲
                </button>
              )}
              <button onClick={() => setOpen(false)} title={tr("Fermer — Ctrl J", "Close — Ctrl J")} style={boutonDiscret}>
                ×
              </button>
            </div>
          </div>

          {(available === false || (available && sansModele)) && (
            <AideOllama
              etat={available === false ? "absent" : "sansModele"}
              erreur={connectionError}
              onReessayer={() => void verifierOllama()}
              style={alerte}
            />
          )}

          {vueReglages && (
            <div className="scroll" style={volet}>
              <div style={titreVolet}>{tr("Ce que l'assistant a le droit de faire", "What the assistant may do")}</div>
              {LIBELLES_REGLAGES.map((l) => {
                const bloque = l.cle === "ecrireSansValidation" && !reglages.proposerModifications;
                const risque = l.cle === "ecrireSansValidation" && reglages.ecrireSansValidation;
                return (
                  <label key={l.cle} style={{ ...ligneReglage, opacity: bloque ? 0.5 : 1 }}>
                    <input
                      type="checkbox"
                      checked={reglages[l.cle]}
                      disabled={bloque}
                      onChange={(e) => changerReglagesIa({ [l.cle]: e.target.checked })}
                      style={{ accentColor: "var(--accent)", marginTop: 3 }}
                    />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "block", color: risque ? "var(--danger)" : "var(--text)" }}>{l.titre()}</span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>{l.aide()}</span>
                    </span>
                  </label>
                );
              })}
              <label style={ligneReglage}>
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", color: "var(--text)" }}>{tr("Réfléchir avant de répondre", "Think before answering")}</span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>
                    {tr("Plus juste, plus lent. « Auto » : seulement pour les questions sur le projet.", "More accurate, slower. “Auto”: only for questions about the project.")}
                  </span>
                </span>
                <select value={reglages.reflexion} onChange={(e) => changerReglagesIa({ reflexion: e.target.value as ModeReflexion })} style={selectStyle}>
                  <option value="auto">{tr("Auto", "Auto")}</option>
                  <option value="toujours">{tr("Toujours", "Always")}</option>
                  <option value="jamais">{tr("Jamais", "Never")}</option>
                </select>
              </label>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {tr(
                  "Dans tous les cas, l'assistant ne peut ni supprimer de pages, ni agir en dehors de Projekt. La recherche Wikipédia se règle avec le bouton 🔒 / 🌐.",
                  "Either way, the assistant can't delete pages or act outside Projekt. Wikipedia search is set with the 🔒 / 🌐 button."
                )}
              </div>
            </div>
          )}

          {vueMemoire && projectId && <MemoireVolet projectId={projectId} active={reglages.memoireProjet} style={volet} titreStyle={titreVolet} />}

          {vueConversations && projectId && (
            <div className="scroll" style={volet}>
              <div style={titreVolet}>{tr("Conversations de ce projet", "Conversations in this project")}</div>
              {!reglages.enregistrerConversations && (
                <div style={{ fontSize: 11.5, color: "var(--danger)" }}>
                  {tr("L'enregistrement est désactivé dans les réglages (⚙).", "Saving is turned off in the settings (⚙).")}
                </div>
              )}
              {conversations.filter((c) => c.projectId === projectId).length === 0 && (
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{tr("Aucune conversation enregistrée pour l'instant.", "No saved conversations yet.")}</div>
              )}
              {conversations
                .filter((c) => c.projectId === projectId)
                .map((c) => (
                  <div key={c.id} style={ligneConversation}>
                    <button onClick={() => ouvrirConversation(c)} disabled={enCours} style={boutonConversation} title={c.titre}>
                      <span
                        style={{
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: c.id === conversationId.current ? "var(--accent)" : "var(--text)",
                        }}
                      >
                        {c.titre || tr("Sans titre", "Untitled")}
                      </span>
                      <span style={{ display: "block", fontSize: 10.5, color: "var(--text-dim)" }}>
                        {new Date(c.majLe).toLocaleString(localeDates, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </button>
                    {aSupprimer === c.id ? (
                      <button
                        onClick={() => {
                          useConversationsStore.getState().supprimer(c.id);
                          if (c.id === conversationId.current) nouvelleConversation();
                          setASupprimer(null);
                        }}
                        style={{ ...puce, color: "var(--danger)", borderColor: "var(--danger)" }}
                      >
                        {tr("Supprimer", "Delete")}
                      </button>
                    ) : (
                      <button onClick={() => setASupprimer(c.id)} title={tr("Supprimer cette conversation", "Delete this conversation")} style={boutonDiscret}>
                        🗑
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )}

          <div ref={scrollRef} className="scroll" style={fil}>
            {elements.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, color: "var(--text-dim)", fontSize: 12.5 }}>
                <p style={{ margin: 0 }}>
                  {enAnglais ? (
                    <>
                      Ask a question about your project, ask for ideas or get help writing. The assistant reads your pages and{" "}
                      <strong>suggests</strong> changes: nothing changes without your approval.
                    </>
                  ) : (
                    <>
                      Pose une question sur ton projet, demande des idées ou fais-toi aider à écrire. L'assistant lit tes
                      pages et <strong>propose</strong> ses modifications : rien ne change sans ta validation.
                    </>
                  )}
                </p>
                <p style={{ margin: 0 }}>
                  {enAnglais ? (
                    <>
                      In a note, <kbd>Ctrl</kbd>+<kbd>Space</kbd> (or <kbd>Space</kbd> on an empty line) calls it right at the
                      cursor.
                    </>
                  ) : (
                    <>
                      Dans une note, <kbd>Ctrl</kbd>+<kbd>Espace</kbd> (ou <kbd>Espace</kbd> sur une ligne vide) l'appelle
                      directement à l'endroit du curseur.
                    </>
                  )}
                </p>
                <p style={{ margin: 0 }}>
                  {web
                    ? tr(
                        "Avec 🌐 Wikipédia (en haut), il peut aussi y vérifier des faits réels — mythes, histoire, jeux existants — et cite ses sources.",
                        "With 🌐 Wikipedia (at the top), it can also check real facts — myths, history, existing games — and cites its sources."
                      )
                    : tr(
                        "L'assistant reste 100 % sur ton ordinateur. Le bouton « 🔒 100 % local » (en haut) lui permet, si tu le veux, de vérifier des faits réels sur Wikipédia.",
                        "The assistant stays 100% on your computer. The “🔒 100% local” button (at the top) lets it check real facts on Wikipedia, if you want."
                      )}
                </p>
              </div>
            )}

            {elements.map((e, i) => (
              <Fragment key={i}>{rendreElement(e, i)}</Fragment>
            ))}

            {enCours && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-dim)", fontSize: 12.5 }}>
                <span className="pk-ia-pulse">●</span> {tr("Réflexion…", "Thinking…")} {secondes > 1 ? `${secondes} s` : ""}
                <button onClick={() => arret.current?.abort()} style={{ ...puce, marginLeft: "auto" }}>
                  ■ {tr("Arrêter", "Stop")}
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 12px 8px" }}>
            {activePage && (
              <>
                <button onClick={resumer} disabled={enCours} style={puce} title={tr("Résume la page ouverte", "Summarises the open page")}>
                  ✦ {tr("Résumer", "Summarise")}
                </button>
                <button onClick={structurer} disabled={enCours} style={puce} title={tr("Propose un tableau à partir de la page", "Suggests a table from the page")}>
                  ▦ {tr("En tableau", "As a table")}
                </button>
              </>
            )}
            {elements.some((e) => e.type === "assistant") && reglages.proposerModifications && (
              <>
                <button
                  onClick={() =>
                    send(tr("Fais une note de notre discussion.", "Make a note of our discussion."), tr("📝 Note de la discussion", "📝 Note of the discussion"), { transcription: true })
                  }
                  disabled={enCours}
                  style={puce}
                  title={tr("Résume la discussion dans une note, rangée dans « 💬 Discussions » (à valider)", "Summarises the discussion in a note, filed under “💬 Discussions” (to approve)")}
                >
                  📝 {tr("Note", "Note")}
                </button>
                <button
                  onClick={() =>
                    send(
                      "Retiens de notre discussion ce qui doit l'être : décisions prises, préférences, idées écartées et résumé du projet. Rien d'inventé.",
                      tr("🧠 Retenir", "🧠 Remember"),
                      { transcription: true }
                    )
                  }
                  disabled={enCours}
                  style={puce}
                  title={tr("Propose d'ajouter à « 🧠 Mémoire » ce qu'il faut retenir de la discussion (à valider)", "Suggests adding what matters from the discussion to “🧠 Memory” (to approve)")}
                >
                  🧠 {tr("Retenir", "Remember")}
                </button>
              </>
            )}
            {INSPIRATIONS.map((insp) => (
              <button
                key={insp.libelle}
                onClick={() => inspirer(insp.consigne, insp.libelle)}
                disabled={enCours}
                style={puce}
                title={insp.aide}
              >
                {insp.libelle}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            style={{ display: "flex", gap: 8, padding: 12, paddingTop: 0, flexShrink: 0 }}
          >
            <textarea
              ref={champ}
              value={input}
              rows={2}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Entrée envoie, Maj+Entrée va à la ligne — la convention des messageries.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={tr("Écris à l'assistant… (Maj+Entrée pour aller à la ligne)", "Write to the assistant… (Shift+Enter for a new line)")}
              style={champStyle}
            />
            <button type="submit" disabled={enCours || !input.trim()} style={boutonEnvoi}>
              ↵
            </button>
          </form>
        </div>
      )}
    </>
  );

  function rendreElement(e: Element, index: number): ReactNode {
    switch (e.type) {
      case "utilisateur":
        return <div style={{ ...bulle, ...bulleUtilisateur }}>{e.texte}</div>;
      case "assistant":
        return (
          <div style={{ ...bulle, ...bulleAssistant }}>
            {/* Le modèle écrit parfois « a été créée » alors que rien n'est encore
                fait : le bandeau dit la vérité, quoi qu'il ait écrit. */}
            {e.proposition && <div style={bandeauProposition}>
                {tr("Rien n'est encore appliqué — valide la proposition ci-dessous.", "Nothing is applied yet — approve the proposal below.")}
              </div>}
            {e.rienFait && (
              <div style={{ ...bandeauProposition, color: "var(--danger)" }}>
                ⚠{" "}
                {tr(
                  "Rien n'a été modifié : l'assistant n'a pas utilisé ses outils. Reformule, par exemple « écris … dans la page … ».",
                  "Nothing was changed: the assistant didn't use its tools. Rephrase, e.g. “write … in the page …”."
                )}
              </div>
            )}
            <TexteRiche texte={e.texte} projectId={projectId} onOpenPage={onOpenPage} />
            {e.sources && (
              <div style={sourcesStyle}>
                <span style={{ color: "var(--text-dim)" }}>{tr("Sources · Wikipédia", "Sources · Wikipedia")}</span>
                {e.sources.map((s) => (
                  <button key={s.url} onClick={() => openExternal(s.url)} style={lienSource} title={s.url}>
                    ↗ {s.titre}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      case "horsLigne":
        return (
          <div style={horsLigneStyle}>
            <strong>{tr("Mince ! Vous êtes hors ligne !", "Oops! You're offline!")}</strong>
            <span>
              {tr(
                "La recherche Wikipédia n'a pas pu se faire : l'assistant répond avec tes pages et ce qu'il sait déjà.",
                "The Wikipedia search couldn't run: the assistant answers from your pages and what it already knows."
              )}
            </span>
          </div>
        );
      case "outil":
        return (
          <div style={{ fontSize: 11.5, color: e.echec ? "var(--danger)" : "var(--text-dim)", paddingLeft: 4 }}>
            {e.echec ? "⚠ " : "· "}
            {e.texte}
          </div>
        );
      case "info":
        return <div style={{ fontSize: 12, color: e.erreur ? "var(--danger)" : "var(--text-dim)" }}>{e.texte}</div>;
      case "plan":
        return <CartePlan element={e} onDecider={(ok) => decider(index, ok)} />;
      case "planArchive":
        return (
          <div style={{ ...carte, opacity: 0.85 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--accent)" }}>
              {e.etat === "applique"
                ? tr("✓ Appliquée", "✓ Applied")
                : e.etat === "ecarte"
                  ? tr("Écartée", "Dismissed")
                  : tr("Proposition expirée (conversation rouverte)", "Expired proposal (reopened conversation)")}
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
              {e.actions.map((a, i) => (
                <li key={i}>{a.resume}</li>
              ))}
            </ol>
            {e.bilan && <div style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "pre-wrap" }}>{e.bilan}</div>}
          </div>
        );
    }
  }
}

/** La proposition de l'IA, avec ce qu'elle fera exactement, à appliquer ou écarter. */
function CartePlan({
  element,
  onDecider,
}: {
  element: Extract<Element, { type: "plan" }>;
  onDecider: (appliquer: boolean) => void;
}) {
  const [ouvert, setOuvert] = useState<number | null>(element.plan.actions.length === 1 ? 0 : null);
  const { plan, etat, bilan } = element;

  return (
    <div style={carte}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--accent)" }}>
        {etat === "attente"
          ? tr("Proposition — à valider", "Proposal — to approve")
          : etat === "applique"
            ? tr("✓ Appliquée", "✓ Applied")
            : tr("Écartée", "Dismissed")}
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
        {plan.actions.map((a, i) => (
          <li key={i} style={{ fontSize: 12.5 }}>
            {a.resume}
            {a.apercu && (
              <>
                {" "}
                <button onClick={() => setOuvert(ouvert === i ? null : i)} style={lienDiscret}>
                  {ouvert === i ? tr("masquer", "hide") : tr("voir le contenu", "show content")}
                </button>
                {ouvert === i && <pre style={apercuStyle}>{a.apercu}</pre>}
              </>
            )}
          </li>
        ))}
      </ol>
      {etat === "attente" && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onDecider(true)} style={boutonAppliquer}>
            {tr("Appliquer", "Apply")}
          </button>
          <button onClick={() => onDecider(false)} style={puce}>
            {tr("Annuler", "Cancel")}
          </button>
        </div>
      )}
      {bilan && <div style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "pre-wrap" }}>{bilan}</div>}
    </div>
  );
}

/* ---- Styles ---- */

const boutonRond: CSSProperties = {
  position: "fixed",
  right: 20,
  bottom: 20,
  width: 46,
  height: 46,
  borderRadius: "50%",
  border: "1px solid var(--border)",
  background: "var(--accent)",
  color: "var(--bg)",
  fontSize: 18,
  fontWeight: 700,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  zIndex: 40,
};

const panneau: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: 360,
  background: "var(--surface)",
  borderLeft: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  zIndex: 39,
  boxShadow: "-12px 0 32px rgba(0,0,0,0.35)",
};

const entete: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
  flexShrink: 0,
};

const volet: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 9,
  padding: 12,
  borderBottom: "1px solid var(--border)",
  background: "var(--surface-2)",
  maxHeight: "45%",
  overflowY: "auto",
  flexShrink: 0,
  fontSize: 12.5,
};

const titreVolet: CSSProperties = {
  fontSize: 10.5,
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
};

const ligneReglage: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" };

const selectStyle: CSSProperties = {
  fontSize: 12,
  padding: "3px 6px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
};

const ligneConversation: CSSProperties = { display: "flex", alignItems: "center", gap: 6 };

const boutonConversation: CSSProperties = {
  flex: 1,
  minWidth: 0,
  textAlign: "left",
  padding: "5px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  cursor: "pointer",
  fontSize: 12.5,
};

const boutonDiscret: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-dim)",
  fontSize: 16,
  width: 26,
  height: 26,
  borderRadius: 5,
};

const alerte: CSSProperties = {
  padding: 12,
  fontSize: 12.5,
  color: "var(--text-dim)",
  borderBottom: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const fil: CSSProperties = { flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 10 };

const bulle: CSSProperties = {
  maxWidth: "90%",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  lineHeight: 1.5,
  wordBreak: "break-word",
};

const bulleUtilisateur: CSSProperties = {
  alignSelf: "flex-end",
  background: "var(--accent-soft)",
  color: "var(--accent)",
  whiteSpace: "pre-wrap",
};

const bulleAssistant: CSSProperties = { alignSelf: "flex-start", background: "var(--surface-2)", color: "var(--text)" };

const puce: CSSProperties = {
  padding: "4px 9px",
  fontSize: 11.5,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
};

const carte: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--accent)",
  background: "var(--accent-soft)",
};

const boutonAppliquer: CSSProperties = {
  padding: "5px 12px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "var(--bg)",
  fontWeight: 600,
};

const lienDiscret: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--accent)",
  fontSize: 11.5,
  padding: 0,
  textDecoration: "underline",
  cursor: "pointer",
};

const apercuStyle: CSSProperties = {
  margin: "6px 0 0",
  padding: 8,
  maxHeight: 180,
  overflow: "auto",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  whiteSpace: "pre-wrap",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
};

const champStyle: CSSProperties = {
  flex: 1,
  resize: "none",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "7px 10px",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "inherit",
  lineHeight: 1.4,
};

const boutonEnvoi: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 6,
  border: "1px solid var(--accent)",
  background: "var(--accent-soft)",
  color: "var(--accent)",
  fontSize: 13,
  alignSelf: "stretch",
};

const bandeauProposition: CSSProperties = {
  fontSize: 11,
  color: "var(--accent)",
  marginBottom: 6,
  paddingBottom: 6,
  borderBottom: "1px solid var(--border)",
};

const sourcesStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "4px 6px",
  marginTop: 8,
  paddingTop: 6,
  borderTop: "1px solid var(--border)",
  fontSize: 11,
};

const lienSource: CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--accent2)",
  borderRadius: 4,
  padding: "0 5px",
  fontSize: 11,
  cursor: "pointer",
};

const horsLigneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px dashed var(--border)",
  fontSize: 12,
  color: "var(--text-dim)",
};
