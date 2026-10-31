<!-- Card body for plan:6e1d9bac9347c305:5. The spec is the plan's Task 5 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 6e1d9bac9347c305). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 5: Hedge the tail with a second call

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:6e1d9bac9347c305:5`



**Objective:** a room setting allows two identical calls 200 ms apart, and the first valid answer wins. The default is off, so the spend is his to turn on.

**Files:** modify `src/server/llm-planner.ts`
modify `src/server/jam-room.ts`
modify `src/shared/protocol/types.ts`
modify `src/server/jam-room.test.ts`

**Mutation:** delete the second call in a scratch copy and the case asserting two calls per hedged bar fails on a count of one.

**Run:** `npx vitest run src/server/jam-room.test.ts` green, then `bash deploy.sh`, then two probe runs at 200 BPM, one with the setting on and one off, print their worst latency and their call count per bar.
