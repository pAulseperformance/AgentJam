# Jam Vibe and Style Registry Implementation Plan

**Goal:** a listener sets one vibe for the room and every bot born after it plays that style with that style's instrument, while a bot's own style stays its own field, and a new genre costs one registry row instead of edits in seven files.

**Architecture:** one shared table, created in Task 1 at `src/shared/music/styles.ts`, owns what a style MEANS (its bar shape, note counts, velocity band, grid, cell shape, tempo range, the words the model is told, its fallback generator and its default instrument); `AgentStyle` and the protocol enum are DERIVED from that table's keys; `groove.ts`, `melody.ts`, `reaction.ts` and `llm-planner.ts` read the row instead of branching on the name; room state gains one optional `vibe` field that fills spawn defaults and drives the backing section; `spawn_agent` gains an optional `instrument` field, which the engine already routes per peer, and an optional `seat` field whose rhythm seats hand the matching backing layer over so the kit and the low end are each played once.

## The user story

| Who | Came to | What each person sees when it worked | What each person sees when it fails |
|---|---|---|---|
| A listener in the room | Pick a vibe and hear the band play it | The vibe control names the row, and a bot spawned after it is tagged with that style and that row's instrument | A style whose model call failed plays the room's own fill for that bar and the row says so, while the rest of the band keeps time |
| A listener who wants one part different | Keep the band on funk but put one bot on ambient | The bot's own row carries ambient, the rest stay funk, and the vibe control still reads funk | The bot's own style list is fetched from the registry, so an unavailable row cannot be picked at all |
| A listener who wants a bass | Take the bass seat instead of the room's own backing bass | The bot's row is tagged bass, the bots around it keep their parts, and the backing bass steps back so the low end is played once | The seat list marks bass as taken by the backing section until pressing it hands the seat over, and a second bot cannot take the same seat |
| A guest, not signed in | Listen | The vibe and the rows are drawn and disabled, and the room plays | The controls stay disabled with the reason beside them, and nothing half-applies |
| The person building this | Add a genre | One row in the registry, one generator, and the style appears in every list | The test that walks the registry names the row that is incomplete and which field it lacks |

## The screen

**Artifact:** `.hermes/plans/artifacts/2026-11-02-jam-vibe-panel.html`

The drawing is structural: no colour literals, no network reference, no script. It shows the transport bar with the vibe control and the agent rows with their style and instrument tags, in the five states below. A pre-render exists for how the shipped palette looks; this file is the shape and the states.

| State | What the drawing shows | Which task supplies the data |
|---|---|---|
| empty | The vibe control and key/tempo, no rows, and the note that the vibe is the default for whatever comes next | Task 7 |
| one | One bot tagged funk with a plucked instrument, and the note that a later vibe change does not restyle it | Tasks 6, 8, 9 |
| many | Four rows, each carrying a seat (lead, ornament, drums, bass) beside its style and instrument, with the note that a seated bot keeps its part when the vibe moves | Tasks 7, 8, 10 |
| error | A cinematic pad whose model call failed, playing the room's own fill, with the bar marked as the fill rather than the bot | Task 7 |
| signed out | The same bar with every control disabled and the door named | Task 8 |

## What a person creates

A person creates a BOT through the agent panel: a name, a style picked from the registry rows, and an instrument picked from the instrument list, all defaulted from the room's vibe. A person sets the room's VIBE through the transport bar control, which is a select beside the key and tempo controls. Nothing in this plan is created through a command line: the two write paths are the spawn form and the vibe select, both in the room page at zpe.vc/jam.

## Ownership

- Serves users outside the host app: no, the jam room is one app and the registry is shared code inside it
- Own repository: no, this is a module and a schema field in the repo the room already ships from; a split would put a build between the band and its own table
- Own deploy target: no, the existing agentJam worker on zpe.vc/jam, no new host and no new route
- Data owner: the room's Durable Object storage in this app, and nothing new is stored except one optional field on the room state that already lives there

## Decisions

| Decision | Loser (rejected) | Why |
|---|---|---|
| A style is one registry row, and `AgentStyle` derives from the row ids | A fifth case in each of the three switch files | Adding a genre today costs edits at 7 source files, 5 tools and 84 occurrences of the four names across 14 test files, measured with the greps in the claims table |
| The room's vibe fills spawn defaults, and a bot's style stays its own field | The vibe live-binds every running bot | One listener's click would rewrite every bot's part with no undo; the per-part field is the two-way door and the restyle button is the third option made explicit |
| The backing section reads the vibe first, then the first bot's style, then jazz | Leave first-bot-wins as it is today | The drummer must follow the room's groove, not whichever bot happened to spawn first |
| A bot takes a SEAT (drums, bass, lead, answer, ornament) and the three melodic seats are a preference the phrase arc still overrides | A hard role lock, where a bot seated lead always leads | The room already hands the line to the turn holder and demotes a bot when a human just played, and a lock would make one bot talk over both; the seat is what a person can ask for, the arc stays what makes it a band |
| The instrument is a per-part field, defaulted from the row | One synth for the whole band | Per-peer routing already exists in the engine and the page applies it for humans; the row only supplies the default |
| Eight rows now, each carrying numbers | Twenty rows of prompt adjectives | The falsifier counts notes per bar and onsets per beat; rows that differ only in words measure the same and are renames |
| A new style ships its own generator or names a fallback row | Let a missing generator fall back to jazz silently | The generator map already falls back to jazz, so a row with no generator would measure identical to jazz while wearing a new label |

## Claims

| Claim | Tier | Command or anchor |
|---|---|---|
| The suite is 337 tests and the floor is 337 | MEASURED | `bash ~/.hermes/scripts/cf_run.sh npx vitest run` prints 337 passed; `grep -n 'FLOOR=' check.sh` prints 337 |
| One style's meaning is spread over 7 source files | MEASURED | `grep -rlE "'(jazz|funk|ambient|random)'" src --include='*.ts' --include='*.tsx'` filtered of tests lists 7 files; the same grep over src and tools lists 26 |
| The tests carry 84 occurrences of the four style names, on 65 lines, across 14 test files | MEASURED | `grep -rohE "'(jazz|funk|ambient|random)'" src --include='*.test.ts'` prints 84 occurrences; the same grep with `-c` per file sums to 65 lines |
| The model is told what a style means in one glossary line that names three genres | MEASURED | `sed -n '186p' src/server/llm-planner.ts` prints the "Match the style" line |
| Room state is broadcast from 5 sites | MEASURED | `grep -c "type: 'room_state'" src/server/jam-room.ts` prints 5 |
| The backing section takes its style from the first bot | READ FROM SOURCE | `sed -n '1218p' src/server/jam-room.ts` prints the first-agent fallback |
| Every agent peer is born PolySynth | READ FROM SOURCE | `grep -n "instrument: 'PolySynth'" src/server/jam-room.ts` prints line 881 |
| The engine routes an instrument per peer and the page applies it | READ FROM SOURCE | `grep -n setPeerInstrument src/client/pages/JamRoom.tsx` prints the apply line |
| The instrument union and its list live in the client only, and hold 5 entries | MEASURED | `sed -n '6p;8,13p' src/client/features/synth/lib/audio-engine.ts` prints the union and the 5 rows |
| The role a bot plays is computed per bar, not chosen: alone it leads, the turn holder leads, a bot is demoted to answer when a human just played | READ FROM SOURCE | `sed -n '1738,1772p' src/server/jam-room.ts` prints the four rules in order |
| The only seats a person can pick today are the room's two backing layers, drummer and bass | MEASURED | `grep -n 'drummer' src/server/jam-room.ts` prints the layer type at line 125 and the spawn at line 1201; `grep -c 'set_backing' src/shared/protocol/types.ts` prints 1 |
| The visualizer is mounted, animates, and the gate now prints what it paints | MEASURED | `node tools/browser-smoke.mjs` prints the bright pixel count at the bar and 1.2 s later |
| The four test files the extraction pins hold 8, 28, 10 and 13 tests, which is where every Run baseline below comes from | MEASURED | `bash ~/.hermes/scripts/cf_run.sh npx vitest run src/server/groove.test.ts src/server/melody.test.ts src/server/reaction.test.ts src/shared/music/pattern-generator.test.ts` prints 59 passed across the four files |

## Tasks

### Task 1: The style registry module

**Objective:** create a shared table that owns what a style means, with every field a consumer needs today, so later tasks can delete a branch instead of adding one.

**Files:**
- create `src/shared/music/styles.ts`
- create `src/shared/music/styles.test.ts`
- modify `src/shared/music/index.ts`

**Mutation:** delete one field from the funk row in the registry and the suite must fail naming the row and the missing field; a table that a consumer can read while incomplete is a table the next genre ships half-filled.

**Run:** `npx vitest run src/shared/music/styles.test.ts` prints 4 passed, and the whole suite prints 341 passed (337 today plus 4). Raise `FLOOR` to 341 in the same commit.

### Task 2: Derive the style type and the protocol enum from the registry

**Objective:** make `AgentStyle` the registry's own keys and the `spawn_agent` enum the same list, so a row cannot exist in one place and be missing from the wire.

**Files:**
- modify `src/shared/music/pattern-generator.ts`
- modify `src/shared/protocol/types.ts`
- create `src/shared/protocol/style-enum.test.ts`

**Mutation:** add a ninth row without touching the protocol and the suite must fail, because the enum is derived rather than retyped; the mutant is a row the wire would refuse.

**Run:** `npx vitest run src/shared/protocol/style-enum.test.ts` prints 2 passed and the whole suite prints 343 passed (341 plus 2). Raise `FLOOR` to 343.

### Task 3: The drummer and the bass read their row

**Objective:** replace the three per-style switches in the groove module with the row's drum and bass shapes, changing no note.

**Files:**
- modify `src/server/groove.ts`
- read `src/server/groove.test.ts`

**Mutation:** change one beat in the funk drum row and the existing groove test must fail on the note it pins; the test is the proof that the extraction is behaviour preserving, so it is not rewritten in this task.

**Run:** `npx vitest run src/server/groove.test.ts` prints 8 passed, the same 8 the file printed on 2026-11-02 before the edit, and the whole suite prints 343 passed (no new tests, so the count must not move).

### Task 4: The melody plan and the cell shape read their row

**Objective:** move the two remaining numeric mappings out of their branches: the melody's note counts and instruction, and the cell shape's notes per cell and duration.

**Files:**
- modify `src/server/melody.ts`
- modify `src/server/reaction.ts`
- read `src/server/melody.test.ts`
- read `src/server/reaction.test.ts`

**Mutation:** set the funk row's note count to the jazz count and the melody test must fail on density; if it passes, the row is not the thing the plan reads.

**Run:** `npx vitest run src/server/melody.test.ts src/server/reaction.test.ts` prints 38 passed (28 in the melody file plus 10 in the reaction file, both measured on 2026-11-02), unchanged, and the whole suite prints 343 passed.

### Task 5: The prompt carries the row, not a three-genre glossary

**Objective:** replace the glossary line that describes three genres and the two prompt headers that print a bare style id with the row's label and its verbs, so a new style reaches the model with words it has actually been given.

**Files:**
- modify `src/server/llm-planner.ts`
- create `src/server/style-prompt.test.ts`

**Mutation:** add a ninth row with a distinct verb and a prompt built for it must contain that verb and must not contain the jazz phrase; a prompt that prints only the id is a label the model has never seen defined.

**Run:** `npx vitest run src/server/style-prompt.test.ts` prints 2 passed and the whole suite prints 345 passed (343 plus 2). Raise `FLOOR` to 345.

### Task 6: Five new rows, each with its own generator

**Objective:** take the palette from four ids to eight by adding rows with numbers and generators, and delete the generator map so a row cannot be written without one.

**Files:**
- modify `src/shared/music/styles.ts`
- modify `src/shared/music/pattern-generator.ts`
- modify `src/shared/music/pattern-generator.test.ts`
- modify `README.md`

**Mutation:** delete the latin row's generator and the suite must fail at the registry's own completeness check rather than falling back to jazz; the fallback that exists today is exactly what would hide it.

**Run:** `npx vitest run src/shared/music/pattern-generator.test.ts` prints 17 passed (13 in the file on 2026-11-02 plus 4 row cases) and the whole suite prints 349 passed (345 plus 4). Raise `FLOOR` to 349.

### Task 7: The room's vibe, one broadcast helper, and a section that follows it

**Objective:** add an optional `vibe` to room state with a check against the registry so an id that is not a row is refused, a `set_vibe` client message, a single `broadcastRoomState` helper used by all six broadcast sites, and a backing section that reads the vibe first.

**Files:**
- modify `src/shared/protocol/types.ts`
- modify `src/server/jam-room.ts`
- create `src/server/vibe.test.ts`

**Mutation:** drop `peers` from the helper and the new test must fail on the frame, which is the defect fixed on 2026-11-01 when the phrase-ask toggle took the page down; a helper that repeats that broadcast by hand is a fifth way to ship it again.

**Run:** `npx vitest run src/server/vibe.test.ts` prints 4 passed (the frame carries peers, an unknown id is refused, a new bot takes the vibe, the backing section follows it) and the whole suite prints 353 passed (349 plus 4). Raise `FLOOR` to 353.

### Task 8: The vibe control, the style list and the instrument picker on the page

**Objective:** put the vibe select in the transport bar, default the spawn form to it, and draw each bot's style and instrument from the registry so the panel cannot offer a row that does not exist.

**Files:**
- modify `src/client/pages/JamRoom.tsx`
- modify `src/client/features/room/ui/AgentPanel.tsx`
- modify `src/client/features/room/ui/TransportBar.tsx`
- modify `src/client/features/room/hooks/use-room-socket.ts`
- modify `tools/browser-smoke.mjs`

**Mutation:** hardcode the four old options in the agent panel and the smoke's new print must report a style list that does not equal the registry ids; the page is the only place a person sees the palette, so a stale list there is a palette with a hole in it.

**Run:** `grep -c 'vibe-select' src/client/pages/JamRoom.tsx src/client/features/room/ui/TransportBar.tsx` prints 1 for each file, then `node tools/browser-smoke.mjs` prints a vibe line naming the room's vibe and no page error, and the whole suite still prints 353 passed.

### Task 9: An instrument on the part

**Objective:** move the instrument union into shared code, let `spawn_agent` carry an optional instrument, put it on the agent's peer record, and pick it in the agent panel from the same list the engine implements.

**Files:**
- modify `src/shared/protocol/types.ts`
- modify `src/server/jam-room.ts`
- modify `src/client/features/synth/lib/audio-engine.ts`
- modify `src/client/features/room/ui/AgentPanel.tsx`
- create `src/server/spawn-instrument.test.ts`

**Mutation:** ignore the requested instrument and always build a PolySynth peer and the new test must fail on the peer, because the engine already routes per peer and would happily play a different voice for a human while refusing one for a bot. The second mutant names an instrument the engine does not implement and the spawn must be refused rather than silently defaulted.

**Run:** `npx vitest run src/server/spawn-instrument.test.ts` prints 3 passed (the peer carries the requested voice, an unimplemented one is refused, `agent_spawned` carries it) and the whole suite prints 356 passed (353 plus 3). Raise `FLOOR` to 356.

### Task 10: The seat a bot takes

**Objective:** let a person seat a bot as drums, bass, lead, answer or ornament, defaulting to the first seat the roster does not cover, with the two rhythm seats handing the matching backing layer over so the low end and the kit are each played once.

**Files:**
- modify `src/shared/protocol/types.ts`
- modify `src/server/jam-room.ts`
- modify `src/client/features/room/ui/AgentPanel.tsx`
- create `src/server/seat.test.ts`

**Mutation:** seat a bot on bass and leave the backing bass playing and the new test must fail on two peers claiming one seat; a roster with no coverage rule is how a room ends up with two bass lines and no way to say which one is wrong.

**Run:** `npx vitest run src/server/seat.test.ts` prints 4 passed (the default seat is the first uncovered one, a taken seat is refused, a bass seat stops the backing bass, a melodic seat is still overridden by the turn holder) and the whole suite prints 360 passed (356 plus 4). Raise `FLOOR` to 360.

### Task 11: The probe that grades the palette

**Objective:** build the instrument that measures one room per style and prints notes per bar, onsets on the beat grid and the velocity median, so a row that is a rename is visible as a row whose numbers match another row's.

**Files:**
- create `tools/style-probe.mjs`
- modify `README.md`
- modify `docs/FINDINGS.md`

**Mutation:** point two styles at the same row in the registry and the probe must print two identical distributions, which is the reading the plan exists to make possible; a probe that cannot show sameness cannot show difference.

**Run:** `node tools/style-probe.mjs --styles jazz,funk,ambient,latin --seconds 45` prints one line per style with its notes per bar, its share of onsets on the grid and its velocity median, and the whole suite prints 360 passed.

## Verification

- `python3 ~/.hermes/skills/software-development/plan/scripts/check_plan.py .hermes/plans/2026-11-02_115639-jam-vibe-and-style-registry.md --repo .` prints every rule passed.
- `bash check.sh` prints 360 passed against a floor of 360, and every live probe green.
- `node tools/style-probe.mjs --styles jazz,funk,ambient,latin --seconds 45` prints four lines whose numbers differ, which is the falsifier for the whole palette: any two styles that measure the same distribution are a rename and the row that duplicates another is the defect rather than the label.
- Owner step 1: open https://zpe.vc/jam/ and read the vibe control beside the tempo. Before this work there is no such control at all.
- Owner step 2: set the vibe to funk, spawn one bot, and read its row. It must be tagged funk and carry a plucked voice, where the last measured spawn in the smoke test was tagged nothing and played PolySynth.
- Owner step 3: change the vibe to ambient with that bot still running. The bot must stay funk and the drums and bass must move, and the row must say which of the two it is doing.
- Owner step 4: seat a second bot on bass. The backing bass must stop and the new bot must be tagged bass, where today the room plays two bass lines with no way to tell which one you are hearing.
- Owner step 5: despawn and respawn the bot under the new vibe. It must come back tagged with the room's style and that row's instrument, which is the same press that failed before this work because the spawn form had four hardcoded options and no instrument.

## Non-goals

| Excluded | Why not | Reopens when |
|---|---|---|
| Moving the visualizer and the mixer into one desk strip under the keyboard, with meters | The visualizer is mounted at 840 by 264 above the keyboard and animating, and the mixer already has master and per-peer volume; neither is what makes the band sound like a band | A room has been heard with the vibe driving it and the desk strip is the next thing he names |
| Broadcasting per-part volume so the band shares a balance | Volume is a listener's own ears today, and making it shared turns a private slider into a group decision with no consent step | Two listeners report they cannot hear the same part |
| Instrument programs beyond the five the engine implements | The engine has five voices and each new one is a synthesiser, not a list entry | A style row needs a voice the engine does not have, named by him |
| The vibe moving the room's tempo to fit its tempo range | Moving the tempo mid-bar is the exact class of change that once made the drummer lose the beat, and the room's tempo is a separate control with its own consent | He asks for a genre to clamp the tempo, and the change is scheduled at a bar line |
| A vocalist part | The engine has five synth voices and none of them is a voice; a part called vocals over a PolySynth is a label on a synth | An instrument program that sings exists, and a seat is added for it |
| A role the phrase arc cannot move, pinned at spawn | One bot pinned to lead talks over a human who just played, which is the one rule the room already enforces | He hears a room where the arc's turn taking is the problem rather than the band |
| Restyling a bot that is already playing, in one press | The room's vibe deliberately sets defaults and a part keeps its own style, so a bulk restyle is a second write path over a band that is mid-phrase | A room has eight measured styles and he asks for one press that reformats every running bot |
| A ninth style before eight are measured | Eight rows with numbers can already produce the falsifier's answer; more rows before the probe exists is a palette nobody has graded | The style probe has been run on all eight and every pair differs |
