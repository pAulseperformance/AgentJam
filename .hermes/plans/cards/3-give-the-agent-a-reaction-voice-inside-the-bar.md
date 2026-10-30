<!-- Card body for plan:94001bdcfe09a08b:3. The spec is the plan's Task 3 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 94001bdcfe09a08b). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 3: Give the agent a reaction voice inside the bar

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:94001bdcfe09a08b:3`



**Objective:** at a stride above one, the gap bars are played by short cells from the same agent rather than by the generator alone.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/bar-queue.ts`
create `src/server/reaction.ts`
create `src/server/reaction.test.ts`

**Mutation:** remove the cell scheduler from a scratch copy and the case asserting note-on events inside a gap bar fails with an empty list for that bar.

**Run:** `npx vitest run src/server/reaction.test.ts` green, then `bash deploy.sh`, then the probe at 200 BPM prints fewer `pattern` bars than the 73 measured today.
