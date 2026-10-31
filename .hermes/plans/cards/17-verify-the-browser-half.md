<!-- Card body for plan:6e1d9bac9347c305:17. The spec is the plan's Task 17 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 6e1d9bac9347c305). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 17: Verify the browser half

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:6e1d9bac9347c305:17`



**Objective:** a headless load of the live page joins, spawns one agent, counts sockets and asserts one model bar inside twelve seconds.

**Files:** create `tools/browser-smoke.mjs`
modify `package.json`
modify `check.sh`

**Mutation:** open a second socket inside the script in a scratch copy and the one-socket assertion fails on a count of two.

**Run:** `npm i -D playwright` and `npx playwright install chromium` once, then `node tools/browser-smoke.mjs --url https://zpe.vc/jam/` prints `sockets 1` and `model bars >= 1`. The dependency is the cost of this task and it is a dev dependency only.
