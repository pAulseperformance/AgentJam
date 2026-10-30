<!-- Card body for plan:938f032372d333da:6. The spec is the plan's Task 6 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 938f032372d333da). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 6: Patch the bar's remaining eighths instead of dropping a late answer

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:938f032372d333da:6`



**Objective:** a render that misses its line may still address the part of the bar that has not played yet.

**Files:** modify `src/server/jam-room.ts`
create `src/server/late-patch.test.ts`

**Mutation:** remove the patch path in a scratch copy and the case expecting a note after the line, attributed to the late render, fails on an empty event list.

**Run:** `npx vitest run src/server/late-patch.test.ts` green, then `bash deploy.sh`, then the probe at 160 BPM prints at least one bar whose source names the late render.
