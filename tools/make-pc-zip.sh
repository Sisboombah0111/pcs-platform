#!/usr/bin/env bash
# The PC version as one zip: every file of the repository (as checked out: start-windows.cmd with Windows line
# endings) plus the built app (dist/, GridCraft and the examples included), in a folder named pcs-app.
# Unzip, open pcs-app, double-click start-windows.cmd: nothing to install but Node.js.
# Usage (after `npm run build`): bash tools/make-pc-zip.sh pcs-platform-v5.1.0.zip
set -euo pipefail
out="$(realpath -m "$1")"
[ -f dist/index.html ] || { echo "dist/index.html is missing: run npm run build first" >&2; exit 1; }
[ -f dist/gridcraft/index.html ] || { echo "dist/gridcraft is missing: run node tools/fetch-gridcraft.mjs before the build" >&2; exit 1; }
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/pcs-app"
git ls-files -z | while IFS= read -r -d '' f; do
  mkdir -p "$stage/pcs-app/$(dirname "$f")"
  cp -p "$f" "$stage/pcs-app/$f"
done
cp -r dist "$stage/pcs-app/dist"
rm -f "$out"
(cd "$stage" && zip -qr -X "$out" pcs-app)
echo "$out: $(unzip -l "$out" | tail -1 | awk '{print $2}') files, $(du -h "$out" | cut -f1)"
