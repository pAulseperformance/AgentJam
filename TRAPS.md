# TRAPS: AgentJam

One dated line per failure that cost an hour, newest first. Every line carries the command that
reveals it, so the next reader re-measures instead of re-learning.

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
- **2026-10-30. `grep -c` exits 1 when it counts zero, so a gate that folds its status into `$?`
  fails on exactly the result it wants.** Print the count and take the exit status from the suite.
  Reveal: `bash check.sh` on a clean tree; the floor line prints the count beside the floor it wanted.
