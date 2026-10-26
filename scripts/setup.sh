#!/bin/sh
# Installs the system tools Transporter needs (macOS / Homebrew) and the Whisper model.
set -e

cd "$(dirname "$0")/.."

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew est requis : https://brew.sh" >&2
  exit 1
fi

for pkg in yt-dlp ffmpeg whisper-cpp; do
  if brew list --formula "$pkg" >/dev/null 2>&1; then
    echo "✓ $pkg déjà installé (mise à jour…)"
    brew upgrade "$pkg" 2>/dev/null || true
  else
    brew install "$pkg"
  fi
done

MODEL=models/ggml-large-v3-turbo.bin
mkdir -p models
if [ -f "$MODEL" ]; then
  echo "✓ Modèle Whisper présent ($MODEL)"
else
  echo "Téléchargement du modèle Whisper large-v3-turbo (~1,6 Go)…"
  curl -L --fail -o "$MODEL.part" \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
  mv "$MODEL.part" "$MODEL"
fi

VAD=models/ggml-silero-v6.2.0.bin
if [ ! -f "$VAD" ]; then
  echo "Téléchargement du modèle de détection de voix (VAD)…"
  curl -L --fail -o "$VAD" https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin
fi

echo "Prêt. Lance « npm run dev » puis ouvre http://localhost:5173"
