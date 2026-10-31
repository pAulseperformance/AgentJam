<!-- Card body for plan:6e1d9bac9347c305:6. The spec is the plan's Task 6 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 6e1d9bac9347c305). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 6: Patch the bar's remaining eighths instead of dropping a late answer

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:6e1d9bac9347c305:6`



**Objective:** a render that misses its line may still address the part of the bar that has not played yet.

**Files:** modify `src/server/jam-room.ts`
create `src/server/late-patch.test.ts`

**Mutation:** remove the patch path in a scratch copy and the case expecting a note after the line, attributed to the late render, fails on an empty event list.

**Run:** `npx vitest run src/server/late-patch.test.ts` green, then `bash deploy.sh`, then the probe at 160 BPM prints `late 0` BY NAME on a 90 s run, and the card records the margin arithmetic that makes zero the true answer: `renderBudget` leaves at least 100 ms (usually 500) between the render's budget and the line it writes for, and measured calls peak at 2029 ms against a 2500 ms cap, so a late answer cannot fire on this room. Accepted 2026-10-31 after ten probes and about 770 model bars printed `late 0`: the patch stays as the backstop, and `late` moving off zero is the regression signal. A card that asserts a late bar must appear is asserting something the room's own margins forbid.
