<!-- Card body for plan:17f5bf3e0eb41cfb:11. The spec is the plan's Task 11 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 17f5bf3e0eb41cfb). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 11: Store the band's motifs for a room, with the sweep

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:17f5bf3e0eb41cfb:11`



**Objective:** a room keeps the last four motifs per agent for seven days and offers them on the next render, and an alarm deletes anything older.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/jam-room.test.ts`
create `src/server/motif-bank.ts`
create `src/server/motif-bank.test.ts`

**Mutation:** stop offering the bank's row at spawn in a scratch copy and the second session's first prompt loses the earlier statement: the case `offers a statement from the first session inside the second session prompt` fails on the prompt not carrying the marker (`expected ... to contain 'EARLIER SESSION:'`). Separately, make the sweep delete every row rather than the expired ones and the case `deletes a bank row older than seven days when the alarm fires` fails on the live row's statement being gone (`expected undefined to deeply equal { ... }`), because a sweep that takes a statement inside its seven days forgets a band the room still owes.

**Run:** `npx vitest run src/server/motif-bank.test.ts` green, then `bash deploy.sh`, then the probe run twice on the same room id prints a motif from the first session inside a second-session prompt.
