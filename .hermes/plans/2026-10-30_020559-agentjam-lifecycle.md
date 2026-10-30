# agentJam Lifecycle Plan

**Goal:** close the lifecycle stages agentJam skipped by growing from a door rather than from a plan: it is live and shipped, while spec, the repo gate, the stop command and the page walk do not exist. Nothing in this plan changes the product.

**Architecture:** no application code changes. The plan adds the artifacts a shipping repo in this fleet owes, each gated by a command: `check.sh` (the existing suite with a pass floor plus live probes), `HALT` with its rollback, `RUNBOOK.md`, `TRAPS.md`, the three dossier files, and a page walk in `docs/PATHS.md` driven by `tools/walk-paths.py` and wired into `check.sh --live`. The Worker, the Durable Object and the UI stay as they are.

## Where it stands

Measured on 2026-10-30, in the map's own words.

| # | stage | gate | state | evidence |
|---|---|---|---|---|
| 1 | Spark | a row in IDEAS.md | closed before this session | `IDEA.md` carries the original line, still untracked |
| 2 | Brainstorm | three shapes | skipped | the app predates this session and chose its shape already |
| 3 | Research | sourced claims | skipped at the time, done now | two papers read this session, cited in `README.md` |
| 4 | Decide | one call, its falsifier | closed late | the calls are in this plan and go into `DECISIONS.md` in Task 6 |
| 5 | Spec | spec_gate.py dossier | **open** | `spec_gate.py dossier` reports missing spec, roadmap, decisions |
| 6 | Plan | plan file plus approval | this document | stamp lands at Task 9 |
| 7 | Build | one commit per task | closed | commits `82dc8aa`, `04623db`, `0cfdfe4`, `ffca47f` |
| 8 | Review | review_gate.py check | closed but unrecorded | the gate scopes 1 line, so no review row describes the four commits |
| 9 | Verify | live read back plus the page walk | **open** | no `docs/PATHS.md`, no walker, no `check.sh --live` |
| 10 | Ship | pushed plus the URL that proves it | shipped, incompletely recorded | live on `zpe.vc/jam`, version `9b8094b3`; the registry row still names commit `0cfdfe4` |
| 11 | Operate | records written, tree clean | **open** | no `HALT`, no `RUNBOOK.md`, no `TRAPS.md`; nothing can stop this by command |

Two defects found while measuring, both load-bearing for this plan:

- `jam.zpe.vc/` answers **302 to `https://zpe.vc/services` on GET** while **HEAD reaches the app and answers 301 to `https://zpe.vc/jam/`**. `jam.zpe.vc/api/room/x/ws` answers 426 from the app itself, so the app's route is alive and a zone layer answers page requests first. The app's own claim that its name redirects to the mount is false on GET.
- The registry row is stale in one field and contradicts itself in another: `commit` is `0cfdfe4` (HEAD is `ffca47f`), and `surface: internal` accompanies `access: public` on a page any stranger reaches.

## Decisions

| Decision | Loser (rejected) | Why (evidence) |
|---|---|---|
| The plan, its `.sha16` and its review live in `.hermes/plans/` under the repo and land in one commit | the machine's shared plan directory `~/.hermes/plans/`, which is where most plans go | that directory is not version controlled, so a review there certifies a document no other session can see (`plan` skill, "The plan directory is the DELIVERABLE") |
| The stop command is `npx wrangler rollback` against a named version | deleting the Worker, or replacing it with a static 503 | rollback is one command, keeps the Durable Object storage, and is proven by reading the room health endpoint afterwards; deleting takes the room data with it |
| The live probe is five HTTP reads plus one upgrade refusal, driven by a walker | a browser driver against the live page | a browser adds a package and a download to whatever machine runs the gate, and the steps a walker cannot see are written as MANUAL rows with their dates |
| The app's own name is retired as a door: the Worker comment and the registry row stop claiming it, and `zpe.vc/jam` is the only page address (REVISION 1, his call) | repairing the interception in `~/Projects/zpe-vc` so `jam.zpe.vc` redirects page requests to the mount | measured: the app answers HEAD with its own 301 and never sees GET, so the layer that answers page requests is upstream of this Worker; the cost accepted is that a visitor who types the old name lands on `/services` |
| The rhythm section and the lead agent's spend rule stay as they are, since this plan changes no code | revisiting the one-rest-in-five governor while writing the records | it was measured at 3 rests in 20 bars across three runs; a paperwork plan that reopens a tuned policy is scope, not lifecycle |

## Claims

| Claim | Tier | Evidence (command or anchor) |
|---|---|---|
| The repo's suite is 101 tests, so a pass floor of 101 is honest today | MEASURED | `npx vitest run` prints `Tests 101 passed (101)` |
| The repo declares `test` as its only gate script, so `check.sh` wraps exactly one command | MEASURED | `package.json:17` |
| The live app answers its shell at the mount | MEASURED | `curl -s -o /dev/null -w '%{http_code}' https://zpe.vc/jam/` prints 200 |
| A room socket route exists on the app's own host without opening a socket | MEASURED | `curl -s -o /dev/null -w '%{http_code}' https://jam.zpe.vc/api/room/x/ws` prints 426 |
| The app's own hostname does not redirect a GET to the mount | MEASURED | `curl -s -D - -o /dev/null https://jam.zpe.vc/` prints `HTTP/2 302` and `location: https://zpe.vc/services` |
| The registry row lags HEAD by one commit and calls a public page internal | MEASURED | `python3 -c "import json;d=json.load(open('~/Projects/app-registry/apps.json'))['apps']['jam'];print(d['commit'],d['surface'])"` prints `0cfdfe4cdbd60fe480d17ad9808454aeef434539 internal` |
| Rollback is available because every deploy is a version on the same Worker | MEASURED | `npx wrangler versions list` lists the uploaded versions beside the deployed one |

## Tasks

### Task 1: Write check.sh with a pass floor and three live probes

**Objective:** one command that proves the repo works, prints the test count beside the floor it wanted, and reads the live surface in the same run.

**Files:** create `check.sh`

**Mutation:** lower the floor to 1 and delete the live probe from a scratch copy; the copy must exit 0 over a suite that runs nothing, which is the defect the floor exists to catch.

**Run:** `bash check.sh` prints the suite count, the floor, three probe lines and exits 0; then break one probe in a scratch copy (`--expect 999`) and confirm a non-zero exit with the rollback pointer printed.

### Task 2: Write HALT and RUNBOOK.md

**Objective:** a one-line stop that is the real stop for a Worker, and a runbook naming what dies, who hears and the way back.

**Files:** create `HALT`, create `RUNBOOK.md`

**Mutation:** point `HALT` at a version id that does not exist; the runbook's first command must then fail loudly rather than silently doing nothing.

**Run:** `bash HALT` rolls back to the named version, then `curl -s https://zpe.vc/jam/api/room/probe/health` answers JSON from the previous version; `grep -c '^## ' RUNBOOK.md` prints the section count, at least four.

### Task 3: Write TRAPS.md from this session's failures

**Objective:** one dated bullet per failure that cost an hour, each carrying the command that reveals it, newest first.

**Files:** create `TRAPS.md`

**Mutation:** remove the date from one bullet; the file must then read as undated for that line when `spec_gate.py repo` runs, which is the trap the gate documents.

**Run:** `python3 ~/.hermes/agent-hooks/spec_gate.py repo .` stops reporting `traps_undated`, and `grep -c '^\- \*\*2026' TRAPS.md` prints the bullet count.

### Task 4: Write SPEC.md with the ownership block

**Objective:** place the repo in one document: what it is, which repo holds it, which Worker serves it, and who owns the room data.

**Files:** create `SPEC.md`

**Mutation:** blank the `Own deploy target` answer; `spec_gate.py check` on the file must fail on the missing target.

**Run:** `python3 ~/.hermes/agent-hooks/spec_gate.py check .hermes/plans/2026-10-30_020559-agentjam-lifecycle.md` exits 0 once `SPEC.md` carries the same block, and `spec_gate.py repo .` no longer reports `not_stamped` after Task 9's stamp.

### Task 5: Write ROADMAP.md

**Objective:** now, next, later, with the two open lifecycle gaps named as now and the research-grounded ideas as later.

**Files:** create `ROADMAP.md`

**Mutation:** delete the `next` section; the dossier gate must report the file as unusable rather than complete.

**Run:** `python3 ~/.hermes/agent-hooks/spec_gate.py dossier .` stops naming `roadmap`.

### Task 6: Write DECISIONS.md with the calls this session made

**Objective:** append-only record of each call with the loser and the falsifier, so the next session does not re-litigate the Workers AI choice, the Jev split or the drummer-as-code call.

**Files:** create `DECISIONS.md`

**Mutation:** remove the `loser` line from one entry; the file must fail a reader's check that every entry names what it beat.

**Run:** `grep -c 'Loser' DECISIONS.md` prints the entry count, at least six; `spec_gate.py dossier .` stops naming `decisions`.

### Task 7: Write docs/PATHS.md, one row per path a person walks

**Objective:** the page map the gate reads: id, actor, steps, expected answer, and a `how` column of machine or MANUAL with a date. The six rows, named so the walker has no room to invent them:

- P1 the mount shell: a visitor opens https://zpe.vc/jam/ and gets 200 with a title naming AgentJam
- P2 the shell own asset: the script tag the shell names resolves 200 from the same origin
- P3 the room route exists: https://jam.zpe.vc/api/room/x/ws answers 426 to a plain GET, the app own refusal
- P4 whoami, anonymous: https://zpe.vc/jam/api/whoami answers 200 JSON carrying tier public
- P5 whoami, signed: MANUAL, the door cookie is needed, with its steps and the date it was last walked
- P6 the app own name, page request: MANUAL while the finding is open; it expects a 301 to https://zpe.vc/jam/ and currently gets a 302 to https://zpe.vc/services, so it stays MANUAL with that sentence and its date until Task 10 closes the finding

**Files:** create `docs/PATHS.md`

**Mutation:** delete the row for the model selector refusal; the walk must then pass while the room can be handed a larger model by an anonymous socket, which is the flow the row exists to hold.

**Run:** `grep -c '^| P' docs/PATHS.md` prints the row count, at least six, and every MANUAL row carries a date.

### Task 8: Write tools/walk-paths.py and prove it can fail

**Objective:** drive the machine rows against the live app, skip a MANUAL row with its reason, and exit with a distinct code when nothing answered at all.

**Files:** create `tools/walk-paths.py`

**Mutation:** point the base at a host that does not resolve; the run must exit with the third code and print that the walk was not asserted, never with the disagreement code.

**Run:** `python3 tools/walk-paths.py --base https://zpe.vc` prints one line per row and exits 0; then `--base https://nope.example` exits with the not-asserted code.

### Task 9: Wire the walk into check.sh, stamp SPEC.md, record the review

**Objective:** one command that runs the suite, the walk and the probes, then earns the stamp by passing.

**Files:** modify `check.sh`

**Mutation:** make one row disagree with the app by editing its expected answer; `bash check.sh --live` must exit non-zero and name the row id.

**Run:** `bash check.sh --live` exits 0; `python3 ~/.hermes/agent-hooks/spec_gate.py stamp . --cmd "bash check.sh --live"` writes the date only on that exit 0; `python3 ~/.hermes/agent-hooks/spec_gate.py repo .` prints COMPLETE.

### Task 10: Retire the own-name claim and refresh the registry row

**Objective:** the app stops claiming a second page door: the Worker comment, the wrangler comment and the registry declaration all say the mount is the only page address, the finding is recorded with both measuring commands, and the registry row is regenerated so its commit field matches the tree that serves the page.

**Files:** create `docs/FINDINGS.md`

**Mutation:** re-run the registry generator twice with no source change; the second run must produce a byte-identical `apps.json`, or the artifact is not a function of its inputs.

**Run:** `python3 ~/Projects/app-registry/registry.py --json` regenerates the row, then `python3 ~/Projects/app-registry/tools/admit.py --only jam --live` must report no FAIL on any stage, with the api, wire, guard and shell gates reading unknown because this row publishes no contract by declaration.

## Verification

| Step | Command | Expected |
|---|---|---|
| 1 | `npx vitest run` | `Tests 101 passed (101)` |
| 2 | `bash check.sh` | suite count, floor 101, three probe lines, exit 0 |
| 3 | `bash check.sh --live` | suite, six walk rows, exit 0 |
| 4 | `python3 tools/walk-paths.py --base https://nope.example` | not-asserted exit code, no disagreement claim |
| 5 | `python3 ~/.hermes/agent-hooks/spec_gate.py dossier .` | COMPLETE |
| 6 | `python3 ~/.hermes/agent-hooks/spec_gate.py repo .` | COMPLETE with the stamped date |
| 7 | `python3 ~/.hermes/agent-hooks/review_gate.py check` | UNDER_THRESHOLD or clean, never open |
| 8 | `git status --short` | only `.hermes/plans/` additions before the commit |

**No person-facing surface:** this plan adds records, gates and a walker to the repo and changes no page, no route and no note in the room.

## Ownership

- Serves users outside the host app: yes, `https://zpe.vc/jam/` is public and any stranger with the address reaches it
- Own repository: yes, `~/Projects/Music/agentJam`, which already holds the code and the deploy config
- Own deploy target: yes, the Cloudflare Worker named agent-jam in `wrangler.jsonc`, live at `https://zpe.vc/jam/`, version `9b8094b3` deployed 2026-10-29
- Data owner: this repo's own Durable Object, class JamRoom, whose SQLite storage holds each room's note history; no other app reads it

## What this plan will not do

| Excluded | Why not | Reopens when |
|---|---|---|
| Uptime monitoring or a cron probe against the live page | he has said monitoring is not to be added unasked, and `check.sh --live` is the human-run equivalent | he asks for a watcher, or a second outage happens that nobody noticed |
| A browser driver for the MANUAL rows | it adds a package and a browser download to whatever machine runs the gate | he wants the audio and socket flows walked unattended |
| Any change to the agent, the drummer or the Jev battery | the product is tuned and measured; this plan is about records and gates | a measurement shows one of the tuned policies regressing |
| Deleting or renaming the `IDEA.md` line | it is not mine, and the repo's history is his | he says the file should go |
| A second door for `jam.zpe.vc` inside agentJam | measured: the page request never reaches this Worker | zpe-vc's fix proves impossible without a rule here |

## Revision 1: the own-name door is retired, not repaired (2026-10-30)

His words: "Retire the claim in agentJam: drop the own-name redirect from the worker comment and the registry row, and treat zpe.vc/jam as the only door."

What changed against the first draft: the first draft proposed repairing the zone layer in `~/Projects/zpe-vc` so that `jam.zpe.vc` redirected page requests to the mount. That row, its task and its excluded-table neighbour now say the opposite, and Task 10's Run line changed with it.

What survives of the original reasoning: the measurement itself. A GET of `jam.zpe.vc/` answers 302 to `https://zpe.vc/services` while a HEAD reaches this Worker and gets its own 301, which is why a rule inside this repo could never win. The room API keeps answering on both names because that costs nothing.

Cost accepted: a visitor who types the old name lands on `/services` and has to be told the mount. One register entry records it, with the two commands that re-measure it, in `docs/FINDINGS.md`.

What this revision changes in the task set: Task 10 (retire and refresh the registry, not route a finding), and the plan's own decision row. No other task is touched, and no product behaviour changes.
