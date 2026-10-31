# TRAPS: AgentJam

One dated line per failure that cost an hour, newest first. Every line carries the command that
reveals it, so the next reader re-measures instead of re-learning.

- **2026-10-31. A gate that asserts PARITY before the ship refuses every client change.** deploy.sh ran
  `bash check.sh` before uploading, and check.sh's step 3 compares the live shell's asset name to
  `dist/jam/index.html`. A client edit mints a new asset name, so the parity reading is false by
  construction until traffic moves: the first client change after the gate was written was refused
  with "what is serving is not this tree", which is the gate doing its job at the wrong moment. The
  pre-upload gate now runs `PARITY=loose` (the bundle must RESOLVE, parity is printed as not asserted)
  and the strict reading runs in deploy.sh's [7/7], after the upload.
  Reveal: `PARITY=loose bash check.sh` prints "parity is read after the upload"; plain `bash check.sh`
  prints "ok (... 200, the bundle this tree builds)".

- **2026-10-31. The recorder's bar projection is a WHITELIST, so a field it does not name arrives as
  `undefined` and a test that only asserts "a badge exists" still passes.** `sessionSnapshot()` builds
  each bar row key by key, so a field the planner publishes but the projection forgets (`stride`, for
  Task 13's badge) silently never reaches a reader. Name every field a panel reads, and assert the
  VALUE and not the presence.
  Reveal: `grep -n "stride: agentMeta.stride" src/client/features/room/lib/session-recorder.ts`.

- **2026-10-31. The recorder has no change event, so a panel that reads it on mount draws the empty
  state forever.** `messages` is a module-level array with no subscription and `recordedCount()` is a
  plain read, so the summary has to be recomputed on something the socket already re-renders on.
  `aiDebugEntries` is a fresh array per `ai_debug` message (one per bar record), which is the cheapest
  honest trigger; a memo keyed on its LENGTH would freeze at 20 because that state is capped there.
  Reveal: `grep -n "entries" src/client/features/room/ui/session-panel.tsx`, then spawn an agent and
  watch `data-state` change from `empty` without a reload.

- **2026-10-31. A room test that spawns an agent waits on the REAL AI binding's warm call.**
  `wrangler.test.jsonc` binds AI, so a join starts a remote warm call that an eight-second budget
  gates, and the agent's first render awaits it: the case reads an empty prompt and looks like
  whatever it was measuring broke. Install a fake `room.env.AI` before the first join (the motif bank
  cases in `src/server/jam-room.test.ts` do exactly this).
  Reveal: `grep -n 'await this.modelWarm' src/server/jam-room.ts` and `grep -n 'room.env.AI' src/server/jam-room.test.ts`.

- **2026-10-29. A retired Workers AI model reads as a slow model, not as a dead one.** Every bar
  fell back to the pattern generator and the panel said `fallback`, so it looked like parse trouble.
  The error field carried `5028: @cf/meta/infire-llama-3.1-8b-instruct was deprecated on 2026-05-30`.
  Reveal: `npx vitest run src/server/llm-planner.test.ts -t retirement` and read the `error` field of
  any `ai_debug` frame in a live room.

- **2026-10-29. Workers AI returns the note array ALREADY PARSED for current chat models.** A parser
  written for text calls `.trim()` on an `object[]` and throws, so a healthy model falls back on every
  measure and the suite stays green because the tests fed it a string.
  Reveal: `npx vitest run src/server/llm-planner.test.ts -t "already-parsed"`.

- **2026-10-29. A model answers with shapes nobody planned for: `["E4@1.0", ...]`, JSON text inside
  one array element, an object list that lost its brackets, and a chord name (`Am4`) where a pitch
  belongs.** Each one was a bar lost, and each is a test now.
  Reveal: `npx vitest run src/server/llm-planner.test.ts src/server/measure-repair.test.ts`.

- **2026-10-29. Scheduling a note from the instant the API call RETURNED puts the whole bar half a
  beat late.** Measured across 14 live bars: median 923ms of offset on a 2000ms bar, worst 1555ms.
  Notes must be addressed to absolute slots on the transport clock.
  Reveal: `grep -n 'barStart + note.beatTime' src/server/jam-room.ts` and `grep -n 'nextBarStart' src/server/jam-room.ts`.

- **2026-10-29. The pattern generator emitted velocity 0.2-0.8 while the audio engine divides by
  127.** The fallback path played at under one percent volume, which reads as "the agent is silent"
  and not as a unit mismatch.
  Reveal: `npx vitest run src/shared/music/pattern-generator.test.ts -t "MIDI velocity"`.

- **2026-10-29. A Worker module may only export handlers and Durable Object classes.** Exporting a
  plain `const` from the entry file fails the runtime with `Incorrect type for map entry ... is not of
  type function or ExportedHandler`, and the local dev server refuses to start over it.
  Reveal: `grep -n '^export const' src/server/index.ts` must print nothing that is not a handler.

- **2026-10-29. Forwarding a WebSocket upgrade with `body: request.body` plus `duplex` silently kills
  the upgrade.** The socket never opens and no error surfaces, so the client looks broken.
  Reveal: `grep -n 'duplex' src/server/index.ts` and read whether the body is only forwarded for a
  method that has one.

- **2026-10-29. The wrangler OAuth token cannot call the Cloudflare REST API.** `POST
  /accounts/<id>/ai/run` with that token answers `10000 Authentication error`, so a probe written
  against REST reads as "Workers AI is down". `npx wrangler whoami` names the missing scopes.
  Reveal: `npx wrangler whoami`.

- **2026-10-29. A measurement script can be the defect.** A probe read the key's accidental field as
  the mode, so every major key was scored as minor and a correct fix looked 59% wrong. Grade the
  instrument before the thing it reports on.
  Reveal: `grep -n 'major' tools/walk-paths.py` and the `how` column of `docs/PATHS.md`, which is the
  committed version of that same lesson.

- **2026-10-30. A bar rendered at the bar line can only hear the bar BEFORE it, so a reply answers a
  phrase two bars old and every level looks the same.** The fix is a mid-bar refresh that reuses the
  bar's brief; a refresh that also calls the decision model costs 1.2s in a 2s bar and never lands.
  Reveal: play one loud phrase and read the velocities per bar (`docs/PATHS.md` P5 lists what a walker
  cannot see), or re-run the dynamics probe described in `README.md`.
- **2026-10-30. The dynamics pass runs BEFORE a later filter, so a two note cadence can land softer than the
  note before it.** `shapeLine` puts the peak on the landing when the bar is short, but a note dropped after
  it (a slot collision, a thinning pass) can leave the taper note and keep the swell note. Open, not fixed.
  Reveal: a recorded two note bar whose FIRST note carries the higher velocity.
- **2026-10-30. Every quality pass hung off the DECISION, so the tier that has no judge got none of it.**
  A public room (no Jev) passed `brief: null` into the renderer, which skipped the arc, the role, the
  melody completion and the density cap, and the listener heard the raw 3B bar. Any feature keyed to
  `brief` has to say what it does when `brief` is null. Reveal: record a session WITHOUT the door
  cookie and count bars at a single velocity.
- **2026-10-30. `Math.random()` over the scale is not a fallback, it is noise.** Three octaves of
  random scale tones produced `G3 B3 G5 C4 A4 D3 E5 C5 B5` in one bar, and a person hears that as a
  glitch, not as a missed render. Any generated bar, including a fallback, has to walk the scale.
  Reveal: solo agent, 16 bars, count moves of four semitones or more against moves of two or fewer.
- **2026-10-30. Two agents render the same bar at the same moment, so neither can see the other's plan,
  and the repairer's avoid-list is empty when it matters.** The queue is only readable after a render
  finishes, so coordination at render time is advisory. The binding check has to sit at the BAR LINE,
  where the other agent's bar is already sounding. Reveal: two agents, no human, count `pitch@beat`
  pairs both played in one bar.
- **2026-10-30. `grep -c` exits 1 when it counts zero, so a gate that folds its status into `$?`
  fails on exactly the result it wants.** Print the count and take the exit status from the suite.
  Reveal: `bash check.sh` on a clean tree; the floor line prints the count beside the floor it wanted.
