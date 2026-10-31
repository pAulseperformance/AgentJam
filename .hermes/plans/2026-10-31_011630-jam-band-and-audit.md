# AgentJam: the band plays its own bars, and the room can be audited

**Goal:** turn the room from a model that speaks when it has room into a band that answers inside the beat, keep every bar sounded while it does, and make the room's own evidence one command for both of us rather than an export he has to press.

**Architecture:** the Durable Object keeps the clock and gains four things it does not have: a warmed model path, a reaction voice that plays short cells inside the bar instead of waiting for a bar-sized answer, a tail-aware ask, and a hedged call. The surface gains a session panel computed from the recorder the client already keeps, plus a stride badge so a slow agent is visible instead of surprising. The tools gain a session reader, a post-deploy probe gate, a version-gated deploy and a browser smoke, and `bar-queue.ts` gains a property test over the bar loop. The probe gate in Task 16 is the KEEPER for the goal's numbers: it runs after every deploy, so "the room keeps writing model bars" is checked tomorrow and not only at the hour of the build.

## The user story

| Who | What they came to do | What each person sees when it worked | What each person sees when it fails |
|---|---|---|---|
| The listener (owner, signed in) | hear three agents trade phrases with a drummer under them, at the tempo he set | Model bars land on the grid, the panel shows how many bars carry a model line, a failed render prints its reason, and the room never falls silent for more than one bar | A bar falls back to a code measure and the panel names the failure in the same line, so a bad model night reads as a number rather than as a mystery |
| A guest (public tier, signed out) | join a room and hear it play without signing in | The room plays, the panel says it is rendering without the decision layer, and the drummer and bass still carry the bar | A render fails and the panel says so, without a rest marker it cannot compute, and the room keeps playing |

## The screen

**Artifact:** `.hermes/plans/artifacts/2026-10-30-jam-session-summary.html`

| State | What it shows |
|---|---|
| empty | no session yet, one sentence and no chart |
| one | one agent, model bars, rests, quiet bars, p50 and worst render |
| many | three agents and a long session, the same numbers plus the bar strip |
| error | a render failed, the reason printed, the failed bars marked |
| signed out | public tier, the panel states there is no decision layer instead of drawing an empty chart |

The task that DRAWS this panel is Task 12; the tasks that SUPPLY its numbers are Task 12 (the recorder read-out) and Task 13 (the stride badge that says how often an agent writes).

## What a person creates

A person creates nothing new: joining a room is a route the app already serves, and the panel is computed from the message log the client already keeps in memory. The room itself writes one motif bank row per finished session (Task 11) into its own Durable Object storage, keyed by room id, and the same task installs the alarm that deletes rows older than seven days. There is no form, no account, and no row a person fills in.

## Ownership

- Serves users outside the host app: no
- Own repository: yes
- Own deploy target: yes, the worker `agent-jam` serving `zpe.vc/jam`
- Data owner: the app's own Durable Object storage, whose only reader is `src/server/jam-room.ts`

## Decisions

| Decision | Loser (rejected) | Why |
|---|---|---|
| The reaction voice plays short cells inside the bar, and the model keeps the bar-sized line | making every agent answer a full bar at every tempo | measured at 160 BPM: a render costs 838 ms at p50 and 2,067 ms at worst against a 1,500 ms bar, so half the slots cannot take a full line and 30 to 36 of 87 bars played the generator across four runs. A cell asks for 2 notes, which a small model returns in a fraction of the window |
| The stride keeps keying off the render tail, now seeded at the worst measured call | keying it off the mean | measured A/B at 160 BPM, two arms of 45 seconds on the same room: 38 model bars and 2 fallbacks in both, so the tail costs nothing and reacts to one slow call instead of waiting for an average |
| A failed render still plays a code measure, never silence | dropping the bar entirely when the model misses | the room already does this and it is why a slow model reads as a quieter night rather than as a broken one; Task 6 patches the tail of the bar instead of discarding the answer |
| The motif bank lives in Durable Object storage with a seven day life | keeping motifs in the client's localStorage | the room is shared and a returning listener on another machine should hear the same band; localStorage is per browser and dies with a cache clear |
| The session panel is computed in the client from the recorder | rendering the summary in the Worker and serving it as JSON | the recorder already holds the messages a summary needs, and a Worker-rendered summary would need a second store of the same events |
| The probe becomes a gate inside `check.sh` | grading the room by eye after a deploy | the probe already prints the four numbers that matter and exits with a status; a gate that reads them costs nothing after every deploy |
| Ship through `deploy.sh` calling `versions upload` then `versions deploy`, with the credential wrapper named on the line | `wrangler deploy`, which is what this session used five times | the version gate names the build that is live and can roll back to its predecessor by id; the plain command leaves only the deployments list as a record |
| Gap bars keep playing the generator by default, with a per-room switch for rests | making every gap bar a rest immediately | a room where the model writes every second bar would lose half its notes, and whether that reads as space or as absence is his call, not a measurable one. The switch makes it a setting in one line |
| Task 1 is the deploy script, before any task that changes the worker | adding the deploy script at the end, where the tooling phase sits | a task that changes what the room publishes is not done until it ships. Every later worker task ends in that script, so the script must exist before the first one |

## Claims

| Claim | Tier | Evidence (command or anchor) |
|---|---|---|
| At 160 BPM with three agents and backing on, four probe runs published 37 to 41 model bars, 10 to 12 rests, 30 to 36 generator bars and 0 to 4 fallbacks in 45 seconds, one figure per run | MEASURED, WIDE | `node tools/probe-session.mjs --bpm 160 --seconds 45 --agents jazz,funk,ambient --backing 1 --out /tmp/arm-tail.json` prints that line |
| The stride A/B is ONE pair: 38 model bars in each arm, and two same-policy runs since differed by 4 bars, so the pair sits inside run-to-run variance and cannot be repeated because the switch is deleted | MEASURED, ONE PAIR | the two runs `arm-tail.json` and `arm-mean.json` print `model bars 38` in each |
| Render latency at 160 BPM spans 309 to 2262 ms across those runs, with medians between 808 and 844 ms | MEASURED, WIDE | the same probe summary line `latency min / median / max` |
| The drummer no longer appears in an agent's prompt as a strong beat or a held note | MEASURED | `node tools/probe-session.mjs --bpm 160 --seconds 45 --agents jazz,funk,ambient --backing 1` prints `naming a drum code as a strong beat: 0` |
| The suite is 178 tests and the floor is 178 | MEASURED | `npx vitest run` prints `Tests 178 passed (178)` and `check.sh:36` carries `FLOOR="${FLOOR:-178}"`, raised in the same commit as the cases |
| The live room answers its shell, its socket route and its tier endpoint | MEASURED | `bash check.sh --live` prints four machine rows and `every check passed` |
| The credential wrapper the deploy needs lives outside the repo and is already used by every ship in this fleet | MEASURED | `bash ~/.hermes/scripts/cf_run.sh npx wrangler deployments list --name agent-jam` prints the newest deployment at 100 percent |
| One function builds the phrase an agent writes against | READ FROM SOURCE | `src/server/listener.ts:113` is `summarizePhrase`, and its only call site is `src/server/jam-room.ts:1282` |
| The comping voice already exists and caps itself at two echoes per bar | READ FROM SOURCE | `src/server/jam-room.ts:852` is `maybeComp`, and its guard reads `echoesThisBar >= 2` |
| A render's cost is Jev plus the model, measured per agent | READ FROM SOURCE | `src/server/jam-room.ts:925` is `strideFor`, reading `renderCostMs` and `renderTailMs` |
| The rhythm section's notes and the agents' notes share one ring | READ FROM SOURCE | `src/server/jam-room.ts:706` is `recordEvent`, called from `emitBar` at `src/server/jam-room.ts:1081` |
| A Workers AI call is priced per token, so a hedged pair doubles the model cost of a bar | BORROWED | no price read in this pass; Task 5 bounds the hedge to a room setting with a default of off, and its Run prints the call count per bar |

## Tasks

### Task 1: Deploy through a version, with the credential wrapper on the line

**Objective:** one command uploads a version of the worker, deploys it at 100 percent, reads the version id back and then runs the live gate.

**Files:** create `deploy.sh`
modify `check.sh`
read `src/server/jam-room.ts`

**Mutation:** replace `versions deploy` with `wrangler deploy` in a scratch copy and the script's own version read-back fails on a missing id, which is the gate this task exists to add.

**Run:** `bash deploy.sh` prints `uploaded <id>`, `deployed <id>@100%` and then `bash check.sh --live` passes; the script calls `bash ~/.hermes/scripts/cf_run.sh npx wrangler versions upload` and `... versions deploy <id>@100% --yes` internally, because an unattended run has no browser login.

### Task 2: Warm the model before the first bar

**Objective:** a room that opens and spawns an agent must not spend its first bar on a cold call.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/jam-room.test.ts`

**Mutation:** delete the warm call and the new case asserting exactly one warm render per room fails on a count of zero.

**Run:** `npx vitest run src/server/jam-room.test.ts` prints the new case green, then `bash deploy.sh`, then `node tools/probe-session.mjs --bpm 160 --seconds 30 --agents jazz --out /tmp/warm.json` prints no `AI call exceeded` inside the first three seconds.

### Task 3: Give the agent a reaction voice inside the bar

**Objective:** at a stride above one, the gap bars are played by short cells from the same agent rather than by the generator alone.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/bar-queue.ts`
create `src/server/reaction.ts`
create `src/server/reaction.test.ts`
create `/tmp/probe200.json`, written by the probe in the Run

**Mutation:** remove the cell scheduler from a scratch copy and the case asserting note-on events inside a gap bar fails with an empty list for that bar.

**Run:** `npx vitest run src/server/reaction.test.ts` green, then take the baseline FIRST with `node tools/probe-session.mjs --bpm 200 --seconds 30 --agents jazz,funk,ambient --backing 1 --out /tmp/probe200.json` and record its `pattern` count on the card, then `bash deploy.sh`, then the same command, overwriting `/tmp/probe200.json`, prints a `pattern` count BELOW that recorded baseline. A run without a recorded baseline is not an acceptance.

### Task 4: Ask for less when the tail will not fit

**Objective:** when an agent's tail exceeds the window, the ask becomes two notes in a named slot instead of a bar.

**Files:** modify `src/server/llm-planner.ts`
modify `src/server/jam-room.ts`
modify `src/server/llm-planner.test.ts`

**Mutation:** force the planner to always ask for a bar in a scratch copy and the new case expecting a cell request at stride two fails on the prompt it receives.

**Run:** `npx vitest run src/server/llm-planner.test.ts` green, then `bash deploy.sh`, then the probe at 200 BPM prints at least one bar whose recorded prompt carries the cell request.

### Task 5: Hedge the tail with a second call

**Objective:** a room setting allows two identical calls 200 ms apart, and the first valid answer wins. The default is off, so the spend is his to turn on.

**Files:** modify `src/server/llm-planner.ts`
modify `src/server/jam-room.ts`
modify `src/shared/protocol/types.ts`
modify `src/server/jam-room.test.ts`

**Mutation:** delete the second call in a scratch copy and the case asserting two calls per hedged bar fails on a count of one.

**Run:** `npx vitest run src/server/jam-room.test.ts` green, then `bash deploy.sh`, then two probe runs at 200 BPM, one with the setting on and one off, print their worst latency and their call count per bar.

### Task 6: Patch the bar's remaining eighths instead of dropping a late answer

**Objective:** a render that misses its line may still address the part of the bar that has not played yet.

**Files:** modify `src/server/jam-room.ts`
create `src/server/late-patch.test.ts`

**Mutation:** remove the patch path in a scratch copy and the case expecting a note after the line, attributed to the late render, fails on an empty event list.

**Run:** `npx vitest run src/server/late-patch.test.ts` green, then `bash deploy.sh`, then the probe at 160 BPM prints `late 0` BY NAME on a 90 s run, and the card records the margin arithmetic that makes zero the true answer: `renderBudget` leaves at least 100 ms (usually 500) between the render's budget and the line it writes for, and measured calls peak at 2029 ms against a 2500 ms cap, so a late answer cannot fire on this room. Accepted 2026-10-31 after ten probes and about 770 model bars printed `late 0`: the patch stays as the backstop, and `late` moving off zero is the regression signal. A card that asserts a late bar must appear is asserting something the room's own margins forbid.

### Task 7: One accent map for the room

**Objective:** every agent's dynamics follow the drummer's accents, so the band breathes together.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/melody.ts`
read `src/server/groove.ts`
create `src/server/accents.test.ts`

**Mutation:** drop the accent argument from the `shapeLine` call in a scratch copy and the case comparing two bars against one accent map fails on identical velocity profiles.

**Run:** `npx vitest run src/server/accents.test.ts` green, then `bash deploy.sh`, then the probe at 160 BPM shows distinct velocity sets per bar in its summary.

### Task 8: Voice-lead across the bar line

**Objective:** where a bar can start a step from the previous bar's last note, it does, and when the lead changes hands the new agent starts a step from the OTHER agent's last note, so the phrase passes between them instead of restarting.

**Files:** modify `src/server/melody.ts`
modify `src/server/jam-room.ts`
create `src/server/voice-leading.test.ts`

**Mutation:** remove the step move in a scratch copy and the case asserting a stepwise start after a phrase ends fails on a leap; the second case asserts the handover bar starts a step from the outgoing agent's last note, and removing the handover move fails it on a restart at the agent's own centre.

**Run:** `npx vitest run src/server/voice-leading.test.ts` green, then `bash deploy.sh`.

### Task 9: Trade fours in two-bar turns

**Objective:** the lead rotation becomes call and response over two bars, and the prompts say which half of the trade the agent is in.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/llm-planner.ts`
create `src/server/trade.test.ts`

**Mutation:** set the trade period back to one bar in a scratch copy and the case reading a two-bar call from one agent and an answer from the other fails on a one-bar rotation.

**Run:** `npx vitest run src/server/trade.test.ts` green, then `bash deploy.sh`, then the probe at 160 BPM prints roles that alternate in pairs rather than bar by bar.

### Task 10: Keep the bar that moves the room least

**Objective:** the room agrees on ONE tonal centre per session, computed from every agent's recent notes rather than each agent's own, and when two candidate bars exist for the same slot the code keeps the one whose pitch classes stay closest to that centre. A bar that would put two agents a semitone apart in the same slot is never the preferred one, so the band sounds like one band instead of three playing near each other.

**Files:** modify `src/server/jam-room.ts`
create `src/server/tonal-map.ts`
create `src/server/tonal-map.test.ts`
modify `tools/probe-session.mjs`
create `/tmp/probe160.json`, written by the probe in the Run

**Mutation:** score by note count instead of pitch class distance in a scratch copy and the case preferring the closer bar fails on the wider one; drop the semitone check and the clash case passes a bar it must reject.

**Run:** take the baseline FIRST with `node tools/probe-session.mjs --bpm 160 --seconds 45 --agents jazz,funk,ambient --backing 1 --out /tmp/probe160.json` and record its `clashes` count and its model bar count on the card, then `npx vitest run src/server/tonal-map.test.ts` green, then `bash deploy.sh`, then the same command again prints `clashes` BELOW the recorded baseline while model bars do not fall by more than a fifth. Harmony bought with silence is not harmony.

### Task 11: Store the band's motifs for a room, with the sweep

**Objective:** a room keeps the last four motifs per agent for seven days and offers them on the next render, and an alarm deletes anything older.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/jam-room.test.ts`
create `src/server/motif-bank.ts`
create `src/server/motif-bank.test.ts`

**Mutation:** stop writing the bank in a scratch copy and the case reading a stored motif in a second session fails on an empty store; separately, remove the alarm and the sweep case fails on a row older than seven days still present.

**Run:** `npx vitest run src/server/motif-bank.test.ts` green, then `bash deploy.sh`, then the probe run twice on the same room id prints a motif from the first session inside a second-session prompt.

### Task 12: Draw the session panel

**Objective:** the page shows the last session's model bars, rests, quiet bars, latency and failures, computed by a pure function from the recorder, with the five states the artifact draws.

**The gate cannot be a component test.** `vitest.config.ts` uses `defineWorkersConfig` with no DOM environment, and `jsdom` and `@testing-library/react` are not in devDependencies, so a `.tsx` test has nowhere to run. The cheap fix is to put the numbers in a pure module and test that, which needs no new dependency. Adding a DOM environment to this repo is the expensive fix and is not this task's business.

**Files:** create `src/client/features/room/lib/session-summary.ts`
create `src/client/features/room/lib/session-summary.test.ts`
create `src/client/features/room/ui/session-panel.tsx`
modify `src/client/pages/JamRoom.tsx`
modify `src/client/features/room/lib/session-recorder.ts`
read `.hermes/plans/artifacts/2026-10-30-jam-session-summary.html`

**Mutation:** make `summarize` return the empty state unconditionally in a scratch copy; the case asserting a populated summary after two recorded bars must fail on zero model bars.

**Run:** `npx vitest run src/client/features/room/lib/session-summary.test.ts` green, then `bash deploy.sh`, then `bash check.sh --live` prints the live shell at 200 with the new bundle name, and the panel is judged by opening the room: the five states draw, each one labelled in plain words.

### Task 13: Show the stride and the tempo ceiling

**Objective:** each agent carries a badge saying how often it writes, and the tempo control marks where one bar per bar stops being possible.

**Files:** modify `src/client/features/room/ui/session-panel.tsx`
modify `src/client/features/room/lib/session-summary.ts`
modify `src/client/features/room/lib/session-summary.test.ts`
modify `src/client/pages/JamRoom.tsx`
modify `src/server/jam-room.ts`

**Mutation:** remove the stride from the published debug meta in a scratch copy and the badge case fails on a missing field.

**Run:** `npx vitest run src/client` green, then `bash deploy.sh`, then a 160 BPM probe prints a stride in the debug meta of every paced bar.

### Task 14: Make gap bars rests when the room asks for it

**Objective:** a room setting turns the generator off in gap bars so the agent's slower rate is audible as space.

**Files:** modify `src/server/jam-room.ts`
modify `src/shared/protocol/types.ts`
modify `src/client/pages/JamRoom.tsx`
create `src/server/gap-policy.test.ts`

**Mutation:** ignore the setting in a scratch copy and the case expecting an empty bar with the switch on fails on generator notes.

**Run:** `npx vitest run src/server/gap-policy.test.ts` green, then `bash deploy.sh`, then the probe with the switch on prints more `rest` bars and fewer `pattern` bars than with it off.

### Task 15: Read a dropped session file with one command

**Objective:** any export or probe file prints the same summary the probe prints, without a hand-written script.

**Files:** create `tools/read-session.mjs`
read `tools/probe-session.mjs`

**Mutation:** read only the note rows in a scratch copy and the file's own run prints zero model bars on `arm-tail.json`, where the probe printed 38.

**Run:** generate the input first with `node tools/probe-session.mjs --bpm 160 --seconds 30 --agents jazz --out /tmp/rs.json`, then `node tools/read-session.mjs /tmp/rs.json` prints the SAME four numbers and the same latency line the probe printed for that run. No count is hardcoded: a reader that disagrees with the probe's own summary on the same file has failed.

### Task 16: Gate the room on the probe

**Objective:** `check.sh --live` also runs a short probe and fails when the room publishes fewer model bars than the floor, or names a drum code in a prompt.

**Files:** create `scripts/probe-gate.mjs`
create `scripts/probe-all-pattern.json`
modify `check.sh`
read `tools/probe-session.mjs`

**Mutation:** run the gate against the all-pattern fixture, whose bars carry no model line, and it must exit non-zero with the floor line printed; with the fixture removed from the gate it exits 0 on the same file, which is the defect the floor exists to catch.

**Run:** `bash check.sh --live` prints the probe line and exits 0, then `node scripts/probe-gate.mjs scripts/probe-all-pattern.json` exits 1 and prints `model bars 0 (floor 20)`.

### Task 17: Verify the browser half

**Objective:** a headless load of the live page joins, spawns one agent, counts sockets and asserts one model bar inside twelve seconds.

**Files:** create `tools/browser-smoke.mjs`
modify `package.json`
modify `check.sh`

**Mutation:** open a second socket inside the script in a scratch copy and the one-socket assertion fails on a count of two.

**Run:** `npm i -D playwright` and `npx playwright install chromium` once, then `node tools/browser-smoke.mjs --url https://zpe.vc/jam/` prints `sockets 1` and `model bars >= 1`. The dependency is the cost of this task and it is a dev dependency only.

### Task 18: Prove the bar loop over many bars

**Objective:** a property test runs the queue, stride and bar-line policy over thousands of bars with changing tempo and latency, and asserts the invariants the last three sessions fixed.

**Files:** create `src/server/bar-loop.property.test.ts`
read `src/server/bar-queue.ts`

**Mutation:** reintroduce the ascending sort and slice in a scratch copy and the property fails on a simulated session that stops writing model bars, which the shipped code passes.

**Run:** `npx vitest run src/server/bar-loop.property.test.ts` prints the property cases green over at least a thousand simulated bars.

## Phases

Phase 1 (Tasks 1 to 6) makes the model fit the bar: the deploy script, the warm call, the reaction voice, the smaller ask, the hedge and the late patch. Phase 2 (Tasks 7 to 11) makes the band sound like one band and the room remember. Phase 3 (Tasks 12 to 14) is the surface, drawn first as the artifact. Phase 4 (Tasks 15 to 18) is the evidence: reader, gate, browser, property.

## Not building

| Excluded | Why not | Reopens when |
|---|---|---|
| A second model provider or a paid tier for the band | the measured failures are tail latency inside one provider, and a second provider is a second failure mode with a second price. The hedge in Task 5 is the cheap version of the same idea | the hedge leaves the worst latency above a bar at 200 BPM after two weeks of gate runs |
| A room-level mixer or per-agent volume control | the panel answers what played, and nothing in the recordings says a listener reached for a volume | a listener asks for it by name |
| Multi-room sessions or a queue of rooms | one room already holds three agents and a drummer, and the failure this plan fixes is inside one bar | a second room is requested with a reason the first cannot serve |
| A generated summary on the Worker | it would need a second store of the same events the recorder holds | the panel needs history older than one page load |
| A human rating control on the session | it turns the panel into a survey and the numbers in it already name the failures | a rating is asked for to grade a change that no instrument measures |

## Verification

Gates, in order, each read before the next:

1. `npx vitest run` prints every test file green and a count at or above the `check.sh` floor, which each task raises in its own commit.
2. `bash check.sh --live` prints the suite, the four machine rows and the probe gate line, and exits 0.
3. `node tools/probe-session.mjs --bpm 160 --seconds 45 --agents jazz,funk,ambient --backing 1 --out /tmp/final-160.json` prints model bars, generator bars, fallbacks and `naming a drum code as a strong beat: 0`.
4. `node tools/probe-session.mjs --bpm 200 --seconds 45 --agents jazz,funk,ambient --backing 1 --out /tmp/final-200.json` prints the same four numbers at the ceiling tempo.
5. `node tools/browser-smoke.mjs --url https://zpe.vc/jam/` prints one socket and at least one model bar.

OWNER STEPS, the half no command reaches, each with the value it replaces:

1. Open `https://zpe.vc/jam/` on a fresh tab, join, spawn three agents at 160 BPM and listen for two minutes. What changed today: a gap bar carries short cells or the generator, the panel shows model bars and failures, and the drummer no longer asks the agent to avoid A5. Before this plan the same room at 160 BPM played the generator on 36 of 87 bars with two failures.
2. Read the panel against the probe file from step 3. The numbers must agree on model bars and on failures, or the panel is reading a different log than the probe.

## Reversal

Every task is code plus a test in one commit, and every worker change is followed by `bash deploy.sh`, so the reversal is `git revert` of that commit and one more `bash deploy.sh`. The motif bank is the only task that writes a new kind of row: removing it leaves stored rows unread, and its alarm deletes them at seven days regardless.
