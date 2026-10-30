<!-- Card body for plan:938f032372d333da:7. The spec is the plan's Task 7 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 938f032372d333da). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 7: One accent map for the room

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:938f032372d333da:7`



**Objective:** every agent's dynamics follow the drummer's accents, so the band breathes together.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/melody.ts`
read `src/server/groove.ts`
create `src/server/accents.test.ts`

**Mutation:** drop the accent argument from the `shapeLine` call in a scratch copy and the case comparing two bars against one accent map fails on identical velocity profiles.

**Run:** `npx vitest run src/server/accents.test.ts` green, then `bash deploy.sh`, then the probe at 160 BPM shows distinct velocity sets per bar in its summary.
