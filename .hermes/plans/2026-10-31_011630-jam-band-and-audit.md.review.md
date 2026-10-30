# Review: 2026-10-31_011630-jam-band-and-audit.md

Pass: ONE self-pass plus ONE in-session mechanics pass. Not the two fanned-out passes the
`plan-hardening` skill asks for on a large surface: this plan is eighteen tasks over one tree, which the
skill's own sizing rule says to run in session. Residual risk from the missing fan-out: an external-fact
pass over the Workers AI pricing and limits, which no reader of this document graded.

Superseded hashes: `cd81ddf33e8d78da` (first draft, 18 tasks, before the mechanics pass found the deploy
ordering and the missing tests) and `84aa484011e5399f` (second draft, after the mechanics fixes but before
the fixture path moved into an existing directory). The current hash is in the `.sha16` sidecar beside
this file and quoted at the end.

## What the mechanics pass found, and what happened to it

| # | Finding | Class | Fix in the plan | Verdict |
|---|---|---|---|---|
| 1 | `deploy.sh` was Task 16, while eight earlier tasks changed what the worker publishes and had no way to ship it | order, class 58 | the script became Task 1 and every worker task's Run ends in `bash deploy.sh` | FIX VERIFIED |
| 2 | Tasks 8, 12 and 13 each wrote a Mutation naming a test no Files list created | class 13 | `src/server/trade.test.ts`, `src/client/features/room/ui/session-panel.test.tsx` and the same file at Task 13 were added to their own Files lists | FIX VERIFIED |
| 3 | Eight tasks ended their Run at the suite, so the room would keep serving the old bytes | class 58 | every worker-changing task now deploys before its probe | FIX VERIFIED |
| 4 | Task 16 ran a gate against a fixture no task created, and its mutation had no failing arm | class 22 | the fixture is a created file in the same task, and the mutation is the fixture run that must exit 1 | FIX VERIFIED |
| 5 | Task 17 needed a headless browser and named no dependency | class 45 | `package.json` joined its Files list and the install line is on the Run line, with the cost stated | FIX VERIFIED |
| 6 | Task 14's mutation referred to "the checker's expected line", which does not exist in this repo | class 13 | rewritten as the file's own run printing zero model bars where the probe printed 38 | FIX VERIFIED |
| 7 | Task 11 promised a seven-day deletion with no producer | class 54 | the alarm and a sweep case are in the same task, and the sweep case is its own Mutation | FIX VERIFIED |
| 8 | R7 warned that the fixture hung off a directory that does not exist | R7 warning | the fixture moved beside the gate script, inside `scripts/`, which exists | FIX VERIFIED |

Grader's note on the fix pass itself: fix 2 first added one test file and left Task 13 sharing another
task's file, which is a weaker shape than its own file. It survived because Task 13 edits the panel that
Task 12 creates, so the shared file is correct there and the case is in the file the panel lives in. That
is recorded rather than rewritten.

## Evidence tiers, per claim family

| Family | Tier | Note |
|---|---|---|
| The 160 BPM numbers (38 model bars, 12 rests, 35 generated bars, 2 fallbacks, latency 376 to 2067) | MEASURED | three probe runs this session, two of them the A/B arms |
| The drum-code count of 0 in prompts | MEASURED | printed by the probe after the rhythm-section fix |
| The 175 tests and the live gate | MEASURED | `npx vitest run` and `bash check.sh --live` in this session |
| Which function builds the phrase, which function caps echoes, where the stride reads its cost | READ FROM SOURCE | line anchors in the Claims table |
| The cost of a hedged call | BORROWED | no pricing read in this pass, which is the one thing the missing fan-out would have graded |

## The two questions that were live, and how they closed

Both were put to the owner as part of "do them all" rather than as separate questions, so each is
recorded with the cost the plan now carries instead of a recommendation he did not answer.

1. The hedge doubles the model calls for a bar, and model calls are the only real cost in the room. The
   plan ships it behind a room setting defaulting to off, so the spend is his to switch on, and Task 5's
   Run prints the call count per bar so the cost is visible before it is turned on. Had he said no, the
   same task would have shipped the measurement only.
2. Gap bars stay generator bars by default, with a switch for rests. Had he chosen rests as the default,
   Task 14 would set the default on and the four 160 BPM runs in this session would have to be re-measured,
   because half their slots carry the generator.

## What this plan does not prove

The panel's numbers (Task 12) are computed from the recorder in the client, and no command in this plan
presses that page: the browser smoke in Task 17 counts sockets and one model bar, not the panel's
agreement with a probe file. The owner step 2 is the only check that the two agree, and it is a person's
read. That is the honest shape of a client-side summary, and it is written as an owner step rather than
left as an assumption.

The property test in Task 18 proves the invariants over a simulated stream, not over the live model. A
simulation cannot show a Workers AI tail that the fixture never modelled.

## Hash

The plan's `sha16` at the time of this review is `94001bdcfe09a08b`, written to the sidecar beside the plan
by the last action on the document. Superseded: `cd81ddf33e8d78da` (first draft, before the mechanics
pass), `84aa484011e5399f` (after the mechanics fixes, before the fixture moved into `scripts/`). A copy
quoting either of those certifies a document that is no longer on disk. Any edit to the plan after this
stamp invalidates this review, and the artifact check in the Verification block must be re-run against the
commit that carries them.
