#!/usr/bin/env bash
# SHIP THE ROOM THROUGH A VERSION. One command:
#
#   bash deploy.sh                credential, tree, build, gate, upload, deploy, read back, live gate
#   bash deploy.sh --allow-dirty  the same when tracked files are modified (the dirty list is printed)
#
# WHY A VERSION AND NOT `wrangler deploy`: a plain deploy prints success whether or not the build we
# meant is the build serving traffic, and it leaves no id this repo can hold the system to. A version
# does: `versions upload` mints an id, `versions deploy <id>@100%` names it, and this script then ASKS
# CLOUDFLARE WHICH VERSION IS SERVING and fails unless the answer is the id it uploaded. That
# read-back is the gate this script exists for: with `wrangler deploy` in its place there is no id to
# read back, and the script fails instead of reporting a deploy it cannot prove.
#
# NO SECRET AND NO ACCOUNT ID LIVE IN THIS FILE. ~/.hermes/scripts/cf_run.sh injects the account
# credential from the operator's vault, and the account is resolved from the zone at run time: this
# machine holds keys for three accounts, and neither a per-clone wrangler cache nor an interactive
# chooser gets to decide which account a deploy lands in.
#
# THE TREE IS WHAT SHIPS, so a modified tracked file is refused by default: in a shared checkout that
# is somebody else's half-written edit. Commit first, or pass --allow-dirty on purpose.
#
# Exit: 0 shipped and gated, 1 a stage failed (the way back is printed), 2 bad usage.

set -uo pipefail
cd "$(dirname "$0")"

NAME="${NAME:-agent-jam}"
ZONE="${ZONE:-zpe.vc}"
WRAPPER="${CF_RUN:-$HOME/.hermes/scripts/cf_run.sh}"

allow_dirty=0
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) allow_dirty=1 ;;
    *) printf 'usage: bash deploy.sh [--allow-dirty]\n' >&2; exit 2 ;;
  esac
done

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '%s\n' "$*"; }

note_failure() { red "FAIL  $1"; return 0; }

cf() { bash "$WRAPPER" "$@"; }

# The account that owns the zone. Read from Cloudflare, never from a config file: the id stays out of
# the repo, and the account is whichever one holds this zone rather than whichever one wrangler cached.
zone_account() {
  cf bash -c '
    if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
      curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/zones?name=$1"
    else
      curl -sS -H "X-Auth-Email: ${CLOUDFLARE_EMAIL:-}" -H "X-Auth-Key: ${CLOUDFLARE_API_KEY:-}" "https://api.cloudflare.com/client/v4/zones?name=$1"
    fi
  ' _ "$ZONE" 2>/dev/null \
    | sed -nE 's/.*"account":\{"id":"([^"]+)".*/\1/p' | head -1
}

# What Cloudflare says is serving RIGHT NOW: one "id@pct" row per version in the current deployment.
# `deployments status` answers the current state; `deployments list` is not ordered by recency and
# rows[0] can be an older version, which is the wrong id to hold the system to.
serving_rows() {
  cf npx wrangler deployments status --name "$NAME" --json 2>/dev/null | awk -F'"' '
    /"version_id"/ { id = $4 }
    /"percentage"/ { p = $3; gsub(/[^0-9]/, "", p); if (id != "") { print id "@" p; id = "" } }
  '
}

# The version id `versions upload` printed, or nothing. A read-back with no id is a FAILED read-back.
version_id_from() {
  grep -oE 'Version ID: *[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' "$1" \
    | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | tail -1
}

# ── 1. The credential, before anything is promised ───────────────────────────
step "[1/7] credential"
if [ ! -f "$WRAPPER" ]; then
  note_failure "the credential wrapper is missing: ${WRAPPER} (it lives outside this repo, by design)"
  step "way back: nothing ran, nothing was uploaded"
  exit 1
fi
account="${CLOUDFLARE_ACCOUNT_ID:-}"
if [ -z "$account" ]; then account="$(zone_account)"; fi
if [ -z "$account" ]; then
  note_failure "could not resolve the account that owns ${ZONE}: the wrapper answered no account"
  step "way back: nothing ran, nothing was uploaded"
  exit 1
fi
export CLOUDFLARE_ACCOUNT_ID="$account"
green "      ok (account ${account} holds ${ZONE})"

# ── 2. The tree, because the working tree is what ships ─────────────────────
step "[2/7] tree"
sha="$(git rev-parse --short HEAD)"
dirty="$(git status --porcelain=v1 --untracked-files=no)"
if [ -z "$dirty" ]; then
  green "      ok (clean at ${sha})"
elif [ "$allow_dirty" -eq 1 ]; then
  step "      allow-dirty: the WORKING TREE ships, not ${sha}:"
  printf '%s\n' "$dirty" | sed 's/^/        /'
else
  note_failure "the tree carries uncommitted changes to tracked files, and a deploy builds the WORKING TREE"
  printf '%s\n' "$dirty" | sed 's/^/        /'
  step "commit first, or ship the commit from a throwaway worktree at HEAD"
  step "pass --allow-dirty only when shipping the tree is what you mean"
  step "way back: nothing was uploaded, traffic did not move"
  exit 1
fi

# ── 3. Build, so the upload cannot ship a stale dist ────────────────────────
step "[3/7] build"
build_log="$(mktemp -t jam-build.XXXXXX)"
npm run build >"$build_log" 2>&1
build_rc=$?
if [ "$build_rc" -ne 0 ]; then
  tail -20 "$build_log"
  note_failure "npm run build exited ${build_rc}: nothing was uploaded"
  step "way back: nothing was uploaded, traffic did not move"
  exit 1
fi
bundle="$(grep -oE '/jam/assets/[^"]+\.js' dist/jam/index.html | head -1)"
if [ -z "$bundle" ]; then
  note_failure "the build wrote no /jam/assets bundle into dist/jam/index.html"
  step "way back: nothing was uploaded, traffic did not move"
  exit 1
fi
green "      ok (${bundle})"

# ── 4. The gate, against what is live NOW, before traffic moves ─────────────
step "[4/7] gate (bash check.sh: the suite and the four live probes, on the version serving now)"
bash check.sh
gate_rc=$?
if [ "$gate_rc" -ne 0 ]; then
  note_failure "bash check.sh exited ${gate_rc}: refusing to move traffic onto a tree the repo's gate refuses"
  step "way back: nothing was uploaded, traffic did not move"
  exit 1
fi
green "      ok (bash check.sh exited 0)"

# ── 5. Upload a version. This does NOT move traffic. ────────────────────────
step "[5/7] upload"
serving_before="$(serving_rows | head -1)"
[ -z "$serving_before" ] && serving_before="unknown"
upload_log="$(mktemp -t jam-upload.XXXXXX)"
cf npx wrangler versions upload --name "$NAME" --message "deploy.sh ${sha}" >"$upload_log" 2>&1
upload_rc=$?
id="$(version_id_from "$upload_log")"
if [ "$upload_rc" -ne 0 ] || [ -z "$id" ]; then
  tail -20 "$upload_log"
  note_failure "versions upload printed no Worker Version ID (exit ${upload_rc}): a deploy cannot be proved without one"
  step "way back: nothing moved, the version serving is ${serving_before}"
  exit 1
fi
printf 'uploaded %s\n' "$id"
preview="$(grep -oE 'Version Preview URL: *https://[^ ]+' "$upload_log" | sed 's/.*: *//' | tail -1)"
[ -n "$preview" ] && step "          preview (not serving traffic): ${preview}"

# ── 6. Move traffic, then ask Cloudflare what is serving ────────────────────
step "[6/7] deploy"
step "      serving before: ${serving_before}"
deploy_log="$(mktemp -t jam-deploy.XXXXXX)"
cf npx wrangler versions deploy "${id}@100%" --name "$NAME" --message "deploy.sh ${sha}" --yes >"$deploy_log" 2>&1
deploy_rc=$?
if [ "$deploy_rc" -ne 0 ]; then
  tail -20 "$deploy_log"
  note_failure "versions deploy exited ${deploy_rc}: ${id} was uploaded but traffic did not move"
  step "way back: the version serving is still ${serving_before}"
  exit 1
fi

# THE READ-BACK. Cloudflare's answer, retried briefly because a deployment's state settles a moment
# after the call returns. It must name ONE version, at 100%, and that version must be the one we
# uploaded: anything else is traffic on a build this script did not ship.
live=""
attempt=0
while [ "$attempt" -lt 6 ]; do
  live="$(serving_rows)"
  [ "$live" = "${id}@100" ] && break
  attempt=$((attempt + 1))
  [ "$attempt" -lt 6 ] && sleep 2
done
if [ -z "$live" ]; then
  note_failure "the read-back printed no version: Cloudflare never said what is serving"
  step "way back: bash HALT ${serving_before%@*} (rolls to the version that served before this deploy)"
  exit 1
fi
if [ "$live" != "${id}@100" ]; then
  note_failure "the version serving is ${live}, NOT the one just uploaded (${id}@100%): traffic is on another build"
  step "way back: bash HALT ${serving_before%@*} (rolls to the version that served before this deploy)"
  exit 1
fi
step "      read back: ${live} (Cloudflare's own answer, matches the upload)"
printf 'deployed %s@100%%\n' "$id"

# ── 7. The live gate, on the version just named ─────────────────────────────
step "[7/7] gate (bash check.sh --live --version ${id})"
bash check.sh --live --version "$id"
live_rc=$?
if [ "$live_rc" -ne 0 ]; then
  note_failure "the live gate failed on ${id}, which IS what is serving: the bytes are live and the gate said no"
  step "way back: bash HALT ${serving_before%@*}"
  exit 1
fi

green "deploy.sh: ${id} is serving 100% and the live gate passed"
step "rollback: bash HALT ${serving_before%@*}"
step "          (the version serving before this deploy was ${serving_before})"
exit 0
