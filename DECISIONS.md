# DECISIONS: AgentJam

Append-only. One entry per decision, with what it beat and the fact that would overturn it.

## 2026-10-29 The renderer is Workers AI on the same Worker, not an external provider

Loser: a hosted LLM API called from the Durable Object with its own key. Reason: the AI binding is
already on the Worker, the small model answered in 557ms measured through this app, and an external
call adds a credential, a network hop and a bill to every bar. Falsifier: a measured bar where Workers
AI latency exceeds the bar budget on the p90 for a week, or a model answer that cannot be repaired into
a playable bar.

## 2026-10-29 Jev judges, the model renders, and the code applies policy

Loser: asking Jev to write the notes. Reason: Jev generates no text by contract; it answers typed
questions (`role`, `relation`, `density`, `register`, and a rest veto) in one call of 482 to 1104ms
from the edge. Falsifier: a signed room where the brief arrives later than the render can use it, or
where the repaired bar diverges from the brief in more than a fifth of bars.

## 2026-10-29 The composed line is one bar ahead, the reactive layer is one eighth

Loser: rendering the whole bar inside its own beat window. Reason: measured 923ms of phase error when
notes are scheduled from the API return, and the streaming-accompaniment research is explicit that a
large chunk costs reactivity (arXiv 2510.22105), so the two halves are separate. Falsifier: a human
phrase that the composed bar answers with no shared pitch class in more than half of replies after the
answer constraint, which would mean the bar is too coarse.

## 2026-10-29 The drummer and the bass are code, not models

Loser: a generated rhythm section. Reason: a drummer is fixed patterns plus a clock, so it cannot be
late or inconsistent, and it costs no model call; measured 0ms phase and a downbeat in 100% of bars.
Falsifier: a style where the fixed patterns are too repetitive to listen to for four bars, measured by
a person, not by me.

## 2026-10-29 The rest policy is bounded in code

Loser: trusting the decision layer's own rest judgement. Reason: asked whether to sit out, with its
recent activity in the state, Jev rested 7 of 20 live bars, a third of the room silent; with the policy
in code three runs rested exactly 3 in 20. Falsifier: a run where the agent is silent in more than a
fifth of bars, which means the governor is not holding.

## 2026-10-29 Velocity is MIDI 1 to 127 everywhere

Loser: the generator's own 0 to 1 range. Reason: the audio engine divides by 127, so a pattern bar
played at under one percent volume, which sounded like silence rather than like a defect. Falsifier:
a note whose velocity reads outside 1 to 127 in an `ai_debug` frame or a `note_on`.

## 2026-10-29 The tier comes from the door, on a header the browser cannot set

Loser: a per-app login or an Access gate. Reason: the fleet has one identity surface, and a second gate
is a second place to be signed out; the header is computed in the Worker from `get-session` and travels
to the room, so a client message cannot promote itself. Falsifier: a socket that reaches the signed tier
without the door's cookie.

## 2026-10-30 `zpe.vc/jam` is the only door; `jam.zpe.vc` is not

Loser: repairing the upstream interception in `zpe-vc` so the app's own name redirects to the mount.
His call, in his words: "Retire the claim in agentJam". Reason: a GET of `jam.zpe.vc/` answers 302 to
`/services` while HEAD reaches this Worker, so a layer above this Worker answers page requests and no
rule here can win that race; the room API still answers on the old host. Cost accepted: a visitor who
knows the old name lands on `/services` and has to be told the mount. Falsifier: a request where the
zone layer stops intercepting, or a second app that needs the same hostname behaviour, which would make
the redirect worth rebuilding in the right repo.

## 2026-10-30 The plan, its stamp and its review live in the repo, not in the machine's plan directory

Loser: `~/.hermes/plans/`. Reason: that directory is not version controlled, so a review there certifies
a document no other session can see. Falsifier: a tool that only reads the machine's plan directory and
cannot be pointed at a repo path.

## 2026-10-30 Dynamics follow the room, by a shift in the repairer, and a refresh that skips Jev

Loser: letting the model's own velocity follow the brief. Reason: measured with alternating loud and
quiet phrases the reply was a flat 100 either way, and after the shift rule the same probe read 112 to
119 against 42 to 57. Loser for the refresh: paying a Jev decision for the second render, which
measured 1.2s against a 2s bar and never landed. Falsifier: a run where a loud phrase and a quiet one
still get replies within 10 velocity points of each other, which would mean the refresh is missing its
bar again.

## 2026-10-30 An answer carries two of their pitch classes, not one

Loser: the original single-note gesture. Reason: measured with phrases a default C-D-E answer cannot
accidentally match, every reply shared exactly one pitch class (0 of 5 bars cleared a two-note bar),
which reads as its own material with a note borrowed; with two it cleared 4 of 8, and 2 of 2 on bars
rebuilt from a freshly heard window. Falsifier: a run where replies still share one pitch class on
most bars, which would mean the model's own line overrides the constraint.

## 2026-10-30 One agent leads a bar, the turn rotates, and a human outranks both

Loser: letting each agent decide for itself whether to lead. Reason: measured with two agents and no
human, both chose lead or both chose answer, 2 slot collisions, and the room read as an echo. With the
turn rule and a publish-time slot check the same probe measured 0 collisions, a lead in 12 of 14 bars,
never two leads, and no silent bar. Loser also for one synth playing every drum code: a kick, a snare
and a hat are three different voices, so the client builds a kit. Falsifier: a run where two agents
sound the same pitch on the same beat, or a run of 16 bars where neither agent leads any bar.

## 2026-10-30 A melody is a shape in code with notes from the model

Loser: leaving the melody to the decision layer and the model. Reason: measured live, a solo agent
played 3.2 notes per bar with no bar above four and the same arpeggio repeated (Jev answered sparse
every bar, and the prompt's sparse rule asks for 2-4 notes). Loser also for the pitch lottery in the
fallback pattern: it spread across three octaves. With a four-bar arc, a five-note floor and a
completion step the same probe measured 6.1 notes per bar, 12 bars of five or more, and 64 stepwise
moves against 14 leaps. Falsifier: a run where a lead bar still has fewer than four notes, or where
more than a third of the moves are leaps of a fourth or more.

## 2026-10-30 A room with no judge still gets a brief, and dynamics are code

Loser: passing `null` as the brief when Jev is absent (every public session). Reason: recorded, sixteen
bars of eight sixteenths at a flat velocity 100, with no arc, no role and no completion, because all
three hung off the brief. The brief is now code's fallback: lead, medium, mid, new or vary. Loser also
for leaving velocity to the model: a 3B model writes one number per bar, so `shapeLine` swells to the
bar's peak, tapers the ends, holds strong beats and lands the last note, and drops a third consecutive
sixteenth. Measured on a recorded 20-bar solo session after: 5-7 notes per bar, 0 bars at a single
velocity, a median gap of 250ms against 125ms. Falsifier: a recorded session where more than a quarter
of the bars sit at a single velocity, or a bar with eight or more consecutive sixteenths.

## 2026-10-30 A cadence lands short, and a reference phrase exists to judge against

Loser: a five-note floor on every position including the cadence. Reason: the recorded 20-bar session
had 5 to 7 notes in every bar, no bar under four and no silence, so no phrase sounded finished. The
cadence is now TWO notes, one of them the tonic, approached by a step with the rest of the bar open.
Measured before the anchoring fix, only 2 of 16 bars landed short, because the phrase position was the
ROOM's absolute bar number, so the cadence rotated with the room rather than with the agent's phrase. The
arc now runs from the agent's own start. Also recorded:
a hand-written 8-bar phrase in the same key through the same renderer (`reference-8-bars.mp3`), so
"in key and on the scale" can be judged against something that is deliberately intentional. Falsifier:
a session where no bar lands under four notes across sixteen bars, which would mean the cadence rule
is not reaching the renderer.

## 2026-10-30 The phrase is anchored to the agent, the hook comes back, and the line obeys counterpoint

Loser: a free-running model bar per bar, with the four-bar arc read from the ROOM's bar number. Reason:
measured, the cadence fired on 2 of 16 bars and no bar was ever under four notes, so nothing sounded
finished. The arc now runs from the agent's own phrase start, so a listener always hears
state, restate, develop, cadence.

Three researched rules, each measured on a recording:

- restate returns the HOOK with exactly one change (arXiv 2501.17759: vary slightly, never transform
  blindly), which produced a bar identical to its predecessor except one note or slot
- `applyContourRules` enforces the cantus firmus rules (mostly steps, a leap answered by a step the
  other way, no two leaps in one direction, no repeated pitch), which removed three C5s in a row
- `cadenceLine` lands on the tonic in two notes, approached by step, and leaves the bar open

Falsifier: a recording where the second bar of a phrase differs from the first by more than one note,
or where any bar has two notes on one beat, or where no bar in sixteen is under four notes.

## 2026-10-31 One tonal centre for the room, and a semitone is never preferred

Loser: every agent's line judged on its own, and whichever bar reached the slot first kept its notes.
Reason: measured at 160 BPM with jazz, funk and ambient and the backing on, the 45 second probe
printed **17 semitone pairs between two agents in one slot across 84 agent bars**. A semitone is the
one interval two voices cannot share, and it arrived because each render checked only for a shared
pitch on a shared slot. The room now reads ONE centre per session from every agent's recent notes
(`src/server/tonal-map.ts`, each agent voting once rather than each note), keeps the closer of two
candidate bars when a refresh answers a slot the queue already holds, and drops a note that would
land a semitone from another agent's queued or sounding note before it is queued, at the bar line and
on a late patch. Same probe, same tempo, after the deploy: **0 clashes across 87 agent bars**, and
**71 model bars against 73** before, so model bars did not fall by a fifth. Falsifier: a recording
that prints a clash above zero, or one where model bars fall by more than a fifth, which would mean
harmony bought with silence.

## 2026-10-31 A finished session leaves one bank row per AGENT, keyed by the agent's name

Loser: one row per session holding every agent's motif, or the client's localStorage. Reason: the
objective is the last four statements PER AGENT, so the row has to be per agent to enforce the cap and
to answer a returning agent's lookup without reading a whole session; the plan already rules
localStorage out because a shared room is shared memory. Rows live in the object's own storage under
`motif:<room>:<agent name>:<session start>`, so the same session banked twice is an upsert and never a
duplicate — the cap counts sessions, not writes — and a session that heard nothing from an agent
writes no row for it: an empty motif would be the bank remembering silence. The offer rides the model prompt as
`EARLIER SESSION: ...`, never as "your motif from last bar", because the statement is from the room's
past and not from the bar before this one. The measured night: run one on room `bank-probe-1793432472`
printed `bank 0`, run two on the same room id printed `bank 3` (one per agent), and the jazz line it
offered (`B4@1.25, A4@1.50, E4@2.25`) is bar 19's plan from the first run's file.

Falsifier: a returning agent whose first prompt carries no `EARLIER SESSION` line after its row was
written, a fifth statement surviving the cap of four, or a bank row still present after its alarm
fired at seven days.

## 2026-10-31 The session panel counts AGENT-BAR RECORDS, and computes them in a pure module

Loser: counting room bars (one chip per bar, "a bar carries a model line"), and testing the panel
through a DOM. Reason: the recorder holds records, not bars — one `ai_debug` per agent per bar — so 87
records at 160 BPM is 30 room bars, and the `one`/`many` split plus Task 13's per-agent stride need the
per-agent attribution that a room-bar count throws away. Room bars are read off the CLOCK
(`240000 / bpm` ms, the figure `tools/probe-session.mjs:138` divides by) and never off the record
count, because a `late` patch is a second record for a bar that already had one. The panel's numbers
therefore live in `session-summary.ts`, a pure function over `sessionSnapshot()`, because
`vitest.config.ts` runs `defineWorkersConfig` with no DOM and `jsdom` is not a dependency: the numbers
are what a gate can hold, and a `.tsx` test has nowhere to run. The artifact's `50 of 87` beside
`12 + 35` adds to 97 against its own denominator, so every source class now gets its own row
(`llm`, `rest`, `pattern`, `cell`, `fallback`, unknown) and the rows always partition the denominator;
the failure pair is a subset printed under it, never a class of its own.

The panel takes the app's theme variables through INLINE styles rather than a new block in
`index.css`, because the card's file list does not include the sheet and an inline style cannot
silently lose a rule to a later cascade. `--alert` does not exist in `index.css`, so the failure row
and the failed chips take `--accent-rose`, the same token `AiDebugPanel` paints a fallback with; chips
reuse its four-source map, `cell` and an unknown source take `--text-muted`, and a failed chip carries
an outline as well as a colour because colour alone carries no information.

The first wording of the unit line said "13 records is 19 room bars" when the live judge drew its
`one` state on 2026-10-31 (38 s at 120 BPM, one agent that arrived after the audio started). Records
equal room bars only when every agent played every bar, so the line now states both figures and the
rule that joins them, and the case is held by a test.

Falsifier: a session whose drawn rows do not add up to its record denominator, a panel showing a
number no recorder field carries, or a chip strip whose chip count disagrees with the count it is
drawn beside.

## 2026-10-31 The stride and the ceiling are PUBLISHED with every bar, not derived on the surface

Loser: a badge computed from note counts, and a ceiling the client guesses from the stride. Reason:
the room already knows what a render costs it, and therefore knows the stride it paced a bar at; a
surface that re-derived either would drift the day the margin or the tail rule moved, and a session
export would carry no number to read. So `jam-room.ts` stamps `stride` and `ceilingBpm` on every
`ai_debug` meta it publishes (`pacedMeta`), the recorder's whitelist carries both, and
`renderCeilingBpm` sits beside `renderStride` in `bar-queue.ts` as the inversion of the function it
belongs to — floored, because the tempo control moves in whole BPM and a ceiling rounded UP names a
tempo the stride cannot hold. Each agent's badge keeps its own last reading; the tempo mark under the
control takes the SLOWEST agent's ceiling, because one tempo serves the whole room.

Falsifier: a bar record carrying a stride but no ceiling while the room is running, a badge whose
rate disagrees with the stride in the record it was read from, or a tempo mark naming a ceiling above
the slowest agent's own.

## 2026-10-31 The room's fill is a SETTING, and a rest is recorded as one

Loser: making every gap bar a rest for everybody, and a record that says `pattern` for a bar nobody
played. Reason: the fill is what makes a slow agent sound busy — measured at 200 BPM, the cells above
a stride of one and the generator's line at a stride of one covered 37 of 72 agent bars — but whether
that reads as space or as absence is the listener's call, not something the room can measure, so the
plan's own decision table ships the fill as the default with the switch one line away. `set_gap_rests`
turns it off, and the value rides `roomState`: stored with the room's tempo, restored after an eviction,
broadcast to every listener, and reported on `/health`, because a setting only the tab that asked can
see is not the room's setting (Task 5 left `hedge` exactly that way and named it a finding).

THE SWITCH GOVERNS BOTH FILLS, not the generator alone. A "gap bar" is one bar with no model answer, so
it has two possible fills and only one of them is `melodyBar`: above a stride of one it is the agent's
own cells (`reactionFor`), at a stride of one it is the generator's line. A switch that removed only
one would leave the other covering the same gap, and the listener would hear no difference at the tempo
where the cells do the work. So the bar rests in both cases and the record says `rest` rather than
`cell` or `pattern`, which is also why the probe prints all three counts: the setting is proven by
`pattern` and `cell` FALLING while `rest` rises, never by a description.

A GAP REST DOES NOT ERASE THE AGENT'S MOTIF. Every bar that is not a cell bar writes `motifFrom(notes)`,
and with a rest that is the empty set, so a room resting every second bar would erase the phrase it was
resting around and leave the next written bar with nothing to vary from. The write is skipped when the
bar is the setting's own rest: the agent writes LESS, it does not forget.

Falsifier: a probe with `--gap-rests` whose `pattern` or `cell` count has not fallen while `rest` has
not risen, a bar recorded `rest` that still broadcast note-ons, a `room_state` frame omitting the
setting the room is under, or a model bar after a rest that starts from the seed figure instead of the
agent's own motif.

## 2026-10-31 The session reader is a SECOND COPY of the probe's report, and agreement on one file is the gate

Loser: lifting `report()` into a module both tools import. Reason: `probe-session.mjs` opens its
WebSocket at module scope, so importing it from a reader would join a live room to print a saved file;
making it importable means wrapping the whole live path in a `main()` and re-testing the one tool every
probe run depends on, for a reader whose counts are arithmetic over rows the file already carries. So
`tools/read-session.mjs` repeats the computation and the formatting, and the rule that keeps the two
copies honest is the acceptance itself: run the probe to a file, read that file, and every summary
line must be identical. `sed '$d'` of both outputs (the last line names the file each one touched)
compares equal, which is how the card was measured on `/tmp/rs.json`.

THE READER REFUSES TO INVENT A ZERO. A browser export's bar rows are the recorder's whitelist
(`session-recorder.ts`) and carry no `peerId` or `calls`, and files written before those fields
existed carry neither; printing `dynamics 0 agent bars`, `clashes 0` or `calls 0.00 per bar` there
would report a room that played nothing instead of a file that cannot answer. Those lines say
`not measurable` or `not recorded` and name what is missing, while the four counts and the latency
line — which need only `messages`, `notes` and `bars` — print in full from any such file.

Falsifier: a summary line that changes in `tools/probe-session.mjs` and not in `tools/read-session.mjs`,
seen as the two outputs differing on one file; or a reader printing a numeric reading for a field the
file does not carry.

## 2026-10-31 The probe gate holds a floor, and reads its drum codes from the room's own source

Loser: a gate asserting the exact counts a probe printed when the plan was written. Reason: five runs
of the identical command (`node tools/probe-session.mjs --bpm 160 --seconds 45 --agents
jazz,funk,ambient --backing 1`) wrote 66 to 74 model bars on 2026-10-31, and the plan's review
measured 37 and 41 for it a day earlier; an exact count fails on the second run, while a floor of 20 —
under the lowest of those seven (37) — fails only when the model path stops writing. The floor lives
in `check.sh` as `PROBE_FLOOR`, and `scripts/probe-gate.mjs` counts `source: 'llm'` bars exactly as the
probe's own `model bars` line does, so the gate and the probe cannot disagree about which bars are the
model's.

THE DRUM CODES ARE PARSED FROM `src/server/groove.ts`, not copied into the gate. `DRUM` is the
room's export of the kick, snare, hat and tom pitches, so a fifth voice reaches the gate with no
second edit, and an export that cannot be read fails the gate (exit 2) instead of checking an empty
set. The gate reads the `strong beats:` line of each prompt, which is the line `describePhrase`
writes from the notes of a peer that is neither an agent nor a layer (`isPlayerPeer`,
jam-room.ts:1286) — the reading the plan's Claims table already used.

Falsifier: a run at the gate's length and shape that writes fewer than `PROBE_FLOOR` model bars while
the AI panel still shows `source: llm` bars arriving, which would put the floor above the room's
low-water mark; a drum pitch leaking through a line the gate does not read (`they are holding: ...`),
or through a prompt field that is not a string; or a `DRUM` export renamed so the gate reads a
partial list without failing.

## 2026-10-31 The browser half is read from Playwright's socket view, not from the panel

Loser: asserting the session panel's `Model bars` row from the smoke. Reason: a signed-out listener
gets the panel's `signed out` state and no rows at all — `stateOf` puts the tier first by design
(session-summary.ts), and the smoke carries no door cookie — so the row the plan reads on a signed-in
listener's page does not exist for the page this run opens. Playwright's own `websocket` events count
every WebSocket the page CONSTRUCTS and parse the frames it sends and receives from outside the page,
so a page that replaces `window.WebSocket` cannot hide a second socket from the count, and the model
bar is read on the same socket the listener's page opened. The panel is still printed — its state is
the guest state — but it gates nothing.

TWELVE SECONDS FROM NAVIGATION, NOT FROM LAUNCH. The first version waited for DOMContentLoaded and
spent 8 s there: the estate bar's deferred script (zpe-bar.js in the shell's head) holds that event
while the app draws the form at about 1.3 s. The smoke now waits for `commit` and then for the form,
so five runs on the shipped shape reached their first model bar at 3.8 to 5.9 s, and the twelve-second
budget covers load, join, spawn and the bar with margin. `npm i -D playwright` and
`npx playwright install chromium` are the one-time cost; a machine without them exits 3 and check.sh
prints the reading as NOT ASSERTED, never as a pass.

Falsifier: a run where the page constructs two sockets and `tools/browser-smoke.mjs` exits 0; a
healthy page whose first model bar arrives after the twelve-second budget, which would make the
deadline a flake rather than a reading; or a public-tier page that starts drawing the panel's rows,
which would make the row readable and the socket view unnecessary.
