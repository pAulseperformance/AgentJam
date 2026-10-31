<!-- Card body for plan:6e1d9bac9347c305:16. The spec is the plan's Task 16 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 6e1d9bac9347c305). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 16: Gate the room on the probe

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:6e1d9bac9347c305:16`



**Objective:** `check.sh --live` also runs a short probe and fails when the room publishes fewer model bars than the floor, or names a drum code in a prompt.

**Files:** create `scripts/probe-gate.mjs`
create `scripts/probe-all-pattern.json`
modify `check.sh`
read `tools/probe-session.mjs`

**Mutation:** run the gate against the all-pattern fixture, whose bars carry no model line, and it must exit non-zero with the floor line printed; with the fixture removed from the gate it exits 0 on the same file, which is the defect the floor exists to catch.

**Run:** `bash check.sh --live` prints the probe line and exits 0, then `node scripts/probe-gate.mjs scripts/probe-all-pattern.json` exits 1 and prints `model bars 0 (floor 20)`.
