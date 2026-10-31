# REVIEW: jam band and audit, eighteen cards

Repo `agentJam` | Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md` (sha16 6e1d9bac9347c305) | Card key `plan:6e1d9bac9347c305:review.md`

**Objective:** grade the eighteen implementation cards as a whole against the plan's own gates, on the tree as it stands, and report a verdict the owner can act on.

## Where the work lives

Every implementation card works in place in `/Users/v99/Projects/Music/agentJam` on `main` and commits its own task. Every worker-changing card also deploys through `bash deploy.sh`, so the tree at review time carries each card's commit and the live worker carries the last of them. Read the commits, not the card summaries: a card's completion note is a self-report.

## What to grade

1. The plan's `## Verification` block, in order: the suite, `bash check.sh --live`, the two probe runs at 160 and 200 BPM, and the browser smoke. Quote each command's own line.
2. The four numbers the plan promises and what the cards actually produced: model bars, generator bars, fallbacks, and drum codes named in a prompt (which must be 0).
3. The screen: the panel drawn in the artifact against what Task 12 rendered, in the five states the artifact names, with any mismatch reported as a finding rather than a note.
4. Every card's `Mutation:` line, graded for the four classes that read as proof and are not: a mutation naming a symbol the task itself creates, one attached to a task that fixes an absence, one that only re-counts what it deleted, and one that damages the live target.
5. The claim this plan labels BORROWED (the price of a hedged call): if any card turned the hedge on by default, that is a finding, because the plan ships it off.

## The verdict

End with a `VERDICT:` line, one of `PASS`, `PASS WITH FINDINGS`, or `REQUEST CHANGES`, followed by at most five numbered findings, each naming the card, the command that showed it, and what would fix it.

**Files:** read `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`
read `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md.review.md`
read `check.sh`
read `tools/probe-session.mjs`

**Mutation:** delete one implementation card's commit from a scratch clone and the review must fail to find that task's output and say so; a review that reports PASS on a clone missing a card has graded the plan's prose rather than the tree.

**Run:** the review prints the five graded sections with the command each cites, then the `VERDICT:` line, and writes nothing to the tree.
