#!/usr/bin/env bash
# THE REPO'S OWN GATE, in one command.
#
# check.sh wraps the gate this repo already declares (`npm test` -> `vitest run`, package.json:17)
# and adds the readings a suite cannot make: the live surface, the shell's own asset, the room
# socket's refusal on the app's own host, and the tier endpoint.
#
# Why a FLOOR and not just "tests pass": a suite that silently stops collecting tests also exits 0,
# so the pass COUNT is asserted against a number. Raise FLOOR in the same commit as any test that
# lands, or the floor stops meaning anything.
#
#   bash check.sh                          suite + five live readings: four probes and the version serving
#   bash check.sh --live                   the above, then the page walk from docs/PATHS.md
#   bash check.sh --live --version <id>    the above, and fails unless <id> is the version carrying 100%
#
# Exit: 0 everything answered, 1 a check failed, 2 bad usage. On failure it prints the way back.

set -uo pipefail
cd "$(dirname "$0")"

FLOOR="${FLOOR:-216}"
BASE="${BASE:-https://zpe.vc}"
APP_HOST="${APP_HOST:-jam.zpe.vc}"
APP_NAME="${APP_NAME:-agent-jam}"
WRAPPER="${CF_RUN:-$HOME/.hermes/scripts/cf_run.sh}"
WALK=0
WANT_VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --live) WALK=1 ;;
    --version) WANT_VERSION="${2:-}"; [ $# -gt 1 ] && shift ;;
    --version=*) WANT_VERSION="${1#--version=}" ;;
    *) printf 'usage: bash check.sh [--live] [--version <version-id>]\n' >&2; exit 2 ;;
  esac
  shift
done

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '%s\n' "$*"; }

failures=0
failed_on=""
unverified=0

note_failure() {
  failures=$((failures + 1))
  red "FAIL  $1"
  [ -z "$failed_on" ] && failed_on="$1"
}

# The credential wrapper injects the Cloudflare account credential from the operator's vault, so this
# script carries no secret either. The version step is the only part that needs it.
cf() { bash "$WRAPPER" "$@"; }

# What Cloudflare says is serving right now: one "id@pct" row per version in the current deployment.
# `deployments status` answers the CURRENT state; `deployments list` is not ordered by recency.
serving_rows() {
  cf npx wrangler deployments status --name "$APP_NAME" --json 2>/dev/null | awk -F'"' '
    /"version_id"/ { id = $4 }
    /"percentage"/ { p = $3; gsub(/[^0-9]/, "", p); if (id != "") { print id "@" p; id = "" } }
  '
}

# ── 1. The suite, with a floor ────────────────────────────────────────────────
step "[1/6] suite"
suite_log="$(mktemp -t jam-suite.XXXXXX)"
npx vitest run >"$suite_log" 2>&1
suite_rc=$?
passed="$(grep -oE 'Tests[[:space:]]+[0-9]+ passed' "$suite_log" | grep -oE '[0-9]+' | head -1)"
passed="${passed:-0}"
step "      tests passed: ${passed} (floor ${FLOOR})"
if [ "$suite_rc" -ne 0 ]; then
  tail -20 "$suite_log"
  note_failure "the suite exited ${suite_rc}"
elif [ "$passed" -lt "$FLOOR" ]; then
  note_failure "the suite ran ${passed} tests, below the floor of ${FLOOR}"
else
  green "      ok"
fi

# ── 2. The mount answers its shell ───────────────────────────────────────────
step "[2/6] live: the mount shell"
# A FRESH file every run: reading a shell fetched by an earlier run is a pass over a stale artifact,
# and the first version of this script did exactly that when the base was dead.
shell_file="$(mktemp -t jam-shell.XXXXXX)"
shell_ok=0
code="$(curl -s -o "$shell_file" -w '%{http_code}' "${BASE}/jam/")"
if [ "$code" = "200" ] && grep -q 'AgentJam' "$shell_file"; then
  shell_ok=1
  green "      ok (200, title present)"
else
  note_failure "GET /jam/ answered ${code} and the shell named no AgentJam"
fi

# ── 3. The shell's own asset resolves, and it is THIS tree's build ──────────
step "[3/6] live: the shell's asset"
asset=""
[ "$shell_ok" -eq 1 ] && asset="$(grep -oE '/jam/assets/[^"]+\.js' "$shell_file" | head -1)"
if [ "$shell_ok" -eq 0 ]; then
  note_failure "the asset probe did not run: the shell was never fetched"
elif [ -z "$asset" ]; then
  note_failure "the shell names no /jam/assets script"
else
  code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}${asset}")"
  # A hash that resolves proves a build happened; the hash being THIS tree's proves which build it
  # was. parity is the reading that catches a deploy of a stale dist, and the one a version id
  # cannot answer on its own.
  built="$(grep -oE '/jam/assets/[^"]+\.js' dist/jam/index.html 2>/dev/null | head -1)"
  if [ "$code" != "200" ]; then
    note_failure "${asset} answered ${code}"
  elif [ -z "$built" ]; then
    unverified=$((unverified + 1))
    green "      ok (${asset} 200)"
    step "      not asserted: no build in dist/ (bash deploy.sh builds it), so the live bundle is not compared to this tree"
  elif [ "$built" != "$asset" ]; then
    note_failure "the live shell serves ${asset} and this tree builds ${built}: what is serving is not this tree (bash deploy.sh ships it)"
  else
    green "      ok (${asset} 200, the bundle this tree builds)"
  fi
fi

# ── 4. The room route exists on the app's own host (426, not 404) ────────────
step "[4/6] live: the room socket route"
code="$(curl -s -o /dev/null -w '%{http_code}' "https://${APP_HOST}/api/room/check/ws")"
if [ "$code" = "426" ]; then
  green "      ok (426 Expected WebSocket upgrade)"
else
  note_failure "GET https://${APP_HOST}/api/room/check/ws answered ${code}, not 426"
fi

# ── 5. The tier endpoint ─────────────────────────────────────────────────────
step "[5/6] live: the tier endpoint"
body="$(curl -s "${BASE}/jam/api/whoami")"
if printf '%s' "$body" | grep -q '"tier":"public"'; then
  green "      ok (anonymous reads the public tier)"
else
  note_failure "whoami answered without the public tier: ${body:0:120}"
fi

# ── 6. The version serving, and whether it is the one the caller named ──────
step "[6/6] live: the version serving"
# THE VERSION GATE. `wrangler deploy` prints success whether or not the build meant to ship is the
# build serving traffic, so an id is the only thing that settles it: this reads Cloudflare's own
# answer, and with --version it fails unless that exact id carries 100% of the traffic.
if [ ! -f "$WRAPPER" ]; then
  if [ -n "$WANT_VERSION" ]; then
    note_failure "the caller named ${WANT_VERSION} but ${WRAPPER} is missing, so the live version cannot be read"
  else
    unverified=$((unverified + 1))
    step "      not asserted: ${WRAPPER} is missing, so the live version was not read"
  fi
else
  rows="$(serving_rows)"
  if [ -z "$rows" ]; then
    if [ -n "$WANT_VERSION" ]; then
      note_failure "the caller named ${WANT_VERSION} but the live state could not be read (wrangler deployments status answered nothing)"
    else
      unverified=$((unverified + 1))
      step "      not asserted: the live state could not be read (wrangler deployments status answered nothing)"
    fi
  else
    count="$(printf '%s\n' "$rows" | wc -l | tr -d ' ')"
    live_id="${rows%@*}"
    live_pct="${rows#*@}"
    if [ "$count" -ne 1 ]; then
      note_failure "traffic is split across ${count} versions ($(printf '%s' "$rows" | tr '\n' ' ')): a rollout mid-flight is not a version that can be named"
    elif [ "$live_pct" != "100" ]; then
      note_failure "the version serving carries ${live_pct}%, not 100"
    elif [ -n "$WANT_VERSION" ] && [ "$live_id" != "$WANT_VERSION" ]; then
      note_failure "the version serving is ${live_id} and the caller named ${WANT_VERSION}: what is live is not the build that was asked for"
    elif [ -n "$WANT_VERSION" ]; then
      green "      ok (${live_id}@${live_pct}, the version the caller named)"
    else
      green "      ok (${live_id}@${live_pct})"
    fi
  fi
fi

# ── Optional: the page walk ──────────────────────────────────────────────────
if [ "$WALK" -eq 1 ]; then
  step "[walk] docs/PATHS.md, machine rows"
  python3 tools/walk-paths.py --base "$BASE"
  walk_rc=$?
  case "$walk_rc" in
    0) green "      ok (every machine row answered)" ;;
    2) note_failure "a machine row disagreed with the app (exit 2)" ;;
    3) note_failure "the walk was NOT ASSERTED: no row got an HTTP answer (exit 3)" ;;
    *) note_failure "the walker itself failed (exit ${walk_rc})" ;;
  esac
fi

# ── Verdict ─────────────────────────────────────────────────────────────────
if [ "$failures" -ne 0 ]; then
  red "check.sh: ${failures} check(s) failed, first was: ${failed_on}"
  step "way back: bash HALT      (rolls the Worker back to the previous version)"
  step "runbook: RUNBOOK.md"
  exit 1
fi

if [ "$unverified" -ne 0 ]; then
  green "check.sh: every check passed, ${unverified} not asserted"
  step "          (a reading that could not run is printed above, never counted as a pass)"
else
  green "check.sh: every check passed"
fi
[ "$WALK" -eq 1 ] && step "          the walk ran with --live"
exit 0
