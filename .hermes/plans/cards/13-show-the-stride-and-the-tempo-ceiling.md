<!-- Card body for plan:17f5bf3e0eb41cfb:13. The spec is the plan's Task 13 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 17f5bf3e0eb41cfb). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 13: Show the stride and the tempo ceiling

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:17f5bf3e0eb41cfb:13`



**Objective:** each agent carries a badge saying how often it writes, and the tempo control marks where one bar per bar stops being possible.

**Files:** modify `src/client/features/room/ui/session-panel.tsx`
modify `src/client/features/room/lib/session-summary.ts`
modify `src/client/features/room/lib/session-summary.test.ts`
modify `src/client/pages/JamRoom.tsx`
modify `src/server/jam-room.ts`

**Mutation:** make the badge print `writes every bar` for every pace in a scratch copy, so a room writing every second bar tells a listener it writes every bar, and the case `carries the stride the room published from the debug meta to the badge` fails on `expected 'writes every bar' to be 'writes every 2 bars'`. Separately, drop `stride: agentMeta.stride ?? null` from the recorder's projection and the same case fails on `expected null to be 2`, since a badge with no rate is a pace the panel cannot state.

**Run:** `npx vitest run src/client` green, then `bash deploy.sh`, then a 160 BPM probe prints a stride in the debug meta of every paced bar.
