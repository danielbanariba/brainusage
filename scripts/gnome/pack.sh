#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXTENSION_DIR="$ROOT_DIR/extension"
ZIP_NAME="brainusage@altairinglorious.shell-extension.zip"
ZIP_PATH="$ROOT_DIR/$ZIP_NAME"

if ! command -v gnome-extensions >/dev/null 2>&1; then
  printf 'Error: gnome-extensions is not installed or not on PATH.\n' >&2
  exit 1
fi

# Vendor the shared core into extension/lib before packing.
bash "$ROOT_DIR/scripts/build/sync-core.sh"

gnome-extensions pack "$EXTENSION_DIR" \
  --force \
  --schema=schemas/org.gnome.shell.extensions.brainusage.gschema.xml \
  --extra-source=lib \
  --extra-source=assets \
  --out-dir "$ROOT_DIR"

if [[ -f "$ZIP_PATH" ]]; then
  printf 'Packed: %s\n' "$ZIP_PATH"
else
  printf 'Error: expected archive not found at %s\n' "$ZIP_PATH" >&2
  exit 1
fi
