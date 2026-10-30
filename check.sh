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
#   bash check.sh          suite + four live probes
#   bash check.sh --live   the above, then the page walk from docs/PATHS.md
#
# Exit: 0 everything answered, 1 a check failed. On failure it prints the way back.

set -uo pipefail
cd "$(dirname "$0")"

FLOOR="${FLOOR:-168}"
BASE="${BASE:-https://zpe.vc}"
APP_HOST="${APP_HOST:-jam.zpe.vc}"
WALK=0
[ "${1:-}" = "--live" ] && WALK=1

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '%s\n' "$*"; }

failures=0
failed_on=""

note_failure() {
  failures=$((failures + 1))
  red "FAIL  $1"
  [ -z "$failed_on" ] && failed_on="$1"
}

# ── 1. The suite, with a floor ────────────────────────────────────────────────
step "[1/5] suite"
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
step "[2/5] live: the mount shell"
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

# ── 3. The shell's own asset resolves on the same origin ─────────────────────
step "[3/5] live: the shell's asset"
asset=""
[ "$shell_ok" -eq 1 ] && asset="$(grep -oE '/jam/assets/[^"]+\.js' "$shell_file" | head -1)"
if [ "$shell_ok" -eq 0 ]; then
  note_failure "the asset probe did not run: the shell was never fetched"
elif [ -z "$asset" ]; then
  note_failure "the shell names no /jam/assets script"
else
  code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}${asset}")"
  if [ "$code" = "200" ]; then
    green "      ok (${asset} 200)"
  else
    note_failure "${asset} answered ${code}"
  fi
fi

# ── 4. The room route exists on the app's own host (426, not 404) ────────────
step "[4/5] live: the room socket route"
code="$(curl -s -o /dev/null -w '%{http_code}' "https://${APP_HOST}/api/room/check/ws")"
if [ "$code" = "426" ]; then
  green "      ok (426 Expected WebSocket upgrade)"
else
  note_failure "GET https://${APP_HOST}/api/room/check/ws answered ${code}, not 426"
fi

# ── 5. The tier endpoint ─────────────────────────────────────────────────────
step "[5/5] live: the tier endpoint"
body="$(curl -s "${BASE}/jam/api/whoami")"
if printf '%s' "$body" | grep -q '"tier":"public"'; then
  green "      ok (anonymous reads the public tier)"
else
  note_failure "whoami answered without the public tier: ${body:0:120}"
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

green "check.sh: every check passed"
[ "$WALK" -eq 1 ] && step "          the walk ran with --live"
exit 0
