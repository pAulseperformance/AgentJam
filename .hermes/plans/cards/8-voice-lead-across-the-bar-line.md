<!-- Card body for plan:938f032372d333da:8. The spec is the plan's Task 8 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 938f032372d333da). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 8: Voice-lead across the bar line

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:938f032372d333da:8`



**Objective:** where a bar can start a step from the previous bar's last note, it does, and when the lead changes hands the new agent starts a step from the OTHER agent's last note, so the phrase passes between them instead of restarting.

**Files:** modify `src/server/melody.ts`
modify `src/server/jam-room.ts`
create `src/server/voice-leading.test.ts`

**Mutation:** remove the step move in a scratch copy and the case asserting a stepwise start after a phrase ends fails on a leap; the second case asserts the handover bar starts a step from the outgoing agent's last note, and removing the handover move fails it on a restart at the agent's own centre.

**Run:** `npx vitest run src/server/voice-leading.test.ts` green, then `bash deploy.sh`.
