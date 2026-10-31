<!-- Card body for plan:17f5bf3e0eb41cfb:1. The spec is the plan's Task 1 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 17f5bf3e0eb41cfb). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 1: Deploy through a version, with the credential wrapper on the line

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:17f5bf3e0eb41cfb:1`



**Objective:** one command uploads a version of the worker, deploys it at 100 percent, reads the version id back and then runs the live gate.

**Files:** create `deploy.sh`
modify `check.sh`
read `src/server/jam-room.ts`

**Mutation:** in a scratch copy, replace step 6's `npx wrangler versions deploy "${id}@100%"` with `npx wrangler deploy --dry-run` and the script's own read-back fails: a dry run performs no upload and moves no traffic, so `deployments status` still names the version that served before and step 6 exits 1 on `the version serving is <before>@100, NOT the one just uploaded (<id>@100%)`. Production cannot move, because `--dry-run` builds and stops, and the copy also runs under the scratch name `agent-jam-mutation`.

**Run:** `bash deploy.sh` prints `uploaded <id>`, `deployed <id>@100%` and then `bash check.sh --live` passes; the script calls `bash ~/.hermes/scripts/cf_run.sh npx wrangler versions upload` and `... versions deploy <id>@100% --yes` internally, because an unattended run has no browser login.
