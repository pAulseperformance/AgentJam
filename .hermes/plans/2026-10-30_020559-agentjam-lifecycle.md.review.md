# Review: agentJam Lifecycle Plan

ONE self-pass, not the two the process asks for. The residual risk the missing second pass would have graded is the mechanics of `check.sh` itself: no card has run it yet, so its first failure will probably be its own path (the class the lifecycle skill names: a wrapper that `cd`s to the wrong tree exits 127 and the stamp that follows records a gate that never ran). Task 1's Run line therefore proves the wrapper able to FAIL before its pass is trusted, and Task 9 stamps only after a real pass.

Plan sha16 at review: `7a529f0ed3dfec89`, after Revision 1 (the own-name door retired rather than repaired, his call on 2026-10-30). The first draft was `40ef59568e2ea112`; any card created before Revision 1 keys on that one, and the two differ only in the decision row, Task 10 and the appended revision.

## What this pass found and fixed in the plan

| Finding | Fix applied |
|---|---|
| Task 7 said "at least six rows" and never named them, so the walker had to invent the map | the six rows are now listed by id with their actors, expectations and which are MANUAL |
| Row P6 would have made `check.sh --live` permanently red while the `jam.zpe.vc` finding is open | P6 is MANUAL with the measured sentence, so the gate stays honest and the finding is tracked instead of hidden |
| The registry refresh had no finding document to land in | Task 10 creates `docs/FINDINGS.md` and carries the 302 row with both measuring commands |
| Task 10's Run predicted `admit.py` would print `ok` on every stage | measured: `admit.py --only jam --live` reports seven passes and five unknowns (api, wire, guard, shell) because the row publishes no contract by declaration, so the Run line now requires no FAIL and names the unknowns |

## What was measured rather than assumed

- The suite is 101 tests (`npx vitest run`), so the floor in `check.sh` is 101 today.
- `package.json:17` declares `test` as `vitest run`, so `check.sh` wraps exactly one command.
- `https://zpe.vc/jam/` answers 200, and `https://jam.zpe.vc/api/room/x/ws` answers 426 from the app itself.
- `https://jam.zpe.vc/` answers 302 to `https://zpe.vc/services` on GET, and its own 301 on HEAD, which places the intercepting layer upstream of this Worker.
- The registry row for jam carries commit `0cfdfe4` (HEAD is `ffca47f`) and `surface: internal` beside `access: public`.

## The questions the owner answered, and what changed

1. **Approve the plan:** he approved all ten artifacts, in order. Stages 5, 9 and 11 are now closed by command (`spec_gate.py dossier` and `spec_gate.py repo` both read COMPLETE, the stamp was earned by running `bash check.sh --live`).
2. **The `jam.zpe.vc` page request:** he chose to retire the claim rather than repair the zone layer, in his words "Retire the claim in agentJam". Revision 1 records what survived of the original reasoning and the cost accepted: a visitor who types the old name lands on `/services`.

## Known costs

- The pass floor is a number, so the next test that lands must raise it in the same commit as the test. That is the point of a floor (a shard that silently stops running fails), and it is also the one line in `check.sh` that will need touching most often.
- `docs/PATHS.md` will carry two MANUAL rows a walker cannot assert. They are skipped with a reason, never passed.
