# Transporter

Colle un lien TikTok et récupère :

- **Vidéo** : le MP4 (sans filigrane) et sa transcription (texte, horodatée, `.txt`, `.srt`)
- **Carrousel photo** : toutes les slides en `.zip` (et le son en `.mp3`), et le texte écrit sur chaque slide,
  mot pour mot (à copier, ou en `.txt`, aussi inclus dans le zip)
- **Compte** (`tiktok.com/@compte`) : l'URL de chaque post (à copier, ou en `.txt` / `.csv` avec type, date,
  description, vues, likes), et un bouton pour récupérer n'importe quel post de la liste
- **Texte de tous les carrousels d'un compte** : depuis la liste d'un compte, « Extraire le texte » lit chaque slide
  de chaque carrousel (les vidéos sont ignorées), puis exporte :
  - `.csv` : une ligne par carrousel (url, date, description, vues, likes, texte complet, puis une colonne par slide)
  - `.json` : la même chose structurée, pour un script ou un outil
  - `.md` : lisible, pratique à coller dans un assistant IA

Tout tourne en local : aucune API payante, aucune donnée envoyée ailleurs qu'à TikTok.

## Prérequis

- **macOS** (Apple Silicon recommandé : sur Mac Intel la transcription est nettement plus lente)
- [Homebrew](https://brew.sh) (il installe aussi les outils de ligne de commande Xcode, utilisés pour compiler l'OCR)
- [Node.js](https://nodejs.org) 22 ou plus récent

## Installation

```bash
git clone https://github.com/ssoossaa/Transporter.git
cd Transporter
npm run setup         # yt-dlp, ffmpeg, whisper.cpp + modèles (~1,6 Go, quelques minutes)
npm install
npm run install-app   # ouvre http://localhost:3737
```

Ajoute **http://localhost:3737** à tes favoris (⌘D), c'est tout.

## Utiliser depuis un favori (sans terminal)

`npm run install-app` ne s'exécute qu'une fois. Rien ne tourne en arrière-plan : macOS (launchd) réserve
juste l'adresse, démarre le serveur quand tu ouvres la page (~0,1 s), et le serveur s'arrête tout seul 2 minutes
après la fermeture de l'onglet (jamais pendant un traitement). Il redémarre aussi tout seul après un redémarrage du Mac.

- Après une modification du code, ou un changement de version de Node : relance `npm run install-app`.
- Journal : `~/Library/Logs/Transporter.log`
- Désinstaller : `npm run uninstall-app` (tes fichiers dans `data/` sont conservés).
- Changer le port ou le délai : `TRANSPORTER_PORT=4000 TRANSPORTER_IDLE_MINUTES=5 npm run install-app`

## Développement

```bash
npm run dev       # http://localhost:5173 (rechargement à chaud)
npm start         # build + serveur unique sur http://localhost:3001
```

## Comment ça marche

```
lien TikTok
  └─ server/tiktok.js    lit la page TikTok → vidéo ou carrousel ? (+ URLs des slides)
       ├─ vidéo     → yt-dlp (MP4 H.264) → ffmpeg (WAV 16 kHz) → whisper.cpp (+ VAD) → texte / SRT
       └─ carrousel → téléchargement des slides → OCR macOS (texte de chaque slide) → zip
lien de compte → yt-dlp --flat-playlist (liste sans rien télécharger) → URLs, .txt, .csv
  └─ texte des carrousels → pour chaque carrousel (3 à la fois) : page TikTok → slides → OCR → .csv / .json / .md
```

| Brique | Rôle | Pourquoi |
| --- | --- | --- |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Télécharge la vidéo | ~200k ★, release quasi hebdo : suit les changements de TikTok |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | Transcription | Port C++ de Whisper, accéléré Metal sur Apple Silicon (quelques secondes par vidéo) |
| `large-v3-turbo` | Modèle Whisper | Quasi la qualité de large-v3, ~8× plus rapide |
| Silero VAD | Détection de voix | Évite que Whisper invente du texte sur la musique |
| Apple Vision | Texte des slides (OCR) | Le moteur de « Texte en direct » de macOS : déjà installé, local, excellent en français |
| Express + React (Vite) | Serveur + interface | — |

yt-dlp ne gère pas les carrousels photo : on lit donc directement les données embarquées dans la page TikTok.

TikTok ne stocke pas le texte des carrousels à part : il est incrusté dans les images, d'où l'OCR
(`scripts/ocr/ocr.swift`, compilé dans `bin/` par `npm install` et `npm run install-app`). La correction
automatique est désactivée pour garder le texte exact, fautes de l'auteur comprises. Le texte isolé dans la photo
(un numéro sur une pancarte…) est écarté, comme tout ce que Vision lit avec une confiance faible. Limites : un élément
de la photo qui traverse le texte peut ajouter un caractère, et une photo pleine d'écriture (notes manuscrites,
tableau d'équations) laisse passer quelques fragments.

yt-dlp liste tous les posts d'un compte sous une URL `/video/` ; la miniature des carrousels (« photomode »)
permet de les reconnaître sans ouvrir chaque post, et de donner leur vraie URL `/photo/`.

## Réglages (variables d'environnement)

| Variable | Défaut |
| --- | --- |
| `WHISPER_LANGUAGE` | `auto` (mettre `fr` pour forcer le français) |
| `WHISPER_MODEL` | `models/ggml-large-v3-turbo.bin` |
| `WHISPER_VAD_MODEL` | `models/ggml-silero-v6.2.0.bin` |
| `API_PORT` | `3001` |
| `OCR_BIN` | `bin/transporter-ocr` |
| `DATA_DIR` | `data` (les fichiers générés, un dossier par lien) |

## Si TikTok casse le téléchargement

TikTok change régulièrement son site ; yt-dlp suit en général en quelques jours :

```bash
brew upgrade yt-dlp
```
