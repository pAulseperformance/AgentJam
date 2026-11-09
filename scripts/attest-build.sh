#!/bin/sh
# THE ARTIFACT THIS APP'S MANIFEST NAMES: the worker bundle the deploy uploads, plus every byte
# `npm run build` emits into ./dist. Called by `attest_page.py --build` (and `--build --check`) with
# an output directory as $1, from the repo root.
#
# WHY THE CLIENT IS IN HERE. This app's page is a static shell out of ./dist/jam: the Worker composes
# the estate's chrome around it and decides when to serve it, while the asset layer ships the bytes.
# A digest of the worker bundle alone would keep naming an older build after a client change shipped,
# because a `dist` change never touches index.js. So the signed artifact is both halves.
#
# The build is re-run on every call, including the check: `--build --check` must prove this tree
# produces the artifact the manifest names, not that ./dist was right the last time it ran. Both
# halves are byte-stable (measured 2026-11-07: two `npm run build` runs hashed identically, and two
# `wrangler deploy --dry-run` runs produced the same index.js), which is what makes that a check
# rather than a coin toss.
set -e
cd "$(dirname "$0")/.."
out="$1"
[ -n "$out" ] || { echo "attest-build: needs an output directory as \$1" >&2; exit 1; }

npm run build >/dev/null
mkdir -p "$out/worker"
npx --no-install wrangler deploy --dry-run --outdir "$out/worker" >/dev/null
[ -f "$out/worker/index.js" ] || { echo "attest-build: wrangler produced no worker/index.js" >&2; exit 1; }

{
  echo "zpe jam deploy artifact v1"
  echo "worker index.js sha256 $(shasum -a 256 "$out/worker/index.js" | cut -d' ' -f1)"
  echo "assets"
  ( cd dist && find . -type f | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f"
    done )
} > "$out/index.js"
