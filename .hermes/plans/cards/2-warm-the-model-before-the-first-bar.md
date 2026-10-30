<!-- Card body for plan:94001bdcfe09a08b:2. The spec is the plan's Task 2 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 94001bdcfe09a08b). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 2: Warm the model before the first bar

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:94001bdcfe09a08b:2`



**Objective:** a room that opens and spawns an agent must not spend its first bar on a cold call.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/jam-room.test.ts`

**Mutation:** delete the warm call and the new case asserting exactly one warm render per room fails on a count of zero.

**Run:** `npx vitest run src/server/jam-room.test.ts` prints the new case green, then `bash deploy.sh`, then `node tools/probe-session.mjs --bpm 160 --seconds 30 --agents jazz --out /tmp/warm.json` prints no `AI call exceeded` inside the first three seconds.
