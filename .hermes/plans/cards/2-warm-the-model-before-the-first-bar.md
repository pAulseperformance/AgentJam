<!-- Card body for plan:17f5bf3e0eb41cfb:2. The spec is the plan's Task 2 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 17f5bf3e0eb41cfb). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 2: Warm the model before the first bar

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:17f5bf3e0eb41cfb:2`



**Objective:** a room that opens and spawns an agent must not spend its first bar on a cold call.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/jam-room.test.ts`

**Mutation:** drop `await this.modelWarm` from `renderAgentBar` in a scratch copy, so a render starts while the model is still loading, and the case `warms the model exactly once per room, and no render starts before it answers` fails on the call that must not exist yet: `expected 2 to be 1` at `expect(calls.length).toBe(1)`. That second call is the cold start the warm removes: measured on the live room before the warm, the first model call died on `AI call exceeded 1359ms`.

**Run:** `npx vitest run src/server/jam-room.test.ts` prints the new case green, then `bash deploy.sh`, then `node tools/probe-session.mjs --bpm 160 --seconds 30 --agents jazz --out /tmp/warm.json` prints no `AI call exceeded` inside the first three seconds.
