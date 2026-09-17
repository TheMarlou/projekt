# Projekt

*[Read in English](README.md)*

**Un carnet de brainstorming pour créateurs de jeux vidéo.** Notes, moodboard et carte
mentale dans une seule fenêtre, avec un assistant qui tourne entièrement sur ton
ordinateur. Windows, gratuit, sans compte.

**[Télécharger pour Windows](https://github.com/TheMarlou/projekt/releases/latest)** ·
[Site](https://themarlou.github.io/projekt/) ·
[Signaler un problème](https://github.com/TheMarlou/projekt/issues/new/choose)

## Ce que ça fait

- **Notes** — pages imbriquées, mise en forme, images, tableaux, extraits audio, mentions
  entre pages.
- **Moodboard** — toile infinie : images, vidéos, et liens TikTok avec leur miniature.
- **Carte mentale** — le projet au centre, les pages autour ; liens tracés à la main
  (couleur et étiquette) ou proposés par l'IA, à garder ou à rejeter.
- **Assistant IA local** — il lit tes pages, répond, propose des idées, écrit au curseur,
  transforme une discussion en note et garde une mémoire des décisions du projet. Il
  **propose**, tu valides : rien n'est écrit sans toi. Ce qu'il a le droit de faire se
  règle dans son panneau.
- **Projekt Mobile** (Android) — partage un TikTok, une image, un lien ou un MP3 depuis ton
  téléphone, directement dans un projet, par ton réseau local. Sans cloud ni compte.
- **Recherche** (Ctrl+P), **thèmes**, **sauvegarde automatique** (7 dernières), **export
  et import** d'un projet en `.zip`, interface en **français et en anglais**.

## Installation

1. Télécharge `Projekt_x.y.z_x64-setup.exe` sur la
   [page des versions](https://github.com/TheMarlou/projekt/releases/latest) et lance-le.
2. Windows affichera « Éditeur inconnu » : *Informations complémentaires* → *Exécuter
   quand même*. L'application n'est pas signée (un certificat coûte plusieurs centaines
   d'euros par an) ; le code est ici, tu peux le lire et le compiler toi-même.
3. Au premier lancement, ouvre le **projet d'exemple** pour faire le tour.

### L'assistant IA (facultatif)

L'app fonctionne sans. Pour l'activer, installe [Ollama](https://ollama.com), puis ouvre
l'assistant (Ctrl+J) : il propose de télécharger son modèle pour toi (`qwen3:8b`, 5,2 Go,
et `gemma3:4b`, 3,3 Go, pour analyser les images). Une carte graphique d'au moins 6 Go est
conseillée.

### Projekt Mobile (facultatif)

1. Installe `Projekt-Mobile.apk` (sur la même page des versions) sur ton téléphone Android.
2. Mets le téléphone et le PC sur le même réseau.
3. Dans Projekt, clique sur 📱 et scanne le QR code depuis l'app.

Les mises à jour de l'app mobile sont ensuite proposées par le PC lui-même.

## Tes données

Tout reste sur ta machine : une base SQLite et tes fichiers dans
`%APPDATA%\app.projekt.desktop`. Aucun compte, aucun serveur, aucune mesure d'audience.
Quelques fonctions touchent à internet, et seulement si tu t'en sers : la recherche
Wikipédia de l'assistant (coupée par défaut), les vidéos TikTok du moodboard, le
téléchargement d'un modèle d'IA et la vérification des mises à jour (coupée par défaut).

## Développement

```bash
npm install
npm run tauri dev      # fenêtre de développement
npm run tauri build    # version finale + installateur
npm test               # garanties de l'assistant (rien n'est écrit sans validation…)
cd src-tauri && cargo test --lib
```

Tauri 2 (Rust) + React + TypeScript + SQLite ; app Android en Kotlin (`mobile/`). Aucun
service payant, aucune dépendance cloud.

## Licence

[PolyForm Shield 1.0.0](LICENSE) — résumé en français : [LICENCE-fr.md](LICENCE-fr.md).

En bref : l'app est gratuite et libre d'usage, y compris pour ton travail, et le code est
lisible par tous. Il est seulement interdit d'en faire un produit concurrent, payant ou
gratuit.

## Soutenir

Projekt est gratuit. Si l'app t'est utile, tu peux [offrir un café à son auteur](https://ko-fi.com/themarlou).
