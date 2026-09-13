import { describe, expect, it } from "vitest";
import {
  contenuPourQuestion,
  demandeDeMemoriser,
  demandeDeModification,
  demandeSurCapacites,
  demandeUneNoteDeDiscussion,
  questionSurLeProjet,
  transcrire,
  verifierReponse,
} from "./iaVerite";

const ctx = (surcharge = {}) => ({
  cheminExiste: (c: string) => c === "Mon jeu > Boss",
  aLu: false,
  extraitsFournis: false,
  ...surcharge,
});

describe("vérification des réponses", () => {
  it("repère une page citée qui n'existe pas", () => {
    expect(verifierReponse("Voir « Mon jeu > Boss ».", ctx())).toBeNull();
    expect(verifierReponse("Voir « Mon jeu > Armes ».", ctx())).toContain("Mon jeu > Armes");
  });

  it("ne prend pas une page à créer pour une page inventée", () => {
    expect(verifierReponse("La page « Mon jeu > Quêtes » n'existe pas encore : je propose de la créer.", ctx())).toBeNull();
    expect(verifierReponse("Les quêtes sont dans « Mon jeu > Quêtes ».", ctx())).toContain("Mon jeu > Quêtes");
  });

  it("ne laisse pas proposer une modification interdite", () => {
    const texte = "Je propose de créer une page « Mon jeu > Quêtes ».";
    expect(verifierReponse(texte, ctx({ peutModifier: false }))).toContain("⚙");
    expect(verifierReponse(texte, ctx())).toBeNull();
    expect(verifierReponse("Je ne peux pas créer de page : c'est désactivé.", ctx({ peutModifier: false }))).toBeNull();
    expect(demandeDeModification("Est-ce que tu peux créer une page pour mes quêtes ?")).toBe(true);
    expect(demandeDeModification("Qui est le boss ?")).toBe(false);
  });

  it("refuse « ce n'est pas dans les pages » sans avoir cherché", () => {
    expect(verifierReponse("La date n'est pas mentionnée dans les pages.", ctx())).toContain("search_pages");
    expect(verifierReponse("La date n'est pas mentionnée dans les pages.", ctx({ aLu: true }))).toBeNull();
  });

  it("fait lire une page tronquée plutôt que deviner", () => {
    const relance = verifierReponse("La phase 3 est tronquée dans le contenu fourni.", ctx({ pageTronquee: true, pageOuverte: "Mon jeu > Boss" }));
    expect(relance).toContain("read_page");
    expect(verifierReponse("La phase 3 est tronquée.", ctx({ pageTronquee: true, aLu: true }))).toBeNull();
  });
});

describe("page longue", () => {
  it("garde le début ET le passage qui répond à la question", () => {
    const md = `## Début\nIntro.\n${"Remplissage sans intérêt.\n".repeat(400)}\n## Phase 3\nLe virus Ouroboros inverse les commandes.`;
    const { texte, tronque } = contenuPourQuestion(md, "Que fait le virus pendant la phase 3 ?", 2500);
    expect(tronque).toBe(true);
    expect(texte.length).toBeLessThan(2700);
    expect(texte).toContain("## Début");
    expect(texte).toContain("Ouroboros");
  });

  it("ne touche pas une page courte", () => {
    expect(contenuPourQuestion("Court.", "question", 2500)).toEqual({ texte: "Court.", tronque: false });
  });
});

describe("intentions", () => {
  it("reconnaît une question sur le projet, pas une demande d'idées", () => {
    expect(questionSurLeProjet("Quelle est la faiblesse du boss ?")).toBe(true);
    expect(questionSurLeProjet("Donne-moi 3 idées de noms pour le boss ?")).toBe(false);
    expect(questionSurLeProjet("Bonjour")).toBe(false);
  });

  it("reconnaît une question sur ses capacités, pas une demande de création", () => {
    expect(demandeSurCapacites("Qu'est-ce que tu peux faire pour moi dans Projekt ?")).toBe(true);
    expect(demandeSurCapacites("Quelles sont tes permissions ?")).toBe(true);
    expect(demandeSurCapacites("Est-ce que tu peux créer une page pour mes quêtes ?")).toBe(false);
    expect(questionSurLeProjet("Qu'est-ce que tu peux faire ?")).toBe(false);
  });

  it("reconnaît une note de discussion et une demande de mémoire", () => {
    expect(demandeUneNoteDeDiscussion("Fais une note de notre discussion")).toBe(true);
    expect(demandeUneNoteDeDiscussion("Résume la page Boss")).toBe(false);
    expect(demandeDeMemoriser("Retiens que le boss s'appelle NÉMÉSIS")).toBe(true);
  });

  it("transcrit la discussion en coupant le début si elle est trop longue", () => {
    const echanges = Array.from({ length: 40 }, (_, i) => ({ qui: i % 2 ? ("assistant" as const) : ("utilisateur" as const), texte: `message ${i} ${"x".repeat(200)}` }));
    const t = transcrire(echanges, 2000);
    expect(t.startsWith("[… début de la discussion omis]")).toBe(true);
    expect(t).toContain("message 39");
  });
});
