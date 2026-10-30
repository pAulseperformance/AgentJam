# Review: 2026-10-31_011630-jam-band-and-audit.md

Plan sha16 `94001bdcfe09a08b`, verified with `shasum -a 256 | cut -c1-16` against the card. Repo: `/Users/HANDLE_2/Projects/Music/agentJam` at the working tree of 2026-10-31. Every command below was run this session, this tree, read-only.

## Claims re-measured

| Claim | Command | Actual output | Verdict |
|---|---|---|---|
| 38 model bars, 12 rests, 35 generator, 2 fallbacks in 45 s at 160 BPM | `node tools/probe-session.mjs --bpm 160 --seconds 45 --agents jazz,funk,ambient --backing 1 --out /tmp/arm-tail.json` | `model bars 37  rest 10  pattern 36  fallback 4` | FAILS as written. The command does not print the claimed line. Shape holds (~40 percent generator, low fallbacks), exact numbers do not. Second run of the identical command: `model bars 41  rest 13  pattern 30  fallback 0` |
| Both stride policies publish the same count, `model bars 38` in each arm | the two arm files | 37 and 41. Not equal. The A/B switch is deleted, per the comment at `src/server/jam-room.ts:928` "The switch that ran that experiment is gone", so both of today's arms are tail policy | CANNOT BE RE-VERIFIED. Run-to-run variance is 4 bars, larger than the claimed zero difference. The decision rests on one pair of runs |
| Latency 376 to 2,067 ms, median 838 | the same probe summary `latency min / median / max` | arm 1: `min 361  median 808  max 1953 ms`. arm 2: `min 309  median 844  max 2262 ms` | FAILS as written. Same magnitude, different numbers. State a range or re-measure |
| Drummer not in prompts as strong beat | the same probe, line `naming a drum code as a strong beat` | `prompts   87  naming a drum code as a strong beat: 0` and `prompts   84  ... : 0` | HOLDS |
| Suite is 175 tests and the floor is 175 | `npx vitest run` | `Tests  178 passed (178)`. `check.sh:36` has `FLOOR="${FLOOR:-178}"` | FAILS. Suite 178, floor 178. The claim is stale on both halves |
| Live room answers shell, socket route, tier endpoint | `bash check.sh --live` | `PASS P1  200, title present`, `PASS P2 ... 200`, `PASS P3 ... 426`, `PASS P4  200`, then `WALK PASSED: 4 machine rows answered` and `check.sh: every check passed` | HOLDS |
| Credential wrapper exists and the ship record reads | `bash ~/.hermes/scripts/cf_run.sh npx wrangler deployments list --name agent-jam` | `Version(s):  (100%) b120805c-00e3-4ea9-9757-97eeddd91ceb`, newest entry | HOLDS |
| One phrase builder, `listener.ts:113`, only caller `jam-room.ts:729` | `grep -rn "summarizePhrase" src/` | definition at `src/server/listener.ts:113`, one call site at `src/server/jam-room.ts:1282` | HALF HOLDS. One caller is true. The cited line 729 is wrong; that line is `othersRecent`, which feeds the call but is not the call |
| Comping voice caps at two echoes, `jam-room.ts:852` | `sed -n '852,855p'` | `private maybeComp` at 852, guard `agent.echoesThisBar >= 2` at 855 | HOLDS |
| Stride reads tail, `jam-room.ts:925` | `sed -n '925,931p'` | `private strideFor` at 925, `renderStride(Math.max(agent.renderCostMs, agent.renderTailMs), ...)` at 930 | HOLDS |
| One ring, `recordEvent` at 706 called from `emitBar` at 1081 | `grep -n "recordEvent" src/server/jam-room.ts` and `sed -n '1081,1124p'` | `recordEvent` defined at 706, called at 1109 and 1124 inside `emitBar`, which starts at 1081 | HOLDS |
| Workers AI priced per token, hedge doubles cost | not run, declared BORROWED | honest as declared, bounded by a default-off setting | OK AS DECLARED |

Anchor inventory: 6 of 7 file:line anchors verified exactly (`listener.ts:113`, `jam-room.ts:852`, `925`, `706`, `1081`, plus artifact `2026-10-30-jam-session-summary.html` exists). One is wrong (`jam-room.ts:729`, real call site `1282`).

## Defects found in the plan

1. **Task 12's gate cannot pass as specified.** `npx vitest run src/client` runs inside `@cloudflare/vitest-pool-workers` (`vitest.config.ts:1` uses `defineWorkersConfig`, no DOM environment, and `@testing-library/react` plus `jsdom` are absent from devDependencies). A React `.tsx` component test has no way to run in this setup. The task's Files list omits `vitest.config.ts` and the devDependencies. Fix: Task 12 must add the test environment, either a jsdom environment plus testing-library, or a second vitest project for the client, and name those files.
2. **Claim 5 is stale.** Suite is 178, floor 178, not 175/175. Fix: re-measure and write 178/178, and note the floor rule in `check.sh:9` requires raising it in the same commit as tests land.
3. **Claims 1 and 3 assert exact numbers a live probe does not reproduce.** Two runs today gave 37 and 41 model bars, and max latency 1,953 and 2,262 ms. Fix: state ranges with the run count, or re-measure at plan write time and mark the numbers as one run's snapshot.
4. **Claim 2, the A/B stride evidence, is untestable after the fact.** The switch is deleted (`jam-room.ts:928`) and today's variance between two same-policy runs is 4 bars. Fix: either restore the switch behind a flag for the experiment window, or downgrade the decision's evidence line from "measured A/B, same count" to "one A/B pair, zero difference, within run variance of 4".
5. **Wrong anchor.** `summarizePhrase`'s only caller is `src/server/jam-room.ts:1282`, not 729. Fix the line number.
6. **Verification gate 1 miscounts the suite.** `npx vitest run` prints 13 test files today, and the plan's own tasks create 10 more test files, so the end state is about 23, not 14. Fix: drop the file count or recompute it from the task list.
7. **Task 15's Run depends on an artifact no task creates.** `/tmp/arm-tail.json` is the plan author's session file. Today it exists only because this review re-ran the probe, and it holds 37 model bars, so the Run's asserted `model bars 38` already fails. Fix: Task 15 generates its own input first, `node tools/probe-session.mjs --bpm 160 --seconds 30 --agents jazz --out /tmp/rs.json`, then reads that file and asserts against the same run's summary, never a hardcoded count.
8. **Task 3 compares against a baseline nothing measures.** "fewer `pattern` bars than the 73 measured today" at 200 BPM appears nowhere in the Claims table and no task produces it. Fix: Task 3's Run must first take a 200 BPM baseline probe, then compare against it.
9. **Internal inconsistency on generator bars.** The Decisions table says 36 of 87 (plan line 43), the Claims table says 35 (line 57). Fix: one number, tied to one command.

## Defects the plan cannot fix

- Live probe numbers drift run to run. Any exact count in this plan decays the moment it is written. The plan's own answer, the Task 16 gate with a floor, is the durable form; the Claims table should point at the gate, not at snapshots.
- The stride A/B experiment cannot be repeated because the code that ran it is gone. Evidence quality is now fixed at one pair.

## What could not be verified, and what would verify it

- The 200 BPM baseline of 73 pattern bars (Task 3). A 200 BPM probe run before Task 3 starts would verify it.
- `wrangler versions upload` plus `versions deploy <id>@100%` behaving as Task 1 assumes. Nothing in this review ships anything, by rule. One Task 1 run against the real worker verifies it.
- Task 18's property test catching the historical ascending-sort defect. The shipped `bar-queue.ts:32-34` already has the fixed sort-then-slice-then-sort shape, so the mutation is plausible but unproven until the test exists.
- Whether a Workers AI cold call is actually visible in the first three seconds (Task 2's probe assertion). The probe prints `FAILED ... t=3828 AI call exceeded 1419ms` lines, so t values are readable, but "inside the first three seconds" was never demonstrated in the plan.

## Decisions that are the owner's alone

- Gap bars keep the generator by default, rests behind a per-room switch. The plan already marks this as his call, and it is a taste call, not a measurable one.
- The hedge in Task 5 spends real money when switched on. Default off is right, and only he flips it.
- Ship through versions rather than plain `wrangler deploy`. The rollback-by-id reason is factual, but changing the fleet's ship ritual is his call, not the plan's.
- Playwright becomes a devDependency of this repo (Task 17). It is the plan's only new dependency and it is his supply chain.

## Strongest counter-case

The plan's central arrangement is: measure the room with live probes, tighten the model's fit to the bar, then make the numbers durable with a post-deploy gate. The case against it is that the plan's decisive evidence sits inside run-to-run noise. The stride decision, the plan's key latency trade, rests on one A/B pair claiming zero difference, and this review's two same-policy runs differed by 4 model bars and 309 ms of max latency. The fallback count moved from 0 to 4 between runs of the same code. So the plan is least comfortable exactly where it claims most: single-run numbers presented as measured facts. Does the arrangement survive that case? Mostly yes, because Task 16 converts the one-run claim into a floor checked after every deploy, and the floor of 20 sits well below today's worst observed 37. But two parts do not survive unmodified: Task 3's comparison against an unmeasured 73-bar baseline would let a worker declare success against a number nobody produced, and Task 12's gate would fail on first contact for a reason no task fixes. Both are in the defect list; with those two fixed the design holds against its own worst case.

## Verdict

VERDICT: CHANGES NEEDED, 9 defects outstanding.
