<!-- Card body for plan:17f5bf3e0eb41cfb:18. The spec is the plan's Task 18 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 17f5bf3e0eb41cfb). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 18: Prove the bar loop over many bars

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:17f5bf3e0eb41cfb:18`



**Objective:** a property test runs the queue, stride and bar-line policy over thousands of bars with changing tempo and latency, and asserts the invariants the last three sessions fixed.

**Files:** create `src/server/bar-loop.property.test.ts`
read `src/server/bar-queue.ts`

**Mutation:** reintroduce the ascending sort and slice in a scratch copy and the trim property fails on 2 of its 16 cases, both in the trim: `keeps the newest entries when more arrive than there are slots` fails on the bar it kept (`expected [ 95 ] to deeply equal [ 381 ]`, the lowest bar kept where the newest was due) and its own falsifier `fails the same cases under the ascending sort and slice` reports `the ascending sort and slice agreed with the shipped trim everywhere: expected 0 to be greater than 60`, because the shipped trim and the legacy trim are then the same code. No session stops writing model bars: `prunePast` covers that, which is why the line names the trim and not the session.

**Run:** `npx vitest run src/server/bar-loop.property.test.ts` prints the property cases green over at least a thousand simulated bars.
