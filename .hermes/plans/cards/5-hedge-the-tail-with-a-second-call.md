<!-- Card body for plan:17f5bf3e0eb41cfb:5. The spec is the plan's Task 5 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 17f5bf3e0eb41cfb). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 5: Hedge the tail with a second call

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:17f5bf3e0eb41cfb:5`



**Objective:** a room setting allows two identical calls 200 ms apart, and the first valid answer wins. The default is off, so the spend is his to turn on.

**Files:** modify `src/server/llm-planner.ts`
modify `src/server/jam-room.ts`
modify `src/shared/protocol/types.ts`
modify `src/server/jam-room.test.ts`

**Mutation:** delete the second call in a scratch copy (pass `hedgeMs` as 0 whatever the setting) and the hedged bar's calls per bar falls from two to one: the case `spends two identical calls 200 ms apart on a hedged bar, and plays the first valid answer` fails on `expected 1 to be 2`, which is the spend the Run prints per bar. Then issue the pair 20 ms apart instead of 200 and the same case fails on the spacing: `expected 22 to be greater than or equal to 190`, because a burst is one question asked twice at no extra speed.

**Run:** `npx vitest run src/server/jam-room.test.ts` green, then `bash deploy.sh`, then two probe runs at 200 BPM, one with the setting on and one off, print their worst latency and their call count per bar.
