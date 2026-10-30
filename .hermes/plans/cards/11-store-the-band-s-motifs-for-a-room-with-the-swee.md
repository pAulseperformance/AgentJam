<!-- Card body for plan:bc1c6ce369f30093:11. The spec is the plan's Task 11 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 bc1c6ce369f30093). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 11: Store the band's motifs for a room, with the sweep

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:bc1c6ce369f30093:11`



**Objective:** a room keeps the last four motifs per agent for seven days and offers them on the next render, and an alarm deletes anything older.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/jam-room.test.ts`
create `src/server/motif-bank.ts`
create `src/server/motif-bank.test.ts`

**Mutation:** stop writing the bank in a scratch copy and the case reading a stored motif in a second session fails on an empty store; separately, remove the alarm and the sweep case fails on a row older than seven days still present.

**Run:** `npx vitest run src/server/motif-bank.test.ts` green, then `bash deploy.sh`, then the probe run twice on the same room id prints a motif from the first session inside a second-session prompt.
