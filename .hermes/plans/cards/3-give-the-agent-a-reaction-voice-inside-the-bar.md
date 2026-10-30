<!-- Card body for plan:938f032372d333da:3. The spec is the plan's Task 3 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 938f032372d333da). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 3: Give the agent a reaction voice inside the bar

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:938f032372d333da:3`



**Objective:** at a stride above one, the gap bars are played by short cells from the same agent rather than by the generator alone.

**Files:** modify `src/server/jam-room.ts`
modify `src/server/bar-queue.ts`
create `src/server/reaction.ts`
create `src/server/reaction.test.ts`
create `/tmp/probe200.json`, written by the probe in the Run

**Mutation:** remove the cell scheduler from a scratch copy and the case asserting note-on events inside a gap bar fails with an empty list for that bar.

**Run:** `npx vitest run src/server/reaction.test.ts` green, then take the baseline FIRST with `node tools/probe-session.mjs --bpm 200 --seconds 30 --agents jazz,funk,ambient --backing 1 --out /tmp/probe200.json` and record its `pattern` count on the card, then `bash deploy.sh`, then the same command, overwriting `/tmp/probe200.json`, prints a `pattern` count BELOW that recorded baseline. A run without a recorded baseline is not an acceptance.
