<!-- Card body for plan:17f5bf3e0eb41cfb:7. The spec is the plan's Task 7 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 17f5bf3e0eb41cfb). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 7: One accent map for the room

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:17f5bf3e0eb41cfb:7`



**Objective:** every agent's dynamics follow the drummer's accents, so the band breathes together.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/melody.ts`
read `src/server/groove.ts`
create `src/server/accents.test.ts`

**Mutation:** make `roomAccents` answer with the bar's pulse even when a drummer is playing in a scratch copy, so the band stops following the kit, and the case `follows the drummer's accents when a drummer joins, and stops following the bar's pulse there` fails on the map it read: `expected 'pulse' to be 'drummer'`. The beat-two assertion behind it, a note the jazz figure leaves empty losing at least 10 of velocity against the pulse, is what a single global volume change still cannot fake.

**Run:** `npx vitest run src/server/accents.test.ts` green, then `bash deploy.sh`, then the probe at 160 BPM shows distinct velocity sets per bar in its summary.
