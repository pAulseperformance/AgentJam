<!-- Card body for plan:94001bdcfe09a08b:9. The spec is the plan's Task 9 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 94001bdcfe09a08b). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 9: Trade fours in two-bar turns

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:94001bdcfe09a08b:9`



**Objective:** the lead rotation becomes call and response over two bars, and the prompts say which half of the trade the agent is in.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/llm-planner.ts`
create `src/server/trade.test.ts`

**Mutation:** set the trade period back to one bar in a scratch copy and the case reading a two-bar call from one agent and an answer from the other fails on a one-bar rotation.

**Run:** `npx vitest run src/server/trade.test.ts` green, then `bash deploy.sh`, then the probe at 160 BPM prints roles that alternate in pairs rather than bar by bar.
