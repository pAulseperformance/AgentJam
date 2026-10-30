<!-- Card body for plan:bc1c6ce369f30093:10. The spec is the plan's Task 10 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 bc1c6ce369f30093). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 10: Keep the bar that moves the room least

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:bc1c6ce369f30093:10`



**Objective:** when two candidate bars exist for the same slot, the code keeps the one whose pitch classes stay closest to the room's centre.

**Files:** modify `src/server/jam-room.ts`
create `src/server/tonal-map.ts`
create `src/server/tonal-map.test.ts`

**Mutation:** score by note count instead of pitch class distance in a scratch copy and the case preferring the closer bar fails on the wider one.

**Run:** `npx vitest run src/server/tonal-map.test.ts` green, then `bash deploy.sh`.
