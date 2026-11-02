# Review: jam vibe and style registry

**This is ONE self-pass, not the two the process asks for.** The mechanics pass was run in session, by the author, against the classes that survive a green rule pass (step order against the Files lists, baselines taken from the runner, the four mutation classes). The second read-only pass and the fix-verification pass are the gap, and the residual risk below names what they would have graded.

Plan: `.hermes/plans/2026-11-02_115639-jam-vibe-and-style-registry.md`
Checker: every rule passed on 12 tasks. Stamp 855c2f6276547201, taken after the last edit to the plan. Self-test: 11 rules fire.
Artifact: `.hermes/plans/artifacts/2026-11-02-jam-vibe-panel.html`, structural check PASS, five states drawn.

## Claims, re-run in this pass

| Claim | Tier | Re-run |
|---|---|---|
| Suite is 337, floor is 337 | MEASURED | yes, `npx vitest run` printed 337 passed; `check.sh` prints FLOOR 337 |
| Meaning of a style is spread over 7 source files, 26 files with tools and tests | MEASURED | yes, the two greps print 7 and 26 |
| 84 occurrences on 65 lines across 14 test files | MEASURED | yes, `grep -o` prints 84, `grep -c` per file sums to 65 |
| The pinned files hold 8, 28, 10 and 13 tests | MEASURED | yes, one run printed 59 passed across the four |
| Room state is broadcast from 5 sites | MEASURED | yes |
| Prompt glossary names three genres on one line | MEASURED | yes, line 186 |
| Backing section takes the first bot's style | READ FROM SOURCE | yes, line 1218, not run through a live room |
| Agent peers are born PolySynth | READ FROM SOURCE | yes, line 881 |
| Engine routes an instrument per peer | READ FROM SOURCE | yes, the apply line in the page |
| Instrument union is client only and holds 5 | MEASURED | yes |
| Visualizer animates | MEASURED | yes, the smoke printed 1314 then 2124 bright pixels |

## Defects this pass found, and the fix that replaced each sentence

1. **Four Run baselines were guessed from a count of style literals in each file, not from the runner.** The plan said the pinned groove file held 10 tests, melody and reaction 18 together, and pattern-generator 6. The runner prints 8, 38 and 13. Every one of those numbers read as authoritative because it was specific. Replaced with the runner's own counts, and the claim row that carries them was added so the next reader can date them.
2. **The architecture line cited a file that does not exist yet without marking it new.** The checker caught it (R7), which is the one class a green reading of my own prose had missed.
3. **A file count was wrong in the direction that flatters the argument.** The plan said the four style names appear in 12 files; the grep prints 26. Replaced, and the claim now says which grep produces which number.
4. **The drawing showed a restyle button no task builds.** The page copy named an action outside the plan's scope, which is the failure the user-story rule exists to prevent in the other direction. The control is removed from the drawing, its note says plainly that a running bot keeps its part, and a bulk restyle became a non-goal with its reopen condition.
5. **The plan shipped no way to say what a bot IS.** It answered style, instrument and vibe and left the seat to the phrase arc, which is correct for a melodic part and wrong for a band: a person cannot ask for a bass, and nothing stops a bass bot doubling the room's own backing bass. Found by the owner's question rather than by this pass, which makes it the fifth defect a second pass would probably not have found either. Task 10 now carries a seat (drums, bass, lead, answer, ornament), the three melodic seats are a preference the arc still overrides, and the two rhythm seats hand the matching backing layer over. That is what moved the ladder from 356 to 360.
6. **The verification step pressed a button the plan had removed.** Replaced with a despawn and respawn, which is the action the tasks actually provide, and it is also the action that fails today.

6. **A claim in this plan, and the reply that carried it, said the visualizer exists.** It does not exist as an audio visualizer: `Visualizer.tsx` draws note rectangles from the event stream and reads no audio, and the only hit for a waveform anywhere in the tree is that file's own comment at line 35 claiming one. The 1314 to 2124 bright pixel reading was real and measured the wrong thing, so it proved a note roll animates and not that the room has ears. Found by the owner, twice. Task 12 adds one analyser on the engine's master gain at 30 frames a second, and the claim row now says what is mounted rather than what the file calls itself.

## Mechanics

- Step order holds: the registry lands first, the wire enum derives from it second, the three consumers follow, the prompt sixth, the room's vibe seventh, the page eighth, the instrument ninth, the probe last. No task reads a file a later task creates.
- Each mutation fails for the reason it was written: the registry's own completeness check (Task 1), a derived enum with a retyped row (Task 2), a pinned note (Tasks 3 and 4), a verb the prompt must carry (Task 5), a missing generator that must not fall back to jazz (Task 6), a room_state without peers (Task 7, the defect that took the live page down on 2026-11-01), a stale option list (Task 8), an ignored instrument request (Task 9), and two rows that measure the same (Task 10).
- The ladder is arithmetic on the runner's baseline: 337, then 341, 343, 343, 343, 345, 349, 353, 353, 356, 360, 360, 360 with `FLOOR` raised on the seven tasks that add tests; Task 12 adds no vitest case and says so.
- One prediction is left in the plan on purpose and it is the falsifier rather than an acceptance: the style probe must print four DIFFERENT distributions. A plan cannot know the numbers before the probe exists, so it asserts the property.

## Residual risk

- The eight row names are mine, not his. A row called latin or afrobeat is a claim about a musical idiom that a listener from those traditions would grade differently, and the probe cannot see misuse of a name, only a duplicate. The names are the one part of this plan he should change before Task 6 if he cares.
- The instrument union moving to shared code touches the client's audio engine, which no vitest case runs. Task 9's rendered half is an owner step for that reason, and the risk is a voice that renders nothing until someone listens.
- The second pass would have graded the two items above and would probably have found the four baselines a second time from a different direction. Neither it nor this pass would have caught the visualizer claim, because both would have read the same file and believed the same comment: that one needed an external reader who owned the ears.
