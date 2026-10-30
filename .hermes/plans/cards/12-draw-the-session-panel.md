<!-- Card body for plan:938f032372d333da:12. The spec is the plan's Task 12 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 938f032372d333da). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 12: Draw the session panel

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:938f032372d333da:12`



**Objective:** the page shows the last session's model bars, rests, quiet bars, latency and failures, computed by a pure function from the recorder, with the five states the artifact draws.

**The gate cannot be a component test.** `vitest.config.ts` uses `defineWorkersConfig` with no DOM environment, and `jsdom` and `@testing-library/react` are not in devDependencies, so a `.tsx` test has nowhere to run. The cheap fix is to put the numbers in a pure module and test that, which needs no new dependency. Adding a DOM environment to this repo is the expensive fix and is not this task's business.

**Files:** create `src/client/features/room/lib/session-summary.ts`
create `src/client/features/room/lib/session-summary.test.ts`
create `src/client/features/room/ui/session-panel.tsx`
modify `src/client/pages/JamRoom.tsx`
modify `src/client/features/room/lib/session-recorder.ts`
read `.hermes/plans/artifacts/2026-10-30-jam-session-summary.html`

**Mutation:** make `summarize` return the empty state unconditionally in a scratch copy; the case asserting a populated summary after two recorded bars must fail on zero model bars.

**Run:** `npx vitest run src/client/features/room/lib/session-summary.test.ts` green, then `bash deploy.sh`, then `bash check.sh --live` prints the live shell at 200 with the new bundle name, and the panel is judged by opening the room: the five states draw, each one labelled in plain words.
