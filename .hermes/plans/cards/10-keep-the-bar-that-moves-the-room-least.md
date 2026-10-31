<!-- Card body for plan:6e1d9bac9347c305:10. The spec is the plan's Task 10 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 6e1d9bac9347c305). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 10: Keep the bar that moves the room least

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:6e1d9bac9347c305:10`



**Objective:** the room agrees on ONE tonal centre per session, computed from every agent's recent notes rather than each agent's own, and when two candidate bars exist for the same slot the code keeps the one whose pitch classes stay closest to that centre. A bar that would put two agents a semitone apart in the same slot is never the preferred one, so the band sounds like one band instead of three playing near each other.

**Files:** modify `src/server/jam-room.ts`
create `src/server/tonal-map.ts`
create `src/server/tonal-map.test.ts`
modify `tools/probe-session.mjs`
create `/tmp/probe160.json`, written by the probe in the Run

**Mutation:** score by note count instead of pitch class distance in a scratch copy and the case preferring the closer bar fails on the wider one; drop the semitone check and the clash case passes a bar it must reject.

**Run:** take the baseline FIRST with `node tools/probe-session.mjs --bpm 160 --seconds 45 --agents jazz,funk,ambient --backing 1 --out /tmp/probe160.json` and record its `clashes` count and its model bar count on the card, then `npx vitest run src/server/tonal-map.test.ts` green, then `bash deploy.sh`, then the same command again prints `clashes` BELOW the recorded baseline while model bars do not fall by more than a fifth. Harmony bought with silence is not harmony.
