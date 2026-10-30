<!-- Card body for plan:938f032372d333da:1. The spec is the plan's Task 1 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 938f032372d333da). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 1: Deploy through a version, with the credential wrapper on the line

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:938f032372d333da:1`



**Objective:** one command uploads a version of the worker, deploys it at 100 percent, reads the version id back and then runs the live gate.

**Files:** create `deploy.sh`
modify `check.sh`
read `src/server/jam-room.ts`

**Mutation:** replace `versions deploy` with `wrangler deploy` in a scratch copy and the script's own version read-back fails on a missing id, which is the gate this task exists to add.

**Run:** `bash deploy.sh` prints `uploaded <id>`, `deployed <id>@100%` and then `bash check.sh --live` passes; the script calls `bash ~/.hermes/scripts/cf_run.sh npx wrangler versions upload` and `... versions deploy <id>@100% --yes` internally, because an unattended run has no browser login.
