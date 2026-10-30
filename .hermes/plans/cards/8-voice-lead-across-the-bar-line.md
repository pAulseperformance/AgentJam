<!-- Card body for plan:94001bdcfe09a08b:8. The spec is the plan's Task 8 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 94001bdcfe09a08b). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 8: Voice-lead across the bar line

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:94001bdcfe09a08b:8`



**Objective:** where a bar can start a step from the previous bar's last note, it does.

**Files:** modify `src/server/melody.ts`
modify `src/server/jam-room.ts`
create `src/server/voice-leading.test.ts`

**Mutation:** remove the step move in a scratch copy and the case asserting a stepwise start after a phrase ends fails on a leap.

**Run:** `npx vitest run src/server/voice-leading.test.ts` green, then `bash deploy.sh`.
