<!-- Card body for plan:938f032372d333da:15. The spec is the plan's Task 15 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 938f032372d333da). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 15: Read a dropped session file with one command

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:938f032372d333da:15`



**Objective:** any export or probe file prints the same summary the probe prints, without a hand-written script.

**Files:** create `tools/read-session.mjs`
read `tools/probe-session.mjs`

**Mutation:** read only the note rows in a scratch copy and the file's own run prints zero model bars on `arm-tail.json`, where the probe printed 38.

**Run:** generate the input first with `node tools/probe-session.mjs --bpm 160 --seconds 30 --agents jazz --out /tmp/rs.json`, then `node tools/read-session.mjs /tmp/rs.json` prints the SAME four numbers and the same latency line the probe printed for that run. No count is hardcoded: a reader that disagrees with the probe's own summary on the same file has failed.
