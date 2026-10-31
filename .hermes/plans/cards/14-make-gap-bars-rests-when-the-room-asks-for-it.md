<!-- Card body for plan:17f5bf3e0eb41cfb:14. The spec is the plan's Task 14 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 17f5bf3e0eb41cfb). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 14: Make gap bars rests when the room asks for it

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:17f5bf3e0eb41cfb:14`



**Objective:** a room setting turns the generator off in gap bars so the agent's slower rate is audible as space.

**Files:** modify `src/server/jam-room.ts`
modify `src/shared/protocol/types.ts`
modify `src/client/pages/JamRoom.tsx`
create `src/server/gap-policy.test.ts`

**Mutation:** ignore the setting in a scratch copy and the case expecting an empty bar with the switch on fails on generator notes.

**Run:** `npx vitest run src/server/gap-policy.test.ts` green, then `bash deploy.sh`, then the probe with the switch on prints more `rest` bars and fewer `pattern` bars than with it off.
