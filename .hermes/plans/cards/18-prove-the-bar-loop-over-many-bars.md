<!-- Card body for plan:bc1c6ce369f30093:18. The spec is the plan's Task 18 section at
     .hermes/plans/2026-10-31_011630-jam-band-and-audit.md (sha16 bc1c6ce369f30093). Do not edit the plan.
     Repo: /Users/v99/Projects/Music/agentJam. Work in place, commit per the task's Commit line. -->

# Task 18: Prove the bar loop over many bars

Repo `agentJam`  |  Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`  |  Card key `plan:bc1c6ce369f30093:18`



**Objective:** a property test runs the queue, stride and bar-line policy over thousands of bars with changing tempo and latency, and asserts the invariants the last three sessions fixed.

**Files:** create `src/server/bar-loop.property.test.ts`
read `src/server/bar-queue.ts`

**Mutation:** reintroduce the ascending sort and slice in a scratch copy and the property fails on a simulated session that stops writing model bars, which the shipped code passes.

**Run:** `npx vitest run src/server/bar-loop.property.test.ts` prints the property cases green over at least a thousand simulated bars.
