# Projekt

*[Lire en français](README.fr.md)*

**A brainstorming notebook for game creators.** Notes, moodboard and mind map in a single
window, with an AI assistant that runs entirely on your own computer. Windows, free, no
account.

**[Download for Windows](https://github.com/TheMarlou/projekt/releases/latest)** ·
[Website](https://themarlou.github.io/projekt/en/) ·
[Report a problem](https://github.com/TheMarlou/projekt/issues/new/choose)

## What it does

- **Notes** — nested pages, rich text, images, tables, audio clips, mentions between pages.
- **Moodboard** — an endless canvas for images, videos, and TikTok links with their thumbnail.
- **Mind map** — the project in the middle, pages around it; links you draw (colour and
  label) or links the AI suggests, which you keep or reject.
- **Local AI assistant** — reads your pages, answers, suggests ideas, writes at the cursor,
  turns a discussion into a note, and keeps a memory of your project's decisions. It
  **suggests**, you approve: nothing is written without you. What it may do is set in its
  own settings panel.
- **Projekt Mobile** (Android) — share a TikTok, an image, a link or an MP3 from your phone
  straight into a project, over your home network. No cloud, no account.
- **Search** (Ctrl+P), **themes**, **automatic backups** (last 7), **export and import** of a
  project as a `.zip`, interface in **English and French**.

## Install

1. Download `Projekt_x.y.z_x64-setup.exe` from the
   [releases page](https://github.com/TheMarlou/projekt/releases/latest) and run it.
2. Windows will say "Unknown publisher": *More info* → *Run anyway*. The app isn't signed
   (a certificate costs several hundred euros a year); the code is right here, you can read
   it and build it yourself.
3. On first launch, open the **sample project** to look around.

### The AI assistant (optional)

The app works without it. To turn it on, install [Ollama](https://ollama.com), then open
the assistant (Ctrl+J): it offers to download its model for you (`qwen3:8b`, 5.2 GB, plus
`gemma3:4b`, 3.3 GB, to analyse images). A graphics card with 6 GB or more is recommended.

### Projekt Mobile (optional)

1. Install `Projekt-Mobile.apk` (on the same releases page) on your Android phone.
2. Put the phone and the PC on the same network.
3. In Projekt, click 📱 and scan the QR code from the app.

Later updates of the mobile app are offered by the PC itself.

## Your data

Everything stays on your computer: one SQLite database and your files in
`%APPDATA%\app.projekt.desktop`. No account, no server, and no usage statistics unless you turn them on (anonymous, never your content: ☰ → Help). A few features go
online, and only when you use them: the assistant's Wikipedia lookup (off by default),
TikTok videos on the moodboard, downloading an AI model, and the update check (off by
default).

## Development

```bash
npm install
npm run tauri dev      # development window
npm run tauri build    # release build + installer
npm test               # assistant guarantees (nothing written without approval…)
cd src-tauri && cargo test --lib
```

Tauri 2 (Rust) + React + TypeScript + SQLite; Android app in Kotlin (`mobile/`). No paid
service, no cloud dependency. The code and its comments are in French.

## Licence

[PolyForm Shield 1.0.0](LICENSE). In short: the app is free to use, including for work,
and its code is open to read. The only thing you may not do is build a competing product
from it, paid or free.
