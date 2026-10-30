<!-- Card body for plan:938f032372d333da:4. The spec is the plan's Task 4 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 938f032372d333da). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 4: Ask for less when the tail will not fit

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:938f032372d333da:4`



**Objective:** when an agent's tail exceeds the window, the ask becomes two notes in a named slot instead of a bar.

**Files:** modify `src/server/llm-planner.ts`
modify `src/server/jam-room.ts`
modify `src/server/llm-planner.test.ts`

**Mutation:** force the planner to always ask for a bar in a scratch copy and the new case expecting a cell request at stride two fails on the prompt it receives.

**Run:** `npx vitest run src/server/llm-planner.test.ts` green, then `bash deploy.sh`, then the probe at 200 BPM prints at least one bar whose recorded prompt carries the cell request.
