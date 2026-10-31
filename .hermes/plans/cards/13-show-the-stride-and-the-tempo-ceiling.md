<!-- Card body for plan:6e1d9bac9347c305:13. The spec is the plan's Task 13 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 6e1d9bac9347c305). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 13: Show the stride and the tempo ceiling

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:6e1d9bac9347c305:13`



**Objective:** each agent carries a badge saying how often it writes, and the tempo control marks where one bar per bar stops being possible.

**Files:** modify `src/client/features/room/ui/session-panel.tsx`
modify `src/client/features/room/lib/session-summary.ts`
modify `src/client/features/room/lib/session-summary.test.ts`
modify `src/client/pages/JamRoom.tsx`
modify `src/server/jam-room.ts`

**Mutation:** remove the stride from the published debug meta in a scratch copy and the badge case fails on a missing field.

**Run:** `npx vitest run src/client` green, then `bash deploy.sh`, then a 160 BPM probe prints a stride in the debug meta of every paced bar.
