#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/../VoxFill"
OUTPUT_DIR="$ROOT_DIR/downloads"
OUTPUT_FILE="$OUTPUT_DIR/voxfill-extension.zip"

if [ ! -f "$SOURCE_DIR/manifest.json" ]; then
  echo "Could not find VoxFill extension at $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_FILE"

cd "$SOURCE_DIR"
zip -qr "$OUTPUT_FILE" \
  manifest.json \
  popup.html \
  popup.css \
  popup.js \
  background.js \
  content-script.js \
  conversation-manager.js \
  form-filler.js \
  form-scanner.js \
  voice-engine.js \
  services \
  icons

echo "Created $OUTPUT_FILE"
