# Cards: jam band and audit

Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`
sha16 bc1c6ce369f30093 (the stamp the bodies carry and the one to verify with)
Identity `plan:94001bdcfe09a08b:<n>`: the cards were created when the plan was stamped 94001bdcfe09a08b, and a card's idempotency key cannot be edited, so the keys stay on the old stamp while every body carries the new one.
Repo `/Users/v99/Projects/Music/agentJam`, every card in `dir:` on `main`.

## The graph

| Card | Token | Title | Assignee |
|---|---|---|---|
| t_ce470719 | story | STORY: who walks in, and what they must see | designer |
| t_0c1e3366 | screen | SCREEN: the session panel, drawn before the code that fills it | designer |
| t_f4d7a7fb | plan-review | PLAN REVIEW: the plan read by a different model | reviewer |
| t_1de3fa17 | 1 | Deploy through a version, with the credential wrapper on the line | implementer |
| t_cff49d5a | 2 | Warm the model before the first bar | implementer |
| t_f6511b2c | 3 | Give the agent a reaction voice inside the bar | implementer |
| t_47eab239 | 4 | Ask for less when the tail will not fit | implementer |
| t_2dca138d | 5 | Hedge the tail with a second call | implementer |
| t_1d953914 | 6 | Patch the bar's remaining eighths instead of dropping a late answer | implementer |
| t_f03149ce | 7 | One accent map for the room | implementer |
| t_e9684360 | 8 | Voice-lead across the bar line | implementer |
| t_969d54a6 | 9 | Trade fours in two-bar turns | implementer |
| t_4efb0801 | 10 | Keep the bar that moves the room least | implementer |
| t_7a9a3c52 | 11 | Store the band's motifs for a room, with the sweep | implementer |
| t_09c2f561 | 12 | Draw the session panel | implementer |
| t_d29dfba9 | 13 | Show the stride and the tempo ceiling | implementer |
| t_9a094a60 | 14 | Make gap bars rests when the room asks for it | implementer |
| t_ee95821d | 15 | Read a dropped session file with one command | implementer |
| t_8a14f7db | 16 | Gate the room on the probe | implementer |
| t_9f8d73df | 17 | Verify the browser half | implementer |
| t_5e4feba0 | 18 | Prove the bar loop over many bars | implementer |
| t_0d9f0862 | owner-phase1-listening | OWNER: listen to the room at 160 BPM, then say carry on | default, parked `blocked` |
| t_d9c4b6ab | review | REVIEW: jam band and audit, eighteen cards | reviewer, `z-ai/glm-5.3-flash` via `veil` |

Order: story then screen, then the plan review gates Task 1, then Tasks 1 to 18 in sequence, then the review. Every implementation card waits on the screen card and on the previous card; the review waits on all eighteen and on the screen. One subscription row, on the review card, so it is the only card that messages the owner.

The plan review is a PARENT of Task 1: no build starts until a different model has read the plan. Its verdict lands as a comment plus a summary; read it the moment it leaves `running`, apply any finding that makes a task's Run or Mutation unrunnable to the plan first, then re-cut and push the text to every card that is not running.

## Known-shape findings, recorded rather than repaired

`check_cards.py` reports 22 findings, every one of them the accepted class: a path the plan CREATES (`create \`src/server/reaction.test.ts\`` and its eighteen siblings) does not resolve, because the card checker has no create concept. The plan is the spec and its Files lists stay exact; the repair the skill offers (writing those paths as prose in the plan) would weaken every Files block in the document for a check that reads bodies rather than the tree.

`check_card_graph.py` passes with `--id` listing the screen card, the eighteen implementation cards and the review. Two things it taught, worth carrying to the next cut:

- The review id and the screen id must be INSIDE `--id`, or assertions 5 and 10 read `cards.get(id)` as empty and report `no model_override` and `assigned to None` about cards that carry both.
- An archived parent that still holds a link reads as a card that can never finish, so the review reports deadlocked behind it. Unlink the archived screen before re-checking.

## One change made to the tooling, not to this graph

`scripts/cut_plan_cards.py` in the `execute-plan-in-the-lane` skill wrote the plan's BARE filename into each body's provenance line, and the card checker reads that token as an anchor, so every body in the first cut failed `ANCHOR` on its own header. The cutter now writes the repo-relative path when the plan lives inside the repo. The bodies in this directory were re-cut after that fix.

## The provider pin, corrected

The first cut created both review cards with `--provider custom`, which no profile serves: the reviewer
profile's own model block names `provider: veil` against the local proxy, so the plan review blocked on
its first turn with `No LLM provider configured` and the graph review would have blocked the same way.
Both were archived (`t_b971af34`, `t_8e81ba7d`) and re-created on `--provider veil` with
`z-ai/glm-5.3-flash`, which is what `t_f4d7a7fb` and `t_d9c4b6ab` are. The 18 implementation cards carry
no override and inherit the implementer profile's provider, so they were untouched.

Lesson for the next cut: name a provider that exists in the ASSIGNEE's own config (`model.provider` in
`~/.hermes/profiles/<name>/config.yaml`), not the name of the integration it wraps.

## The two owner decisions taken before Task 1 dispatched

Answered 2026-10-31 by the owner, both recorded here so the next reader sees the call rather than a gap.

1. **The chain stops after Phase 1.** Tasks 1 to 6 change what the room is at high tempo, and he hears it before the band, the surface and the tools land on top. The stop is the card `t_0d9f0862`, assigned to `default` and parked `blocked`, linked as a parent of Task 7. Completing it on his `carry on` releases Phase 2; leaving it blocked leaves the chain parked with the room on Phase 1. The question was put with three options and he skipped it, which is a decision left to me, so the recommended one stands.
2. **Task 17 keeps playwright.** One dev dependency plus a one-time chromium download, roughly 120 MB on this host, because otherwise the socket-count fix stays proven only by a probe that never opens the page.

## The independent read, and what it changed

The plan review card `t_f4d7a7fb` returned `VERDICT: CHANGES NEEDED, 9 defects outstanding` and wrote it to
`.hermes/plans/2026-10-31_011630-jam-band-and-audit.review.md`. It re-ran every claim in the plan against
this tree. Eight of the nine changed the plan, and the chain stayed parked while they landed, because a
card that cannot pass its own gate is worse than a card that starts late.

| Defect | What the review measured | What the plan says now |
|---|---|---|
| Task 12's gate cannot pass | `vitest.config.ts` uses `defineWorkersConfig`, no DOM environment, no jsdom or testing-library in devDependencies, so a React component test has nowhere to run | Task 12 splits a pure `session-summary.ts` out of the component and tests that module, which runs in the existing pool. The component is judged by opening the room. No new dependency |
| Suite is 175/175 | `npx vitest run` prints 178, `check.sh:36` carries `FLOOR=178` | the claim reads 178/178, and each task raises the floor in its own commit |
| Exact probe numbers | two runs gave 37 and 41 model bars, max latency 1,953 and 2,262 ms | the claims read ranges with the run count, not one run's snapshot |
| The stride A/B is unrepeatable | the switch is deleted at `jam-room.ts:928`, and two same-policy runs differ by 4 bars | the decision's evidence line now says one pair, zero difference, inside run variance, and cannot be repeated |
| Wrong anchor | `summarizePhrase`'s only caller is `jam-room.ts:1282` | the anchor is corrected |
| The gate counts test files | 13 today and 10 more created by the tasks, so 14 was never right | the gate asserts every file green and a count at or above the floor, and drops the file count |
| Task 15 reads a file no task makes | `/tmp/arm-tail.json` exists only because the review re-ran the probe, and it holds 37 model bars where the Run asserted 38 | Task 15 generates its own input with the probe and compares the reader against that same run's summary, no hardcoded count |
| Task 3 compares against nothing | the 73 pattern bars at 200 BPM appear in no Claims row and no task produces them | Task 3 takes its own baseline first and records the number on the card, then compares after the deploy |
| 36 or 35 generator bars | the Decisions table and the Claims table disagreed | one range across four runs, tied to the probe command |

The review's strongest point stands and the plan does not pretend otherwise: the decisive numbers sit inside
run-to-run noise. The answer is already in the plan, in Task 16's post-deploy floor, which is checked after
every deploy rather than written once in a table.

## Two tooling lessons from this cut

- `hermes kanban set-model <id> <model> --provider <name>` exists, so a wrong provider pin is repairable on the card itself. Recreating the two review cards was a heavier repair than the defect deserved.
- Name a provider that exists in the ASSIGNEE's own config (`model.provider` in `~/.hermes/profiles/<name>/config.yaml`), never the integration that provider wraps. `custom` is what the router is called, `veil` is what the profile configures.
