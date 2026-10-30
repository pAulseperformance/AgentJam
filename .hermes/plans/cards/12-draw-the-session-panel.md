<!-- Card body for plan:94001bdcfe09a08b:12. The spec is the plan's Task 12 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 94001bdcfe09a08b). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 12: Draw the session panel

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:94001bdcfe09a08b:12`



**Objective:** the page shows the last session's model bars, rests, quiet bars, latency and failures, computed from the recorder, with the five states the artifact draws.

**Files:** create `src/client/features/room/ui/session-panel.tsx`
create `src/client/features/room/ui/session-panel.test.tsx`
modify `src/client/pages/JamRoom.tsx`
modify `src/client/features/room/lib/session-recorder.ts`
read `.hermes/plans/artifacts/2026-10-30-jam-session-summary.html`

**Mutation:** return the empty state always in a scratch copy and the case asserting a populated summary after two recorded bars fails on zero model bars.

**Run:** `npx vitest run src/client` green, then `bash deploy.sh`, then `bash check.sh --live` prints the live shell at 200 with the new bundle name.
