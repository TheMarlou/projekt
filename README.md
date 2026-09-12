# Projekt

**Un carnet de brainstorming pour créateurs de jeux vidéo.** Notes, moodboard et carte
mentale dans une seule fenêtre, avec un assistant qui tourne entièrement sur votre
ordinateur. Windows, gratuit, sans compte.

## Ce que ça fait

- **Notes** — pages imbriquées, mise en forme, images, tableaux, extraits audio, mentions
  entre pages.
- **Moodboard** — toile infinie : images, vidéos, et liens TikTok avec leur miniature.
- **Carte mentale** — le projet au centre, les pages autour ; liens tracés à la main
  (couleur et étiquette) ou proposés par l'IA, à garder ou à rejeter.
- **Assistant IA local** — il lit vos pages, répond, propose des idées, écrit au curseur.
  Il **propose**, vous validez : rien n'est écrit sans vous.
- **Recherche** (Ctrl+P), **thèmes**, **sauvegarde automatique** (7 dernières), **export
  et import** d'un projet en `.zip`.

## Installation

1. Téléchargez `Projekt_x.y.z_x64-setup.exe` et lancez-le.
2. Windows affichera « Éditeur inconnu » : *Informations complémentaires* → *Exécuter
   quand même*. L'application n'est pas signée (un certificat coûte plusieurs centaines
   d'euros par an) ; le code est ici, vous pouvez le lire et le compiler vous-même.

### Pour l'assistant IA (facultatif)

L'app fonctionne sans. Pour l'activer :

1. Installez [Ollama](https://ollama.com) ;
2. `ollama pull qwen3:8b` (texte, ~5 Go) et `ollama pull gemma3:4b` (analyse d'images, ~3 Go) ;
3. Relancez Projekt. Une carte graphique d'au moins 6 Go est conseillée.

## Vos données

Tout reste sur votre machine : une base SQLite et vos fichiers dans
`%APPDATA%\app.projekt.desktop`. Aucun compte, aucun serveur, aucune mesure d'audience.
Deux fonctions touchent à internet, et seulement si vous les utilisez : la recherche
Wikipédia de l'assistant (coupée par défaut), et les liens TikTok du moodboard.

## Développement

```bash
npm install
npm run tauri dev      # fenêtre de développement
npm run tauri build    # version finale + installeur
cd src-tauri && cargo test --lib
```

Tauri 2 (Rust) + React + TypeScript + SQLite. Aucun service payant, aucune dépendance cloud.

## Licence

MIT — voir [LICENSE](LICENSE).
