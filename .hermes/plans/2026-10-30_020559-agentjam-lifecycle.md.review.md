# Review: agentJam Lifecycle Plan

ONE self-pass, not the two the process asks for. The residual risk the missing second pass would have graded is the mechanics of `check.sh` itself: no card has run it yet, so its first failure will probably be its own path (the class the lifecycle skill names: a wrapper that `cd`s to the wrong tree exits 127 and the stamp that follows records a gate that never ran). Task 1's Run line therefore proves the wrapper able to FAIL before its pass is trusted, and Task 9 stamps only after a real pass.

Plan sha16 at review: `40ef59568e2ea112`. Cards cut from this plan key on that hash.

## What this pass found and fixed in the plan

| Finding | Fix applied |
|---|---|
| Task 7 said "at least six rows" and never named them, so the walker had to invent the map | the six rows are now listed by id with their actors, expectations and which are MANUAL |
| Row P6 would have made `check.sh --live` permanently red while the `jam.zpe.vc` finding is open | P6 is MANUAL with the measured sentence, so the gate stays honest and the finding is tracked instead of hidden |
| The registry refresh had no finding document to land in | Task 10 creates `docs/FINDINGS.md` and carries the 302 row with both measuring commands |

## What was measured rather than assumed

- The suite is 101 tests (`npx vitest run`), so the floor in `check.sh` is 101 today.
- `package.json:17` declares `test` as `vitest run`, so `check.sh` wraps exactly one command.
- `https://zpe.vc/jam/` answers 200, and `https://jam.zpe.vc/api/room/x/ws` answers 426 from the app itself.
- `https://jam.zpe.vc/` answers 302 to `https://zpe.vc/services` on GET, and its own 301 on HEAD, which places the intercepting layer upstream of this Worker.
- The registry row for jam carries commit `0cfdfe4` (HEAD is `ffca47f`) and `surface: internal` beside `access: public`.

## The two questions that are the owner's

1. **Approve this lifecycle plan as written?** Recommended: yes. It adds ten artifacts and changes no product code, so the undo is deleting the files, and every gate is a command you can re-run. The alternative is to approve only the four shipping files (`check.sh`, `HALT`, `RUNBOOK.md`, `TRAPS.md`) and leave the dossier and the page walk until the app changes again.
2. **The `jam.zpe.vc` page request that lands on `/services`:** recommended fix in `~/Projects/zpe-vc`, because the app answers HEAD with its own 301 and never sees GET, so no rule inside agentJam can win that race. The alternative is to retire the app's own-name redirect claim entirely, in the worker comment and the registry row, and treat `zpe.vc/jam` as the only door.

## Known costs

- The pass floor is a number, so the next test that lands must raise it in the same commit as the test. That is the point of a floor (a shard that silently stops running fails), and it is also the one line in `check.sh` that will need touching most often.
- `docs/PATHS.md` will carry two MANUAL rows a walker cannot assert. They are skipped with a reason, never passed.
