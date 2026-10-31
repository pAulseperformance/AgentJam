#!/usr/bin/env bash
# THE REPO'S OWN GATE, in one command.
#
# check.sh wraps the gate this repo already declares (`npm test` -> `vitest run`, package.json:18)
# and adds the readings a suite cannot make: the live surface, the shell's own asset, the room
# socket's refusal on the app's own host, the tier endpoint, and - with --live - a short session the
# probe gate reads for model bars and drum codes (scripts/probe-gate.mjs), a headless page load that
# reads the page's own socket (tools/browser-smoke.mjs), and the page walk.
#
# Why a FLOOR and not just "tests pass": a suite that silently stops collecting tests also exits 0,
# so the pass COUNT is asserted against a number. Raise FLOOR in the same commit as any test that
# lands, or the floor stops meaning anything. The probe gate has a floor of its own (PROBE_FLOOR) for
# the same reason: a live session's model-bar count drifts run to run, so only a floor under the
# low-water mark can be held after a deploy.
#
#   bash check.sh                          suite + five live readings: four probes and the version serving
#   bash check.sh --live                   the above, then a 45 s session the probe gate passes or refuses,
#                                          the page walk from docs/PATHS.md, and a headless page load
#                                          (tools/browser-smoke.mjs: one socket, one model bar in 12 s)
#   bash check.sh --live --version <id>    the above, and fails unless <id> is the version carrying 100%
#
#   PARITY=loose bash check.sh             the same, but the live bundle is only proven to RESOLVE (200),
#                                          not to be the one this tree builds. That reading - "what is
#                                          serving is this tree" - can only be true AFTER a ship, so
#                                          deploy.sh uses loose for its pre-upload gate and strict for
#                                          the gate it runs once traffic has moved.
#
# Exit: 0 everything answered, 1 a check failed, 2 bad usage. On failure it prints the way back.

set -uo pipefail
cd "$(dirname "$0")"

FLOOR="${FLOOR:-287}"
# THE PROBE'S FLOOR, separate from the suite's: 45 s at 160 BPM with three agents wrote 66 to 74
# model bars across the five runs taken on 2026-10-31, and the plan's review measured 37 and 41 for
# the same command a day earlier. The floor of 20 sits under the lowest of those (37), so a healthy
# room clears it and only a room filling its own bars does not. Raise it in the same commit as the
# evidence that the room's low-water mark rose; a floor nobody raises stops meaning anything.
PROBE_FLOOR="${PROBE_FLOOR:-20}"
PARITY="${PARITY:-strict}"
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
  elif [ "$built" != "$asset" ] && [ "$PARITY" = loose ]; then
    green "      ok (${asset} 200)"
    unverified=$((unverified + 1))
    step "      not asserted: this tree builds ${built} and the live shell serves ${asset}; parity is read after the upload"
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

# ── Optional, --live: a short session, read by the probe gate ─────────────────
# WHY A LIVE SESSION AND NOT A FILE IN THE REPO: the two readings the gate holds the room to are the
# room's own - model bars written, and no drum code named in a prompt - and only a run against the
# live Worker can take them. scripts/probe-all-pattern.json is what a room with a dead model path
# looks like; the gate refuses that file, which is the defect this step is here to catch.
if [ "$WALK" -eq 1 ]; then
  step "[probe] live: a 45 s session, and the floor on its model bars"
  probe_file="$(mktemp -t jam-probe.XXXXXX)"
  probe_log="$(mktemp -t jam-probe-log.XXXXXX)"
  # 45 s at 160 BPM is 30 bars per agent, and --backing puts the drummer and bass on BEFORE the first
  # bar, which is the only state in which a drum code can reach a prompt: a gate that never switches
  # them on cannot see the reading it exists to take.
  node tools/probe-session.mjs --bpm 160 --seconds 45 --agents jazz,funk,ambient --backing 1 --out "$probe_file" >"$probe_log" 2>&1
  probe_rc=$?
  if [ "$probe_rc" -ne 0 ]; then
    tail -20 "$probe_log"
    note_failure "the probe exited ${probe_rc}, so there was no session file to gate"
  else
    node scripts/probe-gate.mjs "$probe_file" --floor "$PROBE_FLOOR"
    gate_rc=$?
    case "$gate_rc" in
      0) green "      ok (the floor held and no prompt names a drum code)" ;;
      1) note_failure "the probe gate refused this session: the readings above name what failed" ;;
      3) unverified=$((unverified + 1))
         step "      not asserted: the gate made no drum reading, because this session recorded no prompt" ;;
      *) note_failure "the probe gate exited ${gate_rc}: exit 2 is a session file it could not read" ;;
    esac
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

# ── Optional, --live: the browser half ───────────────────────────────────────
# WHY A PAGE AND NOT ANOTHER PROBE: tools/probe-session.mjs joins with `ws`, so it can say what the
# room PUBLISHES; only a page can say the page opens ONE socket and hears the model's bar on it. The
# page is the half that once opened a second socket per tab. Playwright is a dev dependency and its
# chromium is a one-time download; a machine without them has a reading it cannot make, so exit 3 is
# printed as not asserted and never as a pass.
if [ "$WALK" -eq 1 ]; then
  step "[browser] live: one page, one socket, one model bar"
  node tools/browser-smoke.mjs --url "${BASE}/jam/"
  browser_rc=$?
  case "$browser_rc" in
    0) green "      ok (one socket, and the model wrote a bar inside 12 s)" ;;
    1) note_failure "the browser smoke failed: the readings above name which one did not hold" ;;
    3) unverified=$((unverified + 1))
       step "      not asserted: playwright or its chromium is not installed (npm i -D playwright && npx playwright install chromium)" ;;
    *) note_failure "the browser smoke exited ${browser_rc}" ;;
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
[ "$WALK" -eq 1 ] && step "          the probe, the browser smoke and the walk ran with --live"
exit 0
